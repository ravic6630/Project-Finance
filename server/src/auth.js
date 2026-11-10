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
  'SELECT id, email, name, base_currency, role, created_at, totp_enabled, demo_expires_at FROM users WHERE id = ?'
);

// What a live-demo account may not do: anything that reaches outside the app.
// Each entry is [method, path pattern, the reason shown to the visitor]. The
// demo itself is a sandbox of made-up money, so everything inside it — adding,
// editing, deleting, switching currency — stays open.
const SIGN_UP = 'Create your free account to use it.';
const DEMO_BLOCKED = [
  ['POST', /^\/api\/family\/invite$/, `Inviting family sends a real email, so it’s off in the demo. ${SIGN_UP}`],
  ['PUT', /^\/api\/email\/prefs$/, `Email summaries go to a real inbox, so they’re off in the demo. ${SIGN_UP}`],
  ['POST', /^\/api\/email\/test$/, `Email summaries go to a real inbox, so they’re off in the demo. ${SIGN_UP}`],
  ['POST', /^\/api\/billing\/(checkout|manual-claim|demo-activate)$/, `The demo already has every Premium feature switched on — there’s nothing to pay for here. ${SIGN_UP}`],
  ['GET', /^\/api\/billing\/manual-qr$/, `The demo already has every Premium feature switched on — there’s nothing to pay for here. ${SIGN_UP}`],
  ['GET', /^\/api\/broker\/[^/]+\/login-url$/, `Connecting a broker signs in to your real account, so it’s off in the demo. Try the sample import instead, or ${SIGN_UP.toLowerCase()}`],
  ['POST', /^\/api\/broker\/[^/]+\/(connect|sync)$/, `Connecting a broker signs in to your real account, so it’s off in the demo. ${SIGN_UP}`],
  ['POST', /^\/api\/import\/cas$/, `Your real statement belongs in your own account, not a demo. Try the sample statement here, or ${SIGN_UP.toLowerCase()}`],
  ['POST', /^\/api\/support\/thread$/, 'We can’t reply to a demo account, so chat is off here. Create your free account to talk to us.'],
  ['POST', /^\/api\/auth\/2fa\//, `Two-step sign-in protects a real account; the demo has no password to protect. ${SIGN_UP}`],
];
export function demoBlockReason(method, path) {
  const hit = DEMO_BLOCKED.find(([m, re]) => m === method && re.test(path));
  return hit ? hit[2] : null;
}

// Gate a route behind an active premium subscription (402 if not). Must run after authRequired.
export async function requirePremium(req, _res, next) {
  // Mounted bare via router.use, so it is NOT wrapped by asyncHandler — a
  // rejection here would be an unhandled rejection, not a 500. Catch it.
  try {
    const { premiumState } = await import('./services/billing.js');
    if ((await premiumState(req.user)).premium) return next();
    next(new HttpError(402, 'This is a premium feature. Upgrade to Sampada Premium to use it.'));
  } catch (e) {
    next(e);
  }
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
  // Roll the visit clock one step. COALESCE keeps a first-ever sign-in honest:
  // previous stays NULL, and the dashboard shows no "since last time" at all
  // rather than comparing against a zero.
  await db
    .prepare('UPDATE users SET previous_login_at = last_login_at, last_login_at = ? WHERE id = ?')
    .run(ts, userId)
    .catch(() => {});
  // Signing in is proof of life: a pending legacy warning is forgotten and a
  // released Money Map closes again, immediately and without being asked.
  await db
    .prepare('UPDATE users SET legacy_warned_at = NULL, legacy_released_at = NULL WHERE id = ? AND (legacy_warned_at IS NOT NULL OR legacy_released_at IS NOT NULL)')
    .run(userId)
    .catch(() => {});
  // Housekeeping: drop this user's long-dead sessions (tokens expire at 30d,
  // so anything untouched for 35d is just clutter in the devices list).
  const cutoff = new Date(Date.now() - 35 * 86400000).toISOString();
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND last_seen < ?').run(userId, cutoff).catch(() => {});
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
    if (user.demo_expires_at && Date.parse(user.demo_expires_at) <= Date.now()) {
      return next(new HttpError(401, 'This demo has ended — start a fresh one from the home page.'));
    }

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
    if (user.demo_expires_at) {
      const reason = demoBlockReason(req.method, String(req.originalUrl || '').split('?')[0]);
      if (reason) return next(new HttpError(403, reason));
    }
    next();
  } catch {
    next(new HttpError(401, 'Session expired, please sign in again'));
  }
}
