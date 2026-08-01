import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired, requirePremium } from '../auth.js';
import { asyncHandler, bad, HttpError, num, oneOf, str } from '../util.js';
import { projectGoal } from '../services/goals.js';
import { getFxRate } from '../services/prices.js';
import { enrichHoldings } from '../services/portfolio.js';
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

const listLinks = db.prepare('SELECT * FROM goal_links WHERE user_id = ? ORDER BY id');
const linksForGoal = db.prepare('SELECT * FROM goal_links WHERE goal_id = ? AND user_id = ? ORDER BY id');
const clearLinks = db.prepare('DELETE FROM goal_links WHERE goal_id = ? AND user_id = ?');
const insertLink = db.prepare(
  'INSERT OR IGNORE INTO goal_links (user_id, goal_id, kind, ref_id, created_at) VALUES (?, ?, ?, ?, ?)'
);

const LINK_KINDS = ['holding', 'account', 'asset'];

// Current value (in the user's base currency) of every linkable item, one
// batch: holdings priced via the (cached) price feed, accounts and assets via
// FX. Returns { 'holding:12': {name, value}, 'account:3': …, 'asset:7': … }.
async function linkableValues(user) {
  const base = user.base_currency;
  const [holdRows, accounts, assets] = await Promise.all([
    db.prepare('SELECT * FROM holdings WHERE user_id = ?').all(user.id),
    db.prepare('SELECT * FROM cash_accounts WHERE user_id = ?').all(user.id),
    db.prepare('SELECT * FROM assets WHERE user_id = ?').all(user.id),
  ]);
  const values = {};
  if (holdRows.length) {
    const { items } = await enrichHoldings(holdRows, base);
    for (const h of items) values[`holding:${h.id}`] = { name: h.name, value: h.market_value_base || 0 };
  }
  const fx = { [base]: 1 };
  const rate = async (c) => {
    if (fx[c] == null) fx[c] = await getFxRate(c, base);
    return fx[c];
  };
  for (const a of accounts) values[`account:${a.id}`] = { name: a.name, value: a.balance * (await rate(a.currency)) };
  for (const a of assets) values[`asset:${a.id}`] = { name: a.name, value: a.value * (await rate(a.currency)) };
  return values;
}

// Sum each goal's linked items. Returns { [goalId]: { total, count } }.
async function linkedTotals(user, goalIds) {
  const links = (await listLinks.all(user.id)).filter((l) => goalIds.includes(l.goal_id));
  if (!links.length) return {};
  const values = await linkableValues(user);
  const out = {};
  for (const l of links) {
    const v = values[`${l.kind}:${l.ref_id}`];
    if (!out[l.goal_id]) out[l.goal_id] = { total: 0, count: 0 };
    out[l.goal_id].count += 1;
    out[l.goal_id].total += v ? v.value : 0; // a deleted item just counts 0
  }
  return out;
}

// Goals are stored in their own currency but shown in the user's base currency
// (same as holdings). Convert the amounts, then project on the converted figures
// so "projected" and "required monthly" come out in base currency too. The native
// fields are left untouched so the edit form still shows the goal's own currency.
async function ratesFor(goals, base) {
  const rates = {};
  await Promise.all(
    [...new Set([base, ...goals.map((g) => g.currency || 'INR')])].map(async (c) => {
      rates[c] = await getFxRate(c, base);
    })
  );
  return rates;
}

function withProjection(g, base, rates, linked) {
  const rate = rates[g.currency || 'INR'] ?? 1;
  const target_amount_base = (Number(g.target_amount) || 0) * rate;
  // Linked goals track their saved amount live from the portfolio; the manual
  // figure only applies when nothing is linked.
  const current_amount_base = linked ? linked.total : (Number(g.current_amount) || 0) * rate;
  const monthly_contribution_base = (Number(g.monthly_contribution) || 0) * rate;
  const projection = projectGoal({
    ...g,
    target_amount: target_amount_base,
    current_amount: current_amount_base,
    monthly_contribution: monthly_contribution_base,
  });
  return {
    ...g,
    base_currency: base,
    target_amount_base,
    current_amount_base,
    monthly_contribution_base,
    links_count: linked ? linked.count : 0,
    projection,
  };
}

const oneWithProjection = async (g, base, user) => {
  const linked = user ? (await linkedTotals(user, [g.id]))[g.id] : undefined;
  return withProjection(g, base, await ratesFor([g], base), linked);
};

goalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const base = req.user.base_currency;
    const rows = await list.all(req.user.id);
    const rates = await ratesFor(rows, base);
    const linked = await linkedTotals(req.user, rows.map((g) => g.id));
    res.json({
      goals: rows.map((g) => withProjection(g, base, rates, linked[g.id])),
      base_currency: base,
    });
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
    const row = await getOne.get(Number(info.lastInsertRowid), req.user.id);
    res.status(201).json({ goal: await oneWithProjection(row, req.user.base_currency, req.user) });
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
    const row = await getOne.get(req.params.id, req.user.id);
    res.json({ goal: await oneWithProjection(row, req.user.base_currency, req.user) });
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
    const values = links.length ? await linkableValues(req.user) : {};
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
    res.json({ goal: await oneWithProjection(goal, req.user.base_currency, req.user) });
  })
);
