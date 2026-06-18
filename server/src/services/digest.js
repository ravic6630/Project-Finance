import { buildSummary } from './summary.js';

const LOCALE = { INR: 'en-IN', USD: 'en-US' };
function money(amount, currency = 'INR') {
  try {
    return new Intl.NumberFormat(LOCALE[currency] || 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(Number(amount || 0));
  } catch {
    return `${currency} ${Math.round(Number(amount || 0))}`;
  }
}
const pct = (n) => `${n >= 0 ? '+' : ''}${Number(n || 0).toFixed(1)}%`;
const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

function card(label, value, sub, subColor = '#64748b') {
  return `
    <td style="padding:6px;" width="33%" valign="top">
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px;background:#fff;">
        <div style="font-size:12px;color:#64748b;font-weight:600;">${label}</div>
        <div style="font-size:20px;font-weight:800;color:#0f172a;margin-top:4px;">${value}</div>
        <div style="font-size:12px;color:${subColor};margin-top:2px;">${sub || ''}</div>
      </div>
    </td>`;
}

export function renderDigestHtml(s, user) {
  const base = s.base_currency;
  const up = s.investments.gain >= 0;
  const greeting = user.name ? `Hi ${user.name.split(' ')[0]},` : 'Hi,';
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  const allocTotal = s.allocation.reduce((a, b) => a + b.value, 0) || 1;
  const allocRows = s.allocation
    .map((a, i) => {
      const p = Math.round((a.value / allocTotal) * 100);
      return `<tr>
        <td style="font-size:13px;color:#334155;padding:4px 8px 4px 0;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${COLORS[i % COLORS.length]};margin-right:6px;"></span>${a.label}
        </td>
        <td style="font-size:13px;color:#0f172a;font-weight:600;text-align:right;padding:4px 0;">${money(a.value, base)} <span style="color:#94a3b8;font-weight:400;">(${p}%)</span></td>
      </tr>`;
    })
    .join('');

  return `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
    <div style="font-size:20px;font-weight:800;color:#4f46e5;margin-bottom:2px;">🌱 Sampada</div>
    <div style="font-size:13px;color:#94a3b8;margin-bottom:20px;">${today}</div>

    <p style="font-size:15px;color:#0f172a;margin:0 0 4px;">${greeting}</p>
    <p style="font-size:13px;color:#64748b;margin:0 0 16px;">Here's your money this morning.</p>

    <div style="border-radius:16px;background:#4f46e5;color:#fff;padding:20px;margin-bottom:16px;">
      <div style="font-size:13px;opacity:.8;">Total net worth</div>
      <div style="font-size:32px;font-weight:800;margin-top:2px;">${money(s.net_worth, base)}</div>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr>
      ${card('Investments', money(s.investments.value, base), `${up ? '▲' : '▼'} ${money(Math.abs(s.investments.gain), base)} (${pct(s.investments.gain_pct)})`, up ? '#059669' : '#e11d48')}
      ${card('Cash & Bank', money(s.cash.total, base), `${s.counts.accounts} account(s)`)}
      ${card('This month', money(s.cashflow.this_month_net, base), `+${money(s.cashflow.this_month_income, base)} / −${money(s.cashflow.this_month_expense, base)}`)}
    </tr></table>

    ${
      s.allocation.length
        ? `<div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#fff;margin-bottom:16px;">
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:8px;">Asset allocation</div>
            <table width="100%" cellpadding="0" cellspacing="0">${allocRows}</table>
           </div>`
        : ''
    }

    <p style="font-size:12px;color:#94a3b8;margin:20px 0 0;line-height:1.5;">
      You're getting this because you turned on daily summaries in Sampada. Manage it in Settings.<br/>
      Prices are indicative (Yahoo Finance / AMFI) and for personal tracking only — not financial advice.
    </p>
  </div></body></html>`;
}

export async function buildDigest(user) {
  const s = await buildSummary(user, { refresh: true });
  return {
    subject: `Your Sampada summary — ${money(s.net_worth, s.base_currency)}`,
    html: renderDigestHtml(s, user),
    summary: s,
  };
}
