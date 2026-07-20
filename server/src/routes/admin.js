import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { db } from '../db.js';
import { applyEffectiveRole, authRequired, hashPassword, requireAdmin } from '../auth.js';
import { asyncHandler, HttpError } from '../util.js';
import { activatePremium, deactivatePremium, premiumState } from '../services/billing.js';
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
  'holdings', 'cash_accounts', 'transactions', 'goals', 'alerts',
  'net_worth_snapshots', 'investment_txns', 'subscriptions',
  'broker_connections', 'email_prefs', 'password_resets', 'password_reset_codes',
  'support_messages',
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
      await activatePremium(id, { provider: 'admin', days: 365 });
      await sendPremiumWelcome(id, { provider: 'admin' }); // "an admin upgraded you" copy
    } else {
      await deactivatePremium(id);
    }
    res.json({ ok: true });
  })
);

const setPw = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const clearResets = db.prepare('DELETE FROM password_reset_codes WHERE user_id = ?');
// Reset a user's password (no email needed) — returns a temp password to share.
adminRouter.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const target = await getUser.get(id);
    if (!target) throw new HttpError(404, 'User not found');
    const provided = String(req.body.password || '');
    const password = provided.length >= 6 ? provided : randomBytes(9).toString('base64url');
    await setPw.run(hashPassword(password), id);
    await clearResets.run(id);
    res.json({ ok: true, email: target.email, password });
  })
);
