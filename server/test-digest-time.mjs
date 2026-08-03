// Per-user daily-digest delivery time — deterministic checks. Run from server/:
//   node --env-file-if-exists=.env test-digest-time.mjs
import bcrypt from 'bcryptjs';
import { db, now } from './src/db.js';
import { activatePremium } from './src/services/billing.js';
import { localClock, shouldSendDigest, runDigests } from './src/services/scheduler.js';

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

async function http(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const EMAIL = 'clock@clocktest.sampada';
async function cleanup() {
  const rows = await db.prepare("SELECT id FROM users WHERE email LIKE '%@clocktest.sampada'").all();
  for (const { id } of rows) {
    for (const t of ['sessions', 'subscriptions', 'email_prefs', 'net_worth_snapshots']) {
      try {
        await db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
      } catch {}
    }
    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
}

console.log('— per-user digest delivery time —');
await cleanup();

const info = await db
  .prepare('INSERT INTO users (email, name, password_hash, base_currency, role, created_at) VALUES (?,?,?,?,?,?)')
  .run(EMAIL, 'Clock Tester', bcrypt.hashSync('secret123', 10), 'INR', 'user', now());
const uid = Number(info.lastInsertRowid);
const login = await http('/auth/login', { method: 'POST', body: { email: EMAIL, password: 'secret123' } });
const token = login.json.token;

/* ---- 1. prefs API: set + read time, validation, no premium needed for time ---- */
const set1 = await http('/email/prefs', { method: 'PUT', token, body: { daily_hour: 20, daily_tz: 'America/New_York' } });
ok(set1.status === 200 && set1.json.daily_hour === 20 && set1.json.daily_tz === 'America/New_York', 'free user can set hour + timezone');
const got = await http('/email/prefs', { token });
ok(got.json.daily_hour === 20 && got.json.daily_tz === 'America/New_York' && got.json.daily === false, 'prefs persist; daily still off');
ok((await http('/email/prefs', { method: 'PUT', token, body: { daily_hour: 25 } })).status === 400, 'hour 25 rejected');
ok((await http('/email/prefs', { method: 'PUT', token, body: { daily_hour: 'noon' } })).status === 400, 'non-numeric hour rejected');
ok((await http('/email/prefs', { method: 'PUT', token, body: { daily_tz: 'Mars/Olympus_Mons' } })).status === 400, 'fake timezone rejected');
await activatePremium(uid, { provider: 'trial', days: 1 });
const on = await http('/email/prefs', { method: 'PUT', token, body: { daily: true } });
ok(on.status === 200 && on.json.daily === true && on.json.daily_hour === 20, 'turning daily on keeps the chosen time');

/* ---- 2. the clock: local date+hour in any zone, IST fallback ---- */
const at = new Date('2026-08-02T18:30:00.000Z'); // fixed instant
ok(localClock('Asia/Kolkata', at).hour === 0 && localClock('Asia/Kolkata', at).date === '2026-08-03', 'IST: 18:30 UTC = 00:00 next day');
ok(localClock('America/New_York', at).hour === 14 && localClock('America/New_York', at).date === '2026-08-02', 'New York: 18:30 UTC = 14:00 same day (EDT)');
ok(localClock('Europe/London', at).hour === 19, 'London: 19:00 (BST)');
ok(localClock('Not/AZone', at).tz === 'Asia/Kolkata', 'invalid zone falls back to IST without throwing');

/* ---- 3. shouldSendDigest: hour match + per-day guard in the USER'S zone ---- */
const mk = (hour, tz, lastSent = null) => ({ daily_hour: hour, daily_tz: tz, last_sent: lastSent });
ok(shouldSendDigest(mk(0, 'Asia/Kolkata'), { at }) === true, 'sends at the chosen local hour');
ok(shouldSendDigest(mk(8, 'Asia/Kolkata'), { at }) === false, 'silent at any other hour');
ok(shouldSendDigest(mk(14, 'America/New_York'), { at }) === true, 'same instant, NY user at 2 PM gets theirs');
ok(shouldSendDigest(mk(14, 'Asia/Kolkata'), { at }) === false, 'same hour number, wrong zone → no send');
// Already sent "today" (their day): 13:00 NY the same afternoon.
ok(shouldSendDigest(mk(14, 'America/New_York', '2026-08-02T17:05:00.000Z'), { at }) === false, 'once per THEIR day');
// Sent yesterday their time → due again.
ok(shouldSendDigest(mk(14, 'America/New_York', '2026-08-01T18:05:00.000Z'), { at }) === true, 'yesterday counts as due');
// IST midnight edge: last_sent 17:00 UTC = 22:30 IST Aug 2; at 18:30 UTC it is already Aug 3 in IST.
ok(shouldSendDigest(mk(0, 'Asia/Kolkata', '2026-08-02T17:00:00.000Z'), { at }) === true, 'IST day flips at midnight, not UTC');
ok(shouldSendDigest(mk(3, 'Asia/Kolkata', now()), { force: true }) === true, 'force bypasses hour + day guards');

/* ---- 4. runDigests still reports cleanly without email config ---- */
const run = await runDigests();
ok(run.error === 'email_not_configured' && run.sent === 0, 'runner no-ops without email config');

console.log(`\n${pass} passed, ${fail} failed`);
await cleanup();
process.exit(fail ? 1 : 0);
