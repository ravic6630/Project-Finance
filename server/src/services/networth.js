import { db } from '../db.js';

// One snapshot per IST day; later loads the same day just update the value.
const todayIST = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const upsert = db.prepare(`
  INSERT INTO net_worth_snapshots (user_id, date, net_worth, currency)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id, date) DO UPDATE SET net_worth = excluded.net_worth, currency = excluded.currency
`);

export async function recordSnapshot(userId, netWorth, currency = 'INR') {
  const v = Number(netWorth);
  if (!Number.isFinite(v)) return;
  await upsert.run(userId, todayIST(), v, currency);
}

const histStmt = db.prepare(
  'SELECT date, net_worth, currency FROM net_worth_snapshots WHERE user_id = ? ORDER BY date'
);

export async function getHistory(userId) {
  const rows = await histStmt.all(userId);
  return rows.map((r) => ({ date: r.date, net_worth: r.net_worth, currency: r.currency }));
}
