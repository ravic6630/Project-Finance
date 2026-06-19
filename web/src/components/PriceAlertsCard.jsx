import { useEffect, useState } from 'react';
import { Bell, Crown, Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { ErrorBanner } from './ui.jsx';

const MARKETS = [
  { value: 'IN_STOCK', label: 'Indian stock', ph: 'RELIANCE', cur: 'INR' },
  { value: 'US_STOCK', label: 'US stock', ph: 'AAPL', cur: 'USD' },
  { value: 'IN_MF', label: 'Indian MF', ph: 'scheme code e.g. 120503', cur: 'INR' },
];

const blank = { kind: 'IN_STOCK', symbol: '', direction: 'above', threshold: '' };

export default function PriceAlertsCard({ premium, onUpgrade }) {
  const [alerts, setAlerts] = useState([]);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = () => {
    if (!premium) return;
    api('/alerts').then((d) => setAlerts(d.alerts)).catch(() => {});
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [premium]);

  const market = MARKETS.find((m) => m.value === form.kind) || MARKETS[0];
  const set = (p) => setForm((f) => ({ ...f, ...p }));

  async function add(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = {
        kind: form.kind,
        direction: form.direction,
        threshold: Number(form.threshold || 0),
        currency: market.cur,
        label: form.symbol.trim().toUpperCase(),
        ...(form.kind === 'IN_MF'
          ? { scheme_code: form.symbol.trim() }
          : { symbol: form.symbol.trim() }),
      };
      await api('/alerts', { method: 'POST', body });
      setForm(blank);
      setAdding(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function del(a) {
    try {
      await api(`/alerts/${a.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!premium) {
    return (
      <div className="card p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Bell size={20} />
          </div>
          <div>
            <h3 className="flex items-center gap-2 font-bold text-slate-900">
              Price alerts
              <span className="chip bg-amber-100 text-amber-700">
                <Crown size={12} className="mr-1" /> Premium
              </span>
            </h3>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Get an email the moment a stock or fund crosses a price you set. Upgrade to add alerts.
            </p>
            <button className="btn-primary mt-3" onClick={onUpgrade}>
              <Crown size={16} /> Upgrade to Premium
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Bell size={20} />
          </div>
          <div>
            <h3 className="font-bold text-slate-900">Price alerts</h3>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              We&apos;ll email you when a holding crosses your target price.
            </p>
          </div>
        </div>
        {!adding && (
          <button className="btn-ghost shrink-0" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add
          </button>
        )}
      </div>

      <ErrorBanner message={error} />

      {adding && (
        <form onSubmit={add} className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-[#e8e2d4] bg-[#faf8f1] p-4 sm:grid-cols-5">
          <select className="input col-span-2 sm:col-span-1" value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
            {MARKETS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <input className="input col-span-2 uppercase" placeholder={market.ph} value={form.symbol} onChange={(e) => set({ symbol: e.target.value })} required />
          <select className="input" value={form.direction} onChange={(e) => set({ direction: e.target.value })}>
            <option value="above">Above</option>
            <option value="below">Below</option>
          </select>
          <input className="input" type="number" step="any" placeholder="price" value={form.threshold} onChange={(e) => set({ threshold: e.target.value })} required />
          <div className="col-span-2 flex gap-2 sm:col-span-5">
            <button className="btn-primary" disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add alert
            </button>
            <button type="button" className="btn-ghost" onClick={() => { setAdding(false); setError(''); }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {alerts.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100">
          {alerts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p className="text-sm font-semibold text-slate-800">{a.label}</p>
                <p className="text-xs text-slate-500">
                  Notify when {a.direction} {money(a.threshold, a.currency)}
                </p>
              </div>
              <button onClick={() => del(a)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600">
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {alerts.length === 0 && !adding && (
        <p className="mt-4 text-sm text-slate-400">No alerts yet — add one to get notified on price moves.</p>
      )}
    </div>
  );
}
