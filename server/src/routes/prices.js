import { Router } from 'express';
import { db } from '../db.js';
import { authRequired } from '../auth.js';
import { asyncHandler } from '../util.js';
import { BENCHMARKS, getBenchmarkSeries, getFxRate, refreshUserPrices } from '../services/prices.js';

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

// GET /api/prices/benchmark?index=nifty50&from=<ms>&to=<ms>
// Daily closes for a whitelisted index, for the net-worth comparison overlay.
pricesRouter.get(
  '/benchmark',
  asyncHandler(async (req, res) => {
    const key = String(req.query.index || '');
    if (!BENCHMARKS[key]) {
      return res.status(400).json({ error: 'Unknown benchmark index', allowed: Object.keys(BENCHMARKS) });
    }
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
      return res.status(400).json({ error: 'from/to must be millisecond timestamps with from < to' });
    }
    try {
      res.json(await getBenchmarkSeries(key, from, to));
    } catch {
      // Benchmarks are decorative — a feed hiccup should degrade, not error.
      res.json({ key, label: BENCHMARKS[key].label, symbol: BENCHMARKS[key].symbol, points: [] });
    }
  })
);

