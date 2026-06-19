import { createHash, randomBytes } from 'node:crypto';
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

authRouter.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const name = str(req.body.name);
    if (!emailOk(email)) throw bad('Please enter a valid email address');
    if (password.length < 6) throw bad('Password must be at least 6 characters');
    if (await findByEmail.get(email)) throw bad('An account with that email already exists');

    const role = ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
    const info = await insertUser.run(email, name, hashPassword(password), 'INR', role, now());
    const user = { id: Number(info.lastInsertRowid), email, name, base_currency: 'INR', role };
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
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

// ---- Password reset (forgot password) ----
const setPasswordHash = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const insertReset = db.prepare(
  'INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
);
const getReset = db.prepare('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?');
const delResetsForUser = db.prepare('DELETE FROM password_resets WHERE user_id = ?');

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const appUrl = (req) =>
  process.env.APP_URL || process.env.BROKER_REDIRECT_BASE || `${req.protocol}://${req.get('host')}`;

function resetEmailHtml(user, link) {
  const name = user.name ? user.name.split(' ')[0] : 'there';
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
    <h2 style="color:#4f46e5">🌱 Sampada</h2>
    <p>Hi ${name}, we got a request to reset your password.</p>
    <p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Reset my password</a></p>
    <p style="color:#64748b;font-size:13px">This link expires in 1 hour. If you didn't request it, you can ignore this email.</p>
  </div>`;
}

// Request a reset link. Always responds generically (no email enumeration).
authRouter.post(
  '/forgot',
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await findByEmail.get(email);
    if (user) {
      await delResetsForUser.run(user.id);
      const token = randomBytes(32).toString('hex');
      await insertReset.run(sha256(token), user.id, new Date(Date.now() + 3600e3).toISOString());
      const link = `${appUrl(req)}/reset?token=${token}`;
      if (emailConfigured()) {
        sendMail({ to: email, subject: 'Reset your Sampada password', html: resetEmailHtml(user, link) })
          .catch((e) => console.error('reset email failed:', e.message));
      } else {
        console.log(`[forgot-password] SMTP off — reset link for ${email}: ${link}`);
      }
    }
    res.json({ ok: true });
  })
);

// Complete the reset with a valid, unexpired token.
authRouter.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const token = String(req.body.token || '');
    const password = String(req.body.password || '');
    if (password.length < 6) throw bad('Password must be at least 6 characters');
    const row = token ? await getReset.get(sha256(token)) : null;
    if (!row || Date.parse(row.expires_at) < Date.now()) {
      throw bad('This reset link is invalid or has expired. Please request a new one.');
    }
    await setPasswordHash.run(hashPassword(password), row.user_id);
    await delResetsForUser.run(row.user_id);
    res.json({ ok: true });
  })
);
