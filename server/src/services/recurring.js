import { db, now } from '../db.js';

// All dates are plain YYYY-MM-DD strings in IST (same convention as net-worth
// snapshots), compared lexicographically.
export const todayIST = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12

// The rule's occurrence in a given month, clamped so "day 31" lands on the
// 30th/28th/29th in shorter months.
const occurrenceIn = (y, m, day) =>
  `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, daysInMonth(y, m))).padStart(2, '0')}`;

// Every due date with fromExclusive < date <= toInclusive (both YYYY-MM-DD).
export function occurrencesBetween(rule, fromExclusive, toInclusive) {
  const out = [];
  const floor = rule.start_date > (fromExclusive || '') ? rule.start_date : fromExclusive;
  let [y, m] = (floor || rule.start_date).slice(0, 7).split('-').map(Number);
  // Walk month by month from the window floor to the window end.
  const [endY, endM] = toInclusive.slice(0, 7).split('-').map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    const d = occurrenceIn(y, m, rule.day_of_month);
    if (
      d >= rule.start_date &&
      (!fromExclusive || d > fromExclusive) &&
      d <= toInclusive &&
      (!rule.end_date || d <= rule.end_date)
    ) {
      out.push(d);
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const activeRules = db.prepare('SELECT * FROM recurring_rules WHERE user_id = ? AND active = 1');
const alreadyLogged = db.prepare(
  'SELECT 1 FROM transactions WHERE user_id = ? AND recurring_rule_id = ? AND date = ?'
);
// OR IGNORE + the (user_id, recurring_rule_id, date) unique index in db.js is
// the real guard: the read-then-write check below is only a fast path, and two
// concurrent requests can both pass it. The DB refuses the duplicate.
const insertTxn = db.prepare(`
  INSERT OR IGNORE INTO transactions
    (user_id, type, amount, currency, category, account, date, note, recurring_rule_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const markRun = db.prepare('UPDATE recurring_rules SET last_run = ?, updated_at = ? WHERE id = ?');

// Catch every active rule up to today. Called lazily whenever transactions are
// read; idempotent (per-date guard) so concurrent calls can't double-log.
export async function materializeRecurring(userId) {
  const today = todayIST();
  const rules = await activeRules.all(userId);
  let created = 0;
  for (const rule of rules) {
    if (rule.last_run && rule.last_run >= today) continue;
    const due = occurrencesBetween(rule, rule.last_run, today);
    for (const date of due) {
      if (await alreadyLogged.get(userId, rule.id, date)) continue;
      const res = await insertTxn.run(
        userId, rule.type, rule.amount, rule.currency, rule.category,
        rule.account, date, rule.note, rule.id, now()
      );
      // A concurrent request may have won the race — count only real inserts.
      created += res.changes ? 1 : 0;
    }
    await markRun.run(today, now(), rule.id);
  }
  return { created };
}
