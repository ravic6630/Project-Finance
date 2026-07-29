import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired } from '../auth.js';
import { asyncHandler, bad, HttpError, num, oneOf, str } from '../util.js';
import { getFxRate } from '../services/prices.js';
import { CURRENCIES } from '../markets.js';

export const assetsRouter = Router();
assetsRouter.use(authRequired);

const TYPES = ['PROPERTY', 'LAND', 'BUSINESS', 'VEHICLE', 'GOLD', 'OTHER'];

function readBody(body) {
  const name = str(body.name);
  if (!name) throw bad('name is required');
  return {
    name,
    type: body.type ? oneOf(String(body.type).toUpperCase(), TYPES, 'type') : 'PROPERTY',
    value: num(body.value ?? 0, 'value'),
    currency: body.currency ? oneOf(String(body.currency).toUpperCase(), CURRENCIES, 'currency') : 'INR',
    notes: str(body.notes),
  };
}

const list = db.prepare('SELECT * FROM assets WHERE user_id = ? ORDER BY value DESC, name');
const getOne = db.prepare('SELECT * FROM assets WHERE id = ? AND user_id = ?');
const insert = db.prepare(`
  INSERT INTO assets (user_id, name, type, value, currency, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const update = db.prepare(`
  UPDATE assets SET name = ?, type = ?, value = ?, currency = ?, notes = ?, updated_at = ?
  WHERE id = ? AND user_id = ?
`);
const remove = db.prepare('DELETE FROM assets WHERE id = ? AND user_id = ?');

// Assets are stored in whatever currency you entered, but shown in your base
// currency (like the dashboard). Convert each one, one FX lookup per currency.
assetsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const base = req.user.base_currency;
    const rows = await list.all(req.user.id);
    const rates = {};
    for (const a of rows) {
      if (rates[a.currency] == null) rates[a.currency] = await getFxRate(a.currency, base);
    }
    const assets = rows.map((a) => ({ ...a, value_base: a.value * (rates[a.currency] ?? 1) }));
    const total_base = assets.reduce((s, a) => s + a.value_base, 0);
    res.json({ assets, base_currency: base, total_base });
  })
);

assetsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = readBody(req.body);
    const ts = now();
    const info = await insert.run(req.user.id, b.name, b.type, b.value, b.currency, b.notes, ts, ts);
    res.status(201).json({ asset: await getOne.get(Number(info.lastInsertRowid), req.user.id) });
  })
);

assetsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await getOne.get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'Asset not found');
    const b = readBody({ ...existing, ...req.body });
    await update.run(b.name, b.type, b.value, b.currency, b.notes, now(), req.params.id, req.user.id);
    res.json({ asset: await getOne.get(req.params.id, req.user.id) });
  })
);

assetsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const info = await remove.run(req.params.id, req.user.id);
    if (!info.changes) throw new HttpError(404, 'Asset not found');
    res.json({ ok: true });
  })
);
