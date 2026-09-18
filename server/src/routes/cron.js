import { Router } from 'express';
import { asyncHandler, HttpError } from '../util.js';
import { runDigests, runMonthlyStatements } from '../services/scheduler.js';
import { runLegacyChecks } from '../services/legacy.js';
import { evaluateAlerts, refreshAllInstruments } from '../services/alerts.js';

export const cronRouter = Router();

// Public trigger for an external scheduler (e.g. cron-job.org / UptimeRobot).
// On Render's free tier the in-process node-cron can't fire while the server
// is asleep — but an inbound HTTP request wakes it, and this endpoint runs the
// batch. Every job is idempotent (digests once per user-local day, statements
// once per month, alerts have cooldowns), so frequent pings are safe. Ping
// every ~10 minutes: that keeps the instance awake (no cold starts) and makes
// per-user digest delivery times reliable.
//
// Protected by a shared secret in CRON_SECRET; supply it as either
//   Authorization: Bearer <secret>   or   ?key=<secret>
function assertSecret(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HttpError(503, 'CRON_SECRET is not configured on the server');
  const header = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const provided = header || req.query.key || '';
  if (provided !== secret) throw new HttpError(401, 'Invalid cron secret');
}

// The full batch, guarded against overlap: if a previous tick is still
// working (slow price feeds), a new ping just reports "already running"
// instead of stacking a second run on top.
let inFlight = null;
async function runAll({ force = false } = {}) {
  const refresh = await refreshAllInstruments();
  const alerts = await evaluateAlerts();
  const digests = await runDigests({ force });
  const statements = await runMonthlyStatements({ force }); // idempotent per month
  // Legacy switch: warn owners who have gone quiet, release the map for those
  // who stayed quiet past their threshold. Wrapped so a bug here can never
  // stop the digests — and vice versa.
  const legacy = await runLegacyChecks().catch((e) => ({ error: e.message }));
  return { ok: !digests.error, refresh, alerts, digests, statements, legacy };
}
function kickOff(opts) {
  if (inFlight) return false;
  inFlight = runAll(opts)
    .then((r) => console.log('[cron] batch done:', JSON.stringify(r)))
    .catch((e) => console.error('[cron] batch failed:', e.message))
    .finally(() => {
      inFlight = null;
    });
  return true;
}

// Responds IMMEDIATELY and does the work in the background — external ping
// services time out in ~30s, which a cold start plus price fetches can blow
// through even though the batch itself completes fine. Add ?wait=1 to run
// synchronously and get the full report (handy for debugging).
// ?wait=1 runs synchronously and returns the full report — the self-diagnosis
// for "why am I not getting emails". ?force=1 additionally ignores the
// chosen-hour and already-sent guards, so a real send can be proven end to end
// on demand. Both stay behind the cron secret.
const handler = asyncHandler(async (req, res) => {
  assertSecret(req);
  const force = req.query.force === '1';
  if (req.query.wait === '1') {
    if (inFlight) await inFlight;
    return res.json(await runAll({ force }));
  }
  const started = kickOff({ force });
  res.json({ ok: true, started, note: started ? 'jobs running in background' : 'a batch is already running' });
});

// GET is easiest for most cron/ping services; POST also accepted.
// /digests kept as the original path; /run is a clearer alias for "all jobs".
cronRouter.get('/digests', handler);
cronRouter.post('/digests', handler);
cronRouter.get('/run', handler);
cronRouter.post('/run', handler);

// The legacy switch on its own, synchronously — `?at=YYYY-MM-DD` pretends it is
// that day, which is how the ninety-day sequence is exercised in a test run
// without waiting ninety days. Still behind the cron secret.
const legacyHandler = asyncHandler(async (req, res) => {
  assertSecret(req);
  const at = req.query.at ? new Date(`${req.query.at}T12:00:00Z`) : new Date();
  if (Number.isNaN(at.getTime())) throw new HttpError(400, 'at must be YYYY-MM-DD');
  res.json(await runLegacyChecks({ at }));
});
cronRouter.get('/legacy', legacyHandler);
cronRouter.post('/legacy', legacyHandler);
