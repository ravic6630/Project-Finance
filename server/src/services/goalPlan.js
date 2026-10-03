// Goal plan: spreads what you actually own, and what you actually have left
// each month, across your goals — in priority order.
//
// The old model asked for two numbers per goal ("saved so far", "monthly
// contribution") and trusted them. Nothing tied them to the portfolio, so
// progress never moved with the market, and three goals could each claim the
// same ₹20 lakh. Here every rupee is counted once:
//
//  1. THE POT — investments + cash. Property is left out: a home you live in
//     can't pay for a wedding.
//  2. TODAY — a goal the user has funded with named investments and accounts
//     (see goalFunding.js) gets exactly those, and they leave the pot: that is
//     the accurate reading, so nothing is added to it by guesswork. What's left
//     of the pot fills the remaining goals in priority order. Each takes only
//     what it still needs today: the sum that, left invested at the goal's
//     expected return, grows into its target by its date. What no goal needs
//     is reported as unassigned, never quietly spread.
//  3. EVERY MONTH — the monthly surplus (income − spending, or the amount the
//     user sets) fills the same queue: each goal takes the monthly amount that
//     closes its remaining gap, until the surplus runs out. What's left over,
//     or how far short it falls, answers "can I afford all of this?".
//
// Conventions match the projection the app has always shown: a lump grows at
// (1 + r)^years, and monthly contributions are made at the start of each month
// at r/12. Keeping them means a goal's numbers don't jump just because the
// plan, rather than the goal alone, produced them.

const YEAR_MS = 365.25 * 24 * 3600 * 1000;
// A century. Past that a date is arithmetic, not a plan.
const MAX_MONTHS = 1200;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

export function yearsUntil(date, nowMs = Date.now()) {
  if (!date) return 0;
  const ms = Date.parse(`${date}T00:00:00`);
  return Number.isFinite(ms) ? Math.max(0, (ms - nowMs) / YEAR_MS) : 0;
}

const growth = (r, years) => (1 + r / 100) ** years;

// Future value of 1 a month for n months, paid at the start of each month.
function sipFactor(n, r) {
  if (n <= 0) return 0;
  const i = r / 100 / 12;
  return i === 0 ? n : (((1 + i) ** n - 1) / i) * (1 + i);
}

// What `funded` today, plus `monthly` every month, is worth at the deadline.
export function projectValue(funded, monthly, r, years) {
  return funded * growth(r, years) + monthly * sipFactor(Math.round(years * 12), r);
}

// What a goal needs set aside TODAY to get there with no more saving: the sum
// that grows into the target by the date.
export function neededToday(target, r, years) {
  const g = growth(r, years);
  return Number.isFinite(g) && g > 0 ? target / g : target;
}

// The monthly amount that closes the gap from `funded` by the date. 0 when the
// money set aside already gets there; null when there are no months left to
// save in, so no monthly figure can help.
export function requiredMonthly(target, funded, r, years) {
  const f = sipFactor(Math.round(years * 12), r);
  if (!(f > 0)) return null;
  const gap = target - funded * growth(r, years);
  // A goal handed exactly what it needs today got that figure by dividing the
  // target by the growth; multiplying back leaves a residue around 1e-10 as
  // often as not. That is arithmetic, not money — and left in, it made a
  // covered goal read "on track, ₹0 a month" on one load and "covered" on the
  // next. Anything under a billionth of the target is nothing.
  return gap <= target * 1e-9 ? 0 : gap / f;
}

// How many months until `funded` plus `monthly` a month reaches the target, or
// null if it never does within a century. A plain month-by-month walk: it is
// correct for any return (even a negative one), and 1,200 steps is nothing.
export function monthsToReach(funded, monthly, target, r) {
  if (funded >= target) return 0;
  for (let m = 1; m <= MAX_MONTHS; m += 1) {
    if (funded * growth(r, m / 12) + monthly * sipFactor(m, r) >= target) return m;
  }
  return null;
}

function addMonths(nowMs, months) {
  const d = new Date(nowMs);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

// Emergency money comes first — the one rule every planner agrees on — then
// the soonest deadline, then goals with no date at all.
function autoCompare(a, b) {
  const ea = a.type === 'EMERGENCY' ? 0 : 1;
  const eb = b.type === 'EMERGENCY' ? 0 : 1;
  if (ea !== eb) return ea - eb;
  const da = a.date ? Date.parse(`${a.date}T00:00:00`) : Infinity;
  const dbb = b.date ? Date.parse(`${b.date}T00:00:00`) : Infinity;
  if (da !== dbb) return da < dbb ? -1 : 1;
  return a.id - b.id;
}

// Once the user has put goals in their own order, that order wins. A goal
// added afterwards has no place in it yet, so it joins the end of the list.
export function orderGoals(goals) {
  const custom = goals.some((g) => g.priority != null);
  return [...goals].sort((a, b) => {
    if (custom) {
      const pa = a.priority ?? Infinity;
      const pb = b.priority ?? Infinity;
      if (pa !== pb) return pa < pb ? -1 : 1;
    }
    return autoCompare(a, b);
  });
}

/*
 * goals:    [{ id, name, type, date, target, r, priority }] — amounts in base
 * pot:      { investments, cash }                           — in base
 * earmarks: { [goalId]: { value, in_pot } } — for each goal funded by named
 *           items, what those items give it; in_pot is the part that came out
 *           of investments or cash (earmarked property funds its goal without
 *           ever having been in the pot). A goal with an entry here is funded
 *           by its items alone; a goal without one fills from the shared pot.
 * budget:   { amount|null, source, ... } — the monthly surplus for goals
 */
export function buildGoalPlan({ goals = [], pot = {}, earmarks = {}, budget = null, nowMs = Date.now() } = {}) {
  const investments = num(pot.investments);
  const cash = num(pot.cash);
  const total = Math.max(0, investments + cash);
  const earmarkedInPot = Object.values(earmarks).reduce((s, e) => s + Math.max(0, num(e?.in_pot)), 0);
  const shared = Math.max(0, total - earmarkedInPot);

  const monthlyBudget = budget?.amount == null ? null : Math.max(0, num(budget.amount));
  let poolLeft = shared;
  let monthLeft = monthlyBudget;

  const ordered = orderGoals(goals);
  const plans = ordered.map((g, index) => {
    const years = yearsUntil(g.date, nowMs);
    const r = num(g.r);
    const target = Math.max(0, num(g.target));
    // Funded by named items → exactly those, never topped up from the pot.
    const dedicated = earmarks[g.id] != null;
    const earmarked = Math.max(0, num(earmarks[g.id]?.value));

    const need = neededToday(target, r, years);
    const fromPot = dedicated ? 0 : Math.min(poolLeft, Math.max(0, need));
    poolLeft -= fromPot;
    const funded = earmarked + fromPot;

    const required = requiredMonthly(target, funded, r, years);
    let share = null;
    if (monthLeft != null && required != null) {
      share = Math.min(monthLeft, required);
      monthLeft -= share;
    }

    const projected = years > 0 ? projectValue(funded, share ?? 0, r, years) : funded;
    const reachedAt = monthsToReach(funded, share ?? 0, target, r);
    const pastDue = !!g.date && years === 0;

    // The verdict, in the order a person would ask it.
    let status;
    if (funded >= target || (required === 0 && years > 0)) status = 'funded';
    else if (pastDue) status = 'overdue';
    else if (!g.date) status = 'no_date';
    else if (share == null) status = 'unknown'; // no monthly figure to judge by
    // Relative, not "within half a rupee": the same plan viewed in dollars
    // must reach the same verdict, and half a unit is a hundred times bigger there.
    else if (share >= required * (1 - 1e-9)) status = 'on_track';
    else if (funded <= 0 && share <= 0) status = 'waiting';
    else status = 'behind';

    return {
      id: g.id,
      rank: index + 1,
      years_left: round2(years),
      dedicated,
      earmarked: round2(earmarked),
      from_pot: round2(fromPot),
      funded_now: round2(funded),
      needed_today: round2(need),
      funded_pct: target > 0 ? round2(Math.min(100, (funded / target) * 100)) : 0,
      required_monthly: round2(required),
      monthly_share: round2(share),
      // What this month's shortfall is for this goal — how much more a month
      // it would take to stay on schedule.
      extra_needed: share == null || required == null ? null : round2(Math.max(0, required - share)),
      projected_value: round2(projected),
      projected_pct: target > 0 ? round2((projected / target) * 100) : 0,
      reached_on: reachedAt == null ? null : addMonths(nowMs, reachedAt),
      status,
    };
  });

  const needed = plans.reduce((s, p) => s + (p.required_monthly ?? 0), 0);
  const assigned = plans.reduce((s, p) => s + (p.monthly_share ?? 0), 0);

  return {
    order: plans.map((p) => p.id),
    goals: plans,
    custom_order: goals.some((g) => g.priority != null),
    pot: {
      investments: round2(investments),
      cash: round2(cash),
      total: round2(total),
      earmarked: round2(earmarkedInPot),
      shared: round2(shared),
      assigned: round2(shared - poolLeft),
      unassigned: round2(poolLeft),
    },
    monthly: {
      ...(budget || { source: 'none' }),
      amount: round2(monthlyBudget),
      needed: round2(needed),
      assigned: round2(assigned),
      left_over: monthlyBudget == null ? null : round2(monthLeft),
      shortfall: monthlyBudget == null ? null : round2(Math.max(0, needed - monthlyBudget)),
    },
  };
}
