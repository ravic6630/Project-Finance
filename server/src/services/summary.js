import { db } from '../db.js';
import { enrichHoldings, KIND_LABELS } from './portfolio.js';
import { getFxRate } from './prices.js';
import { todayIST } from './recurring.js';
import { buildAllocationTree } from './allocationTree.js';

// The 6 cashflow buckets, oldest → newest, anchored on the IST day like every
// other date in the app. Deriving them from the SERVER's local month instead
// would hide brand-new transactions for hours whenever the host's clock and IST
// straddle a month boundary.
export function cashflowMonths() {
  const [y, m] = todayIST().split('-').map(Number);
  const out = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, income: 0, expense: 0 });
  }
  return out;
}

// Full net-worth summary in the user's base currency. Shared by the dashboard
// route, the daily email digest and the monthly statement.
//   withItems  — also return the enriched holdings, so callers that need them
//                (statements) don't price the same portfolio a second time.
//   skipCashflow — skip the transaction scan entirely for callers that discard
//                cashflow anyway (linked family members).
export async function buildSummary(user, { refresh = false, scope = null, withItems = false, withTree = false, skipCashflow = false } = {}) {
  // scope: null/'all' = whole family, 'me' = owner only, <id> = one member.
  const scSql = scope === 'me' ? ' AND profile_id IS NULL' : Number.isInteger(scope) ? ' AND profile_id = ?' : '';
  const scArgs = Number.isInteger(scope) ? [scope] : [];
  const base = user.base_currency;
  const userId = user.id;

  const months = cashflowMonths();
  // Only the last 6 months feed the chart, so don't drag a decade of rows over
  // the wire on every dashboard load — idx_txn_date makes this a range scan.
  const since = `${months[0].key}-01`;

  // All independent of each other: one round trip's worth of latency, not four.
  const [holdings, accounts, assets, txns] = await Promise.all([
    db.prepare(`SELECT * FROM holdings WHERE user_id = ?${scSql}`).all(userId, ...scArgs),
    db.prepare(`SELECT * FROM cash_accounts WHERE user_id = ?${scSql}`).all(userId, ...scArgs),
    db.prepare(`SELECT * FROM assets WHERE user_id = ?${scSql}`).all(userId, ...scArgs),
    skipCashflow
      ? Promise.resolve([])
      : db.prepare('SELECT * FROM transactions WHERE user_id = ? AND date >= ?').all(userId, since),
  ]);

  // Enrichment needs the holdings; the three lookups below don't, so they ride along.
  const [{ items, rates }, txnCountRow, goalsRow, brokerRow, prefsRow] = await Promise.all([
    enrichHoldings(holdings, base, { force: refresh }),
    skipCashflow
      ? Promise.resolve({ n: 0 })
      : db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?').get(userId),
    db.prepare('SELECT COUNT(*) AS n FROM goals WHERE user_id = ?').get(userId),
    db.prepare('SELECT COUNT(*) AS n FROM broker_connections WHERE user_id = ?').get(userId),
    db.prepare('SELECT daily FROM email_prefs WHERE user_id = ?').get(userId),
  ]);

  const extraCurrencies = new Set([
    ...accounts.map((a) => a.currency),
    ...assets.map((a) => a.currency),
    ...txns.map((t) => t.currency),
  ]);
  // Distinct keys, so parallel writes into `rates` can't collide.
  await Promise.all(
    [...extraCurrencies]
      .filter((c) => rates[c] == null)
      .map(async (c) => {
        rates[c] = await getFxRate(c, base);
      })
  );
  const toBase = (amt, cur) => amt * (rates[cur] ?? 1);

  const byKind = {};
  let investValue = 0;
  let investCost = 0;
  for (const h of items) {
    const k = (byKind[h.kind] ||= {
      key: h.kind,
      label: KIND_LABELS[h.kind] || h.kind,
      value: 0,
      cost: 0,
      count: 0,
    });
    k.value += h.market_value_base;
    k.cost += h.cost_value_base;
    k.count += 1;
    investValue += h.market_value_base;
    investCost += h.cost_value_base;
  }

  const cashByType = {};
  let cashTotal = 0;
  for (const a of accounts) {
    const v = toBase(a.balance, a.currency);
    (cashByType[a.type] ||= { type: a.type, value: 0, count: 0 });
    cashByType[a.type].value += v;
    cashByType[a.type].count += 1;
    cashTotal += v;
  }

  const assetsByType = {};
  let assetsTotal = 0;
  for (const a of assets) {
    const v = toBase(a.value, a.currency);
    (assetsByType[a.type] ||= { type: a.type, value: 0, count: 0 });
    assetsByType[a.type].value += v;
    assetsByType[a.type].count += 1;
    assetsTotal += v;
  }

  const netWorth = investValue + cashTotal + assetsTotal;

  const allocation = [
    ...Object.values(byKind).map((k) => ({ key: k.key, label: k.label, value: k.value })),
    ...(cashTotal > 0 ? [{ key: 'CASH', label: 'Cash & Bank', value: cashTotal }] : []),
    ...(assetsTotal > 0 ? [{ key: 'ASSETS', label: 'Assets', value: assetsTotal }] : []),
  ].filter((a) => a.value > 0);

  const monthIndex = new Map(months.map((m, i) => [m.key, i]));
  for (const t of txns) {
    const idx = monthIndex.get(t.date.slice(0, 7));
    if (idx == null) continue;
    const v = toBase(t.amount, t.currency);
    if (t.type === 'INCOME') months[idx].income += v;
    else months[idx].expense += v;
  }
  const thisMonth = months[months.length - 1];

  return {
    base_currency: base,
    net_worth: netWorth,
    investments: {
      value: investValue,
      cost: investCost,
      gain: investValue - investCost,
      gain_pct: investCost > 0 ? ((investValue - investCost) / investCost) * 100 : 0,
      by_kind: Object.values(byKind),
    },
    cash: { total: cashTotal, by_type: Object.values(cashByType) },
    assets: { total: assetsTotal, by_type: Object.values(assetsByType) },
    allocation,
    cashflow: {
      months,
      this_month_income: thisMonth.income,
      this_month_expense: thisMonth.expense,
      this_month_net: thisMonth.income - thisMonth.expense,
    },
    counts: {
      holdings: holdings.length,
      accounts: accounts.length,
      assets: assets.length,
      // The TOTAL, not the 6-month slice — the dashboard's empty state keys off
      // this, and a user whose only data is older would wrongly see onboarding.
      transactions: Number(txnCountRow?.n || 0),
      goals: Number(goalsRow?.n || 0),
    },
    // Signals for the dashboard's getting-started checklist.
    setup: {
      imported: Number(brokerRow?.n || 0) > 0 || holdings.some((h) => /^imported/i.test(h.notes || '')),
      daily_email: !!prefsRow?.daily,
    },
    rates,
    ...(withItems ? { items } : {}),
    // The hierarchy behind `allocation`. Off by default: only the dashboard
    // draws it, and every other caller (digest, statements) would be paying to
    // serialise a tree it never reads.
    ...(withTree ? { allocation_tree: buildAllocationTree({ items, accounts, assets, toBase }) } : {}),
  };
}
