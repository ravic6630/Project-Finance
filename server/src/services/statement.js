import { db } from '../db.js';
import { escapeHtml } from '../util.js';
import { buildSummary } from './summary.js';
import { enrichHoldings } from './portfolio.js';
import { getFxRate } from './prices.js';

// Monthly statement: one crisp page per calendar month.
//   "What happened in <Month>"  — net-worth change (snapshots), money in/out,
//                                 top spending, budgets — historically accurate.
//   "Where your money is today" — holdings/cash/assets at generation time.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

const snapBefore = db.prepare(
  'SELECT net_worth, currency, date FROM net_worth_snapshots WHERE user_id = ? AND date < ? ORDER BY date DESC LIMIT 1'
);
const snapFirstIn = db.prepare(
  'SELECT net_worth, currency, date FROM net_worth_snapshots WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date ASC LIMIT 1'
);
const snapLastUpTo = db.prepare(
  'SELECT net_worth, currency, date FROM net_worth_snapshots WHERE user_id = ? AND date <= ? ORDER BY date DESC LIMIT 1'
);
const monthTxns = db.prepare(
  'SELECT * FROM transactions WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date'
);
const allBudgets = db.prepare('SELECT * FROM budgets WHERE user_id = ? ORDER BY category');
const holdingsFor = db.prepare('SELECT * FROM holdings WHERE user_id = ? ORDER BY kind, name');
const accountsFor = db.prepare('SELECT * FROM cash_accounts WHERE user_id = ? ORDER BY type, name');
const assetsFor = db.prepare('SELECT * FROM assets WHERE user_id = ? ORDER BY value DESC, name');

// Which months can a statement cover? From the user's first sign of life
// (account creation, first snapshot, or first transaction) up to now, max 12.
export async function availableMonths(user) {
  const firsts = [
    (await db.prepare('SELECT MIN(date) AS d FROM net_worth_snapshots WHERE user_id = ?').get(user.id))?.d,
    (await db.prepare('SELECT MIN(date) AS d FROM transactions WHERE user_id = ?').get(user.id))?.d,
    String(user.created_at || '').slice(0, 10) || null,
  ].filter(Boolean);
  const earliest = firsts.sort()[0].slice(0, 7);
  const out = [];
  const nowD = new Date();
  let y = nowD.getFullYear();
  let m = nowD.getMonth() + 1;
  for (let i = 0; i < 12; i += 1) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    if (ym < earliest) break;
    out.push({ ym, label: monthLabel(ym) });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export async function statementData(user, ym) {
  const [y, m] = ym.split('-').map(Number);
  const base = user.base_currency;
  const first = `${ym}-01`;
  const last = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

  const fx = {};
  const toBase = async (amt, cur) => {
    const c = cur || base;
    if (fx[c] == null) fx[c] = await getFxRate(c, base);
    return amt * fx[c];
  };

  // --- net-worth story (own-account snapshots) ---
  const openRow = (await snapBefore.get(user.id, first)) || (await snapFirstIn.get(user.id, first, last));
  const closeRow = await snapLastUpTo.get(user.id, last);
  const opening = openRow ? await toBase(openRow.net_worth, openRow.currency) : null;
  const closing = closeRow ? await toBase(closeRow.net_worth, closeRow.currency) : null;
  const change = opening != null && closing != null ? closing - opening : null;
  const changePct = change != null && opening > 0 ? (change / opening) * 100 : null;

  // --- cash flow for the month ---
  const txns = await monthTxns.all(user.id, first, last);
  let income = 0;
  let expense = 0;
  const byCategory = new Map();
  for (const t of txns) {
    const v = await toBase(t.amount, t.currency);
    if (t.type === 'INCOME') income += v;
    else {
      expense += v;
      const key = t.category || 'Uncategorised';
      byCategory.set(key, (byCategory.get(key) || 0) + v);
    }
  }
  const spending = [...byCategory.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
  const topSpending = spending.slice(0, 6);
  const otherSpend = spending.slice(6).reduce((s, r) => s + r.amount, 0);

  // --- budgets vs spend (only categories with a budget) ---
  const budgets = [];
  for (const b of await allBudgets.all(user.id)) {
    const budgetBase = await toBase(b.amount, b.currency);
    const spent = byCategory.get(b.category) || 0;
    budgets.push({
      category: b.category,
      budget: budgetBase,
      spent,
      pct: budgetBase > 0 ? Math.round((spent / budgetBase) * 100) : 0,
    });
  }

  // --- positions today ---
  const summary = await buildSummary(user, { scope: null });
  const { items: holdings } = await enrichHoldings(await holdingsFor.all(user.id), base, {});
  holdings.sort((a, b) => b.market_value_base - a.market_value_base);
  const accounts = [];
  for (const a of await accountsFor.all(user.id)) {
    accounts.push({ name: a.name, type: a.type, value: await toBase(a.balance, a.currency) });
  }
  const assets = [];
  for (const a of await assetsFor.all(user.id)) {
    assets.push({ name: a.name, type: a.type, value: await toBase(a.value, a.currency) });
  }

  return {
    ym,
    label: monthLabel(ym),
    base,
    opening,
    closing,
    change,
    changePct,
    cashflow: { income, expense, net: income - expense, topSpending, otherSpend, txnCount: txns.length },
    budgets,
    positions: {
      investments: summary.investments,
      cashTotal: summary.cash.total,
      assetsTotal: summary.assets.total,
      netWorthNow: summary.net_worth,
      holdings,
      accounts,
      assets,
    },
    generatedAt: new Date().toISOString(),
  };
}

/* --------------------------------- HTML --------------------------------- */

const NAVY = '#1f3a66';
const GOLD = '#c2a368';

export function statementHtml(user, d, { forPrint = false } = {}) {
  const fmt = new Intl.NumberFormat(d.base === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency: d.base,
    maximumFractionDigits: 2,
  });
  const money = (v) => fmt.format(v || 0);
  const up = (v) => (v >= 0 ? '#059669' : '#e11d48');
  const name = escapeHtml((user.name || user.email).split(' ')[0]);

  const section = (title, inner) => `
    <tr><td style="padding:18px 0 6px;font-size:12px;font-weight:800;letter-spacing:1px;color:${GOLD}">${title}</td></tr>
    <tr><td style="background:#fff;border:1px solid #e8e2d4;border-radius:14px;padding:16px 18px">${inner}</td></tr>`;

  const row = (l, r, bold = false, color = '#0f172a') => `
    <tr>
      <td style="padding:5px 0;color:#475569;font-size:13px">${l}</td>
      <td style="padding:5px 0;text-align:right;font-size:13px;${bold ? 'font-weight:700;' : ''}color:${color}">${r}</td>
    </tr>`;

  // Net-worth story
  let story;
  if (d.opening != null && d.closing != null && d.change != null) {
    story = `
      <div style="font-size:13px;color:#64748b">Started ${escapeHtml(d.label)} at <b style="color:#0f172a">${money(d.opening)}</b></div>
      <div style="font-size:30px;font-weight:800;color:${NAVY};margin:2px 0">${money(d.closing)}</div>
      <div style="font-size:13px;font-weight:700;color:${up(d.change)}">
        ${d.change >= 0 ? '▲' : '▼'} ${money(Math.abs(d.change))}${d.changePct != null ? ` (${d.change >= 0 ? '+' : ''}${d.changePct.toFixed(1)}%)` : ''} this month
      </div>`;
  } else if (d.closing != null) {
    story = `
      <div style="font-size:13px;color:#64748b">Net worth at the end of ${escapeHtml(d.label)}</div>
      <div style="font-size:30px;font-weight:800;color:${NAVY};margin:2px 0">${money(d.closing)}</div>
      <div style="font-size:12px;color:#94a3b8">Your first month on Sampada — next month you'll see the change here 🌱</div>`;
  } else {
    story = `<div style="font-size:13px;color:#94a3b8">No net-worth history for ${escapeHtml(d.label)} yet — open your dashboard once and Sampada starts tracking it daily.</div>`;
  }

  const cf = d.cashflow;
  const cashflowInner = `
    <table style="width:100%;border-collapse:collapse;text-align:center">
      <tr>
        <td style="padding:2px 4px"><div style="font-size:11px;color:#64748b;letter-spacing:.5px">MONEY IN</div>
          <div style="font-size:17px;font-weight:800;color:#059669">${money(cf.income)}</div></td>
        <td style="padding:2px 4px"><div style="font-size:11px;color:#64748b;letter-spacing:.5px">MONEY OUT</div>
          <div style="font-size:17px;font-weight:800;color:#e11d48">${money(cf.expense)}</div></td>
        <td style="padding:2px 4px"><div style="font-size:11px;color:#64748b;letter-spacing:.5px">SAVED</div>
          <div style="font-size:17px;font-weight:800;color:${up(cf.net)}">${money(cf.net)}</div></td>
      </tr>
    </table>
    ${cf.txnCount === 0 ? `<p style="margin:10px 0 0;font-size:12px;color:#94a3b8;text-align:center">No transactions recorded in ${escapeHtml(d.label)}.</p>` : ''}`;

  const spendInner = cf.topSpending.length
    ? `<table style="width:100%;border-collapse:collapse">${cf.topSpending
        .map((s) =>
          row(
            escapeHtml(s.category),
            `${money(s.amount)} <span style="color:#94a3b8;font-size:11px">· ${cf.expense > 0 ? Math.round((s.amount / cf.expense) * 100) : 0}%</span>`
          )
        )
        .join('')}${cf.otherSpend > 0 ? row('Everything else', money(cf.otherSpend)) : ''}</table>`
    : null;

  const budgetsInner = d.budgets.length
    ? `<table style="width:100%;border-collapse:collapse">${d.budgets
        .map((b) =>
          row(
            escapeHtml(b.category),
            `${money(b.spent)} <span style="color:#94a3b8">/ ${money(b.budget)}</span> <b style="color:${b.pct > 100 ? '#e11d48' : '#059669'}">${b.pct}%</b>`
          )
        )
        .join('')}</table>`
    : null;

  const p = d.positions;
  const holdingRows = p.holdings
    .slice(0, 12)
    .map((h) => {
      const gainPct = h.cost_value_base > 0 ? ((h.market_value_base - h.cost_value_base) / h.cost_value_base) * 100 : 0;
      return `<tr>
        <td style="padding:5px 0;font-size:13px;color:#0f172a">${escapeHtml(h.name)}<span style="color:#94a3b8;font-size:11px"> · ${h.quantity}</span></td>
        <td style="padding:5px 0;text-align:right;font-size:13px;font-weight:600;color:#0f172a">${money(h.market_value_base)}</td>
        <td style="padding:5px 0 5px 10px;text-align:right;font-size:12px;font-weight:700;color:${up(gainPct)}">${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%</td>
      </tr>`;
    })
    .join('');
  const positionsInner = `
    <table style="width:100%;border-collapse:collapse;margin-bottom:6px">
      ${row('Investments', `<b>${money(p.investments.value)}</b> <span style="font-size:11px;font-weight:700;color:${up(p.investments.gain)}">${p.investments.gain >= 0 ? '+' : ''}${money(p.investments.gain)}</span>`)}
      ${row('Cash & bank', `<b>${money(p.cashTotal)}</b>`)}
      ${row('Other assets', `<b>${money(p.assetsTotal)}</b>`)}
      ${row('<b>Total net worth today</b>', `<b style="font-size:15px;color:${NAVY}">${money(p.netWorthNow)}</b>`)}
    </table>
    ${p.holdings.length ? `<div style="border-top:1px solid #f1f5f9;padding-top:8px"><table style="width:100%;border-collapse:collapse">${holdingRows}</table>${p.holdings.length > 12 ? `<p style="margin:6px 0 0;font-size:11px;color:#94a3b8">+ ${p.holdings.length - 12} more holdings</p>` : ''}</div>` : ''}
    ${p.accounts.length ? `<div style="border-top:1px solid #f1f5f9;margin-top:8px;padding-top:8px"><table style="width:100%;border-collapse:collapse">${p.accounts.map((a) => row(`${escapeHtml(a.name)} <span style="color:#94a3b8;font-size:11px">· ${escapeHtml(a.type)}</span>`, money(a.value))).join('')}</table></div>` : ''}
    ${p.assets.length ? `<div style="border-top:1px solid #f1f5f9;margin-top:8px;padding-top:8px"><table style="width:100%;border-collapse:collapse">${p.assets.map((a) => row(`${escapeHtml(a.name)} <span style="color:#94a3b8;font-size:11px">· ${escapeHtml(a.type)}</span>`, money(a.value))).join('')}</table></div>` : ''}`;

  const printBits = forPrint
    ? `<div class="no-print" style="position:fixed;top:14px;right:14px">
        <button onclick="window.print()" style="background:${NAVY};color:#fff;border:0;border-radius:10px;padding:10px 16px;font-weight:700;font-size:13px;cursor:pointer">Save as PDF / Print</button>
      </div>
      <style>@media print { .no-print { display:none } body { background:#fff !important } }</style>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sampada statement — ${escapeHtml(d.label)}</title></head>
  <body style="margin:0;background:#f4f2ec;font-family:Arial,Helvetica,sans-serif">
  ${printBits}
  <div style="max-width:620px;margin:0 auto;padding:22px 14px">
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="background:linear-gradient(135deg,${NAVY},#0f2547);border-radius:16px;padding:20px 22px;color:#fff">
        <div style="font-size:15px;font-weight:800">🌱 Sampada</div>
        <div style="font-size:22px;font-weight:800;margin-top:6px">Monthly statement · ${escapeHtml(d.label)}</div>
        <div style="font-size:12px;color:#c7d2e4;margin-top:2px">${escapeHtml(user.name || '')} · ${escapeHtml(user.email)} · all amounts in ${escapeHtml(d.base)}</div>
      </td></tr>

      ${section(`YOUR NET WORTH — ${escapeHtml(d.label).toUpperCase()}`, story)}
      ${section('THIS MONTH’S CASH FLOW', cashflowInner)}
      ${spendInner ? section('WHERE THE MONEY WENT', spendInner) : ''}
      ${budgetsInner ? section('BUDGETS', budgetsInner) : ''}
      ${section('WHERE YOUR MONEY IS TODAY', positionsInner)}

      <tr><td style="padding:16px 6px 30px;font-size:11px;color:#94a3b8;text-align:center">
        Cash-flow and net-worth change cover ${escapeHtml(d.label)} · holdings and balances are as of
        ${new Date(d.generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.
        Generated by Sampada — questions? Just reply from the in-app support chat.
      </td></tr>
    </table>
  </div></body></html>`;
}
