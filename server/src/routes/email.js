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
  INSERT INTO email_prefs (user_id, daily, monthly_statement, daily_hour, daily_tz) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET daily = excluded.daily, monthly_statement = excluded.monthly_statement,
    daily_hour = excluded.daily_hour, daily_tz = excluded.daily_tz
`);

emailRouter.get(
  '/prefs',
  asyncHandler(async (req, res) => {
    const p = await getPrefs.get(req.user.id);
    res.json({
      daily: !!p?.daily,
      monthly_statement: !!p?.monthly_statement,
      daily_hour: p?.daily_hour ?? 8,
      daily_tz: p?.daily_tz || 'Asia/Kolkata',
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
    // Delivery time: any hour 0-23, in a real IANA timezone (IST by default).
    let hour = req.body.daily_hour === undefined ? (existing?.daily_hour ?? 8) : Number(req.body.daily_hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new HttpError(400, 'daily_hour must be 0-23');
    let tz = req.body.daily_tz === undefined ? existing?.daily_tz || 'Asia/Kolkata' : String(req.body.daily_tz);
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
    } catch {
      throw new HttpError(400, "That timezone isn't recognised");
    }
    await setPrefs.run(req.user.id, daily, monthly, hour, tz);
    res.json({ daily: !!daily, monthly_statement: !!monthly, daily_hour: hour, daily_tz: tz });
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
