import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { CURRENCIES, STOCK_MARKETS, currencyForKind } from '../lib/markets.js';
import { ErrorBanner, Field, Modal } from './ui.jsx';

const blank = {
  kind: 'IN_STOCK',
  name: '',
  symbol: '',
  scheme_code: '',
  quantity: '',
  avg_cost: '',
  currency: 'INR',
  manual_price: '',
  notes: '',
};

function MfSearch({ onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const skip = useRef(false);

  useEffect(() => {
    clearTimeout(timer.current);
    if (skip.current) {
      skip.current = false; // don't re-search right after a pick
      return undefined;
    }
    if (q.trim().length < 3) {
      setResults([]);
      return undefined;
    }
    timer.current = setTimeout(async () => {
      try {
        const d = await api(`/holdings/mf-search?q=${encodeURIComponent(q)}`);
        setResults(d.results);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [q]);

  return (
    <div className="relative">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-3 text-slate-400" />
        <input
          className="input pl-9"
          placeholder="Search fund name (e.g. Axis Bluechip)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {results.map((r) => (
            <button
              key={r.schemeCode}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50"
              onClick={() => {
                skip.current = true;
                onPick(r);
                setQ(r.schemeName);
                setResults([]);
                setOpen(false);
              }}
            >
              <span className="font-medium text-slate-800">{r.schemeName}</span>
              <span className="ml-1 text-xs text-slate-400">#{r.schemeCode}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StockSearch({ kind, onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const skip = useRef(false);

  useEffect(() => {
    clearTimeout(timer.current);
    if (skip.current) {
      skip.current = false; // don't re-search right after a pick
      return undefined;
    }
    if (q.trim().length < 1) {
      setResults([]);
      return undefined;
    }
    timer.current = setTimeout(async () => {
      try {
        const d = await api(`/holdings/stock-search?q=${encodeURIComponent(q)}&kind=${kind}`);
        setResults(d.results);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q, kind]);

  // Switching market clears the search box (and its stale results).
  useEffect(() => {
    skip.current = true;
    setQ('');
    setResults([]);
    setOpen(false);
  }, [kind]);

  return (
    <div className="relative">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-3 text-slate-400" />
        <input
          className="input pl-9"
          placeholder={`Search a ${STOCK_MARKETS.find((m) => m.kind === kind)?.label || ''} stock…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {results.map((r) => (
            <button
              key={r.symbol}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50"
              onClick={() => {
                skip.current = true;
                onPick(r);
                setQ(`${r.symbol} — ${r.name}`);
                setResults([]);
                setOpen(false);
              }}
            >
              <span className="truncate">
                <span className="font-semibold text-slate-800">{r.symbol}</span>{' '}
                <span className="text-slate-500">{r.name}</span>
              </span>
              <span className="shrink-0 text-xs text-slate-400">{r.exchange}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HoldingForm({ open, onClose, onSaved, editing }) {
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      setForm({
        kind: editing.kind,
        name: editing.name || '',
        symbol: editing.symbol || '',
        scheme_code: editing.scheme_code || '',
        quantity: String(editing.quantity ?? ''),
        avg_cost: String(editing.avg_cost ?? ''),
        currency: editing.currency || 'INR',
        manual_price: editing.manual_price != null ? String(editing.manual_price) : '',
        notes: editing.notes || '',
      });
    } else {
      setForm(blank);
    }
  }, [open, editing]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  // Changing market/asset clears the instrument fields so a stale ticker/name
  // from the previous market can't carry over.
  const onKind = (kind) => set({ kind, currency: currencyForKind(kind), symbol: '', name: '' });
  const onAsset = (type) =>
    type === 'MF'
      ? set({ kind: 'IN_MF', currency: 'INR', symbol: '', scheme_code: '', name: '' })
      : set({ kind: 'IN_STOCK', currency: 'INR', symbol: '', scheme_code: '', name: '' });

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = {
        kind: form.kind,
        name: form.name,
        currency: form.currency,
        quantity: Number(form.quantity || 0),
        avg_cost: Number(form.avg_cost || 0),
        manual_price: form.manual_price === '' ? null : Number(form.manual_price),
        notes: form.notes,
        ...(form.kind === 'IN_MF'
          ? { scheme_code: form.scheme_code }
          : { symbol: form.symbol }),
      };
      if (editing) {
        await api(`/holdings/${editing.id}`, { method: 'PATCH', body: payload });
      } else {
        await api('/holdings', { method: 'POST', body: payload });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const isMf = form.kind === 'IN_MF';
  const market = STOCK_MARKETS.find((m) => m.kind === form.kind);

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit holding' : 'Add holding'}>
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorBanner message={error} />

        <Field label="Type">
          <div className="grid grid-cols-2 gap-2">
            {[['STOCK', 'Stock / ETF'], ['MF', 'Mutual fund']].map(([t, label]) => {
              const active = t === 'MF' ? isMf : !isMf;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => onAsset(t)}
                  className={`rounded-xl border px-2 py-2.5 text-sm font-semibold transition ${
                    active
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Field>

        {!isMf && (
          <Field label="Market">
            <select className="input" value={form.kind} onChange={(e) => onKind(e.target.value)}>
              {STOCK_MARKETS.map((m) => (
                <option key={m.kind} value={m.kind}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        {isMf ? (
          <>
            <Field label="Find your fund" hint="Picks the AMFI scheme so NAV updates automatically.">
              <MfSearch onPick={(r) => set({ scheme_code: r.schemeCode, name: r.schemeName })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Scheme code">
                <input
                  className="input"
                  value={form.scheme_code}
                  onChange={(e) => set({ scheme_code: e.target.value })}
                  placeholder="120503"
                  required
                />
              </Field>
              <Field label="Units held">
                <input
                  className="input"
                  type="number"
                  step="any"
                  value={form.quantity}
                  onChange={(e) => set({ quantity: e.target.value })}
                  required
                />
              </Field>
            </div>
            <Field label="Fund name">
              <input
                className="input"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                required
              />
            </Field>
          </>
        ) : (
          <>
            <Field
              label="Find your stock"
              hint="Search by company or ticker and pick — or type it yourself below."
            >
              <StockSearch
                kind={form.kind}
                onPick={(r) => set({ symbol: r.symbol, name: r.name })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ticker symbol" hint={`e.g. ${market?.ph || 'AAPL'} (${market?.label})`}>
                <input
                  className="input uppercase"
                  value={form.symbol}
                  onChange={(e) => set({ symbol: e.target.value })}
                  placeholder={market?.ph || 'AAPL'}
                  required
                />
              </Field>
              <Field label="Shares held">
                <input
                  className="input"
                  type="number"
                  step="any"
                  value={form.quantity}
                  onChange={(e) => set({ quantity: e.target.value })}
                  required
                />
              </Field>
            </div>
            <Field label="Display name">
              <input
                className="input"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Reliance Industries"
                required
              />
            </Field>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={`Avg buy price (${form.currency})`}>
            <input
              className="input"
              type="number"
              step="any"
              value={form.avg_cost}
              onChange={(e) => set({ avg_cost: e.target.value })}
              placeholder="0.00"
            />
          </Field>
          <Field label="Currency">
            <select
              className="input"
              value={form.currency}
              onChange={(e) => set({ currency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Manual price override (optional)"
          hint="Leave blank to use live prices. Set this only if you want to fix the price yourself."
        >
          <input
            className="input"
            type="number"
            step="any"
            value={form.manual_price}
            onChange={(e) => set({ manual_price: e.target.value })}
            placeholder="Auto (live)"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add holding'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
