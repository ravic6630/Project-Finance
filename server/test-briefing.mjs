// "What changed since last visit" — the dashboard's since_last_visit block.
// Run from server/ with the API up:  node --env-file-if-exists=.env test-briefing.mjs
//
// The visit clock is rolled by createSession, so every case here signs in for
// real rather than writing the timestamps by hand: that way the test fails if
// the roll itself ever stops happening.
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

async function http(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const DOMAIN = '@brieftest.sampada';
const PW = 'secret123';
const istDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const dayOffset = (n) => istDay(new Date(Date.now() + n * 86400000));

async function cleanup() {
  const rows = await db.prepare(`SELECT id FROM users WHERE email LIKE '%${DOMAIN}'`).all();
  for (const { id } of rows) {
    for (const t of ['sessions', 'subscriptions', 'holdings', 'cash_accounts', 'assets', 'transactions',
                     'net_worth_snapshots', 'alerts', 'email_prefs']) {
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
    .run(email, 'Brief Tester', bcrypt.hashSync(PW, 10), 'INR', 'user', now());
  const id = Number(info.lastInsertRowid);
  await activatePremium(id, { provider: 'trial', days: 1 });
  return { id, email };
}

const signIn = async (email) => (await http('/auth/login', { method: 'POST', body: { email, password: PW } })).body.token;
const dashboard = async (token) => (await http('/dashboard', { token })).body;
const readUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

console.log('— since last visit —');
await cleanup();

const ts = now();
const U = await makeUser(`brief${DOMAIN}`);
await db.prepare('INSERT INTO cash_accounts (user_id,name,type,balance,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
  .run(U.id, 'Bank', 'BANK', 1000000, 'INR', ts, ts);

/* ------------------------------ the first visit --------------------------- */
// Nothing to compare against, and "welcome back" would be wrong on both words.
let token = await signIn(U.email);
let d = await dashboard(token);
ok(d.since_last_visit === null, 'first ever sign-in reports nothing', JSON.stringify(d.since_last_visit));
const afterFirst = await readUser(U.id);
ok(!!afterFirst.last_login_at, 'the visit clock starts on first sign-in');
ok(afterFirst.previous_login_at == null, 'and there is no previous visit yet');

/* ---------------------------- the clock rolls ----------------------------- */
const firstLoginAt = afterFirst.last_login_at;
token = await signIn(U.email);
const afterSecond = await readUser(U.id);
ok(afterSecond.previous_login_at === firstLoginAt, 'a second sign-in rolls the previous visit forward',
   `${afterSecond.previous_login_at} vs ${firstLoginAt}`);

/* --------------------------- quiet means silent --------------------------- */
// Two sign-ins seconds apart, nothing happened in between. A strip saying
// "nothing changed" costs attention and returns none, so there must be none.
d = await dashboard(token);
ok(d.since_last_visit === null, 'nothing to report => no briefing at all', JSON.stringify(d.since_last_visit));

/* ------------------------------- net worth -------------------------------- */
// Plant a snapshot dated before the last visit, then move the money.
await db.prepare('INSERT INTO net_worth_snapshots (user_id,date,net_worth,currency) VALUES (?,?,?,?) ' +
                 'ON CONFLICT(user_id,date) DO UPDATE SET net_worth=excluded.net_worth')
  .run(U.id, dayOffset(-3), 800000, 'INR');
// Backdate the previous visit so the -3d snapshot is genuinely "on or before" it.
await db.prepare('UPDATE users SET previous_login_at = ? WHERE id = ?')
  .run(new Date(Date.now() - 2 * 86400000).toISOString(), U.id);

d = await dashboard(token);
const b = d.since_last_visit;
ok(b && b.net_worth, 'a snapshot before the last visit gives a comparison', JSON.stringify(b));
ok(near(b?.net_worth?.then, 800000, 1), 'net worth then = 8,00,000', String(b?.net_worth?.then));
ok(near(b?.net_worth?.now, 1000000, 1), 'net worth now = 10,00,000', String(b?.net_worth?.now));
ok(near(b?.net_worth?.change, 200000, 1), 'change = +2,00,000', String(b?.net_worth?.change));
ok(near(b?.net_worth?.change_pct, 25, 0.01), 'change = +25%', String(b?.net_worth?.change_pct));
ok(b?.net_worth?.as_of === dayOffset(-3), 'the comparison names the day it came from', b?.net_worth?.as_of);
ok(b?.days_ago === 2, 'days_ago counts whole days', String(b?.days_ago));

/* ------------------------- dividends, alerts, holdings -------------------- */
await db.prepare('INSERT INTO transactions (user_id,type,amount,currency,category,date,created_at) VALUES (?,?,?,?,?,?,?)')
  .run(U.id, 'INCOME', 4000, 'INR', 'Dividend', dayOffset(-1), ts);
await db.prepare('INSERT INTO transactions (user_id,type,amount,currency,category,date,created_at) VALUES (?,?,?,?,?,?,?)')
  .run(U.id, 'INCOME', 1500, 'INR', 'Interest', dayOffset(-1), ts);
// Salary is income too, and must NOT be counted as a payout from the portfolio.
await db.prepare('INSERT INTO transactions (user_id,type,amount,currency,category,date,created_at) VALUES (?,?,?,?,?,?,?)')
  .run(U.id, 'INCOME', 90000, 'INR', 'Salary', dayOffset(-1), ts);
// An old dividend, before the last visit: already seen, must not resurface.
await db.prepare('INSERT INTO transactions (user_id,type,amount,currency,category,date,created_at) VALUES (?,?,?,?,?,?,?)')
  .run(U.id, 'INCOME', 7777, 'INR', 'Dividend', dayOffset(-30), ts);
await db.prepare('INSERT INTO alerts (user_id,kind,symbol,label,direction,threshold,currency,active,last_triggered_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run(U.id, 'IN_STOCK', 'BIGCO', 'Big Co', 'above', 1500, 'INR', 1, now(), ts, ts);
await db.prepare('INSERT INTO alerts (user_id,kind,symbol,label,direction,threshold,currency,active,last_triggered_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run(U.id, 'IN_STOCK', 'OLDCO', 'Old Co', 'below', 100, 'INR', 1, new Date(Date.now() - 30 * 86400000).toISOString(), ts, ts);

d = await dashboard(token);
const b2 = d.since_last_visit;
ok(near(b2?.income?.total, 5500, 1), 'dividends + interest = 5,500 (salary excluded)', JSON.stringify(b2?.income));
ok(b2?.income?.count === 2, 'and it counts 2 payouts, not the old one', String(b2?.income?.count));
ok(b2?.alerts?.length === 1, 'only the alert that fired since the last visit', JSON.stringify(b2?.alerts));
ok(b2?.alerts?.[0]?.label === 'Big Co', 'and it is the right one', b2?.alerts?.[0]?.label);
ok(b2?.holdings_added === 0, 'no holdings were added', String(b2?.holdings_added));

await db.prepare('INSERT INTO holdings (user_id,kind,symbol,name,quantity,avg_cost,currency,manual_price,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
  .run(U.id, 'IN_STOCK', 'NEWCO', 'New Co', 10, 100, 'INR', 100, now(), now());
d = await dashboard(token);
ok(d.since_last_visit?.holdings_added === 1, 'a holding added since the visit is reported', String(d.since_last_visit?.holdings_added));

/* ------------------------ nothing is invented ----------------------------- */
// A brand-new account has no snapshot to compare against. That must read as
// "no comparison", never as a confident zero change.
const V = await makeUser(`fresh${DOMAIN}`);
await signIn(V.email);
const vToken = await signIn(V.email);
await db.prepare('UPDATE users SET previous_login_at = ? WHERE id = ?')
  .run(new Date(Date.now() - 5 * 86400000).toISOString(), V.id);
await db.prepare('INSERT INTO transactions (user_id,type,amount,currency,category,date,created_at) VALUES (?,?,?,?,?,?,?)')
  .run(V.id, 'INCOME', 250, 'INR', 'Dividend', dayOffset(-1), now());
const vd = await dashboard(vToken);
ok(vd.since_last_visit != null, 'a payout alone is enough to report');
ok(vd.since_last_visit?.net_worth === null, 'with no snapshot, net worth is null — not a fake 0%',
   JSON.stringify(vd.since_last_visit?.net_worth));

/* ---------------------------- serialisation ------------------------------- */
const blob = JSON.stringify(d.since_last_visit);
ok(!/NaN|Infinity/.test(blob), 'the block contains no NaN or Infinity', blob.slice(0, 160));

console.log(`\n${pass} passed, ${fail} failed`);
await cleanup();
process.exit(fail ? 1 : 0);
