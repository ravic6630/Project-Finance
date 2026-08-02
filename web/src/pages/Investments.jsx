import { useCallback, useEffect, useState } from 'react';
import { Building2, Download, FileSpreadsheet, FileUp, Pencil, Plus, RefreshCw, Trash2, TrendingUp } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useProfile } from '../lib/ProfileContext.jsx';
import { LinkedScopeNote } from '../components/FamilyBits.jsx';
import { money, number, percent, relativeTime } from '../lib/format.js';
import { downloadHoldingsCsv } from '../lib/exportCsv.js';
import { useConfirm } from '../lib/confirm.jsx';
import { EmptyState, ErrorBanner, Spinner } from '../components/ui.jsx';
import HoldingForm from '../components/HoldingForm.jsx';
import CasImport from '../components/CasImport.jsx';
import CsvImport from '../components/CsvImport.jsx';
import BrokerConnect from '../components/BrokerConnect.jsx';

const SECTIONS = [
  { kind: 'IN_STOCK', label: 'Indian Stocks' },
  { kind: 'US_STOCK', label: 'US Stocks' },
  { kind: 'UK_STOCK', label: 'UK Stocks' },
  { kind: 'IE_STOCK', label: 'Irish Stocks' },
  { kind: 'AU_STOCK', label: 'Australian Stocks' },
  { kind: 'NZ_STOCK', label: 'New Zealand Stocks' },
  { kind: 'CA_STOCK', label: 'Canadian Stocks' },
  { kind: 'IN_MF', label: 'Indian Mutual Funds' },
];

function PriceCell({ h }) {
  if (h.price == null) return <span className="text-slate-400">—</span>;
  return (
    <div>
      <span className="font-medium text-slate-800">{money(h.price, h.price_currency)}</span>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
        {h.price_source === 'manual' ? (
          <span className="chip bg-slate-100 text-slate-500">manual</span>
        ) : h.price_stale ? (
          <span className="chip bg-amber-100 text-amber-700">stale</span>
        ) : (
          <span className="text-slate-400">{relativeTime(h.price_updated_at)}</span>
        )}
      </div>
    </div>
  );
}

function HoldingRow({ h, base, onEdit, onDelete }) {
  const up = (h.gain_base ?? 0) >= 0;
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50/60">
      <td className="py-3 pl-4 pr-2">
        <p className="font-semibold text-slate-900">{h.name}</p>
        <p className="text-xs text-slate-400">{h.symbol || `Scheme #${h.scheme_code}`}</p>
      </td>
      <td className="px-2 text-right tabular-nums text-slate-600">{number(h.quantity, 3)}</td>
      <td className="px-2 text-right tabular-nums text-slate-600">
        {money(h.avg_cost, h.currency)}
      </td>
      <td className="px-2 text-right">
        <PriceCell h={h} />
      </td>
      <td className="px-2 text-right font-semibold tabular-nums text-slate-900">
        {money(h.market_value_base, base)}
      </td>
      <td className="px-2 text-right tabular-nums">
        <span className={up ? 'text-emerald-600' : 'text-rose-600'}>
          {money(h.gain_base, base)}
          {h.gain_pct != null && (
            <span className="ml-1 text-xs">({percent(h.gain_pct)})</span>
          )}
        </span>
      </td>
      <td className="px-2 pr-4 text-right">
        <div className="flex justify-end gap-1">
          <button
            onClick={() => onEdit(h)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => onDelete(h)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function Investments() {
  const { user } = useAuth();
  const { active: activeProfile, activeProfileId, profileQuery } = useProfile();
  const base = user.base_currency;
  const confirm = useConfirm();
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [brokerOpen, setBrokerOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async ({ refresh = false, live = false } = {}) => {
    try {
      setError('');
      const parts = [refresh ? 'refresh=1' : live ? 'live=1' : '', profileQuery('').replace('?', '')]
        .filter(Boolean)
        .join('&');
      const d = await api(`/holdings${parts ? `?${parts}` : ''}`);
      setHoldings(d.holdings);
      setUpdatedAt(new Date().toISOString());
    } catch (err) {
      // A background poll failing shouldn't disrupt the page; only surface real loads.
      if (!live) setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeProfile]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load, base, activeProfile]);

  // Auto-refresh prices while the tab is open and visible (pauses when hidden,
  // and refreshes immediately on return). True per-second streaming would need a
  // paid market feed; a 30s poll gives a live feel without getting rate-limited.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') load({ live: true });
    };
    const timer = setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  async function onDelete(h) {
    if (!(await confirm({ title: `Delete “${h.name}”?`, message: 'This permanently removes the holding and its transactions. This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/holdings/${h.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (h) => {
    setEditing(h);
    setFormOpen(true);
  };

  const totalValue = holdings.reduce((s, h) => s + (h.market_value_base || 0), 0);
  const totalCost = holdings.reduce((s, h) => s + (h.cost_value_base || 0), 0);
  const totalGain = totalValue - totalCost;

  // Group holdings by market for display. Any holding whose kind isn't a known
  // section still shows under "Other" — so nothing is ever silently hidden.
  const knownKinds = new Set(SECTIONS.map((s) => s.kind));
  const groups = [
    ...SECTIONS,
    { kind: '_other', label: 'Other holdings' },
  ]
    .map((s) => ({
      ...s,
      rows: s.kind === '_other'
        ? holdings.filter((h) => !knownKinds.has(h.kind))
        : holdings.filter((h) => h.kind === s.kind),
    }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-6">
      <LinkedScopeNote />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-slate-500">Portfolio value</p>
            {holdings.length > 0 && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600"
                title="Prices refresh automatically every 30s"
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                Live
              </span>
            )}
          </div>
          <p className="text-3xl font-extrabold tracking-tight text-slate-900">
            {money(totalValue, base)}
            {holdings.length > 0 && (
              <span
                className={`ml-2 text-base font-semibold ${
                  totalGain >= 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {totalGain >= 0 ? '▲' : '▼'} {money(Math.abs(totalGain), base)} (
                {percent(totalCost > 0 ? (totalGain / totalCost) * 100 : 0)})
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {updatedAt && holdings.length > 0 && (
            <span className="hidden text-xs text-slate-400 sm:inline">Updated {relativeTime(updatedAt)}</span>
          )}
          <button
            className="btn-ghost"
            onClick={() => {
              setRefreshing(true);
              load({ refresh: true });
            }}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button className="btn-ghost" onClick={() => setBrokerOpen(true)}>
            <Building2 size={16} /> Connect broker
          </button>
          <button className="btn-ghost" onClick={() => setImportOpen(true)}>
            <FileUp size={16} /> Import CAS
          </button>
          <button className="btn-ghost" onClick={() => setCsvOpen(true)}>
            <FileSpreadsheet size={16} /> Import CSV
          </button>
          {holdings.length > 0 && (
            <button className="btn-ghost" onClick={() => downloadHoldingsCsv(holdings, base)}>
              <Download size={16} /> Export CSV
            </button>
          )}
          <button className="btn-primary" onClick={openAdd}>
            <Plus size={16} /> Add holding
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading holdings…" />
      ) : holdings.length === 0 ? (
        <EmptyState
          illo="invest"
          icon={TrendingUp}
          title="No investments yet"
          hint="Add your Indian stocks, US stocks and mutual funds. We'll fetch live prices automatically."
          action={
            <button className="btn-primary" onClick={openAdd}>
              <Plus size={16} /> Add your first holding
            </button>
          }
        />
      ) : (
        groups.map(({ kind, label, rows }) => {
          const secValue = rows.reduce((s, h) => s + (h.market_value_base || 0), 0);
          return (
            <div key={kind} className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h3 className="font-bold text-slate-900">{label}</h3>
                <span className="text-sm font-semibold text-slate-500">
                  {money(secValue, base)}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-slate-400">
                      <th className="py-2 pl-4 text-left font-semibold">Name</th>
                      <th className="px-2 text-right font-semibold">Qty</th>
                      <th className="px-2 text-right font-semibold">Avg cost</th>
                      <th className="px-2 text-right font-semibold">Price</th>
                      <th className="px-2 text-right font-semibold">Value ({base})</th>
                      <th className="px-2 text-right font-semibold">Gain/Loss</th>
                      <th className="px-2 pr-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((h) => (
                      <HoldingRow
                        key={h.id}
                        h={h}
                        base={base}
                        onEdit={openEdit}
                        onDelete={onDelete}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}

      <HoldingForm
        profileId={activeProfileId}
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => load()}
      />

      <CasImport
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => load()}
      />

      <CsvImport open={csvOpen} onClose={() => setCsvOpen(false)} onImported={() => load()} />

      <BrokerConnect
        open={brokerOpen}
        onClose={() => setBrokerOpen(false)}
        onImported={() => load()}
      />
    </div>
  );
}
