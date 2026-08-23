import { bad } from '../util.js';
import { STOCK_MARKETS, currencyForKind, isStockKind, symbolForMarket } from '../markets.js';
import { dedupSets, resolveName } from './importer.js';

// Pick the most likely delimiter from the header line — some locales' Excel uses
// ';', and data pasted from a spreadsheet is often tab-separated.
function detectDelimiter(text) {
  const header = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const c of header) {
    if (c === '"') inQ = !inQ;
    else if (!inQ && c in counts) counts[c] += 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

// Minimal RFC4180-ish CSV parser: strips a leading UTF-8 BOM (Excel adds one),
// auto-detects the delimiter (comma/semicolon/tab), and handles quoted fields,
// escaped quotes ("") and delimiters/newlines inside quotes. Returns a grid.
export function parseCsv(text, delimiter) {
  const s = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const delim = delimiter || detectDelimiter(s);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-blank lines.
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

// "NSE:RELIANCE" / "NASDAQ:AAPL" → bare ticker (the market is chosen separately).
const stripExchangePrefix = (s) => (String(s).includes(':') ? String(s).split(':').pop().trim() : s);

// Header aliases per target column, matched case/punctuation-insensitively.
const ALIASES = {
  symbol: ['symbol', 'ticker', 'tradingsymbol', 'scrip', 'scripname', 'instrument', 'stock', 'code'],
  name: ['name', 'company', 'companyname', 'security', 'securityname', 'description', 'instrumentname', 'stockname'],
  quantity: ['quantity', 'qty', 'shares', 'units', 'holding', 'holdings', 'noofshares', 'sharesheld', 'quantityavailable', 'closingbalance', 'balance', 'position'],
  avg_cost: ['avgcost', 'averagecost', 'avgprice', 'averageprice', 'buyprice', 'costprice', 'cost', 'price', 'purchaseprice', 'avgbuyprice', 'averagebuyprice', 'costbasis', 'unitcost'],
};

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

export function autoMap(headers) {
  const H = headers.map(norm);
  const find = (aliases) => {
    const al = aliases.map(norm);
    for (let i = 0; i < H.length; i += 1) if (al.includes(H[i])) return i; // exact
    for (let i = 0; i < H.length; i += 1) if (H[i].length > 2 && al.some((a) => H[i].includes(a))) return i; // contains
    return -1;
  };
  return {
    symbol: find(ALIASES.symbol),
    name: find(ALIASES.name),
    quantity: find(ALIASES.quantity),
    avg_cost: find(ALIASES.avg_cost),
  };
}

// "1,234.50" / "$1,234.50" / "(12)" → number; junk → 0.
// Also handles the European convention ("1.234,50" / "1234,50"), since
// detectDelimiter deliberately accepts the ';' CSVs those locales export —
// without this, a comma decimal was stripped and inflated the value 100x.
const EU_GROUPED = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/; // 1.234.567,89
const EU_PLAIN = /^-?\d+,\d{1,2}$/;                   // 1234,50
const parseNum = (v) => {
  let t = String(v ?? '').trim();
  const neg = /^\(.*\)$/.test(t);
  const bare = t.replace(/[()\s]/g, '').replace(/[^\d.,-]/g, ''); // drop currency symbols
  if (EU_GROUPED.test(bare) || EU_PLAIN.test(bare)) {
    t = bare.replace(/\./g, '').replace(',', '.');
  } else {
    t = t.replace(/[^0-9.\-]/g, '');
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
};

// Parse a pasted/uploaded broker CSV into the shared import-preview shape.
// The market (kind) is chosen by the user, so we only need symbol + quantity
// (+ optional cost) columns — which every broker export has.
export async function buildCsvPreview({ text, kind, mapping }, userId) {
  if (!isStockKind(kind)) throw bad('Choose which stock market this CSV is from.');
  const grid = parseCsv(text);
  if (grid.length < 2) throw bad('That CSV needs a header row and at least one holding.');

  const headers = grid[0].map((h) => String(h).trim());
  const map = mapping && Number.isInteger(mapping.symbol) ? mapping : autoMap(headers);
  if (map.symbol < 0 && map.name < 0) throw bad('Could not find a Symbol/Ticker column in that CSV.');
  if (map.quantity < 0) throw bad('Could not find a Quantity/Shares column in that CSV.');

  const cell = (cols, idx) => (idx != null && idx >= 0 ? String(cols[idx] ?? '').trim() : '');
  const parsed = grid
    .slice(1)
    .map((cols) => ({
      symbol: stripExchangePrefix(cell(cols, map.symbol)),
      rawName: cell(cols, map.name),
      quantity: parseNum(cell(cols, map.quantity)),
      avg_cost: parseNum(cell(cols, map.avg_cost)),
    }))
    .filter((r) => (r.symbol || r.rawName) && r.quantity > 0);

  if (!parsed.length) throw bad('No holdings with a positive quantity were found in that CSV.');

  const have = await dedupSets(userId);
  const cur = currencyForKind(kind);
  // Resolve clean names (and warm the price cache) from the symbol where we can.
  const names = await Promise.all(
    parsed.map((r) => resolveName(kind, { symbol: symbolForMarket(kind, r.symbol) }, r.rawName || r.symbol))
  );

  const items = parsed.map((r, i) => {
    const normSym = symbolForMarket(kind, r.symbol) || '';
    return {
      kind,
      symbol: r.symbol, // raw; editable in review and re-normalized on import
      name: names[i] || r.rawName || r.symbol,
      quantity: r.quantity,
      avg_cost: r.avg_cost,
      currency: cur,
      cost_is_estimate: !(r.avg_cost > 0),
      duplicate: normSym ? have.sym.has(normSym) : false,
      importable: true,
    };
  });

  return {
    broker_label: `${STOCK_MARKETS[kind].label} · CSV`,
    items,
    summary: { stocks: items.length, duplicates: items.filter((i) => i.duplicate).length },
  };
}
