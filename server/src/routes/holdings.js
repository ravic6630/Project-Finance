import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired } from '../auth.js';
import { scopeFromReq, normalizeProfileId } from './profiles.js';
import { asyncHandler, bad, HttpError, num, oneOf, str } from '../util.js';
import { enrichHoldings } from '../services/portfolio.js';
import { assertHoldingsCapacity } from '../services/billing.js';
import { LIVE_PRICE_TTL_MS, searchMutualFunds, searchStocks } from '../services/prices.js';
import { ALL_KINDS, CURRENCIES, STOCK_MARKETS, currencyForKind, symbolForMarket } from '../markets.js';
import { todayIST } from '../services/recurring.js';

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

const TRADE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const listScoped = (scopeSql) => db.prepare(`SELECT * FROM holdings WHERE user_id = ?${scopeSql} ORDER BY kind, name`);
const getOne = db.prepare('SELECT * FROM holdings WHERE id = ? AND user_id = ?');
const insert = db.prepare(`
  INSERT INTO holdings
    (user_id, kind, symbol, scheme_code, name, quantity, avg_cost, currency, manual_price, notes, profile_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const update = db.prepare(`
  UPDATE holdings SET
    kind = ?, symbol = ?, scheme_code = ?, name = ?, quantity = ?, avg_cost = ?,
    currency = ?, manual_price = ?, notes = ?, profile_id = ?, updated_at = ?
  WHERE id = ? AND user_id = ?
`);
const remove = db.prepare('DELETE FROM holdings WHERE id = ? AND user_id = ?');

// GET /api/holdings?refresh=1 (force live fetch) | ?live=1 (short-TTL auto-poll)
holdingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await (() => { const sc = scopeFromReq(req); return listScoped(sc.sql).all(req.user.id, ...sc.args); })();
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

// Broker-import rows are recognised by their notes label; the broker prune
// keys off the same convention, so the two can never disagree about which
// rows a sync owns.
const IMPORTED_RE = /^imported/i;

// One position per instrument. Buying more of a stock you already hold should
// UPDATE that position with a weighted-average cost — the way every broker the
// user knows behaves — not quietly grow a second row for the same company.
//
// The rules, and why each line is drawn where it is:
// - Identity is kind + symbol (scheme code for funds), within the SAME profile.
//   Your AMZN and your father's AMZN are different people's money.
// - Only MANUAL rows merge. A broker-imported row is that broker's mirror: the
//   next sync overwrites its quantity with the broker's truth, so anything
//   folded into it would be silently erased. A manual lot alongside an
//   imported row is two sources, and stays two rows.
// - Pre-existing manual duplicates of the same instrument fold in too, with
//   their goal links and buy/sell lots re-pointed first — this is exactly what
//   the statement importer already does with strays.
// - The buy is appended to the position's ledger ONLY if a ledger already
//   exists. Returns/XIRR compute purely from lots, so a partial ledger would
//   report confident, wrong figures; an absent one reports nothing.
holdingsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = readBody(req.body);
    const profileId = await normalizeProfileId(req.user.id, req.body.profile_id);
    const ts = now();

    const sameKind = await db
      .prepare('SELECT * FROM holdings WHERE user_id = ? AND kind = ? ORDER BY id')
      .all(req.user.id, b.kind);
    const matches = sameKind.filter(
      (h) =>
        (b.kind === 'IN_MF'
          ? String(h.scheme_code || '') === String(b.schemeCode || '')
          : String(h.symbol || '').toUpperCase() === String(b.symbol || '').toUpperCase()) &&
        (h.profile_id ?? null) === (profileId ?? null)
    );
    const manual = matches.filter((h) => !IMPORTED_RE.test(h.notes || ''));

    if (manual.length) {
      const target = manual[0];
      const extras = manual.slice(1);

      // Weighted-average across everything being combined, raw values first —
      // summing already-rounded figures is how paise go missing.
      let qty = 0;
      let cost = 0;
      for (const r of [target, ...extras]) {
        const q = Number(r.quantity) || 0;
        qty += q;
        cost += q * (Number(r.avg_cost) || 0);
      }
      const prev = { quantity: qty, avg_cost: qty > 0 ? cost / qty : Number(target.avg_cost) || 0 };
      qty += b.quantity;
      cost += b.quantity * b.avgCost;
      const newAvg = qty > 0 ? cost / qty : b.avgCost;

      const ids = [target.id, ...extras.map((x) => x.id)];
      const ledgerCount = Number(
        (
          await db
            .prepare(
              `SELECT COUNT(*) AS n FROM investment_txns WHERE user_id = ? AND holding_id IN (${ids.map(() => '?').join(',')})`
            )
            .get(req.user.id, ...ids)
        )?.n || 0
      );

      const stmts = [];
      for (const x of extras) {
        stmts.push({
          sql: 'UPDATE investment_txns SET holding_id = ? WHERE user_id = ? AND holding_id = ?',
          args: [target.id, req.user.id, x.id],
        });
        // Goal links follow the money into the surviving row. OR IGNORE keeps
        // the (goal, holding) uniqueness when a goal linked both duplicates;
        // the DELETE clears the collided leftover.
        stmts.push({
          sql: "UPDATE OR IGNORE goal_links SET ref_id = ? WHERE user_id = ? AND kind = 'holding' AND ref_id = ?",
          args: [target.id, req.user.id, x.id],
        });
        stmts.push({
          sql: "DELETE FROM goal_links WHERE user_id = ? AND kind = 'holding' AND ref_id = ?",
          args: [req.user.id, x.id],
        });
        stmts.push({ sql: 'DELETE FROM holdings WHERE id = ? AND user_id = ?', args: [x.id, req.user.id] });
      }
      stmts.push({
        sql: 'UPDATE holdings SET quantity = ?, avg_cost = ?, manual_price = COALESCE(?, manual_price), updated_at = ? WHERE id = ? AND user_id = ?',
        args: [qty, newAvg, b.manualPrice, ts, target.id, req.user.id],
      });
      if (ledgerCount > 0 && b.quantity > 0) {
        stmts.push({
          sql: 'INSERT INTO investment_txns (user_id, holding_id, type, trade_date, quantity, price, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          args: [req.user.id, target.id, 'BUY', todayIST(), b.quantity, b.avgCost, ts],
        });
      }
      await db.batch(stmts);

      const row = await getOne.get(target.id, req.user.id);
      const { items } = await enrichHoldings([row], req.user.base_currency);
      return res.json({
        holding: items[0],
        merged: true,
        previous: { quantity: prev.quantity, avg_cost: prev.avg_cost },
        consolidated: extras.length,
        ledger_recorded: ledgerCount > 0 && b.quantity > 0,
      });
    }

    await assertHoldingsCapacity(req.user, 1); // free plan caps tracked holdings
    const info = await insert.run(
      req.user.id, b.kind, b.symbol, b.schemeCode, b.name, b.quantity,
      b.avgCost, b.currency, b.manualPrice, b.notes, profileId, ts, ts
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
      b.currency, b.manualPrice, b.notes,
      req.body.profile_id === undefined
        ? existing.profile_id
        : await normalizeProfileId(req.user.id, req.body.profile_id),
      now(), req.params.id, req.user.id
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
    // A malformed date silently breaks FIFO lot matching and the short/long-term
    // split in capital gains, and can push XIRR to absurd values — reject early,
    // matching the sibling transaction/recurring routes.
    const tradeDate = str(req.body.trade_date);
    if (!tradeDate || !TRADE_DATE_RE.test(tradeDate) || Number.isNaN(Date.parse(tradeDate))) {
      throw bad('trade_date must be a real date in YYYY-MM-DD form');
    }
    const quantity = num(req.body.quantity ?? 0, 'quantity');
    const price = num(req.body.price ?? 0, 'price');
    if (quantity <= 0) throw bad('quantity must be greater than 0');
    // Zero stays legal (bonus/gift lots); negative corrupts avg cost and gains.
    if (price < 0) throw bad('price cannot be negative');

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
