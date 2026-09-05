import { KIND_LABELS } from '../markets.js';

// Where your money actually sits, as a tree rather than a flat ring.
//
// CONTRACT — buildAllocationTree({ items, accounts, assets, toBase }) returns:
// {
//   name: 'Net worth',
//   value: number,                 // sum of the kept children, see below
//   children: [
//     { key, name, value, children: [ { key, name, value, children: [leaf…] } ] }
//   ],
//   omitted: { value: number, count: number } | null,
//   depth: number                  // deepest level present, root = 0
// }
//
// Three levels below the root, each answering a different question:
//   Investments / Cash / Assets   — what KIND of wealth is this
//   Indian Stocks / FD / Property — what is it invested in
//   Reliance / HDFC Savings / Flat— which one, by name
//
// A flat ring can only ever show one of those, which is why it never answered
// "where is my money" properly: 74% "Assets" is the least interesting sentence
// the data can produce, and the interesting one — WHICH asset — was thrown away.
//
// NON-POSITIVE VALUES are dropped, not drawn. An overdrawn account and an
// unpriced holding have no angular size, and rendering a negative slice is
// meaningless. Every parent's value is the sum of the children that survived,
// so percentages down any branch always total 100% of what is drawn — and what
// was left out is reported in `omitted` so the UI can say so out loud rather
// than quietly disagreeing with the dashboard's net worth.

const CASH_LABELS = { BANK: 'Bank', CASH: 'Cash', FD: 'Fixed Deposit', OTHER: 'Other' };
const ASSET_LABELS = {
  PROPERTY: 'Property',
  LAND: 'Land',
  BUSINESS: 'Business',
  VEHICLE: 'Vehicle',
  GOLD: 'Gold',
  OTHER: 'Other',
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (v) => Math.round(v * 100) / 100;

// Group leaves under a labelled parent, keeping only what can be drawn.
// Returns { nodes, omittedValue, omittedCount }.
function group(leaves, labelFor) {
  const buckets = new Map();
  let omittedValue = 0;
  let omittedCount = 0;

  for (const leaf of leaves) {
    const value = num(leaf.value);
    if (!(value > 0)) {
      omittedValue += Math.abs(value);
      omittedCount += 1;
      continue;
    }
    const key = leaf.groupKey || 'OTHER';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, name: labelFor(key), value: 0, children: [] };
      buckets.set(key, bucket);
    }
    bucket.value += value;
    bucket.children.push({ name: leaf.name, value: round2(value) });
  }

  const nodes = [...buckets.values()].map((b) => ({
    ...b,
    value: round2(b.value),
    // Biggest first at every level: the eye should land on the thing that
    // matters, and a stable order keeps colours steady between renders.
    children: b.children.sort((a, c) => c.value - a.value || a.name.localeCompare(c.name)),
  }));
  nodes.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return { nodes, omittedValue, omittedCount };
}

export function buildAllocationTree({ items = [], accounts = [], assets = [], toBase = (v) => v } = {}) {
  const investLeaves = (items || []).map((h) => ({
    groupKey: h.kind || 'OTHER',
    name: String(h.name || h.symbol || h.scheme_code || 'Unnamed holding').trim(),
    value: num(h.market_value_base),
  }));
  const cashLeaves = (accounts || []).map((a) => ({
    groupKey: a.type || 'OTHER',
    name: String(a.name || 'Account').trim(),
    value: toBase(num(a.balance), a.currency),
  }));
  const assetLeaves = (assets || []).map((a) => ({
    groupKey: a.type || 'OTHER',
    name: String(a.name || 'Asset').trim(),
    value: toBase(num(a.value), a.currency),
  }));

  const invest = group(investLeaves, (k) => KIND_LABELS[k] || k);
  const cash = group(cashLeaves, (k) => CASH_LABELS[k] || k);
  const asset = group(assetLeaves, (k) => ASSET_LABELS[k] || k);

  const sum = (nodes) => round2(nodes.reduce((s, n) => s + n.value, 0));

  const top = [
    { key: 'INVESTMENTS', name: 'Investments', value: sum(invest.nodes), children: invest.nodes },
    { key: 'CASH', name: 'Cash & Bank', value: sum(cash.nodes), children: cash.nodes },
    { key: 'ASSETS', name: 'Assets', value: sum(asset.nodes), children: asset.nodes },
  ].filter((n) => n.value > 0);
  top.sort((a, b) => b.value - a.value);

  const omittedValue = round2(invest.omittedValue + cash.omittedValue + asset.omittedValue);
  const omittedCount = invest.omittedCount + cash.omittedCount + asset.omittedCount;

  // How deep the data actually goes. A single holding in a single market is
  // three rings of the same arc, and the UI uses this to stop drawing rings
  // that carry no information.
  let depth = 0;
  if (top.length) {
    depth = 1;
    if (top.some((t) => t.children.length)) depth = 2;
    if (top.some((t) => t.children.some((c) => c.children.length))) depth = 3;
  }

  return {
    name: 'Net worth',
    value: sum(top),
    children: top,
    omitted: omittedCount ? { value: omittedValue, count: omittedCount } : null,
    depth,
  };
}
