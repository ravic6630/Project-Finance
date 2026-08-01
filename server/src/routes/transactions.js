import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired } from '../auth.js';
import { asyncHandler, bad, HttpError, num, oneOf, str } from '../util.js';
import { CURRENCIES } from '../markets.js';

export const transactionsRouter = Router();
transactionsRouter.use(authRequired);

const TYPES = ['INCOME', 'EXPENSE'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_CATEGORIES = {
  INCOME: ['Salary', 'Business', 'Dividends', 'Interest', 'Rental', 'Gift', 'Other'],
  EXPENSE: [
    'Food', 'Groceries', 'Rent', 'Utilities', 'Transport', 'Shopping',
    'Health', 'Education', 'Entertainment', 'Travel', 'Insurance', 'EMI', 'Other',
  ],
};

function readBody(body) {
  const type = oneOf(body.type, TYPES, 'type');
  const date = str(body.date);
  if (!date || !DATE_RE.test(date)) throw bad('date must be YYYY-MM-DD');
  return {
    type,
    amount: num(body.amount, 'amount'),
    currency: body.currency
      ? oneOf(String(body.currency).toUpperCase(), CURRENCIES, 'currency')
      : 'INR',
    category: str(body.category),
    account: str(body.account),
    date,
    note: str(body.note),
  };
}

const getOne = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?');
const insert = db.prepare(`
  INSERT INTO transactions (user_id, type, amount, currency, category, account, date, note, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const update = db.prepare(`
  UPDATE transactions SET type = ?, amount = ?, currency = ?, category = ?, account = ?, date = ?, note = ?
  WHERE id = ? AND user_id = ?
`);
const remove = db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?');

// GET /api/transactions?limit=100&type=EXPENSE&from=2026-01-01&to=2026-06-30
transactionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = ['user_id = ?'];
    const params = [req.user.id];
    if (req.query.type && TYPES.includes(req.query.type)) {
      clauses.push('type = ?');
      params.push(req.query.type);
    }
    if (DATE_RE.test(req.query.from || '')) {
      clauses.push('date >= ?');
      params.push(req.query.from);
    }
    if (DATE_RE.test(req.query.to || '')) {
      clauses.push('date <= ?');
      params.push(req.query.to);
    }
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const rows = await db
      .prepare(
        `SELECT * FROM transactions WHERE ${clauses.join(' AND ')} ORDER BY date DESC, id DESC LIMIT ?`
      )
      .all(...params, limit);
    // Suggestions = the defaults plus every category this user has actually
    // used, so custom categories become first-class after their first use.
    const used = await db
      .prepare(
        "SELECT DISTINCT type, category FROM transactions WHERE user_id = ? AND category IS NOT NULL AND TRIM(category) <> ''"
      )
      .all(req.user.id);
    const categories = {
      EXPENSE: [...(DEFAULT_CATEGORIES.EXPENSE || [])],
      INCOME: [...(DEFAULT_CATEGORIES.INCOME || [])],
    };
    for (const r of used) {
      const list = categories[r.type];
      if (list && !list.some((c) => c.toLowerCase() === String(r.category).toLowerCase())) {
        list.push(r.category);
      }
    }
    res.json({ transactions: rows, categories });
  })
);

transactionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = readBody(req.body);
    const info = await insert.run(
      req.user.id, b.type, b.amount, b.currency, b.category, b.account, b.date, b.note, now()
    );
    res.status(201).json({ transaction: await getOne.get(Number(info.lastInsertRowid), req.user.id) });
  })
);

transactionsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await getOne.get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'Transaction not found');
    const b = readBody({ ...existing, ...req.body });
    await update.run(
      b.type, b.amount, b.currency, b.category, b.account, b.date, b.note,
      req.params.id, req.user.id
    );
    res.json({ transaction: await getOne.get(req.params.id, req.user.id) });
  })
);

transactionsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const info = await remove.run(req.params.id, req.user.id);
    if (!info.changes) throw new HttpError(404, 'Transaction not found');
    res.json({ ok: true });
  })
);
