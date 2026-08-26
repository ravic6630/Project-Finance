// Portfolio risk & concentration.
//
// CONTRACT — buildRisk(user, { summary }) resolves to:
// {
//   score: number,                // 0..10, higher = more concentrated/fragile
//   score_label: string,          // 'Well spread' … 'Highly concentrated'
//   top_holdings: [{ name, value, pct_of_investments, pct_of_net_worth }],
//   top3_pct: number,
//   hhi: number,                  // Herfindahl index, 0..1
//   by_currency: [{ currency, value, pct }],
//   by_kind: [{ kind, label, value, pct }],
//   flags: [{ level: 'high'|'medium'|'low', title, detail }]
// }
//
// Also returned, additive and read only by RiskPanel (the contract above is
// unchanged): investments_total, holdings_count (rows the user entered),
// positions_count (distinct positions after merging duplicate lots) and
// score_note — one plain sentence the panel prints under the score.
//
// SCOPE: everything here is measured over INVESTMENTS only. Cash accounts and
// other assets carry a currency in the database, but the summary hands us those
// pre-converted and grouped by type with the currency dropped — so folding them
// into the currency split would mean guessing. The panel says "investments
// only" out loud instead.

// Which market a holding kind belongs to. Only used for the "one market" flag's
// wording; the split shown in the UI is summary.investments.by_kind verbatim.
const REGION = {
  IN_STOCK: 'India',
  IN_MF: 'India',
  US_STOCK: 'the US',
  UK_STOCK: 'the UK',
  IE_STOCK: 'Ireland',
  AU_STOCK: 'Australia',
  NZ_STOCK: 'New Zealand',
  CA_STOCK: 'Canada',
};

const round = (n, dp = 2) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
// Linear map of `v` from [lo, hi] onto 0..1, clamped at both ends.
const ramp = (v, lo, hi) => clamp01((v - lo) / (hi - lo));

function labelFor(score) {
  if (score < 2) return 'Well spread';
  if (score < 4) return 'Reasonably spread';
  if (score < 6) return 'Somewhat concentrated';
  if (score < 8) return 'Concentrated';
  return 'Highly concentrated';
}

const LEVEL_RANK = { high: 0, medium: 1, low: 2 };

export async function buildRisk(user, { summary } = {}) {
  const base = summary?.base_currency || user?.base_currency || 'INR';
  const items = Array.isArray(summary?.items) ? summary.items : [];
  const netWorth = Number.isFinite(summary?.net_worth) ? summary.net_worth : 0;

  const empty = {
    score: 0,
    top_holdings: [],
    top3_pct: 0,
    hhi: 0,
    by_currency: [],
    by_kind: [],
    flags: [],
    investments_total: 0,
    holdings_count: items.length,
    positions_count: 0,
  };

  if (!items.length) {
    return {
      ...empty,
      score_label: 'Nothing to assess yet',
      score_note: 'Add a holding or two and this panel will show where your risk sits.',
    };
  }

  // The same company held in two accounts is ONE position, not two — counting
  // the lots separately would understate exactly the concentration we're here
  // to find. Identity is market + ticker (or scheme code, or failing both, the
  // name), which is how the rest of the app identifies a holding.
  const positions = new Map();
  for (const h of items) {
    const value = Number(h?.market_value_base);
    if (!Number.isFinite(value) || value <= 0) continue; // unpriced/zero rows can't carry weight
    const ident = String(h.symbol || h.scheme_code || h.name || '').trim().toUpperCase();
    const key = `${h.kind || '?'}:${ident || `row-${positions.size}`}`;
    const p = positions.get(key);
    if (p) {
      p.value += value;
      p.lots += 1;
    } else {
      positions.set(key, {
        name: String(h.name || h.symbol || h.scheme_code || 'Unnamed holding').trim(),
        kind: h.kind || null,
        currency: h.currency || base,
        value,
        lots: 1,
      });
    }
  }

  const list = [...positions.values()].sort((a, b) => b.value - a.value);
  const total = list.reduce((s, p) => s + p.value, 0);

  if (!list.length || total <= 0) {
    return {
      ...empty,
      score_label: 'Nothing to assess yet',
      score_note:
        'Your holdings have no value we can price right now, so there is nothing to measure concentration against.',
    };
  }

  /* ------------------------------- the maths ------------------------------ */
  const weights = list.map((p) => p.value / total); // fractions of investments, sum = 1
  // Herfindahl index: sum of squared weights. One position = 1; n equal
  // positions = 1/n. It is the standard concentration measure precisely
  // because it punishes a single dominant holding much harder than a long tail.
  const hhi = weights.reduce((s, w) => s + w * w, 0);
  const largest = weights[0];
  const top3 = weights.slice(0, 3).reduce((s, w) => s + w, 0);

  const topHoldings = list.slice(0, 6).map((p) => ({
    name: p.name,
    value: p.value,
    pct_of_investments: round((p.value / total) * 100),
    // Net worth includes cash and other assets. If it isn't positive there is
    // no meaningful denominator — null, never a fabricated 0%.
    pct_of_net_worth: netWorth > 0 ? round((p.value / netWorth) * 100) : null,
    lots: p.lots,
  }));

  const byCurrency = [...
    list.reduce((m, p) => {
      const cur = p.currency || base;
      m.set(cur, (m.get(cur) || 0) + p.value);
      return m;
    }, new Map())]
    .map(([currency, value]) => ({ currency, value, pct: round((value / total) * 100) }))
    .sort((a, b) => b.value - a.value);

  // The market split comes straight from the summary's own grouping. It is
  // divided by ITS own total rather than by `total` above: the two differ
  // whenever a holding was dropped here for having no value, and a split whose
  // slices don't add to 100% is a split you can't trust.
  const kinds = (summary?.investments?.by_kind || []).filter(
    (k) => Number.isFinite(k?.value) && k.value > 0
  );
  const kindTotal = kinds.reduce((s, k) => s + k.value, 0);
  const byKind = kinds
    .map((k) => ({
      kind: k.key || 'OTHER',
      // Never let a missing label reach the copy — "Every investment is in
      // undefined" is worse than saying nothing.
      label: k.label || k.key || 'one market',
      value: k.value,
      pct: kindTotal > 0 ? round((k.value / kindTotal) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value);

  // SCORE — 0..10. Two readings, each mapped linearly onto 0..10 and averaged,
  // so a portfolio can't look safe on one measure while hiding on the other:
  //   HHI       0.04 (≈ 25 equal positions) → 0   …   0.45 (≈ 2 equal) → 10
  //   largest   8% of investments           → 0   …   55%              → 10
  // Both ends clamp. Calibrated so that a normal portfolio lands mid-scale
  // rather than pinned at an edge — 20 equal holdings ≈ 0.1, twelve with an 18%
  // top position ≈ 2, eight with a 30% top ≈ 4.3, five with a 50% top ≈ 7.9,
  // two even ≈ 9.5. These thresholds are judgement calls about what a sensible
  // private portfolio looks like, NOT a measurement of risk — which is exactly
  // why the panel prints it as a guide with its inputs shown alongside.
  const rawScore = 5 * (ramp(hhi, 0.04, 0.45) + ramp(largest, 0.08, 0.55));
  const score = round(rawScore, 1);

  const shared = {
    top_holdings: topHoldings,
    top3_pct: round(top3 * 100),
    hhi: round(hhi, 4),
    by_currency: byCurrency,
    by_kind: byKind,
    investments_total: total,
    holdings_count: items.length,
    positions_count: list.length,
  };

  // A single position is a fact, not a finding — there is no spread to score,
  // and no flag either: raising one would only repeat the note back at someone
  // who is doing nothing wrong by having started with one holding.
  if (list.length < 2) {
    return {
      ...shared,
      score: 0,
      score_label: 'Not enough to assess',
      score_note:
        'With one holding there is no spread to measure yet — which is perfectly normal at the start. Add a second and this score starts to mean something.',
      flags: [],
    };
  }

  /* --------------------------------- flags -------------------------------- */
  const flags = [];
  const pct = (w) => `${(w * 100).toFixed(1)}%`;
  const top = list[0];

  if (largest > 0.25) {
    flags.push({
      level: 'high',
      kind: 'size',
      title: `${top.name} is ${pct(largest)} of your investments`,
      detail:
        'A position this size largely sets the direction of the whole portfolio — a bad year for it is a bad year for you, however well everything else does.',
    });
  } else if (largest > 0.15) {
    flags.push({
      level: 'medium',
      kind: 'size',
      title: `${top.name} is ${pct(largest)} of your investments`,
      detail:
        'Large enough that its moves show up clearly in your total. Worth watching if you keep adding to it.',
    });
  }

  // With three holdings the top three are trivially everything, so this only
  // says something once there are four or more.
  if (list.length > 3 && top3 > 0.6) {
    flags.push({
      level: top3 > 0.75 ? 'high' : 'medium',
      kind: 'top3',
      title: `Your three largest holdings are ${pct(top3)} of your investments`,
      detail: `The other ${list.length - 3} ${list.length - 3 === 1 ? 'holding has' : 'holdings have'} little say in how the portfolio does.`,
    });
  }

  // Market before currency: for a single-market portfolio the two say the same
  // thing, and one clear point beats the same point made twice.
  let oneMarket = false;
  if (byKind.length === 1) {
    oneMarket = true;
    flags.push({
      level: 'medium',
      kind: 'market',
      title: `Every investment is in ${byKind[0].label}`,
      detail: 'There is nothing in another market to steady things when this one has a poor stretch.',
    });
  } else if (byKind.length > 1) {
    const regions = new Set(byKind.map((k) => REGION[k.kind]).filter(Boolean));
    if (regions.size === 1 && byKind.every((k) => REGION[k.kind])) {
      oneMarket = true;
      flags.push({
        level: 'low',
        kind: 'market',
        title: `All of your investments are in ${[...regions][0]}`,
        detail:
          'You hold more than one kind of investment, but they all rise and fall with the same economy and the same currency.',
      });
    }
  }

  const topCur = byCurrency[0];
  // Aggregate, not the single largest: a portfolio split 55% USD / 45% GBP
  // against an INR base is 100% exposed to currency, yet no single currency
  // clears any threshold. Testing only the biggest one told that user nothing
  // stood out.
  const foreignPct = byCurrency
    .filter((c) => c.currency !== base)
    .reduce((s, c) => s + (Number(c.pct) || 0), 0);
  if (foreignPct > 70) {
    const biggestForeign = byCurrency.filter((c) => c.currency !== base).sort((a, b) => b.pct - a.pct)[0];
    flags.push({
      level: foreignPct > 90 ? 'high' : 'medium',
      kind: 'currency',
      title: `${foreignPct.toFixed(1)}% of your investments are priced outside ${base}`,
      detail: `You track your wealth in ${base}, so the ${biggestForeign?.currency || 'foreign'}/${base} rate moves your total even on days the holdings themselves do not.`,
    });
  } else if (topCur && !oneMarket && topCur.currency === base && topCur.pct >= 95 && list.length >= 3) {
    flags.push({
      level: 'low',
      kind: 'currency',
      title: `${topCur.pct.toFixed(0)}% of your investments are priced in ${base}`,
      detail:
        'That leaves you with almost no exchange-rate risk, which is a real advantage. It also means one economy carries your whole portfolio.',
    });
  }

  if (list.length <= 4) {
    flags.push({
      level: 'low',
      kind: 'count',
      title: `You hold ${list.length} positions`,
      detail:
        'A portfolio this small is concentrated by nature. That is normal early on and settles as you add to it.',
    });
  }

  flags.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);

  const effective = 1 / hhi; // "as if" you held this many equal-sized positions

  // The score bands and the flag thresholds are calibrated separately, so they
  // can disagree — and a calm verdict sitting directly above a finding this same
  // card badges "worth acting on" reads as carelessness. Let the flags win.
  let resolvedLabel = labelFor(score);
  if (flags.some((f) => f.level === 'high') && score < 4) resolvedLabel = 'Somewhat concentrated';

  return {
    ...shared,
    score,
    score_label: resolvedLabel,
    score_note: `Your ${list.length} positions are spread about as evenly as ${effective.toFixed(1)} equal-sized holdings would be, and the largest is ${pct(largest)} of the total.`,
    flags,
  };
}
