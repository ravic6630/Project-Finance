import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired, requirePremium } from '../auth.js';
import { asyncHandler, bad, HttpError, num, oneOf, str } from '../util.js';

export const alertsRouter = Router();
alertsRouter.use(authRequired);
alertsRouter.use(requirePremium); // Price alerts are a premium feature.

const KINDS = ['IN_STOCK', 'US_STOCK', 'IN_MF'];

function readBody(body) {
  const kind = body.kind ? oneOf(String(body.kind).toUpperCase(), KINDS, 'kind') : 'IN_STOCK';
  const label = str(body.label) || str(body.symbol) || str(body.scheme_code);
  if (!label) throw bad('A label or symbol is required');
  const threshold = num(body.threshold ?? 0, 'threshold');
  if (threshold <= 0) throw bad('Target price must be greater than 0');

  let symbol = null;
  let schemeCode = null;
  if (kind === 'IN_MF') {
    schemeCode = str(body.scheme_code);
    if (!schemeCode) throw bad('scheme_code is required for a mutual fund alert');
  } else {
    symbol = str(body.symbol);
    if (!symbol) throw bad('symbol is required for a stock alert');
    symbol = symbol.toUpperCase();
    if (kind === 'IN_STOCK' && !symbol.includes('.')) symbol += '.NS';
  }
  return {
    kind,
    symbol,
    schemeCode,
    label,
    direction: oneOf(String(body.direction || 'above').toLowerCase(), ['above', 'below'], 'direction'),
    threshold,
    currency: body.currency ? oneOf(String(body.currency).toUpperCase(), ['INR', 'USD'], 'currency') : 'INR',
    active: body.active === false || body.active === 0 ? 0 : 1,
  };
}

const list = db.prepare('SELECT * FROM alerts WHERE user_id = ? ORDER BY active DESC, id DESC');
const getOne = db.prepare('SELECT * FROM alerts WHERE id = ? AND user_id = ?');
const insert = db.prepare(`
  INSERT INTO alerts
    (user_id, kind, symbol, scheme_code, label, direction, threshold, currency, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const update = db.prepare(`
  UPDATE alerts SET
    kind = ?, symbol = ?, scheme_code = ?, label = ?, direction = ?, threshold = ?,
    currency = ?, active = ?, updated_at = ?
  WHERE id = ? AND user_id = ?
`);
const remove = db.prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?');

alertsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ alerts: await list.all(req.user.id) });
  })
);

alertsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = readBody(req.body);
    const ts = now();
    const info = await insert.run(
      req.user.id, b.kind, b.symbol, b.schemeCode, b.label, b.direction,
      b.threshold, b.currency, b.active, ts, ts
    );
    res.status(201).json({ alert: await getOne.get(Number(info.lastInsertRowid), req.user.id) });
  })
);

alertsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await getOne.get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'Alert not found');
    const b = readBody({ ...existing, ...req.body });
    await update.run(
      b.kind, b.symbol, b.schemeCode, b.label, b.direction, b.threshold,
      b.currency, b.active, now(), req.params.id, req.user.id
    );
    res.json({ alert: await getOne.get(req.params.id, req.user.id) });
  })
);

alertsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const info = await remove.run(req.params.id, req.user.id);
    if (!info.changes) throw new HttpError(404, 'Alert not found');
    res.json({ ok: true });
  })
);
