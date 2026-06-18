import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, now } from '../db.js';

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const PLAN_ID = process.env.RAZORPAY_PLAN_ID || '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

// What the upgrade screen shows. Razorpay handles the actual amount via the plan.
export const PLAN = {
  label: 'Sampada Premium',
  amount: 99,
  currency: 'INR',
  period: 'monthly',
  blurb: 'Auto-sync brokers, unlimited holdings, and more.',
};

export const billingConfigured = () => !!(KEY_ID && KEY_SECRET);
export const canSubscribe = () => billingConfigured() && !!PLAN_ID;
export const publicKeyId = () => KEY_ID;

const getSub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?');
const upsertSub = db.prepare(`
  INSERT INTO subscriptions (user_id, plan, status, provider, provider_sub_id, current_period_end, updated_at)
  VALUES (?, 'premium', 'active', ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    plan='premium', status='active', provider=excluded.provider,
    provider_sub_id=excluded.provider_sub_id,
    current_period_end=excluded.current_period_end, updated_at=excluded.updated_at
`);

// Premium if you're an admin, or have an active subscription that hasn't lapsed.
export function premiumState(user) {
  if (user.role === 'admin') return { premium: true, plan: 'admin', until: null };
  const sub = getSub.get(user.id);
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

export function activatePremium(userId, { provider, providerSubId, days = 30, periodEnd } = {}) {
  const end = periodEnd || new Date(Date.now() + days * 86400000).toISOString();
  upsertSub.run(userId, provider || 'trial', providerSubId || null, end, now());
  return end;
}

const deactivateStmt = db.prepare(`
  UPDATE subscriptions SET plan='free', status='inactive', updated_at=? WHERE user_id=?
`);
export const deactivatePremium = (userId) => deactivateStmt.run(now(), userId);

// Record the pending Razorpay subscription id so the webhook can match it to the user.
const markPendingStmt = db.prepare(`
  INSERT INTO subscriptions (user_id, plan, status, provider, provider_sub_id, updated_at)
  VALUES (?, 'free', 'created', 'razorpay', ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET provider='razorpay', provider_sub_id=excluded.provider_sub_id, updated_at=excluded.updated_at
`);
export const markPending = (userId, subId) => markPendingStmt.run(userId, subId, now());

const bySubId = db.prepare('SELECT user_id FROM subscriptions WHERE provider_sub_id = ?');
export const userIdBySubId = (subId) => bySubId.get(subId)?.user_id || null;

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
export async function createSubscription() {
  const sub = await razorpay('/subscriptions', 'POST', {
    plan_id: PLAN_ID,
    total_count: 12, // 12 billing cycles
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
