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

// Verify a Stripe webhook signature (Stripe-Signature: t=...,v1=...).
export function verifyStripeWebhook(rawBody, sigHeader) {
  if (!WEBHOOK_SECRET || !sigHeader) return null;
  const parts = Object.fromEntries(String(sigHeader).split(',').map((kv) => kv.split('=')));
  if (!parts.t || !parts.v1) return null;
  const expected = createHmac('sha256', WEBHOOK_SECRET).update(`${parts.t}.${rawBody}`).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1))
      ? JSON.parse(rawBody.toString())
      : null;
  } catch {
    return null;
  }
}
