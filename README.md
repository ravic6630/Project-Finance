# 🌱 Sampada

**Your wealth, all in one place.** Track stocks across **7 markets**, Indian **mutual funds**,
**cash & FDs**, **property, land, gold and other assets**, plus day-to-day income & expenses —
with live prices and live FX — and always know your true net worth in your own currency.

Live at **https://sampada-j9hi.onrender.com** · installable on your phone (Add to Home Screen).

---

## ✨ What it does

**Track everything**
- **Investments** — stocks from India (NSE/BSE), USA, UK, Ireland, Australia, New Zealand and
  Canada, plus Indian mutual funds. Live prices (Yahoo Finance) and NAVs (AMFI), auto-refreshing
  while the tab is open; per-holding gain/loss; manual price override when you want it.
- **Assets** — house, land, business, vehicles, gold — valued by you, shown beside your portfolio
  with per-type themed cards and share-of-total bars.
- **Cash & Bank** — savings, cash and fixed deposits (interest + maturity).
- **Transactions** — income/expense with categories (your own custom categories are remembered),
  monthly cashflow.
- **Multi-currency** — 7 currencies (INR/USD/GBP/EUR/AUD/NZD/CAD); switch the whole app's base
  currency any time, converted with live FX.

**Bring your money in**
- **Broker connect** — Upstox (stocks *and* mutual funds), Zerodha, Angel One, Fyers. Read-only
  OAuth; after the first login you can **Sync now** without logging in again (until the broker
  token expires). Free **sample data** preview for every broker.
- **CAS PDF import** — CAMS/KFintech or NSDL/CDSL Consolidated Account Statement → parsed, reviewed,
  imported (see setup below).
- **CSV import/export** — bring holdings from any broker on earth; export them back out.

**Watch it grow**
- **Dashboard** — a personalised hero (animated net worth, monthly change), a **net-worth history
  chart** with 1D→10Y ranges, asset allocation, income-vs-expense — plus **milestone confetti**
  when you cross big round numbers, and a **"Get growing" onboarding checklist**.
- **Goals & projections** *(premium)* — retirement, house, education… on-pace tracking and the exact
  monthly amount needed, in your base currency.
- **Calculator** — SIP, Lumpsum and **SWP** (withdrawal plan) — free, public, no login
  (`/calculators`), and inside the app from Goals.
- **Returns & tax** *(premium)* — true returns (XIRR) and capital-gains reports.
- **Price alerts** *(premium)* — emailed when a stock/fund crosses your target.
- **Daily digest** *(premium)* — a good-morning email with your net worth and allocation.

**The experience**
- Public **landing page**, app-wide **dark mode**, smooth motion (page transitions, staggered
  cards), custom empty-state illustrations, **⌘K / Ctrl-K command palette**, installable **PWA**
  with the sprout icon, in-app **support chat** with the admin (email notifications both ways).
- **Multi-user** — everyone gets a private account (email + OTP verification).
- **Admin panel** — user overview, grant/revoke premium, password resets, support inbox.
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

Create an account and you're in. On first signup, any email listed in `ADMIN_EMAILS` becomes an
admin (admins are always premium).

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
| Indian mutual funds | AMFI / mfapi.in | Search by name or AMFI scheme code; broker ISINs resolve automatically |
| FX (all 7 currencies) | open.er-api.com | Live, free |

Prices cache ~15 min (20 s while the Investments tab polls live). Stale prices are marked; manual
override always available.

---

## ⚙️ Configuration (`server/.env` or host env vars)

| Variable | Purpose |
|---|---|
| `ADMIN_EMAILS` | Comma-separated admin emails (always premium) |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Cloud SQLite (Turso); omit → local file `server/data/sampada.db` |
| `BREVO_API_KEY` | Transactional email (OTP, digest, alerts, chat notifications) — HTTP API, works on hosts that block SMTP. `SMTP_*` supported as fallback |
| `DIGEST_HOUR` | Daily digest hour, IST (default 8) |
| `CRON_SECRET` | Protects `/api/cron/digests` for an external scheduler (cron-job.org) — needed on free hosting that sleeps |
| `RAZORPAY_KEY_ID/KEY_SECRET/PLAN_ID(_ANNUAL)/WEBHOOK_SECRET` | Premium billing, India (UPI Autopay) |
| `STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET` | Premium billing, rest of world |
| `UPSTOX_API_KEY/SECRET` (also `ZERODHA_*`, `ANGELONE_*`, `FYERS_*`) | Broker connect keys; set each app's redirect URL to `<APP_URL>/broker/<broker>/callback` |
| `BROKER_REDIRECT_BASE` / `APP_URL` | Public base URL of the deployment |
| `FREE_HOLDINGS_LIMIT` | Free-plan holdings cap (default 15; premium is unlimited) |
| `JWT_SECRET`, `API_PORT` | Auth secret (auto-generated if unset), dev API port |

---

## ☁️ Deploying

```bash
npm run build   # web → web/dist
npm start       # one Node server: API + built site, honours PORT
```

Runs anywhere (Render, Railway, Fly, VPS). Use Turso for the database on hosts without persistent
disk. `Dockerfile`, `docker-compose.yml` and a full walkthrough live in **[DEPLOY.md](DEPLOY.md)**.
On free tiers that sleep, point a free pinger at `/api/cron/digests?secret=…` so the daily emails
fire; the app shows a friendly "waking the server 🌱" note during cold starts.

---

## 🧱 Project structure

```
Project Finance/
├── server/                 # Express API (ESM) · libsql/Turso · JWT
│   └── src/
│       ├── index.js        # app entry + route wiring
│       ├── db.js           # schema + additive migrations
│       ├── routes/         # auth, holdings, cash, assets, transactions, goals, alerts,
│       │                   # returns, dashboard, prices, import, broker, billing, email,
│       │                   # support, export, admin, cron
│       ├── services/       # prices/FX, portfolio, summary, importer, brokers, billing,
│       │                   # stripe, email, premiumEmail, digest, alerts, scheduler, goals
│       └── tools/cas/      # Python casparser bridge
└── web/                    # React 18 · Vite · Tailwind · Recharts · framer-motion
    └── src/
        ├── pages/          # Landing, Login/Signup, Dashboard, Investments, Goals, Returns,
        │                   # Cash, Assets, Transactions, Settings, Admin, Calculators
        ├── components/     # WealthHero, charts, import flows, SupportChat, CommandPalette,
        │                   # ThemeToggle, Illustrations, ui primitives
        └── lib/            # api client, auth context, theme, motion, milestones, format
    └── public/             # PWA manifest + icons
```

---

## 🔒 Data & privacy

- Passwords hashed (bcrypt); JWT sessions; email OTP on signup and password reset.
- Broker access is **read-only**; tokens are stored server-side and **never** exported or emailed.
- Every user can download their complete data as JSON from **Settings → Your data**.
- Local mode stores everything in `server/data/sampada.db` — copy it to back up.

⚠️ Before charging real money or handling others' financial data, review DPDP Act 2023 / SEBI
obligations with a professional and publish a privacy policy + terms.

---

Made with care — and a 🌱. Ideas or issues? There's a support chat inside the app.
