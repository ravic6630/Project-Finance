// Project a goal forward: given what's saved now, the monthly contribution and
// an expected return, will it reach the target by the target date? Also works
// out the monthly contribution actually required to get there.
export function projectGoal(g) {
  const target = Number(g.target_amount) || 0;
  const current = Number(g.current_amount) || 0;
  const monthly = Number(g.monthly_contribution) || 0;
  const r = Number(g.expected_return) || 0;

  const nowMs = Date.now();
  const targetMs = g.target_date ? Date.parse(`${g.target_date}T00:00:00`) : nowMs;
  const years = Math.max(0, (targetMs - nowMs) / (365.25 * 24 * 3600 * 1000));
  const i = r / 100 / 12;
  const n = Math.round(years * 12);

  const fvLump = current * (1 + r / 100) ** years;
  // SIP future-value factor (contribution at start of month).
  const sipFactor = n === 0 ? 0 : i === 0 ? n : (((1 + i) ** n - 1) / i) * (1 + i);
  const projected = fvLump + monthly * sipFactor;

  const shortfall = Math.max(0, target - projected);
  // Monthly needed to close the gap from today's corpus.
  const requiredMonthly =
    n === 0 || sipFactor === 0 ? null : Math.max(0, (target - fvLump) / sipFactor);

  return {
    years_to_target: Number(years.toFixed(2)),
    projected_value: Math.round(projected),
    on_track: projected >= target,
    shortfall: Math.round(shortfall),
    required_monthly: requiredMonthly == null ? null : Math.round(requiredMonthly),
    saved_pct: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0,
    projected_pct: target > 0 ? Math.round((projected / target) * 100) : 0,
  };
}
