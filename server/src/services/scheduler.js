import cron from 'node-cron';
import { db, now } from '../db.js';
import { buildDigest } from './digest.js';
import { emailConfigured, sendMail } from './email.js';
import { premiumState } from './billing.js';

const DIGEST_HOUR = Number(process.env.DIGEST_HOUR) || 8; // IST hour, default 8am
const TZ = 'Asia/Kolkata';

const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); // YYYY-MM-DD

const eligible = db.prepare(`
  SELECT u.id, u.email, u.name, u.base_currency, u.role, e.last_sent
  FROM users u JOIN email_prefs e ON e.user_id = u.id
  WHERE e.daily = 1
`);
const markSent = db.prepare('UPDATE email_prefs SET last_sent = ? WHERE user_id = ?');

// Send the daily digest to every opted-in premium user (once per IST day).
export async function runDigests({ force = false } = {}) {
  const report = { sent: 0, skipped: 0, failed: 0, recipients: [] };
  if (!emailConfigured()) return { ...report, error: 'email_not_configured' };

  const today = istDate();
  for (const u of eligible.all()) {
    if (!premiumState(u).premium) {
      report.skipped += 1;
      continue;
    }
    if (!force && u.last_sent && u.last_sent.slice(0, 10) === today) {
      report.skipped += 1;
      continue;
    }
    try {
      const { subject, html } = await buildDigest(u);
      await sendMail({ to: u.email, subject, html });
      markSent.run(now(), u.id);
      report.sent += 1;
      report.recipients.push(u.email);
    } catch (err) {
      report.failed += 1;
      console.error(`Digest failed for ${u.email}:`, err.message);
    }
  }
  return report;
}

export function startDigestScheduler() {
  if (!emailConfigured()) {
    console.log('Daily digest scheduler idle (SMTP not configured).');
    return;
  }
  cron.schedule(`0 ${DIGEST_HOUR} * * *`, () => runDigests().then((r) => console.log('Daily digests:', r)), {
    timezone: TZ,
  });
  console.log(`Daily digest scheduler armed for ${DIGEST_HOUR}:00 ${TZ}.`);
}
