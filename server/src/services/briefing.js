import { db } from '../db.js';
import { getFxRate } from './prices.js';

// "What changed while you were away."
//
// CONTRACT — buildBriefing(user, { netWorth, base }) resolves to null, or:
// {
//   since: ISO string,          // the visit BEFORE this one
//   days_ago: number,           // whole days, 0 = earlier today
//   net_worth: {                // null when there is no comparable snapshot
//     then, now, change, change_pct, as_of   // as_of = the snapshot's IST date
//   } | null,
//   alerts: [{ label, direction, threshold, at }],
//   income: { total, count } | null,          // dividends and interest recorded
//   holdings_added: number,
// }
//
// Every figure is read from something already stored. Nothing is inferred, and
// a section that cannot be computed honestly is omitted rather than filled with
// a zero — "your net worth didn't move" and "we have nothing to compare against"
// are different statements, and only one of them is true on a new account.
//
// NOT included, deliberately: which holding drove the change. Snapshots record
// the net worth TOTAL, so per-holding history doesn't exist to compare against.
// Attributing a move to a holding would mean inventing the attribution.

const DIVIDEND_CATEGORIES = ['Dividend', 'Interest', 'Dividends'];

// Snapshots are keyed by IST day, so the cutoff has to be an IST day too.
const istDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

// The most recent snapshot on or before the day of the last visit. "On or
// before" matters: someone who signs in at 2am has no snapshot for that day yet,
// and the previous day's close is the honest comparison.
const snapshotAt = db.prepare(
  'SELECT date, net_worth, currency FROM net_worth_snapshots WHERE user_id = ? AND date <= ? ORDER BY date DESC LIMIT 1'
);
const firedAlerts = db.prepare(
  `SELECT label, direction, threshold, last_triggered_at
     FROM alerts
    WHERE user_id = ? AND last_triggered_at IS NOT NULL AND last_triggered_at > ?
    ORDER BY last_triggered_at DESC
    LIMIT 5`
);
const incomeSince = db.prepare(
  `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
     FROM transactions
    WHERE user_id = ? AND type = 'INCOME' AND date >= ? AND date <= ?
      AND category IN (${DIVIDEND_CATEGORIES.map(() => '?').join(',')})`
);
const holdingsSince = db.prepare(
  'SELECT COUNT(*) AS n FROM holdings WHERE user_id = ? AND created_at > ?'
);
// Read here rather than relying on req.user: authRequired deliberately selects a
// narrow column list, and widening it would put both login timestamps on every
// authenticated request (and into /auth/me) to serve one panel on one page.
const visitClock = db.prepare('SELECT previous_login_at FROM users WHERE id = ?');

const fin = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

export async function buildBriefing(user, { netWorth, base } = {}) {
  if (!user?.id) return null;
  const since = (await visitClock.get(user.id))?.previous_login_at;
  // No previous visit means this is the first sign-in ever. There is nothing to
  // report, and "welcome back" would be wrong on both words.
  if (!since) return null;
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) return null;

  const sinceDay = istDay(new Date(sinceMs));
  const today = istDay(new Date());
  const daysAgo = Math.max(0, Math.floor((Date.now() - sinceMs) / 86400000));

  const [snap, alertRows, incomeRow, holdingRow] = await Promise.all([
    snapshotAt.get(user.id, sinceDay),
    firedAlerts.all(user.id, since),
    incomeSince.get(user.id, sinceDay, today, ...DIVIDEND_CATEGORIES),
    holdingsSince.get(user.id, since),
  ]);

  /* ------------------------------- net worth ------------------------------ */
  let net = null;
  if (snap && Number.isFinite(Number(snap.net_worth)) && Number.isFinite(Number(netWorth))) {
    // A snapshot is stored in whatever base currency was active that day. If the
    // user has since switched, convert rather than comparing rupees to dollars.
    const rate = snap.currency && snap.currency !== base ? await getFxRate(snap.currency, base).catch(() => null) : 1;
    if (Number.isFinite(rate) && rate > 0) {
      const then = Number(snap.net_worth) * rate;
      const now = Number(netWorth);
      const change = now - then;
      net = {
        then: round2(then),
        now: round2(now),
        change: round2(change),
        // A percentage of nothing is not zero, it's undefined — a first snapshot
        // of 0 must not report "+∞%" or a confident "0%".
        change_pct: then > 0 ? round2((change / then) * 100) : null,
        as_of: snap.date,
      };
    }
  }

  const alerts = (alertRows || []).map((a) => ({
    label: a.label,
    direction: a.direction,
    threshold: fin(a.threshold),
    at: a.last_triggered_at,
  }));

  const incomeTotal = fin(incomeRow?.total);
  const income = incomeTotal > 0 ? { total: round2(incomeTotal), count: Number(incomeRow?.n) || 0 } : null;
  const holdingsAdded = Number(holdingRow?.n) || 0;

  // Nothing worth interrupting the dashboard for. A strip that says "nothing
  // happened" is worse than no strip: it costs attention and returns none.
  const hasNews =
    (net && net.change !== 0) || alerts.length > 0 || income != null || holdingsAdded > 0;
  if (!hasNews) return null;

  return { since, days_ago: daysAgo, net_worth: net, alerts, income, holdings_added: holdingsAdded };
}
