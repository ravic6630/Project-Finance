import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired } from '../auth.js';
import { asyncHandler, bad, HttpError, num, oneOf, str } from '../util.js';
import { CURRENCIES } from '../markets.js';

export const cashRouter = Router();
cashRouter.use(authRequired);

const TYPES = ['BANK', 'CASH', 'FD', 'OTHER'];

function readBody(body) {
  const name = str(body.name);
  if (!name) throw bad('name is required');
  return {
    name,
    type: body.type ? oneOf(String(body.type).toUpperCase(), TYPES, 'type') : 'BANK',
    balance: num(body.balance ?? 0, 'balance'),
    currency: body.currency
      ? oneOf(String(body.currency).toUpperCase(), CURRENCIES, 'currency')
      : 'INR',
    interestRate:
      body.interest_rate === '' || body.interest_rate == null
        ? null
        : num(body.interest_rate, 'interest_rate'),
    maturityDate: str(body.maturity_date),
    notes: str(body.notes),
  };
}

const list = db.prepare('SELECT * FROM cash_accounts WHERE user_id = ? ORDER BY type, name');
const getOne = db.prepare('SELECT * FROM cash_accounts WHERE id = ? AND user_id = ?');
const insert = db.prepare(`
  INSERT INTO cash_accounts
    (user_id, name, type, balance, currency, interest_rate, maturity_date, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const update = db.prepare(`
  UPDATE cash_accounts SET
    name = ?, type = ?, balance = ?, currency = ?, interest_rate = ?,
    maturity_date = ?, notes = ?, updated_at = ?
  WHERE id = ? AND user_id = ?
`);
const remove = db.prepare('DELETE FROM cash_accounts WHERE id = ? AND user_id = ?');

cashRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ accounts: await list.all(req.user.id) });
  })
);

cashRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = readBody(req.body);
    const ts = now();
    const info = await insert.run(
      req.user.id, b.name, b.type, b.balance, b.currency,
      b.interestRate, b.maturityDate, b.notes, ts, ts
    );
    res.status(201).json({ account: await getOne.get(Number(info.lastInsertRowid), req.user.id) });
  })
);

cashRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await getOne.get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'Account not found');
    const b = readBody({ ...existing, ...req.body });
    await update.run(
      b.name, b.type, b.balance, b.currency, b.interestRate,
      b.maturityDate, b.notes, now(), req.params.id, req.user.id
    );
    res.json({ account: await getOne.get(req.params.id, req.user.id) });
  })
);

cashRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const info = await remove.run(req.params.id, req.user.id);
    if (!info.changes) throw new HttpError(404, 'Account not found');
    res.json({ ok: true });
  })
);
