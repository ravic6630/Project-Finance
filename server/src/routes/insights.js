import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired, requirePremium } from '../auth.js';
import { asyncHandler, bad, num } from '../util.js';
import { KIND_LABELS } from '../markets.js';
import { buildSummary } from '../services/summary.js';
import { getFxRate } from '../services/prices.js';
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
  INSERT INTO insight_prefs (user_id, withdrawal_rate, expected_return, inflation, annual_spend, annual_spend_currency, fi_target, fi_target_currency, fi_buckets, fi_years, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    withdrawal_rate       = excluded.withdrawal_rate,
    expected_return       = excluded.expected_return,
    inflation             = excluded.inflation,
    annual_spend          = excluded.annual_spend,
    annual_spend_currency = excluded.annual_spend_currency,
    fi_target             = excluded.fi_target,
    fi_target_currency    = excluded.fi_target_currency,
    fi_buckets            = excluded.fi_buckets,
    fi_years              = excluded.fi_years,
    updated_at            = excluded.updated_at
`);

// The two prefs that are amounts of money rather than rates or years.
const MONEY_PREFS = ['annual_spend', 'fi_target'];
const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

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
    annual_spend_currency: row?.annual_spend_currency ?? null,
    // null = derive the target from spending; null buckets = count everything
    // that isn't an asset. Both are the honest defaults, not stored settings.
    fi_target: row?.fi_target ?? null,
    fi_target_currency: row?.fi_target_currency ?? null,
    fi_buckets: parseBuckets(row?.fi_buckets),
    fi_years: row?.fi_years ?? DEFAULT_PREFS.fi_years,
  };
}

// The amounts are stored in the currency they were typed in, but everything
// the page measures them against — the pot, the measured spending — arrives in
// the base currency being viewed. So they're converted here, before anything
// reads them. What was actually typed rides along in `entered` whenever it's in
// another currency, so the form can say where its odd-looking figure came from.
async function prefsInBase(prefs, base) {
  const out = { ...prefs, entered: {} };
  for (const key of MONEY_PREFS) {
    const currency = prefs[`${key}_currency`] || base;
    delete out[`${key}_currency`];
    if (prefs[key] == null || currency === base) continue;
    out[key] = prefs[key] * (await getFxRate(currency, base));
    out.entered[key] = { amount: prefs[key], currency };
  }
  return out;
}

// What the form is seeded with: the converted amounts, to the cent.
const forClient = (prefs) => ({
  ...prefs,
  annual_spend: round2(prefs.annual_spend),
  fi_target: round2(prefs.fi_target),
});

insightsRouter.get(
  '/prefs',
  asyncHandler(async (req, res) =>
    res.json({ prefs: forClient(await prefsInBase(await prefsFor(req.user.id), req.user.base_currency)) })
  )
);

insightsRouter.put(
  '/prefs',
  asyncHandler(async (req, res) => {
    const base = req.user.base_currency;
    const cur = await prefsFor(req.user.id);
    // What the form was seeded with — to recognise an amount sent back as-is.
    const shown = forClient(await prefsInBase(cur, base));
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

    // An amount keeps the currency it was typed in until it's changed. The form
    // posts every field on every save, so a figure that comes back exactly as
    // it was shown (converted, to the cent) is the stored one untouched, not a
    // new amount in today's currency. Re-storing it as one would drift a rupee
    // figure by paise each time the view was switched and something else was
    // saved — and app builds already installed post the whole form, so this
    // can't be left to the client alone.
    const untouched = (key) =>
      cur[key] != null &&
      req.body[key] != null &&
      req.body[key] !== '' &&
      Math.abs(Number(req.body[key]) - shown[key]) < 0.005;

    // null clears the override and returns to spending measured from real
    // transactions — which is the honest default. A new amount is in the base
    // currency the form is labelled with.
    let spend = cur.annual_spend;
    let spendCurrency = cur.annual_spend_currency ?? base;
    if (req.body.annual_spend !== undefined && !untouched('annual_spend')) {
      spend = req.body.annual_spend === null || req.body.annual_spend === '' ? null : num(req.body.annual_spend, 'annual_spend');
      if (spend != null && spend < 0) throw bad('annual_spend cannot be negative');
      spendCurrency = base;
    }

    // Same contract as annual_spend: null (or '') clears the override, so the
    // target goes back to being derived from what a year of your life costs.
    let target = cur.fi_target;
    let targetCurrency = cur.fi_target_currency ?? base;
    if (req.body.fi_target !== undefined && !untouched('fi_target')) {
      target = req.body.fi_target === null || req.body.fi_target === '' ? null : num(req.body.fi_target, 'fi_target');
      if (target != null && !(target > 0)) throw bad('Your target must be more than zero — or blank to size it from your spending');
      if (target != null && target > MAX_FI_TARGET) throw bad('That target is too large to project against');
      targetCurrency = base;
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
      spend == null ? null : spendCurrency,
      target,
      target == null ? null : targetCurrency,
      buckets == null ? null : JSON.stringify(buckets),
      fiYears,
      now()
    );
    res.json({ prefs: forClient(await prefsInBase(await prefsFor(req.user.id), base)) });
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
    // In the base currency, like the summary — the FI maths compares them.
    const prefs = await prefsInBase(await prefsFor(req.user.id), req.user.base_currency);

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
      prefs: forClient(prefs),
      fi,
      risk,
    });
  })
);
