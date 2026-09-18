import cron from 'node-cron';
import { db, now } from '../db.js';
import { buildDigest } from './digest.js';
import { monthLabel, statementData, statementHtml } from './statement.js';
import { emailConfigured, sendMail } from './email.js';
import { premiumState } from './billing.js';

const DIGEST_HOUR = Number(process.env.DIGEST_HOUR) || 8; // IST hour, default 8am
const TZ = 'Asia/Kolkata';

const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); // YYYY-MM-DD

const eligible = db.prepare(`
  SELECT u.id, u.email, u.name, u.base_currency, u.role, e.last_sent, e.daily_hour, e.daily_tz
  FROM users u JOIN email_prefs e ON e.user_id = u.id
  WHERE e.daily = 1
`);
const markSent = db.prepare('UPDATE email_prefs SET last_sent = ? WHERE user_id = ?');

// "What time is it for this user?" — local date + hour in their chosen
// timezone (falls back to IST if the stored zone is ever invalid).
export function localClock(tz, at = new Date()) {
  let zone = tz || TZ;
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    }).formatToParts(at);
  } catch {
    zone = TZ;
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    }).formatToParts(at);
  }
  const get = (t) => parts.find((x) => x.type === t)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24, tz: zone };
}

// Decide whether user u gets their digest on THIS hourly tick: it must be
// their chosen hour locally, and they must not have been sent one today
// (today in THEIR timezone). force ignores both (run-now / send-test).
export function shouldSendDigest(u, { force = false, at = new Date() } = {}) {
  if (force) return true;
  const clock = localClock(u.daily_tz, at);
  if (clock.hour !== (u.daily_hour ?? 8)) return false;
  if (u.last_sent && localClock(u.daily_tz, new Date(u.last_sent)).date === clock.date) return false;
  return true;
}

// Send the daily digest to every opted-in premium user (once per user-local day).
//
// The report says WHY every non-send didn't happen. "I'm not receiving my
// emails" is only debuggable from the outside — the owner reads this straight
// off /api/cron/run?wait=1 — so a bare skipped-count is worthless: not-premium,
// wrong-hour and already-sent-today call for three different fixes.
export async function runDigests({ force = false } = {}) {
  const report = {
    sent: 0,
    skipped: 0,
    failed: 0,
    recipients: [],
    opted_in: 0,
    skip_reasons: { not_premium: 0, wrong_hour: 0, already_sent_today: 0 },
    waiting: [],
    failures: [],
  };
  if (!emailConfigured()) return { ...report, error: 'email_not_configured' };

  for (const u of await eligible.all()) {
    report.opted_in += 1;
    if (!(await premiumState(u)).premium) {
      report.skipped += 1;
      report.skip_reasons.not_premium += 1;
      continue;
    }
    if (!force) {
      const clock = localClock(u.daily_tz);
      if (clock.hour !== (u.daily_hour ?? 8)) {
        report.skipped += 1;
        report.skip_reasons.wrong_hour += 1;
        // Enough to see at a glance that the ping simply isn't landing in
        // anyone's chosen hour — the commonest cause of "no emails at all".
        if (report.waiting.length < 5) {
          report.waiting.push({ email: u.email, sends_at_hour: u.daily_hour ?? 8, their_hour_now: clock.hour, tz: clock.tz });
        }
        continue;
      }
      if (u.last_sent && localClock(u.daily_tz, new Date(u.last_sent)).date === clock.date) {
        report.skipped += 1;
        report.skip_reasons.already_sent_today += 1;
        continue;
      }
    }
    try {
      const { subject, html } = await buildDigest(u);
      await sendMail({ to: u.email, subject, html });
      await markSent.run(now(), u.id);
      report.sent += 1;
      report.recipients.push(u.email);
    } catch (err) {
      report.failed += 1;
      if (report.failures.length < 5) report.failures.push({ email: u.email, error: err.message });
      console.error(`Digest failed for ${u.email}:`, err.message);
    }
  }
  if (!report.sent && !report.failed) {
    report.hint =
      report.opted_in === 0
        ? 'Nobody has the daily digest turned on (Settings → email).'
        : report.skip_reasons.not_premium === report.opted_in
          ? 'Everyone opted in has lapsed premium — digests are a premium feature.'
          : report.skip_reasons.wrong_hour > 0
            ? "No opted-in user is in their chosen hour right now. The cron ping must land DURING each user's selected hour — ping every ~10 minutes rather than once a day."
            : 'Everyone due today has already been sent.';
  }
  return report;
}

// Previous IST month as YYYY-MM.
const prevMonthYM = () => {
  const [y, m] = istDate().slice(0, 7).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

const statementEligible = db.prepare(`
  SELECT u.id, u.email, u.name, u.base_currency, u.role, u.created_at, e.last_statement_month
  FROM users u JOIN email_prefs e ON e.user_id = u.id
  WHERE e.monthly_statement = 1
`);
const markStatement = db.prepare('UPDATE email_prefs SET last_statement_month = ? WHERE user_id = ?');

// Email last month's statement to every opted-in premium user, once per month.
// Safe to ping repeatedly — the last_statement_month marker makes it idempotent.
export async function runMonthlyStatements({ force = false } = {}) {
  const report = {
    month: prevMonthYM(),
    sent: 0,
    skipped: 0,
    failed: 0,
    recipients: [],
    opted_in: 0,
    skip_reasons: { not_premium: 0, already_sent_this_month: 0 },
    failures: [],
  };
  if (!emailConfigured()) return { ...report, error: 'email_not_configured' };

  const ym = report.month;
  for (const u of await statementEligible.all()) {
    report.opted_in += 1;
    if (!(await premiumState(u)).premium) {
      report.skipped += 1;
      report.skip_reasons.not_premium += 1;
      continue;
    }
    if (!force && u.last_statement_month === ym) {
      report.skipped += 1;
      report.skip_reasons.already_sent_this_month += 1;
      continue;
    }
    try {
      const data = await statementData(u, ym);
      await sendMail({
        to: u.email,
        subject: `Your Sampada statement — ${monthLabel(ym)}`,
        html: statementHtml(u, data),
      });
      await markStatement.run(ym, u.id);
      report.sent += 1;
      report.recipients.push(u.email);
    } catch (err) {
      report.failed += 1;
      if (report.failures.length < 5) report.failures.push({ email: u.email, error: err.message });
      console.error(`Statement failed for ${u.email}:`, err.message);
    }
  }
  if (!report.sent && !report.failed) {
    report.hint =
      report.opted_in === 0
        ? 'Nobody has monthly statements turned on (Settings → email).'
        : report.skip_reasons.not_premium === report.opted_in
          ? 'Everyone opted in has lapsed premium — statements are a premium feature.'
          : `Everyone due has already received the ${ym} statement.`;
  }
  return report;
}

export function startDigestScheduler() {
  if (!emailConfigured()) {
    console.log('Daily digest scheduler idle (SMTP not configured).');
    return;
  }
  // Hourly tick: each user gets their digest when THEIR clock hits their
  // chosen hour (per-user timezone). The per-day guard makes it idempotent.
  cron.schedule('0 * * * *', () => runDigests().then((r) => r.sent && console.log('Daily digests:', r)), {
    timezone: TZ,
  });
  // Monthly statements go out on the 1st, shortly after the digests.
  cron.schedule(`30 ${DIGEST_HOUR} 1 * *`, () => runMonthlyStatements().then((r) => console.log('Monthly statements:', r)), {
    timezone: TZ,
  });
  console.log(`Daily digest scheduler armed for ${DIGEST_HOUR}:00 ${TZ}.`);
}
