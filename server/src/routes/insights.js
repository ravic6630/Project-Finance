import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired, requirePremium } from '../auth.js';
import { asyncHandler, bad, num } from '../util.js';
import { buildSummary } from '../services/summary.js';
import { buildFI } from '../services/insights/fi.js';
import { buildAllocation } from '../services/insights/allocation.js';
import { buildDividends } from '../services/insights/dividends.js';
import { buildRisk } from '../services/insights/risk.js';

export const insightsRouter = Router();
insightsRouter.use(authRequired);
// Insights is the analysis tier — the same premium line as Goals and Returns.
insightsRouter.use(requirePremium);

/* ------------------------------- assumptions ------------------------------ */
// Everything the FI projection rests on is a user-editable assumption, never a
// fact we assert. Defaults follow the conventional 4% withdrawal study.
const DEFAULT_PREFS = { withdrawal_rate: 4, expected_return: 10, inflation: 6, annual_spend: null };

const getPrefsRow = db.prepare('SELECT * FROM insight_prefs WHERE user_id = ?');
const upsertPrefs = db.prepare(`
  INSERT INTO insight_prefs (user_id, withdrawal_rate, expected_return, inflation, annual_spend, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    withdrawal_rate = excluded.withdrawal_rate,
    expected_return = excluded.expected_return,
    inflation       = excluded.inflation,
    annual_spend    = excluded.annual_spend,
    updated_at      = excluded.updated_at
`);

export async function prefsFor(userId) {
  const row = await getPrefsRow.get(userId);
  return {
    withdrawal_rate: row?.withdrawal_rate ?? DEFAULT_PREFS.withdrawal_rate,
    expected_return: row?.expected_return ?? DEFAULT_PREFS.expected_return,
    inflation: row?.inflation ?? DEFAULT_PREFS.inflation,
    annual_spend: row?.annual_spend ?? null,
  };
}

insightsRouter.get(
  '/prefs',
  asyncHandler(async (req, res) => res.json({ prefs: await prefsFor(req.user.id) }))
);

insightsRouter.put(
  '/prefs',
  asyncHandler(async (req, res) => {
    const cur = await prefsFor(req.user.id);
    const pick = (key, min, max) => {
      if (req.body[key] === undefined || req.body[key] === null) return cur[key];
      const v = num(req.body[key], key);
      if (v < min || v > max) throw bad(`${key} must be between ${min} and ${max}`);
      return v;
    };
    const withdrawal = pick('withdrawal_rate', 1, 10);
    const ret = pick('expected_return', 0, 30);
    const infl = pick('inflation', 0, 20);
    // null clears the override and returns to spending measured from real
    // transactions — which is the honest default.
    let spend = cur.annual_spend;
    if (req.body.annual_spend !== undefined) {
      spend = req.body.annual_spend === null || req.body.annual_spend === '' ? null : num(req.body.annual_spend, 'annual_spend');
      if (spend != null && spend < 0) throw bad('annual_spend cannot be negative');
    }
    await upsertPrefs.run(req.user.id, withdrawal, ret, infl, spend, now());
    res.json({ prefs: await prefsFor(req.user.id) });
  })
);

/* ---------------------------- allocation targets -------------------------- */
const listTargets = db.prepare('SELECT bucket, target_pct FROM allocation_targets WHERE user_id = ? ORDER BY bucket');
const clearTargets = db.prepare('DELETE FROM allocation_targets WHERE user_id = ?');
const insertTarget = db.prepare(`
  INSERT INTO allocation_targets (user_id, bucket, target_pct, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id, bucket) DO UPDATE SET target_pct = excluded.target_pct, updated_at = excluded.updated_at
`);

export const targetsFor = (userId) => listTargets.all(userId);

// Replace the whole target mix at once — the editor always sends its full set.
insightsRouter.put(
  '/targets',
  asyncHandler(async (req, res) => {
    const rows = Array.isArray(req.body.targets) ? req.body.targets.slice(0, 20) : [];
    const clean = [];
    for (const r of rows) {
      const bucket = String(r.bucket || '').trim().toUpperCase().slice(0, 32);
      if (!bucket) continue;
      const pct = num(r.target_pct ?? 0, 'target_pct');
      if (pct < 0 || pct > 100) throw bad('Each target must be between 0 and 100%');
      if (pct > 0) clean.push({ bucket, pct });
    }
    const total = clean.reduce((s, r) => s + r.pct, 0);
    // A mix that doesn't total 100% would silently misreport every drift figure.
    if (clean.length && Math.abs(total - 100) > 0.5) {
      throw bad(`Targets must add up to 100% — they currently total ${total.toFixed(1)}%`);
    }
    const ts = now();
    await clearTargets.run(req.user.id);
    for (const r of clean) await insertTarget.run(req.user.id, r.bucket, r.pct, ts, ts);
    res.json({ targets: await targetsFor(req.user.id) });
  })
);

/* --------------------------------- insights ------------------------------- */
// One request builds all four trackers off a SINGLE summary — they all need the
// same priced portfolio, and pricing it four times would be four times the
// upstream calls for identical data.
insightsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const summary = await buildSummary(req.user, { scope: null, withItems: true });
    const prefs = await prefsFor(req.user.id);
    const targets = await targetsFor(req.user.id);

    // Independent of one another, so they run together. Each is wrapped: one
    // tracker failing (a dividend feed hiccup) must not blank the whole page.
    const settled = await Promise.allSettled([
      buildFI(req.user, { summary, prefs }),
      buildAllocation(req.user, { summary, targets }),
      buildDividends(req.user, { summary }),
      buildRisk(req.user, { summary }),
    ]);
    const [fi, allocation, dividends, risk] = settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      console.error(`[insights] block ${i} failed:`, r.reason?.message);
      return { error: 'Could not build this section right now.' };
    });

    res.json({
      base_currency: req.user.base_currency,
      net_worth: summary.net_worth,
      prefs,
      fi,
      allocation,
      dividends,
      risk,
    });
  })
);
