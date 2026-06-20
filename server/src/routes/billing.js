import { Router } from 'express';
import { authRequired } from '../auth.js';
import { asyncHandler, HttpError } from '../util.js';
import {
  activatePremium,
  canSubscribe,
  createSubscription,
  deactivatePremium,
  markPending,
  premiumState,
  userIdBySubId,
  verifyWebhook,
} from '../services/billing.js';
import { planFor, providerFor } from '../services/pricing.js';
import { createCheckout, stripeConfigured, verifyStripeWebhook } from '../services/stripe.js';

export const billingRouter = Router();

// --- Razorpay webhook (no auth; signature-verified; raw body) ---
billingRouter.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    if (!verifyWebhook(req.rawBody, req.headers['x-razorpay-signature'])) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    const event = JSON.parse(req.rawBody.toString());
    const sub = event?.payload?.subscription?.entity;
    if (sub && /subscription\.(activated|charged|completed)/.test(event.event)) {
      const userId = await userIdBySubId(sub.id);
      if (userId) {
        const periodEnd = sub.current_end ? new Date(sub.current_end * 1000).toISOString() : undefined;
        await activatePremium(userId, { provider: 'razorpay', providerSubId: sub.id, periodEnd });
      }
    }
    res.json({ ok: true });
  })
);

// --- Stripe webhook (no auth; signature-verified; raw body) ---
billingRouter.post(
  '/stripe-webhook',
  asyncHandler(async (req, res) => {
    const event = verifyStripeWebhook(req.rawBody, req.headers['stripe-signature']);
    if (!event) return res.status(400).json({ error: 'Invalid signature' });
    const obj = event.data?.object || {};
    if (event.type === 'checkout.session.completed' || event.type === 'invoice.paid') {
      const md = obj.metadata || obj.subscription_details?.metadata || {};
      const userId = Number(md.user_id);
      if (userId) {
        await activatePremium(userId, {
          provider: 'stripe',
          providerSubId: obj.subscription || obj.id,
          days: md.interval === 'annual' ? 366 : 31,
        });
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const userId = Number(obj.metadata?.user_id);
      if (userId) await deactivatePremium(userId);
    }
    res.json({ received: true });
  })
);

// --- Authenticated billing endpoints ---
billingRouter.use(authRequired);

billingRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const cur = req.user.base_currency;
    const provider = providerFor(cur);
    const ready = provider === 'razorpay' ? canSubscribe('monthly') : stripeConfigured();
    res.json({
      state: await premiumState(req.user),
      provider,
      currency: cur,
      monthly: planFor(cur, 'monthly'),
      annual: planFor(cur, 'annual'),
      can_subscribe: ready,
    });
  })
);

// Start checkout — routes to Razorpay (India) or Stripe (rest of world).
billingRouter.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const interval = req.body.interval === 'annual' ? 'annual' : 'monthly';
    const cur = req.user.base_currency;
    const provider = providerFor(cur);
    const plan = planFor(cur, interval);

    if (provider === 'razorpay') {
      if (!canSubscribe(interval)) {
        return res.status(503).json({
          error: "Razorpay isn't set up for this plan yet — use the test trial, or add RAZORPAY_PLAN_ID(_ANNUAL).",
        });
      }
      const { subscriptionId, keyId } = await createSubscription(interval);
      await markPending(req.user.id, subscriptionId);
      return res.json({ provider: 'razorpay', subscription_id: subscriptionId, key_id: keyId, plan });
    }

    if (!stripeConfigured()) {
      return res.status(503).json({
        error: "Card / Apple Pay isn't set up yet — use the test trial, or add STRIPE_SECRET_KEY.",
      });
    }
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = process.env.APP_URL || process.env.BROKER_REDIRECT_BASE || `${proto}://${req.get('host')}`;
    const { url } = await createCheckout({ user: req.user, plan, baseUrl });
    return res.json({ provider: 'stripe', url, plan });
  })
);

// Owner-only: flip premium on without a real charge, for testing before the
// payment keys are live. NOT a customer free trial — admins only.
billingRouter.post(
  '/demo-activate',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') throw new HttpError(403, 'Not available');
    await activatePremium(req.user.id, { provider: 'trial', days: 30 });
    res.json({ state: await premiumState(req.user) });
  })
);
