# Sampada — go-live checklist

Everything you set in your host's **Environment** (e.g. Render) to take Sampada
live. See `DEPLOY.md` for the deploy mechanics and `.env.production.example` for
the full list. Anything optional can be added later — the app runs without it.

The app is **free to use** (dashboard, holdings across 6 markets, live prices,
public calculators). **Premium** features (Returns & tax, Goals, Net-worth
history, Price alerts, broker auto-sync, daily email) are **paid-only** — there
is no free trial. You (admin) are always premium.

---

## 1. Core — required

| Key | What |
|---|---|
| `JWT_SECRET` | Any long random string (keeps everyone logged in across restarts). |
| `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | Free cloud SQLite (turso.tech) — persists data across redeploys. |
| `ADMIN_EMAILS` | `ralathuru@gmail.com` — makes that account admin + always-premium. |

Deploy on Render (Docker) per `DEPLOY.md`. Without Turso, data resets on every redeploy.

## 2. Email — REQUIRED (account verification + daily digest + alerts)

New signups must confirm a 6-digit code emailed to them, so **email must be
configured or no one can create an account** (the daily digest and price alerts
use the same channel). Render's free tier blocks SMTP, so use **Brevo's HTTP API**:

| Key | What |
|---|---|
| `BREVO_API_KEY` | From brevo.com → SMTP & API → API Keys. |
| `EMAIL_FROM` | e.g. `Sampada <ralathuru@gmail.com>` (verify this sender in Brevo). |

(Gmail SMTP also works on a paid host — see `.env.production.example`.) If email
ever fails to send, the verification code is written to the server logs as a fallback.

## 3. Daily automation — so the 8am email actually fires

Render free sleeps when idle, so an external scheduler wakes it:

1. Set `CRON_SECRET` to a long random string.
2. Free account at **cron-job.org** → daily 08:00 Asia/Kolkata →
   `GET https://<your-app>/api/cron/digests?key=<CRON_SECRET>`

## 4. Payments — when you're ready to charge

Checkout is **country-aware and auto-renewing**. Monthly or annual (**annual =
12 months − 10%**), priced per currency.

### India (base currency INR) → Razorpay (UPI + card)

| Key | What |
|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | API keys (start with TEST keys). |
| `RAZORPAY_PLAN_ID` | A **monthly** plan you create in Razorpay (₹99). |
| `RAZORPAY_PLAN_ID_ANNUAL` | An **annual** plan (~₹1,069 = −10%). |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook → `https://<your-app>/api/billing/webhook` |

### Everyone else → Stripe (Apple Pay / Google Pay / card)

| Key | What |
|---|---|
| `STRIPE_SECRET_KEY` | From the Stripe dashboard (start in test mode). |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from the webhook you create. |

Point the Stripe webhook at `https://<your-app>/api/billing/stripe-webhook`,
events: `checkout.session.completed`, `invoice.paid`,
`customer.subscription.deleted`. Prices are created automatically — no need to
pre-make Stripe Products/Prices.

## 5. Broker auto-sync — optional

`ZERODHA_API_KEY/_SECRET`, `UPSTOX_API_KEY/_SECRET`, and
`BROKER_REDIRECT_BASE=https://<your-domain>`. Each broker app's redirect URL must
be `https://<your-domain>/broker/<broker>/callback`.

---

## Go-live order

1. Deploy with **section 1 + section 2 (email)** set — email must work *before* the
   first signup. Create your admin account, confirm the 6-digit code lands in your
   inbox, then sign in. (Settings → *Send test* should also reach you.)
2. Add **daily automation** (section 3).
3. Add **payments** (section 4) in **test mode** first → upgrade a non-admin test
   account end-to-end → then swap to live keys.
4. (Optional) Add brokers (section 5).
5. Point your domain (`vyomarafarms.com`) at the host's custom-domain records.

To preview premium before payment keys are live: the **admin** account is premium
automatically (`ADMIN_EMAILS`), so you can demo every paid feature immediately.
