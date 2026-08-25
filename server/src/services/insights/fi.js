import { todayIST } from '../recurring.js';

// Financial Independence tracker.
//
// CONTRACT — buildFI(user, { summary, prefs }) resolves to:
// {
//   ready: boolean,               // false when we lack the data to project
//   reason: string|null,          // why not ready, in plain language
//   annual_spend: number,         // in user's base currency
//   spend_source: 'measured'|'override',
//   months_measured: number,      // how many months of real spending we used
//   fi_number: number,            // annual_spend / (withdrawal_rate/100)
//   liquid_net_worth: number,     // investments + cash (property can't fund retirement)
//   pct: number,                  // 0..100+
//   monthly_surplus: number,      // measured income - expense, per month
//   years_to_fi: number|null,     // null when surplus <= 0 and not already FI
//   fi_date: string|null,         // ISO date
//   coast_fi_number: number|null, // amount that compounds to fi_number by fi horizon
//   coast_reached: boolean,
//   assumptions: { withdrawal_rate, expected_return, inflation, real_return }
// }
//
// Anything unknown is null rather than 0 — "we haven't measured your surplus"
// and "you save nothing" are very different statements to make about someone's
// money, and the panel renders them differently. On top of the contract above,
// for the panel's own use:
//   reached: boolean                  // liquid already covers the FI number
//   shortfall: number                 // fi_number - liquid, floored at 0
//   years_reason: string|null         // why no date, when years_to_fi is null
//   coast_horizon_years: number       // the horizon the coast figure assumes
//   coast_horizon_assumed: boolean    // true when no date could be projected,
//                                     // so the horizon is ours, not the user's
//   breakdown: { investments, cash, excluded_assets }
//   measured: { annual_spend, monthly_spend, monthly_income, months, from, to,
//               includes_current_month }   // always present, even under an
//                                          // override, so the UI can show the
//                                          // real figure beside the set one
//   as_of: 'YYYY-MM-DD' (IST)
//
// Everything past `liquid_net_worth` is a PROJECTION off user-editable
// assumptions, never a fact — the panel labels it as such. Nothing here is
// invented: if the transactions can't support a figure we return ready:false
// and say why, rather than filling the gap with a "typical" number.

/* --------------------------------- guards --------------------------------- */

// A projection past a century is arithmetic, not a plan. Beyond this we say so
// rather than printing a date in the year 2400 with a straight face.
const MAX_PROJECTION_YEARS = 100;

// When there is no surplus we can't derive a date, but Coast-FI is still a
// useful reading ("leave it alone for N years and it gets there by itself").
// The horizon is then an explicit, labelled assumption — flagged to the UI via
// coast_horizon_assumed so it can never be mistaken for the user's own number.
const COAST_FALLBACK_YEARS = 15;

const numOr = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const fin = (v) => (Number.isFinite(v) ? v : null);
const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

// Calendar-agnostic: add a fractional number of years to an IST day. The mean
// Gregorian year (365.2425 days) keeps a 30-year projection from drifting the
// best part of a week off, which a flat 365 would.
function isoPlusYears(iso, years) {
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + years * 365.2425 * 86400000;
  if (!Number.isFinite(ms)) return null;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

/* ----------------------------- spend measurement -------------------------- */
// Sampada can do something most FI calculators can't: it knows what this person
// ACTUALLY spends, so it never has to ask them to guess.
//
// The measurement window is the set of months that carry recorded expenses. A
// month with income but no expenses is deliberately excluded — it almost always
// means "they log salary, not spending", and averaging a zero into the cost of
// living would understate the FI number, which is the one error that matters
// here (it would tell someone they're closer than they are).
//
// The current month is still in progress, so it pulls the average down a little.
// It is kept anyway — discarding the most recent month would ignore a raise, a
// move or a big one-off precisely when it matters most — and flagged instead, so
// the panel can say the latest month is only part-counted.
function measureCashflow(summary) {
  const months = Array.isArray(summary?.cashflow?.months) ? summary.cashflow.months : [];
  const thisMonthKey = todayIST().slice(0, 7);

  const window = months.filter((m) => numOr(m?.expense) > 0);
  const includesCurrent = window.some((m) => m.key === thisMonthKey);

  const count = window.length;
  if (!count) {
    return {
      months: 0,
      annual_spend: null,
      monthly_spend: null,
      monthly_income: null,
      monthly_surplus: null,
      from: null,
      to: null,
      includes_current_month: false,
    };
  }

  const expense = window.reduce((s, m) => s + numOr(m.expense), 0);
  const income = window.reduce((s, m) => s + numOr(m.income), 0);

  return {
    months: count,
    // Annualise the mean month: total / months * 12.
    annual_spend: (expense / count) * 12,
    monthly_spend: expense / count,
    monthly_income: income / count,
    monthly_surplus: (income - expense) / count,
    from: window[0].key,
    to: window[window.length - 1].key,
    includes_current_month: includesCurrent,
  };
}

/* ------------------------------ the projection ---------------------------- */
// Future value of a pot P growing at monthly rate r with a monthly contribution
// c, solved for the number of months n that reaches target F:
//
//   F = P(1+r)^n + c·((1+r)^n − 1)/r
//   ⇒ (1+r)^n = (F·r + c) / (P·r + c)
//   ⇒ n = ln((F·r + c) / (P·r + c)) / ln(1+r)
//
// At r ≈ 0 the compounding term vanishes and it degenerates to n = (F − P)/c.
// Returns years, or null when the assumptions never get there.
function monthsToTarget(P, F, c, r) {
  if (!(F > P)) return 0; // already there
  if (Math.abs(r) < 1e-9) {
    if (!(c > 0)) return null;
    return (F - P) / c;
  }
  const numerator = F * r + c;
  const denominator = P * r + c;
  // A non-positive denominator means the pot is losing ground faster than the
  // contribution replaces it (only possible with a negative real return); a
  // non-positive numerator means the target sits below the level the pot decays
  // toward. Either way the curve never crosses F.
  if (!(numerator > 0) || !(denominator > 0)) return null;
  const ratio = numerator / denominator;
  if (!(ratio > 0)) return null;
  const n = Math.log(ratio) / Math.log(1 + r);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/* ---------------------------------- build --------------------------------- */

export async function buildFI(user, { summary, prefs } = {}) {
  const withdrawalRate = numOr(prefs?.withdrawal_rate, 4);
  const expectedReturn = numOr(prefs?.expected_return, 10);
  const inflation = numOr(prefs?.inflation, 6);

  // Project in REAL terms: strip inflation out of the return so the target
  // (today's spending × 25) and the pot are measured in the same money. A
  // nominal projection compared against a today's-rupees target would flatter
  // the date by years.
  const realReturn = ((1 + expectedReturn / 100) / (1 + inflation / 100) - 1) * 100;

  const assumptions = {
    withdrawal_rate: withdrawalRate,
    expected_return: expectedReturn,
    inflation,
    real_return: round2(realReturn),
  };

  // Liquid only. A house you live in cannot fund your retirement — selling it
  // means buying or renting another one — so assets are excluded from the pot
  // and reported separately so the UI can explain the gap against the dashboard
  // net worth the moment the user notices it.
  const investments = numOr(summary?.investments?.value);
  const cash = numOr(summary?.cash?.total);
  const excludedAssets = numOr(summary?.assets?.total);
  const liquid = investments + cash;

  const measured = measureCashflow(summary);

  const overrideSpend =
    prefs?.annual_spend == null || !Number.isFinite(Number(prefs.annual_spend))
      ? null
      : Number(prefs.annual_spend);
  const spendSource = overrideSpend != null ? 'override' : 'measured';
  const annualSpend = overrideSpend != null ? overrideSpend : measured.annual_spend;

  const base = {
    ready: false,
    reason: null,
    annual_spend: round2(annualSpend),
    spend_source: spendSource,
    months_measured: measured.months,
    fi_number: null,
    liquid_net_worth: round2(liquid),
    pct: null,
    monthly_surplus: round2(measured.monthly_surplus),
    years_to_fi: null,
    years_reason: null,
    fi_date: null,
    coast_fi_number: null,
    coast_reached: false,
    coast_horizon_years: null,
    coast_horizon_assumed: false,
    assumptions,
    // Extras the panel uses to stay honest about where each figure came from.
    breakdown: { investments: round2(investments), cash: round2(cash), excluded_assets: round2(excludedAssets) },
    measured: {
      annual_spend: round2(measured.annual_spend),
      monthly_spend: round2(measured.monthly_spend),
      monthly_income: round2(measured.monthly_income),
      months: measured.months,
      from: measured.from,
      to: measured.to,
      includes_current_month: measured.includes_current_month,
    },
    shortfall: null,
    as_of: todayIST(),
  };

  /* -- can we size the target at all? ------------------------------------- */
  if (spendSource === 'measured') {
    if (measured.months === 0) {
      return {
        ...base,
        reason:
          "I haven't seen any spending yet, and financial independence is sized entirely by what a year of your life costs. Record a couple of months of expenses — or set your annual spending directly below — and this fills in.",
      };
    }
    if (measured.months < 2) {
      return {
        ...base,
        reason:
          'Only one month of spending has been recorded. A projection off a single month is a guess, not a plan — add another month of transactions, or set your annual spending directly below.',
      };
    }
  }

  if (!(annualSpend > 0)) {
    return {
      ...base,
      reason:
        spendSource === 'override'
          ? 'Your annual spending is set to zero, so there is no target to reach. Set what a year of your life actually costs below.'
          : `The expenses recorded across ${measured.months} months total zero, so there's nothing to size financial independence against yet.`,
    };
  }

  if (!(withdrawalRate > 0)) {
    return { ...base, reason: 'A withdrawal rate above zero is needed to size the target.' };
  }

  // The familiar 25× at the default 4%: spending ÷ withdrawal rate.
  const fiNumber = annualSpend / (withdrawalRate / 100);
  if (!Number.isFinite(fiNumber) || fiNumber <= 0) {
    return { ...base, reason: 'These assumptions do not produce a usable target.' };
  }

  const pct = (liquid / fiNumber) * 100;
  const reached = liquid >= fiNumber;

  /* -- the date ----------------------------------------------------------- */
  const monthlySurplus = measured.monthly_surplus;
  // Monthly real rate — the twelfth root, not real/12, so twelve months of
  // compounding land exactly on the annual figure.
  const monthlyRate = (1 + realReturn / 100) ** (1 / 12) - 1;

  let yearsToFi = null;
  let yearsReason = null;

  if (reached) {
    yearsToFi = 0;
  } else if (measured.months < 2 || monthlySurplus == null) {
    yearsReason =
      'A date needs at least two months of income and spending to measure what you add each month. Record a little more and this appears.';
  } else if (!(monthlySurplus > 0)) {
    yearsReason =
      'Across the months measured you spent at least as much as you earned, so there is nothing being added to the pot — no honest date can be projected from that.';
  } else {
    const n = monthsToTarget(liquid, fiNumber, monthlySurplus, monthlyRate);
    if (n == null) {
      yearsReason =
        'At these assumptions inflation outruns the returns, so the pot never reaches the target. Try a higher expected return or a lower inflation figure.';
    } else if (n / 12 > MAX_PROJECTION_YEARS) {
      yearsReason = `At the current surplus this is more than ${MAX_PROJECTION_YEARS} years away — too far out to be worth putting a date on.`;
    } else {
      yearsToFi = n / 12;
    }
  }

  const fiDate = yearsToFi == null ? null : isoPlusYears(todayIST(), yearsToFi);

  /* -- Coast-FI ------------------------------------------------------------ */
  // The amount that, left completely alone, compounds into the FI number by the
  // same horizon: coast = fi_number / (1 + real_return/100)^years. Cross it and
  // you could stop adding money and still arrive on time.
  const horizonAssumed = yearsToFi == null;
  const horizon = horizonAssumed ? COAST_FALLBACK_YEARS : yearsToFi;
  const growth = (1 + realReturn / 100) ** horizon;
  const coast = Number.isFinite(growth) && growth > 0 ? fiNumber / growth : null;

  return {
    ...base,
    ready: true,
    reason: null,
    fi_number: round2(fiNumber),
    pct: round2(pct),
    reached,
    shortfall: round2(Math.max(0, fiNumber - liquid)),
    years_to_fi: yearsToFi == null ? null : round2(yearsToFi),
    years_reason: yearsReason,
    fi_date: fiDate,
    coast_fi_number: round2(fin(coast)),
    coast_reached: coast != null && liquid >= coast,
    coast_horizon_years: round2(horizon),
    coast_horizon_assumed: horizonAssumed,
  };
}
