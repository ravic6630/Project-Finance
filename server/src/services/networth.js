import { db } from '../db.js';
import { getFxRate } from './prices.js';

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

// Snapshots are stored in whatever base currency was active that day; convert
// them all to the user's CURRENT base so the trend chart is consistent even if
// they switched base currency along the way.
export async function getHistory(userId, base) {
  const rows = await histStmt.all(userId);
  const fx = {};
  const rate = async (c) => {
    const cur = c || base;
    if (fx[cur] == null) fx[cur] = await getFxRate(cur, base);
    return fx[cur];
  };
  const out = [];
  for (const r of rows) {
    const f = await rate(r.currency);
    out.push({ date: r.date, net_worth: r.net_worth * f });
  }
  return out;
}
