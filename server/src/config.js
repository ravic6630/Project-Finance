import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// server/data — holds the SQLite database and the auto-generated JWT secret.
export const DATA_DIR = join(__dirname, '..', 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = join(DATA_DIR, 'sampada.db');

// In dev the web dev-server owns PORT (3000) and proxies /api to us, so the
// API uses its own API_PORT (default 4000). In production the API serves the
// built web on a single port, so it honors the host-provided PORT.
export const PORT =
  process.env.NODE_ENV === 'production'
    ? Number(process.env.PORT) || 4000
    : Number(process.env.API_PORT) || 4000;

export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// Use the configured secret, or generate one once and persist it so logins
// survive server restarts even without a .env file.
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const secretFile = join(DATA_DIR, '.jwt_secret');
  if (existsSync(secretFile)) return readFileSync(secretFile, 'utf8').trim();
  const secret = randomBytes(48).toString('hex');
  writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

export const JWT_SECRET = resolveJwtSecret();
