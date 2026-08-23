// Manual payments (PhonePe UPI + Zelle) — deterministic checks. Run from server/:
//   node --env-file-if-exists=.env test-manual-pay.mjs
import bcrypt from 'bcryptjs';
import { db, now } from './src/db.js';

const API = 'http://localhost:4000/api';
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
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const DAY = 86400000;

async function http(path, { method = 'GET', body, token, ip } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// The claim limiter is an in-memory fixed window keyed by IP, so every run
// needs its own addresses — otherwise re-running inside 10 minutes inherits
// the previous run's spent budget and healthy claims get 429'd.
const RL_NET = `198.51.${100 + Math.floor(Math.random() * 100)}`;
const ipFor = (n) => `${RL_NET}.${n}`;

const DOMAIN = '@paytest.sampada';
async function cleanup() {
  const rows = await db.prepare(`SELECT id FROM users WHERE email LIKE '%${DOMAIN}'`).all();
  for (const { id } of rows) {
    for (const t of ['sessions', 'subscriptions', 'support_messages', 'net_worth_snapshots']) {
      try {
        await db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
      } catch {}
    }
    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
}

async function makeUser(email, base, role = 'user') {
  const info = await db
    .prepare('INSERT INTO users (email, name, password_hash, base_currency, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(email, email.split('@')[0], bcrypt.hashSync('secret123', 10), base, role, now());
  const login = await http('/auth/login', { method: 'POST', body: { email, password: 'secret123' } });
  return { id: Number(info.lastInsertRowid), email, token: login.json.token };
}

console.log('— manual payments (UPI + Zelle) —');
await cleanup();

const IN = await makeUser(`indira${DOMAIN}`, 'INR');
const US = await makeUser(`uma-us${DOMAIN}`, 'USD');
const ADMIN = await makeUser(`boss${DOMAIN}`, 'INR', 'admin');

// 1) Billing status advertises the manual rails.
const stIN = await http('/billing/status', { token: IN.token });
ok(stIN.json.manual?.method === 'upi' && stIN.json.manual.upi_id === '7330428449@ybl', 'INR user sees UPI rail', JSON.stringify(stIN.json.manual));
ok(stIN.json.manual?.zelle_id === 'ravic6631@gmail.com', 'zelle id present');
const stUS = await http('/billing/status', { token: US.token });
ok(stUS.json.manual?.method === 'zelle' && stUS.json.manual.zelle_amounts?.monthly === 1.99, 'USD user sees Zelle rail with USD amounts');

// 2) UPI QR: right amount, addressee, and payer-identifying note.
const qm = await http('/billing/manual-qr?interval=monthly', { token: IN.token });
ok(String(qm.json.qr || '').startsWith('data:image') && qm.json.amount === 99, 'monthly QR (₹99)');
ok(qm.json.upi_url.includes('pa=7330428449%40ybl') && qm.json.upi_url.includes('am=99'), 'upi:// carries payee + amount');
ok(decodeURIComponent(qm.json.upi_url).includes(IN.email), 'payment note names the payer');
const qa = await http('/billing/manual-qr?interval=annual', { token: IN.token });
ok(near(qa.json.amount, 1069.2), 'annual QR (₹1069.20 = 12mo −10%)', String(qa.json.amount));

// 3) Claims land in the support inbox (owner's existing chat + email flow).
const claim = await http('/billing/manual-claim', {
  method: 'POST',
  token: IN.token,
  ip: ipFor(1),
  body: { interval: 'monthly', method: 'upi', reference: 'UTR12345' },
});
ok(claim.status === 200, 'UPI claim accepted');
const msg = await db
  .prepare("SELECT body FROM support_messages WHERE user_id = ? ORDER BY id DESC")
  .get(IN.id);
ok(/💳/.test(msg?.body) && /₹99/.test(msg.body) && /UTR12345/.test(msg.body) && /UPI \(7330428449@ybl\)/.test(msg.body), 'claim message: amount + method + ref', msg?.body);

const zclaim = await http('/billing/manual-claim', {
  method: 'POST',
  token: US.token,
  ip: ipFor(2),
  body: { interval: 'annual', method: 'zelle' },
});
ok(zclaim.status === 200, 'Zelle claim accepted');
const zmsg = await db.prepare('SELECT body FROM support_messages WHERE user_id = ? ORDER BY id DESC').get(US.id);
ok(/\$21\.49/.test(zmsg?.body) && /Zelle \(ravic6631@gmail\.com\)/.test(zmsg.body), 'Zelle claim: USD annual amount + address', zmsg?.body);

// 4) Claim spam is throttled (3 per 10 min per IP). The limiter is an in-memory
// fixed window, so use a fresh IP each run — otherwise re-running the suite
// inside 10 minutes inherits the previous run's spent budget.
const rlIp = ipFor(3);
let blocked = 0;
for (let i = 0; i < 4; i += 1) {
  const r = await http('/billing/manual-claim', {
    method: 'POST',
    token: IN.token,
    ip: rlIp,
    body: { interval: 'monthly', method: 'upi' },
  });
  if (r.status === 429) blocked += 1;
}
ok(blocked === 1, 'claim #4 in the window is rate-limited', `blocked=${blocked}`);

// 5) Admin grants stack: +31d, then +31d more, provider 'admin'.
ok((await http(`/admin/users/${IN.id}/premium`, { method: 'POST', token: ADMIN.token, body: { grant: true, days: 31 } })).status === 200, 'admin +1 month');
let sub = await db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(IN.id);
const end1 = Date.parse(sub.current_period_end);
ok(sub.provider === 'admin' && Math.abs(end1 - (Date.now() + 31 * DAY)) < 5 * 60000, 'first grant ≈ +31d, provider admin');
ok((await http(`/admin/users/${IN.id}/premium`, { method: 'POST', token: ADMIN.token, body: { grant: true, days: 31 } })).status === 200, 'admin +1 month again');
sub = await db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(IN.id);
ok(Math.abs(Date.parse(sub.current_period_end) - (end1 + 31 * DAY)) < 60000, 'second grant STACKS to ≈ +62d');
ok((await http('/billing/status', { token: IN.token })).json.state.premium === true, 'user is premium');
ok((await http(`/admin/users/${IN.id}/premium`, { method: 'POST', token: ADMIN.token, body: { grant: false } })).status === 200, 'revoke works');
ok((await http('/billing/status', { token: IN.token })).json.state.premium === false, 'user back to free');

// 6) Legacy grant (no days) still gives the full-year switch.
await http(`/admin/users/${US.id}/premium`, { method: 'POST', token: ADMIN.token, body: { grant: true } });
sub = await db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(US.id);
ok(Math.abs(Date.parse(sub.current_period_end) - (Date.now() + 365 * DAY)) < 5 * 60000, 'legacy grant = 365d');

// 7) Non-admin cannot grant (regression).
ok((await http(`/admin/users/${US.id}/premium`, { method: 'POST', token: IN.token, body: { grant: true, days: 31 } })).status === 403, 'non-admin grant blocked');

console.log(`\n${pass} passed, ${fail} failed`);
await cleanup();
process.exit(fail ? 1 : 0);
