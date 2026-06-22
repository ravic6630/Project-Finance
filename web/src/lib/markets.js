// Markets/currencies Sampada supports (mirror of server/src/markets.js).

export const CURRENCIES = [
  { code: 'INR', label: '₹ Indian Rupee', symbol: '₹', flag: '🇮🇳', name: 'Indian Rupee' },
  { code: 'USD', label: '$ US Dollar', symbol: '$', flag: '🇺🇸', name: 'US Dollar' },
  { code: 'GBP', label: '£ British Pound', symbol: '£', flag: '🇬🇧', name: 'British Pound' },
  { code: 'EUR', label: '€ Euro', symbol: '€', flag: '🇪🇺', name: 'Euro' },
  { code: 'AUD', label: 'A$ Australian Dollar', symbol: 'A$', flag: '🇦🇺', name: 'Australian Dollar' },
  { code: 'NZD', label: 'NZ$ New Zealand Dollar', symbol: 'NZ$', flag: '🇳🇿', name: 'New Zealand Dollar' },
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

// Best-effort guess of the visitor's home currency from their device timezone /
// locale, limited to the currencies we support. Always overridable by the user.
const TZ_CURRENCY = {
  'Asia/Kolkata': 'INR',
  'Asia/Calcutta': 'INR',
  'Europe/London': 'GBP',
  'Europe/Dublin': 'EUR',
  'Pacific/Auckland': 'NZD',
  'Pacific/Chatham': 'NZD',
};
const REGION_CURRENCY = { IN: 'INR', US: 'USD', GB: 'GBP', IE: 'EUR', AU: 'AUD', NZ: 'NZD' };

export function guessCurrency(fallback = 'USD') {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (TZ_CURRENCY[tz]) return TZ_CURRENCY[tz];
    if (tz.startsWith('America/')) return 'USD';
    if (tz.startsWith('Australia/')) return 'AUD';
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
    for (const l of langs) {
      const region = (String(l).split('-')[1] || '').toUpperCase();
      if (REGION_CURRENCY[region]) return REGION_CURRENCY[region];
    }
  } catch {
    /* fall through to default */
  }
  return CURRENCY_CODES.includes(fallback) ? fallback : 'USD';
}
