import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// RFC 6238 TOTP (SHA-1, 6 digits, 30s steps) — what Google Authenticator,
// Authy, 1Password et al. speak. No dependency needed; ~50 lines of crypto.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret(bytes = 20) {
  const buf = randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}

// Accept the current step ±1 (clock drift on either side).
export function verifyTotp(secret, code, at = Date.now()) {
  const wanted = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(wanted) || !secret) return false;
  const step = Math.floor(at / 30000);
  for (const delta of [0, -1, 1]) {
    const expect = hotp(secret, step + delta);
    if (expect.length === wanted.length && timingSafeEqual(Buffer.from(expect), Buffer.from(wanted))) {
      return true;
    }
  }
  return false;
}

export const otpauthUri = (secret, email) =>
  `otpauth://totp/${encodeURIComponent(`Sampada:${email}`)}?secret=${secret}&issuer=Sampada&digits=6&period=30`;
