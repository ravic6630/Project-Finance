// Sign-in hardening: failure counting and the step-up code it earns.
// Run from server/ with the API up:  node --env-file-if-exists=.env test-login-security.mjs
//
// The email itself can't be delivered in a dev environment, so the step-up is
// driven the way the server would: the code is planted in the row and a preotp
// ticket is minted with the real secret, then /login/verify is exercised for
// every way it can go wrong. What the running server DOES prove end to end is
// the counting, the fail-open when mail is unconfigured, and the resets.
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db, now } from './src/db.js';
import { JWT_SECRET } from './src/config.js';

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
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const DOMAIN = '@sectest.sampada';
const PW = 'secret123';

async function cleanup() {
  const rows = await db.prepare(`SELECT id FROM users WHERE email LIKE '%${DOMAIN}'`).all();
  for (const { id } of rows) {
    for (const t of ['sessions', 'subscriptions', 'password_reset_codes']) {
      try {
        await db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
      } catch {}
    }
    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
}

async function makeUser(email) {
  const info = await db
    .prepare('INSERT INTO users (email, name, password_hash, base_currency, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(email, 'Sec Tester', bcrypt.hashSync(PW, 10), 'INR', 'user', now());
  return { id: Number(info.lastInsertRowid), email };
}

const readUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const login = (email, password) => http('/auth/login', { method: 'POST', body: { email, password } });

console.log('— sign-in hardening —');
await cleanup();

const U = await makeUser(`guard${DOMAIN}`);

/* ---------------------------- counting failures --------------------------- */
const good = await login(U.email, PW);
ok(good.status === 200 && good.body.token, 'a correct password signs in', JSON.stringify(good.body).slice(0, 90));
ok(Number((await readUser(U.id)).failed_logins) === 0, 'a clean sign-in leaves the counter at zero');

const bad1 = await login(U.email, 'wrong-one');
ok(bad1.status === 401, 'a wrong password is refused', String(bad1.status));
ok(bad1.body.error === 'Incorrect email or password', 'and says nothing about which half was wrong', bad1.body.error);
ok(Number((await readUser(U.id)).failed_logins) === 1, 'the failure is counted');

await login(U.email, 'wrong-two');
await login(U.email, 'wrong-three');
ok(Number((await readUser(U.id)).failed_logins) === 3, 'three failures are counted', String((await readUser(U.id)).failed_logins));

/* --------------------------- no existence oracle -------------------------- */
// The whole reason the step-up fires on SUCCESS and not on the third failure:
// a wrong password must look identical whether or not the account is real,
// however many times it has been tried.
const ghost = await login(`nobody${DOMAIN}`, 'wrong-one');
ok(ghost.status === bad1.status, 'an unknown email fails with the same status', `${ghost.status} vs ${bad1.status}`);
ok(ghost.body.error === bad1.body.error, 'and the same message', ghost.body.error);
const bad4 = await login(U.email, 'wrong-four');
ok(bad4.body.error === ghost.body.error, 'a fourth failure on a REAL account still reads identically', bad4.body.error);

/* ------------------------ fail-open without email ------------------------- */
// Locking someone out of their own money because SMTP isn't configured would
// be a worse bug than the one this feature fixes. With no mail configured the
// step-up is skipped and logged, not enforced.
const after = await login(U.email, PW);
ok(after.status === 200 && after.body.token, 'with no mail configured the correct password still gets in', JSON.stringify(after.body).slice(0, 90));
ok(Number((await readUser(U.id)).failed_logins) === 0, 'and a completed sign-in clears the run of failures');

/* --------------------------- the verify endpoint -------------------------- */
const mintTicket = (id, claims = { preotp: true }) => jwt.sign({ id, ...claims }, JWT_SECRET, { expiresIn: '10m' });

ok((await http('/auth/login/verify', { method: 'POST', body: { ticket: 'not-a-jwt', code: '123456' } })).status === 401,
   'verify: a garbage ticket is refused');
// A real session token is a valid JWT — it must still not be usable here.
ok((await http('/auth/login/verify', { method: 'POST', body: { ticket: after.body.token, code: '123456' } })).status === 401,
   'verify: a session token is not a sign-in ticket');
ok((await http('/auth/login/verify', { method: 'POST', body: { ticket: mintTicket(U.id, { pre2fa: true }), code: '123456' } })).status === 401,
   'verify: a 2FA ticket cannot be swapped in for an email one');

// Plant the state the server would have written, then drive the endpoint.
const arm = async (code, { minutes = 10, attempts = 0 } = {}) => {
  await db
    .prepare('UPDATE users SET failed_logins = 3, login_otp_hash = ?, login_otp_expires = ?, login_otp_attempts = ? WHERE id = ?')
    .run(sha256(code), new Date(Date.now() + minutes * 60000).toISOString(), attempts, U.id);
  return mintTicket(U.id);
};

let ticket = await arm('123456');
const wrongCode = await http('/auth/login/verify', { method: 'POST', body: { ticket, code: '999999' } });
ok(wrongCode.status === 401, 'verify: a wrong code is refused', String(wrongCode.status));
ok(Number((await readUser(U.id)).login_otp_attempts) === 1, 'verify: the wrong attempt is counted');
ok((await readUser(U.id)).login_otp_hash != null, 'verify: one wrong try does not burn the code');

const rightCode = await http('/auth/login/verify', { method: 'POST', body: { ticket, code: '123456' } });
ok(rightCode.status === 200 && rightCode.body.token, 'verify: the right code returns a session', JSON.stringify(rightCode.body).slice(0, 90));
const afterVerify = await readUser(U.id);
ok(Number(afterVerify.failed_logins) === 0, 'verify: the failure run is cleared');
ok(afterVerify.login_otp_hash == null, 'verify: the code is consumed, not left usable');

// Replay of the very same ticket + code must not work a second time.
ok((await http('/auth/login/verify', { method: 'POST', body: { ticket, code: '123456' } })).status === 401,
   'verify: a used code cannot be replayed');

/* ------------------------------- expiry & cap ----------------------------- */
ticket = await arm('222222', { minutes: -1 });
const expired = await http('/auth/login/verify', { method: 'POST', body: { ticket, code: '222222' } });
ok(expired.status === 401 && /expired/i.test(expired.body.error || ''), 'verify: an expired code is refused', expired.body.error);
ok((await readUser(U.id)).login_otp_hash == null, 'verify: an expired code is cleared away');

ticket = await arm('333333', { attempts: 5 });
const capped = await http('/auth/login/verify', { method: 'POST', body: { ticket, code: '333333' } });
ok(capped.status === 401 && /too many/i.test(capped.body.error || ''), 'verify: the attempt cap burns the code', capped.body.error);
ok((await readUser(U.id)).login_otp_hash == null, 'verify: a capped code cannot be ground down further');

/* --------------------------- reset settles the run ------------------------ */
// Proving control of the inbox is a stronger check than the emailed code, so a
// completed reset must not leave a step-up armed for the very next sign-in.
await db.prepare('UPDATE users SET failed_logins = 4 WHERE id = ?').run(U.id);
const resetCode = '654321';
await db
  .prepare('INSERT INTO password_reset_codes (user_id, otp_hash, expires_at, attempts, created_at) VALUES (?,?,?,0,?) ' +
           'ON CONFLICT(user_id) DO UPDATE SET otp_hash=excluded.otp_hash, expires_at=excluded.expires_at, attempts=0')
  .run(U.id, sha256(resetCode), new Date(Date.now() + 600000).toISOString(), now());
const reset = await http('/auth/reset', { method: 'POST', body: { email: U.email, code: resetCode, password: 'brandnew123' } });
ok(reset.status === 200, 'reset: the password is changed', JSON.stringify(reset.body).slice(0, 90));
ok(Number((await readUser(U.id)).failed_logins) === 0, 'reset: the failure run is settled too');
ok((await login(U.email, 'brandnew123')).status === 200, 'reset: the new password signs in cleanly');

console.log(`\n${pass} passed, ${fail} failed`);
await cleanup();
process.exit(fail ? 1 : 0);
