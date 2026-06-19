import { db, now } from '../db.js';
import { getPrice } from './prices.js';
import { emailConfigured, sendMail } from './email.js';

// Don't re-send the same alert more than once per 12h while it stays crossed.
const COOLDOWN_MS = 12 * 60 * 60 * 1000;

const money = (v, cur = 'INR') => {
  try {
    return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: 2,
    }).format(Number(v));
  } catch {
    return `${cur} ${Number(v).toFixed(2)}`;
  }
};

const activeAlerts = db.prepare(`
  SELECT a.*, u.email, u.name
  FROM alerts a JOIN users u ON u.id = a.user_id
  WHERE a.active = 1
`);
const markTriggered = db.prepare('UPDATE alerts SET last_triggered_at = ?, updated_at = ? WHERE id = ?');

function alertHtml(a, price) {
  const dir = a.direction === 'above' ? 'risen to / above' : 'fallen to / below';
  return `
    <div style="font-family:Arial,sans-serif;max-width:480px">
      <h2 style="margin:0 0 8px">🔔 Price alert</h2>
      <p style="font-size:15px;color:#334155">
        <strong>${a.label}</strong> has ${dir} your target.
      </p>
      <p style="font-size:15px;color:#334155">
        Now: <strong>${money(price, a.currency)}</strong> · your target: ${a.direction} ${money(a.threshold, a.currency)}
      </p>
      <p style="font-size:12px;color:#94a3b8">— Sampada</p>
    </div>`;
}

// Check every active alert against the latest price; email any that crossed.
export async function evaluateAlerts() {
  const report = { checked: 0, triggered: 0, sent: 0, failed: 0 };
  const rows = await activeAlerts.all();
  for (const a of rows) {
    report.checked += 1;
    let price = null;
    try {
      const p = await getPrice({ kind: a.kind, symbol: a.symbol, scheme_code: a.scheme_code });
      price = p?.price;
    } catch {
      continue;
    }
    if (!Number.isFinite(price)) continue;

    const crossed = a.direction === 'above' ? price >= a.threshold : price <= a.threshold;
    if (!crossed) continue;
    if (a.last_triggered_at && Date.now() - Date.parse(a.last_triggered_at) < COOLDOWN_MS) continue;

    report.triggered += 1;
    try {
      if (emailConfigured()) {
        await sendMail({
          to: a.email,
          subject: `🔔 ${a.label} is ${a.direction} ${money(a.threshold, a.currency)}`,
          html: alertHtml(a, price),
        });
        report.sent += 1;
      }
      await markTriggered.run(now(), now(), a.id);
    } catch {
      report.failed += 1;
    }
  }
  return report;
}

// Auto-sync: force-refresh the live price of every distinct instrument anyone
// holds or watches, so dashboards/emails are current without a manual refresh.
export async function refreshAllInstruments() {
  const holds = await db.prepare('SELECT DISTINCT kind, symbol, scheme_code FROM holdings').all();
  const watched = await db.prepare('SELECT DISTINCT kind, symbol, scheme_code FROM alerts WHERE active = 1').all();
  const seen = new Set();
  let refreshed = 0;
  for (const h of [...holds, ...watched]) {
    const key = h.kind === 'IN_MF' ? `mf:${h.scheme_code}` : String(h.symbol || '').toUpperCase();
    if (!key || key === 'mf:' || seen.has(key)) continue;
    seen.add(key);
    try {
      await getPrice({ kind: h.kind, symbol: h.symbol, scheme_code: h.scheme_code }, { force: true });
      refreshed += 1;
    } catch {
      /* skip instruments that fail to price */
    }
  }
  return { refreshed, instruments: seen.size };
}
