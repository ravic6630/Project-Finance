import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired, requirePremium } from '../auth.js';
import { asyncHandler, bad, HttpError } from '../util.js';
import { premiumState } from '../services/billing.js';
import {
  BROKER_LABELS,
  brokerConfigured,
  brokerStatus,
  demoHoldings,
  exchangeToken,
  fetchHoldings,
  isBroker,
  loginUrl,
  redirectUri,
} from '../services/brokers.js';
import { dedupSets, normalizeStockSymbol } from '../services/importer.js';

export const brokerRouter = Router();
brokerRouter.use(authRequired);

const saveToken = db.prepare(`
  INSERT INTO broker_connections (user_id, broker, access_token, meta, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id, broker) DO UPDATE SET
    access_token = excluded.access_token, meta = excluded.meta, updated_at = excluded.updated_at
`);
const listConns = db.prepare('SELECT broker, updated_at FROM broker_connections WHERE user_id = ?');

function requireBroker(req) {
  const b = req.params.broker;
  if (!isBroker(b)) throw new HttpError(404, 'Unknown broker');
  return b;
}

// Map broker holdings → the shared import-preview item shape, flagging duplicates.
async function buildPreview(broker, name, holdings, userId) {
  const have = await dedupSets(userId);
  const items = holdings.map((h) => ({
    kind: 'IN_STOCK',
    symbol: h.symbol,
    name: h.name || h.symbol,
    exchange: h.exchange || 'NSE',
    quantity: h.quantity || 0,
    avg_cost: h.avgCost || 0,
    currency: 'INR',
    isin: h.isin || null,
    duplicate: have.sym.has(normalizeStockSymbol('IN_STOCK', h.symbol, h.exchange) || ''),
    importable: true,
  }));
  return {
    broker,
    broker_label: BROKER_LABELS[broker],
    name: name || null,
    items,
    summary: {
      stocks: items.length,
      duplicates: items.filter((i) => i.duplicate).length,
    },
  };
}

brokerRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const rows = await listConns.all(req.user.id);
    const connected = Object.fromEntries(rows.map((c) => [c.broker, c.updated_at]));
    res.json({ configured: brokerStatus(), connected });
  })
);

brokerRouter.get(
  '/:broker/login-url',
  requirePremium,
  asyncHandler(async (req, res) => {
    const broker = requireBroker(req);
    if (!brokerConfigured(broker)) {
      return res.status(503).json({
        error: `${BROKER_LABELS[broker]} isn't set up yet. Add ${broker.toUpperCase()}_API_KEY and _API_SECRET to server/.env, and set the broker app's redirect URL to ${redirectUri(broker)}.`,
      });
    }
    res.json({ url: loginUrl(broker), redirect_uri: redirectUri(broker) });
  })
);

// Complete the login: exchange the callback param (or use demo data) → holdings preview.
brokerRouter.post(
  '/:broker/connect',
  asyncHandler(async (req, res) => {
    const broker = requireBroker(req);

    if (req.body.demo) {
      return res.json(await buildPreview(broker, 'Sample User', demoHoldings(broker), req.user.id));
    }

    // Live broker connect is premium-only (sample/demo above stays free).
    if (!(await premiumState(req.user)).premium) {
      throw new HttpError(402, 'Connecting a broker is a premium feature. Upgrade to Sampada Premium.');
    }
    if (!brokerConfigured(broker)) {
      return res.status(503).json({ error: `${BROKER_LABELS[broker]} isn't set up on this server.` });
    }
    const { request_token, code } = req.body;
    if (!request_token && !code) throw bad('Missing login token from broker callback');

    const { accessToken, name } = await exchangeToken(broker, { request_token, code });
    await saveToken.run(req.user.id, broker, accessToken, JSON.stringify({ name }), now());
    const holdings = await fetchHoldings(broker, accessToken);
    res.json(await buildPreview(broker, name, holdings, req.user.id));
  })
);
