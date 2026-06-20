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
    if (event.type === 'checkout.session.completed') {
      // First purchase — the session carries our metadata. Only provision once
      // the payment has actually settled; otherwise invoice.paid is the backstop.
      const md = obj.metadata || {};
      const userId = Number(md.user_id);
      const settled = !obj.payment_status || obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required';
      if (userId && settled) {
        await activatePremium(userId, {
          provider: 'stripe',
          providerSubId: obj.subscription,
          days: md.interval === 'annual' ? 366 : 31,
        });
      }
    } else if (event.type === 'invoice.paid') {
      // Each charge incl. renewals. The invoice's own metadata is empty, so find
      // the user by the subscription's metadata or the stored subscription id,
      // and trust Stripe's exact period end.
      const md = obj.subscription_details?.metadata || {};
      let userId = Number(md.user_id) || null;
      if (!userId && obj.subscription) userId = await userIdBySubId(obj.subscription);
      if (userId) {
        const endUnix = obj.lines?.data?.[0]?.period?.end || obj.period_end;
        const periodEnd = endUnix ? new Date(endUnix * 1000).toISOString() : undefined;
        await activatePremium(userId, { provider: 'stripe', providerSubId: obj.subscription, periodEnd, days: 31 });
      }
    } else if (event.type === 'customer.subscription.deleted') {
      let userId = Number(obj.metadata?.user_id) || null;
      if (!userId && obj.id) userId = await userIdBySubId(obj.id);
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
