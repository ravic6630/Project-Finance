import { db, now } from '../db.js';
import { num, str } from '../util.js';

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

const INSERT_SQL = `
  INSERT INTO holdings
    (user_id, kind, symbol, scheme_code, name, quantity, avg_cost, currency, manual_price, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
`;

// Insert reviewed import rows atomically. Shared by CAS and broker imports.
export async function insertImportedHoldings(userId, rows, sourceLabel = 'Imported') {
  const skipped = [];
  const ts = now();
  const stmts = [];
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
    stmts.push({
      sql: INSERT_SQL,
      args: [
        userId, kind, symbol, schemeCode, name,
        num(r.quantity ?? 0, 'quantity'), num(r.avg_cost ?? 0, 'avg_cost'),
        r.currency === 'USD' ? 'USD' : 'INR', sourceLabel, ts, ts,
      ],
    });
  }
  if (stmts.length) await db.batch(stmts);
  return { imported: stmts.length, skipped };
}
