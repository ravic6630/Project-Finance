import { db, now } from '../db.js';
import { extendPremium } from './billing.js';
import { escapeHtml } from '../util.js';
import { sendMail, emailConfigured } from './email.js';

// One-time "welcome to Premium" email. Every activation path (Stripe/Razorpay
// webhooks, admin grant, demo) funnels through activatePremium(), which also
// fires on renewals and webhook retries — so we gate the email on an ATOMIC
// claim of the premium_welcome_sent_at column. The UPDATE only matches while the
// column is still NULL, so exactly one caller wins; everyone else is a no-op.
const claimWelcome = db.prepare(
  `UPDATE subscriptions SET premium_welcome_sent_at = ? WHERE user_id = ? AND premium_welcome_sent_at IS NULL`
);
const releaseWelcome = db.prepare(
  `UPDATE subscriptions SET premium_welcome_sent_at = NULL WHERE user_id = ?`
);
const getRecipient = db.prepare('SELECT email, name FROM users WHERE id = ?');

const APP_URL = process.env.APP_URL || process.env.BROKER_REDIRECT_BASE || 'https://sampada-j9hi.onrender.com';

const PERKS = [
  ['🎯', 'Goals &amp; projections', 'Set targets and see if you’re on pace, in your own currency.'],
  ['📈', 'True returns &amp; tax', 'XIRR performance and capital-gains reports on your real portfolio.'],
  ['🔄', 'Auto-sync brokers', 'Pull holdings from Upstox &amp; more, with unlimited holdings.'],
  ['📧', 'Daily email digest', 'A morning snapshot of your net worth — switch it on in Settings.'],
];

export function welcomeHtml(name, { grantedByAdmin }) {
  const who = name ? escapeHtml(String(name).split(' ')[0]) : 'there';
  const intro = grantedByAdmin
    ? 'An admin has upgraded your account to <b>Sampada Premium</b> — no charge. You now have full access to:'
    : 'Thank you for upgrading — your account is now <b>Sampada Premium</b>. You’ve unlocked:';
  const perks = PERKS.map(
    ([icon, title, desc]) => `
      <tr>
        <td style="vertical-align:top;padding:8px 10px 8px 0;font-size:20px;line-height:1">${icon}</td>
        <td style="padding:8px 0">
          <div style="font-weight:700;color:#1f3a66">${title}</div>
          <div style="color:#64748b;font-size:13px">${desc}</div>
        </td>
      </tr>`
  ).join('');

  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
    <h2 style="color:#1f3a66;margin:0 0 6px">🌱 Sampada</h2>
    <div style="background:linear-gradient(135deg,#1f3a66,#0f2547);border-radius:16px;padding:22px 20px;color:#fff;margin:14px 0">
      <div style="font-size:13px;font-weight:600;color:#c2a368;letter-spacing:.5px">PREMIUM ACTIVATED</div>
      <div style="font-size:24px;font-weight:800;margin-top:4px">${grantedByAdmin ? 'You’re now a Premium member 🎉' : 'Welcome to Premium 🎉'}</div>
    </div>
    <p style="margin:0 0 4px">Hi ${who},</p>
    <p style="color:#334155">${intro}</p>
    <table style="width:100%;border-collapse:collapse;margin:6px 0 18px">${perks}</table>
    <a href="${APP_URL}" style="display:inline-block;background:#1f3a66;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px">Open Sampada →</a>
    <p style="color:#94a3b8;font-size:12px;margin-top:22px">
      You’re receiving this because your Sampada account was upgraded to Premium.
      Questions? Just reply to this email.
    </p>
  </div>`;
}

// One free month for the referrer, the first time their invitee goes premium.
// Guarded by its own atomic flag on the REFERRED user, so webhook retries and
// email failures can never double-reward.
const claimReferral = db.prepare(
  'UPDATE users SET referral_rewarded_at = ? WHERE id = ? AND referred_by IS NOT NULL AND referral_rewarded_at IS NULL'
);
const getReferrer = db.prepare(
  'SELECT r.id, r.email, r.name FROM users u JOIN users r ON r.id = u.referred_by WHERE u.id = ?'
);

async function maybeRewardReferrer(userId) {
  try {
    const res = await claimReferral.run(now(), userId);
    if (!res.changes) return; // no referrer, or already rewarded
    const referrer = await getReferrer.get(userId);
    if (!referrer) return;
    await extendPremium(referrer.id, 31);
    if (emailConfigured()) {
      const invitee = await getRecipient.get(userId);
      await sendMail({
        to: referrer.email,
        subject: 'Your invite just earned you a free month of Premium 🎁',
        html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
          <h2 style="color:#1f3a66;margin:0 0 8px">🌱 Sampada</h2>
          <p>Hi ${escapeHtml((referrer.name || 'there').split(' ')[0])},</p>
          <p style="color:#334155">Someone you invited${invitee?.email ? ` (<b>${escapeHtml(invitee.email)}</b>)` : ''} just became a Premium member — so we've added <b>31 days of Premium</b> to your account. Thank you for spreading the word! 🎁</p>
        </div>`,
      }).catch((e) => console.error('[referral] email failed:', e.message));
    }
  } catch (e) {
    console.error('[referral] reward failed:', e.message);
  }
}

// Send the welcome email exactly once for this user. Never throws — a failed
// send is logged and the claim is released so a later retry can re-attempt.
// Returns true only when an email was actually sent.
export async function sendPremiumWelcome(userId, { provider } = {}) {
  let claimed = false;
  try {
    const res = await claimWelcome.run(now(), userId);
    if (!res.changes) return false; // already welcomed (renewal, retry, or no row)
    claimed = true;
    // First-ever activation — settle the referral reward regardless of email.
    await maybeRewardReferrer(userId);
    if (!emailConfigured()) return false;
    const user = await getRecipient.get(userId);
    if (!user?.email) return false;
    await sendMail({
      to: user.email,
      subject: provider === 'admin' ? 'You’re now a Sampada Premium member 🎉' : 'Welcome to Sampada Premium 🎉',
      html: welcomeHtml(user.name, { grantedByAdmin: provider === 'admin' }),
    });
    return true;
  } catch (e) {
    console.error('[premium-welcome] email failed:', e.message);
    if (claimed) {
      try {
        await releaseWelcome.run(userId); // let a later activation/retry try again
      } catch {
        /* best effort */
      }
    }
    return false;
  }
}
