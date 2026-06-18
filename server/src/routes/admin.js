import { Router } from 'express';
import { db } from '../db.js';
import { applyEffectiveRole, authRequired, requireAdmin } from '../auth.js';
import { asyncHandler, HttpError } from '../util.js';
import { activatePremium, deactivatePremium, premiumState } from '../services/billing.js';

export const adminRouter = Router();
adminRouter.use(authRequired, requireAdmin);

// All users with per-user counts (holdings / accounts / transactions).
const listUsers = db.prepare(`
  SELECT u.id, u.email, u.name, u.role, u.base_currency, u.created_at,
    (SELECT COUNT(*) FROM holdings h WHERE h.user_id = u.id)      AS holdings,
    (SELECT COUNT(*) FROM cash_accounts c WHERE c.user_id = u.id) AS accounts,
    (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id)  AS transactions,
    (SELECT daily FROM email_prefs e WHERE e.user_id = u.id)      AS daily_email
  FROM users u ORDER BY u.created_at DESC
`);
const getUser = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?');
const delUser = db.prepare('DELETE FROM users WHERE id = ?');

adminRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const users = listUsers.all().map((u) => {
      applyEffectiveRole(u); // reflect ADMIN_EMAILS in the listed role
      const st = premiumState(u);
      return { ...u, daily_email: !!u.daily_email, premium: st.premium, plan: st.plan };
    });
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

adminRouter.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw new HttpError(400, "You can't delete your own admin account here.");
    const target = getUser.get(id);
    if (!target) throw new HttpError(404, 'User not found');
    delUser.run(id); // cascades to holdings/cash/transactions/subscriptions/etc.
    res.json({ ok: true, deleted: target.email });
  })
);

adminRouter.post(
  '/users/:id/premium',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!getUser.get(id)) throw new HttpError(404, 'User not found');
    if (req.body.grant) activatePremium(id, { provider: 'admin', days: 365 });
    else deactivatePremium(id);
    res.json({ ok: true });
  })
);
