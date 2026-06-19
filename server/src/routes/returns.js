import { Router } from 'express';
import { db } from '../db.js';
import { authRequired, requirePremium } from '../auth.js';
import { asyncHandler } from '../util.js';
import { getFxRate, getPrice } from '../services/prices.js';
import { computeReturns, xirr } from '../services/returns.js';

export const returnsRouter = Router();
returnsRouter.use(authRequired);
returnsRouter.use(requirePremium); // Returns & tax is a premium feature.

const listHoldings = db.prepare('SELECT * FROM holdings WHERE user_id = ? ORDER BY kind, name');
const listTxns = db.prepare('SELECT * FROM investment_txns WHERE holding_id = ? ORDER BY trade_date, id');

returnsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const base = req.user.base_currency;
    const today = new Date().toISOString().slice(0, 10);
    const holdings = await listHoldings.all(req.user.id);

    const fx = {};
    const rate = async (c) => {
      const cur = c || base;
      if (fx[cur] == null) fx[cur] = await getFxRate(cur, base);
      return fx[cur];
    };

    const rows = [];
    const portfolioFlows = [];
    const agg = {
      invested: 0,
      market_value: 0,
      realized: { short: 0, long: 0, total: 0 },
      unrealized: { short: 0, long: 0, total: 0 },
    };

    for (const h of holdings) {
      const txns = await listTxns.all(h.id);
      let price = null;
      if (h.manual_price != null) price = h.manual_price;
      else {
        const p = await getPrice(h);
        price = p?.price ?? null;
      }
      const r = computeReturns(txns, price, today);
      const fxr = await rate(h.currency);

      agg.invested += r.invested * fxr;
      agg.market_value += r.market_value * fxr;
      for (const k of ['short', 'long', 'total']) {
        agg.realized[k] += r.realized[k] * fxr;
        agg.unrealized[k] += r.unrealized[k] * fxr;
      }
      for (const f of r.flows) portfolioFlows.push({ date: f.date, amount: f.amount * fxr });

      rows.push({
        id: h.id,
        name: h.name,
        kind: h.kind,
        currency: h.currency,
        txn_count: txns.length,
        xirr: r.xirr,
        invested: r.invested,
        market_value: r.market_value,
        realized: r.realized,
        unrealized: r.unrealized,
      });
    }

    res.json({
      base_currency: base,
      long_term_months: 12,
      portfolio: {
        xirr: xirr(portfolioFlows),
        invested: agg.invested,
        market_value: agg.market_value,
        realized: agg.realized,
        unrealized: agg.unrealized,
      },
      holdings: rows,
    });
  })
);
