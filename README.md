# 🌱 Sampada

**Your wealth, all in one place.** Track your Indian stocks, US stocks, mutual funds, cash, fixed
deposits and day-to-day income & expenses — with live prices and live exchange rates — and always
know your true net worth in ₹ or $.

Built for you, your family and your friends: everyone gets their own private account.

---

## ✨ What it does

- **Investments** — Indian stocks (NSE/BSE), US stocks, and Indian mutual funds.
  - Live stock prices from Yahoo Finance, live mutual-fund NAVs from AMFI.
  - Per-holding gain/loss and percentage, grouped by asset class.
  - Optional **manual price override** if you ever want to fix a price yourself.
- **Cash & Bank** — savings accounts, cash, and fixed deposits (with interest rate & maturity).
- **Transactions** — log income and expenses by category and see your monthly cashflow.
- **Dashboard** — total net worth, asset allocation, 6-month income-vs-expense chart, and
  investments-by-class breakdown.
- **Multi-currency** — hold assets in ₹ and $; switch the whole app between INR and USD using live
  FX rates.
- **Multi-user** — each person signs up with their own email; their data is completely private.
- **CAS import** — upload your Consolidated Account Statement (CAS) PDF and Sampada reads all your
  mutual funds (and demat stocks) at once, with duplicate detection and a review step before saving.

> No API keys and no signups with any data provider are required — all price/FX sources are free.

---

## 🚀 Getting started

**Requirements:** [Node.js](https://nodejs.org) **22.5 or newer** (uses the built-in SQLite). Check
with `node -v`. This repo pins Node 24 via `.nvmrc`.

```bash
# 1. Install everything (server + web)
npm install

# 2. Start the app (API + website together)
npm run dev

# 3. Open the website
#    → http://localhost:3000
```

That's it. The first time you open it, click **Create an account**, and you're in.

The API runs on port 4000 and the website on 3000 (the website talks to the API automatically).

---

## 👨‍👩‍👧‍👦 Sharing with family & friends

While `npm run dev` is running, anyone on the **same Wi-Fi/network** can use it too:

1. Find your computer's local IP (e.g. `192.168.0.169`) — `npm run dev` prints a **Network** URL.
2. Share `http://<your-ip>:3000` with them.
3. Each person clicks **Create an account** — their holdings, accounts and transactions stay
   private to their own login.

To let people use it from **anywhere** (not just your network), see *Deploying later* below.

---

## 📥 Importing holdings from your CAS (optional)

Instead of typing each holding, you can upload your **CAS** (Consolidated Account Statement) — one
PDF that lists everything you hold. Sampada parses it, shows a review screen, and imports what you
pick.

**One-time setup** (enables the parser):

```bash
bash server/tools/cas/setup.sh
```

This creates a small Python environment and installs the open-source
[`casparser`](https://github.com/codereverser/casparser) library. Notes:

- **Mutual funds** import fully (matched to live NAVs via their AMFI code).
- **Demat stocks** also import when running **Python 3.10+** (older Python parses mutual funds only).
- Use the **original** statement PDF emailed by CDSL/NSDL or CAMS/KFintech — re-saved/printed PDFs
  don't parse.

How to get your CAS:
- **Mutual funds:** [CAMS](https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement)
  or [KFintech](https://mfs.kfintech.com/investor/General/ConsolidatedAccountStatement) → email mailback.
- **Stocks + funds together:** [NSDL CAS](https://nsdl.co.in/nsdlcas/) (monthly email if you have a demat account).

In the app: **Investments → Import CAS → upload + password → review → Import**. No CAS handy? Click
**"Try with sample data"** to see how it works.

---

## 💵 How prices work

| Asset | Source | Notes |
|---|---|---|
| US stocks | Yahoo Finance | Enter the ticker, e.g. `AAPL`, `MSFT` |
| Indian stocks | Yahoo Finance | Enter the ticker, e.g. `RELIANCE`, `TCS` (we add `.NS` for NSE automatically; use `.BO` for BSE) |
| Indian mutual funds | AMFI / mfapi.in | Search by name to pick the fund, or paste the AMFI scheme code |
| Exchange rate (₹ ↔ $) | open.er-api.com | Live, free |

Prices are cached for ~15 minutes. Hit **Refresh prices** any time to force an update. If a price
can't be fetched, the last known value is kept and marked *stale* — and you can always set a manual
price on the holding.

---

## 🔒 Your data & privacy

- Everything is stored **locally** on your computer in a single SQLite file:
  `server/data/sampada.db`.
- Passwords are hashed (bcrypt); login tokens are signed with a secret that's auto-generated and
  saved to `server/data/.jwt_secret` on first run.
- **Backup** = copy `server/data/sampada.db` somewhere safe. **Start fresh** = stop the app and
  delete that file.

---

## 🛠️ Useful commands

```bash
npm run dev       # run API + website with hot reload (development)
npm run build     # build the website for production (outputs web/dist)
npm start         # run the production server (serves the built website + API on one port)
npm run dev:api   # run only the API
npm run dev:web   # run only the website
```

### Optional configuration

Copy `server/.env.example` to `server/.env` to change defaults (all optional):

- `API_PORT` — API port in development (default `4000`)
- `JWT_SECRET` — set your own login-token secret
- `ADMIN_EMAILS` — comma-separated emails that become admins on signup

---

## ☁️ Deploying later (so anyone can access it)

You chose *local-first*. When you're ready to put Sampada online:

1. `npm run build` to build the website.
2. Run `npm start` — the API server will serve the built website **and** the API on a single port
   (it honors the host's `PORT` environment variable).
3. Deploy that single Node server to any host (Render, Railway, Fly.io, a small VPS, etc.) and keep
   `server/data/` on a persistent disk so your data survives restarts.

A `Dockerfile` / hosting walkthrough can be added when you're ready — just ask.

---

## 🔗 Connecting a broker (optional, premium)

Auto-pull your **stock** holdings by logging in at your broker. Currently supported: **Zerodha**
(Kite Connect) and **Upstox** — both expose free holdings APIs. We only ever *read* holdings; we
never place orders.

One-time setup per broker:

1. Create a free developer app: [Zerodha](https://developers.kite.trade) / [Upstox](https://upstox.com/developer/apps).
2. Set its **redirect URL** to `http://localhost:3000/broker/<broker>/callback`
   (e.g. `.../broker/zerodha/callback`).
3. Put the keys in `server/.env`: `ZERODHA_API_KEY` / `ZERODHA_API_SECRET` (and/or `UPSTOX_*`).

Then **Investments → Connect broker → Connect**. No keys yet? Click **Sample** to preview the flow.
(Live broker connect is a Premium feature; the Sample preview is free.)

## 💳 Premium & payments (optional)

Sampada has a built-in **Premium** plan (₹99/month) gating the premium features (broker auto-sync).
Payments use **Razorpay** (UPI Autopay / cards).

- **Try it now with no money:** Settings → Upgrade → **Start 30-day test trial**.
- **Enable real billing:** create a Razorpay account + a ₹99 monthly **Plan**, then set
  `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_PLAN_ID`, and `RAZORPAY_WEBHOOK_SECRET` in
  `server/.env`. Point the Razorpay webhook to `/api/billing/webhook`. Start with **test keys**.
- The account owner (any email in `ADMIN_EMAILS`) is always Premium.

⚠️ Before charging money or handling others' financial data, confirm DPDP Act 2023 / SEBI
obligations with a professional, and publish a privacy policy + terms. For USD pricing, prefer
**annual** billing (Stripe's per-transaction fee makes monthly $1 uneconomic).

## 🧭 Roadmap status

1. **CAS import** ✅ built — lowest friction, no registrations (this is what Kuvera does).
2. **Broker connect** ✅ built — Zerodha + Upstox (add their free dev-app keys to go live).
3. **Payments / Premium** ✅ built — Razorpay subscription + test trial + premium gate.
4. **Account Aggregator (AA)** ⏳ deferred — RBI's consent network can deliver holdings, but
   consuming it requires being (or partnering with) a regulated **FIU**; revisit with a business entity.

## 🧱 Project structure

```
Project Finance/
├── package.json            # workspaces + the `npm run dev` script
├── server/                 # Express API (Node built-in SQLite, JWT auth)
│   └── src/
│       ├── index.js        # app entry + routes wiring
│       ├── db.js           # schema (users, holdings, cash, transactions, caches)
│       ├── auth.js         # signup/login, JWT, password hashing
│       ├── routes/         # auth, holdings, cash, transactions, dashboard, prices, import, broker, billing
│       ├── services/       # prices (Yahoo/AMFI), FX, portfolio, CAS bridge, importer, brokers, billing
│       └── tools/cas/      # Python CAS parser (casparser) + setup.sh + parse_cas.py
└── web/                    # React website (Vite + Tailwind + Recharts)
    └── src/
        ├── pages/          # Dashboard, Investments, Cash, Transactions, Settings, Login, Signup
        ├── components/     # layout, modals, forms, UI primitives
        └── lib/            # API client, auth context, formatting
```

### Tech stack

React · Vite · Tailwind CSS · Recharts · Express · Node built-in SQLite · JWT.

---

Made with care. Questions or want a new feature (price alerts, CSV import, charts over time,
dividends)? Just ask.
