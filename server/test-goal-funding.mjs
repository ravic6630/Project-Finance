// Goal funding — pure, no network and no server needed.
//   node test-goal-funding.mjs
//
// When a goal is funded by named investments, what it shows has to be exactly
// what those investments are worth — that is the whole point of naming them.
// So the two things checked here are that an item is never handed out for more
// than it holds, however many goals claim it, and that each kind of money is
// recognised for what it is.
import { classify, mixShares, resolveEarmarks } from './src/services/goalFunding.js';

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
const fund = (category, name) => classify({ kind: 'holding', holding_kind: 'IN_MF', category, name });
const is = (c, cls, tag) => c.cls === cls && c.tag === tag;

/* ------------------------------ what it is -------------------------------- */
console.log('— what kind of money it is —');
ok(is(classify({ kind: 'account', type: 'BANK' }), 'safe', 'Bank account'), 'a bank account is safe money');
ok(is(classify({ kind: 'account', type: 'FD' }), 'safe', 'Fixed deposit'), 'so is a fixed deposit');
ok(is(classify({ kind: 'asset', type: 'GOLD' }), 'physical', 'Gold'), 'gold has to be sold first');
ok(classify({ kind: 'asset', type: 'PROPERTY' }).cls === 'physical', 'and so does property');
ok(is(classify({ kind: 'holding', holding_kind: 'IN_STOCK', name: 'Reliance Industries Limited' }), 'growth', 'Stock'), 'a share can be down on the day');
ok(is(classify({ kind: 'holding', holding_kind: 'US_STOCK', name: 'Apple Inc.' }), 'growth', 'Stock'), 'in any market');
ok(is(classify({ kind: 'holding', holding_kind: 'IN_STOCK', name: 'Nippon India ETF Gold BeES' }), 'physical', 'Gold ETF'), 'a listed gold fund is not a share');
ok(is(classify({ kind: 'holding', holding_kind: 'IN_STOCK', name: 'Nippon India ETF Liquid BeES' }), 'safe', 'Debt ETF'), 'nor is a listed liquid fund');

ok(is(fund('Debt Scheme - Liquid Fund', 'HDFC Liquid Fund - Direct Plan - Growth'), 'safe', 'Liquid fund'), 'a liquid fund is safe — "Growth" in its plan name does not make it equity', JSON.stringify(fund('Debt Scheme - Liquid Fund', 'HDFC Liquid Fund - Direct Plan - Growth')));
ok(is(fund('Debt Scheme - Short Duration Fund', 'ICICI Prudential Short Term Fund'), 'safe', 'Short-term debt fund'), 'a short-duration fund is named as one');
ok(is(fund('Debt Scheme - Corporate Bond Fund', 'Kotak Corporate Bond Fund'), 'safe', 'Debt fund'), 'other debt funds are debt funds');
ok(is(fund('Equity Scheme - Flexi Cap Fund', 'Parag Parikh Flexi Cap Fund'), 'growth', 'Equity fund'), 'an equity fund is growth money');
ok(is(fund('Equity Scheme - ELSS', 'Axis Long Term Equity Fund'), 'growth', 'Equity fund'), 'including tax-saver funds');
ok(is(fund('Hybrid Scheme - Aggressive Hybrid Fund', 'SBI Equity Hybrid Fund'), 'growth', 'Hybrid fund'), 'a hybrid fund is growth money');
ok(is(fund('Hybrid Scheme - Arbitrage Fund', 'Kotak Equity Arbitrage Fund'), 'safe', 'Arbitrage fund'), 'but an arbitrage fund behaves like short-term debt', JSON.stringify(fund('Hybrid Scheme - Arbitrage Fund', 'Kotak Equity Arbitrage Fund')));
ok(is(fund('Other Scheme - Index Funds', 'UTI Nifty 50 Index Fund'), 'growth', 'Index fund'), 'a share index fund is growth money');
ok(is(fund('Other Scheme - Index Funds', 'Edelweiss NIFTY PSU Bond Plus SDL Apr 2027 Index Fund'), 'safe', 'Debt fund'), 'a bond index fund in the same AMFI bucket is read from its name', JSON.stringify(fund('Other Scheme - Index Funds', 'Edelweiss NIFTY PSU Bond Plus SDL Apr 2027 Index Fund')));
ok(is(fund('Other Scheme - FoF Domestic', 'HDFC Gold Fund'), 'physical', 'Gold fund'), 'a gold fund is gold');
ok(is(fund('', 'SBI Magnum Gilt Fund - Regular Plan'), 'safe', 'Debt fund'), 'with no category at all, the name is read');
ok(is(fund('', 'Some Opportunities Fund - Direct - Growth'), 'unknown', 'Mutual fund'), 'and a name that says nothing is left unknown, not guessed', JSON.stringify(fund('', 'Some Opportunities Fund - Direct - Growth')));
ok(is(fund('Liquid', 'Old Liquid Plan'), 'safe', 'Liquid fund') && is(fund('ELSS', 'Old Tax Plan'), 'growth', 'Equity fund'), 'the older one-word categories still read');

/* ------------------------------ who gets what ----------------------------- */
console.log('— who gets what —');
const ITEMS = {
  'account:1': { name: 'HDFC Savings', value: 330000, native: 330000, rate: 1, currency: 'INR', cls: 'safe', tag: 'Bank account' },
  'account:2': { name: 'Dollar account', value: 90000, native: 1000, rate: 90, currency: 'USD', cls: 'safe', tag: 'Bank account' },
  'holding:10': { name: 'HDFC Liquid Fund', value: 320000, native: 320000, rate: 1, currency: 'INR', cls: 'safe', tag: 'Liquid fund' },
  'holding:11': { name: 'Flexi Cap Fund', value: 800000, native: 800000, rate: 1, currency: 'INR', cls: 'growth', tag: 'Equity fund' },
  'asset:5': { name: 'Gold', value: 500000, native: 500000, rate: 1, currency: 'INR', cls: 'physical', tag: 'Gold' },
  'account:9': { name: 'Overdrawn', value: -500, native: -500, rate: 1, currency: 'INR', cls: 'safe', tag: 'Bank account' },
};
// 1 = Marriage (soonest), 2 = House, 3 = Business
const ORDER = [1, 2, 3];
let nextId = 1;
const link = (goal_id, key, portion = null, portion_value = null) => {
  const [kind, ref] = key.split(':');
  return { id: nextId++, goal_id, kind, ref_id: Number(ref), portion, portion_value };
};
const resolve = (links, order = ORDER) => resolveEarmarks({ links, items: ITEMS, order });

{
  // The scenario this was built for: a liquid fund and part of a bank balance.
  const r = resolve([link(1, 'holding:10'), link(1, 'account:1', 'amount', 200000)]);
  const g = r.byGoal[1];
  ok(g.value === 520000 && g.in_pot === 520000 && g.count === 2, 'a liquid fund plus ₹2 lakh of a bank account is ₹5.2 lakh, exactly', JSON.stringify(g.value));
  ok(r.usage['account:1'].free === 130000 && r.usage['account:1'].taken === 200000, 'the rest of the account stays free for everything else');
  ok(g.short === 0 && g.items.every((i) => !i.missing), 'nothing is short');
  ok(g.items[0].name === 'HDFC Liquid Fund' && g.items[0].portion === 'all', 'the largest piece is listed first, as a whole item');
  ok(g.items[1].portion === 'amount' && g.items[1].portion_value === 200000, 'and the bank piece as the amount that was set');
  const mix = mixShares(g.mix);
  ok(mix.safe === 100 && mix.growth === 0, 'all of it is safe money', JSON.stringify(mix));
}
{
  const r = resolve([link(2, 'holding:11', 'percent', 50)]);
  ok(r.byGoal[2].value === 400000 && r.usage['holding:11'].free === 400000, 'half a fund is half its value today');
}
{
  const r = resolve([link(1, 'account:2', 'amount', 500)]);
  ok(near(r.byGoal[1].value, 45000), 'an amount is in the item’s own currency: $500 of a dollar account', String(r.byGoal[1].value));
}
{
  const r = resolve([link(1, 'account:1', 'amount', 500000)]);
  const g = r.byGoal[1];
  ok(g.value === 330000 && g.short === 170000, 'more than the account holds gives what it holds, and reports the rest as short', JSON.stringify([g.value, g.short]));
}
{
  const links = [link(2, 'account:1', 'amount', 200000), link(1, 'account:1', 'amount', 250000)];
  const r = resolve(links);
  ok(r.byGoal[1].value === 250000 && r.byGoal[2].value === 80000 && r.byGoal[2].short === 120000, 'two goals over-claiming one account: the higher priority is served first', JSON.stringify([r.byGoal[1].value, r.byGoal[2].value]));
  const flipped = resolve(links, [2, 1, 3]);
  ok(flipped.byGoal[2].value === 200000 && flipped.byGoal[1].value === 130000, 'and reordering the goals changes who comes up short');
  ok(r.usage['account:1'].taken === 330000 && r.usage['account:1'].free === 0, 'never more than the account holds in total');
}
{
  const r = resolve([link(3, 'account:1'), link(1, 'account:1', 'amount', 200000)]);
  ok(r.byGoal[1].value === 200000 && r.byGoal[3].value === 130000 && r.byGoal[3].short === 0, '"all of it" beside a fixed amount means all of what is left — and that is not a shortfall');
}
{
  const r = resolve([link(1, 'holding:11'), link(2, 'holding:11')]);
  ok(r.byGoal[1].value === 400000 && r.byGoal[2].value === 400000 && r.byGoal[1].items[0].shared, 'two goals each taking "all" of one item share it, and are told so');
}
{
  const r = resolve([link(1, 'asset:5')]);
  ok(r.byGoal[1].value === 500000 && r.byGoal[1].in_pot === 0, 'earmarked gold counts for its goal without having been in the pot');
  ok(mixShares(r.byGoal[1].mix).physical === 100, 'and is recognised as something that must be sold');
}
{
  const r = resolve([link(1, 'holding:999', 'amount', 5000), link(1, 'account:9')]);
  const g = r.byGoal[1];
  ok(g.value === 0 && g.items.some((i) => i.missing), 'a removed item gives nothing and is marked missing');
  ok(g.items.every((i) => i.granted === 0), 'and an overdrawn account cannot fund anything');
  ok(mixShares(g.mix) === null, 'with nothing funded there is no mix to describe');
}
{
  // Many claims of every kind on every item: the invariant that matters.
  const links = [];
  for (const goal of [1, 2, 3]) {
    links.push(link(goal, 'account:1', 'amount', 150000));
    links.push(link(goal, 'holding:10', 'percent', 60));
    links.push(link(goal, 'holding:11'));
    links.push(link(goal, 'account:2', 'amount', 800));
  }
  const r = resolve(links);
  const overdrawn = Object.entries(r.usage).filter(([key, u]) => u.taken > Math.max(0, ITEMS[key].value) + 1e-6);
  ok(overdrawn.length === 0, 'however the claims pile up, no item is handed out for more than it is worth', JSON.stringify(overdrawn));
  const total = Object.values(r.byGoal).reduce((s, g) => s + g.value, 0);
  const worth = 330000 + 320000 + 800000 + 90000;
  ok(near(total, worth), 'and what the goals hold adds up to exactly what those items are worth', `${total} vs ${worth}`);
  ok(!/NaN|Infinity|undefined/.test(JSON.stringify(r)), 'the result serialises with no NaN, Infinity or undefined');
}
ok(Object.keys(resolveEarmarks().byGoal).length === 0, 'no links, no earmarks');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
