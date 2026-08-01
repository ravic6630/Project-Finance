import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ADMIN_EMAILS, JWT_SECRET } from './config.js';
import { db } from './db.js';
import { HttpError } from './util.js';

// ADMIN_EMAILS is the live source of truth for admin rights, applied on every
// request (so promoting someone is just an env change, no DB surgery).
export function applyEffectiveRole(user) {
  if (user && ADMIN_EMAILS.includes(String(user.email || '').toLowerCase())) user.role = 'admin';
  return user;
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role === 'admin') return next();
  next(new HttpError(403, 'Admins only'));
}

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
export const verifyPassword = (pw, hash) => bcrypt.compareSync(pw, hash);

// jti makes every token unique even for same-second logins, so each device
// always gets its own revocable session row.
export const signToken = (user) =>
  jwt.sign({ id: user.id, email: user.email, jti: randomUUID() }, JWT_SECRET, { expiresIn: '30d' });

const findUserById = db.prepare(
  'SELECT id, email, name, base_currency, role, created_at, totp_enabled FROM users WHERE id = ?'
);

// Gate a route behind an active premium subscription (402 if not). Must run after authRequired.
export async function requirePremium(req, _res, next) {
  const { premiumState } = await import('./services/billing.js');
  if ((await premiumState(req.user)).premium) return next();
  next(new HttpError(402, 'This is a premium feature. Upgrade to Sampada Premium to use it.'));
}

// ---- Device sessions -------------------------------------------------------
// The JWT itself stays stateless; each issued token also gets a session row
// (keyed by its sha256) so users can see and revoke devices. Tokens issued
// before this feature are adopted lazily on their next request.
const tokenHash = (t) => createHash('sha256').update(t).digest('hex');
const nowISO = () => new Date().toISOString();
const insertSession = db.prepare(`
  INSERT OR IGNORE INTO sessions (user_id, token_hash, ua, ip, created_at, last_seen)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const findSession = db.prepare('SELECT * FROM sessions WHERE token_hash = ?');
const touchSession = db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?');

export async function createSession(userId, token, req) {
  const ua = String(req?.headers?.['user-agent'] || '').slice(0, 250) || null;
  const ip =
    String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim() ||
    req?.socket?.remoteAddress ||
    null;
  const ts = nowISO();
  await insertSession.run(userId, tokenHash(token), ua, ip, ts, ts);
}

export const sessionTokenHash = tokenHash;

// Express middleware: require a valid Bearer token and load the user.
export async function authRequired(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Not authenticated'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await findUserById.get(payload.id);
    if (!user) return next(new HttpError(401, 'Account no longer exists'));

    // Device-session check: revoked tokens die immediately; legacy tokens
    // (issued before sessions existed) get a row on first sight.
    const sess = await findSession.get(tokenHash(token));
    if (sess?.revoked_at) return next(new HttpError(401, 'This session was signed out'));
    if (!sess) await createSession(user.id, token, req);
    else if (!sess.last_seen || Date.now() - Date.parse(sess.last_seen) > 6 * 3600 * 1000) {
      await touchSession.run(nowISO(), sess.id); // throttled heartbeat
    }
    req.sessionTokenHash = tokenHash(token);

    req.user = applyEffectiveRole(user);
    next();
  } catch {
    next(new HttpError(401, 'Session expired, please sign in again'));
  }
}
