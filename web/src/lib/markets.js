// Markets/currencies Sampada supports (mirror of server/src/markets.js).

export const CURRENCIES = [
  { code: 'INR', label: '₹ Indian Rupee', symbol: '₹' },
  { code: 'USD', label: '$ US Dollar', symbol: '$' },
  { code: 'GBP', label: '£ British Pound', symbol: '£' },
  { code: 'EUR', label: '€ Euro', symbol: '€' },
  { code: 'AUD', label: 'A$ Australian Dollar', symbol: 'A$' },
  { code: 'NZD', label: 'NZ$ New Zealand Dollar', symbol: 'NZ$' },
];
export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

// Stock markets the holdings/alerts forms offer, in display order.
export const STOCK_MARKETS = [
  { kind: 'IN_STOCK', label: 'India', flag: '🇮🇳', currency: 'INR', ph: 'RELIANCE' },
  { kind: 'US_STOCK', label: 'USA', flag: '🇺🇸', currency: 'USD', ph: 'AAPL' },
  { kind: 'UK_STOCK', label: 'UK', flag: '🇬🇧', currency: 'GBP', ph: 'BARC' },
  { kind: 'IE_STOCK', label: 'Ireland', flag: '🇮🇪', currency: 'EUR', ph: 'RYA' },
  { kind: 'AU_STOCK', label: 'Australia', flag: '🇦🇺', currency: 'AUD', ph: 'BHP' },
  { kind: 'NZ_STOCK', label: 'NZ', flag: '🇳🇿', currency: 'NZD', ph: 'AIR' },
];

export const currencyForKind = (kind) =>
  STOCK_MARKETS.find((m) => m.kind === kind)?.currency || 'INR';
