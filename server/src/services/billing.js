import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, now } from '../db.js';
import { HttpError } from '../util.js';

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const PLAN_ID = process.env.RAZORPAY_PLAN_ID || '';
const PLAN_ID_ANNUAL = process.env.RAZORPAY_PLAN_ID_ANNUAL || '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

const razorpayPlanId = (interval) => (interval === 'annual' ? PLAN_ID_ANNUAL : PLAN_ID);

// What the upgrade screen shows. Razorpay handles the actual amount via the plan.
export const PLAN = {
  label: 'Sampada Premium',
  amount: 99,
  currency: 'INR',
  period: 'monthly',
  blurb: 'Auto-sync brokers, unlimited holdings, and more.',
};

export const billingConfigured = () => !!(KEY_ID && KEY_SECRET);
export const canSubscribe = (interval = 'monthly') => billingConfigured() && !!razorpayPlanId(interval);
export const publicKeyId = () => KEY_ID;

const getSub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?');
// NOTE: this upsert must never touch premium_welcome_sent_at. The one-time
// welcome email (services/premiumEmail.js) relies on that column surviving a
// renewal — adding it here would re-send the email on every charge.
const upsertSub = db.prepare(`
  INSERT INTO subscriptions (user_id, plan, status, provider, provider_sub_id, current_period_end, updated_at)
  VALUES (?, 'premium', 'active', ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    plan='premium', status='active', provider=excluded.provider,
    provider_sub_id=excluded.provider_sub_id,
    current_period_end=excluded.current_period_end, updated_at=excluded.updated_at
`);

// Premium if you're an admin, or have an active subscription that hasn't lapsed.
export async function premiumState(user) {
  if (user.role === 'admin') return { premium: true, plan: 'admin', until: null };
  const sub = await getSub.get(user.id);
  const active =
    sub?.status === 'active' &&
    (!sub.current_period_end || Date.parse(sub.current_period_end) > Date.now());
  return {
    premium: !!active,
    plan: active ? 'premium' : 'free',
    until: active ? sub.current_period_end : null,
    provider: sub?.provider || null,
  };
}

// The free plan tracks a limited number of holdings ("unlimited holdings" is a
// Premium perk). Throws a friendly 402 when adding would exceed the cap.
export const FREE_HOLDINGS_LIMIT = Number(process.env.FREE_HOLDINGS_LIMIT) || 15;
const countHoldings = db.prepare('SELECT COUNT(*) AS n FROM holdings WHERE user_id = ?');

export async function assertHoldingsCapacity(user, adding = 1) {
  if ((await premiumState(user)).premium) return;
  const n = Number((await countHoldings.get(user.id))?.n || 0);
  if (n + adding > FREE_HOLDINGS_LIMIT) {
    throw new HttpError(
      402,
      `The free plan tracks up to ${FREE_HOLDINGS_LIMIT} holdings (you have ${n}). Upgrade to Sampada Premium for unlimited holdings.`
    );
  }
}

export async function activatePremium(userId, { provider, providerSubId, days = 30, periodEnd } = {}) {
  const end = periodEnd || new Date(Date.now() + days * 86400000).toISOString();
  // Fall back to the pending checkout id when the webhook didn't carry one, so
  // the live subscription stays linked for future renewals.
  let subId = providerSubId || null;
  if (!subId) {
    subId = (await getSub.get(userId))?.pending_sub_id || null;
  }
  await upsertSub.run(userId, provider || 'trial', subId, end, now());
  // The checkout is settled — free the slot so a later one can't be confused
  // with it.
  await db.prepare('UPDATE subscriptions SET pending_sub_id = NULL WHERE user_id = ?').run(userId);
  return end;
}

// Referral rewards: push an active subscription's end out by N days, or grant
// a fresh premium window if there isn't one. Keeps the existing provider so a
// paying subscriber's Stripe/Razorpay linkage is untouched.
export async function extendPremium(userId, days = 31, fallbackProvider = 'referral') {
  const sub = await getSub.get(userId);
  const activeUntil =
    sub?.status === 'active' && sub.current_period_end && Date.parse(sub.current_period_end) > Date.now()
      ? Date.parse(sub.current_period_end)
      : Date.now();
  const end = new Date(activeUntil + days * 86400000).toISOString();
  await upsertSub.run(userId, sub?.provider || fallbackProvider, sub?.provider_sub_id || null, end, now());
  return end;
}

const deactivateStmt = db.prepare(`
  UPDATE subscriptions SET plan='free', status='inactive', premium_welcome_sent_at=NULL, updated_at=? WHERE user_id=?
`);
// Clearing premium_welcome_sent_at means a lapsed member who re-subscribes later
// gets a fresh welcome email (they've "become premium" again).
export const deactivatePremium = (userId) => deactivateStmt.run(now(), userId);

// Record the pending Razorpay subscription id so the webhook can match it to
// the user. It goes in its OWN column: writing it over provider_sub_id would
// break renewal webhooks for an existing subscriber who merely opens the
// upgrade screen again (their live subscription id would be replaced by a
// checkout that may never complete). Status/provider are left alone for the
// same reason — activatePremium sets those once the money actually lands.
const markPendingStmt = db.prepare(`
  INSERT INTO subscriptions (user_id, plan, status, provider, pending_sub_id, updated_at)
  VALUES (?, 'free', 'created', 'razorpay', ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET pending_sub_id=excluded.pending_sub_id, updated_at=excluded.updated_at
`);
export const markPending = (userId, subId) => markPendingStmt.run(userId, subId, now());

// Match on either column: the id arriving from a webhook is the live one for a
// renewal, or the pending one for a first activation.
const bySubId = db.prepare(
  'SELECT user_id FROM subscriptions WHERE provider_sub_id = ? OR pending_sub_id = ?'
);
export const userIdBySubId = async (subId) => (subId ? (await bySubId.get(subId, subId))?.user_id || null : null);

async function razorpay(path, method = 'GET', body) {
  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.description || `Razorpay error (${res.status})`);
  return json;
}

// Create a Razorpay subscription (UPI Autopay / card mandate) for checkout.
export async function createSubscription(interval = 'monthly') {
  const sub = await razorpay('/subscriptions', 'POST', {
    plan_id: razorpayPlanId(interval),
    total_count: interval === 'annual' ? 5 : 12, // 5 yearly or 12 monthly cycles
    customer_notify: 1,
  });
  return { subscriptionId: sub.id, shortUrl: sub.short_url, keyId: KEY_ID };
}

// Verify a Razorpay webhook signature against the raw request body.
export function verifyWebhook(rawBody, signature) {
  if (!WEBHOOK_SECRET || !signature) return false;
  const expected = createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
