import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { ErrorBanner } from './ui.jsx';

const KIND_LABEL = {
  IN_MF: 'Mutual Fund',
  IN_STOCK: 'Indian Stock',
  US_STOCK: 'US Stock',
  UK_STOCK: 'UK Stock',
  IE_STOCK: 'Ireland Stock',
  AU_STOCK: 'Australia Stock',
  NZ_STOCK: 'NZ Stock',
  CA_STOCK: 'Canada Stock',
};

// Shared review + confirm step for any import source (CAS or broker).
// `data` = { items, summary, investor?/name?, file_type?/broker_label? }
export default function ImportReview({ data, source = 'Imported', onBack, onClose, onImported }) {
  // Duplicates are selected by default now — re-importing UPDATES the existing
  // holding (refreshes quantity/price) instead of creating a second copy.
  const [items, setItems] = useState(
    data.items.map((it) => ({ ...it, _selected: it.importable !== false }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const patch = (idx, p) => setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...p } : it)));
  const selectedCount = items.filter((i) => i._selected).length;

  async function onImport() {
    const chosen = items.filter((it) => it._selected);
    const missing = chosen.find((it) => it.kind !== 'IN_MF' && !it.symbol?.trim());
    if (missing) return setError(`Enter a ticker for "${missing.name}" or unselect it.`);
    setError('');
    setBusy(true);
    try {
      const res = await api('/import/confirm', { method: 'POST', body: { items: chosen, source } });
      setResult(res);
      onImported?.(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="text-emerald-500" size={48} />
        <h3 className="text-lg font-bold text-slate-900">
          {result.imported} holding{result.imported === 1 ? '' : 's'} imported 🎉
        </h3>
        {(result.inserted > 0 || result.updated > 0) && (
          <p className="text-sm text-slate-500">
            {result.inserted > 0 && `${result.inserted} added`}
            {result.inserted > 0 && result.updated > 0 && ' · '}
            {result.updated > 0 && `${result.updated} updated`}
          </p>
        )}
        {result.skipped?.length > 0 && (
          <p className="text-sm text-slate-500">{result.skipped.length} row(s) skipped.</p>
        )}
        <button className="btn-primary mt-2" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  const subtitle = data.broker_label || data.file_type;
  const who = data.name || data.investor?.name;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {who && <span className="font-semibold text-slate-700">{who}</span>}
        {subtitle && <span className="chip bg-slate-100 text-slate-500">{subtitle}</span>}
        <span className="text-slate-400">
          {data.summary.mutualFunds != null &&
            `${data.summary.mutualFunds} fund${data.summary.mutualFunds === 1 ? '' : 's'} · `}
          {data.summary.stocks} stock{data.summary.stocks === 1 ? '' : 's'}
          {data.summary.duplicates > 0 && ` · ${data.summary.duplicates} will update`}
        </span>
      </div>

      <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="text-xs uppercase tracking-wide text-slate-400">
              <th className="w-10 py-2 pl-3" />
              <th className="py-2 text-left font-semibold">Holding</th>
              <th className="px-2 text-right font-semibold">Qty</th>
              <th className="px-2 text-right font-semibold">Avg cost</th>
              <th className="px-2 pr-3 text-left font-semibold">Ticker / status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx} className="border-t border-slate-100">
                <td className="py-2.5 pl-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={it._selected}
                    onChange={(e) => patch(idx, { _selected: e.target.checked })}
                  />
                </td>
                <td className="py-2.5 pr-2">
                  <p className="font-medium text-slate-800">{it.name}</p>
                  <p className="text-xs text-slate-400">
                    {KIND_LABEL[it.kind]}
                    {it.duplicate && <span className="ml-1 font-semibold text-brand-600">· will update existing</span>}
                  </p>
                </td>
                <td className="px-2 text-right tabular-nums text-slate-600">{it.quantity}</td>
                <td className="px-2 text-right tabular-nums text-slate-600">
                  {money(it.avg_cost, it.currency)}
                </td>
                <td className="px-2 pr-3">
                  {it.kind === 'IN_MF' ? (
                    it.importable ? (
                      <span className="text-xs text-slate-400">auto-priced (#{it.scheme_code})</span>
                    ) : (
                      <span className="text-xs text-amber-600">no scheme code</span>
                    )
                  ) : (
                    <input
                      className="input py-1.5 text-sm uppercase"
                      placeholder="e.g. RELIANCE"
                      value={it.symbol}
                      onChange={(e) => patch(idx, { symbol: e.target.value })}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ErrorBanner message={error} />
      <div className="flex items-center justify-between gap-2">
        {onBack ? (
          <button className="btn-ghost" onClick={onBack}>
            ← Back
          </button>
        ) : (
          <span />
        )}
        <button className="btn-primary" onClick={onImport} disabled={busy || selectedCount === 0}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : null}
          Import {selectedCount} holding{selectedCount === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}
