import { useEffect, useState } from 'react';
import { Check, Crown, Loader2, Sparkles } from 'lucide-react';
import { api } from '../lib/api.js';
import { dateLabel } from '../lib/format.js';
import { ErrorBanner, Modal } from './ui.jsx';

const PERKS = [
  'Auto-sync your broker holdings (Zerodha, Upstox)',
  'Unlimited holdings & accounts',
  'Priority on new features',
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
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = () => api('/billing/status').then(setInfo).catch(() => {});
  useEffect(() => {
    if (open) {
      setError('');
      refresh();
    }
  }, [open]);

  async function trial() {
    setError('');
    setBusy('trial');
    try {
      await api('/billing/demo-activate', { method: 'POST' });
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function pay() {
    setError('');
    setBusy('pay');
    try {
      const { subscription_id, key_id } = await api('/billing/subscribe', { method: 'POST' });
      const ok = await loadRazorpay();
      if (!ok) throw new Error('Could not load the payment window. Check your connection.');
      const rzp = new window.Razorpay({
        key: key_id,
        subscription_id,
        name: 'Sampada Premium',
        description: '₹99/month',
        theme: { color: '#4f46e5' },
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
          <div className="rounded-2xl border border-brand-200 bg-brand-50/50 p-5">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-extrabold text-slate-900">
                ₹{info?.plan?.amount ?? 99}
              </span>
              <span className="text-sm font-medium text-slate-500">/ month</span>
            </div>
            <ul className="mt-4 space-y-2">
              {PERKS.map((p) => (
                <li key={p} className="flex items-start gap-2 text-sm text-slate-700">
                  <Check size={16} className="mt-0.5 shrink-0 text-emerald-500" /> {p}
                </li>
              ))}
            </ul>
          </div>

          <ErrorBanner message={error} />

          <div className="space-y-2">
            <button className="btn-primary w-full" onClick={pay} disabled={!!busy}>
              {busy === 'pay' ? <Loader2 size={16} className="animate-spin" /> : <Crown size={16} />}
              Pay with Razorpay (UPI / card)
            </button>
            <button className="btn-ghost w-full" onClick={trial} disabled={!!busy}>
              {busy === 'trial' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              Start 30-day test trial (no charge)
            </button>
          </div>
          {info && !info.can_subscribe && (
            <p className="text-center text-xs text-slate-400">
              Live payments aren&apos;t configured yet — use the test trial, or add your Razorpay keys
              in <code className="rounded bg-slate-100 px-1">server/.env</code>.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
