import { useEffect, useState } from 'react';
import { Check, Crown, Globe2, LogOut, Users, Download } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { api, apiUrl, getToken } from '../lib/api.js';
import { dateLabel } from '../lib/format.js';
import { CURRENCIES } from '../lib/markets.js';
import { ErrorBanner, Field } from '../components/ui.jsx';
import UpgradeModal from '../components/UpgradeModal.jsx';
import SecurityCard from '../components/SecurityCard.jsx';
import EmailDigestCard from '../components/EmailDigestCard.jsx';
import PriceAlertsCard from '../components/PriceAlertsCard.jsx';
import ReferralCard from '../components/ReferralCard.jsx';
import StatementsCard from '../components/StatementsCard.jsx';
import { AppLockCard } from '../components/AppLock.jsx';

export default function Settings() {
  const { user, updateProfile, logout } = useAuth();
  const [name, setName] = useState(user.name || '');
  const [base, setBase] = useState(user.base_currency);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [billing, setBilling] = useState(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const loadBilling = () => api('/billing/status').then(setBilling).catch(() => {});
  useEffect(() => {
    loadBilling();
  }, []);

  async function onSave(e) {
    e.preventDefault();
    setError('');
    setSaved(false);
    setBusy(true);
    try {
      await updateProfile({ name, base_currency: base });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadExport() {
    try {
      const res = await fetch(apiUrl('/export'), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Export failed — try again.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sampada-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="card p-6">
        <h3 className="font-bold text-slate-900">Profile</h3>
        <p className="mt-0.5 text-sm text-slate-500">Manage your account details.</p>
        <form onSubmit={onSave} className="mt-5 space-y-4">
          <ErrorBanner message={error} />
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email">
            <input className="input bg-slate-50 text-slate-500" value={user.email} disabled />
          </Field>
          <Field
            label="Base currency"
            hint="Everything across the app is converted to this currency using live exchange rates."
          >
            <select className="input" value={base} onChange={(e) => setBase(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label} ({c.code})
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            {saved && (
              <span className="flex items-center gap-1 text-sm font-medium text-emerald-600">
                <Check size={16} /> Saved
              </span>
            )}
          </div>
        </form>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="flex items-start gap-4">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              billing?.state?.premium ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'
            }`}
          >
            <Crown size={20} />
          </div>
          <div>
            <h3 className="font-bold text-slate-900">
              {billing?.state?.premium ? 'Sampada Premium' : 'Free plan'}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {billing?.state?.premium
                ? billing.state.plan === 'admin'
                  ? 'Owner account — all features unlocked.'
                  : billing.state.until
                    ? `Premium active until ${dateLabel(billing.state.until)}.`
                    : 'Premium active.'
                : 'Upgrade to auto-sync brokers and unlock everything.'}
            </p>
          </div>
        </div>
        <button className="btn-primary" onClick={() => setUpgradeOpen(true)}>
          <Crown size={16} /> {billing?.state?.premium ? 'Manage' : 'Upgrade'}
        </button>
      </div>

      <ReferralCard />

      <EmailDigestCard onUpgrade={() => setUpgradeOpen(true)} />

      <StatementsCard onUpgrade={() => setUpgradeOpen(true)} />

      <PriceAlertsCard premium={billing?.state?.premium} onUpgrade={() => setUpgradeOpen(true)} />

      <div className="card flex items-start gap-4 p-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Users size={20} />
        </div>
        <div>
          <h3 className="font-bold text-slate-900">Family &amp; friends</h3>
          <p className="mt-1 text-sm text-slate-500">
            Anyone can create their own account from the sign-up page — just share the app link with
            them. Each person&apos;s holdings, accounts and transactions are completely private to
            their own login.
          </p>
        </div>
      </div>

      <AppLockCard />

      <SecurityCard user={user} onUserChanged={() => updateProfile({})} />

      <div className="card flex flex-wrap items-start justify-between gap-4 p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Download size={20} />
          </div>
          <div>
            <h3 className="font-bold text-slate-900">Your data</h3>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Download everything you&apos;ve put into Sampada — holdings, accounts, assets,
              transactions, goals and history — as one JSON file. Broker login tokens are never
              included.
            </p>
          </div>
        </div>
        <button className="btn-ghost shrink-0" onClick={downloadExport}>
          <Download size={16} /> Download JSON
        </button>
      </div>

      <div className="card flex items-start gap-4 p-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
          <Globe2 size={20} />
        </div>
        <div>
          <h3 className="font-bold text-slate-900">How prices work</h3>
          <p className="mt-1 text-sm text-slate-500">
            Stock prices come from Yahoo Finance, Indian mutual-fund NAVs from AMFI, and exchange
            rates are live. Prices are cached for ~15 minutes; hit{' '}
            <span className="font-semibold">Refresh</span> any time, or set a manual price on a
            holding to override it.
          </p>
        </div>
      </div>

      <button onClick={logout} className="btn-danger">
        <LogOut size={16} /> Sign out
      </button>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        onChanged={loadBilling}
      />
    </div>
  );
}
