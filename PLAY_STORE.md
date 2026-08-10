# Publishing Sampada to Google Play

Everything below is ready except the parts only you can do: the Play Console
account, the identity verification, and the signing key.

---

## Step 1 — Create your upload key (you, once, ~1 minute)

This key is the **most important secret in the project**: if you lose it you can
never update the app again. Only you should ever hold it. Run this and pick your
own password when prompted:

```bash
keytool -genkey -v -keystore ~/sampada-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias sampada
```

Then create `web/android/app/keystore.properties` (already gitignored — it will
never be committed):

```
storeFile=/Users/ravichandrareddy/sampada-upload.jks
storePassword=YOUR_PASSWORD
keyAlias=sampada
keyPassword=YOUR_PASSWORD
```

Back up the `.jks` file somewhere safe (password manager or an encrypted drive).

## Step 2 — Build the signed bundle

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
npm run mobile:android:release
```

Upload `web/android/app/build/outputs/bundle/release/app-release.aab`.

(Without `keystore.properties` the same command still builds — just unsigned.
Play will reject an unsigned bundle, which is the only thing standing between
you and an upload today.)

## Step 3 — Play Console

Create the account at <https://play.google.com/console> — **$25 once**. Google
now requires identity verification (and for individual accounts, 12 testers for
14 days before production; a **personal/organisation account created before that
rule, or an organisation account, skips the tester requirement** — check what
your account shows).

---

## Store listing — copy you can paste

**App name (30 max)**
```
Sampada: Net Worth Tracker
```

**Short description (80 max)**
```
Track every investment, account and asset in one place. See your true net worth.
```

**Full description (4000 max)**
```
Sampada brings your whole financial life into one clear picture.

Most of us keep money in too many places to count — stocks here, mutual funds
there, a few bank accounts, an apartment, some gold, an old fund you forgot
about. Sampada pulls all of it into a single number you can actually trust, and
shows you how that number moves over time.

WHAT YOU CAN TRACK
• Stocks across India, the US, the UK, Europe, Australia, New Zealand and Canada
• Indian mutual funds, priced daily from official AMFI NAVs
• Bank accounts, fixed deposits and cash
• Property, land, gold and anything else you own
• Income and spending, with budgets and recurring entries

WHAT IT SHOWS YOU
• Your true net worth in your own currency, updated with live prices
• A history chart of how your wealth has grown
• Real returns (XIRR), not just profit and loss
• Goals, and whether you're on pace to reach them
• A crisp monthly statement you can save as a PDF

BUILT FOR FAMILIES
Track a spouse's or a parent's wealth alongside your own, or link another
Sampada account so you both see the household total. Sharing is view-only and
either side can unlink at any time.

PRIVATE AND SECURE
Your data is yours. No ads, no trackers, and we never sell your information.
Protect your account with two-factor authentication, and lock the app with your
fingerprint or face. Export everything you've entered whenever you like.

Prices can be delayed. Projections are estimates for planning only, not
investment advice.
```

**Category:** Finance · **Tags:** budgeting, investing, personal finance
**Contact email:** ravic6631@gmail.com
**Privacy policy URL:** `https://sampada-j9hi.onrender.com/privacy`

---

## Data safety form — the answers

Say **yes** to collecting data, **yes** to encryption in transit, and **yes** to
users being able to request deletion. Then:

| Data type | Collected | Shared | Purpose | Required? |
|---|---|---|---|---|
| Name, email address | Yes | No | Account management | Required |
| User IDs | Yes | No | Account management | Required |
| Financial info — *other financial info* | Yes | No | App functionality | Required |
| App interactions (support messages) | Yes | No | App functionality, support | Optional |
| Device/other IDs (session IP + user agent) | Yes | No | Security | Required |

Do **not** tick: location, contacts, photos, files, health, messages, purchase
history, or credit info — Sampada collects none of them.

Also declare: no data is shared with third parties for advertising; data is
encrypted in transit; users can request deletion via the email in the policy.

---

## Content rating & declarations

- Questionnaire: choose **Finance**, answer no to violence/sexual/drugs/gambling
  → rating comes out **Everyone / 3+**.
- **Financial features declaration:** Sampada is a *personal finance tracker*.
  It does **not** offer loans, trading, banking, crypto exchange or payments, so
  answer "none of the above". (Ticking anything here triggers licence
  paperwork you don't need.)
- **Ads:** No.
- **In-app purchases:** No — the app ships without a purchase path.
- **Target audience:** 18+.
- **Government/News/COVID apps:** No.

---

## Screenshots you need

Play requires **at least 2** phone screenshots (16:9 or 9:16, min 320px,
max 3840px). Easiest way to get clean ones:

```bash
npm run mobile:android      # build + install the debug APK on a phone
```

Then screenshot: Dashboard, Investments, Goals, and a monthly statement.
Also required: a **512×512 app icon** (use `web/assets/logo.png` resized) and a
**1024×500 feature graphic**.

---

## Release track

Start in **Internal testing** (instant, up to 100 testers by email), confirm the
app works on a real phone, then promote to **Production**. First review usually
takes a few days.

---

## After it's live

Every web change reaches phones only through a new build. Bump `versionCode`
(must increase) and `versionName` in `web/android/app/build.gradle`, then:

```bash
npm run mobile:android:release
```

The website updates independently as it always has — deploying to Render changes
the site immediately and does not touch the published app.
