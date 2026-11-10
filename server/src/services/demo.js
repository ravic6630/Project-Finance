import { randomBytes } from 'node:crypto';
import { db, now } from '../db.js';
import { hashPassword } from '../auth.js';
import { getFxRate, getPrice } from './prices.js';
import { todayIST } from './recurring.js';
import { cashflowMonths } from './summary.js';
import { deleteAccount } from './accounts.js';

/* The live demo: one disposable account per visitor.

   Why not one shared demo login: every visitor would see the last visitor's
   edits, and anyone could wreck it for everyone. Why not a read-only one: the
   point is to FEEL the product, and that means adding a holding, moving a
   budget, switching a currency. So each click on "Try the live demo" gets a
   private account, already filled with a believable family's money, with
   every feature (Premium included) switched on.

   What keeps that safe:
   - The account has no usable password and an undeliverable address
     (@demo.invalid — reserved, RFC 2606), so nobody can sign in to it again
     and no email can ever reach a real person from it.
   - Anything that leaves the app — email, payments, broker logins, family
     invites, support chat — is refused for demo accounts in authRequired
     (DEMO_BLOCKED in auth.js), with a message that says why.
   - It expires (DEMO_TTL_HOURS, default 24) and is then deleted outright.
     Expired demos are swept whenever a new one starts, on boot, hourly while
     the server is awake, and by the daily cron run.
   - At most DEMO_MAX_ACCOUNTS (default 300) exist at once; past that the
     oldest is removed to make room. Creation is rate-limited per IP.

   The data is dated relative to today, so the dashboard always looks current:
   six months of income and spending ending this week, a net-worth history
   that ends where today's prices put it, budgets with one category over. */

export const DEMO_TTL_HOURS = Number(process.env.DEMO_TTL_HOURS) || 24;
export const DEMO_MAX = Number(process.env.DEMO_MAX_ACCOUNTS) || 300;
export const DEMO_ENABLED = process.env.DEMO_ENABLED !== '0';
export const DEMO_EMAIL_DOMAIN = 'demo.invalid';
export const isDemoEmail = (email) => String(email || '').toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);

/* --------------------------------- cleanup -------------------------------- */
export async function sweepDemos({ at = new Date() } = {}) {
  const rows = await db
    .prepare('SELECT id FROM users WHERE demo_expires_at IS NOT NULL AND demo_expires_at <= ?')
    .all(at.toISOString());
  for (const { id } of rows) await deleteAccount(id);
  return { deleted: rows.length };
}

// Keeps the count of live demos under the cap, oldest out first.
async function makeRoom() {
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE demo_expires_at IS NOT NULL').get();
  const excess = Number(n) - DEMO_MAX + 1;
  if (excess <= 0) return 0;
  const old = await db
    .prepare('SELECT id FROM users WHERE demo_expires_at IS NOT NULL ORDER BY demo_expires_at ASC, id ASC LIMIT ?')
    .all(excess);
  for (const { id } of old) await deleteAccount(id);
  return old.length;
}

/* ------------------------------- the family ------------------------------- */
// Asha (the same Asha the landing page's mock dashboard greets), a software
// lead in Pune; her husband Rohan is a managed profile, so
// the family switcher has something to switch between. `target` is roughly
// what each position is worth today; `factor` is what was paid per unit as a
// share of today's price — a mix of winners and two losers, as real
// portfolios have. `ref` is the price to fall back on if a feed is down
// (NSE/AMFI/Nasdaq closes, November 2026).
const HOLDINGS = [
  { kind: 'IN_STOCK', symbol: 'RELIANCE.NS', name: 'Reliance Industries', target: 320000, factor: 0.86, ref: 1324.4, nominee: 'registered' },
  { kind: 'IN_STOCK', symbol: 'TCS.NS', name: 'Tata Consultancy Services', target: 560000, factor: 1.12, ref: 2475.4, nominee: 'registered' },
  { kind: 'IN_STOCK', symbol: 'HDFCBANK.NS', name: 'HDFC Bank', target: 280000, factor: 0.84, ref: 798.15, nominee: 'registered' },
  { kind: 'IN_STOCK', symbol: 'INFY.NS', name: 'Infosys', target: 210000, factor: 1.06, ref: 1154.1, nominee: 'registered' },
  { kind: 'IN_STOCK', symbol: 'ITC.NS', name: 'ITC', target: 150000, factor: 0.92, ref: 278.8, nominee: 'registered', sold: true },
  { kind: 'IN_STOCK', symbol: 'NIFTYBEES.NS', name: 'Nippon India ETF Nifty 50 BeES', target: 250000, factor: 0.8, ref: 285.01, nominee: 'registered' },
  { kind: 'IN_MF', scheme: '122639', name: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth', target: 600000, factor: 0.72, ref: 93.9483, nominee: 'registered' },
  { kind: 'IN_MF', scheme: '120716', name: 'UTI Nifty 50 Index Fund - Direct Plan - Growth', target: 400000, factor: 0.79, ref: 176.3404, nominee: 'none' },
  { kind: 'IN_MF', scheme: '120503', name: 'Axis ELSS Tax Saver Fund - Direct Plan - Growth', target: 180000, factor: 0.88, ref: 114.0728, nominee: null },
  { kind: 'US_STOCK', symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD', targetUsd: 3000, factor: 0.7, ref: 350.69, nominee: 'none' },
  { kind: 'US_STOCK', symbol: 'MSFT', name: 'Microsoft Corporation', currency: 'USD', targetUsd: 2400, factor: 0.78, ref: 545.18, nominee: null },
];

const ACCOUNTS = [
  { name: 'HDFC Savings', type: 'BANK', balance: 240000, nominee: 'registered', nomineeName: 'Rohan Rao' },
  { name: 'ICICI Salary Account', type: 'BANK', balance: 65000, nominee: null },
  { name: 'SBI Fixed Deposit', type: 'FD', balance: 300000, rate: 7.1, maturesInMonths: 14, nominee: 'registered', nomineeName: 'Rohan Rao' },
  { name: 'SBI Savings', type: 'BANK', balance: 110000, nominee: 'none', profile: 'Rohan' },
];

const ASSETS = [
  { name: 'Apartment in Pune', type: 'PROPERTY', value: 9200000, notes: '3BHK in Baner, bought in 2019' },
  { name: 'Gold jewellery', type: 'GOLD', value: 480000, notes: 'About 60 g, valued at today’s rate' },
];

// [category, account, day, amounts for the six months oldest → this month]
// (null = nothing that month). Last month is built to sit just over on
// Dining out and Fuel, so budgets have something to say.
const SPEND = [
  ['Groceries', 'HDFC Savings', 6, [6800, 7400, 7100, 6900, 7800, 7000]],
  ['Groceries', 'HDFC Savings', 20, [7200, 6900, 7600, 7300, 6400, 7200]],
  ['Dining out', 'HDFC Savings', 9, [2600, 2200, 2900, 2400, 3300, 2500]],
  ['Dining out', 'HDFC Savings', 24, [2100, 2700, 2300, 2500, 2800, 2200]],
  ['Utilities', 'HDFC Savings', 10, [4200, 4600, 3900, 4100, 4400, 4300]],
  ['Fuel', 'HDFC Savings', 14, [4800, 5100, 4600, 4900, 5300, 4700]],
  ['Shopping', 'HDFC Savings', 16, [9000, 14500, 7800, 11200, 10400, 8600]],
  ['Home', 'HDFC Savings', 5, [3500, 3500, 3500, 3500, 3500, 3500]],
  ['Internet & phone', 'HDFC Savings', 7, [1799, 1799, 1799, 1799, 1799, 1799]],
  ['Subscriptions', 'HDFC Savings', 12, [649, 649, 649, 649, 649, 649]],
  ['Education', 'HDFC Savings', 3, [48000, null, null, 48000, null, null]],
  ['Insurance', 'HDFC Savings', 19, [null, 27500, null, null, null, null]],
  ['Travel', 'HDFC Savings', 25, [null, null, 38500, null, null, null]],
  ['Health', 'HDFC Savings', 11, [null, null, null, 2400, null, null]],
];
const EARN = [
  ['Salary', 'ICICI Salary Account', 1, [165000, 165000, 165000, 165000, 165000, 165000]],
  ['Freelance', 'HDFC Savings', 18, [null, 22000, null, 22000, null, 22000]],
  ['Dividends', 'HDFC Savings', 22, [null, null, 3400, null, null, null]],
];
const BUDGETS = [
  ['Groceries', 15000],
  ['Dining out', 5000],
  ['Fuel', 5000],
  ['Shopping', 12000],
];

/* --------------------------------- dates ---------------------------------- */
const iso = (d) => d.toISOString().slice(0, 10);
const parse = (s) => new Date(`${s}T00:00:00Z`);
function addMonths(day, n) {
  const d = parse(day);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return iso(target);
}
const addDays = (day, n) => iso(new Date(parse(day).getTime() + n * 86400000));
const firstOfNextMonth = (day) => {
  const d = parse(day);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
};

/* --------------------------------- prices --------------------------------- */
// Today's price for each position, or its reference price if the feed doesn't
// answer within a few seconds — a demo that hangs on a slow quote is worse
// than one priced at last week's close.
async function livePrices() {
  const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));
  return Promise.all(
    HOLDINGS.map(async (h) => {
      const holding = { kind: h.kind, symbol: h.symbol || null, scheme_code: h.scheme || null, currency: h.currency || 'INR' };
      const p = await Promise.race([getPrice(holding).catch(() => null), timeout(4000)]);
      const price = Number(p?.price);
      return Number.isFinite(price) && price > 0 ? price : h.ref;
    })
  );
}

// Splits a position into dated buy lots whose average is exactly `avg`, so
// Returns & tax (which works from lots) agrees with the Investments page.
function lotsFor(h, qty, avg, today) {
  const units = h.kind === 'IN_MF' ? 3 : 0;
  const round = (v) => Number(v.toFixed(units));
  const q1 = round(qty * 0.5);
  const q2 = round(qty * 0.3);
  const q3 = round(qty - q1 - q2);
  const p1 = avg * 0.92;
  const p2 = avg * 1.0;
  // The last lot's price is whatever makes the average come out at `avg`.
  const p3 = q3 > 0 ? (avg * qty - q1 * p1 - q2 * p2) / q3 : avg;
  const lots = [
    ['BUY', addMonths(today, -34), q1, p1],
    ['BUY', addMonths(today, -20), q2, p2],
    ['BUY', addMonths(today, -7), q3, p3],
  ].filter((l) => l[2] > 0);
  // One position was trimmed a while back, so Returns & tax has a realised,
  // long-term gain to show: an older lot, bought cheap and sold at a profit.
  if (h.sold) {
    const extra = Math.max(1, Math.round(qty * 0.4));
    lots.unshift(['BUY', addMonths(today, -40), extra, avg * 0.62]);
    lots.push(['SELL', addMonths(today, -14), extra, avg * 1.04]);
    lots.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  }
  return lots.map(([type, date, q, p]) => [type, date, q, Number(p.toFixed(4))]);
}

/* ---------------------------------- seed ---------------------------------- */
export async function seedDemo(userId, { baseCurrency = 'INR', today = todayIST() } = {}) {
  const ts = now();
  const usdInr = await Promise.race([
    getFxRate('USD', 'INR').catch(() => null),
    new Promise((r) => setTimeout(() => r(null), 4000)),
  ]);
  const usd = Number(usdInr) > 0 ? Number(usdInr) : 94;
  const prices = await livePrices();
  const stmts = [];
  const add = (sql, ...args) => stmts.push({ sql, args });
  const profileId = (name) => ({ sql: '(SELECT id FROM profiles WHERE user_id = ? AND name = ?)', args: [userId, name] });

  add('INSERT INTO profiles (user_id, name, relation, created_at) VALUES (?, ?, ?, ?)', userId, 'Rohan', 'Spouse', ts);

  // Holdings, and the lots behind each one.
  let investedInr = 0;
  HOLDINGS.forEach((h, i) => {
    const price = prices[i];
    const fx = h.currency === 'USD' ? usd : 1;
    const target = h.targetUsd ? h.targetUsd : h.target;
    const qty = h.kind === 'IN_MF' ? Number((target / price).toFixed(3)) : Math.max(1, Math.round(target / price));
    const avg = Number((price * h.factor).toFixed(4));
    investedInr += qty * price * fx;
    add(
      `INSERT INTO holdings (user_id, kind, symbol, scheme_code, name, quantity, avg_cost, currency, nominee_status, nominee_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId, h.kind, h.symbol || null, h.scheme || null, h.name, qty, avg, h.currency || 'INR',
      h.nominee, h.nominee === 'registered' ? 'Rohan Rao' : null, ts, ts
    );
    for (const [type, date, q, p] of lotsFor(h, qty, avg, today)) {
      add(
        `INSERT INTO investment_txns (user_id, holding_id, type, trade_date, quantity, price, created_at)
         VALUES (?, (SELECT id FROM holdings WHERE user_id = ? AND name = ?), ?, ?, ?, ?, ?)`,
        userId, userId, h.name, type, date, q, p, ts
      );
    }
  });

  let cashInr = 0;
  for (const a of ACCOUNTS) {
    cashInr += a.balance;
    const pid = a.profile ? profileId(a.profile) : null;
    stmts.push({
      sql: `INSERT INTO cash_accounts (user_id, name, type, balance, currency, interest_rate, maturity_date, nominee_status, nominee_name, profile_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'INR', ?, ?, ?, ?, ${pid ? pid.sql : 'NULL'}, ?, ?)`,
      args: [
        userId, a.name, a.type, a.balance, a.rate ?? null,
        a.maturesInMonths ? addMonths(today, a.maturesInMonths) : null,
        a.nominee, a.nomineeName || null, ...(pid ? pid.args : []), ts, ts,
      ],
    });
  }

  let assetsInr = 0;
  for (const a of ASSETS) {
    assetsInr += a.value;
    add(
      'INSERT INTO assets (user_id, name, type, value, currency, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      userId, a.name, a.type, a.value, 'INR', a.notes, ts, ts
    );
  }

  // Six months of money in and out, nothing dated after today.
  const months = cashflowMonths().map((m) => m.key);
  const txn = (type, [category, account, day, amounts]) =>
    months.forEach((key, i) => {
      const amount = amounts[i];
      const date = `${key}-${String(day).padStart(2, '0')}`;
      if (amount == null || date > today) return;
      add(
        'INSERT INTO transactions (user_id, type, amount, currency, category, account, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        userId, type, amount, 'INR', category, account, date, ts
      );
    });
  SPEND.forEach((row) => txn('EXPENSE', row));
  EARN.forEach((row) => txn('INCOME', row));

  for (const [category, amount] of BUDGETS) {
    add('INSERT INTO budgets (user_id, category, amount, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', userId, category, amount, 'INR', ts, ts);
  }

  // Recurring rules start next month, so none of them backfills a duplicate
  // of the salary and subscription already recorded above.
  const nextMonth = firstOfNextMonth(today);
  add(
    `INSERT INTO recurring_rules (user_id, type, amount, currency, category, account, note, day_of_month, start_date, created_at, updated_at)
     VALUES (?, 'INCOME', 165000, 'INR', 'Salary', 'ICICI Salary Account', 'Monthly salary', 1, ?, ?, ?)`,
    userId, nextMonth, ts, ts
  );
  add(
    `INSERT INTO recurring_rules (user_id, type, amount, currency, category, account, note, day_of_month, start_date, created_at, updated_at)
     VALUES (?, 'EXPENSE', 649, 'INR', 'Subscriptions', 'HDFC Savings', 'Streaming', 12, ?, ?, ?)`,
    userId, nextMonth, ts, ts
  );

  const goals = [
    ['Emergency fund', 'EMERGENCY', 500000, addMonths(today, 8), 6],
    ['Europe holiday', 'TRAVEL', 450000, addMonths(today, 10), 7],
    ['Aarav’s college', 'EDUCATION', 3500000, '2038-06-01', 11],
    ['Retire at 55', 'RETIREMENT', 40000000, '2049-04-01', 11],
  ];
  for (const [name, type, target, date, ret] of goals) {
    add(
      `INSERT INTO goals (user_id, name, type, target_amount, target_date, current_amount, monthly_contribution, expected_return, currency, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, 'INR', ?, ?)`,
      userId, name, type, target, date, ret, ts, ts
    );
  }
  // The emergency fund is the FD, named — so the goal funding picker opens
  // with something already chosen.
  add(
    `INSERT INTO goal_links (user_id, goal_id, kind, ref_id, created_at)
     VALUES (?, (SELECT id FROM goals WHERE user_id = ? AND name = 'Emergency fund'), 'account',
             (SELECT id FROM cash_accounts WHERE user_id = ? AND name = 'SBI Fixed Deposit'), ?)`,
    userId, userId, userId, ts
  );

  const reliance = prices[0];
  add(
    `INSERT INTO alerts (user_id, kind, symbol, label, direction, threshold, currency, created_at, updated_at)
     VALUES (?, 'IN_STOCK', 'RELIANCE.NS', 'Reliance Industries', 'above', ?, 'INR', ?, ?)`,
    userId, Math.round(reliance * 1.1), ts, ts
  );

  // Two years of net worth, ending just short of today's (which the dashboard
  // records itself on first load): daily for the last six weeks, weekly before
  // that. A steady climb with the dips markets actually have.
  const toBase = baseCurrency === 'INR' ? 1 : await getFxRate('INR', baseCurrency).catch(() => null);
  const netNow = (investedInr + cashInr + assetsInr) * (Number(toBase) > 0 ? Number(toBase) : 1);
  const days = [];
  for (let d = 1; d <= 42; d += 1) days.push(d);
  for (let d = 49; d <= 730; d += 7) days.push(d);
  for (const d of days) {
    const trend = 1 - 0.24 * (d / 730) ** 0.9;
    const wobble = 1 + 0.022 * Math.sin(d / 37) + 0.009 * Math.sin(d / 9.3) - 0.012 * Math.sin(d / 113);
    add(
      'INSERT OR REPLACE INTO net_worth_snapshots (user_id, date, net_worth, currency) VALUES (?, ?, ?, ?)',
      userId, addDays(today, -d), Math.round(netNow * trend * wobble), baseCurrency
    );
  }

  await db.batch(stmts);
  return { statements: stmts.length };
}

/* --------------------------------- create --------------------------------- */
export async function createDemoAccount({ baseCurrency = 'INR' } = {}) {
  await sweepDemos().catch(() => {});
  await makeRoom();

  const email = `demo-${randomBytes(6).toString('hex')}@${DEMO_EMAIL_DOMAIN}`;
  const expires = new Date(Date.now() + DEMO_TTL_HOURS * 3600 * 1000).toISOString();
  const info = await db
    .prepare(
      `INSERT INTO users (email, name, password_hash, base_currency, role, created_at, demo_expires_at)
       VALUES (?, ?, ?, ?, 'user', ?, ?)`
    )
    // A password nobody knows: the token handed back is the only way in.
    .run(email, 'Asha', hashPassword(randomBytes(24).toString('hex')), baseCurrency, now(), expires);
  const id = Number(info.lastInsertRowid);
  try {
    await seedDemo(id, { baseCurrency });
  } catch (err) {
    await deleteAccount(id).catch(() => {});
    throw err;
  }
  return db
    .prepare('SELECT id, email, name, base_currency, role, created_at, totp_enabled, demo_expires_at FROM users WHERE id = ?')
    .get(id);
}
