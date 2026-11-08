import { Router } from 'express';
import { authRequired } from '../auth.js';
import { asyncHandler } from '../util.js';
import { buildHealth } from '../services/health.js';

// Not /api/health — that path is the uptime check Render and cron-job.org hit,
// and it must stay unauthenticated and instant.
export const financialHealthRouter = Router();
financialHealthRouter.use(authRequired);

// Free for everyone: knowing where you stand is the reason to keep records at
// all, and the readings only use data the user has already entered.
financialHealthRouter.get(
  '/',
  asyncHandler(async (req, res) => res.json(await buildHealth(req.user)))
);
