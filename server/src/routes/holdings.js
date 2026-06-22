import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired } from '../auth.js';
import { asyncHandler, bad, HttpError, num, oneOf, str } from '../util.js';
import { enrichHoldings } from '../services/portfolio.js';
import { LIVE_PRICE_TTL_MS, searchMutualFunds, searchStocks } from '../services/prices.js';
import { ALL_KINDS, CURRENCIES, STOCK_MARKETS, currencyForKind, symbolForMarket } from '../markets.js';

export const holdingsRouter = Router();
holdingsRouter.use(authRequired);

const KINDS = ALL_KINDS;
const normalizeSymbol = symbolForMarket;

function readBody(body) {
  const kind = oneOf(body.kind, KINDS, 'kind');
  const name = str(body.name);
  if (!name) throw bad('name is required');
  const currency = body.currency
    ? oneOf(String(body.currency).toUpperCase(), CURRENCIES, 'currency')
    : currencyForKind(kind);

  let symbol = null;
  let schemeCode = null;
  if (kind === 'IN_MF') {
    schemeCode = str(body.scheme_code);
    if (!schemeCode) throw bad('scheme_code is required for mutual funds');
  } else {
    symbol = normalizeSymbol(kind, body.symbol);
    if (!symbol) throw bad('symbol is required for stocks');
  }

  return {
    kind,
    name,
    currency,
    symbol,
    schemeCode,
    quantity: num(body.quantity ?? 0, 'quantity'),
    avgCost: num(body.avg_cost ?? 0, 'avg_cost'),
    manualPrice:
      body.manual_price === '' || body.manual_price == null
        ? null
        : num(body.manual_price, 'manual_price'),
    notes: str(body.notes),
  };
}

const listForUser = db.prepare('SELECT * FROM holdings WHERE user_id = ? ORDER BY kind, name');
const getOne = db.prepare('SELECT * FROM holdings WHERE id = ? AND user_id = ?');
const insert = db.prepare(`
  INSERT INTO holdings
    (user_id, kind, symbol, scheme_code, name, quantity, avg_cost, currency, manual_price, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const update = db.prepare(`
  UPDATE holdings SET
    kind = ?, symbol = ?, scheme_code = ?, name = ?, quantity = ?, avg_cost = ?,
    currency = ?, manual_price = ?, notes = ?, updated_at = ?
  WHERE id = ? AND user_id = ?
`);
const remove = db.prepare('DELETE FROM holdings WHERE id = ? AND user_id = ?');

// GET /api/holdings?refresh=1 (force live fetch) | ?live=1 (short-TTL auto-poll)
holdingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await listForUser.all(req.user.id);
    const { items, rates } = await enrichHoldings(rows, req.user.base_currency, {
      force: req.query.refresh === '1',
      ttl: req.query.live === '1' ? LIVE_PRICE_TTL_MS : undefined,
    });
    res.json({ holdings: items, base_currency: req.user.base_currency, rates });
  })
);

// GET /api/holdings/mf-search?q=axis
holdingsRouter.get(
  '/mf-search',
  asyncHandler(async (req, res) => {
    res.json({ results: await searchMutualFunds(req.query.q) });
  })
);

// GET /api/holdings/stock-search?q=amzn&kind=UK_STOCK
holdingsRouter.get(
  '/stock-search',
  asyncHandler(async (req, res) => {
    const kind = STOCK_MARKETS[req.query.kind] ? req.query.kind : 'IN_STOCK';
    res.json({ results: await searchStocks(req.query.q, kind) });
  })
);

holdingsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = readBody(req.body);
    const ts = now();
    const info = await insert.run(
      req.user.id, b.kind, b.symbol, b.schemeCode, b.name, b.quantity,
      b.avgCost, b.currency, b.manualPrice, b.notes, ts, ts
    );
    const row = await getOne.get(Number(info.lastInsertRowid), req.user.id);
    const { items } = await enrichHoldings([row], req.user.base_currency);
    res.status(201).json({ holding: items[0] });
  })
);

holdingsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await getOne.get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'Holding not found');
    const b = readBody({ ...existing, ...req.body });
    await update.run(
      b.kind, b.symbol, b.schemeCode, b.name, b.quantity, b.avgCost,
      b.currency, b.manualPrice, b.notes, now(), req.params.id, req.user.id
    );
    const row = await getOne.get(req.params.id, req.user.id);
    const { items } = await enrichHoldings([row], req.user.base_currency);
    res.json({ holding: items[0] });
  })
);

holdingsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const info = await remove.run(req.params.id, req.user.id);
    if (!info.changes) throw new HttpError(404, 'Holding not found');
    res.json({ ok: true });
  })
);

// --- Investment transaction ledger (buy/sell) — powers returns & capital gains ---
const txnList = db.prepare(
  'SELECT * FROM investment_txns WHERE holding_id = ? AND user_id = ? ORDER BY trade_date, id'
);
const txnInsert = db.prepare(`
  INSERT INTO investment_txns (user_id, holding_id, type, trade_date, quantity, price, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const txnRemove = db.prepare('DELETE FROM investment_txns WHERE id = ? AND user_id = ?');
const txnGet = db.prepare('SELECT * FROM investment_txns WHERE id = ? AND user_id = ?');
// Keep the holding's live position in sync with its buy/sell ledger.
const setHoldingPosition = db.prepare(
  'UPDATE holdings SET quantity = ?, avg_cost = ?, updated_at = ? WHERE id = ? AND user_id = ?'
);

holdingsRouter.get(
  '/:id/txns',
  asyncHandler(async (req, res) => {
    const h = await getOne.get(req.params.id, req.user.id);
    if (!h) throw new HttpError(404, 'Holding not found');
    res.json({ txns: await txnList.all(req.params.id, req.user.id) });
  })
);

holdingsRouter.post(
  '/:id/txns',
  asyncHandler(async (req, res) => {
    const h = await getOne.get(req.params.id, req.user.id);
    if (!h) throw new HttpError(404, 'Holding not found');
    const type = oneOf(String(req.body.type || 'BUY').toUpperCase(), ['BUY', 'SELL'], 'type');
    const tradeDate = str(req.body.trade_date);
    if (!tradeDate) throw bad('trade_date is required');
    const quantity = num(req.body.quantity ?? 0, 'quantity');
    const price = num(req.body.price ?? 0, 'price');
    if (quantity <= 0) throw bad('quantity must be greater than 0');

    // Apply the trade to the holding's position so it shows on the Investments
    // tab too. BUY raises quantity (weighted-average cost); SELL lowers it.
    const curQty = Number(h.quantity) || 0;
    const curAvg = Number(h.avg_cost) || 0;
    let newQty;
    let newAvg = curAvg;
    if (type === 'BUY') {
      newQty = curQty + quantity;
      newAvg = newQty > 0 ? (curQty * curAvg + quantity * price) / newQty : price;
    } else {
      if (quantity > curQty) throw bad(`You only hold ${curQty} of ${h.name} — can't sell ${quantity}.`);
      newQty = curQty - quantity;
    }

    const ts = now();
    await txnInsert.run(req.user.id, Number(req.params.id), type, tradeDate, quantity, price, ts);
    await setHoldingPosition.run(newQty, newAvg, ts, Number(req.params.id), req.user.id);
    res.status(201).json({ txns: await txnList.all(req.params.id, req.user.id) });
  })
);

holdingsRouter.delete(
  '/:id/txns/:txnId',
  asyncHandler(async (req, res) => {
    const h = await getOne.get(req.params.id, req.user.id);
    if (!h) throw new HttpError(404, 'Holding not found');
    const t = await txnGet.get(req.params.txnId, req.user.id);
    if (!t || Number(t.holding_id) !== Number(req.params.id)) throw new HttpError(404, 'Transaction not found');
    // Reverse this trade's effect on the position (avg cost left as-is).
    const curQty = Number(h.quantity) || 0;
    const q = Number(t.quantity) || 0;
    const newQty = t.type === 'BUY' ? Math.max(0, curQty - q) : curQty + q;
    await setHoldingPosition.run(newQty, Number(h.avg_cost) || 0, now(), Number(req.params.id), req.user.id);
    await txnRemove.run(req.params.txnId, req.user.id);
    res.json({ ok: true });
  })
);
