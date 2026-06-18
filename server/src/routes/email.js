import { Router } from 'express';
import { db } from '../db.js';
import { authRequired } from '../auth.js';
import { asyncHandler, HttpError } from '../util.js';
import { emailConfigured, sendMail } from '../services/email.js';
import { buildDigest } from '../services/digest.js';
import { premiumState } from '../services/billing.js';
import { runDigests } from '../services/scheduler.js';

export const emailRouter = Router();
emailRouter.use(authRequired);

const getPrefs = db.prepare('SELECT daily, last_sent FROM email_prefs WHERE user_id = ?');
const setPrefs = db.prepare(`
  INSERT INTO email_prefs (user_id, daily) VALUES (?, ?)
  ON CONFLICT(user_id) DO UPDATE SET daily = excluded.daily
`);

emailRouter.get('/prefs', (req, res) => {
  const p = getPrefs.get(req.user.id);
  res.json({
    daily: !!p?.daily,
    last_sent: p?.last_sent || null,
    email: req.user.email,
    configured: emailConfigured(),
    premium: premiumState(req.user).premium,
  });
});

emailRouter.put(
  '/prefs',
  asyncHandler(async (req, res) => {
    const daily = req.body.daily ? 1 : 0;
    // Turning ON the daily email is a premium perk.
    if (daily && !premiumState(req.user).premium) {
      throw new HttpError(402, 'Daily summary emails are a premium feature. Upgrade to enable.');
    }
    setPrefs.run(req.user.id, daily);
    res.json({ daily: !!daily });
  })
);

// Render the digest for this user (no send) — used for the in-app preview.
emailRouter.get(
  '/preview',
  asyncHandler(async (req, res) => {
    const { subject, html } = await buildDigest(req.user);
    res.json({ subject, html });
  })
);

// Send a one-off test to the signed-in user's address (premium + SMTP required).
emailRouter.post(
  '/test',
  asyncHandler(async (req, res) => {
    if (!premiumState(req.user).premium) {
      throw new HttpError(402, 'Daily summary emails are a premium feature. Upgrade to enable.');
    }
    const { subject, html } = await buildDigest(req.user);
    await sendMail({ to: req.user.email, subject: `[Test] ${subject}`, html });
    res.json({ ok: true, to: req.user.email });
  })
);

// Admin: flush today's digest batch now (for testing the scheduler).
emailRouter.post(
  '/run-now',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') throw new HttpError(403, 'Admins only');
    res.json(await runDigests({ force: true }));
  })
);
