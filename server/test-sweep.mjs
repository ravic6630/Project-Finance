// Whole-app API regression sweep — every router, one throwaway premium user.
// Run from server/:  node --env-file-if-exists=.env test-sweep.mjs
import { createHash, createHmac } from 'node:crypto';
import { db, now } from './src/db.js';
import { activatePremium } from './src/services/billing.js';

const API = 'http://localhost:4000/api';
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

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
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

let token = null;
async function http(path, { method = 'GET', body, tok = token, raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = raw ? await res.text() : await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// --- inline RFC 6238 (server only exports verify) ---
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totpNow(secret) {
  const counter = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', b32decode(secret)).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const code = ((h.readUInt32BE(off) & 0x7fffffff) % 1e6).toString().padStart(6, '0');
  return code;
}

const EMAIL = 'sweep@sweeptest.sampada';
async function cleanup() {
  const rows = await db.prepare("SELECT id FROM users WHERE email LIKE '%@sweeptest.sampada'").all();
  for (const { id } of rows) {
    for (const t of [
      'sessions', 'subscriptions', 'holdings', 'cash_accounts', 'assets', 'transactions', 'goals',
      'goal_links', 'alerts', 'recurring_rules', 'budgets', 'profiles', 'net_worth_snapshots',
      'investment_txns', 'email_prefs', 'support_messages', 'password_reset_codes', 'broker_connections',
    ]) {
      try {
        await db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
      } catch {}
    }
    await db.prepare('DELETE FROM family_links WHERE inviter_id = ? OR invitee_id = ?').run(id, id);
    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
  await db.prepare("DELETE FROM pending_signups WHERE email LIKE '%@sweeptest.sampada'").run();
}

console.log('— whole-app sweep —');
await cleanup();

/* ---------------- 1. auth: signup → login → profile → reset → 2FA → sessions ---------------- */
ok((await http('/holdings', { tok: null })).status === 401, 'auth wall: 401 without token');
ok((await http('/nope')).status === 404, 'unknown API path → 404 JSON');

const su = await http('/auth/signup', { method: 'POST', body: { name: 'Sweep Tester', email: EMAIL, password: 'first-pass1', base_currency: 'INR' } });
ok(su.status === 202, 'signup starts (202)');
await db.prepare('UPDATE pending_signups SET otp_hash = ? WHERE email = ?').run(sha256('123456'), EMAIL);
const sv = await http('/auth/signup/verify', { method: 'POST', body: { email: EMAIL, code: '123456' } });
ok(sv.status === 201 && sv.json.token, 'signup verify → account + token');
token = sv.json.token;
const uid = sv.json.user.id;

const me = await http('/auth/me');
ok(me.json.user?.email === EMAIL, 'GET /auth/me');
ok((await http('/auth/me', { method: 'PATCH', body: { name: 'Sweep T.' } })).json.user?.name === 'Sweep T.', 'PATCH /auth/me name');

ok((await http('/auth/forgot', { method: 'POST', body: { email: EMAIL } })).status === 200, 'forgot-password accepted');
await db.prepare('UPDATE password_reset_codes SET otp_hash = ? WHERE user_id = ?').run(sha256('654321'), uid);
ok((await http('/auth/reset', { method: 'POST', body: { email: EMAIL, code: '654321', password: 'second-pass2' } })).status === 200, 'password reset');
const relog = await http('/auth/login', { method: 'POST', body: { email: EMAIL, password: 'second-pass2' } });
ok(relog.status === 200 && relog.json.token, 'login with new password');
token = relog.json.token;

const setup = await http('/auth/2fa/setup', { method: 'POST' });
ok(!!setup.json.secret && String(setup.json.qr || '').startsWith('data:image'), '2FA setup returns secret + QR');
ok((await http('/auth/2fa/enable', { method: 'POST', body: { code: totpNow(setup.json.secret) } })).json.totp_enabled === true, '2FA enabled with live code');
const log2 = await http('/auth/login', { method: 'POST', body: { email: EMAIL, password: 'second-pass2' } });
ok(log2.json.requires_2fa && log2.json.ticket, 'login now demands 2FA');
const fin = await http('/auth/login/2fa', { method: 'POST', body: { ticket: log2.json.ticket, code: totpNow(setup.json.secret) } });
ok(fin.status === 200 && fin.json.token, '2FA login completes');
token = fin.json.token;
ok((await http('/auth/2fa/disable', { method: 'POST', body: { code: totpNow(setup.json.secret) } })).json.totp_enabled === false, '2FA disabled');

const sess = await http('/auth/sessions');
ok(Array.isArray(sess.json.sessions) && sess.json.sessions.some((s) => s.current), 'sessions list marks current device');
ok((await http('/auth/sessions/revoke-others', { method: 'POST' })).status === 200, 'revoke other sessions');

await activatePremium(uid, { provider: 'trial', days: 1 });

/* ---------------- 2. holdings + trades + csv import ---------------- */
const h1 = await http('/holdings', { method: 'POST', body: { kind: 'IN_STOCK', symbol: 'SWEEP1', name: 'Sweep One', quantity: 10, avg_cost: 100, currency: 'INR', manual_price: 110 } });
ok(h1.status === 201, 'holding created');
const h1id = h1.json.holding.id;
ok((await http('/holdings', { method: 'POST', body: { kind: 'IN_STOCK', symbol: 'SWEEP2', name: 'Sweep Two', quantity: 2, avg_cost: 5000, currency: 'INR', manual_price: 6000 } })).status === 201, 'second holding (manual price)');
const hl = await http('/holdings');
ok((hl.json.holdings || []).length === 2 && hl.json.holdings.every((h) => h.market_value_base > 0), 'holdings list enriched with values');
ok((await http(`/holdings/${h1id}`, { method: 'PATCH', body: { manual_price: 120 } })).status === 200, 'holding patched');

ok((await http(`/holdings/${h1id}/txns`, { method: 'POST', body: { type: 'BUY', trade_date: '2026-06-01', quantity: 5, price: 90 } })).status === 201, 'BUY trade recorded');
const afterBuy = (await http('/holdings')).json.holdings.find((h) => h.id === h1id);
ok(near(afterBuy.quantity, 15) && near(afterBuy.avg_cost, (10 * 100 + 5 * 90) / 15, 0.01), 'BUY updates qty + weighted avg');
const sell = await http(`/holdings/${h1id}/txns`, { method: 'POST', body: { type: 'SELL', trade_date: '2026-07-01', quantity: 3, price: 130 } });
ok(sell.status === 201, 'SELL trade recorded');
const txl = await http(`/holdings/${h1id}/txns`);
ok((txl.json.txns || []).length === 2, 'trade history lists both');
ok((await http(`/holdings/${h1id}/txns/${txl.json.txns[0].id}`, { method: 'DELETE' })).status === 200, 'trade deleted (position restored)');

const prev = await http('/import/csv/preview', { method: 'POST', body: { csv: 'symbol,name,quantity,avg_cost\nCSVCO,Csv Co,4,25', kind: 'IN_STOCK' } });
ok(prev.status === 200 && (prev.json.items || []).length === 1, 'CSV preview parses 1 row', JSON.stringify(prev.json).slice(0, 120));
const confItems = (prev.json.items || []).map((i) => ({ ...i, currency: i.currency || 'INR' }));
const conf = await http('/import/confirm', { method: 'POST', body: { items: confItems, source: 'Sweep CSV' } });
ok(conf.status === 200 && (await http('/holdings')).json.holdings.length === 3, 'CSV confirm inserts holding');
ok((await http('/import/cas/status')).status === 200, 'CAS status endpoint');

/* ---------------- 3. cash / assets / transactions CRUD ---------------- */
const c1 = await http('/cash', { method: 'POST', body: { name: 'Sweep Bank', type: 'BANK', balance: 25000, currency: 'INR' } });
ok(c1.status === 201, 'cash account created');
ok((await http(`/cash/${c1.json.account.id}`, { method: 'PATCH', body: { balance: 30000 } })).json.account.balance === 30000, 'cash patched');
const a1 = await http('/assets', { method: 'POST', body: { name: 'Sweep Plot', type: 'LAND', value: 200000, currency: 'INR' } });
ok(a1.status === 201, 'asset created');
ok((await http(`/assets/${a1.json.asset.id}`, { method: 'PATCH', body: { value: 220000 } })).json.asset.value === 220000, 'asset patched');

const t1 = await http('/transactions', { method: 'POST', body: { type: 'EXPENSE', amount: 1200, currency: 'INR', category: 'Groceries', date: new Date().toISOString().slice(0, 10) } });
ok(t1.status === 201, 'transaction created');
ok((await http(`/transactions/${t1.json.transaction.id}`, { method: 'PATCH', body: { amount: 1500 } })).json.transaction.amount === 1500, 'transaction patched');
const tlist = await http('/transactions?type=EXPENSE&limit=10');
ok((tlist.json.transactions || []).length === 1 && typeof tlist.json.categories === 'object', 'transaction list + category suggestions');

/* ---------------- 4. recurring + budgets ---------------- */
const start = new Date();
start.setMonth(start.getMonth() - 2);
const rr = await http('/recurring', { method: 'POST', body: { type: 'EXPENSE', amount: 500, currency: 'INR', category: 'Utilities', day_of_month: 1, start_date: `${start.toISOString().slice(0, 8)}01` } });
ok(rr.status === 201 && rr.json.created >= 2, 'recurring rule backfills past months', `created=${rr.json.created}`);
ok((await http('/recurring')).json.rules?.[0]?.next_date != null, 'rules list shows next date');
ok((await http(`/recurring/${rr.json.rule.id}`, { method: 'PATCH', body: { active: 0 } })).status === 200, 'rule paused');
ok((await http(`/recurring/${rr.json.rule.id}`, { method: 'DELETE' })).status === 200, 'rule deleted');

const bulk = await http('/budgets/bulk', { method: 'PUT', body: { items: [{ category: 'Groceries', amount: 8000 }, { category: 'Utilities', amount: 3000 }] } });
ok(bulk.status === 200, 'budget template bulk-saved');
const bl = await http('/budgets');
const groc = (bl.json.items || []).find((b) => b.category === 'Groceries');
ok(groc && near(groc.spent_base, 1500, 0.01) && groc.pct === 19, 'budget tracks this-month spend + pct', JSON.stringify(groc));
ok((await http(`/budgets/${groc.id}`, { method: 'DELETE' })).status === 200, 'budget deleted');

/* ---------------- 5. dashboard math + scopes + snapshot ---------------- */
// own: SWEEP1 12×120? (after BUY delete → back to 10@100 qty... verify via list) — compute expected live
const holdingsNow = (await http('/holdings')).json.holdings;
const invest = holdingsNow.reduce((s, h) => s + h.market_value_base, 0);
const expected = invest + 30000 + 220000;
const dash = await http('/dashboard');
ok(near(dash.json.net_worth, expected, 1), 'dashboard net worth = holdings + cash + assets', `${dash.json.net_worth} vs ${expected}`);
ok(dash.json.premium === true && Array.isArray(dash.json.net_worth_history), 'premium history series present');
ok(near((await http('/dashboard?profile=me')).json.net_worth, expected, 1), "scope 'me' equals all (no members yet)");
const snap = await db.prepare('SELECT net_worth FROM net_worth_snapshots WHERE user_id = ?').get(uid);
ok(near(snap?.net_worth, expected, 1), 'snapshot recorded');

/* ---------------- 6. goals + links + alerts + returns ---------------- */
const g1 = await http('/goals', { method: 'POST', body: { name: 'Sweep Goal', target_amount: 1000000, currency: 'INR', target_date: '2030-01-01' } });
ok(g1.status === 201, 'goal created (premium)');
const gid = g1.json.goal.id;
ok((await http(`/goals/${gid}/links`, { method: 'PUT', body: { links: [{ kind: 'holding', ref_id: h1id }] } })).status === 200, 'goal linked to holding');
const gl = await http('/goals');
const goal = (gl.json.goals || []).find((g) => g.id === gid);
ok(goal && goal.links_count === 1 && goal.current_amount_base > 0, 'goal progress uses linked value', JSON.stringify(goal?.current_amount_base));
ok((await http(`/goals/${gid}`, { method: 'PATCH', body: { name: 'Sweep Goal 2' } })).status === 200, 'goal renamed');
ok((await http(`/goals/${gid}`, { method: 'DELETE' })).status === 200, 'goal deleted');
ok(Number((await db.prepare('SELECT COUNT(*) AS n FROM goal_links WHERE user_id = ?').get(uid))?.n) === 0, 'goal links cleaned with goal');

const al = await http('/alerts', { method: 'POST', body: { kind: 'IN_STOCK', symbol: 'RELIANCE', threshold: 5000, direction: 'ABOVE' } });
ok(al.status === 201, 'price alert created');
ok((await http(`/alerts/${al.json.alert.id}`, { method: 'PATCH', body: { threshold: 6000 } })).status === 200, 'alert patched');
ok((await http(`/alerts/${al.json.alert.id}`, { method: 'DELETE' })).status === 200, 'alert deleted');

const ret = await http('/returns');
ok(ret.status === 200 && ret.json != null, 'returns & tax endpoint responds');

/* ---------------- 7. prices / fx / benchmark ---------------- */
const fx = await http('/prices/fx?from=USD&to=INR');
ok(fx.status === 200 && Number(fx.json.rate) > 10, 'live FX rate sane', JSON.stringify(fx.json));
ok((await http('/prices/refresh', { method: 'POST', body: {} })).status === 200, 'price refresh endpoint');
const benchTry = await http(`/prices/benchmark?index=NIFTY50&from=${Date.now() - 90 * 86400000}&to=${Date.now()}`);
const allowed = benchTry.status === 400 ? benchTry.json.allowed || [] : null;
const bench = benchTry.status === 200 ? benchTry : await http(`/prices/benchmark?index=${allowed?.[0]}&from=${Date.now() - 90 * 86400000}&to=${Date.now()}`);
ok(bench.status === 200 && Array.isArray(bench.json.points), 'benchmark series (degrades gracefully)', `keys=${allowed}`);

/* ---------------- 8. email prefs / preview · support · export ---------------- */
ok((await http('/email/prefs', { method: 'PUT', body: { daily: 1 } })).status === 200, 'daily digest enabled (premium)');
ok((await http('/email/prefs')).json.daily === true, 'prefs persisted');
const prevw = await http('/email/preview');
ok(prevw.status === 200, 'digest preview renders');
ok((await http('/email/run-now', { method: 'POST' })).status === 403, 'run-now is admin-only');

ok((await http('/support/thread', { method: 'POST', body: { body: 'Sweep says hi' } })).status === 200, 'support message sent');
ok(((await http('/support/thread')).json.messages || []).length >= 1, 'support thread readable');
ok((await http('/support/unread')).status === 200, 'support unread count');
ok((await http('/support/admin/threads')).status === 403, 'support admin list blocked for non-admin');

const exp = await http('/export');
ok(exp.status === 200 && (exp.json.holdings || []).length === 3, 'export includes holdings');
ok(exp.json.broker_connections === undefined || !JSON.stringify(exp.json).includes('access_token'), 'export never contains broker tokens');

/* ---------------- 9. billing / broker / profiles / family / cron / admin ---------------- */
const bs = await http('/billing/status');
ok(bs.json.state?.premium === true && bs.json.monthly, 'billing status + plans');
ok(/^[A-HJKMNP-Z2-9]{8}$/.test((await http('/billing/referral')).json.code || ''), 'referral code mints');
ok((await http('/billing/demo-activate', { method: 'POST' })).status === 403, 'demo-activate admin-only');

const bst = await http('/broker/status');
ok(bst.status === 200 && bst.json.configured && bst.json.connected, 'broker status: configured + connected maps');
ok((await http('/broker/upstox/sync', { method: 'POST' })).status >= 400, 'broker sync without connection fails cleanly');
const bl2 = await http('/broker/upstox/login-url');
ok(bl2.status < 500 || bl2.status === 503, 'broker login-url clean (503 = keys not configured)', String(bl2.status));

const pf = await http('/profiles', { method: 'POST', body: { name: 'Sweep Kid', relation: 'Son' } });
ok(pf.status === 201 && ((await http('/profiles')).json.profiles || []).length === 1, 'managed profile CRUD (create+list)');
ok((await http(`/profiles/${pf.json.profile.id}`, { method: 'DELETE' })).status === 200, 'managed profile deleted');
const fam = await http('/family');
ok(Array.isArray(fam.json.members) && Array.isArray(fam.json.received_pending), 'family endpoint shape');

ok((await http('/cron/digests', { tok: null })).status !== 200, 'cron guarded without secret');
ok((await http('/admin/users')).status === 403, 'admin API blocked for non-admin');

console.log(`\n${pass} passed, ${fail} failed`);
await cleanup();
process.exit(fail ? 1 : 0);
