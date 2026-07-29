import { db } from '../db.js';
import { enrichHoldings, KIND_LABELS } from './portfolio.js';
import { getFxRate } from './prices.js';

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Full net-worth summary in the user's base currency. Shared by the dashboard
// route and the daily email digest.
export async function buildSummary(user, { refresh = false } = {}) {
  const base = user.base_currency;
  const userId = user.id;

  const holdings = await db.prepare('SELECT * FROM holdings WHERE user_id = ?').all(userId);
  const accounts = await db.prepare('SELECT * FROM cash_accounts WHERE user_id = ?').all(userId);
  const assets = await db.prepare('SELECT * FROM assets WHERE user_id = ?').all(userId);
  const txns = await db.prepare('SELECT * FROM transactions WHERE user_id = ?').all(userId);

  const { items, rates } = await enrichHoldings(holdings, base, { force: refresh });

  const extraCurrencies = new Set([
    ...accounts.map((a) => a.currency),
    ...assets.map((a) => a.currency),
    ...txns.map((t) => t.currency),
  ]);
  for (const c of extraCurrencies) {
    if (rates[c] == null) rates[c] = await getFxRate(c, base);
  }
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

  const months = [];
  const ref = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    months.push({ key: monthKey(d), income: 0, expense: 0 });
  }
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
      transactions: txns.length,
    },
    rates,
  };
}
