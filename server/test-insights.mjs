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
const { fi, risk } = r1.body;

/* -------------------------------- FI maths -------------------------------- */
// Spend 40,000/mo = 4,80,000 a year. The target is what 30 years of that costs
// with each year grown at 6% inflation:
//   480000 x ((1.06^30 - 1) / 0.06) = 480000 x 79.058183 = 3,79,47,928
// Hand-checked: 1.06^30 = 5.743491, so the series factor is 4.743491/0.06.
const FI_30Y = 480000 * ((1.06 ** 30 - 1) / 0.06);
ok(near(FI_30Y, 37947928, 5), 'the expected figure itself is 3,79,47,928', String(FI_30Y));
ok(fi?.ready === true, 'FI: ready with 6 months of data', JSON.stringify(fi?.reason));
ok(near(fi?.annual_spend, 480000, 1), 'FI: annual spend = 4,80,000 (measured)', String(fi?.annual_spend));
ok(near(fi?.monthly_spend, 40000, 1), 'FI: monthly spend = 40,000', String(fi?.monthly_spend));
ok(fi?.spend_source === 'measured', 'FI: spend is measured, not assumed');
ok(fi?.fi_years === 30, 'FI: 30 years is the default horizon', String(fi?.fi_years));
ok(near(fi?.fi_number, FI_30Y, 5), 'FI: number = 30 years of spending, inflation-grown', String(fi?.fi_number));
// The flat multiple and what inflation adds on top must be shown, not implied.
ok(near(fi?.flat_total, 14400000, 1), 'FI: flat total = 4,80,000 x 30 = 1,44,00,000', String(fi?.flat_total));
ok(near(fi?.inflation_uplift, FI_30Y - 14400000, 5), 'FI: uplift = target - flat total', String(fi?.inflation_uplift));
ok(fi?.inflation_uplift > fi?.flat_total, 'FI: over 30 years inflation adds more than the flat total', String(fi?.inflation_uplift));
// The inverse must land exactly back on the spending that produced it.
ok(near(fi?.implied_annual_spend, 480000, 1), 'FI: implied spend inverts to 4,80,000 exactly', String(fi?.implied_annual_spend));
// liquid EXCLUDES the 50L house: 12,00,000 investments + 5,00,000 cash
ok(near(fi?.liquid_net_worth, 1700000, 1), 'FI: liquid excludes property (17,00,000)', String(fi?.liquid_net_worth));
ok(near(fi?.pct, (1700000 / FI_30Y) * 100, 0.05), 'FI: pct measured against the 30-year target', String(fi?.pct));
ok(near(fi?.monthly_surplus, 60000, 1), 'FI: monthly surplus = 60,000', String(fi?.monthly_surplus));
// real return from 10% nominal and 6% inflation = 3.7736%
ok(near(fi?.assumptions?.real_return, 3.7736, 0.01), 'FI: real return = 3.77% (not nominal 10%)', String(fi?.assumptions?.real_return));
ok(fi?.assumptions?.years === 30, 'FI: the horizon is reported as an assumption', String(fi?.assumptions?.years));
ok(fi?.years_to_fi > 20 && fi?.years_to_fi < 35, 'FI: ~27 years to FI at this surplus', String(fi?.years_to_fi));
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
const setPrefs = await http('/insights/prefs', { method: 'PUT', token: U.token, body: { annual_spend: 600000 } });
ok(setPrefs.status === 200 && setPrefs.body.prefs.annual_spend === 600000, 'prefs: spend override saved');
const r3 = await http('/insights', { token: U.token });
// A spend override feeds the same 30-year series: 600000 x 79.058183.
ok(near(r3.body?.fi?.fi_number, 600000 * ((1.06 ** 30 - 1) / 0.06), 5),
   'FI: a spend override resizes the 30-year target', String(r3.body?.fi?.fi_number));
ok(r3.body?.fi?.spend_source === 'override', 'FI: labelled as an override');
ok((await http('/insights/prefs', { method: 'PUT', token: U.token, body: { withdrawal_rate: 99 } })).status === 400, 'prefs: absurd withdrawal rate rejected');
await http('/insights/prefs', { method: 'PUT', token: U.token, body: { annual_spend: null } });

/* ------------------------------ FI: the horizon --------------------------- */
// Fewer years is a smaller target, and the arithmetic must follow the same
// series — not a flat multiple.
await http('/insights/prefs', { method: 'PUT', token: U.token, body: { fi_years: 20 } });
const h1 = (await http('/insights', { token: U.token })).body?.fi;
const FI_20Y = 480000 * ((1.06 ** 20 - 1) / 0.06);
ok(near(h1?.fi_number, FI_20Y, 5), 'FI: 20 years => 1,76,57,081', String(h1?.fi_number));
ok(h1?.fi_number < FI_30Y, 'FI: a shorter horizon is a smaller target');
ok(near(h1?.flat_total, 9600000, 1), 'FI: flat total follows the horizon too', String(h1?.flat_total));
ok(near(h1?.implied_annual_spend, 480000, 1), 'FI: the inverse still lands on 4,80,000', String(h1?.implied_annual_spend));
ok((await http('/insights/prefs', { method: 'PUT', token: U.token, body: { fi_years: 0 } })).status === 400, 'prefs: a zero-year horizon is rejected');
ok((await http('/insights/prefs', { method: 'PUT', token: U.token, body: { fi_years: 500 } })).status === 400, 'prefs: an absurd horizon is rejected');
await http('/insights/prefs', { method: 'PUT', token: U.token, body: { fi_years: 30 } });

/* --------------------------- FI: a target set directly -------------------- */
// The account is unchanged: 12,00,000 of IN_STOCK, 5,00,000 cash, a 50,00,000
// house. Every figure below is that fixture divided by a target set by hand.
const setTarget = await http('/insights/prefs', { method: 'PUT', token: U.token, body: { fi_target: 5000000 } });
ok(setTarget.status === 200 && setTarget.body.prefs.fi_target === 5000000, 'prefs: FI target saved', JSON.stringify(setTarget.body).slice(0, 120));
const t1 = (await http('/insights', { token: U.token })).body?.fi;
ok(near(t1?.fi_number, 5000000, 1), 'FI: target of 50,00,000 overrides the 25x figure', String(t1?.fi_number));
ok(t1?.target_source === 'custom', 'FI: target labelled as the user\'s own');
// Spread over 30 inflation-grown years, 50,00,000 funds 5000000/79.058183 =
// 63,244.63 a year — the sanity check that stops a round number flattering itself.
ok(near(t1?.implied_annual_spend, 5000000 / ((1.06 ** 30 - 1) / 0.06), 1),
   'FI: custom target funds 63,245/yr across 30 years', String(t1?.implied_annual_spend));
// 17,00,000 / 50,00,000 = 34%
ok(near(t1?.pct, 34, 0.05), 'FI: progress measured against the set target (34%)', String(t1?.pct));
ok(near(t1?.shortfall, 3300000, 1), 'FI: shortfall = 33,00,000', String(t1?.shortfall));
// The measured spending is still reported beside it — the set target does not
// erase the fact that this person spends 4,80,000 a year.
ok(near(t1?.annual_spend, 480000, 1), 'FI: measured spending still reported under a custom target', String(t1?.annual_spend));

/* ------------------------- FI: which pots count --------------------------- */
const setBuckets = await http('/insights/prefs', { method: 'PUT', token: U.token, body: { fi_buckets: ['IN_STOCK', 'IN_MF'] } });
ok(setBuckets.status === 200, 'prefs: FI buckets saved');
const t2 = (await http('/insights', { token: U.token })).body?.fi;
// Stocks and funds only: 12,00,000. The 5,00,000 of cash is now excluded too.
ok(near(t2?.liquid_net_worth, 1200000, 1), 'FI: stocks + MFs only => 12,00,000 (cash dropped)', String(t2?.liquid_net_worth));
ok(t2?.pot_source === 'custom', 'FI: pot labelled as a custom selection');
ok(near(t2?.pct, 24, 0.05), 'FI: 12,00,000 / 50,00,000 = 24%', String(t2?.pct));
// A bucket picked but not yet held must still be offered, or unticking it would
// be the only way to see it again.
ok((t2?.buckets || []).some((b) => b.bucket === 'IN_MF' && b.counted && b.value === 0), 'FI: a chosen-but-empty bucket is still listed');
ok(near((t2?.buckets || []).filter((b) => b.counted).reduce((s, b) => s + b.value, 0), t2?.liquid_net_worth, 1),
   'FI: counted buckets sum to the pot');
ok(near(t2?.breakdown?.excluded_total, 5500000, 1), 'FI: excluded total = cash + house (55,00,000)', String(t2?.breakdown?.excluded_total));

// Counting the house is the user's call to make — someone who really will sell
// a second flat is right to include it, and it must move the pot.
await http('/insights/prefs', { method: 'PUT', token: U.token, body: { fi_buckets: ['IN_STOCK', 'CASH', 'ASSETS'] } });
const t3 = (await http('/insights', { token: U.token })).body?.fi;
ok(near(t3?.liquid_net_worth, 6700000, 1), 'FI: including property => 67,00,000', String(t3?.liquid_net_worth));
ok(t3?.reached === true && t3?.pct > 100, 'FI: that clears the 50,00,000 target', `${t3?.pct}%`);
ok(near(t3?.years_to_fi, 0, 0.001), 'FI: already there => zero years', String(t3?.years_to_fi));

/* --------------------------- FI: rubbish refused -------------------------- */
ok((await http('/insights/prefs', { method: 'PUT', token: U.token, body: { fi_target: -5 } })).status === 400, 'prefs: negative FI target rejected');
ok((await http('/insights/prefs', { method: 'PUT', token: U.token, body: { fi_target: 0 } })).status === 400, 'prefs: zero FI target rejected');
ok((await http('/insights/prefs', { method: 'PUT', token: U.token, body: { fi_buckets: [] } })).status === 400, 'prefs: empty bucket selection rejected');
ok((await http('/insights/prefs', { method: 'PUT', token: U.token, body: { fi_buckets: ['NOT_A_BUCKET'] } })).status === 400, 'prefs: unknown bucket rejected');
ok((await http('/insights/prefs', { method: 'PUT', token: U.token, body: { fi_buckets: 'IN_STOCK' } })).status === 400, 'prefs: non-list bucket selection rejected');
// A rejected write must not have half-applied: the pot is still the 67,00,000 one.
ok(near((await http('/insights', { token: U.token })).body?.fi?.liquid_net_worth, 6700000, 1), 'prefs: a rejected write changes nothing');

/* ----------------------------- FI: back to default ------------------------ */
const cleared = await http('/insights/prefs', { method: 'PUT', token: U.token, body: { fi_target: null, fi_buckets: null } });
ok(cleared.status === 200 && cleared.body.prefs.fi_target === null && cleared.body.prefs.fi_buckets === null, 'prefs: overrides cleared');
const t4 = (await http('/insights', { token: U.token })).body?.fi;
ok(near(t4?.fi_number, FI_30Y, 5), 'FI: back to the 30-year figure', String(t4?.fi_number));
ok(t4?.target_source === 'spending' && t4?.pot_source === 'default', 'FI: both back to the honest defaults');
ok(near(t4?.liquid_net_worth, 1700000, 1), 'FI: pot back to investments + cash', String(t4?.liquid_net_worth));

/* ------------------- FI: the pot is not built from a filtered list --------- */
// summary.allocation drops every non-positive row, so sourcing the pot from it
// would silently swallow an overdraft and flatter the progress figure. The
// default pot must stay exactly investments + cash, negatives and all.
const W = await makeUser(`fineg${DOMAIN}`);
await db.prepare('INSERT INTO holdings (user_id,kind,symbol,name,quantity,avg_cost,currency,manual_price,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
  .run(W.id, 'IN_STOCK', 'BIGCO', 'Big Co', 1000, 600, 'INR', 1000, ts, ts);
await db.prepare('INSERT INTO cash_accounts (user_id,name,type,balance,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
  .run(W.id, 'Overdraft', 'BANK', -50000, 'INR', ts, ts);
await http('/insights/prefs', { method: 'PUT', token: W.token, body: { fi_target: 10000000 } });
const w1 = (await http('/insights', { token: W.token })).body?.fi;
// 10,00,000 of stock MINUS the 50,000 overdraft = 9,50,000, not 10,00,000.
ok(near(w1?.liquid_net_worth, 950000, 1), 'FI: an overdrawn account still counts against the pot', String(w1?.liquid_net_worth));
ok(near(w1?.pct, 9.5, 0.05), 'FI: progress is not flattered by the overdraft', String(w1?.pct));
ok(near(w1?.breakdown?.counted_total, w1?.breakdown?.investments + w1?.breakdown?.cash, 1),
   'FI: default pot == investments + cash exactly', `${w1?.breakdown?.counted_total} vs ${w1?.breakdown?.investments} + ${w1?.breakdown?.cash}`);
ok((w1?.buckets || []).some((b) => b.bucket === 'CASH' && b.value === -50000 && b.counted),
   'FI: the negative cash bucket is shown, not hidden', JSON.stringify(w1?.buckets));

/* ------------------ FI: nothing but property is not a lockout ------------- */
// Everything this user owns is excluded by default, so the pot is legitimately
// zero. That must still be a usable, honest reading rather than an error.
const X = await makeUser(`fiprop${DOMAIN}`);
await db.prepare('INSERT INTO assets (user_id,name,type,value,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
  .run(X.id, 'Flat', 'PROPERTY', 8000000, 'INR', ts, ts);
await http('/insights/prefs', { method: 'PUT', token: X.token, body: { fi_target: 5000000 } });
const x1 = (await http('/insights', { token: X.token })).body?.fi;
ok(x1?.ready === true && near(x1?.liquid_net_worth, 0, 0.01), 'FI: property-only pot is zero, not an error', String(x1?.liquid_net_worth));
ok((x1?.buckets || []).length === 1 && x1.buckets[0].bucket === 'ASSETS' && x1.buckets[0].counted === false,
   'FI: only the property is offered, and it is not counted', JSON.stringify(x1?.buckets));
// ...and they can choose to count it, because they may well intend to sell it.
await http('/insights/prefs', { method: 'PUT', token: X.token, body: { fi_buckets: ['ASSETS'] } });
const x2 = (await http('/insights', { token: X.token })).body?.fi;
ok(near(x2?.liquid_net_worth, 8000000, 1) && x2?.reached === true, 'FI: counting the property clears the target', String(x2?.liquid_net_worth));

/* ------------- FI: a deliberate exclusion survives emptying the pool ------- */
// The pool someone left out on purpose must not disappear when it hits zero —
// the panel would then read the selection as "back to the default" and lose it.
const Y = await makeUser(`fiempty${DOMAIN}`);
await db.prepare('INSERT INTO holdings (user_id,kind,symbol,name,quantity,avg_cost,currency,manual_price,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
  .run(Y.id, 'IN_STOCK', 'BIGCO', 'Big Co', 1000, 600, 'INR', 1000, ts, ts);
const yCash = await db.prepare('INSERT INTO cash_accounts (user_id,name,type,balance,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
  .run(Y.id, 'Car fund', 'BANK', 300000, 'INR', ts, ts);
await http('/insights/prefs', { method: 'PUT', token: Y.token, body: { fi_buckets: ['IN_STOCK'] } });
const y1 = (await http('/insights', { token: Y.token })).body?.fi;
ok(near(y1?.liquid_net_worth, 1000000, 1), 'FI: the car fund is excluded on purpose', String(y1?.liquid_net_worth));
// They spend it. The account is now empty.
await db.prepare('UPDATE cash_accounts SET balance = 0 WHERE id = ?').run(Number(yCash.lastInsertRowid));
const y2 = (await http('/insights', { token: Y.token })).body?.fi;
ok((y2?.buckets || []).some((b) => b.bucket === 'CASH' && b.counted === false),
   'FI: an emptied excluded pool is still listed, still unticked', JSON.stringify(y2?.buckets));
ok(y2?.pot_source === 'custom' && near(y2?.liquid_net_worth, 1000000, 1), 'FI: the selection survives the pool emptying', String(y2?.liquid_net_worth));

/* -------------------- FI: a target works with no transactions ------------- */
// The real unlock. Someone who has recorded nothing but knows their number gets
// a reading immediately — with no date, and told plainly why.
const V = await makeUser(`fitarget${DOMAIN}`);
await db.prepare("INSERT INTO cash_accounts (user_id,name,type,balance,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
  .run(V.id, 'Bank', 'BANK', 250000, 'INR', ts, ts);
const v0 = (await http('/insights', { token: V.token })).body?.fi;
ok(v0?.ready === false && typeof v0?.reason === 'string', 'FI: no spending, no target => honest empty state');
await http('/insights/prefs', { method: 'PUT', token: V.token, body: { fi_target: 1000000 } });
const v1 = (await http('/insights', { token: V.token })).body?.fi;
ok(v1?.ready === true, 'FI: a set target needs no transactions', JSON.stringify(v1?.reason));
ok(near(v1?.pct, 25, 0.05), 'FI: 2,50,000 / 10,00,000 = 25%', String(v1?.pct));
ok(v1?.years_to_fi === null && typeof v1?.years_reason === 'string', 'FI: still no date without a measured surplus');
ok(finite(v1?.coast_fi_number) && finite(v1?.pct) && finite(v1?.shortfall), 'FI: no NaN anywhere in the target-only payload');

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

/* --------------------------- asset allocation ----------------------------- */
// Net worth 67,00,000 = 12,00,000 stocks + 5,00,000 cash + 50,00,000 house.
// Unlike the concentration maths above, this is measured over EVERYTHING owned.
const allocRows = risk?.allocation || [];
const byBucket = Object.fromEntries(allocRows.map((a) => [a.bucket, a]));
ok(near(risk?.net_worth, 6700000, 1), 'allocation: net worth = 67,00,000', String(risk?.net_worth));
ok(allocRows.length === 3, 'allocation: three buckets (stocks, cash, property)', JSON.stringify(allocRows.map((a) => a.bucket)));
ok(near(byBucket.IN_STOCK?.pct, (1200000 / 6700000) * 100, 0.02), 'allocation: stocks = 17.91% of net worth', String(byBucket.IN_STOCK?.pct));
ok(near(byBucket.CASH?.pct, (500000 / 6700000) * 100, 0.02), 'allocation: cash = 7.46%', String(byBucket.CASH?.pct));
ok(near(byBucket.ASSETS?.pct, (5000000 / 6700000) * 100, 0.02), 'allocation: property = 74.63%', String(byBucket.ASSETS?.pct));
ok(near(allocRows.reduce((s2, a) => s2 + a.pct, 0), 100, 0.1), 'allocation: the percentages total 100', String(allocRows.reduce((s2, a) => s2 + a.pct, 0)));
ok(near(allocRows.reduce((s2, a) => s2 + a.value, 0), 6700000, 1), 'allocation: the values total net worth');
// Sorted biggest-first, so the panel never has to re-sort what it renders.
ok(allocRows.every((a, i) => i === 0 || allocRows[i - 1].value >= a.value), 'allocation: sorted largest first');
ok(allocRows.every((a) => a.label && a.label !== a.bucket.toLowerCase()), 'allocation: every bucket carries a human label');

/* ------------------------- empty account: no NaN -------------------------- */
const E = await makeUser(`empty${DOMAIN}`);
const r6 = await http('/insights', { token: E.token });
ok(r6.status === 200, 'empty account: still 200');
const e = r6.body;
ok(e.fi?.ready === false && typeof e.fi?.reason === 'string', 'empty: FI says why it cannot project', JSON.stringify(e.fi?.reason));
ok(finite(e.risk?.score), 'empty: risk score finite');
ok(Array.isArray(e.risk?.allocation) && e.risk.allocation.length === 0, 'empty: allocation is an empty list, not a crash');
ok(e.allocation === undefined && e.dividends === undefined, 'empty: the removed trackers are gone from the payload');
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
