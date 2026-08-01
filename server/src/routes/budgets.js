import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired } from '../auth.js';
import { asyncHandler, bad, HttpError, num, oneOf, str } from '../util.js';
import { CURRENCIES } from '../markets.js';
import { getFxRate } from '../services/prices.js';
import { todayIST, materializeRecurring } from '../services/recurring.js';

export const budgetsRouter = Router();
budgetsRouter.use(authRequired);

const list = db.prepare('SELECT * FROM budgets WHERE user_id = ? ORDER BY category');
const getOne = db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?');
const upsert = db.prepare(`
  INSERT INTO budgets (user_id, category, amount, currency, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, category) DO UPDATE SET
    amount = excluded.amount, currency = excluded.currency, updated_at = excluded.updated_at
`);
const remove = db.prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?');

// This month's expense totals per category (in each transaction's own currency;
// converted to base below).
const monthSpend = db.prepare(`
  SELECT category, currency, SUM(amount) AS total
  FROM transactions
  WHERE user_id = ? AND type = 'EXPENSE' AND date >= ? AND date <= ?
  GROUP BY category, currency
`);

// Budgets + this month's spending, everything converted to the base currency.
budgetsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const base = req.user.base_currency;
    // Recurring expenses count against budgets, so catch them up first.
    await materializeRecurring(req.user.id).catch(() => {});

    const today = todayIST();
    const monthStart = `${today.slice(0, 7)}-01`;
    const budgets = await list.all(req.user.id);
    const spendRows = await monthSpend.all(req.user.id, monthStart, today);

    const rates = { [base]: 1 };
    const rate = async (c) => {
      if (rates[c] == null) rates[c] = await getFxRate(c, base);
      return rates[c];
    };

    // category (lowercased) -> spent in base currency
    const spent = {};
    for (const r of spendRows) {
      const key = (r.category || 'Uncategorised').toLowerCase();
      spent[key] = (spent[key] || 0) + Number(r.total) * (await rate(r.currency || base));
    }

    const items = [];
    for (const b of budgets) {
      const amountBase = Number(b.amount) * (await rate(b.currency));
      const spentBase = spent[b.category.toLowerCase()] || 0;
      items.push({
        ...b,
        amount_base: amountBase,
        spent_base: spentBase,
        pct: amountBase > 0 ? Math.round((spentBase / amountBase) * 100) : 0,
      });
      delete spent[b.category.toLowerCase()];
    }

    // Categories with spending this month but no budget yet — easy candidates.
    const unbudgeted = Object.entries(spent)
      .map(([category, spent_base]) => ({ category, spent_base }))
      .sort((a, b) => b.spent_base - a.spent_base)
      .slice(0, 8);

    res.json({ month: today.slice(0, 7), base_currency: base, items, unbudgeted });
  })
);

// Set several budgets at once (the template flow). Rows without a positive
// amount are simply skipped, so the client can send the whole template.
budgetsRouter.put(
  '/bulk',
  asyncHandler(async (req, res) => {
    const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : [];
    if (!items.length) throw bad('items is required');
    const ts = now();
    let set = 0;
    for (const it of items) {
      const category = str(it.category);
      const amount = Number(it.amount);
      if (!category || !Number.isFinite(amount) || amount <= 0) continue;
      const currency = it.currency
        ? oneOf(String(it.currency).toUpperCase(), CURRENCIES, 'currency')
        : req.user.base_currency;
      await upsert.run(req.user.id, category, amount, currency, ts, ts);
      set += 1;
    }
    if (!set) throw bad('Enter an amount for at least one category');
    res.json({ ok: true, set });
  })
);

// Upsert one budget per category.
budgetsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const category = str(req.body.category);
    if (!category) throw bad('category is required');
    const amount = num(req.body.amount, 'amount');
    if (amount <= 0) throw bad('amount must be greater than 0');
    const currency = req.body.currency
      ? oneOf(String(req.body.currency).toUpperCase(), CURRENCIES, 'currency')
      : req.user.base_currency;
    const ts = now();
    await upsert.run(req.user.id, category, amount, currency, ts, ts);
    res.json({ ok: true });
  })
);

budgetsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await getOne.get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'Budget not found');
    await remove.run(req.params.id, req.user.id);
    res.json({ ok: true });
  })
);
