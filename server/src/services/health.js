import { db } from '../db.js';
import { getFxRate } from './prices.js';
import { todayIST } from './recurring.js';
import { buildSummary } from './summary.js';
import { measureCashflow } from './insights/fi.js';
import { nomineeAudit } from './legacy.js';
import { linkedMembers } from './family.js';
import { prefsFor } from '../routes/insights.js';
import { planFor } from '../routes/goals.js';

/* Financial health — six measured readings, and one number that is their mean.

   The shape follows the Financial Health Network's FinHealth Score: a 0–100
   composite across the pillars Spend, Save, Borrow and Plan & Protect, built
   from indicators rather than from opinion. The thresholds are the planners'
   common rules of thumb — save 20% of income, hold 3–6 months of expenses in
   cash, keep any one company under ~10% of a portfolio.

   What makes it Sampada's rather than a quiz: every reading is MEASURED from
   the user's own records, never asked. And three honesty rules hold it up:

   1. A dimension that can't be measured is left out, not scored zero. "You
      haven't logged spending" and "you save nothing" are different statements,
      and only one is true of a new account. The overall score is the mean of
      what CAN be measured, and it says how many that was.
   2. Fewer than three measurable dimensions => no overall score at all. One
      reading dressed up as a verdict on someone's finances is worse than none.
   3. Borrowing isn't scored. Sampada doesn't record loans, so a debt-to-income
      figure would be invented. The response says so instead.

   CONTRACT — buildHealth(user, { summary? }) resolves to:
   {
     score: 0..100 | null,        // null when fewer than MIN_DIMENSIONS measured
     band: { key, label } | null, // excellent ≥80 · good ≥60 · fair ≥40 · needs_attention
     scored: n, total: 6,
     weakest: { key, label, score } | null,
     headline: string,
     dimensions: [{
       key, label, pillar, available, score, band,
       value, target, tip, reason, action: { label, to }, metrics
     }],
     not_scored: [string],
     as_of: 'YYYY-MM-DD',
   }
*/

export const MIN_DIMENSIONS = 3;

/* --------------------------------- helpers -------------------------------- */

// Piecewise-linear through [x, y] knots (x ascending), clamped at both ends.
// Every threshold in this file is a knot, so each rule reads as a small table.
export function curve(x, knots) {
  if (!Number.isFinite(x)) return null;
  if (x <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i += 1) {
    const [x1, y1] = knots[i];
    if (x <= x1) {
      const [x0, y0] = knots[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return knots[knots.length - 1][1];
}

export function bandFor(score) {
  if (score == null) return null;
  if (score >= 80) return { key: 'excellent', label: 'Excellent' };
  if (score >= 60) return { key: 'good', label: 'Good' };
  if (score >= 40) return { key: 'fair', label: 'Fair' };
  return { key: 'needs_attention', label: 'Needs attention' };
}

const clampScore = (v) => Math.max(0, Math.min(100, Math.round(v)));
const pct = (f, dp = 1) => `${(f * 100).toFixed(dp)}%`;

function moneyFmt(base) {
  let fmt;
  try {
    fmt = new Intl.NumberFormat(base === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency: base || 'INR',
      maximumFractionDigits: 0,
    });
  } catch {
    fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  }
  return (v) => fmt.format(Math.round(Number(v) || 0));
}

// The month before the current IST month, as [YYYY-MM-01, YYYY-MM-last, label].
function lastMonthRange() {
  const [y, m] = todayIST().split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 2, 1));
  const end = new Date(Date.UTC(y, m - 1, 0));
  const iso = (d) => d.toISOString().slice(0, 10);
  const label = start.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return [iso(start), iso(end), label];
}

const unavailable = (key, label, pillar, reason, action) => ({
  key,
  label,
  pillar,
  available: false,
  score: null,
  band: null,
  value: null,
  target: null,
  tip: null,
  reason,
  action,
  metrics: {},
});

const scored = (key, label, pillar, raw, rest) => {
  const score = clampScore(raw);
  return { key, label, pillar, available: true, score, band: bandFor(score), reason: null, ...rest };
};

/* ------------------------------- 1. savings ------------------------------- */
// Spend pillar. Of what comes in, how much stays? Measured with the same
// window the FI tracker and goal plan use, so all three agree on the numbers.
//   ≤0% → 0 · 10% → 50 · 20% → 80 · ≥30% → 100
function savingsRate(m, money) {
  const A = { label: 'Transactions', to: '/transactions' };
  if (m.months < 2) {
    return unavailable('savings', 'Savings rate', 'Spend', 'Needs two months of recorded income and spending.', A);
  }
  if (!(m.monthly_income > 0)) {
    return unavailable('savings', 'Savings rate', 'Spend', 'No income is recorded in the months measured, so there is nothing to divide by.', A);
  }
  const rate = m.monthly_surplus / m.monthly_income;
  const raw = curve(rate, [[0, 0], [0.1, 50], [0.2, 80], [0.3, 100]]);
  const twenty = 0.2 * m.monthly_income - m.monthly_surplus;
  return scored('savings', 'Savings rate', 'Spend', raw, {
    value:
      rate >= 0
        ? `You keep ${pct(rate)} of your income, about ${money(m.monthly_surplus)} a month.`
        : `You spend ${pct(-rate)} more than you earn, about ${money(-m.monthly_surplus)} a month.`,
    target: '20% of income or more',
    tip:
      rate < 0
        ? 'That shortfall is coming out of savings each month. The biggest expense category is the place to start.'
        : rate < 0.2
          ? `Keeping ${money(twenty)} more a month would reach 20%.`
          : rate < 0.3
            ? 'On target. Whatever lands in the account each month is worth sending to investments.'
            : `Excellent. Make sure the ${money(m.monthly_surplus)} a month is invested, not sitting idle.`,
    action: A,
    metrics: { rate, monthly_income: m.monthly_income, monthly_spend: m.monthly_spend, months: m.months },
  });
}

/* ----------------------------- 2. emergency fund ------------------------- */
// Save pillar. Months of spending the cash accounts would cover. FDs count —
// they can be broken within a day — property and investments don't.
//   0 → 0 · 1 → 25 · 3 → 60 · ≥6 → 100
function emergencyFund(summary, m, setAnnualSpend, money) {
  const A = { label: 'Cash & Bank', to: '/cash' };
  let spend = null;
  let source = null;
  if (m.months >= 2 && m.monthly_spend > 0) {
    spend = m.monthly_spend;
    source = 'measured';
  } else if (setAnnualSpend > 0) {
    spend = setAnnualSpend / 12;
    source = 'set';
  }
  if (!spend) {
    return unavailable(
      'emergency',
      'Emergency fund',
      'Save',
      'Needs your monthly spending — record two months of expenses, or set annual spending in Insights.',
      { label: 'Transactions', to: '/transactions' }
    );
  }
  const cash = Math.max(0, Number(summary?.cash?.total) || 0);
  const months = cash / spend;
  const raw = curve(months, [[0, 0], [1, 25], [3, 60], [6, 100]]);
  return scored('emergency', 'Emergency fund', 'Save', raw, {
    value: `Your cash covers ${months.toFixed(1)} months of spending (${money(spend)} a month${source === 'set' ? ', from the figure you set' : ''}).`,
    target: '6 months — 3 at the very least',
    tip:
      months >= 12
        ? `More than a year of cash. Beyond six months, about ${money(cash - 6 * spend)} could be working harder invested.`
        : months >= 6
          ? 'A full cushion. Keep it where it can be reached in a day.'
          : months >= 3
            ? `${money(6 * spend - cash)} more reaches the full six months.`
            : `${money(3 * spend - cash)} more gets you to three months — the first milestone.`,
    action: A,
    metrics: { months, cash, monthly_spend: spend, spend_source: source },
  });
}

/* ----------------------------- 3. budget adherence ------------------------ */
// Spend pillar. Last COMPLETE month: judging a month in progress would make a
// budget look perfect on the 2nd. A category up to 10% over earns half credit
// — a near miss isn't a blow-out.
async function budgetAdherence(user, money) {
  const A = { label: 'Transactions', to: '/transactions' };
  const base = user.base_currency;
  const budgets = await db.prepare('SELECT category, amount, currency FROM budgets WHERE user_id = ?').all(user.id);
  if (!budgets.length) {
    return unavailable('budgets', 'Budget adherence', 'Spend', 'Set monthly budgets for your spending categories to measure this.', A);
  }
  const [from, to, label] = lastMonthRange();
  const rows = await db
    .prepare(
      `SELECT category, currency, SUM(amount) AS total FROM transactions
        WHERE user_id = ? AND type = 'EXPENSE' AND date >= ? AND date <= ?
        GROUP BY category, currency`
    )
    .all(user.id, from, to);
  if (!rows.length) {
    return unavailable('budgets', 'Budget adherence', 'Spend', `No spending is recorded for ${label} to compare your budgets against.`, A);
  }
  const rates = { [base]: 1 };
  const rate = async (c) => {
    const cur = c || base;
    if (rates[cur] == null) rates[cur] = await getFxRate(cur, base);
    return rates[cur];
  };
  const spent = {};
  for (const r of rows) {
    const k = String(r.category || 'Uncategorised').toLowerCase();
    spent[k] = (spent[k] || 0) + Number(r.total) * (await rate(r.currency));
  }
  let within = 0;
  let slight = 0;
  let worst = null;
  for (const b of budgets) {
    const amount = Number(b.amount) * (await rate(b.currency));
    const used = spent[String(b.category).toLowerCase()] || 0;
    if (used <= amount) within += 1;
    else {
      if (used <= amount * 1.1) slight += 1;
      const over = amount > 0 ? used / amount - 1 : Infinity;
      if (!worst || over > worst.over) worst = { category: b.category, over, amount: used - amount };
    }
  }
  const n = budgets.length;
  const raw = ((within + 0.5 * slight) / n) * 100;
  return scored('budgets', 'Budget adherence', 'Spend', raw, {
    value: `${within} of ${n} ${n === 1 ? 'category' : 'categories'} stayed within budget in ${label}.`,
    target: 'Every category within budget',
    tip: worst
      ? `${worst.category} ran ${Number.isFinite(worst.over) ? pct(worst.over, 0) : 'well'} over, by ${money(worst.amount)}. Either the budget or the habit needs adjusting.`
      : `Every category held in ${label}.`,
    action: A,
    metrics: { within, slightly_over: slight, total: n, month: from.slice(0, 7), worst },
  });
}

/* ----------------------------- 4. diversification ------------------------ */
// Portfolio. Two things: how big the single largest COMPANY is, and how many
// categories the money spans. Funds and ETFs are baskets — one Nifty 50 fund is
// fifty companies — so they never count as a concentration. ETFs are often
// filed as stocks, so they're recognised by name (…ETF, …BEES, …INDEX…).
//   largest company: ≤10% → 100 · 20% → 75 · 35% → 45 · 60% → 15 · 100% → 0
//   categories ≥5% of the portfolio: 1 → 40 · 2 → 75 · 3+ → 100
//   score = 60% company + 40% categories
const FUND_LIKE = /(\bETF\b|ETF$|BEES$|\bINDEX\b|\bFUND\b)/i;
export const isFundLike = (h) => h.kind === 'IN_MF' || FUND_LIKE.test(`${h.symbol || ''} ${h.name || ''}`);

function diversification(summary, money) {
  const A = { label: 'Investments', to: '/investments' };
  const items = (summary?.items || []).filter((h) => Number(h.market_value_base) > 0);
  const total = items.reduce((s, h) => s + Number(h.market_value_base), 0);
  if (!(total > 0)) {
    return unavailable('diversification', 'Diversification', 'Grow', 'Add investments to measure how spread out they are.', A);
  }
  const names = new Map();
  let fundValue = 0;
  for (const h of items) {
    if (isFundLike(h)) {
      fundValue += Number(h.market_value_base);
      continue;
    }
    // The same company held twice (two lots, two brokers) is one exposure.
    const key = `${h.kind}:${String(h.symbol || h.name).toUpperCase()}`;
    const cur = names.get(key) || { name: h.name || h.symbol, value: 0 };
    cur.value += Number(h.market_value_base);
    names.set(key, cur);
  }
  const largest = [...names.values()].sort((a, b) => b.value - a.value)[0] || null;
  const share = largest ? largest.value / total : 0;
  const a = curve(share, [[0.1, 100], [0.2, 75], [0.35, 45], [0.6, 15], [1, 0]]);
  const kinds = (summary?.investments?.by_kind || []).filter((k) => Number(k.value) / total >= 0.05);
  const c = kinds.length;
  const b = c >= 3 ? 100 : c === 2 ? 75 : 40;
  const raw = 0.6 * a + 0.4 * b;
  return scored('diversification', 'Diversification', 'Grow', raw, {
    value: `${
      largest
        ? `Your largest single company, ${largest.name}, is ${pct(share, 0)} of your investments`
        : 'Everything is in funds, which are diversified by design'
    } — spread across ${c} ${c === 1 ? 'category' : 'categories'}${c ? ` (${kinds.map((k) => k.label).join(', ')})` : ''}.`,
    target: 'No single company above 10%; three or more categories',
    tip:
      share > 0.1 && largest
        ? `Bringing ${largest.name} down to 10% would spread about ${money(largest.value - 0.1 * total)} across the rest of the portfolio.`
        : c < 3
          ? 'A third category — an index fund, or another market — would spread the risk further.'
          : 'Well spread. A yearly rebalance keeps it that way.',
    action: A,
    metrics: { largest_share: share, largest_name: largest?.name || null, categories: c, fund_share: fundValue / total },
  });
}

/* ----------------------------- 5. investment growth ----------------------- */
// Portfolio. Market value against what was paid, across every holding with a
// buy price. Not annualised — holdings carry no purchase date to divide by —
// which the page says out loud.
//   ≤−20% → 0 · 0% → 40 · +15% → 80 · ≥+30% → 100
function growth(summary, money) {
  const A = { label: 'Returns & tax', to: '/returns' };
  const items = (summary?.items || []).filter((h) => Number(h.cost_value_base) > 0);
  const cost = items.reduce((s, h) => s + Number(h.cost_value_base), 0);
  if (!(cost > 0)) {
    return unavailable('growth', 'Investment growth', 'Grow', 'Needs buy prices on your holdings to compare against.', { label: 'Investments', to: '/investments' });
  }
  const value = items.reduce((s, h) => s + (Number(h.market_value_base) || 0), 0);
  const g = (value - cost) / cost;
  const raw = curve(g, [[-0.2, 0], [0, 40], [0.15, 80], [0.3, 100]]);
  const losers = items
    .map((h) => ({ name: h.name || h.symbol, loss: Number(h.cost_value_base) - (Number(h.market_value_base) || 0) }))
    .filter((x) => x.loss > 0)
    .sort((x, y) => y.loss - x.loss);
  return scored('growth', 'Investment growth', 'Grow', raw, {
    value: `Your investments are ${g >= 0 ? 'up' : 'down'} ${pct(Math.abs(g))} on what you paid — ${money(Math.abs(value - cost))} ${g >= 0 ? 'ahead' : 'behind'}.`,
    target: '+15% or more since purchase',
    tip: losers.length
      ? `${losers.length} of ${items.length} ${items.length === 1 ? 'holding' : 'holdings'} ${losers.length === 1 ? 'is' : 'are'} below cost; ${losers[0].name} is the biggest drag at ${money(losers[0].loss)}.`
      : 'Every holding is above what you paid for it.',
    action: A,
    metrics: { gain_pct: g, cost, value, below_cost: losers.length, holdings: items.length },
  });
}

/* ------------------------------ 6. plan & protect ------------------------- */
// Plan & Protect pillar. FinHealth asks "are you insured, are you planning
// ahead?". Sampada can measure its own version: are goals on track, would your
// family be able to claim what you own (nominees), and would they even find it
// (a legacy contact)? Weights 50 nominees · 30 goals · 20 legacy contact,
// renormalised over whichever parts exist.
async function planAndProtect(user, summary, money) {
  const [audit, legacyRow, members, plan] = await Promise.all([
    nomineeAudit(user.id),
    db.prepare('SELECT legacy_enabled, legacy_contact_user_id FROM users WHERE id = ?').get(user.id),
    linkedMembers(user.id),
    planFor(user, { summary }).catch(() => null),
  ]);
  const goals = plan?.goals || [];
  // A goal with no date, or no monthly figure, can't be on or off track.
  const judged = goals.filter((g) => !['no_date', 'unknown'].includes(g.plan?.status ?? g.status));
  const statusOf = (g) => g.plan?.status ?? g.status;
  const onTrack = judged.filter((g) => ['funded', 'on_track'].includes(statusOf(g)));
  const armed =
    !!legacyRow?.legacy_enabled && members.some((mm) => mm.id === Number(legacyRow.legacy_contact_user_id));

  const c = audit.counts;
  if (c.total === 0 && judged.length === 0) {
    return unavailable('protect', 'Plan & protect', 'Plan & Protect', 'Add accounts, investments or goals to measure this.', { label: 'Legacy', to: '/legacy' });
  }
  const parts = [];
  if (c.total > 0) parts.push({ w: 0.5, v: (c.registered / c.total) * 100 });
  if (judged.length) parts.push({ w: 0.3, v: (onTrack.length / judged.length) * 100 });
  parts.push({ w: 0.2, v: armed ? 100 : 0 });
  const raw = parts.reduce((s, p) => s + p.w * p.v, 0) / parts.reduce((s, p) => s + p.w, 0);

  const gaps = c.total - c.registered;
  const behind = judged
    .filter((g) => !['funded', 'on_track'].includes(statusOf(g)))
    .map((g) => ({ name: g.name, extra: Number(g.plan?.extra_needed) || 0 }))
    .sort((a, b) => b.extra - a.extra);
  const bits = [];
  if (c.total > 0) bits.push(`${c.registered} of ${c.total} accounts and holdings have a nominee`);
  if (judged.length) bits.push(`${onTrack.length} of ${judged.length} ${judged.length === 1 ? 'goal is' : 'goals are'} on track`);
  bits.push(armed ? 'a legacy contact is named' : 'no legacy contact named');

  let tip;
  let action = { label: 'Legacy', to: '/legacy' };
  if (gaps > 0) tip = `${gaps} ${gaps === 1 ? 'item has' : 'items have'} no registered nominee marked. Without one, money is the slowest thing for a family to claim — record them in Legacy.`;
  else if (!armed) tip = 'Name a legacy contact, so someone you trust would find everything if they ever had to.';
  else if (behind.length) {
    tip = behind[0].extra > 0
      ? `${behind[0].name} needs about ${money(behind[0].extra)} more a month to stay on track.`
      : `${behind[0].name} is behind schedule — its plan shows what would bring it back.`;
    action = { label: 'Goals', to: '/goals' };
  } else tip = 'Nominees recorded, goals on track, a contact named — fully covered.';

  return scored('protect', 'Plan & protect', 'Plan & Protect', raw, {
    value: `${bits.join(' · ')}.`,
    target: 'Every account with a nominee, goals on track, a legacy contact named',
    tip,
    action,
    metrics: {
      nominee_coverage: c.total > 0 ? c.registered / c.total : null,
      nominees: c,
      goals_judged: judged.length,
      goals_on_track: onTrack.length,
      legacy_armed: armed,
    },
  });
}

/* ---------------------------------- build --------------------------------- */
const HEADLINES = {
  excellent: 'Strong across the board.',
  good: 'On a solid footing — a couple of changes would lift it further.',
  fair: 'Some real gaps worth closing.',
  needs_attention: 'A few basics need work. Start with the weakest area below.',
};

export async function buildHealth(user, { summary = null } = {}) {
  const sum = summary || (await buildSummary(user, { scope: null, withItems: true }));
  const money = moneyFmt(user.base_currency);
  const m = measureCashflow(sum);
  const prefs = await prefsFor(user.id).catch(() => null);
  // Stored in whatever currency it was typed in; everything else here is base.
  let setAnnualSpend = Number(prefs?.annual_spend) || 0;
  if (setAnnualSpend > 0 && prefs.annual_spend_currency && prefs.annual_spend_currency !== user.base_currency) {
    setAnnualSpend *= await getFxRate(prefs.annual_spend_currency, user.base_currency);
  }

  const [budgets, protect] = await Promise.all([budgetAdherence(user, money), planAndProtect(user, sum, money)]);
  const dimensions = [
    savingsRate(m, money),
    emergencyFund(sum, m, setAnnualSpend, money),
    budgets,
    diversification(sum, money),
    growth(sum, money),
    protect,
  ];

  const measured = dimensions.filter((d) => d.available);
  const score =
    measured.length >= MIN_DIMENSIONS
      ? clampScore(measured.reduce((s, d) => s + d.score, 0) / measured.length)
      : null;
  const band = bandFor(score);
  const weakest = measured.length ? [...measured].sort((a, b) => a.score - b.score)[0] : null;

  return {
    score,
    band,
    scored: measured.length,
    total: dimensions.length,
    weakest: weakest ? { key: weakest.key, label: weakest.label, score: weakest.score } : null,
    headline:
      score == null
        ? `${measured.length} of ${dimensions.length} measured so far — a score needs at least ${MIN_DIMENSIONS}.`
        : HEADLINES[band.key],
    dimensions,
    not_scored: ["Borrowing (debt-to-income) isn't scored: Sampada doesn't record loans yet, so the figure would be invented."],
    as_of: todayIST(),
  };
}
