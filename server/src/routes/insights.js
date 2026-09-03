import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired, requirePremium } from '../auth.js';
import { asyncHandler, bad, num } from '../util.js';
import { KIND_LABELS } from '../markets.js';
import { buildSummary } from '../services/summary.js';
import { buildFI } from '../services/insights/fi.js';
import { buildRisk } from '../services/insights/risk.js';

export const insightsRouter = Router();
insightsRouter.use(authRequired);
// Insights is the analysis tier — the same premium line as Goals and Returns.
insightsRouter.use(requirePremium);

/* ------------------------------- assumptions ------------------------------ */
// Everything the FI projection rests on is a user-editable assumption, never a
// fact we assert. Defaults follow the conventional 4% withdrawal study.
const DEFAULT_PREFS = { withdrawal_rate: 4, expected_return: 10, inflation: 6, annual_spend: null, fi_years: 30 };

// The buckets a target mix — or an FI pot — can be built from: every holding
// kind the summary can emit, plus the two non-holding pools.
const BUCKETS = { ...KIND_LABELS, CASH: 'Cash & Bank', ASSETS: 'Assets' };

// A target above this is not a plan, and it would push the projection into
// numbers that stop being finite once compounded.
const MAX_FI_TARGET = 1e15;

const getPrefsRow = db.prepare('SELECT * FROM insight_prefs WHERE user_id = ?');
const upsertPrefs = db.prepare(`
  INSERT INTO insight_prefs (user_id, withdrawal_rate, expected_return, inflation, annual_spend, fi_target, fi_buckets, fi_years, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    withdrawal_rate = excluded.withdrawal_rate,
    expected_return = excluded.expected_return,
    inflation       = excluded.inflation,
    annual_spend    = excluded.annual_spend,
    fi_target       = excluded.fi_target,
    fi_buckets      = excluded.fi_buckets,
    fi_years        = excluded.fi_years,
    updated_at      = excluded.updated_at
`);

// Stored as JSON text. A row written before this column existed — or one
// corrupted by hand — must not take the whole page down, so anything that
// doesn't parse into a non-empty array is treated as "not set" (the default).
function parseBuckets(raw) {
  if (raw == null || raw === '') return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    const clean = arr.map((b) => String(b || '').trim().toUpperCase()).filter(Boolean);
    return clean.length ? [...new Set(clean)] : null;
  } catch {
    return null;
  }
}

export async function prefsFor(userId) {
  const row = await getPrefsRow.get(userId);
  return {
    withdrawal_rate: row?.withdrawal_rate ?? DEFAULT_PREFS.withdrawal_rate,
    expected_return: row?.expected_return ?? DEFAULT_PREFS.expected_return,
    inflation: row?.inflation ?? DEFAULT_PREFS.inflation,
    annual_spend: row?.annual_spend ?? null,
    // null = derive the target from spending; null buckets = count everything
    // that isn't an asset. Both are the honest defaults, not stored settings.
    fi_target: row?.fi_target ?? null,
    fi_buckets: parseBuckets(row?.fi_buckets),
    fi_years: row?.fi_years ?? DEFAULT_PREFS.fi_years,
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
    // A retirement shorter than a year isn't one, and past a century the
    // compounding stops describing anything a person is planning for.
    const fiYears = pick('fi_years', 1, 100);
    // null clears the override and returns to spending measured from real
    // transactions — which is the honest default.
    let spend = cur.annual_spend;
    if (req.body.annual_spend !== undefined) {
      spend = req.body.annual_spend === null || req.body.annual_spend === '' ? null : num(req.body.annual_spend, 'annual_spend');
      if (spend != null && spend < 0) throw bad('annual_spend cannot be negative');
    }

    // Same contract as annual_spend: null (or '') clears the override, so the
    // target goes back to being derived from what a year of your life costs.
    let target = cur.fi_target;
    if (req.body.fi_target !== undefined) {
      target = req.body.fi_target === null || req.body.fi_target === '' ? null : num(req.body.fi_target, 'fi_target');
      if (target != null && !(target > 0)) throw bad('Your target must be more than zero — or blank to size it from your spending');
      if (target != null && target > MAX_FI_TARGET) throw bad('That target is too large to project against');
    }

    // Which pots count toward the target. null resets to the default (anything
    // that isn't property), and an empty selection is refused rather than
    // silently saved — a pot of nothing would report 0% forever.
    let buckets = cur.fi_buckets;
    if (req.body.fi_buckets !== undefined) {
      const raw = req.body.fi_buckets;
      if (raw === null || raw === '') buckets = null;
      else {
        if (!Array.isArray(raw)) throw bad('fi_buckets must be a list of holding types');
        const clean = [];
        for (const b of raw.slice(0, 40)) {
          const bucket = String(b || '').trim().toUpperCase().slice(0, 32);
          if (!bucket) continue;
          if (!(bucket in BUCKETS)) throw bad(`Unknown holding type: ${bucket}`);
          if (!clean.includes(bucket)) clean.push(bucket);
        }
        if (!clean.length) throw bad('Choose at least one thing to count toward your target');
        buckets = clean;
      }
    }

    await upsertPrefs.run(
      req.user.id,
      withdrawal,
      ret,
      infl,
      spend,
      target,
      buckets == null ? null : JSON.stringify(buckets),
      fiYears,
      now()
    );
    res.json({ prefs: await prefsFor(req.user.id) });
  })
);

/* --------------------------------- insights ------------------------------- */
// Both trackers are built off a SINGLE summary — they need the same priced
// portfolio, and pricing it twice would be twice the upstream calls for
// identical data.
insightsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const summary = await buildSummary(req.user, { scope: null, withItems: true });
    const prefs = await prefsFor(req.user.id);

    // Independent of one another, so they run together. Each is wrapped: one
    // tracker failing must not blank the whole page.
    const settled = await Promise.allSettled([
      buildFI(req.user, { summary, prefs }),
      buildRisk(req.user, { summary }),
    ]);
    const [fi, risk] = settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      console.error(`[insights] block ${i} failed:`, r.reason?.message);
      return { error: 'Could not build this section right now.' };
    });

    res.json({
      base_currency: req.user.base_currency,
      net_worth: summary.net_worth,
      prefs,
      fi,
      risk,
    });
  })
);
