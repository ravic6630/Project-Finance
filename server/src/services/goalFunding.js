// Goal funding: which named investments and accounts pay for which goal.
//
// The plan can fill a goal from "everything you own, in order" — a fair guess,
// but a guess. Someone who has put a liquid fund and part of a bank balance
// aside for a wedding knows exactly what that goal is funded by, and a goal
// that tracks those items is right to the rupee: it rises when the fund does
// and falls when the account is spent from.
//
// Two jobs live here, both pure so they can be tested without a database:
//   classify()        — what kind of money an item is (bank, liquid fund,
//                       equity…), so a goal can say whether what funds it suits
//                       how soon it's needed;
//   resolveEarmarks() — what each goal actually gets from the links saved
//                       against it, with no part of any item counted twice.

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* -------------------------------- classify -------------------------------- */
// Four kinds of money, by how they behave when a goal's date arrives:
//   safe     — bank balances, FDs, liquid and debt funds: there when needed
//   growth   — shares, equity and hybrid funds: can be down on the day
//   physical — property, gold, a business: has to be sold first
//   unknown  — a fund whose type the price source doesn't state

const DEBT = /liquid|overnight|money market|ultra short|low duration|short duration|short term|medium duration|long duration|dynamic bond|corporate bond|credit risk|banking (and|&) psu|gilt|g-sec|floater|floating rate|fixed maturity|\bfmp\b|\bdebt\b|\bbond\b|income fund|\bsdl\b/;
const CASH_LIKE = /liquid|overnight|money market/;
const SHORT_DEBT = /ultra short|low duration|short duration|short term/;
const GOLD = /\bgold\b|\bsilver\b/;
const INDEX = /index|nifty|sensex|\betf\b|s&p|nasdaq/;
const HYBRID = /hybrid|balanced|multi asset|asset allocation|equity savings|retirement|children/;
const EQUITY = /elss|large cap|mid cap|small cap|flexi cap|multi cap|focused|contra|dividend yield|sectoral|thematic|value fund|\bequity\b|overseas|international/;

function classifyFund(category, name) {
  const cat = String(category || '').toLowerCase();
  const text = `${cat} ${String(name || '').toLowerCase()}`;
  if (GOLD.test(text)) return { cls: 'physical', tag: 'Gold fund' };

  // AMFI's top-level bucket is its own statement of what the scheme holds, so
  // it decides when it is specific. "Other Scheme" (index funds, ETFs, funds of
  // funds) and the older one-word categories say nothing about what's inside —
  // a bond index fund and a share index fund sit in the same bucket — so there,
  // and when there is no category at all, the name is read too. The name alone
  // is never trusted for "growth": it's a plan option on every kind of fund.
  const bucket = cat.includes('debt scheme') || /^(income|liquid|gilt|money market|floating rate)/.test(cat)
    ? 'debt'
    : cat.includes('equity scheme') || /^(growth|elss)/.test(cat)
      ? 'equity'
      : cat.includes('hybrid scheme') || cat.includes('solution oriented') || /^balanced/.test(cat)
        ? 'hybrid'
        : null;

  // Arbitrage funds are filed under hybrid but behave like short-term debt.
  if (bucket === 'debt' || /arbitrage/.test(text) || (!bucket && DEBT.test(text))) {
    if (/arbitrage/.test(text)) return { cls: 'safe', tag: 'Arbitrage fund' };
    if (CASH_LIKE.test(text)) return { cls: 'safe', tag: 'Liquid fund' };
    if (SHORT_DEBT.test(text)) return { cls: 'safe', tag: 'Short-term debt fund' };
    return { cls: 'safe', tag: 'Debt fund' };
  }
  if (bucket === 'hybrid' || (!bucket && HYBRID.test(text))) return { cls: 'growth', tag: 'Hybrid fund' };
  if (bucket === 'equity') return { cls: 'growth', tag: 'Equity fund' };
  if (INDEX.test(text)) return { cls: 'growth', tag: 'Index fund' };
  if (EQUITY.test(text)) return { cls: 'growth', tag: 'Equity fund' };
  return { cls: 'unknown', tag: 'Mutual fund' };
}

const ACCOUNT_TAGS = { BANK: 'Bank account', CASH: 'Cash', FD: 'Fixed deposit', OTHER: 'Account' };
const ASSET_TAGS = { PROPERTY: 'Property', LAND: 'Land', BUSINESS: 'Business', VEHICLE: 'Vehicle', GOLD: 'Gold', OTHER: 'Asset' };

// item: { kind: 'holding'|'account'|'asset', holding_kind, category, name, type }
export function classify(item = {}) {
  if (item.kind === 'account') return { cls: 'safe', tag: ACCOUNT_TAGS[item.type] || 'Account' };
  if (item.kind === 'asset') return { cls: 'physical', tag: ASSET_TAGS[item.type] || 'Asset' };
  if (item.holding_kind === 'IN_MF') return classifyFund(item.category, item.name);
  // A listed security. Most are shares; the exceptions that matter for a dated
  // goal are the exchange-traded liquid, gilt and gold funds.
  const name = String(item.name || '').toLowerCase();
  if (GOLD.test(name)) return { cls: 'physical', tag: 'Gold ETF' };
  if (/liquid|gilt|\bbond\b|g-sec/.test(name)) return { cls: 'safe', tag: 'Debt ETF' };
  return { cls: 'growth', tag: 'Stock' };
}

/* ----------------------------- resolveEarmarks ---------------------------- */
// links: [{ id, goal_id, kind, ref_id, portion, portion_value }]
//   portion NULL/'all' — the whole item (what's left of it)
//           'amount'   — a fixed sum in the item's own currency
//           'percent'  — a share of the item's current value
// items: { 'account:3': { name, value, rate, currency, native, cls, tag } }
//   value is in base currency; rate converts the item's currency to base
// order: goal ids, highest priority first
//
// One item can fund several goals, so the claims on it are settled together:
// goals that asked for a specific amount or share are served first, in
// priority order, each capped by what the item still holds; a goal that took
// "all of it" then gets whatever remains. When the claims add up to more than
// the item is worth — a balance was spent, a fund fell — the lowest-priority
// claim is the one that comes up short, and it is reported as short rather
// than quietly trimmed.
export function resolveEarmarks({ links = [], items = {}, order = [] } = {}) {
  const rank = new Map(order.map((id, i) => [id, i]));
  const rankOf = (l) => (rank.has(l.goal_id) ? rank.get(l.goal_id) : Number.MAX_SAFE_INTEGER);

  const groups = new Map();
  for (const l of links) {
    const key = `${l.kind}:${l.ref_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }

  const byGoal = {};
  const usage = {};
  const goalEntry = (id) =>
    (byGoal[id] ||= { value: 0, in_pot: 0, count: 0, short: 0, items: [], mix: { safe: 0, growth: 0, physical: 0, unknown: 0 } });

  for (const [key, group] of groups) {
    const item = items[key];
    const value = item ? Math.max(0, num(item.value)) : 0;
    let left = value;
    group.sort((a, b) => rankOf(a) - rankOf(b) || num(a.id) - num(b.id));

    const partial = (l) => l.portion === 'amount' || l.portion === 'percent';
    const grants = new Map();
    for (const l of group.filter(partial)) {
      const requested =
        l.portion === 'amount'
          ? Math.max(0, num(l.portion_value)) * (item ? num(item.rate, 1) : 0)
          : (value * clamp(num(l.portion_value), 0, 100)) / 100;
      const granted = Math.min(requested, left);
      left -= granted;
      grants.set(l, { requested, granted });
    }
    const whole = group.filter((l) => !partial(l));
    for (const l of whole) {
      const share = left / whole.length;
      grants.set(l, { requested: share, granted: share, shared: whole.length > 1 });
    }
    if (whole.length) left = 0;

    // `explicit` is what the amount/percent claims took; `whole` is how many
    // goals hold "all of it" and so share whatever those claims left.
    const explicit = [...grants.values()].filter((g) => !('shared' in g)).reduce((s, g) => s + g.granted, 0);
    usage[key] = { value, taken: value - left, free: left, explicit, whole: whole.length, takers: [] };
    for (const l of group) {
      const g = grants.get(l);
      const short = Math.max(0, g.requested - g.granted);
      const e = goalEntry(l.goal_id);
      e.value += g.granted;
      e.count += 1;
      e.short += short;
      // Property never sat in the pot the plan spreads, so earmarking it funds
      // a goal without taking anything away from the others.
      if (l.kind !== 'asset') e.in_pot += g.granted;
      const cls = item?.cls || 'unknown';
      e.mix[cls] = (e.mix[cls] || 0) + g.granted;
      e.items.push({
        kind: l.kind,
        ref_id: l.ref_id,
        name: item?.name || '(removed)',
        tag: item?.tag || null,
        cls,
        currency: item?.currency || null,
        portion: partial(l) ? l.portion : 'all',
        portion_value: partial(l) ? num(l.portion_value) : null,
        requested: g.requested,
        granted: g.granted,
        short,
        shared: !!g.shared,
        missing: !item,
      });
      usage[key].takers.push({ goal_id: l.goal_id, granted: g.granted, explicit: partial(l) });
    }
  }

  for (const e of Object.values(byGoal)) e.items.sort((a, b) => b.granted - a.granted);
  return { byGoal, usage };
}

// How much of a goal's earmarked money is of each kind, as shares of the whole.
export function mixShares(mix = {}) {
  const total = Object.values(mix).reduce((s, v) => s + Math.max(0, num(v)), 0);
  if (!(total > 0)) return null;
  const pct = (k) => Math.round((Math.max(0, num(mix[k])) / total) * 100);
  return { safe: pct('safe'), growth: pct('growth'), physical: pct('physical'), unknown: pct('unknown') };
}
