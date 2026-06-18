import { Router } from 'express';
import { authRequired } from '../auth.js';
import { asyncHandler } from '../util.js';
import {
  activatePremium,
  canSubscribe,
  billingConfigured,
  createSubscription,
  markPending,
  PLAN,
  premiumState,
  userIdBySubId,
  verifyWebhook,
} from '../services/billing.js';

export const billingRouter = Router();

// --- Webhook (no auth; verified by signature). Mounted first; uses raw body. ---
billingRouter.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    if (!verifyWebhook(req.rawBody, signature)) {
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

// --- Authenticated billing endpoints ---
billingRouter.use(authRequired);

billingRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    res.json({
      plan: PLAN,
      state: await premiumState(req.user),
      configured: billingConfigured(),
      can_subscribe: canSubscribe(),
    });
  })
);

billingRouter.post(
  '/subscribe',
  asyncHandler(async (req, res) => {
    if (!canSubscribe()) {
      return res.status(503).json({
        error:
          "Payments aren't set up yet. Add RAZORPAY_KEY_ID, _KEY_SECRET and _PLAN_ID to server/.env. Meanwhile use 'Start test trial'.",
      });
    }
    const { subscriptionId, keyId, shortUrl } = await createSubscription();
    await markPending(req.user.id, subscriptionId);
    res.json({ subscription_id: subscriptionId, key_id: keyId, short_url: shortUrl, plan: PLAN });
  })
);

// Test/trial activation — flips on premium without a real charge (dev + free trial).
billingRouter.post(
  '/demo-activate',
  asyncHandler(async (req, res) => {
    await activatePremium(req.user.id, { provider: 'trial', days: 30 });
    res.json({ state: await premiumState(req.user) });
  })
);
