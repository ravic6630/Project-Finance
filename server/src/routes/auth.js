import { createHash, randomInt } from 'node:crypto';
import { Router } from 'express';
import { ADMIN_EMAILS } from '../config.js';
import { db, now } from '../db.js';
import { applyEffectiveRole, authRequired, hashPassword, signToken, verifyPassword } from '../auth.js';
import { asyncHandler, bad, HttpError, oneOf, str } from '../util.js';
import { emailConfigured, sendMail } from '../services/email.js';
import { CURRENCIES } from '../markets.js';

export const authRouter = Router();

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
});

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

// ---- Email-verified signup (6-digit OTP) ----
const OTP_TTL_MS = 10 * 60 * 1000; // codes last 10 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // minimum gap between code requests
const MAX_OTP_ATTEMPTS = 5;
const genOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

const upsertPending = db.prepare(`
  INSERT INTO pending_signups (email, name, password_hash, base_currency, otp_hash, expires_at, attempts, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  ON CONFLICT(email) DO UPDATE SET
    name=excluded.name, password_hash=excluded.password_hash, base_currency=excluded.base_currency,
    otp_hash=excluded.otp_hash, expires_at=excluded.expires_at, attempts=0, created_at=excluded.created_at
`);
const getPending = db.prepare('SELECT * FROM pending_signups WHERE email = ?');
const delPending = db.prepare('DELETE FROM pending_signups WHERE email = ?');
const bumpPending = db.prepare('UPDATE pending_signups SET attempts = attempts + 1 WHERE email = ?');

function otpEmailHtml(name, code) {
  const who = name ? String(name).split(' ')[0] : 'there';
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
async function issueOtp({ email, name, passwordHash, baseCurrency }) {
  const code = genOtp();
  await upsertPending.run(
    email, name, passwordHash, baseCurrency, sha256(code),
    new Date(Date.now() + OTP_TTL_MS).toISOString(), now()
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
    const email_sent = await issueOtp({ email, name, passwordHash: hashPassword(password), baseCurrency });
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
    await delPending.run(email);
    const user = { id: Number(info.lastInsertRowid), email, name: pending.name, base_currency: pending.base_currency, role };
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
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
    });
    res.json({ pending: true, email, email_sent });
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await findByEmail.get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Incorrect email or password');
    }
    applyEffectiveRole(user);
    res.json({ token: signToken(user), user: publicUser(user) });
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
  const who = name ? String(name).split(' ')[0] : 'there';
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
    res.json({ ok: true });
  })
);
