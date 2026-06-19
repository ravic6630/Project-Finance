import { Router } from 'express';
import { authRequired } from '../auth.js';
import { asyncHandler } from '../util.js';
import { buildSummary } from '../services/summary.js';
import { premiumState } from '../services/billing.js';
import { recordSnapshot, getHistory } from '../services/networth.js';

export const dashboardRouter = Router();
dashboardRouter.use(authRequired);

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const summary = await buildSummary(req.user, { refresh: req.query.refresh === '1' });

    // Record today's net worth for everyone, so history accrues even on the
    // free plan (it's already there if they upgrade) ...
    await recordSnapshot(req.user.id, summary.net_worth, req.user.base_currency);

    // ... but the trend chart itself is a premium feature.
    const premium = (await premiumState(req.user)).premium;
    summary.premium = premium;
    summary.net_worth_history = premium ? await getHistory(req.user.id) : null;

    res.json(summary);
  })
);
