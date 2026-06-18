const LOCALE = { INR: 'en-IN', USD: 'en-US' };
const SYMBOL = { INR: '₹', USD: '$' };

export function money(amount, currency = 'INR', { compact = false } = {}) {
  if (amount == null || Number.isNaN(Number(amount))) return '—';
  const opts = {
    style: 'currency',
    currency,
    maximumFractionDigits: compact ? 1 : 2,
    minimumFractionDigits: compact ? 0 : 2,
    ...(compact ? { notation: 'compact' } : {}),
  };
  try {
    return new Intl.NumberFormat(LOCALE[currency] || 'en-US', opts).format(Number(amount));
  } catch {
    return `${SYMBOL[currency] || ''}${Number(amount).toFixed(2)}`;
  }
}

export const symbolFor = (currency) => SYMBOL[currency] || currency;

export function number(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(Number(n));
}

export function percent(n, digits = 1) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

export function dateLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function relativeTime(iso) {
  if (!iso) return 'never';
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export const todayISO = () => new Date().toISOString().slice(0, 10);
