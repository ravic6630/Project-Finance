import { Router } from 'express';
import { authRequired } from '../auth.js';
import { asyncHandler } from '../util.js';
import { buildSummary } from '../services/summary.js';

export const dashboardRouter = Router();
dashboardRouter.use(authRequired);

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await buildSummary(req.user, { refresh: req.query.refresh === '1' }));
  })
);
