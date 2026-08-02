import { Router } from 'express';
import { authRequired } from '../auth.js';
import { asyncHandler } from '../util.js';
import { buildSummary } from '../services/summary.js';
import { premiumState } from '../services/billing.js';
import { recordSnapshot, getHistory } from '../services/networth.js';
import { materializeRecurring } from '../services/recurring.js';
import { buildFamilySummary, buildMemberView, linkedMembers, mergeHistorySeries } from '../services/family.js';

export const dashboardRouter = Router();
dashboardRouter.use(authRequired);

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    await materializeRecurring(req.user.id).catch(() => {});
    const raw = String(req.query.profile || 'all');
    const refresh = req.query.refresh === '1';
    const base = req.user.base_currency;
    const premium = (await premiumState(req.user)).premium;
    let summary;

    if (raw === 'me' || (Number.isInteger(Number(raw)) && Number(raw) > 0)) {
      // My own money, or one managed profile — unchanged behavior.
      const scope = raw === 'me' ? 'me' : Number(raw);
      summary = await buildSummary(req.user, { refresh, scope });
      summary.net_worth_history = premium ? await getHistory(req.user.id, base) : null;
    } else if (/^u:\d+$/.test(raw)) {
      // A linked member's account, read-only. 404s the moment a link is severed.
      const memberId = Number(raw.slice(2));
      summary = await buildMemberView(req.user, memberId, { refresh });
      summary.net_worth_history = premium ? await getHistory(memberId, base) : null;
    } else {
      // Everyone: my whole account, plus each linked member's.
      const own = await buildSummary(req.user, { refresh, scope: null });
      // Record today's net worth for everyone, so history accrues even on the
      // free plan. Always MY OWN total — linked members record their own when
      // they visit, and the family chart sums the series at read time.
      await recordSnapshot(req.user.id, own.net_worth, base);
      const members = await linkedMembers(req.user.id);
      summary = members.length ? await buildFamilySummary(req.user, own, members, { refresh }) : own;
      if (premium) {
        const series = [await getHistory(req.user.id, base)];
        for (const m of members) series.push(await getHistory(m.id, base));
        summary.net_worth_history = mergeHistorySeries(series);
      } else {
        summary.net_worth_history = null;
      }
    }

    summary.premium = premium;
    res.json(summary);
  })
);
