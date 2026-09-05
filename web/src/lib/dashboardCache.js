/* Last-known dashboard, kept locally so the first paint after signing in is
   instant.

   The API is hosted on Render's free tier, which sleeps. A cold start can take
   the best part of a minute, and a spinner for that long reads as "broken" —
   the numbers were already known, they just weren't on screen. So the last
   payload is stored and painted immediately, clearly marked as of when, while
   the real request runs behind it and replaces it in place.

   Three rules this file exists to enforce:
   - Cached money is shown ONLY under its own timestamp. Silently presenting
     yesterday's net worth as today's would be the worst bug in the app.
   - The cache is keyed by user, currency and profile together. A different
     account, a switched base currency or another family member must never see
     a stale number that isn't theirs.
   - It is cleared on sign-out, because it is somebody's net worth sitting in a
     browser they may share. */

const KEY = 'sampada_dashboard_cache';

// Past a day, a stale figure stops being a helpful placeholder and starts being
// a wrong one — the spinner is the better answer at that point.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// localStorage is a few MB in total and shared with everything else the app
// keeps. A dashboard carrying a decade of history can get large; past this it
// isn't worth the quota.
const MAX_BYTES = 400_000;

// Identity of a payload: whose money, in what currency, for which profile.
export const cacheSignature = (userId, base, profile) => `${userId ?? '?'}:${base ?? '?'}:${profile ?? 'all'}`;

export function readDashboardCache(signature) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.signature !== signature || !parsed.data) return null;
    const at = Date.parse(parsed.at);
    if (!Number.isFinite(at) || Date.now() - at > MAX_AGE_MS) return null;
    return { data: parsed.data, at: parsed.at };
  } catch {
    // Private mode, cleared storage, or a payload written by an older build.
    return null;
  }
}

export function writeDashboardCache(signature, data) {
  try {
    const body = JSON.stringify({ signature, at: new Date().toISOString(), data });
    if (body.length > MAX_BYTES) return;
    localStorage.setItem(KEY, body);
  } catch {
    /* quota or private mode — the cache is an optimisation, never a requirement */
  }
}

export function clearDashboardCache() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do — there is no state to keep consistent */
  }
}
