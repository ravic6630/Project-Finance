// One position per instrument: manual adds merge with weighted-average cost.
// Run from server/ with the API up:  node --env-file-if-exists=.env test-holding-merge.mjs
//
// The reported case, verbatim: 13.02 AMZN @ $150 already held; buying 1.2 more
// @ $248.70 must land on ONE row of 14.22 @ $158.3291139... — not a second row.
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
const near = (a, b, tol = 0.0001) => Number.isFinite(a) && Math.abs(a - b) <= tol;

async function http(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const DOMAIN = '@mergetest.sampada';
const PW = 'secret123';

async function cleanup() {
  const rows = await db.prepare(`SELECT id FROM users WHERE email LIKE '%${DOMAIN}'`).all();
  for (const { id } of rows) {
    for (const t of ['sessions', 'subscriptions', 'holdings', 'investment_txns', 'goal_links', 'goals', 'profiles']) {
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
    .run(email, 'Merge Tester', bcrypt.hashSync(PW, 10), 'INR', 'user', now());
  const id = Number(info.lastInsertRowid);
  const { activatePremium } = await import('./src/services/billing.js');
  await activatePremium(id, { provider: 'trial', days: 1 });
  const token = (await http('/auth/login', { method: 'POST', body: { email, password: PW } })).body.token;
  return { id, token };
}

const rowsFor = (userId, symbol) =>
  db.prepare('SELECT * FROM holdings WHERE user_id = ? AND symbol = ? ORDER BY id').all(userId, symbol);
const post = (token, body) => http('/holdings', { method: 'POST', token, body });

console.log('— one position per instrument —');
await cleanup();
const U = await makeUser(`ravi${DOMAIN}`);

/* ------------------------------ the reported bug --------------------------- */
const first = await post(U.token, { kind: 'US_STOCK', symbol: 'AMZN', name: 'Amazon.com, Inc.', quantity: 13.02, avg_cost: 150, currency: 'USD', manual_price: 246.28 });
ok(first.status === 201 && !first.body.merged, 'first AMZN buy creates the position', String(first.status));

const second = await post(U.token, { kind: 'US_STOCK', symbol: 'amzn', name: 'Amazon', quantity: 1.2, avg_cost: 248.7, currency: 'USD' });
ok(second.status === 200 && second.body.merged === true, 'second buy MERGES instead of creating a row', JSON.stringify(second.body).slice(0, 120));
const amzn = await rowsFor(U.id, 'AMZN');
ok(amzn.length === 1, 'exactly ONE AMZN row exists', String(amzn.length));
ok(near(Number(amzn[0].quantity), 14.22), 'quantity = 13.02 + 1.2 = 14.22', String(amzn[0].quantity));
// (13.02×150 + 1.2×248.70) / 14.22 = 2251.44 / 14.22 = 158.32911392...
ok(near(Number(amzn[0].avg_cost), 2251.44 / 14.22), 'avg cost is the weighted average ≈ $158.33', String(amzn[0].avg_cost));
ok(near(second.body.previous?.quantity, 13.02) && near(second.body.previous?.avg_cost, 150), 'response reports what it merged into', JSON.stringify(second.body.previous));
ok(amzn[0].manual_price === 246.28, 'a merge without a new manual price keeps the old one', String(amzn[0].manual_price));
ok(second.body.ledger_recorded === false, 'no ledger existed, so no partial lot was invented');
ok(Number((await db.prepare('SELECT COUNT(*) AS n FROM investment_txns WHERE user_id = ?').get(U.id)).n) === 0, 'the ledger is still empty');

// Case-insensitivity both ways, and a new manual price replaces the old.
const third = await post(U.token, { kind: 'US_STOCK', symbol: 'AmZn', name: 'x', quantity: 0.78, avg_cost: 100, currency: 'USD', manual_price: 250 });
ok(third.body.merged === true && near(third.body.holding.quantity, 15), 'a third buy keeps merging (15 total)', String(third.body.holding?.quantity));
ok(near(Number((await rowsFor(U.id, 'AMZN'))[0].manual_price), 250), 'a provided manual price does update');

/* -------------------------- ledger continuity ------------------------------ */
// A holding whose lots ARE tracked must get the buy appended, so returns stay
// complete rather than silently missing a purchase.
const aapl = await post(U.token, { kind: 'US_STOCK', symbol: 'AAPL', name: 'Apple', quantity: 2, avg_cost: 200, currency: 'USD' });
await http(`/holdings/${aapl.body.holding.id}/txns`, { method: 'POST', token: U.token, body: { type: 'BUY', trade_date: '2026-01-05', quantity: 2, price: 200 } });
const aaplMerge = await post(U.token, { kind: 'US_STOCK', symbol: 'AAPL', name: 'Apple', quantity: 1, avg_cost: 260, currency: 'USD' });
ok(aaplMerge.body.merged === true && aaplMerge.body.ledger_recorded === true, 'with a ledger present, the buy is recorded as a lot');
const lots = await db.prepare('SELECT * FROM investment_txns WHERE user_id = ? AND holding_id = ? ORDER BY id').all(U.id, aapl.body.holding.id);
ok(lots.length === 2 && near(Number(lots[1].quantity), 1) && near(Number(lots[1].price), 260), 'the lot carries the buy quantity and price', JSON.stringify(lots[1] || {}));
// 2 already + 2 from lot-post sync + 1 merge = the holding row tracks its ledger path
ok(near(Number((await rowsFor(U.id, 'AAPL'))[0].quantity), 5), 'AAPL position = 2 + 2(lot) + 1 = 5', String((await rowsFor(U.id, 'AAPL'))[0].quantity));

/* ----------------------- pre-existing duplicates fold in -------------------- */
const ts = now();
await db.prepare('INSERT INTO holdings (user_id,kind,symbol,name,quantity,avg_cost,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
  .run(U.id, 'IN_STOCK', 'ITC.NS', 'ITC Ltd', 100, 400, 'INR', ts, ts);
await db.prepare('INSERT INTO holdings (user_id,kind,symbol,name,quantity,avg_cost,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
  .run(U.id, 'IN_STOCK', 'ITC.NS', 'ITC Ltd', 50, 300, 'INR', ts, ts);
const dupIds = (await rowsFor(U.id, 'ITC.NS')).map((r) => r.id);
// A goal linked to EACH duplicate — the links must survive on the survivor.
const g = await db.prepare("INSERT INTO goals (user_id,name,type,target_amount,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(U.id, 'Retire', 'CUSTOM', 1, 'INR', ts, ts);
for (const id of dupIds) {
  await db.prepare("INSERT INTO goal_links (user_id,goal_id,kind,ref_id,created_at) VALUES (?,?,?,?,?)").run(U.id, Number(g.lastInsertRowid), 'holding', id, ts);
}
const itc = await post(U.token, { kind: 'IN_STOCK', symbol: 'ITC', name: 'ITC', quantity: 10, avg_cost: 350, currency: 'INR' });
ok(itc.body.merged === true && itc.body.consolidated === 1, 'a stray duplicate row is folded in during the merge', JSON.stringify({ c: itc.body.consolidated }));
const itcRows = await rowsFor(U.id, 'ITC.NS');
ok(itcRows.length === 1, 'ITC is one row now', String(itcRows.length));
// (100×400 + 50×300 + 10×350) / 160 = (40000+15000+3500)/160 = 58500/160 = 365.625
ok(near(Number(itcRows[0].quantity), 160) && near(Number(itcRows[0].avg_cost), 365.625), 'consolidated maths: 160 @ 365.625', `${itcRows[0].quantity} @ ${itcRows[0].avg_cost}`);
const links = await db.prepare("SELECT ref_id FROM goal_links WHERE user_id = ? AND kind = 'holding'").all(U.id);
ok(links.length === 1 && Number(links[0].ref_id) === itcRows[0].id, 'goal links follow the money onto the surviving row, deduped', JSON.stringify(links));

/* ------------------------------ lines not crossed --------------------------- */
// A broker-imported row is the broker's mirror: a manual buy must NOT be folded
// into it (the next sync would overwrite the quantity with the broker's number).
await db.prepare('INSERT INTO holdings (user_id,kind,symbol,name,quantity,avg_cost,currency,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
  .run(U.id, 'IN_STOCK', 'TCS.NS', 'TCS', 10, 3000, 'INR', 'Imported from Upstox', ts, ts);
const tcs = await post(U.token, { kind: 'IN_STOCK', symbol: 'TCS', name: 'TCS', quantity: 5, avg_cost: 3600, currency: 'INR' });
ok(tcs.status === 201 && !tcs.body.merged, 'a manual buy beside a broker row stays a separate lot', String(tcs.status));
ok((await rowsFor(U.id, 'TCS.NS')).length === 2, 'broker mirror untouched, manual lot alongside');
// ...but a SECOND manual buy merges with the manual lot, not the broker row.
const tcs2 = await post(U.token, { kind: 'IN_STOCK', symbol: 'TCS', name: 'TCS', quantity: 5, avg_cost: 3400, currency: 'INR' });
ok(tcs2.body.merged === true, 'further manual buys merge with the manual lot');
const tcsRows = await rowsFor(U.id, 'TCS.NS');
const brokerRow = tcsRows.find((r) => /^imported/i.test(r.notes || ''));
const manualRow = tcsRows.find((r) => !/^imported/i.test(r.notes || ''));
ok(near(Number(brokerRow.quantity), 10) && near(Number(brokerRow.avg_cost), 3000), 'the broker row is exactly as the broker left it');
ok(near(Number(manualRow.quantity), 10) && near(Number(manualRow.avg_cost), 3500), 'the manual lot is 10 @ 3500');

// Different profiles are different people's money — never merged.
const prof = await db.prepare('INSERT INTO profiles (user_id, name, created_at) VALUES (?,?,?)').run(U.id, 'Amma', ts);
const amma = await post(U.token, { kind: 'US_STOCK', symbol: 'AMZN', name: 'Amazon', quantity: 3, avg_cost: 200, currency: 'USD', profile_id: Number(prof.lastInsertRowid) });
ok(amma.status === 201 && !amma.body.merged, "a different profile's AMZN is its own position", String(amma.status));
ok((await rowsFor(U.id, 'AMZN')).length === 2, 'one AMZN row per profile');

// Different mutual funds (different scheme codes) never merge; the same one does.
const mf1 = await post(U.token, { kind: 'IN_MF', scheme_code: '122639', name: 'PPFAS Flexi Cap', quantity: 100, avg_cost: 50, currency: 'INR' });
const mf2 = await post(U.token, { kind: 'IN_MF', scheme_code: '120503', name: 'Axis Bluechip', quantity: 100, avg_cost: 40, currency: 'INR' });
ok(mf1.status === 201 && mf2.status === 201, 'two different funds are two rows');
const mf3 = await post(U.token, { kind: 'IN_MF', scheme_code: '122639', name: 'PPFAS Flexi Cap', quantity: 50, avg_cost: 80, currency: 'INR' });
// (100×50 + 50×80) / 150 = 9000/150 = 60
ok(mf3.body.merged === true && near(mf3.body.holding.quantity, 150) && near(mf3.body.holding.avg_cost, 60), 'the same fund merges by scheme code: 150 @ 60', JSON.stringify({ q: mf3.body.holding?.quantity, a: mf3.body.holding?.avg_cost }));

// Same symbol in a DIFFERENT market is a different instrument.
const ukAmzn = await post(U.token, { kind: 'UK_STOCK', symbol: 'AMZN', name: 'Amazon UK line', quantity: 1, avg_cost: 100, currency: 'GBP' });
ok(ukAmzn.status === 201 && !ukAmzn.body.merged, 'the same ticker on another market stays separate', String(ukAmzn.status));

/* ------------------------------ edit stays edit ----------------------------- */
const edited = await http(`/holdings/${amzn[0].id}`, { method: 'PATCH', token: U.token, body: { quantity: 14.22 } });
ok(edited.status === 200 && near(edited.body.holding.quantity, 14.22), 'PATCH still edits in place, never merges', String(edited.body.holding?.quantity));

console.log(`\n${pass} passed, ${fail} failed`);
await cleanup();
process.exit(fail ? 1 : 0);
