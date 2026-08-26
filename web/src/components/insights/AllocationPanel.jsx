import { useEffect, useId, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, Loader2, Plus, Scale, SlidersHorizontal, Target, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, percent } from '../../lib/format.js';
import { ErrorBanner, Modal, PrimaryButton } from '../ui.jsx';
import { Spotlight } from '../fx.jsx';
import { useConfirm } from '../../lib/confirm.jsx';

/* ============================================================================
   Target mix & drift.

   The service does the arithmetic; this file only has to be honest about it.
   Three states it must never blur together:
     • no targets set        — nothing to compare against, so no drift is shown
     • targets, no portfolio — the mix is saved but unmeasurable, said plainly
     • targets + portfolio   — the real thing: drift, band, and what to move
   ========================================================================== */

// Mirrors KIND_LABELS in server/src/markets.js plus the two non-holding pools.
// Only used to name a bucket the user neither holds nor targets yet — every
// bucket that IS in play arrives from the server already labelled.
const CATALOGUE = [
  ['IN_STOCK', 'Indian Stocks'],
  ['US_STOCK', 'US Stocks'],
  ['UK_STOCK', 'UK Stocks'],
  ['IE_STOCK', 'Ireland Stocks'],
  ['AU_STOCK', 'Australia Stocks'],
  ['NZ_STOCK', 'New Zealand Stocks'],
  ['CA_STOCK', 'Canada Stocks'],
  ['IN_MF', 'Indian Mutual Funds'],
  ['CASH', 'Cash & Bank'],
  ['ASSETS', 'Assets'],
];
const LABELS = Object.fromEntries(CATALOGUE);

const round1 = (n) => Math.round(n * 10) / 10;
// An instruction is given in whole units — nobody moves 43 paise between
// buckets — so the trailing ".00" is noise. Anchored at the end of the string so
// it can never eat a grouping separator out of the middle of the number.
const wholeMoney = (n, base) => money(Math.round(n), base).replace(/[.,]00$/, '');
// Clamped at read time rather than as the user types: rewriting the field mid
// keystroke eats the decimal point out of "33." and makes the input unusable.
// The running total and the payload therefore always agree, and the route's
// 0–100 rule can never be broken by what's on screen.
const parsePct = (v) => {
  const n = Number(String(v).trim());
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
};

/* -------------------------------------------------------------------------- */
/*                              one bucket's row                              */
/* -------------------------------------------------------------------------- */
// A diverging bar. The centre line IS the target, so "on target" is a position
// you can see at a glance rather than a number you have to read and subtract.
// The shaded middle is the tolerance band: inside it, drift isn't worth trading.
function DriftRow({ row, scale, band, base }) {
  const reduced = useReducedMotion();
  // Below a tenth of a point the figure would print as "+0.0%", which reads as
  // a measurement rather than what it is: on target.
  const drift = Math.abs(row.drift_pct) < 0.05 ? 0 : row.drift_pct;
  const over = drift > 0;
  const targeted = row.target_pct > 0;
  const half = (Math.min(Math.abs(drift), scale) / scale) * 50; // % of track width
  const bandHalf = (Math.min(band, scale) / scale) * 50;
  const off = row.action !== 'hold';

  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold text-slate-800">{row.label}</p>
        <p className="num shrink-0 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{row.current_pct.toFixed(1)}%</span>
          {/* "of 0% target" would read as a target the user chose. They didn't
              — this bucket simply isn't in their mix, so say that instead. */}
          {targeted ? (
            <>
              <span className="mx-1">of</span>
              {row.target_pct.toFixed(row.target_pct % 1 ? 1 : 0)}% target
            </>
          ) : (
            <span className="ml-1.5 font-sans">not in your mix</span>
          )}
        </p>
      </div>

      <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[#1c2c49]">
        {/* tolerance band */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 bg-slate-200/70 dark:bg-[#26385a]/70"
          style={{ left: `${50 - bandHalf}%`, width: `${bandHalf * 2}%` }}
        />
        {/* the target itself */}
        <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gold-500/70" />
        <motion.span
          aria-hidden="true"
          className={`absolute inset-y-0 ${over ? 'left-1/2 rounded-r-full' : 'right-1/2 rounded-l-full'} ${
            over
              ? 'bg-gradient-to-r from-gold-500 to-gold-300'
              : 'bg-gradient-to-l from-brand-600 to-brand-400'
          } ${off ? '' : 'opacity-40'}`}
          initial={reduced ? false : { width: 0 }}
          animate={{ width: `${half}%` }}
          transition={{ duration: reduced ? 0 : 0.45, ease: 'easeOut' }}
        />
      </div>

      <p className="mt-1.5 flex items-baseline justify-between gap-3 text-xs">
        <span className={`num font-semibold ${off ? 'text-slate-700' : 'text-slate-400'}`}>
          {drift === 0 ? (
            <span className="font-sans font-medium text-slate-400">On target</span>
          ) : (
            <>
              {percent(drift)}
              <span className="ml-1 font-sans font-medium text-slate-400">
                {over ? 'overweight' : 'underweight'}
              </span>
            </>
          )}
        </span>
        <span className={`shrink-0 ${off ? 'font-semibold text-slate-600' : 'text-slate-400'}`}>
          {off ? (
            <>
              {row.action === 'buy' ? 'Add' : 'Trim'}{' '}
              <span className="num">{money(Math.round(Math.abs(row.action_amount)), base, { compact: true })}</span>
            </>
          ) : (
            'Within band'
          )}
        </span>
      </p>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  the editor                                */
/* -------------------------------------------------------------------------- */
function TargetEditor({ open, onClose, rows, onSaved }) {
  const confirm = useConfirm();
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Seed from what the user already has — the buckets they hold plus the ones
  // they already target. Percentages start blank unless a target exists: a
  // pre-filled number would be us proposing a mix, and that is advice.
  useEffect(() => {
    if (!open) return;
    setError('');
    setBusy(false);
    setLines(
      (rows || []).map((r) => ({
        bucket: r.bucket,
        label: r.label || LABELS[r.bucket] || r.bucket,
        current_pct: r.current_pct,
        pct: r.target_pct > 0 ? String(round1(r.target_pct)) : '',
      }))
    );
  }, [open, rows]);

  const total = lines.reduce((s, l) => s + parsePct(l.pct), 0);
  // The same rule the route enforces, so the button never lies about what will
  // be accepted. A mix that doesn't total 100% would misreport every drift.
  const balanced = lines.length > 0 && Math.abs(total - 100) <= 0.5;
  const spare = CATALOGUE.filter(([k]) => !lines.some((l) => l.bucket === k));

  const setPct = (bucket, value) =>
    setLines((ls) => ls.map((l) => (l.bucket === bucket ? { ...l, pct: value } : l)));

  const distribute = () => {
    if (!lines.length) return;
    const each = round1(100 / lines.length);
    // Put the rounding crumb on the first line so the set totals exactly 100.
    const crumb = round1(100 - each * lines.length);
    setLines((ls) => ls.map((l, i) => ({ ...l, pct: String(round1(each + (i === 0 ? crumb : 0))) })));
  };

  const matchToday = () =>
    setLines((ls) => {
      const sum = ls.reduce((s, l) => s + (l.current_pct || 0), 0);
      if (!(sum > 0)) return ls;
      const vals = ls.map((l) => round1(((l.current_pct || 0) / sum) * 100));
      const crumb = round1(100 - vals.reduce((s, v) => s + v, 0));
      return ls.map((l, i) => ({ ...l, pct: String(round1(vals[i] + (i === 0 ? crumb : 0))) }));
    });

  async function save() {
    setBusy(true);
    setError('');
    try {
      const targets = lines
        .map((l) => ({ bucket: l.bucket, target_pct: parsePct(l.pct) }))
        .filter((t) => t.target_pct > 0);
      await api('/insights/targets', { method: 'PUT', body: { targets } });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    const ok = await confirm({
      title: 'Remove your target mix?',
      message: 'Your holdings are untouched — only the targets and the drift readings go away.',
      confirmLabel: 'Remove targets',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await api('/insights/targets', { method: 'PUT', body: { targets: [] } });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Your target mix">
      <p className="text-sm leading-relaxed text-slate-500">
        Decide what share of your wealth each bucket should hold. The set has to add up to 100% —
        anything else would make every drift figure wrong.
      </p>

      <div className="mt-4 space-y-2">
        {lines.map((l) => (
          <div key={l.bucket} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800">{l.label}</p>
              <p className="num text-xs text-slate-500">{(l.current_pct || 0).toFixed(1)}% today</p>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                inputMode="decimal"
                value={l.pct}
                onChange={(e) => setPct(l.bucket, e.target.value)}
                aria-label={`${l.label} target percentage`}
                className="input num w-24 py-1.5 text-right"
                placeholder="—"
              />
              <span className="text-sm text-slate-400">%</span>
            </div>
            <button
              onClick={() => setLines((ls) => ls.filter((x) => x.bucket !== l.bucket))}
              aria-label={`Remove ${l.label}`}
              className="shrink-0 rounded-lg p-1 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          </div>
        ))}

        {!lines.length && (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
            Add a bucket below to start building your mix.
          </p>
        )}
      </div>

      {spare.length > 0 && (
        <label className="mt-3 block">
          <span className="sr-only">Add a bucket</span>
          <div className="flex items-center gap-2">
            <Plus size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
            <select
              className="input py-1.5 text-sm"
              value=""
              onChange={(e) => {
                const bucket = e.target.value;
                if (!bucket) return;
                setLines((ls) => [...ls, { bucket, label: LABELS[bucket] || bucket, current_pct: 0, pct: '' }]);
              }}
            >
              <option value="">Add a bucket…</option>
              {spare.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </label>
      )}

      <div className="rule-fade my-4" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={distribute} disabled={!lines.length}>
            Distribute evenly
          </button>
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={matchToday} disabled={!lines.length}>
            Match today&apos;s mix
          </button>
        </div>
        <p className="text-xs font-semibold">
          <span className="text-slate-400">Total </span>
          <span className={`num text-sm ${balanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {round1(total)}%
          </span>
        </p>
      </div>

      {!balanced && lines.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          {total > 100
            ? `That's ${round1(total - 100)}% too much — trim a bucket to save.`
            : `That's ${round1(100 - total)}% short — assign the rest to save.`}
        </p>
      )}

      <div className="mt-4">
        <ErrorBanner message={error} />
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <button className="btn-danger px-3 py-2 text-xs" onClick={clearAll} disabled={busy}>
          Remove targets
        </button>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <PrimaryButton onClick={save} disabled={busy || !balanced}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Save mix
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  the panel                                 */
/* -------------------------------------------------------------------------- */
export default function AllocationPanel({ data, base, onSaved }) {
  const [editing, setEditing] = useState(false);
  // Names the <section> landmark for screen readers without a second heading.
  const titleId = useId();

  // Memoised because the editor seeds its state from this array — a fresh []
  // on every render would re-seed (and wipe) the form the user is typing into.
  const rows = useMemo(() => (Array.isArray(data?.rows) ? data.rows : []), [data]);
  const moves = Array.isArray(data?.suggested) ? data.suggested : [];
  const band = data?.band_pct > 0 ? data.band_pct : 5;

  // One shared scale across every bar, so the rows are comparable to each other
  // — a per-row scale would make a 2% drift and a 40% drift draw the same width.
  const scale = useMemo(() => {
    const worst = rows.reduce((m, r) => Math.max(m, Math.abs(r.drift_pct || 0)), 0);
    return Math.min(100, Math.max(band * 1.6, worst * 1.08, 1));
  }, [rows, band]);

  const worst = useMemo(
    () => rows.reduce((m, r) => (Math.abs(r.drift_pct || 0) > Math.abs(m?.drift_pct || 0) ? r : m), null),
    [rows]
  );

  const header = (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Scale size={17} strokeWidth={1.8} />
          </span>
          <h2 id={titleId} className="font-display text-lg font-bold tracking-tight text-slate-900">
            Target mix
          </h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          What you meant to hold, against what you actually hold.
        </p>
      </div>
      {data?.has_targets && (
        <button
          onClick={() => setEditing(true)}
          className="btn-ghost shrink-0 px-3 py-1.5 text-xs"
          aria-label="Edit your target mix"
        >
          <SlidersHorizontal size={14} /> Edit
        </button>
      )}
    </div>
  );

  const editor = (
    <TargetEditor open={editing} onClose={() => setEditing(false)} rows={rows} onSaved={onSaved} />
  );

  /* ------------------------------ failure state ----------------------------- */
  if (!data || data.error) {
    return (
      <Spotlight as="section" aria-labelledby={titleId} className="card h-full p-5 sm:p-6">
        {header}
        <p className="mt-6 text-sm text-slate-400">
          {data?.error || 'This reading is unavailable right now.'}
        </p>
      </Spotlight>
    );
  }

  /* ------------------------------- no targets ------------------------------- */
  // Nothing is invented here: with no target there is no drift, so we show the
  // mix as it stands and say what setting a target would buy them.
  if (!data.has_targets) {
    return (
      <Spotlight as="section" aria-labelledby={titleId} className="card flex h-full flex-col p-5 sm:p-6">
        {header}
        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-gradient-to-b from-white/70 to-transparent p-5 text-center dark:from-white/[0.03]">
          <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white shadow-[0_6px_18px_-10px_rgba(16,30,55,0.5)] ring-1 ring-gold-200">
            <Target size={20} strokeWidth={1.7} className="text-brand-500 dark:text-brand-300" />
          </span>
          <p className="font-display text-base font-bold tracking-tight text-slate-800">
            No target mix set
          </p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-slate-400">
            Set the share each bucket should hold and this panel turns into a rebalancing plan:
            live drift from your target, and the exact amounts to move to correct it.
          </p>
          <PrimaryButton className="mt-5" onClick={() => setEditing(true)} magnetic>
            <Target size={16} /> Set a target mix
          </PrimaryButton>
        </div>

        {rows.length > 0 && (
          <div className="mt-5">
            <p className="label">Your mix today</p>
            <ul className="divide-y divide-slate-100">
              {rows.map((r) => (
                <li key={r.bucket} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-sm text-slate-700">{r.label}</span>
                  <span className="num shrink-0 text-sm font-semibold text-slate-800">
                    {r.current_pct.toFixed(1)}%
                    <span className="ml-2 font-medium text-slate-400">
                      {money(Math.round(r.current_value), base, { compact: true })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {editor}
      </Spotlight>
    );
  }

  /* -------------------- targets set, but nothing to measure ----------------- */
  if (!data.has_value) {
    return (
      <Spotlight as="section" aria-labelledby={titleId} className="card flex h-full flex-col p-5 sm:p-6">
        {header}
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
          <p className="text-sm font-semibold text-slate-700">Nothing to measure yet</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            Your target mix is saved, but there are no holdings, cash or assets to compare it
            against. Add something you own and the drift appears here.
          </p>
        </div>
        <ul className="mt-4 divide-y divide-slate-100">
          {rows
            .filter((r) => r.target_pct > 0)
            .map((r) => (
              <li key={r.bucket} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm text-slate-700">{r.label}</span>
                <span className="num shrink-0 text-sm font-semibold text-slate-800">
                  {r.target_pct.toFixed(r.target_pct % 1 ? 1 : 0)}% target
                </span>
              </li>
            ))}
        </ul>
        {editor}
      </Spotlight>
    );
  }

  /* --------------------------------- the real thing ------------------------- */
  return (
    <Spotlight as="section" aria-labelledby={titleId} className="card flex h-full flex-col p-5 sm:p-6">
      {header}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span
          className={`chip ${
            data.in_band
              ? 'bg-emerald-50 text-emerald-700 dark:text-emerald-300'
              : 'bg-gold-50 text-gold-700'
          }`}
        >
          {data.in_band ? 'On target' : 'Rebalance suggested'}
        </span>
        <span className="text-xs text-slate-500">
          {data.in_band ? (
            // Deliberately not "every bucket is within 5%": on a portfolio worth
            // a few rupees the drift can be wide while the money is negligible.
            // This sentence is true in both cases; the footnote gives the band.
            <>Nothing is far enough off to be worth trading</>
          ) : (
            worst && (
              <>
                Largest drift <span className="num font-semibold text-slate-600">{percent(worst.drift_pct)}</span>{' '}
                on {worst.label}
              </>
            )
          )}
        </span>
      </div>

      <ul className="mt-2 divide-y divide-slate-100">
        {rows.map((r) => (
          <DriftRow key={r.bucket} row={r} scale={scale} band={band} base={base} />
        ))}
      </ul>

      {moves.length > 0 && (
        <div className="mt-5">
          <div className="rule-fade mb-4" />
          <p className="label">To get back on target</p>
          <ol className="space-y-2">
            {moves.map((m, i) => (
              <li
                key={`${m.from_bucket || m.from}-${m.to_bucket || m.to}-${i}`}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5"
              >
                <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-brand-700 ring-1 ring-gold-200">
                  {i + 1}
                </span>
                <p className="min-w-0 text-sm text-slate-600">
                  Move{' '}
                  <span className="num font-semibold text-slate-900">{wholeMoney(m.amount, base)}</span>{' '}
                  <span className="whitespace-nowrap">
                    from <span className="font-semibold text-slate-700">{m.from}</span>
                  </span>{' '}
                  <ArrowRight size={13} className="inline -mt-0.5 text-slate-300" aria-hidden="true" />{' '}
                  <span className="font-semibold text-slate-700">{m.to}</span>
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Estimates, from today&apos;s prices and rates in {base}. They exclude tax, brokerage and
        exit loads, and a bucket only counts as off-target past a {band}% band.
      </p>

      {editor}
    </Spotlight>
  );
}
