import { useEffect, useId, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, Loader2, Plus, Scale, SlidersHorizontal, Target, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, percent } from '../../lib/format.js';
import { ErrorBanner, Modal, PrimaryButton } from '../ui.jsx';
import { Spotlight } from '../fx.jsx';
import { useConfirm } from '../../lib/confirm.jsx';
import Details from './Details.jsx';

/* ============================================================================
   Target mix.

   Plain first. The reader wants one thing here — "am I where I meant to be,
   and if not, what do I move?" — and they should get it in a sentence, a
   number, and a short list, before anything else asks for their attention.

   Every bucket's exact position, the 5% tolerance, what the mix is measured
   against and what sits outside it are all real and all stay: one click down.
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
// Shares of a whole, so no +/- sign — `percent()` is for changes, not weights.
const pct1 = (n) => (Number.isFinite(Number(n)) ? `${Number(n).toFixed(1)}%` : '—');
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
// A diverging bar, shown in the drawer. The centre line IS the target, so "on
// target" is a position you can see rather than a number you have to subtract.
// The shaded middle is the slack: inside it, the gap isn't worth trading on.
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
        {/* the slack around the target */}
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
                {over ? 'above plan' : 'below plan'}
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
            'Close enough'
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
  // be accepted. A mix that doesn't total 100% would misreport every gap.
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
      message: 'Your holdings stay exactly as they are. Only the targets go away.',
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
        Set the share each bucket should hold. They have to add up to 100%.
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
  const excluded = Array.isArray(data?.excluded) ? data.excluded : [];
  const band = data?.band_pct > 0 ? data.band_pct : 5;

  // One shared scale across every bar, so the rows are comparable to each other
  // — a per-row scale would make a 2% drift and a 40% drift draw the same width.
  const scale = useMemo(() => {
    const worst = rows.reduce((m, r) => Math.max(m, Math.abs(r.drift_pct || 0)), 0);
    return Math.min(100, Math.max(band * 1.6, worst * 1.08, 1));
  }, [rows, band]);

  // Furthest from its share, whether or not that gap is worth acting on. The
  // `!m` seed matters: a mix that sits exactly on target has every drift at 0,
  // and a plain `>` comparison would leave this null and print a nameless gap.
  const worst = useMemo(
    () => rows.reduce((m, r) => (!m || Math.abs(r.drift_pct || 0) > Math.abs(m.drift_pct || 0) ? r : m), null),
    [rows]
  );

  // The rows that actually need something done, and the one carrying the most
  // money — that row, not the widest percentage, is what the verdict is about.
  // No fallback to `worst`: `worst` can be a row that is perfectly on target,
  // and the verdict below would then say it is off plan when it isn't.
  const offRows = useMemo(() => rows.filter((r) => r.action !== 'hold'), [rows]);
  const lead = useMemo(
    () =>
      offRows.reduce(
        (m, r) => (!m || Math.abs(r.action_amount || 0) > Math.abs(m.action_amount || 0) ? r : m),
        null
      ),
    [offRows]
  );

  const header = (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Scale size={18} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <h2 id={titleId} className="font-display text-lg font-bold tracking-tight text-slate-900">
          Target mix
        </h2>
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
        <p className="mt-6 text-sm leading-relaxed text-slate-500">
          {data?.error || 'This reading is unavailable right now.'}
        </p>
      </Spotlight>
    );
  }

  /* ------------------------------- no targets ------------------------------- */
  // Nothing is invented here: with no target there is no gap to report, so we
  // show the mix as it stands and invite them to set one.
  if (!data.has_targets) {
    return (
      <Spotlight as="section" aria-labelledby={titleId} className="card flex h-full flex-col p-5 sm:p-6">
        {header}

        <p className="mt-4 text-[15px] font-semibold leading-snug text-slate-800">
          You haven&apos;t set a target mix yet.
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
          Set one and this panel tells you exactly what to move.
        </p>

        <div className="mt-5">
          <PrimaryButton onClick={() => setEditing(true)} magnetic>
            <Target size={16} /> Set a target mix
          </PrimaryButton>
        </div>

        {rows.length > 0 && (
          <div className="mt-6">
            <p className="label">Your mix today</p>
            <ul className="divide-y divide-slate-100">
              {rows.slice(0, 5).map((r) => (
                <li key={r.bucket} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-sm text-slate-700">{r.label}</span>
                  <span className="num shrink-0 text-sm font-semibold text-slate-800">
                    {pct1(r.current_pct)}
                    <span className="ml-2 font-medium text-slate-400">
                      {money(Math.round(r.current_value), base, { compact: true })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {rows.length > 5 && (
          <Details label="The rest of your mix">
            <ul className="divide-y divide-slate-100">
              {rows.slice(5).map((r) => (
                <li key={r.bucket} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-slate-600">{r.label}</span>
                  <span className="num shrink-0 font-semibold text-slate-700">
                    {pct1(r.current_pct)}
                    <span className="ml-2 font-medium text-slate-400">
                      {money(Math.round(r.current_value), base, { compact: true })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Details>
        )}
        {editor}
      </Spotlight>
    );
  }

  /* -------------------- targets set, but nothing to measure ----------------- */
  // has_value is the server's own word for this, but every figure below divides
  // by `total`, so gate on the number we actually use. They agree by contract;
  // reading both means a payload missing the newer field still lands here.
  const totalValue = Number(data.total) || 0;
  if (data.has_value === false || totalValue <= 0) {
    const wanted = rows.filter((r) => r.target_pct > 0);
    return (
      <Spotlight as="section" aria-labelledby={titleId} className="card flex h-full flex-col p-5 sm:p-6">
        {header}

        <p className="mt-4 text-[15px] font-semibold leading-snug text-slate-800">
          Your mix is saved, but there&apos;s nothing to measure it against yet.
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
          Add a holding, some cash or an asset and this fills in.
        </p>

        <div className="mt-6">
          <p className="label">What you&apos;re aiming for</p>
          <ul className="divide-y divide-slate-100">
            {wanted.slice(0, 5).map((r) => (
              <li key={r.bucket} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm text-slate-700">{r.label}</span>
                <span className="num shrink-0 text-sm font-semibold text-slate-800">
                  {r.target_pct.toFixed(r.target_pct % 1 ? 1 : 0)}%
                </span>
              </li>
            ))}
          </ul>
        </div>

        {wanted.length > 5 && (
          <Details label="The rest of your mix">
            <ul className="divide-y divide-slate-100">
              {wanted.slice(5).map((r) => (
                <li key={r.bucket} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-slate-600">{r.label}</span>
                  <span className="num shrink-0 font-semibold text-slate-700">
                    {r.target_pct.toFixed(r.target_pct % 1 ? 1 : 0)}%
                  </span>
                </li>
              ))}
            </ul>
          </Details>
        )}
        {editor}
      </Spotlight>
    );
  }

  /* --------------------------------- the real thing ------------------------- */

  // Read off the same rows the list below renders, so the sentence and the list
  // can never contradict each other. It is the server's own in_band rule
  // (`rows.every(r => r.action === 'hold')`), applied to what is on screen.
  const balanced = offRows.length === 0;

  // The verdict. Not a slogan — it comes from the row carrying the most money,
  // and when no row needs anything the plain truth is that the mix is fine.
  const verdict = balanced
    ? 'Your mix is close enough to your plan.'
    : lead
      ? `You're holding ${lead.action === 'sell' ? 'more' : 'less'} ${lead.label} than you planned.`
      : 'Your mix has moved away from your plan.';

  // The number. Off plan the reader wants the money, and it has to be a figure
  // the caption can honestly name. With moves, that is what those moves shift.
  // Without them nothing nets off, so the only true amount is the lead bucket's
  // own gap — a sum of unpaired buys would be money that has to come from
  // somewhere else entirely, and "to move" would be a lie.
  const movesTotal = moves.reduce((s, m) => s + Math.abs(Number(m.amount) || 0), 0);
  const paired = moves.length > 0 && movesTotal > 0;
  const toMove = paired ? movesTotal : Math.abs(lead?.action_amount || 0);

  return (
    <Spotlight as="section" aria-labelledby={titleId} className="card flex h-full flex-col p-5 sm:p-6">
      {header}

      {/* -------------------------------- verdict ---------------------------- */}
      <p className="mt-4 text-[15px] font-semibold leading-snug text-slate-800">{verdict}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
        {balanced
          ? 'Nothing is far enough off to be worth trading.'
          : offRows.length === 1
            ? 'One bucket is out of line.'
            : `${offRows.length} buckets are out of line.`}
      </p>

      {/* ------------------------------ the number --------------------------- */}
      <div className="mt-5">
        <p className="num text-4xl font-bold leading-none tracking-tight text-slate-900">
          {balanced ? pct1(Math.abs(worst?.drift_pct || 0)) : money(toMove, base, { compact: true })}
        </p>
        <p className="mt-1.5 text-sm text-slate-500">
          {balanced ? (
            <>
              is the biggest gap — <span className="text-slate-700">{worst?.label || 'your mix'}</span>
            </>
          ) : paired || !lead ? (
            'to move between your buckets'
          ) : (
            <>
              {lead.action === 'buy' ? 'to put into' : 'to take out of'}{' '}
              <span className="text-slate-700">{lead.label}</span>
            </>
          )}
        </p>
      </div>

      {/* --------------------- one supporting block, never two --------------- */}
      {moves.length > 0 ? (
        <div className="mt-5">
          <p className="label">What to move</p>
          <ol className="divide-y divide-slate-100">
            {moves.map((m, i) => (
              <li
                key={`${m.from_bucket || m.from}-${m.to_bucket || m.to}-${i}`}
                className="flex items-baseline justify-between gap-3 py-2"
              >
                <span className="min-w-0 truncate text-sm text-slate-700">
                  {m.from}{' '}
                  <ArrowRight size={13} className="-mt-0.5 inline text-slate-300" aria-hidden="true" />{' '}
                  <span className="text-slate-800">{m.to}</span>
                </span>
                <span className="num shrink-0 text-sm font-semibold text-slate-800">
                  {wholeMoney(m.amount, base)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : offRows.length > 0 ? (
        <div className="mt-5">
          <p className="label">What&apos;s out of line</p>
          <ul className="divide-y divide-slate-100">
            {offRows.slice(0, 5).map((r) => (
              <li key={r.bucket} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm text-slate-700">{r.label}</span>
                <span className="shrink-0 text-sm font-semibold text-slate-800">
                  {r.action === 'buy' ? 'Add' : 'Trim'}{' '}
                  <span className="num">{money(Math.abs(r.action_amount), base, { compact: true })}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-5">
          <p className="label">Your mix now</p>
          <ul className="divide-y divide-slate-100">
            {rows.slice(0, 5).map((r) => (
              <li key={r.bucket} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm text-slate-700">{r.label}</span>
                <span className="num shrink-0 text-sm font-semibold text-slate-800">
                  {pct1(r.current_pct)}
                  <span className="ml-2 font-medium text-slate-400">
                    of {r.target_pct.toFixed(r.target_pct % 1 ? 1 : 0)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* -------------------------------- working ---------------------------- */}
      <Details>
        <div>
          <p className="font-semibold text-slate-700">Every bucket</p>
          <ul className="mt-1 divide-y divide-slate-100">
            {rows.map((r) => (
              <DriftRow key={r.bucket} row={r} scale={scale} band={band} base={base} />
            ))}
          </ul>
        </div>

        <p>
          A bucket only counts as off once it is more than{' '}
          <span className="num font-semibold text-slate-600">{band}%</span> away from its target
          share. Smaller gaps cost more in spread, brokerage and tax to close than they are worth,
          so they are left alone.
        </p>

        <p>
          The mix is measured against{' '}
          <span className="num font-semibold text-slate-600">{money(data.total, base)}</span> — only
          the buckets you gave a target to. Anything you hold outside the mix is left out of the
          denominator, so a house or a side pot cannot make every target look starved.
        </p>

        {excluded.length > 0 && (
          <div>
            <p className="font-semibold text-slate-700">Held outside your mix</p>
            <ul className="mt-2 divide-y divide-slate-100">
              {excluded.map((e) => (
                <li key={e.bucket} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate text-slate-600">{e.label}</span>
                  <span className="num shrink-0 font-semibold text-slate-700">
                    {money(Math.round(e.value), base, { compact: true })}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2">
              These are not counted above. Add a target for one and it joins the mix.
            </p>
          </div>
        )}

        <p>
          Amounts are estimates, from today&apos;s prices and rates in {base}. They exclude tax,
          brokerage and exit loads, and the largest four moves are listed at most.
        </p>
      </Details>

      {editor}
    </Spotlight>
  );
}
