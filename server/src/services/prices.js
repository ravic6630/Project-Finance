import { db, now } from '../db.js';
import { STOCK_MARKETS } from '../markets.js';

const PRICE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const LIVE_PRICE_TTL_MS = 20 * 1000; // fast path for the auto-refreshing Investments page
const FX_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT_MS = 9000;

const isFresh = (ts, ttl) => !!ts && Date.now() - Date.parse(ts) < ttl;

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
  let price = meta?.regularMarketPrice;
  if (!Number.isFinite(price)) throw new Error('No price in Yahoo response');
  // LSE and some other exchanges quote in pence (GBp / GBX) — normalise to the
  // major unit so currency formatting isn't 100x off.
  let currency = meta.currency || 'USD';
  if (currency === 'GBp' || currency === 'GBX') {
    price /= 100;
    currency = 'GBP';
  } else if (currency === 'ZAc') {
    price /= 100;
    currency = 'ZAR';
  }
  // longName is the properly-cased full name ("HDFC Bank Limited"); shortName is
  // an ALL-CAPS abbreviation. Prefer longName. Yahoo occasionally returns a junk
  // shortName like "SYM,0P0001LR17,171521" for REITs/InvITs — reject anything
  // with a comma so the importer can fall back to a tidied statement name.
  const candidate = meta.longName || meta.shortName || symbol;
  const name = /,/.test(candidate) ? symbol : candidate;
  return { price, currency, name, source: 'yahoo' };
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

// --- Mutual fund search: cache the full AMFI scheme list and match locally
// (reliable across multi-word queries; mfapi's /search endpoint is flaky). ---
const normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
let mfList = null;
let mfListAt = 0;
const MF_LIST_TTL = 24 * 60 * 60 * 1000;

async function loadMfList() {
  if (mfList && Date.now() - mfListAt < MF_LIST_TTL) return mfList;
  const json = await fetchJson('https://api.mfapi.in/mf', {}, 25000);
  if (Array.isArray(json) && json.length) {
    mfList = json.map((r) => ({
      schemeCode: String(r.schemeCode),
      schemeName: r.schemeName,
      norm: normalize(r.schemeName),
    }));
    mfListAt = Date.now();
  }
  return mfList || [];
}

export async function searchMutualFunds(query) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  let list = [];
  try {
    list = await loadMfList();
  } catch {
    list = [];
  }
  if (list.length) {
    const toks = q.split(/\s+/).map(normalize).filter(Boolean);
    return list
      .filter((x) => toks.every((t) => x.norm.includes(t)))
      .sort((a, b) => a.schemeName.length - b.schemeName.length)
      .slice(0, 25)
      .map(({ schemeCode, schemeName }) => ({ schemeCode, schemeName }));
  }
  // Fallback: mfapi's own search.
  try {
    const json = await fetchJson(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`);
    return (Array.isArray(json) ? json : [])
      .slice(0, 25)
      .map((r) => ({ schemeCode: String(r.schemeCode), schemeName: r.schemeName }));
  } catch {
    return [];
  }
}

// --- Stock search via Yahoo Finance, filtered to the requested market. ---
const SUFFIX_KIND = { '.NS': 'IN_STOCK', '.BO': 'IN_STOCK', '.L': 'UK_STOCK', '.IR': 'IE_STOCK', '.AX': 'AU_STOCK', '.NZ': 'NZ_STOCK', '.TO': 'CA_STOCK', '.V': 'CA_STOCK' };

// Which market does a Yahoo search result belong to?
function quoteKind(z) {
  const m = String(z.symbol || '').match(/(\.[A-Z]{1,3})$/);
  if (m && SUFFIX_KIND[m[1]]) return SUFFIX_KIND[m[1]];
  if (!String(z.symbol || '').includes('.')) return 'US_STOCK';
  for (const [k, mk] of Object.entries(STOCK_MARKETS)) {
    if (mk.exch.includes(z.exchDisp)) return k;
  }
  return null;
}

export async function searchStocks(query, kind) {
  const q = String(query || '').trim();
  if (q.length < 1) return [];
  let json;
  try {
    json = await fetchJson(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=20&newsCount=0&listsCount=0`,
      { 'User-Agent': 'Mozilla/5.0' }
    );
  } catch {
    return [];
  }
  const wanted = STOCK_MARKETS[kind] ? kind : 'US_STOCK';
  const quotes = (json?.quotes || []).filter((z) => z.symbol && ['EQUITY', 'ETF'].includes(z.quoteType));
  return quotes
    .filter((z) => quoteKind(z) === wanted)
    .slice(0, 10)
    .map((z) => ({ symbol: z.symbol, name: z.longname || z.shortname || z.symbol, exchange: z.exchDisp || z.exchange }));
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
export async function getPrice(holding, { force = false, ttl } = {}) {
  const key = priceKeyFor(holding);
  if (!key || key === 'MF:') return { price: null, currency: holding.currency, stale: true };

  // Mutual-fund NAVs publish once a day, so never refetch them on fast live
  // polls — keep them on the normal cache window even when a short ttl is asked.
  const baseTtl = ttl ?? PRICE_TTL_MS;
  const maxAge = force ? 0 : holding.kind === 'IN_MF' ? Math.max(baseTtl, PRICE_TTL_MS) : baseTtl;

  const cached = await getCachedPrice.get(key);
  if (cached && isFresh(cached.updated_at, maxAge)) {
    return { ...cached, stale: false };
  }

  try {
    const fresh =
      holding.kind === 'IN_MF'
        ? await fetchMfNav(holding.scheme_code)
        : await fetchStock(holding.symbol);
    const ts = now();
    await upsertPrice.run(key, fresh.price, fresh.currency, fresh.name, fresh.source, ts);
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
  const cached = await getCachedFx.get(pair);
  if (!force && cached && isFresh(cached.updated_at, FX_TTL_MS)) return cached.rate;

  try {
    const json = await fetchJson(`https://open.er-api.com/v6/latest/${base}`);
    const rate = json?.rates?.[quote];
    if (!Number.isFinite(rate)) throw new Error('FX rate missing');
    await upsertFx.run(pair, rate, now());
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
