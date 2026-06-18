import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './config.js';

export const db = new DatabaseSync(DB_PATH);

// Pragmatic durability/concurrency settings for a small multi-user app.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  password_hash TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'INR',
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holdings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,              -- IN_STOCK | US_STOCK | IN_MF
  symbol       TEXT,                       -- Yahoo symbol (stocks); blank for MF
  scheme_code  TEXT,                       -- AMFI/mfapi scheme code (MF)
  name         TEXT NOT NULL,
  quantity     REAL NOT NULL DEFAULT 0,
  avg_cost     REAL NOT NULL DEFAULT 0,    -- per share/unit, in 'currency'
  currency     TEXT NOT NULL DEFAULT 'INR',
  manual_price REAL,                       -- override; if set, used instead of live
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_holdings_user ON holdings(user_id);

CREATE TABLE IF NOT EXISTS cash_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'BANK',  -- BANK | CASH | FD | OTHER
  balance       REAL NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'INR',
  interest_rate REAL,                          -- FD annual %
  maturity_date TEXT,                          -- FD maturity (YYYY-MM-DD)
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cash_user ON cash_accounts(user_id);

CREATE TABLE IF NOT EXISTS transactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,                 -- INCOME | EXPENSE
  amount     REAL NOT NULL DEFAULT 0,
  currency   TEXT NOT NULL DEFAULT 'INR',
  category   TEXT,
  account    TEXT,
  date       TEXT NOT NULL,                 -- YYYY-MM-DD
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_txn_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(user_id, date);

-- Shared price cache (one row per instrument, reused across users).
CREATE TABLE IF NOT EXISTS price_cache (
  price_key  TEXT PRIMARY KEY,             -- e.g. AAPL, RELIANCE.NS, mf:120503
  price      REAL,
  currency   TEXT,
  name       TEXT,
  source     TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS fx_cache (
  pair       TEXT PRIMARY KEY,             -- e.g. USDINR
  rate       REAL,
  updated_at TEXT
);

-- One subscription row per user (premium status).
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan               TEXT NOT NULL DEFAULT 'free',   -- free | premium
  status             TEXT NOT NULL DEFAULT 'inactive',
  provider           TEXT,                            -- razorpay | trial
  provider_sub_id    TEXT,
  current_period_end TEXT,                            -- ISO; premium valid until this
  updated_at         TEXT
);

-- One-time password-reset tokens (hashed), with expiry.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- Per-user email preferences (daily summary opt-in + dedupe of sends).
CREATE TABLE IF NOT EXISTS email_prefs (
  user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  daily     INTEGER NOT NULL DEFAULT 0,
  last_sent TEXT
);

-- Short-lived broker access tokens (re-auth needed daily), one per user+broker.
CREATE TABLE IF NOT EXISTS broker_connections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker       TEXT NOT NULL,              -- zerodha | upstox
  access_token TEXT,
  meta         TEXT,                       -- JSON (e.g. login name, expiry)
  updated_at   TEXT,
  UNIQUE(user_id, broker)
);
`);

export const now = () => new Date().toISOString();
