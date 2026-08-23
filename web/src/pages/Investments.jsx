import { useCallback, useEffect, useState, useRef} from 'react';
import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Building2, Download, FileSpreadsheet, FileUp, Pencil, Plus, RefreshCw, Trash2, TrendingUp } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useProfile } from '../lib/ProfileContext.jsx';
import { LinkedScopeNote } from '../components/FamilyBits.jsx';
import { money, number, percent, relativeTime } from '../lib/format.js';
import { downloadHoldingsCsv } from '../lib/exportCsv.js';
import { useConfirm } from '../lib/confirm.jsx';
import { EmptyState, ErrorBanner } from '../components/ui.jsx';
import { Magnetic, Shimmer, Spotlight, settle } from '../components/fx.jsx';
import { pageVisible } from '../lib/motion.js';
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

// Only the first dozen rows stagger; past that the delay is capped so a large
// portfolio arrives at once instead of cascading for several seconds.
const STAGGER_CAP = 12;
const rowDelay = (i) => Math.min(i, STAGGER_CAP) * 0.025;

function PriceCell({ h }) {
  if (h.price == null) return <span className="text-slate-400">—</span>;
  return (
    <div>
      <span className="num font-medium text-slate-800">{money(h.price, h.price_currency)}</span>
      <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[11px]">
        {h.price_source === 'manual' ? (
          <span className="chip bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            manual
          </span>
        ) : h.price_stale ? (
          <span className="chip bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
            stale
          </span>
        ) : (
          <span className="text-slate-400">{relativeTime(h.price_updated_at)}</span>
        )}
      </div>
    </div>
  );
}

function HoldingRow({ h, base, index, animateIn, onEdit, onDelete }) {
  const up = (h.gain_base ?? 0) >= 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <motion.tr
      initial={animateIn ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...settle, delay: rowDelay(index) }}
      className="group border-t border-slate-100 transition-colors duration-150 hover:bg-slate-50/60"
    >
      {/* the gold hairline is a pseudo-element so the row never shifts on hover */}
      <td className="relative py-3 pl-4 pr-2 before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:origin-center before:scale-y-0 before:rounded-full before:bg-gold-400 before:opacity-0 before:transition before:duration-200 before:content-[''] group-hover:before:scale-y-100 group-hover:before:opacity-100">
        <p className="font-semibold text-slate-900">{h.name}</p>
        <p className="text-xs text-slate-400">{h.symbol || `Scheme #${h.scheme_code}`}</p>
      </td>
      <td className="num px-2 text-right text-slate-600">{number(h.quantity, 3)}</td>
      <td className="num px-2 text-right text-slate-600">
        {money(h.avg_cost, h.currency)}
      </td>
      <td className="px-2 text-right">
        <PriceCell h={h} />
      </td>
      <td className="num px-2 text-right font-semibold text-slate-900">
        {money(h.market_value_base, base)}
      </td>
      <td className="px-2 text-right">
        <span
          className={`num inline-flex items-center justify-end gap-1 font-semibold ${
            up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-300'
          }`}
        >
          <Arrow size={13} strokeWidth={2.5} className="shrink-0" aria-hidden />
          <span>
            {money(h.gain_base, base)}
            {h.gain_pct != null && (
              <span className="ml-1 text-xs font-medium opacity-80">({percent(h.gain_pct)})</span>
            )}
          </span>
        </span>
      </td>
      <td className="px-2 pr-4 text-right">
        <div className="flex justify-end gap-1 opacity-60 transition group-hover:opacity-100">
          <button
            onClick={() => onEdit(h)}
            aria-label={`Edit ${h.name}`}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => onDelete(h)}
            aria-label={`Delete ${h.name}`}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-100 hover:text-rose-600"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </td>
    </motion.tr>
  );
}

// A skeleton shaped like the holdings table, so the real data drops straight
// into the outline instead of replacing a spinner with a layout jump.
function HoldingsSkeleton({ rows = 5 }) {
  return (
    <div className="card overflow-hidden" aria-hidden>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
        <Shimmer className="h-4 w-36" />
        <Shimmer className="h-4 w-24" />
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-6 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <Shimmer className="h-3.5 w-44 max-w-full" />
              <Shimmer className="mt-2 h-2.5 w-20" />
            </div>
            <Shimmer className="hidden h-3.5 w-14 sm:block" />
            <Shimmer className="hidden h-3.5 w-20 md:block" />
            <Shimmer className="h-3.5 w-24" />
            <Shimmer className="h-3.5 w-20" />
          </div>
        ))}
      </div>
    </div>
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

  // Every load claims a ticket; only the newest one may write to state. Without
  // this, a slow response for the previous profile (or an in-flight 30s poll)
  // lands after the switch and repaints the wrong person's holdings.
  const reqRef = useRef(0);

  const load = useCallback(async ({ refresh = false, live = false } = {}) => {
    const ticket = ++reqRef.current;
    try {
      setError('');
      const parts = [refresh ? 'refresh=1' : live ? 'live=1' : '', profileQuery('').replace('?', '')]
        .filter(Boolean)
        .join('&');
      const d = await api(`/holdings${parts ? `?${parts}` : ''}`);
      if (reqRef.current !== ticket) return;
      setHoldings(d.holdings);
      setUpdatedAt(new Date().toISOString());
    } catch (err) {
      // A background poll failing shouldn't disrupt the page; only surface real loads.
      if (reqRef.current === ticket && !live) setError(err.message);
    } finally {
      if (reqRef.current === ticket) {
        setLoading(false);
        setRefreshing(false);
      }
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
  const up = totalGain >= 0;
  const TotalArrow = up ? ArrowUpRight : ArrowDownRight;

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

  const animateIn = pageVisible();
  // Running index across every section, so rows stagger in true reading order.
  let rowIndex = 0;

  return (
    <div className="space-y-6">
      <LinkedScopeNote />

      <header>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-brand-900">Investments</h2>
            <p className="mt-1 text-sm text-slate-500">
              Stocks and funds across your markets, priced automatically.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <Magnetic>
              <button className="btn-primary" onClick={openAdd}>
                <Plus size={16} /> Add holding
              </button>
            </Magnetic>
          </div>
        </div>
        <div className="rule-fade mt-4" />
      </header>

      {/* Valuation line — the one number this page exists for. Hidden entirely
          when there's nothing to value, so the empty state carries the screen. */}
      {(loading || holdings.length > 0) && (
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Portfolio value
            </p>
            {holdings.length > 0 && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700"
                title="Prices refresh automatically every 30s"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/25" />
                Live
              </span>
            )}
          </div>
          {loading ? (
            <Shimmer className="mt-1.5 h-8 w-56 max-w-full sm:h-10" />
          ) : (
            <p className="num mt-1 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              {money(totalValue, base)}
            </p>
          )}
          <div className="gold-rule mt-3" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {holdings.length > 0 && (
            <span
              className={`num inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${
                up
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'
              }`}
            >
              <TotalArrow size={15} strokeWidth={2.5} aria-hidden />
              {money(Math.abs(totalGain), base)}
              <span className="opacity-70">
                ({percent(totalCost > 0 ? (totalGain / totalCost) * 100 : 0)})
              </span>
            </span>
          )}
          {updatedAt && holdings.length > 0 && (
            <span className="hidden text-xs text-slate-400 sm:inline">
              Updated {relativeTime(updatedAt)}
            </span>
          )}
        </div>
      </div>
      )}

      <ErrorBanner message={error} />

      {loading ? (
        <div className="space-y-6">
          <HoldingsSkeleton rows={5} />
          <HoldingsSkeleton rows={3} />
        </div>
      ) : holdings.length === 0 ? (
        <EmptyState
          illo="invest"
          icon={TrendingUp}
          title="No investments yet"
          hint="Add your Indian stocks, US stocks and mutual funds. We'll fetch live prices automatically."
          action={
            <Magnetic>
              <button className="btn-primary" onClick={openAdd}>
                <Plus size={16} /> Add your first holding
              </button>
            </Magnetic>
          }
        />
      ) : (
        groups.map(({ kind, label, rows }) => {
          const secValue = rows.reduce((s, h) => s + (h.market_value_base || 0), 0);
          return (
            <Spotlight key={kind} className="card overflow-hidden">
              {/* `relative` keeps the header and table painted above the
                  Spotlight sheen, so hovering never washes out a number. */}
              <div className="relative flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-3.5">
                <div className="flex items-baseline gap-2.5">
                  <h3 className="font-display text-base font-bold text-slate-900">{label}</h3>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {rows.length} holding{rows.length === 1 ? '' : 's'}
                  </span>
                </div>
                <span className="num text-sm font-semibold text-slate-600">
                  {money(secValue, base)}
                </span>
              </div>
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/60 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      <th className="py-2.5 pl-4 text-left font-semibold">Name</th>
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
                        index={rowIndex++}
                        animateIn={animateIn}
                        onEdit={openEdit}
                        onDelete={onDelete}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Spotlight>
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
