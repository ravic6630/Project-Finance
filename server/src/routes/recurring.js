import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired } from '../auth.js';
import { asyncHandler, bad, HttpError, num, oneOf, str } from '../util.js';
import { CURRENCIES } from '../markets.js';
import { materializeRecurring, occurrencesBetween, todayIST } from '../services/recurring.js';

export const recurringRouter = Router();
recurringRouter.use(authRequired);

const TYPES = ['INCOME', 'EXPENSE'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function readBody(body) {
  const type = oneOf(body.type, TYPES, 'type');
  const amount = num(body.amount, 'amount');
  if (amount <= 0) throw bad('amount must be greater than 0');
  const day = Math.round(num(body.day_of_month ?? 1, 'day_of_month'));
  if (day < 1 || day > 31) throw bad('day_of_month must be 1–31');
  const start = str(body.start_date);
  if (!start || !DATE_RE.test(start)) throw bad('start_date must be YYYY-MM-DD');
  const end = str(body.end_date);
  if (end && !DATE_RE.test(end)) throw bad('end_date must be YYYY-MM-DD');
  if (end && end < start) throw bad('end_date cannot be before start_date');
  return {
    type,
    amount,
    currency: body.currency ? oneOf(String(body.currency).toUpperCase(), CURRENCIES, 'currency') : 'INR',
    category: str(body.category),
    account: str(body.account),
    note: str(body.note),
    day,
    start,
    end,
    active: body.active === false || body.active === 0 ? 0 : 1,
  };
}

const list = db.prepare('SELECT * FROM recurring_rules WHERE user_id = ? ORDER BY active DESC, id DESC');
const getOne = db.prepare('SELECT * FROM recurring_rules WHERE id = ? AND user_id = ?');
const insert = db.prepare(`
  INSERT INTO recurring_rules
    (user_id, type, amount, currency, category, account, note, day_of_month, start_date, end_date, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const update = db.prepare(`
  UPDATE recurring_rules SET
    type = ?, amount = ?, currency = ?, category = ?, account = ?, note = ?,
    day_of_month = ?, start_date = ?, end_date = ?, active = ?, updated_at = ?
  WHERE id = ? AND user_id = ?
`);
const remove = db.prepare('DELETE FROM recurring_rules WHERE id = ? AND user_id = ?');

// Each rule is returned with its next due date, so the UI can say
// "next on 1 Sep" without re-implementing the calendar math.
function withNext(rule) {
  const today = todayIST();
  const horizon = new Date();
  horizon.setMonth(horizon.getMonth() + 2);
  const [next] = rule.active
    ? occurrencesBetween(rule, today, horizon.toISOString().slice(0, 10))
    : [];
  return { ...rule, next_date: next || null };
}

recurringRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    await materializeRecurring(req.user.id);
    const rules = await list.all(req.user.id);
    res.json({ rules: rules.map(withNext) });
  })
);

recurringRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = readBody(req.body);
    const ts = now();
    const info = await insert.run(
      req.user.id, b.type, b.amount, b.currency, b.category, b.account, b.note,
      b.day, b.start, b.end, b.active, ts, ts
    );
    // Catch up immediately so a back-dated rule (e.g. salary since January)
    // fills its history without waiting for the next page load.
    const { created } = await materializeRecurring(req.user.id);
    const rule = await getOne.get(Number(info.lastInsertRowid), req.user.id);
    res.status(201).json({ rule: withNext(rule), created });
  })
);

recurringRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await getOne.get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'Recurring rule not found');
    const merged = {
      ...existing,
      ...req.body,
      day_of_month: req.body.day_of_month ?? existing.day_of_month,
      start_date: req.body.start_date ?? existing.start_date,
      end_date: req.body.end_date === undefined ? existing.end_date : req.body.end_date,
      active: req.body.active === undefined ? existing.active : req.body.active,
    };
    const b = readBody(merged);
    await update.run(
      b.type, b.amount, b.currency, b.category, b.account, b.note,
      b.day, b.start, b.end, b.active, now(), req.params.id, req.user.id
    );
    const { created } = await materializeRecurring(req.user.id);
    res.json({ rule: withNext(await getOne.get(req.params.id, req.user.id)), created });
  })
);

// Deleting a rule keeps the transactions it already logged — they're history.
recurringRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const info = await remove.run(req.params.id, req.user.id);
    if (!info.changes) throw new HttpError(404, 'Recurring rule not found');
    res.json({ ok: true });
  })
);
