import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './config.js';
import { db } from './db.js';
import { HttpError } from './util.js';

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
export const verifyPassword = (pw, hash) => bcrypt.compareSync(pw, hash);

export const signToken = (user) =>
  jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

const findUserById = db.prepare(
  'SELECT id, email, name, base_currency, role, created_at FROM users WHERE id = ?'
);

// Gate a route behind an active premium subscription (402 if not). Must run after authRequired.
export async function requirePremium(req, _res, next) {
  const { premiumState } = await import('./services/billing.js');
  if (premiumState(req.user).premium) return next();
  next(new HttpError(402, 'This is a premium feature. Upgrade to Sampada Premium to use it.'));
}

// Express middleware: require a valid Bearer token and load the user.
export function authRequired(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Not authenticated'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = findUserById.get(payload.id);
    if (!user) return next(new HttpError(401, 'Account no longer exists'));
    req.user = user;
    next();
  } catch {
    next(new HttpError(401, 'Session expired, please sign in again'));
  }
}
