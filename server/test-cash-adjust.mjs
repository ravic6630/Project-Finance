// Quick add/spend on a cash account: POST /api/cash/:id/adjust.
// Run from server/ with the API up:  node --env-file-if-exists=.env test-cash-adjust.mjs
import bcrypt from 'bcryptjs';
import { db, now } from './src/db.js';

const API = 'http://localhost:4000/api';
let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label} ${extra}`);
  }
};
const near = (a, b, tol = 0.001) => Number.isFinite(a) && Math.abs(a - b) <= tol;

async function http(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const DOMAIN = '@cashtest.sampada';
const PW = 'secret123';

async function cleanup() {
  const rows = await db.prepare(`SELECT id FROM users WHERE email LIKE '%${DOMAIN}'`).all();
  for (const { id } of rows) {
    for (const t of ['sessions', 'subscriptions', 'cash_accounts', 'transactions']) {
      try {
        await db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
      } catch {}
    }
    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
}

async function makeUser(email) {
  const info = await db
    .prepare('INSERT INTO users (email, name, password_hash, base_currency, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(email, 'Cash Tester', bcrypt.hashSync(PW, 10), 'INR', 'user', now());
  const id = Number(info.lastInsertRowid);
  const token = (await http('/auth/login', { method: 'POST', body: { email, password: PW } })).body.token;
  return { id, token };
}

const account = (id, token) => http(`/cash`, { token }).then((r) => r.body.accounts.find((a) => a.id === id));
const txns = (userId) => db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id').all(userId);
const adjust = (id, token, body) => http(`/cash/${id}/adjust`, { method: 'POST', token, body });

console.log('— quick balance adjust —');
await cleanup();

const U = await makeUser(`adj${DOMAIN}`);
// A USD account on an INR user — the currency the transaction carries must be
// the account's own, not the user's base.
const acc = (await http('/cash', { method: 'POST', token: U.token, body: { name: 'Forbright Bank', type: 'BANK', balance: 2500, currency: 'USD' } })).body.account;
ok(acc?.id && near(acc.balance, 2500), 'set up: a $2,500 USD account', JSON.stringify(acc));

/* ----------------------------- money in, recorded -------------------------- */
const r1 = await adjust(acc.id, U.token, { direction: 'in', amount: 500, category: 'Salary', note: 'September pay' });
ok(r1.status === 200, 'money in is accepted', JSON.stringify(r1.body).slice(0, 120));
ok(near(r1.body.account?.balance, 3000), 'the balance goes up by exactly the amount: 3,000', String(r1.body.account?.balance));
ok(r1.body.transaction?.type === 'INCOME', 'and it is recorded as INCOME', r1.body.transaction?.type);
ok(near(r1.body.transaction?.amount, 500), 'for the same amount', String(r1.body.transaction?.amount));
ok(r1.body.transaction?.currency === 'USD', "in the account's currency, not the user's base", r1.body.transaction?.currency);
ok(r1.body.transaction?.account === 'Forbright Bank', 'tagged with the account it moved', r1.body.transaction?.account);
ok(r1.body.transaction?.category === 'Salary' && r1.body.transaction?.note === 'September pay', 'keeping the category and note');
ok(/^\d{4}-\d{2}-\d{2}$/.test(r1.body.transaction?.date || ''), 'dated today when no date is given', r1.body.transaction?.date);

/* ----------------------------- money out, recorded ------------------------- */
const r2 = await adjust(acc.id, U.token, { direction: 'out', amount: 120.5, category: 'Groceries' });
ok(near(r2.body.account?.balance, 2879.5), 'money out takes it down: 2,879.50', String(r2.body.account?.balance));
ok(r2.body.transaction?.type === 'EXPENSE', 'and records an EXPENSE', r2.body.transaction?.type);
// The amount is a magnitude; the sign lives in `direction` alone.
ok(near(r2.body.transaction?.amount, 120.5), 'stored as a positive amount', String(r2.body.transaction?.amount));

/* --------------------- a correction is NOT spending ----------------------- */
// A transfer between your own accounts, or fixing a typo, must move the balance
// without inventing an expense the FI target would then be sized from.
const before = (await txns(U.id)).length;
const r3 = await adjust(acc.id, U.token, { direction: 'out', amount: 879.5, record: false });
ok(near(r3.body.account?.balance, 2000), 'a correction still moves the balance: 2,000', String(r3.body.account?.balance));
ok(r3.body.transaction === null, 'but returns no transaction');
ok((await txns(U.id)).length === before, 'and writes none', `${before} -> ${(await txns(U.id)).length}`);

/* ------------------------- two quick taps add up -------------------------- */
// The balance is bumped in SQL (balance = balance + ?), not read-then-written,
// so concurrent adjustments must all land rather than overwrite each other.
await Promise.all(
  Array.from({ length: 8 }, () => adjust(acc.id, U.token, { direction: 'in', amount: 25, record: false }))
);
ok(near((await account(acc.id, U.token))?.balance, 2200), '8 concurrent +25s all land: 2,200 (none lost)',
   String((await account(acc.id, U.token))?.balance));

/* ------------------------------ overdraft is real ------------------------- */
const r4 = await adjust(acc.id, U.token, { direction: 'out', amount: 2500, category: 'Rent' });
ok(r4.status === 200 && near(r4.body.account?.balance, -300), 'going below zero is allowed (overdrafts exist): -300',
   String(r4.body.account?.balance));

/* ------------------------------- rubbish refused -------------------------- */
const bal = (await account(acc.id, U.token))?.balance;
const refused = [
  [{ direction: 'in', amount: 0 }, 'a zero amount'],
  [{ direction: 'in', amount: -50 }, 'a negative amount (the sign comes from direction)'],
  [{ direction: 'in', amount: 'abc' }, 'a non-number'],
  [{ direction: 'sideways', amount: 10 }, 'an unknown direction'],
  [{ direction: 'in', amount: 1e13 }, 'an absurd amount'],
  [{ direction: 'in', amount: 10, date: '10/09/2026' }, 'a malformed date'],
];
for (const [body, what] of refused) {
  ok((await adjust(acc.id, U.token, body)).status === 400, `refused: ${what}`);
}
ok(near((await account(acc.id, U.token))?.balance, bal), 'and none of those moved the balance', String((await account(acc.id, U.token))?.balance));

/* -------------------------------- ownership ------------------------------- */
const V = await makeUser(`other${DOMAIN}`);
const theirs = await adjust(acc.id, V.token, { direction: 'out', amount: 1 });
ok(theirs.status === 404, "another user cannot touch this account (404, not 403 — no existence leak)", String(theirs.status));
ok(near((await account(acc.id, U.token))?.balance, bal), 'and the balance is untouched');
ok((await http(`/cash/${acc.id}/adjust`, { method: 'POST', body: { direction: 'in', amount: 1 } })).status === 401,
   'no token => 401');

/* --------------------- it feeds the dashboard's cashflow ------------------ */
// The reason recording is on by default: the dashboard's cashflow panels were
// empty because nothing was ever recorded. One adjustment must light them up.
const dash = (await http('/dashboard', { token: U.token })).body;
const thisMonth = dash.cashflow?.months?.[dash.cashflow.months.length - 1];
ok(thisMonth && thisMonth.income > 0 && thisMonth.expense > 0, 'recorded adjustments reach the cashflow panels',
   JSON.stringify(thisMonth));

console.log(`\n${pass} passed, ${fail} failed`);
await cleanup();
process.exit(fail ? 1 : 0);
