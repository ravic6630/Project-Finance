import { Router } from 'express';
import { asyncHandler, HttpError } from '../util.js';
import { runDigests, runMonthlyStatements } from '../services/scheduler.js';
import { evaluateAlerts, refreshAllInstruments } from '../services/alerts.js';

export const cronRouter = Router();

// Public trigger for an external scheduler (e.g. cron-job.org / UptimeRobot) to
// run the daily digest batch. On Render's free tier the in-process node-cron
// can't fire while the server is asleep — but an inbound HTTP request wakes it,
// and this endpoint then runs the batch. runDigests() is guarded to once per IST
// day per user, so pinging it repeatedly is safe (no duplicate emails).
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

// Runs the daily jobs: refresh prices (auto-sync), check price alerts, then
// send the digest. Safe to ping repeatedly — alerts have a cooldown and the
// digest is once-per-IST-day per user. Ping more often (e.g. hourly) to check
// alerts more frequently.
const handler = asyncHandler(async (req, res) => {
  assertSecret(req);
  const refresh = await refreshAllInstruments();
  const alerts = await evaluateAlerts();
  const digests = await runDigests();
  const statements = await runMonthlyStatements(); // idempotent per month
  res.json({ ok: !digests.error, refresh, alerts, digests, statements });
});

// GET is easiest for most cron/ping services; POST also accepted.
// /digests kept as the original path; /run is a clearer alias for "all jobs".
cronRouter.get('/digests', handler);
cronRouter.post('/digests', handler);
cronRouter.get('/run', handler);
cronRouter.post('/run', handler);
