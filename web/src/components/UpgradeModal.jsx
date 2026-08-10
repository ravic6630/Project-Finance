import { useEffect, useState } from 'react';
import { BadgeCheck, Check, Copy, Crown, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { canPurchaseInApp } from '../lib/native.js';
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
  const [qr, setQr] = useState(null);
  const [reference, setReference] = useState('');
  const [claimed, setClaimed] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = () => api('/billing/status').then(setInfo).catch(() => {});
  useEffect(() => {
    if (open) {
      setError('');
      setClaimed(false);
      setReference('');
      refresh();
    }
  }, [open]);

  // UPI QR carries the exact amount + the payer's email in the note, so the
  // owner can match the PhonePe credit to the account. Refetch per plan.
  useEffect(() => {
    if (!open || info?.manual?.method !== 'upi') return;
    setQr(null);
    api(`/billing/manual-qr?interval=${period}`).then(setQr).catch(() => {});
  }, [open, period, info?.manual?.method]);

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function sendClaim() {
    setError('');
    setBusy('claim');
    try {
      await api('/billing/manual-claim', {
        method: 'POST',
        body: { interval: period, method: info?.manual?.method, reference: reference.trim() || undefined },
      });
      setClaimed(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

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
      ) : !canPurchaseInApp ? (
        /* Native builds carry no purchase path: Apple and Google require their
           own billing for digital subscriptions, and this app doesn't ship it
           yet. Members keep every feature; plans are handled on the account. */
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <Crown size={28} />
          </div>
          <h3 className="text-lg font-bold text-slate-900">Sampada Premium</h3>
          <p className="max-w-xs text-sm text-slate-500">
            Premium unlocks Returns &amp; tax, goals, net-worth history, price alerts, broker
            auto-sync and email reports. Your plan is managed on your Sampada account — once it&apos;s
            active, everything here unlocks automatically.
          </p>
          <button className="btn-ghost mt-2" onClick={onClose}>
            Close
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

          {info?.can_subscribe && (
            <>
              <button className="btn-primary w-full" onClick={checkout} disabled={!!busy}>
                {busy === 'pay' ? <Loader2 size={16} className="animate-spin" /> : <Crown size={16} />}
                {payLabel}
              </button>
              <p className="text-center text-[11px] text-slate-400">
                Auto-renews · cancel anytime ·{' '}
                {info?.provider === 'razorpay' ? 'UPI & cards via Razorpay' : 'Apple Pay, Google Pay & cards via Stripe'}
              </p>
              <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <span className="h-px flex-1 bg-slate-200" /> or pay directly <span className="h-px flex-1 bg-slate-200" />
              </div>
            </>
          )}

          {/* Manual path: pay the owner directly, tap "I've paid", Premium is
              switched on after the money is verified. */}
          {info?.manual && !claimed && (
            <div className="rounded-2xl border border-gold-200 bg-gold-50/40 p-4">
              {info.manual.method === 'upi' ? (
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex h-[132px] w-[132px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-gold-200">
                    {qr?.qr ? (
                      <img src={qr.qr} alt="UPI payment QR" className="h-full w-full" />
                    ) : (
                      <Loader2 size={18} className="animate-spin text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-[180px] flex-1">
                    <p className="text-sm font-bold text-slate-800">Pay with PhonePe / any UPI app</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Scan the QR — it fills {plan ? money(plan.amount, 'INR') : '…'} and your email
                      automatically. Or send to:
                    </p>
                    <button
                      onClick={() => copyText(info.manual.upi_id)}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 font-mono text-xs font-semibold text-brand-700 ring-1 ring-gold-200 hover:ring-gold-300"
                    >
                      {info.manual.upi_id} {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-bold text-slate-800">Pay with Zelle</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Send{' '}
                    <span className="font-semibold text-slate-700">
                      {money(info.manual.zelle_amounts?.[period] ?? 0, 'USD')}
                    </span>{' '}
                    to the Zelle ID below, and put your Sampada email in the memo so we can match it.
                  </p>
                  <button
                    onClick={() => copyText(info.manual.zelle_id)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 font-mono text-xs font-semibold text-brand-700 ring-1 ring-gold-200 hover:ring-gold-300"
                  >
                    {info.manual.zelle_id} {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  </button>
                </div>
              )}

              <div className="mt-3 flex items-stretch gap-2">
                <input
                  className="input min-w-0 flex-1 text-xs"
                  placeholder="Transaction ref / last 4 digits (optional)"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
                <button className="btn-primary shrink-0" onClick={sendClaim} disabled={!!busy}>
                  {busy === 'claim' ? <Loader2 size={15} className="animate-spin" /> : <BadgeCheck size={15} />}
                  I&apos;ve paid
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                We verify the payment and switch on Premium — usually within a few hours. You&apos;ll
                get a welcome email the moment it&apos;s live.
              </p>
            </div>
          )}

          {claimed && (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 text-center">
              <BadgeCheck size={26} className="text-emerald-500" />
              <p className="text-sm font-bold text-slate-800">Thanks — claim received!</p>
              <p className="text-xs text-slate-500">
                We&apos;ll verify the payment and activate Premium, usually within a few hours. The
                welcome email confirms it. You can also chat with us any time from the support bubble.
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
