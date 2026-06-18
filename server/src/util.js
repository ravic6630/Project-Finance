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

export const oneOf = (value, allowed, field) => {
  if (!allowed.includes(value)) {
    throw bad(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
};
