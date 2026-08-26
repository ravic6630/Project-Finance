// Dividend & passive income tracker.
//
// CONTRACT — buildDividends(user, { summary }) resolves to:
// {
//   forward_income: number,       // next 12 months, estimated from trailing payouts
//   monthly_equivalent: number,
//   yield_on_cost_pct: number|null,
//   current_yield_pct: number|null,
//   received_12m: number,         // ACTUAL, from transactions categorised as dividend/interest
//   by_holding: [{ name, symbol, shares, per_share_12m, income, yield_pct, currency }],
//   recent: [{ name, symbol, date, per_share, amount }],   // last payouts seen
//   coverage: { holdings: n, covered: n, unsupported: n },  // honesty about gaps
//   note: string|null             // e.g. mutual funds aren't covered by this feed
// }
import { db } from '../../db.js';
import { getFxRate } from '../prices.js';
import { todayIST } from '../recurring.js';

// Dividends change a handful of times a year, so this cache is measured in
// hours. A 15-minute window (the price TTL) would re-download a year of payout
// history for every holding all day long to learn nothing new.
const DIVIDEND_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 9000;
// ~13 months, so a full trailing year of payouts is always inside the window
// even when a payer's anniversary date drifts by a few weeks.
const LOOKBACK_DAYS = 400;
const MAX_RECENT = 8;

/* ------------------------------- utilities -------------------------------- */
const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
const r4 = (n) => (Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The same IST calendar day, one year earlier. Compared lexicographically like
// every other date in the app — never parsed into a Date, so 29 Feb can't blow
// up here (it simply falls outside a non-leap window, which is correct).
function oneYearBefore(iso) {
  const [y, m, d] = iso.split('-');
  return `${Number(y) - 1}-${m}-${d}`;
}

async function fetchJson(url, headers = {}, timeout = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ upstream feed ----------------------------- */
// Yahoo's chart endpoint returns real declared dividend history when asked for
// the `div` event stream. Per-share amounts, in the instrument's own currency.
async function fetchDividendHistory(symbol) {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - LOOKBACK_DAYS * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?period1=${period1}&period2=${period2}&interval=1d&events=div`;
  const json = await fetchJson(url, { 'User-Agent': 'Mozilla/5.0' });
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No chart result for dividends');

  // LSE (GBp/GBX) and the JSE (ZAc) quote — and pay — in the minor unit. Same
  // normalisation as fetchStock in prices.js; without it every UK payout is
  // 100x too large, which would be the single most expensive bug on this page.
  let currency = result?.meta?.currency || null;
  let divisor = 1;
  if (currency === 'GBp' || currency === 'GBX') {
    divisor = 100;
    currency = 'GBP';
  } else if (currency === 'ZAc') {
    divisor = 100;
    currency = 'ZAR';
  }

  const raw = result?.events?.dividends || {};
  const payouts = Object.values(raw)
    .map((d) => ({ ts: Number(d?.date), amount: Number(d?.amount) / divisor }))
    .filter((d) => Number.isFinite(d.ts) && Number.isFinite(d.amount) && d.amount > 0)
    .map((d) => ({ date: new Date(d.ts * 1000).toISOString().slice(0, 10), amount: d.amount }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // An empty list is a real answer — this instrument pays nothing.
  return { symbol, currency, payouts, stale: false };
}

/* --------------------------------- cache ---------------------------------- */
const divCache = new Map(); // SYMBOL -> { at, data }
const divInFlight = new Map(); // SYMBOL -> Promise, so concurrent callers share one fetch

function pruneCache() {
  if (divCache.size <= 400) return;
  const cutoff = Date.now() - DIVIDEND_TTL_MS;
  for (const [k, v] of divCache) if (v.at < cutoff) divCache.delete(k);
}

// Never throws. Returns null when we genuinely could not check — which the
// caller reports as a gap in coverage rather than as "pays nothing".
async function getDividendHistory(symbol) {
  const key = String(symbol || '').trim().toUpperCase();
  if (!key) return null;

  const cached = divCache.get(key);
  if (cached && Date.now() - cached.at < DIVIDEND_TTL_MS) return cached.data;

  try {
    let inFlight = divInFlight.get(key);
    if (!inFlight) {
      inFlight = fetchDividendHistory(key)
        .then((data) => {
          divCache.set(key, { at: Date.now(), data });
          pruneCache();
          return data;
        })
        .finally(() => divInFlight.delete(key));
      divInFlight.set(key, inFlight);
    }
    return await inFlight;
  } catch {
    // A feed hiccup must never be rendered as an income of zero. Serve the last
    // good history flagged stale, or admit we don't know.
    if (cached) return { ...cached.data, stale: true };
    return null;
  }
}

/* ------------------------------- received cash ---------------------------- */
// The real money that landed, as opposed to the projection. Category match is
// deliberately loose ("Dividends", "Bank interest", "FD Interest") and
// case-insensitive; NULL categories drop out of the LIKE, which is correct.
const listIncome = db.prepare(`
  SELECT amount, currency, category, date
    FROM transactions
   WHERE user_id = ?
     AND type = 'INCOME'
     AND date > ?
     AND date <= ?
     AND (lower(category) LIKE '%dividend%' OR lower(category) LIKE '%interest%')
   ORDER BY date DESC
`);

/* --------------------------------- builder -------------------------------- */
export async function buildDividends(user, { summary } = {}) {
  const base = user?.base_currency || summary?.base_currency || 'INR';
  // Only open long positions can pay you. A sold-out row (quantity 0) still
  // carries payout history, and a negative quantity would SUBTRACT invisible
  // income from the headline — neither belongs in "what your portfolio pays".
  const items = (Array.isArray(summary?.items) ? summary.items : []).filter(
    (h) => (Number(h.quantity) || 0) > 0
  );
  const to = todayIST();
  const from = oneYearBefore(to); // trailing 12 months: (from, to]

  const empty = {
    forward_income: 0,
    monthly_equivalent: 0,
    yield_on_cost_pct: null,
    current_yield_pct: null,
    received_12m: 0,
    received_count: 0,
    by_holding: [],
    recent: [],
    coverage: { holdings: 0, covered: 0, unsupported: 0, funds: 0, failed: 0, payers: 0 },
    covered_value: 0,
    covered_cost: 0,
    window: { from, to },
    note: null,
  };

  // Split the portfolio into what this feed can actually answer for.
  const supported = [];
  let unsupportedFunds = 0;
  let unsupportedNoSymbol = 0;
  for (const h of items) {
    // Indian mutual funds have no dividend feed here, and growth plans don't
    // distribute at all. Counting them as "zero income" would read as a finding.
    if (h.kind === 'IN_MF') unsupportedFunds += 1;
    else if (!h.symbol) unsupportedNoSymbol += 1;
    else supported.push(h);
  }

  const symbols = [...new Set(supported.map((h) => String(h.symbol).toUpperCase()))];

  // Distinct symbols only, all in parallel, all sharing the module cache.
  const [histEntries, incomeRows] = await Promise.all([
    Promise.all(symbols.map(async (s) => [s, await getDividendHistory(s)])),
    listIncome.all(user?.id, from, to).catch(() => []),
  ]);
  const histories = new Map(histEntries);

  // ---- FX: every figure below leaves this function in the base currency. ----
  const rates = { ...(summary?.rates || {}) };
  rates[base] = 1;
  const needed = new Set();
  for (const h of supported) {
    const hist = histories.get(String(h.symbol).toUpperCase());
    const cur = hist?.currency || h.price_currency || h.currency;
    if (cur) needed.add(cur);
  }
  for (const t of incomeRows) if (t.currency) needed.add(t.currency);
  await Promise.all(
    [...needed]
      .filter((c) => !Number.isFinite(rates[c]))
      .map(async (c) => {
        rates[c] = await getFxRate(c, base);
      })
  );
  const rateFor = (cur) => (Number.isFinite(rates[cur]) ? rates[cur] : 1);

  // ---- Per holding ---------------------------------------------------------
  const byHolding = [];
  const recent = [];
  let forward = 0;
  let coveredValue = 0;
  let coveredCost = 0;
  let covered = 0;
  let failed = 0;
  let payers = 0;
  let staleCount = 0;

  for (const h of supported) {
    const hist = histories.get(String(h.symbol).toUpperCase());
    if (!hist) {
      failed += 1;
      continue;
    }
    if (hist.stale) staleCount += 1;

    const currency = hist.currency || h.price_currency || h.currency || base;
    const rate = rateFor(currency);
    const qty = Number(h.quantity) || 0;
    // (from, to] — an already-declared FUTURE payout is excluded, because this
    // figure is explicitly what the last twelve months actually paid.
    const window = hist.payouts.filter((p) => p.date > from && p.date <= to);
    const perShare = window.reduce((s, p) => s + p.amount, 0);
    const income = perShare * qty * rate;

    const value = Number(h.market_value_base) || 0;
    const cost = Number(h.cost_value_base) || 0;

    covered += 1;
    coveredValue += value;
    coveredCost += cost;
    forward += Number.isFinite(income) ? income : 0;
    if (income > 0) payers += 1;

    byHolding.push({
      name: h.name || h.symbol,
      symbol: h.symbol,
      shares: qty,
      per_share_12m: r4(perShare),
      income: r2(income),
      // A holding priced at zero (or unpriced) has no meaningful yield — say so
      // with null rather than dividing by it.
      yield_pct: value > 0 && Number.isFinite(income) ? r2((income / value) * 100) : null,
      currency,
      value: r2(value),
      payouts: window.length,
      stale: !!hist.stale,
    });

    for (const p of window) {
      recent.push({
        name: h.name || h.symbol,
        symbol: h.symbol,
        date: p.date,
        per_share: r4(p.amount),
        currency,
        // The per-share figure is history; this amount applies TODAY's holding
        // to it, so it is what that payout is worth at your current size — not
        // necessarily what hit your account then. The panel says exactly that.
        amount: r2(p.amount * qty * rate),
      });
    }
  }

  byHolding.sort((a, b) => b.income - a.income || (a.name > b.name ? 1 : -1));
  recent.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.amount - a.amount));

  // ---- Cash actually received ---------------------------------------------
  let received = 0;
  for (const t of incomeRows) {
    const amt = Number(t.amount);
    if (!Number.isFinite(amt)) continue;
    received += amt * rateFor(t.currency || base);
  }

  if (!items.length) return { ...empty, received_12m: r2(received), received_count: incomeRows.length };

  // ---- Honesty about the gaps ---------------------------------------------
  const notes = [];
  if (unsupportedFunds) {
    notes.push(
      `${plural(unsupportedFunds, 'Indian mutual fund')} ${unsupportedFunds === 1 ? 'is' : 'are'} left out — there's no payout feed for them, and growth-plan funds don't distribute income at all.`
    );
  }
  if (unsupportedNoSymbol) {
    notes.push(`${plural(unsupportedNoSymbol, 'holding')} has no ticker to look up.`);
  }
  if (failed) {
    notes.push(
      `${plural(failed, 'holding')} couldn't be checked just now, so ${failed === 1 ? 'its' : 'their'} income isn't in this total.`
    );
  }
  if (staleCount) {
    notes.push(`${plural(staleCount, 'holding')} used its last cached payout history.`);
  }

  return {
    // An ESTIMATE: it assumes the next twelve months repeat the last twelve.
    forward_income: r2(forward),
    monthly_equivalent: r2(forward / 12),
    yield_on_cost_pct: coveredCost > 0 ? r2((forward / coveredCost) * 100) : null,
    current_yield_pct: coveredValue > 0 ? r2((forward / coveredValue) * 100) : null,
    received_12m: r2(received),
    received_count: incomeRows.length,
    by_holding: byHolding,
    recent: recent.slice(0, MAX_RECENT),
    coverage: {
      holdings: items.length,
      covered,
      unsupported: unsupportedFunds + unsupportedNoSymbol,
      funds: unsupportedFunds,
      failed,
      payers,
    },
    // The denominators, so the panel can show what the yields are a share of.
    covered_value: r2(coveredValue),
    covered_cost: r2(coveredCost),
    window: { from, to },
    note: notes.length ? notes.join(' ') : null,
  };
}
