import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired, requirePremium } from '../auth.js';
import { asyncHandler, bad, HttpError, num, oneOf, str } from '../util.js';
import { buildGoalPlan } from '../services/goalPlan.js';
import { measureCashflow } from '../services/insights/fi.js';
import { getFxRate } from '../services/prices.js';
import { buildSummary } from '../services/summary.js';
import { CURRENCIES } from '../markets.js';

export const goalsRouter = Router();
goalsRouter.use(authRequired);
goalsRouter.use(requirePremium); // Goals & projections is a premium feature.

const TYPES = ['RETIREMENT', 'HOUSE', 'EDUCATION', 'CAR', 'TRAVEL', 'EMERGENCY', 'WEALTH', 'CUSTOM'];

function readBody(body, defaultCurrency = 'INR') {
  const name = str(body.name);
  if (!name) throw bad('Goal name is required');
  const targetAmount = num(body.target_amount ?? 0, 'target_amount');
  if (targetAmount <= 0) throw bad('Target amount must be greater than 0');
  return {
    name,
    type: body.type ? oneOf(String(body.type).toUpperCase(), TYPES, 'type') : 'CUSTOM',
    targetAmount,
    targetDate: str(body.target_date) || null,
    currentAmount: num(body.current_amount ?? 0, 'current_amount'),
    monthly: num(body.monthly_contribution ?? 0, 'monthly_contribution'),
    expectedReturn: num(body.expected_return ?? 12, 'expected_return'),
    currency: body.currency ? oneOf(String(body.currency).toUpperCase(), CURRENCIES, 'currency') : defaultCurrency,
  };
}

const list = db.prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY target_date IS NULL, target_date, id');
const getOne = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?');
const insert = db.prepare(`
  INSERT INTO goals
    (user_id, name, type, target_amount, target_date, current_amount, monthly_contribution, expected_return, currency, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const update = db.prepare(`
  UPDATE goals SET
    name = ?, type = ?, target_amount = ?, target_date = ?, current_amount = ?,
    monthly_contribution = ?, expected_return = ?, currency = ?, updated_at = ?
  WHERE id = ? AND user_id = ?
`);
const remove = db.prepare('DELETE FROM goals WHERE id = ? AND user_id = ?');
const clearPriorities = db.prepare('UPDATE goals SET priority = NULL WHERE user_id = ?');
const setPriority = db.prepare('UPDATE goals SET priority = ? WHERE id = ? AND user_id = ?');

const getPrefs = db.prepare('SELECT * FROM goal_prefs WHERE user_id = ?');
const upsertPrefs = db.prepare(`
  INSERT INTO goal_prefs (user_id, monthly_budget, monthly_budget_currency, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    monthly_budget          = excluded.monthly_budget,
    monthly_budget_currency = excluded.monthly_budget_currency,
    updated_at              = excluded.updated_at
`);

const listLinks = db.prepare('SELECT * FROM goal_links WHERE user_id = ? ORDER BY id');
const linksForGoal = db.prepare('SELECT * FROM goal_links WHERE goal_id = ? AND user_id = ? ORDER BY id');
const clearLinks = db.prepare('DELETE FROM goal_links WHERE goal_id = ? AND user_id = ?');
const insertLink = db.prepare(
  'INSERT OR IGNORE INTO goal_links (user_id, goal_id, kind, ref_id, created_at) VALUES (?, ?, ?, ?, ?)'
);

const LINK_KINDS = ['holding', 'account', 'asset'];

// Current value (in the user's base currency) of every linkable item, one
// batch: holdings from the already-priced summary items, accounts and assets
// via FX. Returns { 'holding:12': {name, value}, 'account:3': …, 'asset:7': … }.
async function linkableValues(user, items) {
  const base = user.base_currency;
  const [accounts, assets] = await Promise.all([
    db.prepare('SELECT * FROM cash_accounts WHERE user_id = ?').all(user.id),
    db.prepare('SELECT * FROM assets WHERE user_id = ?').all(user.id),
  ]);
  const values = {};
  for (const h of items || []) values[`holding:${h.id}`] = { name: h.name, value: h.market_value_base || 0 };
  const fx = { [base]: 1 };
  const rate = async (c) => {
    if (fx[c] == null) fx[c] = await getFxRate(c, base);
    return fx[c];
  };
  for (const a of accounts) values[`account:${a.id}`] = { name: a.name, value: a.balance * (await rate(a.currency)) };
  for (const a of assets) values[`asset:${a.id}`] = { name: a.name, value: a.value * (await rate(a.currency)) };
  return values;
}

// What each goal has earmarked through its links: { [goalId]: { value, in_pot,
// count } }. An item linked to two goals is shared between them rather than
// counted in full by both, and `in_pot` is the part that came out of
// investments or cash — a linked property funds its goal without ever having
// been in the pot the plan spreads.
async function earmarksFor(user, goalIds, items) {
  const links = (await listLinks.all(user.id)).filter((l) => goalIds.includes(l.goal_id));
  if (!links.length) return {};
  const values = await linkableValues(user, items);
  const sharers = {};
  for (const l of links) sharers[`${l.kind}:${l.ref_id}`] = (sharers[`${l.kind}:${l.ref_id}`] || 0) + 1;
  const out = {};
  for (const l of links) {
    const key = `${l.kind}:${l.ref_id}`;
    // A deleted item counts 0; an overdrawn account can't fund anything.
    const value = values[key] ? Math.max(0, values[key].value) / sharers[key] : 0;
    const e = (out[l.goal_id] ||= { value: 0, in_pot: 0, count: 0 });
    e.value += value;
    e.count += 1;
    if (l.kind !== 'asset') e.in_pot += value;
  }
  return out;
}

// Goals are stored in their own currency but planned in the user's base
// currency, like everything else on the page.
async function ratesFor(goals, base) {
  const rates = {};
  await Promise.all(
    [...new Set([base, ...goals.map((g) => g.currency || 'INR')])].map(async (c) => {
      rates[c] = await getFxRate(c, base);
    })
  );
  return rates;
}

// How much a month there is to put toward goals, and where that figure came
// from — in this order:
//   'set'      — the amount the user typed (converted if they typed it in
//                another currency);
//   'measured' — income minus spending, averaged across the months with
//                recorded spending, the same measurement Insights uses. Two
//                months at least, and income must actually be recorded: a
//                ledger of spending alone would read as "nothing to spare";
//   'goals'    — the monthly amounts typed on the goals themselves before the
//                plan existed, so an existing plan doesn't vanish;
//   'none'     — nothing to go on; the page asks.
// The measurement rides along even when unused, so the page can offer it.
async function monthlyBudget(prefs, summary, rows, rates, base) {
  const m = measureCashflow(summary);
  const measured = m.months
    ? { months: m.months, income: m.monthly_income, spend: m.monthly_spend, surplus: m.monthly_surplus, from: m.from, to: m.to }
    : null;
  if (prefs?.monthly_budget != null) {
    const currency = prefs.monthly_budget_currency || base;
    const rate = currency === base ? 1 : await getFxRate(currency, base);
    return {
      amount: prefs.monthly_budget * rate,
      source: 'set',
      entered: currency === base ? null : { amount: prefs.monthly_budget, currency },
      measured,
    };
  }
  if (m.months >= 2 && m.monthly_income > 0) return { amount: m.monthly_surplus, source: 'measured', measured };
  const typed = rows.reduce((s, g) => s + (Number(g.monthly_contribution) || 0) * (rates[g.currency || 'INR'] ?? 1), 0);
  if (typed > 0) return { amount: typed, source: 'goals', measured };
  return { amount: null, source: 'none', measured };
}

// One goal as the API returns it: the stored row, its amounts in base currency,
// its place in the plan — and the older `projection` shape, filled from the
// plan so an app build that predates it shows the same numbers.
function present(g, base, rates, earmark, p) {
  const target = (Number(g.target_amount) || 0) * (rates[g.currency || 'INR'] ?? 1);
  return {
    ...g,
    base_currency: base,
    target_amount_base: target,
    current_amount_base: p.funded_now,
    monthly_contribution_base: p.monthly_share ?? 0,
    links_count: earmark ? earmark.count : 0,
    plan: p,
    projection: {
      years_to_target: p.years_left,
      projected_value: Math.round(p.projected_value),
      on_track: p.status === 'funded' || p.status === 'on_track',
      shortfall: Math.max(0, Math.round(target - p.projected_value)),
      required_monthly: p.required_monthly == null ? null : Math.round(p.required_monthly),
      saved_pct: Math.round(p.funded_pct),
      projected_pct: Math.round(p.projected_pct),
    },
  };
}

// The whole plan for one user. Every goal's numbers depend on the others —
// money one goal takes is money the next can't — so even a single-goal
// response is read out of the full plan.
async function planFor(user) {
  const base = user.base_currency;
  const [rows, summary, prefs] = await Promise.all([
    list.all(user.id),
    buildSummary(user, { scope: null, withItems: true }),
    getPrefs.get(user.id),
  ]);
  const rates = await ratesFor(rows, base);
  const earmarks = await earmarksFor(user, rows.map((g) => g.id), summary.items);
  const budget = await monthlyBudget(prefs, summary, rows, rates, base);

  const plan = buildGoalPlan({
    goals: rows.map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      date: g.target_date,
      target: (Number(g.target_amount) || 0) * (rates[g.currency || 'INR'] ?? 1),
      r: Number(g.expected_return) || 0,
      priority: g.priority,
    })),
    pot: { investments: summary.investments.value, cash: summary.cash.total },
    earmarks,
    budget,
  });

  const byId = new Map(rows.map((g) => [g.id, g]));
  const { goals: plans, ...overview } = plan;
  return {
    goals: plans.map((p) => present(byId.get(p.id), base, rates, earmarks[p.id], p)),
    plan: {
      ...overview,
      // Shown beside the pot so its size needs no explaining.
      property_excluded: summary.assets.total > 0 ? summary.assets.total : 0,
      // Amounts typed on goals before the plan existed are no longer counted;
      // the page says so once, so nobody wonders where their figure went.
      legacy_saved: rows.some((g) => Number(g.current_amount) > 0 && !earmarks[g.id]),
    },
    base_currency: base,
  };
}

const oneFromPlan = async (user, id) => (await planFor(user)).goals.find((g) => g.id === Number(id));

goalsRouter.get(
  '/',
  asyncHandler(async (req, res) => res.json(await planFor(req.user)))
);

// The monthly amount for goals, set by hand — or null to go back to measuring
// it. Stored in the currency the user is viewing, like every typed amount.
goalsRouter.put(
  '/plan',
  asyncHandler(async (req, res) => {
    const raw = req.body.monthly_budget;
    let amount = null;
    if (raw !== undefined && raw !== null && raw !== '') {
      amount = num(raw, 'monthly_budget');
      if (amount < 0) throw bad('The monthly amount for goals cannot be negative');
      if (amount > 1e13) throw bad('That monthly amount is too large to plan with');
    }
    await upsertPrefs.run(req.user.id, amount, amount == null ? null : req.user.base_currency, now());
    res.json(await planFor(req.user));
  })
);

// The user's own order for their goals — or null to go back to the automatic
// one. Goals left out of the list follow the ones in it.
goalsRouter.put(
  '/order',
  asyncHandler(async (req, res) => {
    const ids = req.body.ids;
    await clearPriorities.run(req.user.id);
    if (ids !== null) {
      if (!Array.isArray(ids) || !ids.length) throw bad('ids must be a list of goal ids, or null');
      const mine = new Set((await list.all(req.user.id)).map((g) => g.id));
      const clean = [...new Set(ids.map(Number))];
      if (!clean.every((id) => mine.has(id))) throw bad("One of those goals doesn't exist");
      for (const [i, id] of clean.entries()) await setPriority.run(i + 1, id, req.user.id);
    }
    res.json(await planFor(req.user));
  })
);

goalsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = readBody(req.body, req.user.base_currency);
    const ts = now();
    const info = await insert.run(
      req.user.id, b.name, b.type, b.targetAmount, b.targetDate, b.currentAmount,
      b.monthly, b.expectedReturn, b.currency, ts, ts
    );
    res.status(201).json({ goal: await oneFromPlan(req.user, Number(info.lastInsertRowid)) });
  })
);

goalsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await getOne.get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'Goal not found');
    const b = readBody({ ...existing, ...req.body }, existing.currency);
    await update.run(
      b.name, b.type, b.targetAmount, b.targetDate, b.currentAmount,
      b.monthly, b.expectedReturn, b.currency, now(), req.params.id, req.user.id
    );
    res.json({ goal: await oneFromPlan(req.user, req.params.id) });
  })
);

goalsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const info = await remove.run(req.params.id, req.user.id);
    if (!info.changes) throw new HttpError(404, 'Goal not found');
    await clearLinks.run(req.params.id, req.user.id);
    res.json({ ok: true });
  })
);

// The goal's linked items, valued live — feeds the picker in the edit form.
goalsRouter.get(
  '/:id/links',
  asyncHandler(async (req, res) => {
    const goal = await getOne.get(req.params.id, req.user.id);
    if (!goal) throw new HttpError(404, 'Goal not found');
    const links = await linksForGoal.all(req.params.id, req.user.id);
    const items = links.some((l) => l.kind === 'holding')
      ? (await buildSummary(req.user, { scope: null, withItems: true })).items
      : [];
    const values = links.length ? await linkableValues(req.user, items) : {};
    res.json({
      links: links.map((l) => {
        const v = values[`${l.kind}:${l.ref_id}`];
        return { kind: l.kind, ref_id: l.ref_id, name: v?.name || '(removed)', value_base: v?.value || 0 };
      }),
      base_currency: req.user.base_currency,
    });
  })
);

// Replace the goal's links wholesale (the picker sends its full selection).
// Every reference must belong to the caller.
goalsRouter.put(
  '/:id/links',
  asyncHandler(async (req, res) => {
    const goal = await getOne.get(req.params.id, req.user.id);
    if (!goal) throw new HttpError(404, 'Goal not found');
    const raw = Array.isArray(req.body.links) ? req.body.links.slice(0, 100) : [];
    const wanted = [];
    for (const l of raw) {
      const kind = oneOf(String(l.kind || ''), LINK_KINDS, 'kind');
      const refId = Number(l.ref_id);
      if (!Number.isInteger(refId) || refId <= 0) throw bad('ref_id must be a positive integer');
      wanted.push({ kind, refId });
    }
    // Ownership check per kind in one query each.
    const tables = { holding: 'holdings', account: 'cash_accounts', asset: 'assets' };
    for (const kind of LINK_KINDS) {
      const ids = wanted.filter((w) => w.kind === kind).map((w) => w.refId);
      if (!ids.length) continue;
      const rows = await db
        .prepare(`SELECT id FROM ${tables[kind]} WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
        .all(req.user.id, ...ids);
      if (rows.length !== new Set(ids).size) throw bad(`One of the linked ${kind}s doesn't exist`);
    }
    await clearLinks.run(req.params.id, req.user.id);
    const ts = now();
    for (const w of wanted) await insertLink.run(req.user.id, req.params.id, w.kind, w.refId, ts);
    res.json({ goal: await oneFromPlan(req.user, req.params.id) });
  })
);
