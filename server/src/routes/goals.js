import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired, requirePremium } from '../auth.js';
import { asyncHandler, bad, HttpError, num, oneOf, str } from '../util.js';
import { projectGoal } from '../services/goals.js';
import { getFxRate } from '../services/prices.js';
import { CURRENCIES } from '../markets.js';

export const goalsRouter = Router();
goalsRouter.use(authRequired);
goalsRouter.use(requirePremium); // Goals & projections is a premium feature.

const TYPES = ['RETIREMENT', 'HOUSE', 'EDUCATION', 'CAR', 'TRAVEL', 'EMERGENCY', 'WEALTH', 'CUSTOM'];

function readBody(body, defaultCurrency = 'INR') {
  const name = str(body.name);
  if (!name) throw bad('Goal name is required');
  const targetAmount = num(body.target_amount ?? 0, 'target_amount');
  if (targetAmount <= 0) throw bad('Target amount must be greater than 0');
  return {
    name,
    type: body.type ? oneOf(String(body.type).toUpperCase(), TYPES, 'type') : 'CUSTOM',
    targetAmount,
    targetDate: str(body.target_date) || null,
    currentAmount: num(body.current_amount ?? 0, 'current_amount'),
    monthly: num(body.monthly_contribution ?? 0, 'monthly_contribution'),
    expectedReturn: num(body.expected_return ?? 12, 'expected_return'),
    currency: body.currency ? oneOf(String(body.currency).toUpperCase(), CURRENCIES, 'currency') : defaultCurrency,
  };
}

const list = db.prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY target_date IS NULL, target_date, id');
const getOne = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?');
const insert = db.prepare(`
  INSERT INTO goals
    (user_id, name, type, target_amount, target_date, current_amount, monthly_contribution, expected_return, currency, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const update = db.prepare(`
  UPDATE goals SET
    name = ?, type = ?, target_amount = ?, target_date = ?, current_amount = ?,
    monthly_contribution = ?, expected_return = ?, currency = ?, updated_at = ?
  WHERE id = ? AND user_id = ?
`);
const remove = db.prepare('DELETE FROM goals WHERE id = ? AND user_id = ?');

// Goals are stored in their own currency but shown in the user's base currency
// (same as holdings). Convert the amounts, then project on the converted figures
// so "projected" and "required monthly" come out in base currency too. The native
// fields are left untouched so the edit form still shows the goal's own currency.
async function ratesFor(goals, base) {
  const rates = {};
  await Promise.all(
    [...new Set([base, ...goals.map((g) => g.currency || 'INR')])].map(async (c) => {
      rates[c] = await getFxRate(c, base);
    })
  );
  return rates;
}

function withProjection(g, base, rates) {
  const rate = rates[g.currency || 'INR'] ?? 1;
  const target_amount_base = (Number(g.target_amount) || 0) * rate;
  const current_amount_base = (Number(g.current_amount) || 0) * rate;
  const monthly_contribution_base = (Number(g.monthly_contribution) || 0) * rate;
  const projection = projectGoal({
    ...g,
    target_amount: target_amount_base,
    current_amount: current_amount_base,
    monthly_contribution: monthly_contribution_base,
  });
  return { ...g, base_currency: base, target_amount_base, current_amount_base, monthly_contribution_base, projection };
}

const oneWithProjection = async (g, base) => withProjection(g, base, await ratesFor([g], base));

goalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const base = req.user.base_currency;
    const rows = await list.all(req.user.id);
    const rates = await ratesFor(rows, base);
    res.json({ goals: rows.map((g) => withProjection(g, base, rates)), base_currency: base });
  })
);

goalsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = readBody(req.body, req.user.base_currency);
    const ts = now();
    const info = await insert.run(
      req.user.id, b.name, b.type, b.targetAmount, b.targetDate, b.currentAmount,
      b.monthly, b.expectedReturn, b.currency, ts, ts
    );
    const row = await getOne.get(Number(info.lastInsertRowid), req.user.id);
    res.status(201).json({ goal: await oneWithProjection(row, req.user.base_currency) });
  })
);

goalsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await getOne.get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'Goal not found');
    const b = readBody({ ...existing, ...req.body }, existing.currency);
    await update.run(
      b.name, b.type, b.targetAmount, b.targetDate, b.currentAmount,
      b.monthly, b.expectedReturn, b.currency, now(), req.params.id, req.user.id
    );
    const row = await getOne.get(req.params.id, req.user.id);
    res.json({ goal: await oneWithProjection(row, req.user.base_currency) });
  })
);

goalsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const info = await remove.run(req.params.id, req.user.id);
    if (!info.changes) throw new HttpError(404, 'Goal not found');
    res.json({ ok: true });
  })
);
