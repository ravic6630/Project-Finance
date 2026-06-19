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
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cash_user ON cash_accounts(user_id);
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
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_txn_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(user_id, date);
CREATE TABLE IF NOT EXISTS price_cache (
  price_key  TEXT PRIMARY KEY,
  price      REAL,
  currency   TEXT,
  name       TEXT,
  source     TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS fx_cache (
  pair       TEXT PRIMARY KEY,
  rate       REAL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan               TEXT NOT NULL DEFAULT 'free',
  status             TEXT NOT NULL DEFAULT 'inactive',
  provider           TEXT,
  provider_sub_id    TEXT,
  current_period_end TEXT,
  updated_at         TEXT
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
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
`;

export async function initDb() {
  await client.executeMultiple(SCHEMA);
  const where = process.env.TURSO_DATABASE_URL ? 'Turso (cloud)' : `local file (${DB_PATH})`;
  console.log(`Database ready → ${where}`);
}
