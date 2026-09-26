// Goal plan — pure, no network and no server needed.
//   node test-goal-plan.mjs
//
// The promise the plan makes is that every rupee is counted once: what you own
// is split across goals without any goal claiming money another already has,
// and the monthly surplus is split the same way. Most of what's below is that
// promise, checked from several directions.
import {
  buildGoalPlan,
  monthsToReach,
  neededToday,
  orderGoals,
  projectValue,
  requiredMonthly,
  yearsUntil,
} from './src/services/goalPlan.js';

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
const near = (a, b, tol = 1) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const byId = (plan, id) => plan.goals.find((g) => g.id === id);
const sum = (xs) => xs.reduce((s, x) => s + (x ?? 0), 0);

// A fixed "today" so every date below means the same thing on every run.
const NOW = Date.parse('2026-09-24T00:00:00');

// Modelled on a real screen: ₹30.2L across investments and cash, a wedding in
// eight months, a house in fifteen, a business in four years.
const POT = { investments: 2500000, cash: 517972 };
const GOALS = [
  { id: 3, name: 'Business', type: 'CUSTOM', date: '2030-12-24', target: 20000000, r: 12, priority: null },
  { id: 1, name: 'Marriage', type: 'CUSTOM', date: '2027-05-24', target: 1000000, r: 7, priority: null },
  { id: 2, name: 'House', type: 'HOUSE', date: '2027-12-24', target: 10000000, r: 7, priority: null },
];
const plan = (over = {}) =>
  buildGoalPlan({ goals: GOALS, pot: POT, budget: { amount: 120000, source: 'set' }, nowMs: NOW, ...over });

/* ------------------------------- the maths -------------------------------- */
console.log('— the maths —');
ok(near(projectValue(neededToday(1000000, 7, 2), 0, 7, 2), 1000000, 0.01), 'what is needed today grows into the target by the date');
{
  const req = requiredMonthly(10000000, 2000000, 7, 1.25);
  ok(near(projectValue(2000000, req, 7, 1.25), 10000000, 0.5), 'the required monthly amount lands exactly on the target', String(req));
}
ok(requiredMonthly(1000000, 2000000, 7, 3) === 0, 'a goal already covered needs nothing a month');
ok(requiredMonthly(1000000, 0, 7, 0) === null, 'with no months left, no monthly figure can help');
ok(monthsToReach(0, 10000, 120000, 0) === 12, 'ten thousand a month reaches 1.2 lakh in twelve months at 0%');
ok(monthsToReach(0, 0, 100, 5) === null, 'nothing saved and nothing added never gets there');
ok(near(yearsUntil('2027-09-24', NOW), 1, 0.01), 'a year from today is one year');
ok(yearsUntil('2020-01-01', NOW) === 0, 'a past date is zero years away, never negative');

/* ------------------------------ the order --------------------------------- */
console.log('— the order —');
{
  const p = plan();
  ok(p.order.join() === '1,2,3', 'soonest deadline first', p.order.join());
  const withEmergency = orderGoals([...GOALS, { id: 9, type: 'EMERGENCY', date: '2035-01-01', target: 1 }]);
  ok(withEmergency[0].id === 9, 'an emergency fund goes first whatever its date');
  const custom = orderGoals([
    { ...GOALS[0], priority: 1 },
    { ...GOALS[1], priority: 3 },
    { ...GOALS[2], priority: 2 },
    { id: 7, type: 'CUSTOM', date: '2026-10-01', target: 5, priority: null },
  ]);
  ok(custom.map((g) => g.id).join() === '3,2,1,7', 'a custom order wins, and a goal added later joins the end', custom.map((g) => g.id).join());
}

/* ------------------------------ today's money ----------------------------- */
console.log("— today's money —");
{
  const p = plan();
  const marriage = byId(p, 1);
  const house = byId(p, 2);
  const business = byId(p, 3);
  const total = POT.investments + POT.cash;

  ok(near(marriage.funded_now, marriage.needed_today, 0.01), 'the first goal takes exactly what it still needs today');
  ok(marriage.funded_now < 1000000, 'a wedding eight months out needs a little less than its target today, since what is set aside keeps growing', String(marriage.funded_now));
  ok(marriage.status === 'funded' && marriage.required_monthly === 0, 'so it is covered and needs nothing a month', marriage.status);
  ok(near(house.from_pot, total - marriage.funded_now, 0.02), 'the house gets everything the wedding did not need', String(house.from_pot));
  ok(business.funded_now === 0, 'the business is next in line and gets nothing today');
  ok(near(sum(p.goals.map((g) => g.funded_now)), total, 0.05), 'every rupee counted once: the goals share exactly what you own', String(sum(p.goals.map((g) => g.funded_now))));
  ok(p.pot.unassigned === 0, 'nothing left unassigned while goals still need money');
}

/* ------------------------------ each month -------------------------------- */
console.log('— each month —');
{
  const p = plan();
  const [marriage, house, business] = [byId(p, 1), byId(p, 2), byId(p, 3)];
  ok(marriage.monthly_share === 0, 'a covered goal takes nothing from the monthly surplus');
  ok(house.monthly_share === 120000, 'the next goal takes all of it while it needs more', String(house.monthly_share));
  ok(house.status === 'behind' && near(house.extra_needed, house.required_monthly - 120000, 0.02), 'and says how much more a month it would take', String(house.extra_needed));
  ok(business.monthly_share === 0 && business.status === 'waiting', 'a goal the surplus never reaches is waiting, not failing', business.status);
  ok(p.monthly.left_over === 0 && near(p.monthly.shortfall, p.monthly.needed - 120000, 0.02), 'nothing left over, and the shortfall is the need minus the budget', JSON.stringify(p.monthly));
  ok(house.reached_on && house.reached_on > '2027-12-24', 'at this pace the house arrives later than planned, with a date', house.reached_on);
}
{
  const p = plan({ budget: { amount: 5000000, source: 'set' } });
  ok(p.goals.every((g) => ['funded', 'on_track'].includes(g.status)), 'with enough each month, every goal is on track', p.goals.map((g) => g.status).join());
  ok(near(p.monthly.left_over, 5000000 - p.monthly.needed, 0.05), 'and what is left over is the budget minus the need', String(p.monthly.left_over));
  const house = byId(p, 2);
  ok(near(house.projected_value, 10000000, 1), 'an on-track goal is projected to land on its target', String(house.projected_value));
}
{
  const p = plan({ budget: { amount: -5000, source: 'measured' } });
  ok(p.monthly.amount === 0 && p.monthly.left_over === 0, 'spending more than you earn leaves nothing for goals, never a negative share');
}
{
  const p = plan({ budget: null });
  ok(p.monthly.left_over === null && p.monthly.shortfall === null, 'with no monthly figure, the plan does not pretend to know the shortfall');
  ok(byId(p, 2).status === 'unknown' && byId(p, 2).required_monthly > 0, 'goals still say what they need a month', byId(p, 2).status);
}

/* ------------------------------- earmarks --------------------------------- */
console.log('— earmarks —');
{
  const p = plan({ earmarks: { 3: { value: 500000, in_pot: 500000 } } });
  ok(p.pot.shared === POT.investments + POT.cash - 500000, 'earmarked investments leave the shared pot');
  ok(byId(p, 3).funded_now === 500000 && byId(p, 3).earmarked === 500000, 'and fund their own goal first');
  ok(near(sum(p.goals.map((g) => g.funded_now)), POT.investments + POT.cash, 0.05), 'still no rupee counted twice');
}
{
  const p = plan({ earmarks: { 3: { value: 5000000, in_pot: 0 } } });
  ok(p.pot.shared === POT.investments + POT.cash, 'a linked property funds its goal without touching the pot');
  ok(byId(p, 3).funded_now === 5000000, 'and counts in full for that goal');
}

/* ------------------------------- edge cases ------------------------------- */
console.log('— edge cases —');
{
  const p = buildGoalPlan({ goals: GOALS, pot: { investments: 50000000, cash: 0 }, budget: { amount: 0, source: 'set' }, nowMs: NOW });
  ok(p.goals.every((g) => g.status === 'funded') && p.pot.unassigned > 0, 'money beyond what every goal needs stays unassigned', String(p.pot.unassigned));
}
{
  const p = buildGoalPlan({
    goals: [{ id: 5, type: 'CUSTOM', date: '2026-01-01', target: 100000, r: 7 }],
    pot: { investments: 20000, cash: 0 },
    budget: { amount: 50000, source: 'set' },
    nowMs: NOW,
  });
  const g = p.goals[0];
  ok(g.status === 'overdue' && g.required_monthly === null && g.monthly_share === null, 'a missed date is overdue and does not eat the monthly budget', g.status);
  ok(p.monthly.left_over === 50000, 'so the whole budget stays free');
}
{
  const p = buildGoalPlan({ goals: [], pot: POT, budget: { amount: 1000, source: 'set' }, nowMs: NOW });
  ok(p.goals.length === 0 && p.pot.unassigned === POT.investments + POT.cash, 'no goals: everything is unassigned');
}
{
  const p = buildGoalPlan({ goals: GOALS, pot: { investments: -100, cash: -900 }, budget: null, nowMs: NOW });
  ok(p.pot.total === 0 && p.goals.every((g) => g.funded_now === 0), 'an overdrawn pot funds nothing rather than going negative');
}
ok(!/NaN|Infinity|undefined/.test(JSON.stringify(plan())), 'the plan serialises with no NaN, Infinity or undefined');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
