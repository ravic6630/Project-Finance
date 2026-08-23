// Wrap an async route handler so thrown errors hit the error middleware.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Throwable HTTP error with a status code.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => new HttpError(400, msg);

// Coerce to a finite number or throw.
export function num(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw bad(`${field} must be a number`);
  return n;
}

// Normalise an optional string to a trimmed value or null (SQLite-friendly).
export const str = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// Escape user-controlled text before it goes into an HTML email body. Names are
// free-form (signup / profile), so without this a name like `<img src=x onerror=…>`
// would render as live markup in the recipient's mail client.
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

export const oneOf = (value, allowed, field) => {
  if (!allowed.includes(value)) {
    throw bad(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
};

// Tiny fixed-window per-IP rate limiter for the auth endpoints. In-memory is
// fine here: one Render instance, and the goal is stopping brute force, not
// precise accounting. Trusts x-forwarded-for because Render terminates TLS.
const rlBuckets = new Map();
export function rateLimit({ windowMs = 15 * 60000, max = 40, name = 'rl' } = {}) {
  return (req, res, next) => {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = forwarded || req.socket?.remoteAddress || 'unknown';
    // Requests originating on the box itself (dev server, local test harness)
    // aren't the brute-force threat this guards against. In production every
    // request arrives through Render's proxy WITH x-forwarded-for set, so a real
    // client can never take this path.
    if (!forwarded && /^(::1|::ffff:127\.|127\.)/.test(ip)) return next();
    const key = `${name}:${ip}`;
    const t = Date.now();
    let b = rlBuckets.get(key);
    if (!b || t > b.reset) {
      b = { count: 0, reset: t + windowMs };
      rlBuckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      res.setHeader('Retry-After', Math.ceil((b.reset - t) / 1000));
      return res.status(429).json({ error: 'Too many attempts — please wait a few minutes and try again.' });
    }
    if (rlBuckets.size > 5000) {
      for (const [k, v] of rlBuckets) if (t > v.reset) rlBuckets.delete(k);
    }
    next();
  };
}
