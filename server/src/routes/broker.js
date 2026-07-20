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
  demoMfHoldings,
  exchangeToken,
  fetchHoldings,
  fetchMfHoldings,
  isBroker,
  loginUrl,
  redirectUri,
} from '../services/brokers.js';
import { dedupSets, normalizeStockSymbol, resolveName } from '../services/importer.js';
import { lookupFundByIsin, schemeNameForCode, searchMutualFunds, warmMfList } from '../services/prices.js';

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

// Resolve one broker fund to its AMFI scheme code — exact ISIN match first (the
// broker gives us an ISIN), then a name search — so live NAV pricing works after
// import. Funds we can't match are shown but not importable (use CAS instead).
async function buildMfItem(m, have) {
  // ISIN lookup is persisted per fund, so a repeat import resolves with no
  // network at all. Falls back to a name search only when the ISIN is unknown.
  const byIsin = m.isin ? await lookupFundByIsin(m.isin) : null;
  let schemeCode = byIsin?.schemeCode || null;
  if (!schemeCode && m.schemeName) {
    const matches = await searchMutualFunds(m.schemeName).catch(() => []);
    schemeCode = matches[0]?.schemeCode || null;
  }
  // Prefer the canonical name we already hold — resolveName would otherwise fetch
  // each fund's NAV just to read its name, the slowest part of a first import.
  const name =
    byIsin?.schemeName ||
    (schemeCode && (await schemeNameForCode(schemeCode))) ||
    (await resolveName('IN_MF', { schemeCode: schemeCode || '' }, m.schemeName));
  return {
    kind: 'IN_MF',
    scheme_code: schemeCode || '',
    name,
    quantity: m.units || 0,
    avg_cost: m.avgCost || 0,
    currency: 'INR',
    isin: m.isin || null,
    folio: m.folio || null,
    duplicate: schemeCode ? have.mf.has(String(schemeCode)) : false,
    importable: !!schemeCode,
  };
}

// Map broker holdings (equity + optional funds) → the shared import-preview item
// shape, flagging duplicates against what the user already holds.
async function buildPreview(broker, name, holdings, userId, mfs = []) {
  const have = await dedupSets(userId);
  const stockItems = holdings.map((h) => ({
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
  const mfItems = await Promise.all((mfs || []).map((m) => buildMfItem(m, have)));
  const items = [...stockItems, ...mfItems];
  return {
    broker,
    broker_label: BROKER_LABELS[broker],
    name: name || null,
    items,
    summary: {
      stocks: stockItems.length,
      ...(mfItems.length ? { mutualFunds: mfItems.length } : {}),
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
    // The user is about to spend a while logging in at the broker. Use that time
    // to pull the AMFI scheme list in the background so the import that follows
    // doesn't have to wait for it.
    warmMfList();
    res.json({ url: loginUrl(broker), redirect_uri: redirectUri(broker) });
  })
);

// Complete the login: exchange the callback param (or use demo data) → holdings preview.
brokerRouter.post(
  '/:broker/connect',
  asyncHandler(async (req, res) => {
    const broker = requireBroker(req);

    if (req.body.demo) {
      return res.json(
        await buildPreview(broker, 'Sample User', demoHoldings(broker), req.user.id, demoMfHoldings(broker))
      );
    }

    // Live broker connect is premium-only (sample/demo above stays free).
    if (!(await premiumState(req.user)).premium) {
      throw new HttpError(402, 'Connecting a broker is a premium feature. Upgrade to Sampada Premium.');
    }
    if (!brokerConfigured(broker)) {
      return res.status(503).json({ error: `${BROKER_LABELS[broker]} isn't set up on this server.` });
    }
    const { request_token, code, auth_token, auth_code } = req.body;
    if (!request_token && !code && !auth_token && !auth_code) {
      throw bad('Missing login token from broker callback');
    }

    const { accessToken, name } = await exchangeToken(broker, { request_token, code, auth_token, auth_code });
    await saveToken.run(req.user.id, broker, accessToken, JSON.stringify({ name }), now());
    const [holdings, mfs] = await Promise.all([
      fetchHoldings(broker, accessToken),
      fetchMfHoldings(broker, accessToken),
    ]);
    res.json(await buildPreview(broker, name, holdings, req.user.id, mfs));
  })
);
