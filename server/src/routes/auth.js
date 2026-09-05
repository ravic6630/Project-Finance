import { createHash, randomInt } from 'node:crypto';
import { Router } from 'express';
import { ADMIN_EMAILS } from '../config.js';
import { db, now } from '../db.js';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { applyEffectiveRole, authRequired, createSession, hashPassword, signToken, verifyPassword } from '../auth.js';
import { JWT_SECRET } from '../config.js';
import { generateSecret, otpauthUri, verifyTotp } from '../services/totp.js';
import { HttpError, asyncHandler, bad, escapeHtml, oneOf, str, rateLimit } from '../util.js';
import { emailConfigured, sendMail } from '../services/email.js';
import { CURRENCIES } from '../markets.js';

export const authRouter = Router();

// Brute-force shield on everything credential-shaped (prefix match also covers
// /login/2fa, /signup/verify, /signup/resend). 40 tries / 15 min / IP.
authRouter.use(['/login', '/signup', '/forgot', '/reset'], rateLimit({ name: 'auth' }));

const insertUser = db.prepare(`
  INSERT INTO users (email, name, password_hash, base_currency, role, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  base_currency: u.base_currency,
  role: u.role,
  totp_enabled: !!u.totp_enabled,
});

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

// ---- Email-verified signup (6-digit OTP) ----
const OTP_TTL_MS = 10 * 60 * 1000; // codes last 10 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // minimum gap between code requests
const MAX_OTP_ATTEMPTS = 5;
const genOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

const upsertPending = db.prepare(`
  INSERT INTO pending_signups (email, name, password_hash, base_currency, otp_hash, expires_at, ref_code, attempts, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  ON CONFLICT(email) DO UPDATE SET
    name=excluded.name, password_hash=excluded.password_hash, base_currency=excluded.base_currency,
    otp_hash=excluded.otp_hash, expires_at=excluded.expires_at, ref_code=excluded.ref_code,
    attempts=0, created_at=excluded.created_at
`);
const getPending = db.prepare('SELECT * FROM pending_signups WHERE email = ?');
const delPending = db.prepare('DELETE FROM pending_signups WHERE email = ?');
const bumpPending = db.prepare('UPDATE pending_signups SET attempts = attempts + 1 WHERE email = ?');

function otpEmailHtml(name, code) {
  const who = name ? escapeHtml(String(name).split(' ')[0]) : 'there';
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
    <h2 style="color:#1f3a66;margin:0 0 6px">🌱 Sampada</h2>
    <p>Hi ${who}, here's your verification code to finish creating your account:</p>
    <p style="font-size:34px;font-weight:800;letter-spacing:10px;color:#1f3a66;background:#f4f2ec;border:1px solid #e8e2d4;border-radius:12px;padding:16px 0;text-align:center;margin:18px 0">${code}</p>
    <p style="color:#64748b;font-size:13px">This code expires in 10 minutes. If you didn't try to sign up, you can safely ignore this email.</p>
  </div>`;
}

const pickCurrency = (v) => (v ? oneOf(String(v).toUpperCase(), CURRENCIES, 'base_currency') : 'INR');

// Generate a code, persist the pending signup, and email the code. Returns
// whether the email actually went out (false if email isn't configured/failed).
async function issueOtp({ email, name, passwordHash, baseCurrency, refCode = null }) {
  const code = genOtp();
  await upsertPending.run(
    email, name, passwordHash, baseCurrency, sha256(code),
    new Date(Date.now() + OTP_TTL_MS).toISOString(), refCode, now()
  );
  let emailSent = false;
  if (emailConfigured()) {
    try {
      await sendMail({ to: email, subject: 'Your Sampada verification code', html: otpEmailHtml(name, code) });
      emailSent = true;
    } catch (e) {
      console.error('signup OTP email failed:', e.message);
    }
  }
  // If the code couldn't be emailed (mail unconfigured or failing), log it so the
  // owner can still retrieve it rather than the signup being stuck. When email
  // works, the code is never logged.
  if (!emailSent) console.warn(`[signup-otp] email not delivered — code for ${email}: ${code}`);
  return emailSent;
}

// Step 1: validate details and email a verification code. No user created yet.
authRouter.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const name = str(req.body.name);
    if (!emailOk(email)) throw bad('Please enter a valid email address');
    if (password.length < 6) throw bad('Password must be at least 6 characters');
    if (await findByEmail.get(email)) throw bad('An account with that email already exists');
    const baseCurrency = pickCurrency(req.body.base_currency);
    const refCode = str(req.body.ref)?.toUpperCase().slice(0, 16) || null;
    const email_sent = await issueOtp({ email, name, passwordHash: hashPassword(password), baseCurrency, refCode });
    res.status(202).json({ pending: true, email, email_sent });
  })
);

// Step 2: confirm the code → create the real account and log them in.
authRouter.post(
  '/signup/verify',
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const pending = await getPending.get(email);
    if (!pending) throw bad('Your code has expired. Please sign up again.');
    if (Date.parse(pending.expires_at) < Date.now()) {
      await delPending.run(email);
      throw bad('Your code has expired. Please request a new one.');
    }
    if (pending.attempts >= MAX_OTP_ATTEMPTS) {
      await delPending.run(email);
      throw bad('Too many incorrect attempts. Please sign up again.');
    }
    if (sha256(code) !== pending.otp_hash) {
      await bumpPending.run(email);
      throw bad('That code is incorrect. Please check and try again.');
    }
    if (await findByEmail.get(email)) {
      await delPending.run(email);
      throw bad('An account with that email already exists');
    }
    const role = ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
    const info = await insertUser.run(email, pending.name, pending.password_hash, pending.base_currency, role, now());
    // Invited by a friend? Remember who, so their reward fires on first premium.
    if (pending.ref_code) {
      const referrer = await db
        .prepare('SELECT id FROM users WHERE referral_code = ?')
        .get(String(pending.ref_code).toUpperCase());
      if (referrer && referrer.id !== Number(info.lastInsertRowid)) {
        await db.prepare('UPDATE users SET referred_by = ? WHERE id = ?').run(referrer.id, Number(info.lastInsertRowid));
      }
    }
    await delPending.run(email);
    const user = { id: Number(info.lastInsertRowid), email, name: pending.name, base_currency: pending.base_currency, role };
    const token = signToken(user);
    await createSession(user.id, token, req);
    res.status(201).json({ token, user: publicUser(user) });
  })
);

// Resend a fresh code for an in-progress signup (light cooldown to curb abuse).
authRouter.post(
  '/signup/resend',
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const pending = await getPending.get(email);
    if (!pending) throw bad('Start signing up first.');
    if (Date.now() - Date.parse(pending.created_at) < RESEND_COOLDOWN_MS) {
      throw new HttpError(429, 'Please wait a few seconds before requesting a new code.');
    }
    const email_sent = await issueOtp({
      email,
      name: pending.name,
      passwordHash: pending.password_hash,
      baseCurrency: pending.base_currency,
      refCode: pending.ref_code || null,
    });
    res.json({ pending: true, email, email_sent });
  })
);

/* ---------------------- step-up after repeated failures -------------------- */
// A run of wrong passwords is what a guessing attack looks like from here. So
// once an account has collected FAILED_LOGIN_LIMIT of them, the next CORRECT
// password is no longer enough on its own: we email a one-time code and ask for
// it too. Whoever eventually guesses the password still needs the inbox.
//
// The check deliberately fires on SUCCESS, not on the third failure. Announcing
// "we've emailed you a code" the moment someone mistypes a password would tell
// an attacker which addresses have accounts; a wrong password keeps returning
// the same flat "Incorrect email or password" it always did, however many times
// it is tried.
const FAILED_LOGIN_LIMIT = 3;
const LOGIN_OTP_TTL_MS = 10 * 60 * 1000;
const MAX_LOGIN_OTP_ATTEMPTS = 5;

const bumpFailedLogins = db.prepare('UPDATE users SET failed_logins = failed_logins + 1 WHERE id = ?');
const clearLoginGuard = db.prepare(
  'UPDATE users SET failed_logins = 0, login_otp_hash = NULL, login_otp_expires = NULL, login_otp_attempts = 0 WHERE id = ?'
);
const setLoginOtp = db.prepare(
  'UPDATE users SET login_otp_hash = ?, login_otp_expires = ?, login_otp_attempts = 0 WHERE id = ?'
);
const bumpLoginOtpAttempts = db.prepare('UPDATE users SET login_otp_attempts = login_otp_attempts + 1 WHERE id = ?');

function loginOtpEmailHtml(name, code, tries) {
  const who = escapeHtml(name || 'there');
  return `
    <h2 style="font-family:Georgia,serif;color:#1f3a66">One more step to sign in</h2>
    <p>Hi ${who}, there ${tries === 1 ? 'was 1 failed sign-in attempt' : `were ${tries} failed sign-in attempts`} on your Sampada account before this one, so we're checking it's really you:</p>
    <p style="font-size:34px;font-weight:800;letter-spacing:10px;color:#1f3a66;background:#f4f2ec;border:1px solid #e8e2d4;border-radius:12px;padding:16px 0;text-align:center;margin:18px 0">${code}</p>
    <p style="color:#64748b;font-size:13px">This code expires in 10 minutes.</p>
    <p style="color:#64748b;font-size:13px"><strong>If this wasn't you</strong>, someone knows your password. Don't enter the code — change your password straight away.</p>
  `;
}

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await findByEmail.get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      // Count it against the account when there is one, but say the same thing
      // either way — the message must not become an account-existence oracle.
      if (user) await bumpFailedLogins.run(user.id);
      throw new HttpError(401, 'Incorrect email or password');
    }
    applyEffectiveRole(user);
    if (user.totp_enabled) {
      // Password OK, but a 6-digit authenticator code is still needed. The
      // ticket only proves "password already checked" and dies in 5 minutes.
      // An authenticator IS the second factor, so it replaces the email code
      // rather than stacking a second one on top of it.
      const ticket = jwt.sign({ id: user.id, pre2fa: true }, JWT_SECRET, { expiresIn: '5m' });
      return res.json({ requires_2fa: true, ticket });
    }

    const failures = Number(user.failed_logins) || 0;
    if (failures >= FAILED_LOGIN_LIMIT) {
      // Without mail there is no way to deliver a code, and refusing the login
      // would lock someone out of their own money over a config gap. Let them
      // in, and record loudly that the check could not be run.
      if (!emailConfigured()) {
        console.warn(`[login-otp] email not configured — step-up skipped for user ${user.id} after ${failures} failures`);
      } else {
        const code = genOtp();
        await setLoginOtp.run(sha256(code), new Date(Date.now() + LOGIN_OTP_TTL_MS).toISOString(), user.id);
        try {
          await sendMail({
            to: user.email,
            subject: 'Your Sampada sign-in code',
            html: loginOtpEmailHtml(user.name, code, failures),
          });
        } catch (err) {
          // Transient, not a lockout: the password was right and they can try
          // again. Failing closed here beats handing out a session we said we
          // would gate.
          console.error('[login-otp] send failed:', err?.message);
          throw new HttpError(503, "We couldn't send your sign-in code just now. Please try again in a moment.");
        }
        const ticket = jwt.sign({ id: user.id, preotp: true }, JWT_SECRET, { expiresIn: '10m' });
        return res.json({ requires_verification: true, ticket, failed_attempts: failures });
      }
    }

    await clearLoginGuard.run(user.id);
    const token = signToken(user);
    await createSession(user.id, token, req);
    res.json({ token, user: publicUser(user) });
  })
);

// Step 2 after a run of failures: ticket (from /login) + emailed code → token.
authRouter.post(
  '/login/verify',
  asyncHandler(async (req, res) => {
    let payload;
    try {
      payload = jwt.verify(String(req.body.ticket || ''), JWT_SECRET);
    } catch {
      throw new HttpError(401, 'That sign-in attempt expired — enter your password again.');
    }
    if (!payload.preotp) throw new HttpError(401, 'Invalid sign-in ticket');
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) throw new HttpError(401, 'Account no longer exists');
    if (!user.login_otp_hash || !user.login_otp_expires) {
      throw new HttpError(401, 'That code has already been used — enter your password again.');
    }
    if (Date.parse(user.login_otp_expires) < Date.now()) {
      await setLoginOtp.run(null, null, user.id);
      throw new HttpError(401, 'That code has expired — enter your password again for a new one.');
    }
    // A six-digit code is only 10^6 wide, so the attempt cap is what makes it
    // safe. Burn the code at the cap rather than letting it be ground down.
    if ((Number(user.login_otp_attempts) || 0) >= MAX_LOGIN_OTP_ATTEMPTS) {
      await setLoginOtp.run(null, null, user.id);
      throw new HttpError(401, 'Too many incorrect codes — enter your password again for a new one.');
    }
    if (sha256(String(req.body.code || '').trim()) !== user.login_otp_hash) {
      await bumpLoginOtpAttempts.run(user.id);
      throw new HttpError(401, 'That code is incorrect. Check the email we just sent you.');
    }

    applyEffectiveRole(user);
    await clearLoginGuard.run(user.id);
    const token = signToken(user);
    await createSession(user.id, token, req);
    res.json({ token, user: publicUser(user) });
  })
);

// Step 2 of a 2FA login: ticket (from /login) + authenticator code → real token.
authRouter.post(
  '/login/2fa',
  asyncHandler(async (req, res) => {
    let payload;
    try {
      payload = jwt.verify(String(req.body.ticket || ''), JWT_SECRET);
    } catch {
      throw new HttpError(401, 'That sign-in attempt expired — enter your password again.');
    }
    if (!payload.pre2fa) throw new HttpError(401, 'Invalid sign-in ticket');
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) throw new HttpError(401, 'Account no longer exists');
    if (!verifyTotp(user.totp_secret, req.body.code)) {
      throw new HttpError(401, 'That code is incorrect. Check your authenticator app.');
    }
    applyEffectiveRole(user);
    await clearLoginGuard.run(user.id);
    const token = signToken(user);
    await createSession(user.id, token, req);
    res.json({ token, user: publicUser(user) });
  })
);

authRouter.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

const updateUser = db.prepare('UPDATE users SET name = ?, base_currency = ? WHERE id = ?');
authRouter.patch(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const name = req.body.name !== undefined ? str(req.body.name) : req.user.name;
    const base = req.body.base_currency
      ? oneOf(String(req.body.base_currency).toUpperCase(), CURRENCIES, 'base_currency')
      : req.user.base_currency;
    await updateUser.run(name, base, req.user.id);
    res.json({ user: { ...req.user, name, base_currency: base } });
  })
);

// ---- Password reset (forgot password → emailed 6-digit code) ----
const setPasswordHash = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const upsertResetCode = db.prepare(`
  INSERT INTO password_reset_codes (user_id, otp_hash, expires_at, attempts, created_at)
  VALUES (?, ?, ?, 0, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    otp_hash=excluded.otp_hash, expires_at=excluded.expires_at, attempts=0, created_at=excluded.created_at
`);
const getResetCode = db.prepare('SELECT * FROM password_reset_codes WHERE user_id = ?');
const delResetCode = db.prepare('DELETE FROM password_reset_codes WHERE user_id = ?');
const bumpResetCode = db.prepare('UPDATE password_reset_codes SET attempts = attempts + 1 WHERE user_id = ?');

const RESET_TTL_MS = 15 * 60 * 1000; // reset codes last 15 minutes

function resetEmailHtml(name, code) {
  const who = name ? escapeHtml(String(name).split(' ')[0]) : 'there';
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
    <h2 style="color:#1f3a66;margin:0 0 6px">🌱 Sampada</h2>
    <p>Hi ${who}, use this code to reset your password:</p>
    <p style="font-size:34px;font-weight:800;letter-spacing:10px;color:#1f3a66;background:#f4f2ec;border:1px solid #e8e2d4;border-radius:12px;padding:16px 0;text-align:center;margin:18px 0">${code}</p>
    <p style="color:#64748b;font-size:13px">This code expires in 15 minutes. If you didn't request it, you can ignore this email — your password won't change.</p>
  </div>`;
}

// Request a reset code. Always responds generically (no email enumeration).
authRouter.post(
  '/forgot',
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await findByEmail.get(email);
    if (user) {
      const code = genOtp();
      await upsertResetCode.run(user.id, sha256(code), new Date(Date.now() + RESET_TTL_MS).toISOString(), now());
      let sent = false;
      if (emailConfigured()) {
        try {
          await sendMail({ to: email, subject: 'Your Sampada password reset code', html: resetEmailHtml(user.name, code) });
          sent = true;
        } catch (e) {
          console.error('reset code email failed:', e.message);
        }
      }
      if (!sent) console.warn(`[reset-otp] email not delivered — code for ${email}: ${code}`);
    }
    // email_configured is server-wide, so it reveals nothing about this account.
    res.json({ ok: true, email_configured: emailConfigured() });
  })
);

// Complete the reset with a valid, unexpired code.
authRouter.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const password = String(req.body.password || '');
    if (password.length < 6) throw bad('Password must be at least 6 characters');
    const user = await findByEmail.get(email);
    const row = user ? await getResetCode.get(user.id) : null;
    // Same message whether the email is unknown or the code is wrong — no enumeration.
    if (!user || !row || Date.parse(row.expires_at) < Date.now()) {
      if (row) await delResetCode.run(user.id);
      throw bad('That code is invalid or has expired. Please request a new one.');
    }
    if (row.attempts >= MAX_OTP_ATTEMPTS) {
      await delResetCode.run(user.id);
      throw bad('Too many incorrect attempts. Please request a new code.');
    }
    if (sha256(code) !== row.otp_hash) {
      await bumpResetCode.run(user.id);
      throw bad('That code is incorrect. Please check and try again.');
    }
    await setPasswordHash.run(hashPassword(password), user.id);
    await delResetCode.run(user.id);
    // Proving control of the inbox is a stronger check than the step-up code
    // would be, so the failure run that earned it is settled. Leaving it would
    // demand an email code on the very next sign-in, straight after one.
    await clearLoginGuard.run(user.id);
    res.json({ ok: true });
  })
);

// ---- Two-factor auth management (all require a signed-in user) -------------

// Start setup: mint a secret (not yet active) and return the QR to scan.
authRouter.post(
  '/2fa/setup',
  authRequired,
  asyncHandler(async (req, res) => {
    const full = await db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(req.user.id);
    if (full?.totp_enabled) throw bad('Two-factor is already enabled.');
    const secret = generateSecret();
    await db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').run(secret, req.user.id);
    const uri = otpauthUri(secret, req.user.email);
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
    res.json({ secret, otpauth: uri, qr });
  })
);

// Confirm setup with a live code from the authenticator app.
authRouter.post(
  '/2fa/enable',
  authRequired,
  asyncHandler(async (req, res) => {
    const full = await db.prepare('SELECT totp_secret, totp_enabled FROM users WHERE id = ?').get(req.user.id);
    if (full?.totp_enabled) throw bad('Two-factor is already enabled.');
    if (!full?.totp_secret) throw bad('Start setup first.');
    if (!verifyTotp(full.totp_secret, req.body.code)) {
      throw bad('That code is incorrect — scan the QR again and retry.');
    }
    await db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(req.user.id);
    res.json({ ok: true, totp_enabled: true });
  })
);

// Turning it off also requires a valid code (a stolen open laptop can't).
authRouter.post(
  '/2fa/disable',
  authRequired,
  asyncHandler(async (req, res) => {
    const full = await db.prepare('SELECT totp_secret, totp_enabled FROM users WHERE id = ?').get(req.user.id);
    if (!full?.totp_enabled) throw bad('Two-factor is not enabled.');
    if (!verifyTotp(full.totp_secret, req.body.code)) throw bad('That code is incorrect.');
    await db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?').run(req.user.id);
    res.json({ ok: true, totp_enabled: false });
  })
);

// ---- Device sessions --------------------------------------------------------

authRouter.get(
  '/sessions',
  authRequired,
  asyncHandler(async (req, res) => {
    const rows = await db
      .prepare('SELECT id, ua, ip, created_at, last_seen, token_hash FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen DESC, id DESC')
      .all(req.user.id);
    res.json({
      sessions: rows.map((r) => ({
        id: r.id,
        ua: r.ua,
        ip: r.ip,
        created_at: r.created_at,
        last_seen: r.last_seen,
        current: r.token_hash === req.sessionTokenHash,
      })),
    });
  })
);

// Revoke one device. Revoking the current one signs this client out too.
authRouter.delete(
  '/sessions/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const info = await db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
      .run(now(), req.params.id, req.user.id);
    if (!info.changes) throw new HttpError(404, 'Session not found');
    res.json({ ok: true });
  })
);

// "Sign out everywhere else" — every device except this one.
authRouter.post(
  '/sessions/revoke-others',
  authRequired,
  asyncHandler(async (req, res) => {
    const info = await db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND token_hash <> ?')
      .run(now(), req.user.id, req.sessionTokenHash || '');
    res.json({ ok: true, revoked: info.changes });
  })
);

