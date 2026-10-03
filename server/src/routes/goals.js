import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired, requirePremium } from '../auth.js';
import { asyncHandler, bad, HttpError, num, oneOf, str } from '../util.js';
import { buildGoalPlan, neededToday, orderGoals, yearsUntil } from '../services/goalPlan.js';
import { classify, mixShares, resolveEarmarks } from '../services/goalFunding.js';
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
  'INSERT OR IGNORE INTO goal_links (user_id, goal_id, kind, ref_id, portion, portion_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);

const LINK_KINDS = ['holding', 'account', 'asset'];
const PORTIONS = ['all', 'amount', 'percent'];

// Everything a goal can be funded from, valued now. Holdings come from the
// already-priced summary; accounts and assets are converted here. For each:
//   value    — in the user's base currency
//   native   — in the item's own currency, with `rate` converting it to base
//              (a fixed-amount earmark is stored in the item's own currency)
//   cls/tag  — what kind of money it is (goalFunding.classify)
// Keyed 'holding:12' / 'account:3' / 'asset:7'.
async function fundableItems(user, summary) {
  const base = user.base_currency;
  const [accounts, assets] = await Promise.all([
    db.prepare('SELECT * FROM cash_accounts WHERE user_id = ?').all(user.id),
    db.prepare('SELECT * FROM assets WHERE user_id = ?').all(user.id),
  ]);
  const fx = { [base]: 1 };
  const rate = async (c) => {
    if (fx[c] == null) fx[c] = await getFxRate(c, base);
    return fx[c];
  };

  const items = {};
  for (const h of summary.items || []) {
    const value = h.market_value_base || 0;
    // Unpriced holdings fall back to cost, which is in the holding's currency.
    const native = h.market_value != null ? h.market_value : h.cost_value;
    const currency = h.market_value != null ? h.price_currency : h.currency;
    items[`holding:${h.id}`] = {
      kind: 'holding',
      ref_id: h.id,
      name: h.name,
      value,
      native,
      currency,
      rate: native > 0 ? value / native : await rate(currency),
      ...classify({ kind: 'holding', holding_kind: h.kind, category: h.category, name: h.name }),
    };
  }
  for (const a of accounts) {
    const r = await rate(a.currency);
    items[`account:${a.id}`] = {
      kind: 'account',
      ref_id: a.id,
      name: a.name,
      value: a.balance * r,
      native: a.balance,
      currency: a.currency,
      rate: r,
      ...classify({ kind: 'account', type: a.type }),
    };
  }
  for (const a of assets) {
    const r = await rate(a.currency);
    items[`asset:${a.id}`] = {
      kind: 'asset',
      ref_id: a.id,
      name: a.name,
      value: a.value * r,
      native: a.value,
      currency: a.currency,
      rate: r,
      ...classify({ kind: 'asset', type: a.type }),
    };
  }
  return items;
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

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// One goal as the API returns it: the stored row, its amounts in base currency,
// its place in the plan, what funds it — and the older `projection` shape,
// filled from the plan so an app build that predates it shows the same numbers.
function present(g, base, rates, earmark, p) {
  const target = (Number(g.target_amount) || 0) * (rates[g.currency || 'INR'] ?? 1);
  return {
    ...g,
    base_currency: base,
    target_amount_base: target,
    current_amount_base: p.funded_now,
    monthly_contribution_base: p.monthly_share ?? 0,
    links_count: earmark ? earmark.count : 0,
    // 'chosen' — the named items below, and only those; 'auto' — a share of
    // whatever isn't spoken for. `short` is what the chosen items could no
    // longer deliver (a balance was spent, another goal ranks ahead).
    funding: earmark
      ? {
          mode: 'chosen',
          items: earmark.items.map((i) => ({
            ...i,
            requested: round2(i.requested),
            granted: round2(i.granted),
            short: round2(i.short),
          })),
          short: round2(earmark.short),
          mix: mixShares(earmark.mix),
        }
      : { mode: 'auto', items: [], short: 0, mix: null },
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

// Everything the plan and the funding picker both need: the goals (as the plan
// reads them), what the user owns, and the links between the two.
async function fundingContext(user) {
  const base = user.base_currency;
  const [rows, summary, prefs, allLinks] = await Promise.all([
    list.all(user.id),
    buildSummary(user, { scope: null, withItems: true }),
    getPrefs.get(user.id),
    listLinks.all(user.id),
  ]);
  const rates = await ratesFor(rows, base);
  const planGoals = rows.map((g) => ({
    id: g.id,
    name: g.name,
    type: g.type,
    date: g.target_date,
    target: (Number(g.target_amount) || 0) * (rates[g.currency || 'INR'] ?? 1),
    r: Number(g.expected_return) || 0,
    priority: g.priority,
  }));
  const ids = new Set(rows.map((g) => g.id));
  const items = await fundableItems(user, summary);
  return {
    base,
    rows,
    summary,
    prefs,
    rates,
    planGoals,
    // A link to something that no longer exists is not a choice any more. It is
    // dropped here rather than counted as zero, because a goal funded by named
    // items is never topped up: left in, a goal whose one chosen account was
    // later closed would sit at nothing for ever. Dropped, it goes back to
    // filling automatically until the user chooses again.
    links: allLinks.filter((l) => ids.has(l.goal_id) && items[`${l.kind}:${l.ref_id}`]),
    items,
    // Claims on a shared item are settled in the same order the plan uses.
    order: orderGoals(planGoals).map((g) => g.id),
  };
}

// The whole plan for one user. Every goal's numbers depend on the others —
// money one goal takes is money the next can't — so even a single-goal
// response is read out of the full plan.
async function planFor(user) {
  const ctx = await fundingContext(user);
  const { base, rows, summary, rates } = ctx;
  const earmarks = resolveEarmarks(ctx).byGoal;
  const budget = await monthlyBudget(ctx.prefs, summary, rows, rates, base);

  const plan = buildGoalPlan({
    goals: ctx.planGoals,
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
      // Property or gold a goal has been given by name counts for that goal
      // even though it was never part of the pot.
      earmarked_outside: round2(Object.values(earmarks).reduce((s, e) => s + (e.value - e.in_pot), 0)),
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

const portionOf = (l) => (l.portion === 'amount' || l.portion === 'percent' ? l.portion : 'all');
const KIND_ORDER = { holding: 0, account: 1, asset: 2 };

// Everything this goal could be funded from — each investment, account and
// asset with what it's worth, what kind of money it is, how much of it other
// goals have already claimed, and what this goal has chosen so far.
goalsRouter.get(
  '/:id/funding',
  asyncHandler(async (req, res) => {
    const ctx = await fundingContext(req.user);
    const id = Number(req.params.id);
    const goal = ctx.planGoals.find((g) => g.id === id);
    if (!goal) throw new HttpError(404, 'Goal not found');
    const row = ctx.rows.find((g) => g.id === id);
    const mine = new Map(ctx.links.filter((l) => l.goal_id === id).map((l) => [`${l.kind}:${l.ref_id}`, l]));
    // Settled WITHOUT this goal's own claims: what the others take is what
    // this goal is choosing around.
    const others = resolveEarmarks({ ...ctx, links: ctx.links.filter((l) => l.goal_id !== id) }).usage;
    const names = new Map(ctx.rows.map((g) => [g.id, g.name]));
    const years = yearsUntil(goal.date);
    // Fixed claims are served in priority order, so the ones that outrank this
    // goal are money it cannot have; the ones below it are money it would be
    // taking. The picker says which is which instead of guessing.
    const myRank = ctx.order.indexOf(id);
    const ahead = (taker) => taker.explicit && ctx.order.indexOf(taker.goal_id) < myRank;
    const named = (takers) => [...new Set(takers.map((t) => names.get(t.goal_id)).filter(Boolean))];

    res.json({
      goal: {
        id,
        name: goal.name,
        target_date: goal.date,
        years_left: round2(years),
        expected_return: goal.r,
        target_amount_base: round2(goal.target),
        needed_today: round2(neededToday(goal.target, goal.r, years)),
      },
      items: Object.entries(ctx.items)
        .map(([key, it]) => {
          const used = others[key];
          const link = mine.get(key);
          return {
            kind: it.kind,
            ref_id: it.ref_id,
            name: it.name,
            tag: it.tag,
            cls: it.cls,
            currency: it.currency,
            rate: it.rate,
            value_native: round2(Math.max(0, it.native)),
            value_base: round2(Math.max(0, it.value)),
            taken_base: round2(used ? used.taken : 0),
            // Fixed amounts and shares other goals took, and how many of them
            // hold "all of it" — together, what "all of it" would mean here.
            explicit_base: round2(used ? used.explicit : 0),
            whole_count: used ? used.whole : 0,
            taken_by: used ? named(used.takers) : [],
            // The part claimed by goals that rank ahead of this one.
            ahead_base: round2(used ? used.takers.filter(ahead).reduce((s, t) => s + t.granted, 0) : 0),
            ahead_by: used ? named(used.takers.filter(ahead)) : [],
            mine: link ? { portion: portionOf(link), value: link.portion_value } : null,
          };
        })
        // Nothing can be set aside out of an empty or overdrawn item — unless
        // it's already chosen, in which case it must stay visible to untick.
        .filter((it) => it.value_base > 0 || it.mine)
        .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.value_base - a.value_base),
      base_currency: ctx.base,
    });
  })
);

// The goal's links as stored — kept for app builds that predate /funding.
goalsRouter.get(
  '/:id/links',
  asyncHandler(async (req, res) => {
    const goal = await getOne.get(req.params.id, req.user.id);
    if (!goal) throw new HttpError(404, 'Goal not found');
    const links = await linksForGoal.all(req.params.id, req.user.id);
    const items = links.length
      ? await fundableItems(req.user, await buildSummary(req.user, { scope: null, withItems: true }))
      : {};
    res.json({
      links: links.map((l) => {
        const it = items[`${l.kind}:${l.ref_id}`];
        return {
          kind: l.kind,
          ref_id: l.ref_id,
          portion: portionOf(l),
          value: l.portion_value,
          name: it?.name || '(removed)',
          value_base: it?.value || 0,
        };
      }),
      base_currency: req.user.base_currency,
    });
  })
);

// Replace what funds the goal, wholesale (the picker sends its full selection).
// Each link takes all of its item, a fixed amount of it, or a share of it.
// Every reference must belong to the caller.
goalsRouter.put(
  '/:id/links',
  asyncHandler(async (req, res) => {
    const goal = await getOne.get(req.params.id, req.user.id);
    if (!goal) throw new HttpError(404, 'Goal not found');
    const raw = Array.isArray(req.body.links) ? req.body.links.slice(0, 100) : [];
    // An app build that predates portions sends only kind + ref_id, and sends
    // the whole list on every goal save. Read as "all of it", that would turn a
    // carefully set "₹2 lakh of this account" into the entire account the next
    // time a goal was renamed from an old phone — so a link that arrives with
    // no portion at all keeps the one it already had.
    const existing = new Map(
      (await linksForGoal.all(req.params.id, req.user.id)).map((l) => [`${l.kind}:${l.ref_id}`, l])
    );
    const wanted = [];
    for (const l of raw) {
      const kind = oneOf(String(l.kind || ''), LINK_KINDS, 'kind');
      const refId = Number(l.ref_id);
      if (!Number.isInteger(refId) || refId <= 0) throw bad('ref_id must be a positive integer');
      const kept = l.portion === undefined ? existing.get(`${kind}:${refId}`) : null;
      const portion = kept ? portionOf(kept) : l.portion == null ? 'all' : oneOf(String(l.portion), PORTIONS, 'portion');
      let value = null;
      if (portion !== 'all') {
        value = kept ? kept.portion_value : num(l.value, 'value');
        if (!(value > 0)) throw bad('Enter how much of it is for this goal — more than zero');
        if (portion === 'percent' && value > 100) throw bad('A share of an item cannot be more than 100%');
        if (value > 1e15) throw bad('That amount is too large');
      }
      wanted.push({ kind, refId, portion, value });
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
    for (const w of wanted) {
      await insertLink.run(req.user.id, req.params.id, w.kind, w.refId, w.portion === 'all' ? null : w.portion, w.value, ts);
    }
    res.json({ goal: await oneFromPlan(req.user, req.params.id) });
  })
);
