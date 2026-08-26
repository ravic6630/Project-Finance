import { KIND_LABELS } from '../../markets.js';

// Target allocation & rebalancing.
//
// CONTRACT — buildAllocation(user, { summary, targets }) resolves to:
// {
//   has_targets: boolean,
//   total: number,                       // total value the mix is measured against
//   band_pct: number,                    // drift tolerance before action is suggested
//   in_band: boolean,
//   rows: [{
//     bucket, label, target_pct, current_pct, current_value,
//     drift_pct,                         // current - target
//     action: 'buy'|'sell'|'hold',
//     action_amount                      // base currency, 0 when hold
//   }],
//   suggested: [{ from, to, amount }]     // concrete moves, largest first
//   excluded: [{ bucket, label, value }]  // held, but outside the target mix
// }
// Additive (the contract above is unchanged, these only carry more truth):
//   has_value                            — total > 0, i.e. there is a portfolio
//                                          to measure the mix against at all
//   suggested[].from_bucket / .to_bucket — the bucket keys behind the labels
// Every figure is already in the user's base currency: summary.allocation is
// built from *_base values, so nothing here needs converting.

// Drift tolerance. Rebalancing on every basis point of drift is churn: it costs
// spread, brokerage and (in India) STCG, so a mix is only "off" once it has
// moved a meaningful distance from the target. 5pp is the conventional band.
const BAND_PCT = 5;

// The most moves worth listing. Past four the advice stops being a checklist and
// starts being a puzzle — and the tail entries are always the trivial ones.
const MAX_MOVES = 4;

// Rounding floor for pairing, in base currency. Below this a "move" is noise.
const EPSILON = 0.5;

// Buckets the summary can emit: every holding kind, plus the two non-holding
// pools. Only used to label a bucket the user has a TARGET for but no money in
// — those never appear in summary.allocation, which filters to value > 0.
const BUCKET_LABELS = { ...KIND_LABELS, CASH: 'Cash & Bank', ASSETS: 'Assets' };

const fin = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

export async function buildAllocation(user, { summary, targets } = {}) {
  /* ------------------------------- current mix ------------------------------ */
  const alloc = Array.isArray(summary?.allocation) ? summary.allocation : [];
  const current = new Map();
  for (const a of alloc) {
    const bucket = String(a?.key || '').trim().toUpperCase();
    if (!bucket) continue;
    const value = fin(a.value);
    const row = current.get(bucket);
    if (row) row.value += value;
    else current.set(bucket, { bucket, label: a.label || BUCKET_LABELS[bucket] || bucket, value });
  }
  /* --------------------------------- targets -------------------------------- */
  const targetPct = new Map();
  for (const t of Array.isArray(targets) ? targets : []) {
    const bucket = String(t?.bucket || '').trim().toUpperCase();
    const pct = fin(t?.target_pct);
    if (!bucket || pct <= 0) continue;
    targetPct.set(bucket, (targetPct.get(bucket) || 0) + pct);
  }
  const has_targets = targetPct.size > 0;

  /* -------------------------------- the scope ------------------------------- */
  // A target mix applies to the money you actually manage against it. Someone
  // who sets "60% equity / 40% cash" while also owning a house does NOT mean
  // "60% of my house-inclusive wealth" — and counting the house in the
  // denominator makes every targeted bucket look starved, so the tool tells
  // them to buy everything and the buys never net against the sells.
  // So: the mix is measured over targeted buckets only. Anything held outside
  // the mix is reported separately, by name, so it is never silently dropped.
  const buckets = has_targets
    ? new Set(targetPct.keys())
    : new Set(current.keys());
  const excluded = has_targets
    ? [...current.values()]
        .filter((r) => !buckets.has(r.bucket) && r.value > 0)
        .map((r) => ({ bucket: r.bucket, label: r.label, value: r.value }))
        .sort((a, b) => b.value - a.value)
    : [];

  // Percentages are shares OF THE MIX, not of net worth — net worth can include
  // things the mix deliberately leaves out.
  const total = [...buckets].reduce((s, b) => s + (current.get(b)?.value || 0), 0);

  /* ---------------------------------- rows ---------------------------------- */
  const rows = [];
  for (const bucket of buckets) {
    const cur = current.get(bucket);
    const current_value = cur ? cur.value : 0;
    // total is 0 on a brand-new account (and can only be 0 when every bucket is
    // 0, since summary.allocation drops non-positive values) — so 0%, not NaN.
    const current_pct = total > 0 ? (current_value / total) * 100 : 0;
    const target = has_targets ? targetPct.get(bucket) || 0 : 0;

    // With no target set there is no drift to report — a target of "0%" would be
    // an assumption we invented, and it would paint every holding as an overweight.
    const drift_pct = has_targets ? current_pct - target : 0;
    const raw = has_targets ? (target / 100) * total - current_value : 0;
    // A percentage can be far off while the money involved is nil — an empty
    // portfolio is "100% under target" in every bucket. There is nothing to buy
    // or sell there, so it is a hold, not an instruction we can't cost.
    const off = has_targets && Math.abs(drift_pct) > BAND_PCT && Math.abs(raw) > EPSILON;

    rows.push({
      bucket,
      label: cur?.label || BUCKET_LABELS[bucket] || bucket,
      target_pct: target,
      current_pct,
      current_value,
      drift_pct,
      action: off ? (raw > 0 ? 'buy' : 'sell') : 'hold',
      // Contract: no action, no amount. The full figure still drives the moves below.
      action_amount: off ? raw : 0,
    });
  }

  // Biggest intentions first, then biggest holdings — so the mix reads top-down
  // the way the user built it, not in database order.
  rows.sort((a, b) => b.target_pct - a.target_pct || b.current_value - a.current_value || a.label.localeCompare(b.label));

  // "Every |drift| <= band", with the same negligible-amount guard the rows use.
  // Without it a portfolio worth a few rupees — or none at all — would report
  // itself out of band while every row correctly says there is nothing to do.
  const in_band = rows.every((r) => r.action === 'hold');

  /* ------------------------------ suggested moves --------------------------- */
  // Pair the fattest overweight with the deepest underweight and repeat. Greedy
  // largest-first is what a human would do by hand: it kills the most drift per
  // instruction, so the short list that survives the cap is the list that matters.
  const over = rows.filter((r) => r.action === 'sell').map((r) => ({ bucket: r.bucket, label: r.label, left: -r.action_amount }));
  const under = rows.filter((r) => r.action === 'buy').map((r) => ({ bucket: r.bucket, label: r.label, left: r.action_amount }));
  // Picking the max fresh each round (rather than walking two pre-sorted lists)
  // keeps the ordering true after a pairing leaves a residue behind.
  const biggest = (list) => list.reduce((best, r) => (best && best.left >= r.left ? best : r), null);

  const suggested = [];
  while (suggested.length < MAX_MOVES) {
    const src = biggest(over);
    const dst = biggest(under);
    if (!src || !dst) break;
    const amount = Math.min(src.left, dst.left);
    if (!(amount > EPSILON)) break; // the largest pair left is noise, so the rest are too
    suggested.push({ from: src.label, to: dst.label, from_bucket: src.bucket, to_bucket: dst.bucket, amount });
    src.left -= amount;
    dst.left -= amount;
    // One side is always exhausted by the min above, so the loop always shrinks.
    if (src.left <= EPSILON) over.splice(over.indexOf(src), 1);
    if (dst.left <= EPSILON) under.splice(under.indexOf(dst), 1);
  }

  // has_value: is there anything to measure the mix against? A user who set
  // targets before adding a single holding must be told that plainly, not shown
  // a table of "100% under" rows that reads like an emergency.
  return { has_targets, has_value: total > 0, total, band_pct: BAND_PCT, in_band, rows, suggested, excluded };
}
