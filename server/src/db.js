import { createClient } from '@libsql/client';
import { DB_PATH } from './config.js';

// Cloud (Turso) when TURSO_DATABASE_URL is set; otherwise a local file (dev).
const url = process.env.TURSO_DATABASE_URL || `file:${DB_PATH}`;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;
export const client = createClient(authToken ? { url, authToken } : { url });

const cleanArgs = (args) => (args || []).map((a) => (a === undefined ? null : a));
const fixId = (v) => (v === undefined || v === null ? null : Number(v));

// Thin async wrapper that mimics node:sqlite's prepared-statement shape, so
// call sites only need an `await` (get/all/run) rather than a rewrite.
function prepare(sql) {
  return {
    async get(...args) {
      const r = await client.execute({ sql, args: cleanArgs(args) });
      return r.rows[0];
    },
    async all(...args) {
      const r = await client.execute({ sql, args: cleanArgs(args) });
      return r.rows;
    },
    async run(...args) {
      const r = await client.execute({ sql, args: cleanArgs(args) });
      return { changes: Number(r.rowsAffected), lastInsertRowid: fixId(r.lastInsertRowid) };
    },
  };
}

export const db = {
  prepare,
  // Atomic multi-statement write. stmts: [{ sql, args }]
  batch: (stmts) => client.batch(stmts, 'write'),
};

export const now = () => new Date().toISOString();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  password_hash TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'INR',
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    TEXT NOT NULL
);
-- Family members tracked under one login. profile_id NULL on a wealth row
-- means it belongs to the account owner ("Me").
CREATE TABLE IF NOT EXISTS profiles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  relation   TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);
CREATE TABLE IF NOT EXISTS holdings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  symbol       TEXT,
  scheme_code  TEXT,
  name         TEXT NOT NULL,
  quantity     REAL NOT NULL DEFAULT 0,
  avg_cost     REAL NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'INR',
  manual_price REAL,
  profile_id   INTEGER,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_holdings_user ON holdings(user_id);
CREATE TABLE IF NOT EXISTS cash_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'BANK',
  balance       REAL NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'INR',
  interest_rate REAL,
  maturity_date TEXT,
  profile_id    INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cash_user ON cash_accounts(user_id);
-- Physical / other assets valued manually (house, land, a business, gold…).
CREATE TABLE IF NOT EXISTS assets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'PROPERTY',
  value      REAL NOT NULL DEFAULT 0,
  currency   TEXT NOT NULL DEFAULT 'INR',
  notes      TEXT,
  profile_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_user ON assets(user_id);
CREATE TABLE IF NOT EXISTS transactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  amount     REAL NOT NULL DEFAULT 0,
  currency   TEXT NOT NULL DEFAULT 'INR',
  category   TEXT,
  account    TEXT,
  date       TEXT NOT NULL,
  note       TEXT,
  recurring_rule_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_txn_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(user_id, date);
-- Recurring transaction rules (salary, rent, SIPs…). Materialised lazily into
-- real transactions rows (tagged with recurring_rule_id) whenever the user's
-- transactions are read — no scheduler needed.
CREATE TABLE IF NOT EXISTS recurring_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'EXPENSE',
  amount       REAL NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'INR',
  category     TEXT,
  account      TEXT,
  note         TEXT,
  day_of_month INTEGER NOT NULL DEFAULT 1,
  start_date   TEXT NOT NULL,
  end_date     TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  last_run     TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring_rules(user_id);
-- Monthly spending budgets, one per expense category.
CREATE TABLE IF NOT EXISTS budgets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  amount     REAL NOT NULL DEFAULT 0,
  currency   TEXT NOT NULL DEFAULT 'INR',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, category)
);
CREATE TABLE IF NOT EXISTS goals (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL DEFAULT 'CUSTOM',
  target_amount        REAL NOT NULL DEFAULT 0,
  target_date          TEXT,
  current_amount       REAL NOT NULL DEFAULT 0,
  monthly_contribution REAL NOT NULL DEFAULT 0,
  expected_return      REAL NOT NULL DEFAULT 12,
  currency             TEXT NOT NULL DEFAULT 'INR',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);
-- A goal can be funded by real portfolio items; when links exist, "saved so
-- far" is computed live from their current value instead of a manual number.
CREATE TABLE IF NOT EXISTS goal_links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  ref_id     INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(goal_id, kind, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_goal_links_user ON goal_links(user_id);
CREATE TABLE IF NOT EXISTS price_cache (
  price_key  TEXT PRIMARY KEY,
  price      REAL,
  currency   TEXT,
  name       TEXT,
  source     TEXT,
  updated_at TEXT
);
-- Resolved broker ISIN -> AMFI scheme. Persisting each hit means a later import
-- (or a restart) never re-downloads the ~5 MB scheme list to resolve a fund
-- we've already seen.
CREATE TABLE IF NOT EXISTS mf_scheme_index (
  isin        TEXT PRIMARY KEY,
  scheme_code TEXT NOT NULL,
  scheme_name TEXT,
  updated_at  TEXT
);
CREATE TABLE IF NOT EXISTS fx_cache (
  pair       TEXT PRIMARY KEY,
  rate       REAL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id                 INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan                    TEXT NOT NULL DEFAULT 'free',
  status                  TEXT NOT NULL DEFAULT 'inactive',
  provider                TEXT,
  provider_sub_id         TEXT,
  current_period_end      TEXT,
  premium_welcome_sent_at TEXT,
  updated_at              TEXT
);
-- Two-way support chat: one thread per customer. sender is 'user' or 'admin';
-- read_at is set when the OTHER side reads the message (drives unread badges).
CREATE TABLE IF NOT EXISTS support_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender     TEXT NOT NULL DEFAULT 'user',
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_support_user ON support_messages(user_id, id);
-- Email-verification holding area: a signup isn't a real user until the emailed
-- OTP is confirmed, so unverified attempts never touch the users table.
CREATE TABLE IF NOT EXISTS pending_signups (
  email         TEXT PRIMARY KEY,
  name          TEXT,
  password_hash TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'INR',
  otp_hash      TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
-- Password reset via emailed 6-digit code (one active code per user).
CREATE TABLE IF NOT EXISTS password_reset_codes (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  otp_hash   TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
-- One row per signed-in device. The JWT stays stateless; its sha256 hash here
-- lets a user see active devices and revoke any of them instantly.
CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  ua         TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL,
  last_seen  TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS email_prefs (
  user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  daily     INTEGER NOT NULL DEFAULT 0,
  last_sent TEXT
);
CREATE TABLE IF NOT EXISTS broker_connections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker       TEXT NOT NULL,
  access_token TEXT,
  meta         TEXT,
  updated_at   TEXT,
  UNIQUE(user_id, broker)
);
CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  net_worth REAL NOT NULL,
  currency  TEXT NOT NULL DEFAULT 'INR',
  PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS alerts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL DEFAULT 'IN_STOCK',
  symbol            TEXT,
  scheme_code       TEXT,
  label             TEXT NOT NULL,
  direction         TEXT NOT NULL DEFAULT 'above',
  threshold         REAL NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'INR',
  active            INTEGER NOT NULL DEFAULT 1,
  last_triggered_at TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
CREATE TABLE IF NOT EXISTS investment_txns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  holding_id INTEGER NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  type       TEXT NOT NULL DEFAULT 'BUY',
  trade_date TEXT NOT NULL,
  quantity   REAL NOT NULL DEFAULT 0,
  price      REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_itxn_user ON investment_txns(user_id);
CREATE INDEX IF NOT EXISTS idx_itxn_holding ON investment_txns(holding_id);
`;

// Add a column to an existing table if it's missing. Safe to re-run — SQLite
// throws "duplicate column name" once it's applied, which we swallow.
async function addColumn(table, column, type) {
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (e) {
    if (!/duplicate column name/i.test(e?.message || '')) throw e;
  }
}

export async function initDb() {
  await client.executeMultiple(SCHEMA);
  // Additive migrations for databases created before a column existed.
  await addColumn('subscriptions', 'premium_welcome_sent_at', 'TEXT');
  await addColumn('transactions', 'recurring_rule_id', 'INTEGER');
  await addColumn('users', 'totp_secret', 'TEXT');
  await addColumn('holdings', 'profile_id', 'INTEGER');
  await addColumn('cash_accounts', 'profile_id', 'INTEGER');
  await addColumn('assets', 'profile_id', 'INTEGER');
  await addColumn('users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
  // The token-link password reset was replaced by emailed codes long ago.
  await client.execute('DROP TABLE IF EXISTS password_resets');
  const where = process.env.TURSO_DATABASE_URL ? 'Turso (cloud)' : `local file (${DB_PATH})`;
  console.log(`Database ready → ${where}`);
}
