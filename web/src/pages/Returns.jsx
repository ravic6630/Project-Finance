import { useCallback, useEffect, useState } from 'react';
import { Crown, Download, Loader2, Plus, Receipt, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { dateLabel, money, percent } from '../lib/format.js';
import { ErrorBanner, Field, Modal, Spinner } from '../components/ui.jsx';
import UpgradeModal from '../components/UpgradeModal.jsx';

const xirrLabel = (r) => (r == null ? '—' : percent(r * 100));
const gainClass = (v) => (v > 0 ? 'text-emerald-600' : v < 0 ? 'text-rose-600' : 'text-slate-500');

function TxnModal({ holding, base, onClose, onChanged }) {
  const [txns, setTxns] = useState([]);
  const [form, setForm] = useState({ type: 'BUY', trade_date: '', quantity: '', price: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cur = holding.currency || base;

  const load = useCallback(() => {
    api(`/holdings/${holding.id}/txns`).then((d) => setTxns(d.txns)).catch(() => {});
  }, [holding.id]);
  useEffect(() => {
    load();
  }, [load]);

  const set = (p) => setForm((f) => ({ ...f, ...p }));

  async function add(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const d = await api(`/holdings/${holding.id}/txns`, {
        method: 'POST',
        body: {
          type: form.type,
          trade_date: form.trade_date,
          quantity: Number(form.quantity || 0),
          price: Number(form.price || 0),
        },
      });
      setTxns(d.txns);
      setForm({ type: 'BUY', trade_date: '', quantity: '', price: '' });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function del(t) {
    try {
      await api(`/holdings/${holding.id}/txns/${t.id}`, { method: 'DELETE' });
      load();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Transactions — ${holding.name}`} wide>
      <p className="text-sm text-slate-500">
        Add your buys &amp; sells (date, quantity, price in {cur}) so we can work out your true return
        (XIRR) and short/long-term capital gains.
      </p>
      <ErrorBanner message={error} />

      <form onSubmit={add} className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-[#e8e2d4] bg-[#faf8f1] p-4 sm:grid-cols-5">
        <select className="input" value={form.type} onChange={(e) => set({ type: e.target.value })}>
          <option value="BUY">Buy</option>
          <option value="SELL">Sell</option>
        </select>
        <input className="input sm:col-span-2" type="date" value={form.trade_date} onChange={(e) => set({ trade_date: e.target.value })} required />
        <input className="input" type="number" step="any" placeholder="qty" value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} required />
        <input className="input" type="number" step="any" placeholder={`price (${cur})`} value={form.price} onChange={(e) => set({ price: e.target.value })} required />
        <div className="col-span-2 sm:col-span-5">
          <button className="btn-primary" disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add transaction
          </button>
        </div>
      </form>

      {txns.length > 0 ? (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="py-1.5">Date</th>
              <th>Type</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {txns.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="py-2">{dateLabel(t.trade_date)}</td>
                <td>
                  <span className={`chip ${t.type === 'BUY' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {t.type}
                  </span>
                </td>
                <td className="num text-right tabular-nums">{t.quantity}</td>
                <td className="num text-right tabular-nums">{money(t.price, cur)}</td>
                <td className="text-right">
                  <button onClick={() => del(t)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-4 text-sm text-slate-400">No transactions yet — add your first buy above.</p>
      )}
    </Modal>
  );
}

function PremiumLock({ onUpgrade }) {
  return (
    <div className="card flex flex-col items-center gap-3 p-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
        <Crown size={24} />
      </div>
      <h2 className="font-display text-xl font-bold text-slate-900">Returns &amp; tax is Premium</h2>
      <p className="max-w-md text-sm text-slate-500">
        See your true money-weighted return (XIRR) and a capital-gains statement — realized and
        unrealized, split into short and long term — across every market.
      </p>
      <button className="btn-primary mt-1" onClick={onUpgrade}>
        <Sparkles size={16} /> Upgrade to Premium
      </button>
    </div>
  );
}

function Stat({ label, value, cls }) {
  return (
    <div className="rounded-xl border border-[#e8e2d4] bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`num mt-1 text-xl font-bold ${cls || 'text-brand-900'}`}>{value}</p>
    </div>
  );
}

export default function Returns() {
  const { user } = useAuth();
  const base = user.base_currency;
  const [premium, setPremium] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [txnFor, setTxnFor] = useState(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      const status = await api('/billing/status');
      const isPremium = !!status?.state?.premium;
      setPremium(isPremium);
      if (isPremium) setData(await api('/returns'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function exportCsv() {
    if (!data) return;
    const head = ['Holding', 'Currency', 'XIRR %', 'Invested', 'Market value', 'Realized ST', 'Realized LT', 'Unrealized ST', 'Unrealized LT'];
    const rows = data.holdings.map((h) => [
      `"${h.name}"`, h.currency, h.xirr == null ? '' : (h.xirr * 100).toFixed(2),
      Math.round(h.invested), Math.round(h.market_value),
      Math.round(h.realized.short), Math.round(h.realized.long),
      Math.round(h.unrealized.short), Math.round(h.unrealized.long),
    ]);
    const csv = [head, ...rows].map((r) => r.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sampada-capital-gains.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <Spinner label="Working out your returns…" />;
  if (!premium) {
    return (
      <div className="space-y-6">
        <PremiumLock onUpgrade={() => setUpgradeOpen(true)} />
        <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} onChanged={load} />
      </div>
    );
  }

  const p = data?.portfolio;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900">Returns &amp; tax</h1>
          <p className="text-sm text-slate-500">True returns (XIRR) and a capital-gains statement from your buy/sell history.</p>
        </div>
        <button className="btn-ghost" onClick={exportCsv}>
          <Download size={16} /> Export CSV
        </button>
      </div>

      <ErrorBanner message={error} />

      {p && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Portfolio XIRR" value={xirrLabel(p.xirr)} cls={p.xirr >= 0 ? 'text-emerald-600' : 'text-rose-600'} />
          <Stat label="Invested" value={money(p.invested, base)} />
          <Stat label={`Realized gains (${base})`} value={money(p.realized.total, base)} cls={gainClass(p.realized.total)} />
          <Stat label={`Unrealized gains (${base})`} value={money(p.unrealized.total, base)} cls={gainClass(p.unrealized.total)} />
        </div>
      )}

      {p && (p.realized.total !== 0 || p.unrealized.total !== 0) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="card p-5">
            <h3 className="font-display text-lg font-bold text-slate-900">Realized gains (booked)</h3>
            <div className="mt-2 flex justify-between text-sm"><span className="text-slate-500">Short term (≤12 mo)</span><span className={`num ${gainClass(p.realized.short)}`}>{money(p.realized.short, base)}</span></div>
            <div className="mt-1 flex justify-between text-sm"><span className="text-slate-500">Long term (&gt;12 mo)</span><span className={`num ${gainClass(p.realized.long)}`}>{money(p.realized.long, base)}</span></div>
          </div>
          <div className="card p-5">
            <h3 className="font-display text-lg font-bold text-slate-900">Unrealized gains (on paper)</h3>
            <div className="mt-2 flex justify-between text-sm"><span className="text-slate-500">Short term (≤12 mo)</span><span className={`num ${gainClass(p.unrealized.short)}`}>{money(p.unrealized.short, base)}</span></div>
            <div className="mt-1 flex justify-between text-sm"><span className="text-slate-500">Long term (&gt;12 mo)</span><span className={`num ${gainClass(p.unrealized.long)}`}>{money(p.unrealized.long, base)}</span></div>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3 font-semibold">Holding</th>
              <th className="px-2 text-right font-semibold">XIRR</th>
              <th className="px-2 text-right font-semibold">Realized</th>
              <th className="px-2 text-right font-semibold">Unrealized</th>
              <th className="px-4 text-right font-semibold">Transactions</th>
            </tr>
          </thead>
          <tbody>
            {(data?.holdings || []).map((h) => (
              <tr key={h.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-800">{h.name}</p>
                  <p className="text-xs text-slate-400">{h.currency}</p>
                </td>
                <td className={`num px-2 text-right ${h.xirr == null ? 'text-slate-400' : h.xirr >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{xirrLabel(h.xirr)}</td>
                <td className={`num px-2 text-right ${gainClass(h.realized.total)}`}>{money(h.realized.total, h.currency)}</td>
                <td className={`num px-2 text-right ${gainClass(h.unrealized.total)}`}>{money(h.unrealized.total, h.currency)}</td>
                <td className="px-4 text-right">
                  <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setTxnFor(h)}>
                    {h.txn_count ? `${h.txn_count} ·` : ''} <Receipt size={14} /> Manage
                  </button>
                </td>
              </tr>
            ))}
            {(data?.holdings || []).length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">Add holdings, then log their buys/sells here to see XIRR &amp; capital gains.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Estimates for planning only — not tax advice. “Long term” means held over 12 months; your
        country’s exact thresholds, rates and exemptions may differ. Share the CSV with your accountant.
      </p>

      {txnFor && <TxnModal holding={txnFor} base={base} onClose={() => setTxnFor(null)} onChanged={load} />}
    </div>
  );
}
