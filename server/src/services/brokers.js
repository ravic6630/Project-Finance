import { createHash } from 'node:crypto';

// Where brokers redirect back after login (the web app handles the callback route).
const REDIRECT_BASE = process.env.BROKER_REDIRECT_BASE || 'http://localhost:3000';

const cfg = {
  zerodha: { key: process.env.ZERODHA_API_KEY, secret: process.env.ZERODHA_API_SECRET },
  upstox: { key: process.env.UPSTOX_API_KEY, secret: process.env.UPSTOX_API_SECRET },
  angelone: { key: process.env.ANGELONE_API_KEY, secret: process.env.ANGELONE_API_SECRET },
};

export const BROKER_LABELS = { zerodha: 'Zerodha', upstox: 'Upstox', angelone: 'Angel One' };
export const isBroker = (b) => b === 'zerodha' || b === 'upstox' || b === 'angelone';
export const brokerConfigured = (b) => !!(cfg[b]?.key && cfg[b]?.secret);
export const brokerStatus = () => ({
  zerodha: brokerConfigured('zerodha'),
  upstox: brokerConfigured('upstox'),
  angelone: brokerConfigured('angelone'),
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
  if (broker === 'angelone') {
    // SmartAPI Publisher Login: Angel One handles the client login + TOTP and
    // redirects back to our callback with auth_token/feed_token/refresh_token.
    return `https://smartapi.angelone.in/publisher-login?api_key=${cfg.angelone.key}`;
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

// Exchange the login callback param for an access token. Zerodha: request_token,
// Upstox: code, Angel One: the Publisher flow already returns the JWT (auth_token).
export async function exchangeToken(broker, { request_token, code, auth_token }) {
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
  if (broker === 'angelone') {
    if (!auth_token) throw new Error('Missing auth token from Angel One');
    return { accessToken: auth_token, name: null };
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
  if (broker === 'angelone') {
    const res = await fetch(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/portfolio/v1/getAllHolding',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientLocalIP': '127.0.0.1',
          'X-ClientPublicIP': '127.0.0.1',
          'X-MACAddress': '00:00:00:00:00:00',
          'X-PrivateKey': cfg.angelone.key,
        },
      }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || `Could not fetch holdings (${res.status})`);
    const rows = json?.data?.holdings || (Array.isArray(json?.data) ? json.data : []);
    return rows
      .filter((h) => numOr0(h.quantity) > 0)
      .map((h) => ({
        // Angel One tickers carry an NSE series suffix ("RELIANCE-EQ") — strip it
        // so the price feed (and .NS suffixing) can resolve the symbol.
        symbol: String(h.tradingsymbol || '').replace(/-(EQ|BE|BZ|SM|ST)$/i, ''),
        name: h.tradingsymbol || '',
        exchange: h.exchange || 'NSE',
        isin: h.isin || null,
        quantity: numOr0(h.quantity),
        avgCost: numOr0(h.averageprice),
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
  if (broker === 'upstox') return base.slice(0, 2);
  if (broker === 'angelone') {
    return [
      { symbol: 'TCS', name: 'Tata Consultancy Services', exchange: 'NSE', isin: 'INE467B01029', quantity: 12, avgCost: 3450 },
      { symbol: 'ITC', name: 'ITC', exchange: 'NSE', isin: 'INE154A01025', quantity: 60, avgCost: 410 },
      { symbol: 'SBIN', name: 'State Bank of India', exchange: 'NSE', isin: 'INE062A01020', quantity: 40, avgCost: 590 },
    ];
  }
  return base;
}
