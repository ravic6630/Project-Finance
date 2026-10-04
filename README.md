# 🌱 Sampada

**Your wealth, all in one place.** Track stocks across **7 markets**, Indian **mutual funds**,
**cash & FDs**, **property, land, gold and other assets**, plus day-to-day income & expenses —
with live prices and live FX — and always know your true net worth in your own currency.

Live at **https://sampada-j9hi.onrender.com** · installable on your phone (Add to Home Screen) ·
native **iOS & Android** apps from the same codebase ([MOBILE.md](MOBILE.md)).

---

## ✨ What it does

**Track everything**
- **Investments** — stocks from India (NSE/BSE), USA, UK, Ireland, Australia, New Zealand and
  Canada, plus Indian mutual funds. Live prices (Yahoo Finance) and NAVs (AMFI), auto-refreshing
  while the tab is open; per-holding gain/loss; manual price override when you want it. Buying
  more of something you already hold updates that position (weighted average cost) instead of
  adding a second row.
- **Assets** — house, land, business, vehicles, gold — valued by you, shown beside your portfolio.
- **Cash & Bank** — savings, cash and fixed deposits (interest + maturity). **Add money / Spend**
  on any account in one step, optionally logged as a transaction so your cashflow fills itself in.
- **Transactions** — income/expense with your own categories, **recurring rules** (salary, rent,
  SIPs — back-dated rules fill past months) and **monthly budgets** (one-tap starter template).
- **Multi-currency** — 7 currencies (INR/USD/GBP/EUR/AUD/NZD/CAD); switch the whole app's base
  currency any time, converted with live FX. Amounts you type — a goal's target, your FI spending
  or target — keep the currency you typed them in and convert live wherever you view them.

**Bring your money in**
- **Broker connect** *(premium)* — Upstox (stocks *and* mutual funds), Zerodha, Angel One, Fyers.
  Read-only OAuth; after the first login you can **Sync now** without logging in again (until the
  broker token expires), and a re-sync removes positions you've sold. Free **sample data** preview
  for every broker.
- **CAS PDF import** — CAMS/KFintech or NSDL/CDSL Consolidated Account Statement → parsed, reviewed,
  imported (see setup below). Re-importing next month's statement updates holdings in place.
- **CSV import/export** — bring holdings from any broker on earth; export them back out.

**See where you stand**
- **Dashboard** — a personalised hero whose entrance matches the landing page (rows rise in, net
  worth counts up), a **"since your last visit"** briefing,
  a **zoomable asset-allocation sunburst** (click any slice to drill in), income vs expense once
  there's cashflow, **milestone confetti** and a **"Get growing"** checklist.
- **Net-worth history** *(premium)* — 1D → 10Y ranges, with a **benchmark overlay**: NIFTY 50,
  S&P 500, FTSE 100, EURO STOXX 50, ASX 200, NZX 50 or S&P/TSX, scaled to your starting value.
- **Goals hub** — three tabs on one page (`/goals?tab=…`):
  - **Goals** *(premium)* — a **goal plan** that spreads what you actually own and what you
    actually save across your goals, in priority order: an emergency fund first, then the soonest
    date (or your own order). Each goal takes only what it needs today, so no rupee is counted
    twice and progress rises and falls with your wealth. Your monthly surplus (income − spending,
    or an amount you set) is shared the same way, and the plan shows what's left over — or how
    far short it falls, with the extra a month or the later date each goal would need.
    **Choose exactly what funds a goal** — a liquid fund, half an equity fund, a fixed amount of
    a savings account, gold you mean to sell — and it tracks precisely those, to the rupee, with
    nothing added by guesswork. Each item is labelled for what it is (bank, liquid or debt fund,
    equity, property) and the goal says whether that mix suits how soon the money is needed. Two
    goals can't claim more of an item than it holds; goals you haven't chosen for fill
    automatically from the rest.
  - **Calculator** — SIP, Lumpsum and **SWP** (withdrawal plan) with step-up and inflation. Free,
    and also public with no login at `/calculators`.
  - **Insights** *(premium)* — **Financial independence**: your number is what N years of your
    life cost (measured from your real spending, each year grown at inflation) or a target you
    name; choose which pots count; see progress, a projected date and Coast-FI, with every
    assumption editable and the working shown. **Concentration & allocation**: a spread score,
    your largest positions, market and currency exposure, and plain-language flags.
- **Returns & tax** *(premium)* — true returns (XIRR), realised/unrealised short- and long-term
  gains, CSV export.
- **Price alerts** *(premium)* — emailed when a stock/fund crosses your target.
- **Daily digest** *(premium)* — a good-morning email at **your own hour and timezone**.
- **Monthly statements** — a crisp printable report per month (Save as PDF from the browser);
  emailed on the 1st if you opt in *(premium)*.

**Family & legacy**
- **Family portfolios** — track a spouse or parents under your login; switch between
  **Everyone · Me · each member** from the header.
- **Linked accounts** — invite family members who have their own Sampada login. Nothing is shared
  until they accept; either side can unlink at any time. Only the balance sheet is shared —
  transactions, goals and budgets stay private to each login.
- **Legacy** — a nominee audit across accounts, holdings and assets, a printable **Money Map**,
  and an optional inactivity switch: name a linked family member, and if you don't sign in for the
  period you choose (30 days to a year) you're warned first, then they're shown your Money Map,
  read-only. It closes the moment you sign in again.

**Premium & payments**
- Monthly or annual plans priced per currency (from ₹99/month), via **Razorpay** (India, UPI
  Autopay) or **Stripe** (everywhere else). A manual **"pay directly"** option (UPI QR / Zelle)
  works before the gateways are live — the admin verifies and grants.
- **Referrals** — invite a friend with your link; when they first upgrade, you get a month of
  Premium.

**The experience**
- Public **landing page**, app-wide **dark mode**, motion design throughout (transform/opacity
  only, and it switches off under *reduce motion*), custom empty-state illustrations,
  **⌘K / Ctrl-K command palette**, installable **PWA** plus native apps, and in-app
  **support chat** with the admin (email notifications both ways).
- **Multi-user** — everyone gets a private account (email + OTP verification).
- **Admin panel** — user overview, grant/revoke premium, support inbox, and password resets
  (a generated or chosen password, shown once, with the option to sign the user out everywhere).
- **Your data** — one-click full-account **JSON export** from Settings (broker tokens never
  included).

> All price/FX sources are free — no data-provider signups required.

---

## 🚀 Getting started (local)

**Requirements:** [Node.js](https://nodejs.org) 22.5+ (`.nvmrc` pins 24).

```bash
npm install     # server + web
npm run dev     # API :4000 + website :3000 together
# open http://localhost:3000
```

Create an account and you're in. Any email listed in `ADMIN_EMAILS` becomes an admin (admins are
always premium). With no email provider configured, one-time codes are printed to the server log.

---

## 🧪 Tests

Server-side suites live in `server/test-*.mjs`. Most talk to the dev API, so start `npm run dev`
first, then from `server/`:

```bash
node --env-file-if-exists=.env test-sweep.mjs      # whole-app regression sweep, every router
node --env-file-if-exists=.env test-insights.mjs   # or any focused suite
```

Focused suites cover the goal plan and goal funding, insights, legacy, statements, login security, digest timing,
holding merges, cash adjustments, broker pruning, allocation, pricing and more. `test-email-pipeline.mjs` starts
its own API instance and a local SMTP server. The suites create throwaway users, so point them at
a local database, never production. Lint with `npm run lint`.

---

## 📥 CAS import (optional one-time setup)

```bash
bash server/tools/cas/setup.sh
```

Installs a small Python venv with [`casparser`](https://github.com/codereverser/casparser).
Mutual funds import fully (AMFI-matched); demat stocks too on Python 3.10+. Use the **original**
PDF from CAMS/KFintech/NSDL — re-saved PDFs don't parse. In the app: **Investments → Import CAS**.

---

## 💵 How prices work

| Asset | Source | Notes |
|---|---|---|
| Stocks (7 markets) | Yahoo Finance | Ticker per market, e.g. `AAPL`, `RELIANCE` (`.NS` auto), `BARC` (UK), `RY` (Canada) |
| Indian mutual funds | AMFI / mfapi.in | Search by name or AMFI scheme code; broker ISINs resolve automatically; the scheme category (liquid, debt, equity…) is recorded too |
| FX (all 7 currencies) | open.er-api.com | Live, free; cached 6 h |

Prices cache 15 min; the Investments page polls every 30 s on a 20 s cache. When Yahoo's live
quote is stale (common for REITs), the latest daily close is used instead. Stale prices are
marked; manual override is always available.

---

## ⚙️ Configuration (`server/.env` or host env vars)

Only names and purposes are listed here — keep real values in your host's secret settings, never
in the repo. Templates: `server/.env.example` (local) and `.env.production.example`.

| Variable | Purpose |
|---|---|
| `ADMIN_EMAILS` | Comma-separated admin emails (always premium) |
| `JWT_SECRET` | Session signing secret (auto-generated locally if unset) |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Cloud SQLite (Turso); omit → local file `server/data/sampada.db` |
| `APP_URL` / `BROKER_REDIRECT_BASE` | Public base URL of the deployment |
| `BREVO_API_KEY` / `EMAIL_FROM` | Transactional email (codes, digest, statements, alerts, chat) over HTTP — works on hosts that block SMTP |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` | SMTP fallback when Brevo isn't set |
| `DIGEST_HOUR` | IST hour the monthly statements go out on the 1st (default 8); daily digests follow each user's own hour |
| `CRON_SECRET` | Protects the `/api/cron/*` endpoints for an external scheduler |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_PLAN_ID` / `RAZORPAY_PLAN_ID_ANNUAL` / `RAZORPAY_WEBHOOK_SECRET` | Premium billing, India (UPI Autopay) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Premium billing, rest of world |
| `MANUAL_UPI_ID` / `MANUAL_UPI_NAME` / `MANUAL_ZELLE_ID` | Payee details for the manual "pay directly" option |
| `UPSTOX_API_KEY/SECRET` (also `ZERODHA_*`, `ANGELONE_*`, `FYERS_*`) | Broker connect keys; set each app's redirect URL to `<APP_URL>/broker/<broker>/callback` |
| `FREE_HOLDINGS_LIMIT` | Free-plan holdings cap (default 15; premium is unlimited) |
| `CAS_PYTHON` | Python interpreter for CAS parsing (the Docker image sets it) |
| `API_PORT` / `PORT` | Dev API port (default 4000) / production port |

---

## ☁️ Deploying

```bash
npm run build   # web → web/dist
npm start       # one Node server: API + built site, honours PORT
```

Runs anywhere (Render, Railway, Fly, VPS). Use Turso for the database on hosts without persistent
disk. `Dockerfile`, `docker-compose.yml`, `render.yaml` and a full walkthrough live in
**[DEPLOY.md](DEPLOY.md)**; **[LAUNCH.md](LAUNCH.md)** is the go-live checklist. Database
migrations are additive and run automatically on startup.

On free tiers that sleep, point a free pinger (e.g. cron-job.org) at `/api/cron/run` every ~10
minutes, passing `CRON_SECRET` as `?key=…` or an `Authorization: Bearer …` header. Each run
refreshes prices, then sends price alerts, due digests and monthly statements, and runs the legacy
checks — every job is idempotent, so frequent pings are safe. Add `&wait=1` to get a report that
explains anything that wasn't sent. The app shows a friendly "waking the server 🌱" note during
cold starts.

---

## 📱 Mobile apps

The iOS and Android apps wrap the same React app with Capacitor; the web bundle is compiled into
the app and talks to the same API.

```bash
npm run mobile:android          # debug APK
npm run mobile:android:release  # Play Store bundle (needs your own signing setup)
npm run mobile:ios              # opens the Xcode project
```

Face ID / Touch ID / fingerprint **app lock**, haptics and the native share sheet come with the
native builds. Setup and signing: **[MOBILE.md](MOBILE.md)**; store listing kit:
**[PLAY_STORE.md](PLAY_STORE.md)**.

---

## 🧱 Project structure

```
Project Finance/
├── server/                 # Express API (ESM) · libsql/Turso · JWT
│   ├── src/
│   │   ├── index.js        # app entry + route wiring
│   │   ├── db.js           # schema + additive migrations
│   │   ├── routes/         # auth, holdings, cash, assets, transactions, recurring, budgets,
│   │   │                   # dashboard, goals, insights, returns, alerts, statements, prices,
│   │   │                   # import, broker, billing, email, family, profiles, legacy,
│   │   │                   # support, export, admin, cron
│   │   ├── services/       # prices/FX, portfolio, summary, allocationTree, networth, briefing,
│   │   │                   # insights/ (fi, risk), goalPlan, goalFunding, returns, recurring, statement, digest,
│   │   │                   # email, scheduler, alerts, family, legacy, importer, brokers,
│   │   │                   # billing, pricing, stripe, totp
│   │   └── tools/cas/      # Python casparser bridge
│   └── test-*.mjs          # regression + focused test suites
└── web/                    # React 18 · Vite · Tailwind · Recharts · framer-motion · Capacitor
    ├── src/
    │   ├── pages/          # Landing, Login/Signup, Dashboard, Investments, Goals (+ Calculator
    │   │                   # & Insights tabs), Returns, Cash, Assets, Transactions, Legacy,
    │   │                   # Settings, Admin, Calculators, Privacy
    │   ├── components/     # WealthHero, AllocationSunburst, insights/, import flows, Budgets,
    │   │                   # RecurringRules, SecurityCard, SupportChat, CommandPalette, fx
    │   │                   # (motion primitives), ui primitives
    │   └── lib/            # api client, auth + profile context, theme, motion, format, markets
    ├── public/             # PWA manifest + icons
    └── android/ · ios/     # native Capacitor projects
```

---

## 🔒 Data & privacy

- Passwords hashed (bcrypt); JWT sessions you can see and revoke per device; email OTP on signup
  and password reset.
- Optional **two-factor authentication** (any authenticator app). After three wrong passwords, a
  correct one also needs a one-time code from your email. Sign-in endpoints are rate-limited.
- Broker access is **read-only**; tokens are stored server-side and **never** exported or emailed.
- Family links are consent-based and revocable; a Money Map is visible only to the one person you
  name, and only after the inactivity switch releases it.
- Every user can download their complete data as JSON from **Settings → Your data**. The privacy
  policy is served at `/privacy`.
- Local mode stores everything in `server/data/sampada.db` — copy it to back up.

⚠️ Before charging real money or handling others' financial data, review DPDP Act 2023 / SEBI
obligations with a professional and keep the privacy policy and terms current.

---

Made with care — and a 🌱. Ideas or issues? There's a support chat inside the app.
