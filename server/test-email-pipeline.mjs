// The email pipeline, end to end: a real SMTP server (this file), a real API
// process configured to use it, and /api/cron/run driving actual mail bytes.
// Run from server/ (the shared dev API may also be up; this spawns its own):
//   node --env-file-if-exists=.env test-email-pipeline.mjs
//
// Every other suite stops at "the report says sent". This one doesn't: it
// listens on a socket, speaks SMTP back to nodemailer, and asserts the mail
// actually arrived — because "not receiving emails" is precisely the failure
// the reports can't see.
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { db, now } from './src/db.js';
import { localClock } from './src/services/scheduler.js';

const SMTP_PORT = 2525;
const API_PORT = 4123;
const API = `http://127.0.0.1:${API_PORT}/api`;
const SECRET = 'test-cron-secret';
const DOMAIN = '@mailtest.sampada';

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label} ${extra}`);
  }
};

/* ------------------------- a tiny real SMTP server ------------------------- */
// Just enough of RFC 5321 for nodemailer in plain (non-TLS) mode: greeting,
// EHLO without STARTTLS, MAIL/RCPT/DATA, dot-terminated body, QUIT.
const inbox = []; // { from, to: [..], data }
const smtp = createServer((sock) => {
  let buf = '';
  let msg = { from: null, to: [], data: '' };
  let inData = false;
  sock.write('220 mailtest ready\r\n');
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    for (;;) {
      if (inData) {
        const end = buf.indexOf('\r\n.\r\n');
        if (end === -1) return;
        msg.data = buf.slice(0, end);
        buf = buf.slice(end + 5);
        inbox.push({ ...msg, to: [...msg.to] });
        msg = { from: null, to: [], data: '' };
        inData = false;
        sock.write('250 OK stored\r\n');
        continue;
      }
      const nl = buf.indexOf('\r\n');
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const cmd = line.toUpperCase();
      if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) sock.write('250-mailtest\r\n250 OK\r\n');
      else if (cmd.startsWith('MAIL FROM:')) {
        msg.from = line.slice(10).trim().replace(/[<>]/g, '');
        sock.write('250 OK\r\n');
      } else if (cmd.startsWith('RCPT TO:')) {
        msg.to.push(line.slice(8).trim().replace(/[<>]/g, ''));
        sock.write('250 OK\r\n');
      } else if (cmd === 'DATA') {
        inData = true;
        sock.write('354 go ahead\r\n');
      } else if (cmd === 'QUIT') {
        sock.write('221 bye\r\n');
        sock.end();
      } else sock.write('250 OK\r\n'); // RSET / NOOP / anything else
    }
  });
});

/* --------------------------------- helpers -------------------------------- */
async function http(path) {
  const res = await fetch(`${API}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const mailsTo = (email) => inbox.filter((m) => m.to.includes(email));

async function cleanup() {
  const rows = await db.prepare(`SELECT id FROM users WHERE email LIKE '%${DOMAIN}'`).all();
  for (const { id } of rows) {
    for (const t of ['sessions', 'subscriptions', 'email_prefs', 'holdings', 'net_worth_snapshots']) {
      try {
        await db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
      } catch {}
    }
    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
}

async function makeUser(email, name, { premium = true, dailyHour, monthly = false } = {}) {
  const info = await db
    .prepare('INSERT INTO users (email, name, password_hash, base_currency, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(email, name, bcrypt.hashSync('secret123', 10), 'INR', 'user', now());
  const id = Number(info.lastInsertRowid);
  if (premium) {
    const { activatePremium } = await import('./src/services/billing.js');
    await activatePremium(id, { provider: 'trial', days: 1 });
  }
  await db
    .prepare('INSERT INTO email_prefs (user_id, daily, daily_hour, daily_tz, monthly_statement) VALUES (?,?,?,?,?)')
    .run(id, 1, dailyHour, 'Asia/Kolkata', monthly ? 1 : 0);
  return { id, email };
}

/* ---------------------------------- run ----------------------------------- */
console.log('— email pipeline, end to end —');
await cleanup();
await new Promise((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r));

// A real API process, pointed at the capture server. No Brevo key in its env,
// so the SMTP fallback path is the one exercised.
const child = spawn(process.execPath, ['src/index.js'], {
  // fileURLToPath, not .pathname: this directory has a space in its name,
  // and a %20 left in the cwd makes spawn fail with a misleading ENOENT.
  cwd: fileURLToPath(new URL('.', import.meta.url)),
  env: {
    ...process.env,
    BREVO_API_KEY: '',
    // config.js honours PORT only under NODE_ENV=production; dev reads API_PORT.
    PORT: String(API_PORT),
    API_PORT: String(API_PORT),
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(SMTP_PORT),
    SMTP_USER: '',
    SMTP_PASS: '',
    EMAIL_FROM: 'Sampada <no-reply@mailtest.sampada>',
    CRON_SECRET: SECRET,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let childLog = '';
child.stdout.on('data', (d) => (childLog += d));
child.stderr.on('data', (d) => (childLog += d));

let up = false;
for (let i = 0; i < 40 && !up; i++) {
  await new Promise((r) => setTimeout(r, 500));
  up = await fetch(`${API}/health`).then((r) => r.ok).catch(() => false);
}
ok(up, 'a second API instance boots with SMTP configured', childLog.slice(-300));
ok(/digest scheduler armed/i.test(childLog), 'the in-process scheduler arms when email IS configured', childLog.slice(-200));

// The cast: A is due now, B chose a different hour, C let premium lapse.
const hourNow = localClock('Asia/Kolkata').hour;
const A = await makeUser(`due${DOMAIN}`, 'Due Now', { dailyHour: hourNow, monthly: true });
const B = await makeUser(`later${DOMAIN}`, 'Wrong Hour', { dailyHour: (hourNow + 3) % 24 });
const C = await makeUser(`lapsed${DOMAIN}`, 'Lapsed', { premium: false, dailyHour: hourNow });

/* -------------------------------- security -------------------------------- */
ok((await http('/cron/run')).status === 401, 'no secret => 401');
ok((await http('/cron/run?key=wrong')).status === 401, 'wrong secret => 401');

/* ------------------------------ the first run ----------------------------- */
const r1 = (await http(`/cron/run?key=${SECRET}&wait=1`)).body;
ok(r1.digests?.recipients?.includes(A.email), 'digest SENT to the user whose hour it is', JSON.stringify(r1.digests));
ok(!r1.digests?.recipients?.includes(B.email), 'not to the user whose hour it is not');
ok(!r1.digests?.recipients?.includes(C.email), 'not to the lapsed user');
ok(r1.digests?.skip_reasons?.wrong_hour >= 1, 'the report says WHY: wrong_hour counted', JSON.stringify(r1.digests?.skip_reasons));
ok(r1.digests?.skip_reasons?.not_premium >= 1, 'and not_premium counted');
ok((r1.digests?.waiting || []).some((w) => w.email === B.email && w.sends_at_hour === (hourNow + 3) % 24), 'waiting[] names who sends when', JSON.stringify(r1.digests?.waiting));
ok(r1.statements?.recipients?.includes(A.email), 'monthly statement SENT to the opted-in user', JSON.stringify(r1.statements));

const aMail = mailsTo(A.email);
ok(aMail.length === 2, 'two real emails hit the SMTP socket for A (digest + statement)', String(aMail.length));
ok(aMail.every((m) => m.from === 'no-reply@mailtest.sampada'), 'with the configured envelope sender');
ok(aMail.some((m) => m.data.length > 500), 'and a real body, not an empty shell');
ok(mailsTo(B.email).length === 0 && mailsTo(C.email).length === 0, 'nobody else got mail');
ok((await db.prepare('SELECT last_sent, last_statement_month FROM email_prefs WHERE user_id = ?').get(A.id)).last_sent != null, "A's last_sent marker is stamped");

/* ---------------------------- idempotent re-ping --------------------------- */
const before = inbox.length;
const r2 = (await http(`/cron/run?key=${SECRET}&wait=1`)).body;
ok(!r2.digests?.recipients?.includes(A.email) && r2.digests?.skip_reasons?.already_sent_today >= 1, 'a second ping the same hour sends nothing again', JSON.stringify(r2.digests?.skip_reasons));
ok(r2.statements?.skip_reasons?.already_sent_this_month >= 1, 'the statement is once per month too');
ok(inbox.length === before, 'no duplicate mail crossed the socket');
ok(typeof r2.digests?.hint === 'string' && /hour/i.test(r2.digests.hint), 'a quiet run explains itself in plain words', r2.digests?.hint);

/* ------------------------------- force run -------------------------------- */
const r3 = (await http(`/cron/run?key=${SECRET}&wait=1&force=1`)).body;
ok(r3.digests?.recipients?.includes(A.email) && r3.digests?.recipients?.includes(B.email), 'force=1 sends now, chosen hours ignored', JSON.stringify(r3.digests?.recipients));
ok(!r3.digests?.recipients?.includes(C.email), 'force still never mails a lapsed account');
ok(mailsTo(B.email).length === 1, "B's mail really arrived on force");

console.log(`\n${pass} passed, ${fail} failed`);
child.kill();
smtp.close();
await cleanup();
process.exit(fail ? 1 : 0);
