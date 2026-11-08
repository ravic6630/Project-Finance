// Financial health: six measured dimensions and the score that averages them.
// Run from server/ with the API up:  node --env-file-if-exists=.env test-financial-health.mjs
//
// The main fixture is built so every dimension lands on a number worked out by
// hand from the rules in services/health.js — if a threshold moves, this says
// which reading changed and by how much, not just "the score is different".
import bcrypt from 'bcryptjs';
import { db, now } from './src/db.js';
import { cashflowMonths } from './src/services/summary.js';
import { bandFor, curve, isFundLike, MIN_DIMENSIONS } from './src/services/health.js';

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

async function http(path, { token, method = 'GET', body: payload } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, body, text };
}

const DOMAIN = '@healthtest.sampada';
const PW = 'secret123';

async function cleanup() {
  const rows = await db.prepare(`SELECT id FROM users WHERE email LIKE '%${DOMAIN}'`).all();
  for (const { id } of rows) {
    for (const t of ['sessions', 'subscriptions', 'holdings', 'cash_accounts', 'assets', 'transactions', 'budgets', 'goals', 'insight_prefs', 'health_prefs', 'net_worth_snapshots', 'email_prefs']) {
      try {
        await db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
      } catch {}
    }
    await db.prepare('DELETE FROM family_links WHERE inviter_id = ? OR invitee_id = ?').run(id, id);
    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
}

async function makeUser(email, name) {
  const info = await db
    .prepare('INSERT INTO users (email, name, password_hash, base_currency, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(email, name, bcrypt.hashSync(PW, 10), 'INR', 'user', now());
  const id = Number(info.lastInsertRowid);
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json());
  return { id, email, token: login.token };
}

const ts = now();
const addHolding = (uid, kind, symbol, name, qty, avg, price, nominee) =>
  db
    .prepare('INSERT INTO holdings (user_id,kind,symbol,name,quantity,avg_cost,currency,manual_price,nominee_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(uid, kind, symbol, name, qty, avg, 'INR', price, nominee, ts, ts);
const addTxn = (uid, type, amount, category, date) =>
  db
    .prepare('INSERT INTO transactions (user_id,type,amount,currency,category,date,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(uid, type, amount, 'INR', category, date, ts);
const dim = (body, key) => (body.dimensions || []).find((d) => d.key === key) || {};

/* ------------------------------- pure rules -------------------------------- */
console.log('— rules —');
const K = [[0, 0], [0.1, 50], [0.2, 80], [0.3, 100]];
ok(curve(-0.5, K) === 0 && curve(0.5, K) === 100, 'curve clamps at both ends');
ok(curve(0.15, K) === 65, 'curve interpolates between knots', String(curve(0.15, K)));
ok(curve(0.2, K) === 80, 'curve hits a knot exactly');
ok(curve(NaN, K) === null, 'curve refuses NaN rather than inventing a score');
ok(bandFor(80).key === 'excellent' && bandFor(79).key === 'good' && bandFor(60).key === 'good', 'bands: 80 excellent, 60–79 good');
ok(bandFor(59).key === 'fair' && bandFor(40).key === 'fair' && bandFor(39).key === 'needs_attention', 'bands: 40–59 fair, below 40 needs attention');
ok(bandFor(null) === null, 'no score => no band');
ok(isFundLike({ kind: 'IN_MF', name: 'Parag Parikh Flexi Cap' }), 'a mutual fund is a basket');
ok(isFundLike({ kind: 'IN_STOCK', symbol: 'NIFTYBEES', name: 'Nippon India ETF Nifty 50' }), 'an ETF filed as a stock is a basket');
ok(isFundLike({ kind: 'US_STOCK', symbol: 'VOO', name: 'Vanguard S&P 500 ETF' }), 'a US ETF is a basket');
ok(!isFundLike({ kind: 'IN_STOCK', symbol: 'RELIANCE', name: 'Reliance Industries' }), 'a company is not a basket');
ok(!isFundLike({ kind: 'IN_STOCK', symbol: 'FINDEX', name: 'Findex Ltd' }), 'a word merely containing INDEX is not a fund');

await cleanup();

/* ------------------------------ main fixture ------------------------------- */
console.log('— measured fixture —');
const ravi = await makeUser(`ravi${DOMAIN}`, 'Ravi Health');
// Six months, current one included, each: 1,00,000 in, 85,000 out.
for (const { key } of cashflowMonths()) {
  await addTxn(ravi.id, 'INCOME', 100000, 'Salary', `${key}-02`);
  await addTxn(ravi.id, 'EXPENSE', 9000, 'Food', `${key}-03`);
  await addTxn(ravi.id, 'EXPENSE', 31500, 'Rent', `${key}-03`);
  await addTxn(ravi.id, 'EXPENSE', 8000, 'shopping', `${key}-04`); // lower-case: budgets match case-insensitively
  await addTxn(ravi.id, 'EXPENSE', 36500, 'Other', `${key}-05`);
}
// Food within; Rent 5% over (half credit); Shopping 60% over.
for (const [cat, amt] of [['Food', 10000], ['Rent', 30000], ['Shopping', 5000]]) {
  await db.prepare('INSERT INTO budgets (user_id,category,amount,currency,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(ravi.id, cat, amt, 'INR', ts, ts);
}
await db.prepare('INSERT INTO cash_accounts (user_id,name,type,balance,currency,nominee_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(ravi.id, 'HDFC Savings', 'BANK', 255000, 'INR', 'registered', ts, ts);
await addHolding(ravi.id, 'IN_STOCK', 'BIGCOTEST', 'Big Co', 1000, 500, 600, 'registered'); // 6,00,000 — 60% of investments
await addHolding(ravi.id, 'IN_STOCK', 'SMALLCOTEST', 'Small Co', 1000, 130, 100, 'none'); // 1,00,000 — below cost
await addHolding(ravi.id, 'IN_MF', null, 'Test Index Fund', 1000, 250, 300, null); // 3,00,000

const r = await http('/financial-health', { token: ravi.token });
ok(r.status === 200, 'GET /financial-health => 200', `${r.status} ${r.text.slice(0, 200)}`);
const b = r.body;
ok(!/NaN|Infinity/.test(r.text), 'no NaN or Infinity anywhere in the response');
ok(b.total === 6 && b.scored === 6, 'all six dimensions measured', `${b.scored}/${b.total}`);

const sav = dim(b, 'savings');
ok(sav.score === 65, 'savings: 15% kept => 65', JSON.stringify(sav).slice(0, 200));
ok(sav.band?.key === 'good' && /15\.0%/.test(sav.value), 'savings: says 15.0% and is Good', sav.value);
ok(/₹5,000/.test(sav.tip), 'savings tip: ₹5,000 more a month reaches 20%', sav.tip);

const em = dim(b, 'emergency');
ok(em.score === 60, 'emergency: 3.0 months of cash => 60', JSON.stringify(em).slice(0, 200));
ok(/3\.0 months/.test(em.value) && em.metrics?.spend_source === 'measured', 'emergency: 3.0 months, from measured spending', em.value);
ok(/2,55,000/.test(em.tip), 'emergency tip: ₹2,55,000 more to six months (Indian grouping)', em.tip);

const bu = dim(b, 'budgets');
ok(bu.score === 50, 'budgets: 1 within + 1 slightly over of 3 => 50', JSON.stringify(bu).slice(0, 240));
ok(/1 of 3 categories/.test(bu.value), 'budgets: "1 of 3 categories stayed within budget"', bu.value);
ok(/Shopping ran 60% over, by ₹3,000/.test(bu.tip), 'budgets tip names the worst overspend', bu.tip);

const dv = dim(b, 'diversification');
ok(dv.score === 39, 'diversification: largest 60% (15) and 2 categories (75) => 39', JSON.stringify(dv).slice(0, 240));
ok(/Big Co/.test(dv.value) && /60%/.test(dv.value), 'diversification names Big Co at 60%', dv.value);
ok(/₹5,00,000/.test(dv.tip), 'diversification tip: ₹5,00,000 to bring Big Co to 10%', dv.tip);
ok(Math.abs(dv.metrics?.fund_share - 0.3) < 1e-9, 'the index fund is a basket, not a concentration');

const gr = dim(b, 'growth');
ok(gr.score === 76, 'growth: +13.6% on cost => 76', JSON.stringify(gr).slice(0, 200));
ok(/up 13\.6%/.test(gr.value) && /₹1,20,000 ahead/.test(gr.value), 'growth: up 13.6%, ₹1,20,000 ahead', gr.value);
ok(/1 of 3 holdings is below cost; Small Co/.test(gr.tip), 'growth tip names the biggest drag', gr.tip);

const pr = dim(b, 'protect');
ok(pr.score === 36, 'protect: half nominated, no legacy contact => 36', JSON.stringify(pr).slice(0, 240));
ok(/2 of 4 accounts and holdings have a nominee/.test(pr.value), 'protect: 2 of 4 have a nominee', pr.value);
ok(/2 items have no registered nominee/.test(pr.tip) && pr.action?.to === '/legacy', 'protect tip points to the nominee gaps', pr.tip);

ok(b.score === 54, 'overall: mean of 65,60,50,39,76,36 => 54', String(b.score));
ok(b.band?.key === 'fair', 'overall band: Fair', JSON.stringify(b.band));
ok(b.weakest?.key === 'protect' && b.weakest.score === 36, 'weakest: Plan & protect', JSON.stringify(b.weakest));
ok(b.not_scored?.some((n) => /debt-to-income/i.test(n)), 'says plainly that borrowing is not scored');
ok(b.dimensions.every((d) => d.available && d.target && d.tip && d.action?.to), 'every measured card has a target, a tip and a next step');

/* ----------------------------- the dashboard ------------------------------- */
console.log('— dashboard embed —');
const dash = await http('/dashboard', { token: ravi.token });
ok(dash.status === 200, 'GET /dashboard => 200', String(dash.status));
ok(dash.body.financial_health?.score === 54, 'dashboard carries the same score', JSON.stringify(dash.body.financial_health?.score));
ok(!('items' in dash.body), 'dashboard does not leak the holdings list it priced for the score');
ok(typeof dash.body.net_worth === 'number' && dash.body.allocation_tree && typeof dash.body.allocation_tree === 'object', 'dashboard keeps its usual shape (net worth, allocation tree)');
const dashMe = await http('/dashboard?profile=me', { token: ravi.token });
ok(dashMe.status === 200 && dashMe.body.financial_health === null, 'a single-profile view carries no whole-account score');

/* --------------------------- optional dimensions --------------------------- */
console.log('— optional dimensions —');
ok(dim(b, 'savings').optional && dim(b, 'protect').optional, 'savings rate and plan & protect are optional');
ok(['emergency', 'budgets', 'diversification', 'growth'].every((k) => dim(b, k).optional === false), 'the other four are not');
ok(b.dimensions.every((d) => d.counted === true) && b.excluded?.length === 0, 'everything counts by default');

const putPrefs = (excluded) => http('/financial-health/settings', { token: ravi.token, method: 'PUT', body: { excluded } });
const o1 = await putPrefs(['savings']);
ok(o1.status === 200 && o1.body.score === 52, 'savings left out: mean of 60,50,39,76,36 => 52', `${o1.status} ${o1.body.score} ${o1.text.slice(0, 120)}`);
ok(o1.body.total === 5 && o1.body.scored === 5, 'the count becomes 5 of 5', `${o1.body.scored}/${o1.body.total}`);
ok(dim(o1.body, 'savings').counted === false && dim(o1.body, 'savings').score === 65, 'the savings card keeps its reading (65), marked not counted');
const o2 = await putPrefs(['savings', 'protect']);
ok(o2.body.score === 56 && o2.body.total === 4, 'legacy card left out too: mean of 60,50,39,76 => 56 across 4', `${o2.body.score} ${o2.body.total}`);
ok(o2.body.weakest?.key === 'diversification', 'a left-out dimension is never the weakest area', JSON.stringify(o2.body.weakest));
ok(o2.body.band?.key === 'fair' && o2.body.excluded.join() === 'savings,protect', 'response says which are left out');
const o3 = await http('/financial-health', { token: ravi.token });
ok(o3.body.score === 56, 'the choice is saved', String(o3.body.score));
const o4 = await http('/dashboard', { token: ravi.token });
ok(o4.body.financial_health?.score === 56, 'and the dashboard card uses it', String(o4.body.financial_health?.score));
ok((await putPrefs(['growth'])).status === 400, 'a required dimension cannot be left out (400)');
ok((await putPrefs(['bogus'])).status === 400, 'an unknown key is refused (400)');
ok((await http('/financial-health/settings', { token: ravi.token, method: 'PUT', body: { excluded: 'savings' } })).status === 400, 'excluded must be a list (400)');
ok((await http('/financial-health', { token: ravi.token })).body.score === 56, 'a refused change leaves the saved choice alone');
await db.prepare('UPDATE health_prefs SET left_out = ? WHERE user_id = ?').run('["growth","savings","nope"]', ravi.id);
const o5 = await http('/financial-health', { token: ravi.token });
ok(o5.body.score === 52 && o5.body.excluded.join() === 'savings', 'stored keys that are not optional are ignored', `${o5.body.score} ${o5.body.excluded}`);
await db.prepare('UPDATE health_prefs SET left_out = ? WHERE user_id = ?').run('not json', ravi.id);
ok((await http('/financial-health', { token: ravi.token })).body.score === 54, 'an unreadable stored value counts everything');
const o6 = await putPrefs([]);
ok(o6.status === 200 && o6.body.score === 54 && o6.body.total === 6, 'counting everything again => back to 54 across 6', `${o6.body.score} ${o6.body.total}`);
ok((await http('/financial-health/settings', { method: 'PUT', body: { excluded: [] } })).status === 401, 'settings need a token (401)');

/* --------------------------- protect moves the score ----------------------- */
console.log('— legacy contact —');
const meera = await makeUser(`meera${DOMAIN}`, 'Meera Health');
await db.prepare("INSERT INTO family_links (inviter_id, invitee_email, invitee_id, status, created_at, accepted_at) VALUES (?,?,?,?,?,?)").run(ravi.id, meera.email, meera.id, 'active', ts, ts);
await db.prepare('UPDATE users SET legacy_enabled = 1, legacy_contact_user_id = ? WHERE id = ?').run(meera.id, ravi.id);
const r2 = await http('/financial-health', { token: ravi.token });
ok(dim(r2.body, 'protect').score === 64, 'naming a linked legacy contact lifts protect 36 => 64', String(dim(r2.body, 'protect').score));
ok(r2.body.score === 59, 'and the overall 54 => 59', String(r2.body.score));
await db.prepare("UPDATE family_links SET status = 'removed' WHERE inviter_id = ?").run(ravi.id);
const r3 = await http('/financial-health', { token: ravi.token });
ok(dim(r3.body, 'protect').score === 36, 'a severed link no longer counts as a contact', String(dim(r3.body, 'protect').score));

/* ------------------------------ thin accounts ------------------------------ */
console.log('— thin accounts —');
const empty = await makeUser(`empty${DOMAIN}`, 'Empty Health');
const e = await http('/financial-health', { token: empty.token });
ok(e.status === 200 && e.body.score === null && e.body.band === null, 'empty account: no score, no band', JSON.stringify(e.body).slice(0, 160));
ok(e.body.scored === 0 && e.body.dimensions.every((d) => !d.available && d.score === null && d.reason), 'empty account: every card says what would unlock it');
ok(!/NaN|Infinity/.test(e.text), 'empty account: no NaN anywhere');
const eDash = await http('/dashboard', { token: empty.token });
ok(eDash.status === 200 && eDash.body.financial_health?.scored === 0, 'empty dashboard still loads, with nothing scored');

const holder = await makeUser(`holder${DOMAIN}`, 'Holder Health');
await addHolding(holder.id, 'IN_STOCK', 'NIFTYBEES', 'Nippon India ETF Nifty 50', 100, 200, 250, 'registered');
await addHolding(holder.id, 'IN_STOCK', 'ONECOTEST', 'One Co', 10, 1000, 900, 'registered');
const h1 = await http('/financial-health', { token: holder.token });
ok(h1.body.scored === 3 && h1.body.score !== null, `holdings only: ${MIN_DIMENSIONS} dimensions measured => a score`, `${h1.body.scored} ${h1.body.score}`);
ok(!dim(h1.body, 'savings').available && /two months/.test(dim(h1.body, 'savings').reason), 'holdings only: savings explains it needs two months');
// ETF 25,000 + One Co 9,000: the largest COMPANY is One Co at 26%, not the ETF at 74%.
ok(/One Co/.test(dim(h1.body, 'diversification').value), 'the ETF is not mistaken for the biggest single company', dim(h1.body, 'diversification').value);

await db.prepare('INSERT INTO insight_prefs (user_id, annual_spend, updated_at) VALUES (?,?,?)').run(holder.id, 1200000, ts);
const h2 = await http('/financial-health', { token: holder.token });
const he = dim(h2.body, 'emergency');
ok(he.available && he.score === 0 && he.metrics?.spend_source === 'set', 'set annual spending unlocks the emergency fund (no cash => 0)', JSON.stringify(he).slice(0, 200));
ok(/from the figure you set/.test(he.value), 'and says the spending figure was the one the user set', he.value);

const thin = await makeUser(`thin${DOMAIN}`, 'Thin Health');
await db.prepare('INSERT INTO cash_accounts (user_id,name,type,balance,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(thin.id, 'Wallet', 'CASH', 5000, 'INR', ts, ts);
const t1 = await http('/financial-health', { token: thin.token });
ok(t1.body.scored === 1 && t1.body.score === null, 'one measurable dimension is not dressed up as a verdict', `${t1.body.scored} ${t1.body.score}`);
ok(/1 of 6 measured so far/.test(t1.body.headline), 'the headline says how far along it is', t1.body.headline);

/* -------------------------------- access ---------------------------------- */
console.log('— access —');
const anon = await http('/financial-health');
ok(anon.status === 401, 'no token => 401', String(anon.status));
const up = await http('/health');
ok(up.status === 200 && up.body.ok === true, 'the uptime check at /api/health is untouched');

await cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
