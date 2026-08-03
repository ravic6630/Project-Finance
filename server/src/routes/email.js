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

const getPrefs = db.prepare('SELECT * FROM email_prefs WHERE user_id = ?');
const setPrefs = db.prepare(`
  INSERT INTO email_prefs (user_id, daily, monthly_statement) VALUES (?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET daily = excluded.daily, monthly_statement = excluded.monthly_statement
`);

emailRouter.get(
  '/prefs',
  asyncHandler(async (req, res) => {
    const p = await getPrefs.get(req.user.id);
    res.json({
      daily: !!p?.daily,
      monthly_statement: !!p?.monthly_statement,
      last_sent: p?.last_sent || null,
      email: req.user.email,
      configured: emailConfigured(),
      premium: (await premiumState(req.user)).premium,
    });
  })
);

emailRouter.put(
  '/prefs',
  asyncHandler(async (req, res) => {
    // Merge with what's stored, so setting one toggle never clears the other.
    const existing = await getPrefs.get(req.user.id);
    const daily = (req.body.daily === undefined ? !!existing?.daily : !!req.body.daily) ? 1 : 0;
    const monthly =
      (req.body.monthly_statement === undefined ? !!existing?.monthly_statement : !!req.body.monthly_statement) ? 1 : 0;
    // Turning ON either email is a premium perk.
    const turningOn = (daily && !existing?.daily) || (monthly && !existing?.monthly_statement);
    if (turningOn && !(await premiumState(req.user)).premium) {
      throw new HttpError(402, 'Email reports are a premium feature. Upgrade to enable.');
    }
    await setPrefs.run(req.user.id, daily, monthly);
    res.json({ daily: !!daily, monthly_statement: !!monthly });
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
    if (!(await premiumState(req.user)).premium) {
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
