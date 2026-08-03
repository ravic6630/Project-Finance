// Monthly statements — deterministic checks. Run from server/:
//   node --env-file-if-exists=.env test-statements.mjs
import bcrypt from 'bcryptjs';
import { db, now } from './src/db.js';
import { activatePremium } from './src/services/billing.js';
import { runMonthlyStatements } from './src/services/scheduler.js';

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

async function http(path, { method = 'GET', body, token, raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = raw ? await res.text() : await res.json().catch(() => ({}));
  return { status: res.status, body: out };
}

const EMAIL = 'stmt@stmttest.sampada';
async function cleanup() {
  const rows = await db.prepare("SELECT id FROM users WHERE email LIKE '%@stmttest.sampada'").all();
  for (const { id } of rows) {
    for (const t of ['sessions', 'subscriptions', 'holdings', 'cash_accounts', 'assets', 'transactions', 'budgets', 'net_worth_snapshots', 'email_prefs']) {
      try {
        await db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
      } catch {}
    }
    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
}

console.log('— monthly statements —');
await cleanup();

const info = await db
  .prepare('INSERT INTO users (email, name, password_hash, base_currency, role, created_at) VALUES (?,?,?,?,?,?)')
  .run(EMAIL, 'Stmt Tester', bcrypt.hashSync('secret123', 10), 'INR', 'user', '2026-06-15T00:00:00.000Z');
const uid = Number(info.lastInsertRowid);
const login = await http('/auth/login', { method: 'POST', body: { email: EMAIL, password: 'secret123' } });
const token = login.body.token;

// July story: net worth 1,00,000 → 1,25,000; salary 50k in; groceries 8k +
// dining 4k out; Groceries budget 10k. Positions today: 1 holding, cash, land.
const ts = now();
await db.prepare('INSERT INTO net_worth_snapshots (user_id, date, net_worth, currency) VALUES (?,?,?,?)').run(uid, '2026-06-30', 100000, 'INR');
await db.prepare('INSERT INTO net_worth_snapshots (user_id, date, net_worth, currency) VALUES (?,?,?,?)').run(uid, '2026-07-31', 125000, 'INR');
await db.prepare("INSERT INTO transactions (user_id, type, amount, currency, category, date, created_at) VALUES (?,?,?,?,?,?,?)").run(uid, 'INCOME', 50000, 'INR', 'Salary', '2026-07-01', ts);
await db.prepare("INSERT INTO transactions (user_id, type, amount, currency, category, date, created_at) VALUES (?,?,?,?,?,?,?)").run(uid, 'EXPENSE', 8000, 'INR', 'Groceries', '2026-07-10', ts);
await db.prepare("INSERT INTO transactions (user_id, type, amount, currency, category, date, created_at) VALUES (?,?,?,?,?,?,?)").run(uid, 'EXPENSE', 4000, 'INR', 'Dining', '2026-07-20', ts);
await db.prepare("INSERT INTO budgets (user_id, category, amount, currency, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(uid, 'Groceries', 10000, 'INR', ts, ts);
await db.prepare("INSERT INTO holdings (user_id, kind, symbol, name, quantity, avg_cost, currency, manual_price, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(uid, 'IN_STOCK', 'STMTCO', 'Statement Co', 10, 100, 'INR', 120, ts, ts);
await db.prepare("INSERT INTO cash_accounts (user_id, name, type, balance, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run(uid, 'Stmt Bank', 'BANK', 30000, 'INR', ts, ts);
await db.prepare("INSERT INTO assets (user_id, name, type, value, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run(uid, 'Stmt Plot', 'LAND', 200000, 'INR', ts, ts);

// 1) Month list: covers June (signup month) → now, newest first.
const months = await http('/statements', { token });
const yms = (months.body.months || []).map((m) => m.ym);
ok(yms.includes('2026-07') && yms.includes('2026-06') && !yms.includes('2026-05'), 'months span signup → now', JSON.stringify(yms));
ok(yms[0] === new Date().toISOString().slice(0, 7), 'newest month first');
ok(months.body.months[0].label.includes('2026'), 'months carry friendly labels');

// 2) July statement: every headline number correct.
const st = await http('/statements/2026-07/html', { token, raw: true });
ok(st.status === 200 && st.body.startsWith('<!doctype html>'), 'statement renders as HTML');
const has = (s) => st.body.includes(s);
ok(has('Monthly statement · July 2026'), 'header names the month');
ok(has('₹1,00,000.00') && has('₹1,25,000.00'), 'opening → closing net worth');
ok(has('₹25,000.00') && has('(+25.0%)'), 'change + percent');
ok(has('₹50,000.00') && has('₹12,000.00') && has('₹38,000.00'), 'money in / out / saved');
ok(has('Groceries') && has('₹8,000.00') && has('· 67%'), 'top spending with share');
ok(has('₹10,000.00') && has('80%'), 'budget row: spent/budget pct');
ok(has('Statement Co') && has('₹1,200.00') && has('+20.0%'), 'holding row with gain');
ok(has('Stmt Bank') && has('₹30,000.00') && has('Stmt Plot') && has('₹2,00,000.00'), 'accounts + assets listed');
ok(has('Total net worth today') && has('Save as PDF / Print'), 'today block + print button');

// 3) June (first snapshot on the 30th): opening falls back to the first
// in-month snapshot, so the story still renders with real numbers.
const june = await http('/statements/2026-06/html', { token, raw: true });
ok(june.status === 200 && june.body.includes('June 2026') && june.body.includes('₹1,00,000.00'), 'first tracked month renders');
// A month with no history at all degrades to the friendly empty note.
const may = await http('/statements/2026-05/html', { token, raw: true });
ok(may.status === 200 && may.body.includes('No net-worth history'), 'pre-history month degrades gracefully');

// 4) Validation walls.
ok((await http('/statements/2026-13/html', { token })).status === 400, 'bad month format → 400');
ok((await http('/statements/2099-01/html', { token })).status === 400, 'future month → 400');
ok((await http('/statements/1999-01/html', { token })).status === 400, 'ancient month → 400');
ok((await http('/statements/2026-07/html')).status === 401, 'no token → 401');

// 5) Email opt-in is premium-gated; toggles never clobber each other.
ok((await http('/email/prefs', { method: 'PUT', token, body: { monthly_statement: true } })).status === 402, 'free user cannot enable email delivery');
await activatePremium(uid, { provider: 'trial', days: 1 });
ok((await http('/email/prefs', { method: 'PUT', token, body: { monthly_statement: true } })).status === 200, 'premium user enables it');
ok((await http('/email/prefs', { method: 'PUT', token, body: { daily: true } })).status === 200, 'separately enabling daily…');
const prefs = await http('/email/prefs', { token });
ok(prefs.body.daily === true && prefs.body.monthly_statement === true, '…keeps both toggles on', JSON.stringify(prefs.body));

// 6) Mailer: without email config it reports cleanly and never marks anyone.
const run = await runMonthlyStatements();
ok(run.error === 'email_not_configured' && run.sent === 0, 'mailer skips when email is not configured');
const pref = await db.prepare('SELECT last_statement_month FROM email_prefs WHERE user_id = ?').get(uid);
ok(pref?.last_statement_month == null, 'no false "sent" marker without a real send');

console.log(`\n${pass} passed, ${fail} failed`);
await cleanup();
process.exit(fail ? 1 : 0);
