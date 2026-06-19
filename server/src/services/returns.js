// Returns & capital-gains maths for a transaction ledger.
// Disclaimer (surfaced in the UI): these are estimates for planning, not tax
// advice. "Long term" = held longer than LONG_TERM_MONTHS; apply your own
// country's exact rates/rules (or hand the statement to your accountant).
const LONG_TERM_MONTHS = 12;
const DAY = 24 * 60 * 60 * 1000;
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;
const isLongTerm = (buyDate, sellDate) => days(buyDate, sellDate) > LONG_TERM_MONTHS * 30.44;

// XIRR via Newton's method with a bisection fallback. flows: [{date, amount}]
// (amount < 0 = money out / buy, > 0 = money in / sell or current value).
export function xirr(flows) {
  const cfs = flows.filter((f) => Number.isFinite(f.amount) && f.amount !== 0);
  if (cfs.length < 2) return null;
  if (!cfs.some((f) => f.amount < 0) || !cfs.some((f) => f.amount > 0)) return null;
  const t0 = Date.parse(cfs[0].date);
  const yrs = (d) => (Date.parse(d) - t0) / (365 * DAY);
  const npv = (r) => cfs.reduce((s, f) => s + f.amount / (1 + r) ** yrs(f.date), 0);

  let rate = 0.1;
  for (let i = 0; i < 60; i += 1) {
    const f = npv(rate);
    const d = (npv(rate + 1e-6) - f) / 1e-6;
    if (!Number.isFinite(d) || d === 0) break;
    const next = rate - f / d;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-7) return next;
    rate = next > -0.9999 ? next : -0.9999;
  }
  // Bisection fallback over a wide range.
  let lo = -0.9999;
  let hi = 100;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const v = npv(mid);
    if (Math.abs(v) < 1e-6) return mid;
    if (npv(lo) * v < 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

// Compute realized/unrealized gains + XIRR for one instrument from its ledger.
// txns: [{type:'BUY'|'SELL', trade_date, quantity, price}]; price in the
// holding's currency. currentPrice in the same currency (null if unknown).
export function computeReturns(txns, currentPrice, asOf) {
  const sorted = [...txns].sort((a, b) => Date.parse(a.trade_date) - Date.parse(b.trade_date));
  const lots = []; // open buy lots: { date, qty, price }
  let invested = 0;
  let realizedShort = 0;
  let realizedLong = 0;
  const flows = [];

  for (const t of sorted) {
    const qty = Number(t.quantity) || 0;
    const price = Number(t.price) || 0;
    if (qty <= 0) continue;
    if (t.type === 'BUY') {
      lots.push({ date: t.trade_date, qty, price });
      invested += qty * price;
      flows.push({ date: t.trade_date, amount: -(qty * price) });
    } else {
      // SELL — match against earliest open lots (FIFO).
      let remaining = qty;
      flows.push({ date: t.trade_date, amount: qty * price });
      while (remaining > 0 && lots.length) {
        const lot = lots[0];
        const take = Math.min(remaining, lot.qty);
        const gain = take * (price - lot.price);
        if (isLongTerm(lot.date, t.trade_date)) realizedLong += gain;
        else realizedShort += gain;
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= 1e-9) lots.shift();
      }
    }
  }

  const openQty = lots.reduce((s, l) => s + l.qty, 0);
  const costBasis = lots.reduce((s, l) => s + l.qty * l.price, 0);
  const today = asOf || new Date().toISOString().slice(0, 10);
  const hasPrice = Number.isFinite(currentPrice);
  const marketValue = hasPrice ? openQty * currentPrice : costBasis;

  let unrealizedShort = 0;
  let unrealizedLong = 0;
  if (hasPrice) {
    for (const lot of lots) {
      const gain = lot.qty * (currentPrice - lot.price);
      if (isLongTerm(lot.date, today)) unrealizedLong += gain;
      else unrealizedShort += gain;
    }
  }

  if (openQty > 1e-9 && hasPrice) flows.push({ date: today, amount: marketValue });

  return {
    invested,
    open_qty: openQty,
    cost_basis: costBasis,
    market_value: marketValue,
    realized: { short: realizedShort, long: realizedLong, total: realizedShort + realizedLong },
    unrealized: { short: unrealizedShort, long: unrealizedLong, total: unrealizedShort + unrealizedLong },
    xirr: xirr(flows),
    flows,
  };
}
