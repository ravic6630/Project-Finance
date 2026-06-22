// Export the loaded holdings to a CSV file (client-side; no server round-trip).
// Columns are import-friendly (Symbol/Quantity/Avg cost) so a file exported here
// can be re-imported via Import CSV.

const MARKET = {
  IN_STOCK: 'India',
  US_STOCK: 'USA',
  UK_STOCK: 'UK',
  IE_STOCK: 'Ireland',
  AU_STOCK: 'Australia',
  NZ_STOCK: 'NZ',
  CA_STOCK: 'Canada',
  IN_MF: 'India (MF)',
};

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : '');

export function holdingsToCsv(holdings, base) {
  const headers = [
    'Name', 'Symbol', 'Market', 'Quantity', 'Avg cost', 'Currency',
    'Price', `Value (${base})`, `Gain (${base})`,
  ];
  const rows = holdings.map((h) => [
    h.name,
    h.symbol || (h.scheme_code ? `MF:${h.scheme_code}` : ''),
    MARKET[h.kind] || h.kind,
    h.quantity,
    h.avg_cost,
    h.currency,
    h.price ?? '',
    round2(h.market_value_base),
    round2(h.gain_base),
  ]);
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}

export function downloadHoldingsCsv(holdings, base, dateStr) {
  // Prepend a UTF-8 BOM so Excel detects encoding (and ₹/£/€ render correctly).
  const blob = new Blob([`\uFEFF${holdingsToCsv(holdings, base)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sampada-holdings-${dateStr || new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
