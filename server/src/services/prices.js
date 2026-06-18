import { db, now } from '../db.js';

const PRICE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const FX_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT_MS = 9000;

const isFresh = (ts, ttl) => !!ts && Date.now() - Date.parse(ts) < ttl;

async function fetchJson(url, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---- The stable cache key for a holding ----------------------------------
export function priceKeyFor(holding) {
  if (holding.kind === 'IN_MF') return `mf:${holding.scheme_code}`;
  return (holding.symbol || '').toUpperCase();
}

// ---- Upstream fetchers ----------------------------------------------------
async function fetchStock(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=1d`;
  const json = await fetchJson(url, { 'User-Agent': 'Mozilla/5.0' });
  const meta = json?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (!Number.isFinite(price)) throw new Error('No price in Yahoo response');
  return {
    price,
    currency: meta.currency || 'USD',
    name: meta.shortName || meta.longName || symbol,
    source: 'yahoo',
  };
}

async function fetchMfNav(schemeCode) {
  const json = await fetchJson(`https://api.mfapi.in/mf/${encodeURIComponent(schemeCode)}`);
  const nav = Number(json?.data?.[0]?.nav);
  if (!Number.isFinite(nav)) throw new Error('No NAV in mfapi response');
  return {
    price: nav,
    currency: 'INR',
    name: json?.meta?.scheme_name || `Scheme ${schemeCode}`,
    source: 'amfi',
  };
}

export async function searchMutualFunds(query) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  try {
    const json = await fetchJson(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`);
    return (Array.isArray(json) ? json : [])
      .slice(0, 25)
      .map((r) => ({ schemeCode: String(r.schemeCode), schemeName: r.schemeName }));
  } catch {
    return [];
  }
}

// ---- Price cache ----------------------------------------------------------
const getCachedPrice = db.prepare('SELECT * FROM price_cache WHERE price_key = ?');
const upsertPrice = db.prepare(`
  INSERT INTO price_cache (price_key, price, currency, name, source, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(price_key) DO UPDATE SET
    price = excluded.price, currency = excluded.currency,
    name = excluded.name, source = excluded.source, updated_at = excluded.updated_at
`);

// Get a live/cached price for one holding. Never throws — on failure it
// returns the last cached value (if any) flagged as stale.
export async function getPrice(holding, { force = false } = {}) {
  const key = priceKeyFor(holding);
  if (!key || key === 'MF:') return { price: null, currency: holding.currency, stale: true };

  const cached = getCachedPrice.get(key);
  if (!force && cached && isFresh(cached.updated_at, PRICE_TTL_MS)) {
    return { ...cached, stale: false };
  }

  try {
    const fresh =
      holding.kind === 'IN_MF'
        ? await fetchMfNav(holding.scheme_code)
        : await fetchStock(holding.symbol);
    const ts = now();
    upsertPrice.run(key, fresh.price, fresh.currency, fresh.name, fresh.source, ts);
    return { price_key: key, ...fresh, updated_at: ts, stale: false };
  } catch (err) {
    if (cached) return { ...cached, stale: true, error: err.message };
    return { price: null, currency: holding.currency, stale: true, error: err.message };
  }
}

// ---- FX cache -------------------------------------------------------------
const getCachedFx = db.prepare('SELECT * FROM fx_cache WHERE pair = ?');
const upsertFx = db.prepare(`
  INSERT INTO fx_cache (pair, rate, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(pair) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at
`);

export async function getFxRate(base, quote, { force = false } = {}) {
  base = base.toUpperCase();
  quote = quote.toUpperCase();
  if (base === quote) return 1;
  const pair = `${base}${quote}`;
  const cached = getCachedFx.get(pair);
  if (!force && cached && isFresh(cached.updated_at, FX_TTL_MS)) return cached.rate;

  try {
    const json = await fetchJson(`https://open.er-api.com/v6/latest/${base}`);
    const rate = json?.rates?.[quote];
    if (!Number.isFinite(rate)) throw new Error('FX rate missing');
    upsertFx.run(pair, rate, now());
    return rate;
  } catch {
    if (cached) return cached.rate;
    // Last-resort static fallback so the app still renders a number.
    if (pair === 'USDINR') return 83;
    if (pair === 'INRUSD') return 1 / 83;
    return 1;
  }
}

// Refresh every distinct instrument a user holds. Returns counts.
export async function refreshUserPrices(holdings, { force = true } = {}) {
  const keys = new Map();
  for (const h of holdings) {
    const key = priceKeyFor(h);
    if (key && !keys.has(key)) keys.set(key, h);
  }
  let ok = 0;
  let failed = 0;
  await Promise.all(
    [...keys.values()].map(async (h) => {
      const r = await getPrice(h, { force });
      if (r.price != null && !r.stale) ok += 1;
      else failed += 1;
    })
  );
  return { refreshed: ok, failed, total: keys.size };
}
