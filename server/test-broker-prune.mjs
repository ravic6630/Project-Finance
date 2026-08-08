// Broker re-sync must remove SOLD positions (the reconnect bug). Run from server/:
//   node --env-file-if-exists=.env test-broker-prune.mjs
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

async function http(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const EMAIL = 'prune@prunetest.sampada';
async function cleanup() {
  const rows = await db.prepare("SELECT id FROM users WHERE email LIKE '%@prunetest.sampada'").all();
  for (const { id } of rows) {
    for (const t of ['sessions', 'subscriptions', 'holdings', 'goals', 'goal_links', 'net_worth_snapshots']) {
      try {
        await db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
      } catch {}
    }
    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
}

console.log('— broker re-sync prunes sold positions —');
await cleanup();

const info = await db
  .prepare('INSERT INTO users (email, name, password_hash, base_currency, role, created_at) VALUES (?,?,?,?,?,?)')
  .run(EMAIL, 'Prune Tester', bcrypt.hashSync('secret123', 10), 'INR', 'user', now());
const uid = Number(info.lastInsertRowid);
await activatePremium(uid, { provider: 'trial', days: 1 });
const login = await http('/auth/login', { method: 'POST', body: { email: EMAIL, password: 'secret123' } });
const token = login.json.token;

const UPSTOX = 'Imported from Upstox';
const stock = (symbol, name, qty) => ({ kind: 'IN_STOCK', symbol, name, exchange: 'NSE', quantity: qty, avg_cost: 100, currency: 'INR' });
const mf = (code, name, units) => ({ kind: 'IN_MF', scheme_code: code, name, quantity: units, avg_cost: 50, currency: 'INR' });

// --- Day 1: first broker sync brings 2 stocks + 1 MF ---
const day1 = [stock('AAA', 'Alpha Ltd', 10), stock('BBB', 'Beta Ltd', 5), mf('123456', 'Gamma Fund', 100)];
const c1 = await http('/import/confirm', { method: 'POST', token, body: { items: day1, source: UPSTOX, prune: true, all_items: day1 } });
ok(c1.status === 200 && c1.json.imported === 3 && (c1.json.removed || 0) === 0, 'day 1: three positions imported, nothing pruned');

// Plus a MANUAL holding and a CSV import — sacred, never sync-pruned.
await db.prepare("INSERT INTO holdings (user_id, kind, symbol, name, quantity, avg_cost, currency, manual_price, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
  .run(uid, 'IN_STOCK', 'MANUAL.NS', 'My Manual Pick', 3, 10, 'INR', 12, null, now(), now());
const csvItems = [stock('CCC', 'Csv Co', 7)];
await http('/import/confirm', { method: 'POST', token, body: { items: csvItems, source: 'Imported from CSV' } });

// Link a goal to Beta (the one that will be sold).
const bRow = await db.prepare("SELECT id FROM holdings WHERE user_id = ? AND symbol = 'BBB.NS'").get(uid);
const g = await http('/goals', { method: 'POST', token, body: { name: 'Prune Goal', target_amount: 1000, currency: 'INR' } });
await http(`/goals/${g.json.goal.id}/links`, { method: 'PUT', token, body: { links: [{ kind: 'holding', ref_id: bRow.id }] } });
ok(Number((await db.prepare('SELECT COUNT(*) AS n FROM goal_links WHERE user_id = ?').get(uid)).n) === 1, 'goal linked to the soon-to-be-sold stock');

// --- Day 2: user SOLD Beta and REDEEMED Gamma. Broker now reports only Alpha. ---
const day2 = [stock('AAA', 'Alpha Ltd', 12)];
const c2 = await http('/import/confirm', { method: 'POST', token, body: { items: day2, source: UPSTOX, prune: true, all_items: day2 } });
ok(c2.status === 200 && c2.json.removed === 2, 'day 2 sync: two sold positions removed', JSON.stringify(c2.json));
ok((c2.json.removed_names || []).includes('Beta Ltd') && c2.json.removed_names.some((n) => /Gamma/.test(n)), 'removed names reported');

const left = await db.prepare('SELECT symbol, scheme_code, name, quantity, notes FROM holdings WHERE user_id = ? ORDER BY name').all(uid);
const names = left.map((h) => h.name);
ok(!names.includes('Beta Ltd') && !names.some((n) => /Gamma/.test(n)), 'sold stock + redeemed MF are GONE');
ok(names.includes('Alpha Ltd') && left.find((h) => h.name === 'Alpha Ltd').quantity === 12, 'kept position updated to new quantity');
ok(names.includes('My Manual Pick'), 'manual holding untouched');
ok(names.includes('Csv Co'), 'CSV-imported holding untouched (different source)');
ok(Number((await db.prepare('SELECT COUNT(*) AS n FROM goal_links WHERE user_id = ?').get(uid)).n) === 0, 'goal link to the sold stock cleaned up');
ok(Number((await db.prepare('SELECT COUNT(*) AS n FROM goals WHERE user_id = ?').get(uid)).n) === 1, 'the goal itself survives');

// --- Deselect safety: broker holds AAA + DDD; user only ticks DDD. ---
const day3all = [stock('AAA', 'Alpha Ltd', 12), stock('DDD', 'Delta Ltd', 2)];
const c3 = await http('/import/confirm', { method: 'POST', token, body: { items: [day3all[1]], source: UPSTOX, prune: true, all_items: day3all } });
ok(c3.status === 200 && (c3.json.removed || 0) === 0, 'unticking a still-held stock does NOT delete it');
ok(!!(await db.prepare("SELECT id FROM holdings WHERE user_id = ? AND symbol = 'AAA.NS'").get(uid)), 'Alpha survives the partial selection');

// --- Guards: empty snapshot never mass-deletes; plain imports never prune. ---
const c4 = await http('/import/confirm', { method: 'POST', token, body: { items: [stock('DDD', 'Delta Ltd', 2)], source: UPSTOX, prune: true, all_items: [] } });
ok(c4.status === 200 && (c4.json.removed || 0) === 0, 'empty all_items: prune refused');
const c5 = await http('/import/confirm', { method: 'POST', token, body: { items: [stock('EEE', 'Echo Ltd', 1)], source: UPSTOX } });
ok(c5.status === 200 && (c5.json.removed || 0) === 0 && !!(await db.prepare("SELECT id FROM holdings WHERE user_id = ? AND symbol = 'AAA.NS'").get(uid)), 'confirm without prune flag never removes');

console.log(`\n${pass} passed, ${fail} failed`);
await cleanup();
process.exit(fail ? 1 : 0);
