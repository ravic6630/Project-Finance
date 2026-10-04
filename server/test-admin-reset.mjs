// Admin password reset — deterministic checks. Run from server/ with the dev API up:
//   node --env-file-if-exists=.env test-admin-reset.mjs
//
// An admin reset is what happens when the emailed route can't help someone, so
// it has to actually let them back in: the password the admin reads out must be
// the one that works, the failed attempts that led here must not go on to
// demand an email code, and — when the reset is because someone else may know
// the old password — the devices already signed in must be ended.
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

// Sign-in is rate-limited per address, so each run brings its own.
const NET = `198.51.${100 + Math.floor(Math.random() * 100)}`;
let host = 1;
async function http(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `${NET}.${(host += 1) % 250}`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const DOMAIN = '@adminreset.sampada';
async function cleanup() {
  const rows = await db.prepare(`SELECT id FROM users WHERE email LIKE '%${DOMAIN}'`).all();
  for (const { id } of rows) {
    for (const t of ['sessions', 'password_reset_codes', 'net_worth_snapshots']) {
      try {
        await db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
      } catch {}
    }
    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
}

const login = (email, password) => http('/auth/login', { method: 'POST', body: { email, password } });
async function makeUser(name, role = 'user') {
  const email = `${name}${DOMAIN}`;
  const info = await db
    .prepare('INSERT INTO users (email, name, password_hash, base_currency, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(email, name, bcrypt.hashSync('original1', 10), 'INR', role, now());
  return { id: Number(info.lastInsertRowid), email, token: (await login(email, 'original1')).json.token };
}
const reset = (who, token, body = {}) => http(`/admin/users/${who.id}/reset-password`, { method: 'POST', token, body });
const alive = async (token) => (await http('/auth/me', { token })).status === 200;

console.log('— admin password reset —');
await cleanup();
const ADMIN = await makeUser('boss', 'admin');
const USER = await makeUser('asha');

/* ------------------------------ generated ------------------------------- */
{
  const r = await reset(USER, ADMIN.token);
  ok(r.status === 200 && r.json.generated === true && r.json.email === USER.email, 'with nothing typed, a password is generated', JSON.stringify(r.json));
  ok(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/.test(r.json.password), 'in three readable groups, with nothing that looks like something else (no 0/o, 1/l/i)', r.json.password);
  ok((await login(USER.email, r.json.password)).status === 200, 'the password the admin is shown is the one that signs in');
  ok((await login(USER.email, 'original1')).status === 401, 'and the old one no longer does');
  const again = await reset(USER, ADMIN.token);
  ok(again.json.password !== r.json.password, 'each reset generates a different one');
}

/* -------------------------------- chosen -------------------------------- */
{
  const r = await reset(USER, ADMIN.token, { password: 'chosen-by-admin' });
  ok(r.status === 200 && r.json.generated === false && r.json.password === 'chosen-by-admin', 'a typed password is used as typed');
  ok((await login(USER.email, 'chosen-by-admin')).status === 200, 'and signs in');

  const short = await reset(USER, ADMIN.token, { password: 'abc' });
  ok(short.status === 400 && /at least 6/.test(short.json.error || ''), 'a password that is too short is refused, not silently swapped for a random one', JSON.stringify(short.json));
  ok((await login(USER.email, 'chosen-by-admin')).status === 200, 'and the refused reset changed nothing');
}

/* ----------------------- the run of failed sign-ins ---------------------- */
{
  // Three wrong passwords earn a step-up code by email on the next right one.
  await db
    .prepare("UPDATE users SET failed_logins = 3, login_otp_hash = 'x', login_otp_expires = ?, login_otp_attempts = 2 WHERE id = ?")
    .run(new Date(Date.now() + 600000).toISOString(), USER.id);
  await db
    .prepare('INSERT OR REPLACE INTO password_reset_codes (user_id, otp_hash, expires_at, attempts, created_at) VALUES (?,?,?,?,?)')
    .run(USER.id, 'y', new Date(Date.now() + 600000).toISOString(), 0, now());
  const r = await reset(USER, ADMIN.token);
  const row = await db.prepare('SELECT failed_logins, login_otp_hash, login_otp_attempts FROM users WHERE id = ?').get(USER.id);
  ok(Number(row.failed_logins) === 0 && row.login_otp_hash == null && Number(row.login_otp_attempts) === 0, 'the reset settles the run of failed sign-ins, so the new password is not met with a demand for an email code', JSON.stringify(row));
  ok(!(await db.prepare('SELECT 1 AS x FROM password_reset_codes WHERE user_id = ?').get(USER.id)), 'and any emailed reset code still outstanding is withdrawn');
  const back = await login(USER.email, r.json.password);
  ok(back.status === 200 && !!back.json.token && !back.json.requires_verification, 'they sign straight in');
}

/* ------------------------- devices already signed in --------------------- */
{
  const p = (await reset(USER, ADMIN.token, { password: 'two-devices' })).json.password;
  const phone = (await login(USER.email, p)).json.token;
  const laptop = (await login(USER.email, p)).json.token;
  ok((await alive(phone)) && (await alive(laptop)), 'two devices are signed in');

  const kept = await reset(USER, ADMIN.token, { password: 'kept-signed-in' });
  ok(kept.json.signed_out === 0 && (await alive(phone)) && (await alive(laptop)), 'by default a reset leaves them signed in');

  const ended = await reset(USER, ADMIN.token, { password: 'everyone-out', sign_out: true });
  ok(ended.status === 200 && ended.json.signed_out >= 2, 'asked to, it signs them out — and says how many', JSON.stringify(ended.json.signed_out));
  ok(!(await alive(phone)) && !(await alive(laptop)), 'and both devices really are out');
  ok((await login(USER.email, 'everyone-out')).status === 200, 'while the new password signs in as normal');
}

/* --------------------------- resetting your own -------------------------- */
{
  const other = (await login(ADMIN.email, 'original1')).json.token;
  ok((await alive(ADMIN.token)) && (await alive(other)), 'the admin is signed in on two devices');
  const mine = await reset(ADMIN, ADMIN.token, { password: 'my-new-password', sign_out: true });
  ok(mine.status === 200 && mine.json.signed_out === 1, 'resetting your own password signs out your OTHER device', JSON.stringify(mine.json.signed_out));
  ok(await alive(ADMIN.token), 'and keeps the one you are using');
  ok(!(await alive(other)), 'the other really is out');
}

/* --------------------------------- walls -------------------------------- */
{
  const userToken = (await login(USER.email, 'everyone-out')).json.token;
  ok((await reset(ADMIN, userToken)).status === 403, "someone who isn't an admin cannot reset anything");
  ok((await http('/admin/users/999999999/reset-password', { method: 'POST', token: ADMIN.token, body: {} })).status === 404, 'a user who does not exist is a 404');
  ok((await login(ADMIN.email, 'my-new-password')).status === 200, 'and the refused attempt left the admin password alone');
}

console.log(`\n${pass} passed, ${fail} failed`);
await cleanup();
process.exit(fail ? 1 : 0);
