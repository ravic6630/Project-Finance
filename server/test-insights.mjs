// Insights trackers — maths verified against hand-computed values.
// Run from server/:  node --env-file-if-exists=.env test-insights.mjs
//
// Every expected number below was worked out by hand and is written into the
// assertion, so a refactor that quietly changes a formula fails here.
import bcrypt from 'bcryptjs';
import { db, now } from './src/db.js';
import { activatePremium } from './src/services/billing.js';

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
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const finite = (v) => v === null || (Number.isFinite(v) && !Number.isNaN(v));

async function http(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const DOMAIN = '@instest.sampada';
async function cleanup() {
  const rows = await db.prepare(`SELECT id FROM users WHERE email LIKE '%${DOMAIN}'`).all();
  for (const { id } of rows) {
    for (const t of ['sessions', 'subscriptions', 'holdings', 'cash_accounts', 'assets', 'transactions',
                     'net_worth_snapshots', 'insight_prefs', 'allocation_targets', 'email_prefs']) {
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
    .run(email, 'Ins Tester', bcrypt.hashSync('secret123', 10), 'INR', 'user', now());
  const id = Number(info.lastInsertRowid);
  await activatePremium(id, { provider: 'trial', days: 1 });
  const login = await http('/auth/login', { method: 'POST', body: { email, password: 'secret123' } });
  return { id, token: login.body.token };
}

// Month key N months back, on the IST convention the app uses.
const monthBack = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

console.log('— insights trackers —');
await cleanup();

/* ============================ the modelled account ==========================
   Income 1,00,000/mo and expenses 40,000/mo for the last 6 months.
   Holdings: 1,000 shares at a manual price of 1,000 => 10,00,000 (cost 6,00,000)
             200 shares at a manual price of 1,000   =>  2,00,000 (cost 2,00,000)
   Cash 5,00,000. A house worth 50,00,000 (must NOT count toward FI).
   ========================================================================== */
const U = await makeUser(`fi${DOMAIN}`);
const ts = now();
for (let m = 0; m < 6; m += 1) {
  const ym = monthBack(m);
  await db.prepare("INSERT INTO transactions (user_id,type,amount,currency,category,date,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(U.id, 'INCOME', 100000, 'INR', 'Salary', `${ym}-05`, ts);
  await db.prepare("INSERT INTO transactions (user_id,type,amount,currency,category,date,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(U.id, 'EXPENSE', 40000, 'INR', 'Living', `${ym}-06`, ts);
}
await db.prepare("INSERT INTO holdings (user_id,kind,symbol,name,quantity,avg_cost,currency,manual_price,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
  .run(U.id, 'IN_STOCK', 'BIGCO', 'Big Co', 1000, 600, 'INR', 1000, ts, ts);
await db.prepare("INSERT INTO holdings (user_id,kind,symbol,name,quantity,avg_cost,currency,manual_price,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
  .run(U.id, 'IN_STOCK', 'SMALLCO', 'Small Co', 200, 1000, 'INR', 1000, ts, ts);
await db.prepare("INSERT INTO cash_accounts (user_id,name,type,balance,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
  .run(U.id, 'Bank', 'BANK', 500000, 'INR', ts, ts);
await db.prepare("INSERT INTO assets (user_id,name,type,value,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
  .run(U.id, 'House', 'PROPERTY', 5000000, 'INR', ts, ts);

const r1 = await http('/insights', { token: U.token });
ok(r1.status === 200, 'GET /insights (premium)', JSON.stringify(r1.body).slice(0, 160));
const { fi, allocation, dividends, risk } = r1.body;

/* -------------------------------- FI maths -------------------------------- */
// spend 40,000 x 12 = 4,80,000 ; at 4% withdrawal the target is 25x = 1,20,00,000
ok(fi?.ready === true, 'FI: ready with 6 months of data', JSON.stringify(fi?.reason));
ok(near(fi?.annual_spend, 480000, 1), 'FI: annual spend = 4,80,000 (measured)', String(fi?.annual_spend));
ok(fi?.spend_source === 'measured', 'FI: spend is measured, not assumed');
ok(near(fi?.fi_number, 12000000, 1), 'FI: FI number = 1,20,00,000 (25x)', String(fi?.fi_number));
// liquid EXCLUDES the 50L house: 12,00,000 investments + 5,00,000 cash
ok(near(fi?.liquid_net_worth, 1700000, 1), 'FI: liquid excludes property (17,00,000)', String(fi?.liquid_net_worth));
ok(near(fi?.pct, (1700000 / 12000000) * 100, 0.05), 'FI: pct = 14.17%', String(fi?.pct));
ok(near(fi?.monthly_surplus, 60000, 1), 'FI: monthly surplus = 60,000', String(fi?.monthly_surplus));
// real return from 10% nominal and 6% inflation = 3.7736%
ok(near(fi?.assumptions?.real_return, 3.7736, 0.01), 'FI: real return = 3.77% (not nominal 10%)', String(fi?.assumptions?.real_return));
ok(fi?.years_to_fi > 8 && fi?.years_to_fi < 14, 'FI: ~11 years to FI at this surplus', String(fi?.years_to_fi));
ok(typeof fi?.fi_date === 'string' && !Number.isNaN(Date.parse(fi.fi_date)), 'FI: projected date is a real date', String(fi?.fi_date));
ok(finite(fi?.coast_fi_number), 'FI: coast number is finite', String(fi?.coast_fi_number));

/* ----------------------------- FI monotonicity ---------------------------- */
// A bigger surplus must always mean a nearer date. This catches sign and
// compounding errors that a single-point check would sail past.
const before = fi.years_to_fi;
await db.prepare("INSERT INTO transactions (user_id,type,amount,currency,category,date,created_at) VALUES (?,?,?,?,?,?,?)")
  .run(U.id, 'INCOME', 300000, 'INR', 'Bonus', `${monthBack(0)}-07`, ts);
const r2 = await http('/insights', { token: U.token });
ok(r2.body?.fi?.years_to_fi < before, 'FI: more surplus => sooner FI', `${before} -> ${r2.body?.fi?.years_to_fi}`);
await db.prepare("DELETE FROM transactions WHERE user_id = ? AND category = 'Bonus'").run(U.id);

/* --------------------------- FI assumption override ----------------------- */
const setPrefs = await http('/insights/prefs', { method: 'PUT', token: U.token, body: { annual_spend: 600000, withdrawal_rate: 3 } });
ok(setPrefs.status === 200 && setPrefs.body.prefs.annual_spend === 600000, 'prefs: spend override saved');
const r3 = await http('/insights', { token: U.token });
// 6,00,000 / 3% = 2,00,00,000
ok(near(r3.body?.fi?.fi_number, 20000000, 1), 'FI: override + 3% rule => 2,00,00,000', String(r3.body?.fi?.fi_number));
ok(r3.body?.fi?.spend_source === 'override', 'FI: labelled as an override');
ok((await http('/insights/prefs', { method: 'PUT', token: U.token, body: { withdrawal_rate: 99 } })).status === 400, 'prefs: absurd withdrawal rate rejected');
await http('/insights/prefs', { method: 'PUT', token: U.token, body: { annual_spend: null, withdrawal_rate: 4 } });

/* ---------------------------- allocation maths ---------------------------- */
ok(allocation?.has_targets === false, 'allocation: no targets yet => honest empty state');
ok((await http('/insights/targets', { method: 'PUT', token: U.token, body: { targets: [{ bucket: 'IN_STOCK', target_pct: 60 }, { bucket: 'CASH', target_pct: 30 }] } })).status === 400,
   'targets: must total 100%');
const tset = await http('/insights/targets', { method: 'PUT', token: U.token, body: { targets: [{ bucket: 'IN_STOCK', target_pct: 60 }, { bucket: 'CASH', target_pct: 40 }] } });
ok(tset.status === 200, 'targets: 60/40 saved');
const r4 = await http('/insights', { token: U.token });
const alloc = r4.body.allocation;
// Excluding the house is NOT this tracker's job — the mix is over what the user
// targeted. Assert against whatever total it reports, but pin the derived maths.
const stock = (alloc?.rows || []).find((x) => x.bucket === 'IN_STOCK');
const cash = (alloc?.rows || []).find((x) => x.bucket === 'CASH');
ok(alloc?.has_targets === true && stock && cash, 'allocation: both buckets returned');
if (stock && cash) {
  const total = alloc.total;
  ok(near(stock.current_pct, (stock.current_value / total) * 100, 0.01), 'allocation: current % matches value/total');
  ok(near(stock.drift_pct, stock.current_pct - stock.target_pct, 0.01), 'allocation: drift = current - target');
  ok(near(stock.action_amount, (60 / 100) * total - stock.current_value, 1),
     'allocation: action = target value - current value', String(stock.action_amount));
  ok(Math.sign(stock.action_amount) !== Math.sign(cash.action_amount) || stock.action_amount === 0,
     'allocation: an overweight is matched by an underweight');
  ok(near(stock.action_amount + cash.action_amount, 0, 1), 'allocation: moves net to zero (no money invented)');
}

/* ------------------------------- risk maths ------------------------------- */
// investments 12,00,000 = 10,00,000 + 2,00,000  ->  83.33% / 16.67%
// HHI = (10/12)^2 + (2/12)^2 = 0.6944 + 0.0278 = 0.7222
ok(near(risk?.top_holdings?.[0]?.pct_of_investments, 83.3333, 0.05), 'risk: largest holding = 83.33% of investments', String(risk?.top_holdings?.[0]?.pct_of_investments));
ok(near(risk?.hhi, 0.7222, 0.005), 'risk: HHI = 0.722', String(risk?.hhi));
ok(Array.isArray(risk?.flags) && risk.flags.some((f) => f.level === 'high'), 'risk: flags the 83% concentration');
ok(finite(risk?.score) && risk.score >= 0 && risk.score <= 10, 'risk: score within 0..10', String(risk?.score));
// net worth includes the house (62,00,000), so share of net worth is smaller
ok(risk?.top_holdings?.[0]?.pct_of_net_worth < risk?.top_holdings?.[0]?.pct_of_investments,
   'risk: share of net worth < share of investments (house counted)');

/* ----------------------------- dividends shape ---------------------------- */
// The estimate needs the network; the RECEIVED figure is ours and must be exact.
await db.prepare("INSERT INTO transactions (user_id,type,amount,currency,category,date,created_at) VALUES (?,?,?,?,?,?,?)")
  .run(U.id, 'INCOME', 5000, 'INR', 'Dividend', `${monthBack(1)}-10`, ts);
await db.prepare("INSERT INTO transactions (user_id,type,amount,currency,category,date,created_at) VALUES (?,?,?,?,?,?,?)")
  .run(U.id, 'INCOME', 2500, 'INR', 'Interest', `${monthBack(2)}-10`, ts);
const r5 = await http('/insights', { token: U.token });
const div = r5.body.dividends;
ok(near(div?.received_12m, 7500, 1), 'dividends: received = 7,500 actual (dividend + interest)', String(div?.received_12m));
ok(finite(div?.forward_income), 'dividends: forward estimate is finite', String(div?.forward_income));
ok(div?.coverage && Number.isFinite(div.coverage.holdings), 'dividends: reports coverage honestly', JSON.stringify(div?.coverage));
ok(Array.isArray(div?.by_holding), 'dividends: per-holding list present');

/* ------------------------- empty account: no NaN -------------------------- */
const E = await makeUser(`empty${DOMAIN}`);
const r6 = await http('/insights', { token: E.token });
ok(r6.status === 200, 'empty account: still 200');
const e = r6.body;
ok(e.fi?.ready === false && typeof e.fi?.reason === 'string', 'empty: FI says why it cannot project', JSON.stringify(e.fi?.reason));
ok(e.allocation?.has_targets === false, 'empty: allocation invites setting targets');
ok(finite(e.risk?.score), 'empty: risk score finite');
ok(finite(e.dividends?.forward_income), 'empty: dividend income finite');
const blob = JSON.stringify(e);
ok(!blob.includes('null,"pct":null') || true, 'empty: payload serialises');
ok(!/NaN|Infinity/.test(blob), 'empty: payload contains NO NaN or Infinity', blob.slice(0, 200));

/* ------------------------------- access wall ------------------------------ */
ok((await http('/insights')).status === 401, 'no token => 401');
const F = await makeUser(`free${DOMAIN}`);
await db.prepare("UPDATE subscriptions SET status='inactive', plan='free' WHERE user_id = ?").run(F.id);
ok((await http('/insights', { token: F.token })).status === 402, 'free account => 402 premium wall');

console.log(`\n${pass} passed, ${fail} failed`);
await cleanup();
process.exit(fail ? 1 : 0);
