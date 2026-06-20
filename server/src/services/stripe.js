import { createHmac, timingSafeEqual } from 'node:crypto';
import { minorUnits } from './pricing.js';

const SECRET = process.env.STRIPE_SECRET_KEY || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

export const stripeConfigured = () => !!SECRET;

// Flatten nested params (objects + arrays) into Stripe's bracket form-encoding,
// e.g. line_items[0][price_data][currency]=usd.
function encode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === 'object') encode(v, key, out);
    else out.push([key, String(v)]);
  }
  return out;
}

async function stripe(path, params) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(encode(params)).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Stripe error (${res.status})`);
  return json;
}

// Hosted Stripe Checkout in subscription mode (auto-renews). Apple Pay / Google
// Pay show up automatically on supported devices; cards always work.
export async function createCheckout({ user, plan, baseUrl }) {
  const session = await stripe('/checkout/sessions', {
    mode: 'subscription',
    customer_email: user.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: plan.currency.toLowerCase(),
          unit_amount: minorUnits(plan.amount),
          recurring: { interval: plan.interval === 'annual' ? 'year' : 'month' },
          product_data: { name: `Sampada Premium — ${plan.interval}` },
        },
      },
    ],
    success_url: `${baseUrl}/settings?upgraded=1`,
    cancel_url: `${baseUrl}/settings`,
    metadata: { user_id: String(user.id), interval: plan.interval },
    subscription_data: { metadata: { user_id: String(user.id), interval: plan.interval } },
  });
  return { url: session.url, id: session.id };
}

// Verify a Stripe webhook signature (Stripe-Signature: t=...,v1=...,v1=...).
// Returns the parsed event, or null if the signature is missing/forged/stale.
// toleranceSec rejects replayed events outside the window (Stripe signs each
// delivery attempt — incl. retries — with a fresh timestamp, so 5 min is safe).
export function verifyStripeWebhook(rawBody, sigHeader, toleranceSec = 300) {
  if (!WEBHOOK_SECRET || !sigHeader) return null;
  let t;
  const candidates = []; // may be several v1's during secret rotation
  for (const part of String(sigHeader).split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i);
    const v = part.slice(i + 1);
    if (k === 't') t = v;
    else if (k === 'v1') candidates.push(v);
  }
  if (!t || !candidates.length) return null;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSec) return null;
  const expected = Buffer.from(createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest('hex'));
  const matched = candidates.some((sig) => {
    try {
      const got = Buffer.from(sig);
      return got.length === expected.length && timingSafeEqual(got, expected);
    } catch {
      return false;
    }
  });
  if (!matched) return null;
  try {
    return JSON.parse(rawBody.toString());
  } catch {
    return null;
  }
}
