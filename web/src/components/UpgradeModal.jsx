import { useEffect, useState } from 'react';
import { Check, Crown, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { dateLabel, money } from '../lib/format.js';
import { ErrorBanner, Modal } from './ui.jsx';

const PERKS = [
  'Returns & tax — XIRR + capital-gains statement',
  'Goals, net-worth history & price alerts',
  'Auto-sync brokers + daily summary email',
];

function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export default function UpgradeModal({ open, onClose, onChanged }) {
  const [info, setInfo] = useState(null);
  const [period, setPeriod] = useState('annual'); // default to the better-value plan
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = () => api('/billing/status').then(setInfo).catch(() => {});
  useEffect(() => {
    if (open) {
      setError('');
      refresh();
    }
  }, [open]);

  async function checkout() {
    setError('');
    setBusy('pay');
    try {
      const r = await api('/billing/checkout', { method: 'POST', body: { interval: period } });
      if (r.provider === 'stripe') {
        window.location.href = r.url; // hosted Stripe Checkout (Apple Pay / Google Pay / card)
        return;
      }
      const ok = await loadRazorpay();
      if (!ok) throw new Error('Could not load the payment window. Check your connection.');
      const rzp = new window.Razorpay({
        key: r.key_id,
        subscription_id: r.subscription_id,
        name: 'Sampada Premium',
        description: `${r.plan.interval} plan`,
        theme: { color: '#1f3a66' },
        handler: async () => {
          await refresh();
          onChanged?.();
        },
      });
      rzp.open();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const premium = info?.state?.premium;
  const plan = info ? info[period] : null;
  const payLabel = info?.provider === 'razorpay' ? 'Pay with UPI / card' : 'Pay with Apple Pay / card';

  return (
    <Modal open={open} onClose={onClose} title={premium ? 'Sampada Premium' : 'Upgrade to Premium'}>
      {premium ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
            <Crown size={28} />
          </div>
          <h3 className="text-lg font-bold text-slate-900">You&apos;re on Premium 🎉</h3>
          <p className="text-sm text-slate-500">
            {info.state.plan === 'admin'
              ? 'Owner account — all features unlocked.'
              : info.state.until
                ? `Active until ${dateLabel(info.state.until)}.`
                : 'Active.'}
          </p>
          <button className="btn-primary mt-2" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Monthly / Annual toggle */}
          <div className="flex rounded-xl border border-[#e8e2d4] bg-white p-1">
            {[
              ['monthly', 'Monthly'],
              ['annual', 'Annual'],
            ].map(([iv, label]) => (
              <button
                key={iv}
                onClick={() => setPeriod(iv)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  period === iv ? 'bg-brand-700 text-white' : 'text-slate-500 hover:text-brand-700'
                }`}
              >
                {label}
                {iv === 'annual' && info && (
                  <span className={`chip ${period === iv ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
                    Save {info.annual.save_pct}%
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-brand-200 bg-brand-50/50 p-5">
            <div className="flex items-baseline gap-1">
              <span className="num text-3xl font-bold text-slate-900">{plan ? money(plan.amount, plan.currency) : '…'}</span>
              <span className="text-sm font-medium text-slate-500">/ {period === 'annual' ? 'year' : 'month'}</span>
            </div>
            {period === 'annual' && plan && (
              <p className="mt-0.5 text-xs font-medium text-emerald-600">
                ≈ {money(plan.monthly_equiv, plan.currency)}/mo · save {plan.save_pct}% vs monthly
              </p>
            )}
            <ul className="mt-4 space-y-2">
              {PERKS.map((p) => (
                <li key={p} className="flex items-start gap-2 text-sm text-slate-700">
                  <Check size={16} className="mt-0.5 shrink-0 text-emerald-500" /> {p}
                </li>
              ))}
            </ul>
          </div>

          <ErrorBanner message={error} />

          <button className="btn-primary w-full" onClick={checkout} disabled={!!busy}>
            {busy === 'pay' ? <Loader2 size={16} className="animate-spin" /> : <Crown size={16} />}
            {payLabel}
          </button>

          {info && !info.can_subscribe && (
            <p className="text-center text-xs text-slate-400">
              Live payments aren&apos;t set up yet — add the{' '}
              {info.provider === 'razorpay' ? 'Razorpay' : 'Stripe'} keys on the server to enable checkout.
            </p>
          )}
          <p className="text-center text-[11px] text-slate-400">
            Auto-renews · cancel anytime ·{' '}
            {info?.provider === 'razorpay' ? 'UPI & cards via Razorpay' : 'Apple Pay, Google Pay & cards via Stripe'}
          </p>
        </div>
      )}
    </Modal>
  );
}
