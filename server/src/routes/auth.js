import { Router } from 'express';
import { ADMIN_EMAILS } from '../config.js';
import { db, now } from '../db.js';
import { authRequired, hashPassword, signToken, verifyPassword } from '../auth.js';
import { asyncHandler, bad, oneOf, str } from '../util.js';

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
    if (findByEmail.get(email)) throw bad('An account with that email already exists');

    const role = ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
    const info = insertUser.run(email, name, hashPassword(password), 'INR', role, now());
    const user = { id: Number(info.lastInsertRowid), email, name, base_currency: 'INR', role };
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = findByEmail.get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw bad('Incorrect email or password');
    }
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
      ? oneOf(req.body.base_currency, ['INR', 'USD'], 'base_currency')
      : req.user.base_currency;
    updateUser.run(name, base, req.user.id);
    res.json({ user: { ...req.user, name, base_currency: base } });
  })
);
