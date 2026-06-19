import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired, requirePremium } from '../auth.js';
import { asyncHandler, bad, HttpError, num, oneOf, str } from '../util.js';
import { projectGoal } from '../services/goals.js';

export const goalsRouter = Router();
goalsRouter.use(authRequired);
goalsRouter.use(requirePremium); // Goals & projections is a premium feature.

const TYPES = ['RETIREMENT', 'HOUSE', 'EDUCATION', 'CAR', 'TRAVEL', 'EMERGENCY', 'WEALTH', 'CUSTOM'];

function readBody(body) {
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
    currency: body.currency ? oneOf(String(body.currency).toUpperCase(), ['INR', 'USD'], 'currency') : 'INR',
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

const withProjection = (g) => ({ ...g, projection: projectGoal(g) });

goalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await list.all(req.user.id);
    res.json({ goals: rows.map(withProjection) });
  })
);

goalsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = readBody(req.body);
    const ts = now();
    const info = await insert.run(
      req.user.id, b.name, b.type, b.targetAmount, b.targetDate, b.currentAmount,
      b.monthly, b.expectedReturn, b.currency, ts, ts
    );
    const row = await getOne.get(Number(info.lastInsertRowid), req.user.id);
    res.status(201).json({ goal: withProjection(row) });
  })
);

goalsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await getOne.get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'Goal not found');
    const b = readBody({ ...existing, ...req.body });
    await update.run(
      b.name, b.type, b.targetAmount, b.targetDate, b.currentAmount,
      b.monthly, b.expectedReturn, b.currency, now(), req.params.id, req.user.id
    );
    const row = await getOne.get(req.params.id, req.user.id);
    res.json({ goal: withProjection(row) });
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
