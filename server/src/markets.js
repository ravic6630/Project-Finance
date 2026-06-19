// Single source of truth for the markets/currencies Sampada supports.
// Adding a country = add a stock market here (+ mirror in web/src/lib/markets.js).

export const CURRENCIES = ['INR', 'USD', 'GBP', 'EUR', 'AUD', 'NZD'];

// Stock kinds → Yahoo Finance exchange suffix, native currency, label, and the
// Yahoo `exchDisp` values used to filter search results to that market.
export const STOCK_MARKETS = {
  IN_STOCK: { suffix: '.NS', currency: 'INR', label: 'Indian Stocks', exch: ['NSE', 'BSE', 'Bombay'] },
  US_STOCK: { suffix: '', currency: 'USD', label: 'US Stocks', exch: ['NASDAQ', 'NYSE', 'NYSEArca', 'NYSE American', 'NYSEAmerican', 'Cboe US', 'OTC Markets', 'BATS'] },
  UK_STOCK: { suffix: '.L', currency: 'GBP', label: 'UK Stocks', exch: ['LSE', 'London'] },
  IE_STOCK: { suffix: '.IR', currency: 'EUR', label: 'Ireland Stocks', exch: ['Dublin', 'ISEQ', 'Euronext Dublin'] },
  AU_STOCK: { suffix: '.AX', currency: 'AUD', label: 'Australia Stocks', exch: ['ASX', 'Australian'] },
  NZ_STOCK: { suffix: '.NZ', currency: 'NZD', label: 'New Zealand Stocks', exch: ['NZSX', 'NZX', 'New Zealand'] },
};

export const STOCK_KINDS = Object.keys(STOCK_MARKETS);
export const ALL_KINDS = [...STOCK_KINDS, 'IN_MF'];

export const KIND_LABELS = {
  ...Object.fromEntries(Object.entries(STOCK_MARKETS).map(([k, m]) => [k, m.label])),
  IN_MF: 'Indian Mutual Funds',
};

export const isStockKind = (kind) => kind in STOCK_MARKETS;
export const currencyForKind = (kind) => STOCK_MARKETS[kind]?.currency || 'INR';

// "RELIANCE" + IN_STOCK → "RELIANCE.NS"; a symbol that already has a "." (e.g.
// "BARC.L" picked from search) is left untouched.
export function symbolForMarket(kind, symbol) {
  let s = String(symbol || '').trim().toUpperCase();
  if (!s) return null;
  const suffix = STOCK_MARKETS[kind]?.suffix;
  if (suffix && !s.includes('.')) s += suffix;
  return s;
}
