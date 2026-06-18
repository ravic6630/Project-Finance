import { createHash } from 'node:crypto';

// Where brokers redirect back after login (the web app handles the callback route).
const REDIRECT_BASE = process.env.BROKER_REDIRECT_BASE || 'http://localhost:3000';

const cfg = {
  zerodha: { key: process.env.ZERODHA_API_KEY, secret: process.env.ZERODHA_API_SECRET },
  upstox: { key: process.env.UPSTOX_API_KEY, secret: process.env.UPSTOX_API_SECRET },
};

export const BROKER_LABELS = { zerodha: 'Zerodha', upstox: 'Upstox' };
export const isBroker = (b) => b === 'zerodha' || b === 'upstox';
export const brokerConfigured = (b) => !!(cfg[b]?.key && cfg[b]?.secret);
export const brokerStatus = () => ({
  zerodha: brokerConfigured('zerodha'),
  upstox: brokerConfigured('upstox'),
});
export const redirectUri = (b) => `${REDIRECT_BASE}/broker/${b}/callback`;

export function loginUrl(broker) {
  if (broker === 'zerodha') {
    return `https://kite.zerodha.com/connect/login?v=3&api_key=${cfg.zerodha.key}`;
  }
  if (broker === 'upstox') {
    const p = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.upstox.key,
      redirect_uri: redirectUri('upstox'),
    });
    return `https://api.upstox.com/v2/login/authorization/dialog?${p}`;
  }
  throw new Error('Unknown broker');
}

async function postForm(url, form, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(form).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || json?.error_description || `Token exchange failed (${res.status})`);
  return json;
}

// Exchange the OAuth callback param (Zerodha: request_token, Upstox: code) for an access token.
export async function exchangeToken(broker, { request_token, code }) {
  if (broker === 'zerodha') {
    const { key, secret } = cfg.zerodha;
    const checksum = createHash('sha256').update(`${key}${request_token}${secret}`).digest('hex');
    const json = await postForm(
      'https://api.kite.trade/session/token',
      { api_key: key, request_token, checksum },
      { 'X-Kite-Version': '3' }
    );
    return { accessToken: json.data.access_token, name: json.data.user_name || null };
  }
  if (broker === 'upstox') {
    const json = await postForm('https://api.upstox.com/v2/login/authorization/token', {
      code,
      client_id: cfg.upstox.key,
      client_secret: cfg.upstox.secret,
      redirect_uri: redirectUri('upstox'),
      grant_type: 'authorization_code',
    });
    return { accessToken: json.access_token, name: json.user_name || null };
  }
  throw new Error('Unknown broker');
}

const numOr0 = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

// Fetch demat equity holdings and normalize to {symbol, name, exchange, isin, quantity, avgCost}.
export async function fetchHoldings(broker, accessToken) {
  if (broker === 'zerodha') {
    const res = await fetch('https://api.kite.trade/portfolio/holdings', {
      headers: { Authorization: `token ${cfg.zerodha.key}:${accessToken}`, 'X-Kite-Version': '3' },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || `Could not fetch holdings (${res.status})`);
    return (json.data || [])
      .filter((h) => numOr0(h.quantity) > 0)
      .map((h) => ({
        symbol: h.tradingsymbol,
        name: h.tradingsymbol,
        exchange: h.exchange,
        isin: h.isin || null,
        quantity: numOr0(h.quantity),
        avgCost: numOr0(h.average_price),
      }));
  }
  if (broker === 'upstox') {
    const res = await fetch('https://api.upstox.com/v2/portfolio/long-term-holdings', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || `Could not fetch holdings (${res.status})`);
    return (json.data || [])
      .filter((h) => numOr0(h.quantity) > 0)
      .map((h) => ({
        symbol: h.trading_symbol || h.tradingsymbol,
        name: h.company_name || h.trading_symbol,
        exchange: h.exchange,
        isin: h.isin || null,
        quantity: numOr0(h.quantity),
        avgCost: numOr0(h.average_price),
      }));
  }
  throw new Error('Unknown broker');
}

// Sample holdings so the connect→review→import flow is testable without a real login.
export function demoHoldings(broker) {
  const base = [
    { symbol: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE', isin: 'INE002A01018', quantity: 25, avgCost: 1180 },
    { symbol: 'INFY', name: 'Infosys', exchange: 'NSE', isin: 'INE009A01021', quantity: 30, avgCost: 1450 },
    { symbol: 'HDFCBANK', name: 'HDFC Bank', exchange: 'NSE', isin: 'INE040A01034', quantity: 18, avgCost: 1620 },
  ];
  return broker === 'upstox' ? base.slice(0, 2) : base;
}
