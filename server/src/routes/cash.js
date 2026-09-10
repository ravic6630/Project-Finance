import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired } from '../auth.js';
import { scopeFromReq, normalizeProfileId } from './profiles.js';
import { asyncHandler, bad, HttpError, num, oneOf, str } from '../util.js';
import { CURRENCIES } from '../markets.js';
import { todayIST } from '../services/recurring.js';

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

const listScoped = (sql) => db.prepare(`SELECT * FROM cash_accounts WHERE user_id = ?${sql} ORDER BY type, name`);
const getOne = db.prepare('SELECT * FROM cash_accounts WHERE id = ? AND user_id = ?');
const insert = db.prepare(`
  INSERT INTO cash_accounts
    (user_id, name, type, balance, currency, interest_rate, maturity_date, notes, profile_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const update = db.prepare(`
  UPDATE cash_accounts SET
    name = ?, type = ?, balance = ?, currency = ?, interest_rate = ?,
    maturity_date = ?, notes = ?, profile_id = ?, updated_at = ?
  WHERE id = ? AND user_id = ?
`);
const remove = db.prepare('DELETE FROM cash_accounts WHERE id = ? AND user_id = ?');

cashRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ accounts: await (() => { const sc = scopeFromReq(req); return listScoped(sc.sql).all(req.user.id, ...sc.args); })() });
  })
);

cashRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = readBody(req.body);
    const ts = now();
    const info = await insert.run(
      req.user.id, b.name, b.type, b.balance, b.currency,
      b.interestRate, b.maturityDate, b.notes,
      await normalizeProfileId(req.user.id, req.body.profile_id), ts, ts
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
      b.maturityDate, b.notes,
      req.body.profile_id === undefined
        ? existing.profile_id
        : await normalizeProfileId(req.user.id, req.body.profile_id),
      now(), req.params.id, req.user.id
    );
    res.json({ account: await getOne.get(req.params.id, req.user.id) });
  })
);

/* ------------------------------- quick adjust ------------------------------ */
// "I got paid" / "I spent some" without reopening the whole account form and
// retyping a balance. The amount moves the balance, and — unless the user says
// this was just a correction — the same movement is logged as a transaction.
//
// That second half is the point. The dashboard's cashflow panels and the FI
// number in Insights are both built from recorded spending, and almost nobody
// opens a separate Transactions page to log it. A balance change is the moment
// the information exists anyway; asking one extra question there is the
// cheapest way it will ever get captured.
//
// Not every balance change is income or spending, though. Moving money between
// your own accounts, or fixing a typo, is neither — and logging it as an
// expense would inflate the spending the FI target is sized from. So `record`
// is the user's call on every adjustment, defaulting to on.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ADJUST = 1e12;

const bumpBalance = `
  UPDATE cash_accounts SET balance = balance + ?, updated_at = ?
  WHERE id = ? AND user_id = ?
`;
const insertTxn = `
  INSERT INTO transactions (user_id, type, amount, currency, category, account, date, note, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

cashRouter.post(
  '/:id/adjust',
  asyncHandler(async (req, res) => {
    const account = await getOne.get(req.params.id, req.user.id);
    if (!account) throw new HttpError(404, 'Account not found');

    const direction = oneOf(String(req.body.direction || ''), ['in', 'out'], 'direction');
    const amount = num(req.body.amount, 'amount');
    // A zero or negative "add" is a direction the user didn't pick; the sign
    // comes from `direction` alone, so the amount is always a magnitude.
    if (!(amount > 0)) throw bad('Enter an amount greater than zero');
    if (amount > MAX_ADJUST) throw bad('That amount is too large');

    const record = req.body.record !== false;
    const date = req.body.date == null || req.body.date === '' ? todayIST() : String(req.body.date);
    if (!DATE_RE.test(date)) throw bad('date must be YYYY-MM-DD');
    const category = str(req.body.category)?.slice(0, 60) || 'Other';
    const note = str(req.body.note)?.slice(0, 280) || null;

    const delta = direction === 'in' ? amount : -amount;
    const ts = now();

    // One batch, so the balance and its transaction land together or not at
    // all — a balance that moved with no record of why is exactly the drift
    // this feature exists to stop. And `balance = balance + ?` rather than
    // read-then-write: two quick taps must add up, not overwrite each other.
    const stmts = [{ sql: bumpBalance, args: [delta, ts, account.id, req.user.id] }];
    if (record) {
      stmts.push({
        sql: insertTxn,
        args: [
          req.user.id,
          direction === 'in' ? 'INCOME' : 'EXPENSE',
          amount,
          // The account's own currency: $50 spent from a USD account is $50,
          // not ₹50, whatever the user's base currency is.
          account.currency,
          category,
          account.name,
          date,
          note,
          ts,
        ],
      });
    }
    const results = await db.batch(stmts);

    const txnId = record ? Number(results[1]?.lastInsertRowid) || null : null;
    res.json({
      account: await getOne.get(account.id, req.user.id),
      transaction: txnId
        ? await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(txnId, req.user.id)
        : null,
    });
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
