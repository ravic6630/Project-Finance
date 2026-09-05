// Allocation hierarchy — pure, no network and no server needed.
//   node test-allocation-tree.mjs
//
// The sunburst encodes value as ANGLE, and angle is share of parent. So the one
// property that must never break is that every parent equals the sum of its
// children: the moment it doesn't, a slice silently misrepresents how much money
// it is, which is the worst thing a chart of someone's net worth can do.
import { buildAllocationTree } from './src/services/allocationTree.js';

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label} ${extra}`);
  }
};
const near = (a, b, tol = 0.01) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const byKey = (nodes, key) => (nodes || []).find((n) => n.key === key);
const byName = (nodes, name) => (nodes || []).find((n) => n.name === name);

console.log('— allocation hierarchy —');

/* ------------------------------- the fixture ------------------------------ */
// Investments 12,00,000 = Indian Stocks (10L: Reliance 7L + Infosys 3L)
//                       + US Stocks (2L: Apple)
// Cash 5,50,000 = Bank (HDFC 5L) + FD (SBI FD 50k)
// Assets 50,00,000 = Property (Flat)
// Net worth 67,50,000.
const tree = buildAllocationTree({
  items: [
    { kind: 'IN_STOCK', name: 'Reliance Industries', market_value_base: 700000 },
    { kind: 'IN_STOCK', name: 'Infosys', market_value_base: 300000 },
    { kind: 'US_STOCK', name: 'Apple', market_value_base: 200000 },
  ],
  accounts: [
    { type: 'BANK', name: 'HDFC Savings', balance: 500000, currency: 'INR' },
    { type: 'FD', name: 'SBI FD', balance: 50000, currency: 'INR' },
  ],
  assets: [{ type: 'PROPERTY', name: 'Flat', value: 5000000, currency: 'INR' }],
});

ok(near(tree.value, 6750000), 'root = 67,50,000', String(tree.value));
ok(tree.children.length === 3, 'three top-level branches', String(tree.children.length));
ok(tree.depth === 3, 'three levels deep below the root', String(tree.depth));

/* --------------------------- the load-bearing rule ------------------------ */
// Walk the whole tree: every parent must equal the sum of its children, at
// every level. This is what makes the angles mean what they look like.
const violations = [];
const check = (node, path = 'root') => {
  const kids = node.children || [];
  if (!kids.length) return;
  const sum = kids.reduce((s, c) => s + c.value, 0);
  if (!near(node.value, sum, 0.02)) violations.push(`${path}: ${node.value} != ${sum}`);
  kids.forEach((c) => check(c, `${path}/${c.name}`));
};
check(tree);
ok(violations.length === 0, 'every parent equals the sum of its children', violations.join(' | '));

/* ------------------------------ the branches ------------------------------ */
const invest = byKey(tree.children, 'INVESTMENTS');
const cash = byKey(tree.children, 'CASH');
const assets = byKey(tree.children, 'ASSETS');
ok(near(invest?.value, 1200000), 'investments = 12,00,000', String(invest?.value));
ok(near(cash?.value, 550000), 'cash = 5,50,000', String(cash?.value));
ok(near(assets?.value, 5000000), 'assets = 50,00,000', String(assets?.value));

const inStock = byKey(invest?.children, 'IN_STOCK');
ok(near(inStock?.value, 1000000), 'Indian Stocks = 10,00,000', String(inStock?.value));
ok(inStock?.name === 'Indian Stocks', 'and carries a human label, not a key', inStock?.name);
ok(near(byName(inStock?.children, 'Reliance Industries')?.value, 700000), 'the holding itself is a leaf');
ok(byKey(cash?.children, 'FD')?.name === 'Fixed Deposit', 'cash types are labelled', byKey(cash?.children, 'FD')?.name);
ok(byKey(assets?.children, 'PROPERTY')?.name === 'Property', 'asset types are labelled');

/* --------------------------------- ordering ------------------------------- */
// Biggest first at every level, so the eye lands on what matters and colours
// stay put between renders.
const ordered = (nodes) => (nodes || []).every((n, i) => i === 0 || nodes[i - 1].value >= n.value);
ok(ordered(tree.children), 'top level sorted largest first');
ok(ordered(invest?.children), 'markets sorted largest first');
ok(ordered(inStock?.children), 'holdings sorted largest first');
ok(tree.children[0].key === 'ASSETS', 'the 50L flat leads', tree.children[0].key);

/* --------------------------- non-positive values -------------------------- */
// An overdraft and an unpriced holding have no angular size. They must be
// dropped from the geometry AND reported, never silently folded in.
const withNeg = buildAllocationTree({
  items: [
    { kind: 'IN_STOCK', name: 'Good Co', market_value_base: 100000 },
    { kind: 'IN_STOCK', name: 'Unpriced Co', market_value_base: 0 },
  ],
  accounts: [
    { type: 'BANK', name: 'Salary account', balance: 50000, currency: 'INR' },
    { type: 'BANK', name: 'Overdraft', balance: -20000, currency: 'INR' },
  ],
  assets: [],
});
ok(near(withNeg.value, 150000), 'the drawn total excludes the overdraft', String(withNeg.value));
ok(withNeg.omitted?.count === 2, 'both non-positive entries are reported', JSON.stringify(withNeg.omitted));
ok(near(withNeg.omitted?.value, 20000), 'and their size is reported as a magnitude', String(withNeg.omitted?.value));
ok(!byName(byKey(withNeg.children, 'CASH')?.children?.[0]?.children, 'Overdraft'), 'the overdraft is not drawn');
const negViolations = [];
check(withNeg);
ok(negViolations.length === 0 && violations.length === 0, 'sums still hold after dropping entries');

/* ------------------------------- empty cases ------------------------------ */
const empty = buildAllocationTree({});
ok(empty.value === 0 && empty.children.length === 0, 'an empty account is an empty tree, not a crash');
ok(empty.depth === 0, 'and reports zero depth', String(empty.depth));
ok(empty.omitted === null, 'with nothing omitted');

const cashOnly = buildAllocationTree({
  accounts: [{ type: 'BANK', name: 'Only account', balance: 1000, currency: 'INR' }],
});
ok(cashOnly.children.length === 1 && cashOnly.depth === 3, 'one account still nests three levels', String(cashOnly.depth));
ok(near(cashOnly.value, 1000), 'and totals correctly');

/* ------------------------------- conversion ------------------------------- */
// Accounts and assets carry their own currency; the tree must be in base.
const fx = buildAllocationTree({
  accounts: [{ type: 'BANK', name: 'US account', balance: 1000, currency: 'USD' }],
  toBase: (v, c) => (c === 'USD' ? v * 83 : v),
});
ok(near(fx.value, 83000), 'foreign balances are converted to base', String(fx.value));

/* ------------------------------ serialisation ----------------------------- */
const blob = JSON.stringify(tree);
ok(!/NaN|Infinity|undefined/.test(blob), 'the tree serialises with no NaN or undefined', blob.slice(0, 160));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
