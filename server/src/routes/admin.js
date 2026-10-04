import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { db, now } from '../db.js';
import { applyEffectiveRole, authRequired, hashPassword, requireAdmin } from '../auth.js';
import { asyncHandler, bad, HttpError } from '../util.js';
import { activatePremium, deactivatePremium, extendPremium, premiumState } from '../services/billing.js';
import { sendPremiumWelcome } from '../services/premiumEmail.js';

export const adminRouter = Router();
adminRouter.use(authRequired, requireAdmin);

const listUsers = db.prepare(`
  SELECT u.id, u.email, u.name, u.role, u.base_currency, u.created_at,
    (SELECT COUNT(*) FROM holdings h WHERE h.user_id = u.id)      AS holdings,
    (SELECT COUNT(*) FROM cash_accounts c WHERE c.user_id = u.id) AS accounts,
    (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id)  AS transactions,
    (SELECT daily FROM email_prefs e WHERE e.user_id = u.id)      AS daily_email
  FROM users u ORDER BY u.created_at DESC
`);
const getUser = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?');

adminRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const rows = await listUsers.all();
    const users = await Promise.all(
      rows.map(async (u) => {
        applyEffectiveRole(u); // reflect ADMIN_EMAILS in the listed role
        const st = await premiumState(u);
        return {
          ...u,
          holdings: Number(u.holdings),
          accounts: Number(u.accounts),
          transactions: Number(u.transactions),
          daily_email: !!u.daily_email,
          premium: st.premium,
          plan: st.plan,
        };
      })
    );
    res.json({
      counts: {
        users: users.length,
        premium: users.filter((u) => u.premium).length,
        holdings: users.reduce((s, u) => s + u.holdings, 0),
      },
      users,
    });
  })
);

const CHILD_TABLES = [
  'holdings', 'cash_accounts', 'assets', 'transactions', 'goals', 'goal_links', 'alerts',
  'net_worth_snapshots', 'investment_txns', 'subscriptions', 'recurring_rules', 'budgets',
  'broker_connections', 'email_prefs', 'password_reset_codes', 'sessions',
  'support_messages', 'profiles', 'insight_prefs', 'allocation_targets', 'goal_prefs',
];

adminRouter.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw new HttpError(400, "You can't delete your own admin account here.");
    const target = await getUser.get(id);
    if (!target) throw new HttpError(404, 'User not found');
    // Explicit child deletes (don't rely on FK cascade across DB backends).
    await db.batch([
      ...CHILD_TABLES.map((t) => ({ sql: `DELETE FROM ${t} WHERE user_id = ?`, args: [id] })),
      // family_links keys by inviter/invitee, not user_id — clear both directions.
      { sql: 'DELETE FROM family_links WHERE inviter_id = ? OR invitee_id = ?', args: [id, id] },
      { sql: 'DELETE FROM users WHERE id = ?', args: [id] },
    ]);
    res.json({ ok: true, deleted: target.email });
  })
);

adminRouter.post(
  '/users/:id/premium',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!(await getUser.get(id))) throw new HttpError(404, 'User not found');
    if (req.body.grant) {
      // With days (manual payments): STACK on any active window, so a monthly
      // payer's repeat grants add up. Without: legacy full-year switch.
      const days = Math.min(Math.max(Number(req.body.days) || 0, 0), 730);
      if (days) await extendPremium(id, days, 'admin');
      else await activatePremium(id, { provider: 'admin', days: 365 });
      await sendPremiumWelcome(id, { provider: 'admin' }); // "an admin upgraded you" copy
    } else {
      await deactivatePremium(id);
    }
    res.json({ ok: true });
  })
);

// The same floor sign-up and the emailed reset hold a password to.
const MIN_PASSWORD = 6;

const setPw = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const clearResets = db.prepare('DELETE FROM password_reset_codes WHERE user_id = ?');
const clearLoginGuard = db.prepare(
  'UPDATE users SET failed_logins = 0, login_otp_hash = NULL, login_otp_expires = NULL, login_otp_attempts = 0 WHERE id = ?'
);
const endSessions = db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL');
const endOtherSessions = db.prepare(
  'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND token_hash <> ?'
);

// A password someone has to read out or retype: twelve characters in three
// groups, from an alphabet with nothing that can be taken for something else
// (no 0/o, no 1/l/i). 31^12 is about 59 bits — ample for a password handed
// over once, behind a sign-in that rate-limits guesses.
const READABLE = 'abcdefghjkmnpqrstuvwxyz23456789';
function readablePassword() {
  const group = () => Array.from({ length: 4 }, () => READABLE[randomInt(READABLE.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}

// Reset a user's password, no email needed. The new password goes back to the
// admin ONCE, to pass on; only its hash is kept.
adminRouter.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const target = await getUser.get(id);
    if (!target) throw new HttpError(404, 'User not found');

    // A typed password that was too short used to be dropped without a word
    // and a random one issued in its place — the admin read back a password
    // they had not chosen. Too short is now an error, as it is everywhere else.
    const provided = String(req.body.password ?? '');
    if (provided && provided.length < MIN_PASSWORD) throw bad(`Password must be at least ${MIN_PASSWORD} characters`);
    const password = provided || readablePassword();

    await setPw.run(hashPassword(password), id);
    await clearResets.run(id);
    // Whoever is being helped has usually just failed a few sign-ins — which
    // would make their next CORRECT password demand a code by email, the one
    // thing an admin reset exists to route around. The reset settles that run,
    // exactly as the emailed reset does.
    await clearLoginGuard.run(id);

    // Optionally end what is already signed in — the point of a reset made
    // because someone else may know the old password. An admin resetting their
    // own keeps the device they are on.
    let signedOut = 0;
    if (req.body.sign_out) {
      const info =
        id === req.user.id
          ? await endOtherSessions.run(now(), id, req.sessionTokenHash || '')
          : await endSessions.run(now(), id);
      signedOut = Number(info.changes) || 0;
    }

    res.json({ ok: true, email: target.email, password, generated: !provided, signed_out: signedOut });
  })
);
