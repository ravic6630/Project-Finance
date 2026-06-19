import { getFxRate, getPrice } from './prices.js';

export { KIND_LABELS } from '../markets.js';

// Price every holding, then express cost & market value in `base` currency.
// `manual_price` (if set) always wins over the fetched price.
export async function enrichHoldings(holdings, base, opts = {}) {
  const priced = await Promise.all(
    holdings.map((h) => getPrice(h, opts).then((p) => ({ h, p })))
  );

  // Gather every currency we'll need a rate for, then fetch rates once.
  const currencies = new Set([base]);
  for (const { h, p } of priced) {
    currencies.add(h.currency);
    currencies.add(h.manual_price != null ? h.currency : p.currency || h.currency);
  }
  const rates = {};
  await Promise.all(
    [...currencies].map(async (c) => {
      rates[c] = await getFxRate(c, base);
    })
  );
  const toBase = (amt, cur) => amt * (rates[cur] ?? 1);

  const items = priced.map(({ h, p }) => {
    const isManual = h.manual_price != null;
    const priceCurrency = isManual ? h.currency : p.currency || h.currency;
    const livePrice = isManual ? h.manual_price : p.price;
    const hasPrice = Number.isFinite(livePrice);

    const marketNative = hasPrice ? h.quantity * livePrice : null;
    const costNative = h.quantity * h.avg_cost;
    const costBase = toBase(costNative, h.currency);
    // If we have no price at all, fall back to cost so the holding still counts.
    const valueBase = marketNative != null ? toBase(marketNative, priceCurrency) : costBase;
    const gainBase = marketNative != null ? valueBase - costBase : 0;

    return {
      ...h,
      price: hasPrice ? livePrice : null,
      price_currency: priceCurrency,
      price_source: isManual ? 'manual' : p.source || null,
      price_updated_at: isManual ? null : p.updated_at || null,
      price_stale: isManual ? false : !!p.stale,
      market_value: marketNative,
      market_value_base: valueBase,
      cost_value: costNative,
      cost_value_base: costBase,
      gain_base: gainBase,
      gain_pct: costBase > 0 && marketNative != null ? (gainBase / costBase) * 100 : null,
    };
  });

  return { items, rates };
}

export async function convertAmount(amount, from, base) {
  const rate = await getFxRate(from, base);
  return amount * rate;
}
