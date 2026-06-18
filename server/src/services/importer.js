import { db, now } from '../db.js';
import { num, str } from '../util.js';
import { getPrice } from './prices.js';

// Existing holdings as quick-lookup sets, for duplicate flagging on import previews.
export async function dedupSets(userId) {
  const existing = await db
    .prepare('SELECT kind, symbol, scheme_code FROM holdings WHERE user_id = ?')
    .all(userId);
  return {
    mf: new Set(
      existing.filter((h) => h.kind === 'IN_MF' && h.scheme_code).map((h) => String(h.scheme_code))
    ),
    sym: new Set(existing.filter((h) => h.symbol).map((h) => h.symbol.toUpperCase())),
  };
}

// "RELIANCE" → "RELIANCE.NS"; BSE → ".BO". Yahoo-style suffix for Indian stocks.
export function normalizeStockSymbol(kind, symbol, exchange) {
  let s = String(symbol || '').trim().toUpperCase();
  if (!s) return null;
  if (kind === 'IN_STOCK' && !s.includes('.')) {
    s += String(exchange || '').toUpperCase() === 'BSE' ? '.BO' : '.NS';
  }
  return s;
}

// One stable key per instrument, so re-importing a statement updates the same
// holding instead of creating a duplicate row.
export function identityKey(kind, symbol, schemeCode) {
  if (kind === 'IN_MF') return schemeCode ? `mf:${String(schemeCode)}` : null;
  return symbol ? `${kind}:${String(symbol).toUpperCase()}` : null;
}

// ---- Friendly names -------------------------------------------------------
// CAS statements carry cruft like "AFTER SPLIT EXIDE INDUSTRIES LIMITED - NEW
// EQUITY SHARES OF RE. 1/-". We prefer the canonical name from the price feed
// (Yahoo longName / AMFI scheme name) and only tidy the statement text when the
// feed has nothing usable (e.g. a REIT Yahoo can't name).
const ACRONYMS = new Set([
  'HDFC', 'ICICI', 'SBI', 'ITC', 'ONGC', 'NTPC', 'GAIL', 'BPCL', 'HPCL', 'IOC', 'LIC', 'IDFC',
  'IDBI', 'RBL', 'UTI', 'DSP', 'REIT', 'INVIT', 'ETF', 'NBFC', 'PSU', 'TVS', 'MRF', 'ABB',
  'IRFC', 'IRCTC', 'BSE', 'NSE', 'AMC', 'NHPC', 'REC', 'PFC', 'RVNL', 'BHEL', 'SAIL', 'NMDC',
  'GMR', 'DLF', 'UPL', 'HCL', 'TCS', 'LTI', 'NCC', 'KEC', 'BEL', 'HAL', 'L&T', 'JK', 'TVS',
]);

function smartTitle(s) {
  return String(s)
    .toLowerCase()
    .replace(/\b[\w&]+\b/g, (w) => {
      const up = w.toUpperCase();
      if (ACRONYMS.has(up)) return up;
      return w.charAt(0).toUpperCase() + w.slice(1);
    });
}

export function cleanInstrumentName(kind, raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (kind === 'IN_MF') {
    // "BANDHAN AMC LTD#BANDHAN MF-BANDHAN NIFTY 50 INDEX FUND - DIRECT PL - GROWTH"
    s = s.replace(/^.*?AMC\s+LTD\s*#/i, '').replace(/^.*?\bMF\b\s*[-:]\s*/i, '');
    return s.replace(/\s+/g, ' ').trim();
  }
  // Stocks: strip corporate-action prefixes and "new equity shares" boilerplate.
  s = s.replace(/^AFTER\s+(SPLIT|SUB[\s-]*DIVISION|BONUS|MERGER|AMALGAMATION|CONSOLIDATION)\s+/i, '');
  s = s.replace(/^EQUITY SHARES\b.*?\bAFTER\b\s+/i, '');
  s = s.split('#')[0];
  s = s.replace(/\s*[-–]\s*NEW EQUITY SHARES.*$/i, '');
  s = s.replace(/\bNEW EQ(UITY)?\s*SH\b.*$/i, '');
  s = s.replace(/\b(WITH\s+)?(FV|FACE VALUE)\b.*$/i, '');
  s = s.replace(/\s+/g, ' ').trim();
  return smartTitle(s);
}

// Is the price-feed name a real name, or just an echo of the ticker / junk?
function isUsableFeedName(name, symbol) {
  const n = String(name || '').trim();
  if (!n || /,/.test(n)) return false;
  const bare = String(symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
  const nu = n.toUpperCase();
  return nu !== bare && nu !== String(symbol || '').toUpperCase();
}

// Best display name for one parsed holding. Looks up the canonical name (and
// warms the price cache as a side effect); falls back to the tidied statement
// name. Never throws.
export async function resolveName(kind, { symbol, schemeCode }, rawName) {
  const hasKey = kind === 'IN_MF' ? !!schemeCode : !!symbol;
  if (hasKey) {
    try {
      const p = await getPrice({ kind, symbol, scheme_code: schemeCode });
      if (kind === 'IN_MF') {
        if (p?.name && !/^scheme\s+\d+$/i.test(p.name)) return p.name;
      } else if (isUsableFeedName(p?.name, symbol)) {
        return p.name;
      }
    } catch {
      /* fall through to the tidied statement name */
    }
  }
  return cleanInstrumentName(kind, rawName) || str(rawName) || (kind === 'IN_MF' ? 'Mutual Fund' : 'Stock');
}

const INSERT_SQL = `
  INSERT INTO holdings
    (user_id, kind, symbol, scheme_code, name, quantity, avg_cost, currency, manual_price, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
`;
// Re-import refreshes the position but never clobbers a user's manual price/notes.
const UPDATE_SQL = `
  UPDATE holdings SET name = ?, quantity = ?, avg_cost = ?, currency = ?, updated_at = ?
  WHERE id = ? AND user_id = ?
`;

// Import reviewed rows atomically. Shared by CAS and broker imports.
// Upserts by instrument identity: an existing holding is UPDATED in place (so
// uploading next month's statement just refreshes quantities), and any stray
// pre-existing duplicates of the same instrument are merged into one row.
export async function insertImportedHoldings(userId, rows, sourceLabel = 'Imported') {
  const existing = await db
    .prepare('SELECT id, kind, symbol, scheme_code FROM holdings WHERE user_id = ?')
    .all(userId);
  const byKey = new Map();
  for (const h of existing) {
    const key = identityKey(h.kind, h.symbol, h.scheme_code);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(h);
  }

  // Collapse repeated rows for the same instrument within one import (keep last).
  const normalized = [];
  const skipped = [];
  const seen = new Map();
  for (const r of rows) {
    const kind = r.kind === 'IN_MF' ? 'IN_MF' : r.kind === 'US_STOCK' ? 'US_STOCK' : 'IN_STOCK';
    const name = str(r.name);
    if (!name) {
      skipped.push({ name: r.name, reason: 'missing name' });
      continue;
    }
    let symbol = null;
    let schemeCode = null;
    if (kind === 'IN_MF') {
      schemeCode = str(r.scheme_code);
      if (!schemeCode) {
        skipped.push({ name, reason: 'no scheme code' });
        continue;
      }
    } else {
      symbol = normalizeStockSymbol(kind, r.symbol, r.exchange);
      if (!symbol) {
        skipped.push({ name, reason: 'no ticker symbol' });
        continue;
      }
    }
    const key = identityKey(kind, symbol, schemeCode);
    const item = {
      key, kind, symbol, schemeCode, name,
      quantity: num(r.quantity ?? 0, 'quantity'),
      avgCost: num(r.avg_cost ?? 0, 'avg_cost'),
      currency: r.currency === 'USD' ? 'USD' : 'INR',
    };
    if (seen.has(key)) normalized[seen.get(key)] = item;
    else {
      seen.set(key, normalized.length);
      normalized.push(item);
    }
  }

  const ts = now();
  const stmts = [];
  let inserted = 0;
  let updated = 0;
  for (const it of normalized) {
    const matches = byKey.get(it.key);
    if (matches && matches.length) {
      const keep = matches[0];
      stmts.push({ sql: UPDATE_SQL, args: [it.name, it.quantity, it.avgCost, it.currency, ts, keep.id, userId] });
      for (const extra of matches.slice(1)) {
        stmts.push({ sql: 'DELETE FROM holdings WHERE id = ? AND user_id = ?', args: [extra.id, userId] });
      }
      byKey.set(it.key, [keep]);
      updated += 1;
    } else {
      stmts.push({
        sql: INSERT_SQL,
        args: [userId, it.kind, it.symbol, it.schemeCode, it.name, it.quantity, it.avgCost, it.currency, sourceLabel, ts, ts],
      });
      inserted += 1;
    }
  }
  if (stmts.length) await db.batch(stmts);
  return { imported: inserted + updated, inserted, updated, skipped };
}
