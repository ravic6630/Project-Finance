// Live demo: disposable, pre-filled accounts — and everything that keeps them safe.
// Run from server/ with the API up:  node --env-file-if-exists=.env test-demo.mjs
import bcrypt from 'bcryptjs';
import { db, now } from './src/db.js';
import { CHILD_TABLES, deleteAccount } from './src/services/accounts.js';
import { sendMail } from './src/services/email.js';
import { todayIST } from './src/services/recurring.js';

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

async function http(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json, text };
}

const made = new Set(); // every demo this run creates, removed at the end
const startDemo = async (opts = {}) => {
  const r = await http('/auth/demo', { method: 'POST', body: opts.body ?? {}, headers: opts.headers });
  if (r.body?.user?.id) made.add(r.body.user.id);
  return r;
};
const count = async (table, uid) => Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(uid)).n);
const today = todayIST();

/* -------------------------------- creation --------------------------------- */
console.log('— a demo starts —');
const d1 = await startDemo();
ok(d1.status === 201 && d1.body.token, 'POST /auth/demo => 201 with a token', `${d1.status} ${d1.text.slice(0, 160)}`);
const u1 = d1.body.user || {};
const t1 = d1.body.token;
ok(/^demo-[0-9a-f]{12}@demo\.invalid$/.test(u1.email), 'the address is at the reserved .invalid domain', u1.email);
const hoursLeft = (Date.parse(u1.demo_expires_at) - Date.now()) / 3600000;
ok(hoursLeft > 23.9 && hoursLeft <= 24, 'it expires in 24 hours', String(hoursLeft));
ok(u1.name === 'Asha' && u1.base_currency === 'INR', 'Asha, in rupees by default');
const me = await http('/auth/me', { token: t1 });
ok(me.status === 200 && me.body.user.demo_expires_at === u1.demo_expires_at, '/auth/me says it is a demo, and until when');
const pw = await http('/auth/login', { method: 'POST', body: { email: u1.email, password: 'anything-at-all' } });
ok(pw.status === 401, 'nobody can sign in to it with a password', String(pw.status));

/* ---------------------------------- data ----------------------------------- */
console.log('— the sample family —');
ok((await count('holdings', u1.id)) === 11, '11 holdings');
ok((await count('cash_accounts', u1.id)) === 4 && (await count('assets', u1.id)) === 2, '4 accounts and 2 assets');
ok((await count('goals', u1.id)) === 4 && (await count('budgets', u1.id)) === 4, '4 goals and 4 budgets');
ok((await count('profiles', u1.id)) === 1, 'one managed family member (Rohan)');
const late = await db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND date > ?').get(u1.id, today);
ok((await count('transactions', u1.id)) > 50 && Number(late.n) === 0, 'six months of transactions, none dated after today');
const snaps = await db.prepare('SELECT MIN(date) AS a, MAX(date) AS b, COUNT(*) AS n FROM net_worth_snapshots WHERE user_id = ?').get(u1.id);
ok(Number(snaps.n) > 100 && snaps.b < today, 'two years of net-worth history, stopping before today', JSON.stringify(snaps));
const rules = await db.prepare('SELECT MIN(start_date) AS s FROM recurring_rules WHERE user_id = ?').get(u1.id);
ok(rules.s > today, 'recurring rules start next month, so they backfill nothing', rules.s);

// Every holding's lots must leave exactly its quantity, at exactly its average
// cost — or Returns & tax and the Investments page tell different stories.
const holdings = await db.prepare('SELECT * FROM holdings WHERE user_id = ?').all(u1.id);
let lotsAgree = true;
let soldSomewhere = false;
for (const h of holdings) {
  const lots = await db.prepare('SELECT * FROM investment_txns WHERE holding_id = ? ORDER BY trade_date, id').all(h.id);
  const open = [];
  for (const l of lots) {
    if (l.type === 'BUY') open.push({ q: Number(l.quantity), p: Number(l.price) });
    else {
      soldSomewhere = true;
      let left = Number(l.quantity);
      while (left > 1e-9 && open.length) {
        const take = Math.min(left, open[0].q);
        open[0].q -= take;
        left -= take;
        if (open[0].q <= 1e-9) open.shift();
      }
    }
  }
  const q = open.reduce((s, o) => s + o.q, 0);
  const avg = open.reduce((s, o) => s + o.q * o.p, 0) / q;
  if (Math.abs(q - h.quantity) > 1e-6 || Math.abs(avg - h.avg_cost) / h.avg_cost > 1e-4) {
    lotsAgree = false;
    console.log('    mismatch', h.name, q, h.quantity, avg, h.avg_cost);
  }
}
ok(lotsAgree, 'every position’s lots add up to its quantity and average cost');
ok(soldSomewhere, 'one position was partly sold, so there is a realised gain to show');

const dash = await http('/dashboard', { token: t1 });
ok(dash.status === 200 && dash.body.net_worth > 0, 'the dashboard loads', `${dash.status}`);
ok(dash.body.premium === true && Array.isArray(dash.body.net_worth_history) && dash.body.net_worth_history.length > 100, 'with Premium and its net-worth history');
ok(dash.body.financial_health?.scored === 6, 'every financial health dimension can be measured', String(dash.body.financial_health?.scored));
ok(!/NaN|Infinity/.test(dash.text), 'no NaN anywhere on the dashboard');
const ret = await http('/returns', { token: t1 });
ok(ret.status === 200 && ret.body.portfolio?.realized?.total > 0, 'Returns & tax opens, with a realised gain', `${ret.status}`);
const goals = await http('/goals', { token: t1 });
ok(goals.status === 200 && goals.body.goals.length === 4, 'Goals opens with four planned goals');
const bill = await http('/billing/status', { token: t1 });
ok(bill.body.state?.plan === 'demo' && bill.body.state?.until === u1.demo_expires_at, 'billing says: the demo plan, until the demo ends');

/* -------------------------------- sandbox ---------------------------------- */
console.log('— everything inside stays open —');
const add = await http('/holdings', { method: 'POST', token: t1, body: { kind: 'IN_STOCK', symbol: 'WIPRO.NS', name: 'Wipro', quantity: 10, avg_cost: 250 } });
ok(add.status === 201, 'adding a holding works', `${add.status} ${add.text.slice(0, 120)}`);
const cur = await http('/auth/me', { method: 'PATCH', token: t1, body: { base_currency: 'USD' } });
ok(cur.status === 200 && cur.body.user.base_currency === 'USD', 'switching to dollars works');
const usd = await http('/dashboard', { token: t1 });
ok(usd.status === 200 && usd.body.net_worth > 0 && usd.body.net_worth < dash.body.net_worth / 50, 'and the dashboard comes back in dollars');
await http('/auth/me', { method: 'PATCH', token: t1, body: { base_currency: 'INR' } });
ok((await http('/support/thread', { token: t1 })).status === 200, 'reading the (empty) support thread is fine');

console.log('— everything that leaves the app is off —');
const blocked = [
  ['POST', '/family/invite', { email: 'friend@example.com' }],
  ['PUT', '/email/prefs', { daily: true }],
  ['POST', '/email/test', {}],
  ['POST', '/billing/checkout', { interval: 'month' }],
  ['GET', '/billing/manual-qr', undefined],
  ['GET', '/broker/zerodha/login-url', undefined],
  ['POST', '/broker/zerodha/connect', { request_token: 'x' }],
  ['POST', '/broker/upstox/sync', {}],
  ['POST', '/import/cas', {}],
  ['POST', '/support/thread', { body: 'hello' }],
  ['POST', '/auth/2fa/setup', {}],
];
for (const [method, path, body] of blocked) {
  const r = await http(path, { method, token: t1, body });
  ok(r.status === 403 && /demo/i.test(r.body.error || '') && /free account/i.test(r.body.error || ''), `${method} ${path} => 403, saying why and what to do`, `${r.status} ${r.text.slice(0, 120)}`);
}
ok((await http('/support/thread?x=1', { method: 'POST', token: t1, body: { body: 'hi' } })).status === 403, 'a query string doesn’t slip past the block');
const mail = await sendMail({ to: u1.email, subject: 'x', html: 'x' });
ok(mail?.skipped, 'the mailer refuses a demo address outright, whatever the route', JSON.stringify(mail));

/* -------------------------- real accounts untouched ------------------------ */
console.log('— real accounts —');
const realEmail = `real-${Date.now()}@demotest.sampada`;
const ins = await db
  .prepare('INSERT INTO users (email, name, password_hash, base_currency, role, created_at) VALUES (?,?,?,?,?,?)')
  .run(realEmail, 'Real Person', bcrypt.hashSync('secret123', 10), 'INR', 'admin', now());
const realId = Number(ins.lastInsertRowid);
const realTok = (await http('/auth/login', { method: 'POST', body: { email: realEmail, password: 'secret123' } })).body.token;
const realBill = await http('/billing/status', { token: realTok });
ok(realBill.body.state?.plan !== 'demo', 'a real account never gets the demo plan', JSON.stringify(realBill.body.state));
const realTest = await http('/email/test', { method: 'POST', token: realTok });
ok(!/demo/i.test(realTest.body.error || ''), 'a real account is not caught by the demo block', `${realTest.status} ${realTest.text.slice(0, 120)}`);
const overview = await http('/admin/overview', { token: realTok });
ok(overview.status === 200 && !overview.body.users.some((u) => u.email.endsWith('@demo.invalid')), 'the admin user list leaves demos out');
ok(overview.body.counts?.live_demos >= 1, 'but counts them', JSON.stringify(overview.body.counts));

/* ------------------------------- isolation --------------------------------- */
console.log('— each visitor gets their own —');
const d2 = await startDemo({ body: { base_currency: 'USD' } });
const t2 = d2.body.token;
ok(d2.status === 201 && d2.body.user.id !== u1.id, 'a second demo is a different account');
ok(d2.body.user.base_currency === 'USD', 'it can start in another currency');
ok((await count('holdings', d2.body.user.id)) === 11, 'with its own untouched data (the first demo’s new holding isn’t there)');
const h2 = await http('/holdings', { token: t2 });
ok(!(h2.body.holdings || []).some((h) => h.name === 'Wipro'), 'and it can’t see the first demo’s holdings');
const snapCur = await db.prepare('SELECT DISTINCT currency FROM net_worth_snapshots WHERE user_id = ?').all(d2.body.user.id);
ok(snapCur.length === 1 && snapCur[0].currency === 'USD', 'its history is recorded in its own currency');

/* ------------------------------ rate limiting ------------------------------ */
console.log('— rate limit —');
const ipHeaders = { 'X-Forwarded-For': `203.0.113.${Math.floor(Math.random() * 200) + 20}` };
const codes = [];
for (let i = 0; i < 7; i += 1) codes.push((await startDemo({ headers: ipHeaders })).status);
ok(codes.slice(0, 6).every((c) => c === 201) && codes[6] === 429, 'six demos an hour per address, then 429', codes.join(','));

/* -------------------------------- expiry ----------------------------------- */
console.log('— expiry and cleanup —');
await db.prepare('UPDATE users SET demo_expires_at = ? WHERE id = ?').run(new Date(Date.now() - 60000).toISOString(), u1.id);
const ended = await http('/dashboard', { token: t1 });
ok(ended.status === 401 && /demo has ended/i.test(ended.body.error || ''), 'an expired demo is signed out with a clear message', `${ended.status} ${ended.text.slice(0, 100)}`);
const { sweepDemos } = await import('./src/services/demo.js');
const swept = await sweepDemos();
ok(swept.deleted >= 1, 'the sweep deletes expired demos', JSON.stringify(swept));
let leftovers = 0;
for (const t of CHILD_TABLES) leftovers += await count(t, u1.id);
const gone = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(u1.id);
ok(Number(gone.n) === 0 && leftovers === 0, 'the account and every row it owned are gone', `user ${gone.n}, rows ${leftovers}`);
ok((await http('/dashboard', { token: t2 })).status === 200, 'a live demo survives the sweep');
ok(Number((await db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(realId)).n) === 1, 'and so does every real account');

/* ---------------------------------- cap ------------------------------------ */
console.log('— cap —');
const { n: live } = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE demo_expires_at IS NOT NULL').get();
const oldest = await db.prepare('SELECT id FROM users WHERE demo_expires_at IS NOT NULL ORDER BY demo_expires_at ASC, id ASC LIMIT 1').get();
process.env.DEMO_MAX_ACCOUNTS = String(live);
const capped = await import(`./src/services/demo.js?cap=${Date.now()}`);
const extra = await capped.createDemoAccount();
made.add(extra.id);
const { n: after } = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE demo_expires_at IS NOT NULL').get();
const oldestGone = Number((await db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(oldest.id)).n) === 0;
ok(Number(after) === Number(live) && oldestGone, `at the cap (${live}), a new demo removes the oldest`, `before ${live} after ${after} oldestGone ${oldestGone}`);

/* -------------------------------- cleanup ---------------------------------- */
for (const id of made) await deleteAccount(id).catch(() => {});
await deleteAccount(realId);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
