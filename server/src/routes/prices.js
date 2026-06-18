import { Router } from 'express';
import { db } from '../db.js';
import { authRequired } from '../auth.js';
import { asyncHandler } from '../util.js';
import { getFxRate, refreshUserPrices } from '../services/prices.js';

export const pricesRouter = Router();
pricesRouter.use(authRequired);

// POST /api/prices/refresh — force-refresh live prices for this user's holdings.
pricesRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const holdings = await db.prepare('SELECT * FROM holdings WHERE user_id = ?').all(req.user.id);
    const result = await refreshUserPrices(holdings, { force: true });
    res.json(result);
  })
);

// GET /api/prices/fx?base=USD&quote=INR
pricesRouter.get(
  '/fx',
  asyncHandler(async (req, res) => {
    const base = String(req.query.base || 'USD').toUpperCase();
    const quote = String(req.query.quote || 'INR').toUpperCase();
    res.json({ base, quote, rate: await getFxRate(base, quote) });
  })
);
