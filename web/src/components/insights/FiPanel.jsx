import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Check, ChevronDown, SlidersHorizontal, Target } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, percent, dateLabel } from '../../lib/format.js';
import { Aurora, Counter } from '../fx.jsx';

/* ============================================================================
   Financial independence — the one number that gives every other number on this
   page its meaning. It is the page's hero, so it gets the navy panel: the same
   surface the dashboard uses for net worth, and one that reads identically in
   light and dark rather than being re-tinted twice.

   Every projected figure carries a visible "projection" mark, and the
   assumptions that produce it are one click away and editable in place.
   ========================================================================== */

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// The panel sits on navy in BOTH themes, so its actions are styled here rather
// than with .btn-primary — brand-600 on brand-700 is nearly invisible, and the
// champagne accent is the one colour that carries on this surface.
const goldBtn =
  'btn bg-gold-400 text-brand-900 hover:bg-gold-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-200';
const quietBtn = 'btn bg-white/10 text-white ring-1 ring-inset ring-white/15 hover:bg-white/15';

// Percentages of a lifetime goal: one decimal while it still matters, none once
// the figure is large enough that a decimal is just noise.
const pctText = (v) => (v == null ? '—' : `${Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)}%`);

function yearsText(y) {
  if (y == null) return null;
  if (y <= 0) return 'now';
  if (y < 1) {
    const m = Math.max(1, Math.round(y * 12));
    return `${m} month${m === 1 ? '' : 's'}`;
  }
  return `${y.toFixed(1)} years`;
}

/* --------------------------------- gauge ---------------------------------- */
// A half-dial rather than a bar: progress toward FI is a long road, and an arc
// shows both how far along you are and how much road is left in one read. The
// champagne tick is Coast-FI — the point on the same road where you could stop
// adding money and still arrive on time.
//
// The caption is passed in rather than derived from `reached`: a target the user
// picked out of the air is not a claim about their life, so only a target sized
// from real spending may say "financially independent".
function Gauge({ pct, coastPct, caption }) {
  const reduced = useReducedMotion();
  const frac = clamp01((pct || 0) / 100);
  const coast = coastPct == null ? null : clamp01(coastPct / 100);

  const cx = 130;
  const cy = 124;
  const r = 104;
  const point = (f) => {
    const t = Math.PI * (1 - f);
    return [cx + r * Math.cos(t), cy - r * Math.sin(t)];
  };
  const tick = (f, inner, outer) => {
    const t = Math.PI * (1 - f);
    const c = Math.cos(t);
    const s = Math.sin(t);
    return { x1: cx + inner * c, y1: cy - inner * s, x2: cx + outer * c, y2: cy - outer * s };
  };
  const [ax, ay] = point(0);
  const [bx, by] = point(1);
  const arc = `M ${ax} ${ay} A ${r} ${r} 0 0 1 ${bx} ${by}`;
  const coastTick = coast == null ? null : tick(coast, r - 13, r + 13);

  return (
    <div className="relative mx-auto w-full max-w-[300px]">
      <svg viewBox="0 0 260 150" className="w-full" role="img" aria-label={`${pctText(pct)} of the way to financial independence`}>
        <defs>
          <linearGradient id="fi-arc" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#a8884b" />
            <stop offset="55%" stopColor="#e7d2a4" />
            <stop offset="100%" stopColor="#d8bb79" />
          </linearGradient>
        </defs>

        <path d={arc} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth="14" strokeLinecap="round" />

        {frac > 0 && (
          <motion.path
            d={arc}
            fill="none"
            stroke="url(#fi-arc)"
            strokeWidth="14"
            strokeLinecap="round"
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: frac }}
            transition={{ duration: reduced ? 0 : 0.45, ease: 'easeOut' }}
          />
        )}

        {coastTick && (
          <line
            {...coastTick}
            stroke="#f3e8ce"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.85"
          />
        )}
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-1 flex flex-col items-center">
        {/* Three digits plus a percent sign would crowd the arc at 5xl, so the
            size steps down once the figure gets long rather than colliding. */}
        <p
          className={`num font-extrabold leading-none tracking-tight text-white ${
            pctText(pct).length > 4 ? 'text-4xl' : 'text-5xl'
          }`}
        >
          <Counter value={pct || 0} format={(v) => pctText(v)} />
        </p>
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-200">
          {caption}
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------- rows ---------------------------------- */
// A stat is now a label and a figure on one line. No icon, no hint: the reason
// a figure is what it is belongs in the drawer, not stacked under every number.
function Row({ label, value, tone = 'plain' }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-200">{label}</dt>
      <dd
        className={`num text-sm font-bold tracking-tight ${
          tone === 'gold' ? 'text-gold-200' : tone === 'warn' ? 'text-rose-200' : 'text-white'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/* -------------------------------- the working ----------------------------- */
// The white cards share Details.jsx; this panel can't — it sits on navy, and
// slate text would disappear into it. Same gesture, same words, this surface's
// palette, and deliberately built like the Assumptions disclosure below it so
// the two read as a pair.
function Working({ label = 'How this is worked out', children }) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();

  return (
    <div className="mt-6 border-t border-white/10 pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-1 text-left text-sm font-semibold text-brand-100 transition hover:text-white"
      >
        {label}
        <ChevronDown
          size={16}
          className={`flex-none text-brand-200 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-4 px-1 pb-1 pt-3 text-xs leading-relaxed text-brand-200">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------- assumptions ------------------------------ */
// The ticked set comes from the server's resolved `counted` flags rather than
// from prefs.fi_buckets — that way the default ("everything but property")
// arrives already expanded, and the checklist never has to re-derive it.
const seedBuckets = (fi) =>
  (Array.isArray(fi?.buckets) ? fi.buckets : []).filter((b) => b.counted).map((b) => b.bucket);

const seed = (prefs, fi) => ({
  fi_years: String(prefs?.fi_years ?? 30),
  expected_return: String(prefs?.expected_return ?? 10),
  inflation: String(prefs?.inflation ?? 6),
  annual_spend: prefs?.annual_spend == null ? '' : String(prefs.annual_spend),
  fi_target: prefs?.fi_target == null ? '' : String(prefs.fi_target),
  buckets: seedBuckets(fi),
});

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/* ------------------------------ bucket picker ----------------------------- */
// Which pots count toward the target. Property is the one thing left out by
// default — but "my stocks and funds only, ignore the cash" is a perfectly good
// question to ask, so every pot is a switch.
// onToggle takes the bucket, NOT a computed list: two switches flipped inside
// one render (a fast double-click, a held key) would otherwise both derive their
// new list from the same stale `chosen` and the first flip would be lost.
function BucketPicker({ buckets, chosen, onToggle, base }) {
  if (!buckets.length) return null;

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-200">
        What counts toward it
      </p>
      <div className="flex flex-wrap gap-2">
        {buckets.map((b) => {
          const on = chosen.includes(b.bucket);
          return (
            <button
              key={b.bucket}
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => onToggle(b.bucket)}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${
                on
                  ? 'bg-gold-400/20 text-white ring-1 ring-inset ring-gold-300/50'
                  : 'bg-white/5 text-brand-200 ring-1 ring-inset ring-white/10 hover:bg-white/10'
              }`}
            >
              <span
                aria-hidden
                className={`flex h-4 w-4 flex-none items-center justify-center rounded-[5px] ${
                  on ? 'bg-gold-300 text-brand-900' : 'ring-1 ring-inset ring-white/25'
                }`}
              >
                {on && <Check size={11} strokeWidth={3.5} />}
              </span>
              <span>
                {b.label}
                <span className="num ml-1.5 font-normal opacity-70">{money(b.value, base, { compact: true })}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-brand-200/85">
        Untick anything that won&apos;t fund your retirement. Property is left out by default — a home you live in
        can&apos;t pay for it, since selling means buying or renting another one.
      </p>
    </div>
  );
}

function NumField({ label, suffix, value, onChange, hint, placeholder }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-200">
        {label}
      </span>
      <span className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2 transition focus-within:border-gold-300/70">
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="num w-full bg-transparent text-sm font-semibold text-white outline-none placeholder:font-normal placeholder:text-brand-200/60"
        />
        {suffix && <span className="flex-none text-xs font-semibold text-brand-200">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-brand-200/85">{hint}</span>}
    </label>
  );
}

function Assumptions({ open, onToggle, prefs, fi, base, onSaved }) {
  const [form, setForm] = useState(() => seed(prefs, fi));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const reduced = useReducedMotion();

  // Re-seed whenever the server's saved prefs change, so a reload after saving
  // shows what was actually stored rather than what was typed.
  useEffect(() => setForm(seed(prefs, fi)), [prefs, fi]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const measured = fi?.measured;
  const usingOverride = fi?.spend_source === 'override';
  const usingTarget = fi?.target_source === 'custom';
  const available = Array.isArray(fi?.buckets) ? fi.buckets : [];
  // Everything but property IS the default, so a selection that matches it is
  // saved as "no selection" — otherwise a bucket the user opens tomorrow (their
  // first US stock) would sit outside a set that was frozen today.
  const defaultBuckets = available.filter((b) => b.bucket !== 'ASSETS').map((b) => b.bucket);

  // What a target typed into the box would actually fund each year, live as it
  // is typed — the inverse of the sizing formula the server uses:
  //   A = T·i / ((1+i)^N − 1),  and T/N when inflation is zero.
  const fundsPerYear = (() => {
    const t = Number(form.fi_target);
    const n = Number(form.fi_years);
    const i = Number(form.inflation) / 100;
    if (!(t > 0) || !(n > 0) || !Number.isFinite(i)) return null;
    const a = Math.abs(i) < 1e-9 ? t / n : (t * i) / ((1 + i) ** n - 1);
    return Number.isFinite(a) && a > 0 ? a : null;
  })();

  // What to send for fi_buckets. null means "no selection — count everything but
  // property", and it must be sent ONLY when that is genuinely what the user is
  // on. Inferring it from "the ticked set happens to match the default" is not
  // safe: a pool they deliberately left out can empty to zero, at which point
  // the two sets look identical and their choice would be silently thrown away.
  // So once a selection exists it is always sent explicitly, and the one way
  // back to the default is the button that says so.
  const bucketPayload = (reset) => {
    if (reset) return null;
    if (prefs?.fi_buckets) return form.buckets;
    return sameSet(form.buckets, defaultBuckets) ? null : form.buckets;
  };

  const save = async ({ clearSpend = false, clearTarget = false, resetBuckets = false } = {}) => {
    const y = Number(form.fi_years);
    const r = Number(form.expected_return);
    const i = Number(form.inflation);
    if (![y, r, i].every(Number.isFinite)) {
      setErr('Enter a number for the years to cover, expected return and inflation.');
      return;
    }
    if (y < 1 || y > 100) {
      setErr('Years to cover must be between 1 and 100.');
      return;
    }
    const raw = String(form.annual_spend).trim();
    let spend = null;
    if (!clearSpend && raw !== '') {
      spend = Number(raw);
      if (!Number.isFinite(spend) || spend < 0) {
        setErr('Annual spending must be a positive amount, or blank to use what you actually spent.');
        return;
      }
    }
    const rawTarget = String(form.fi_target).trim();
    let target = null;
    if (!clearTarget && rawTarget !== '') {
      target = Number(rawTarget);
      if (!Number.isFinite(target) || target <= 0) {
        setErr('Your target must be more than zero, or blank to size it from your spending.');
        return;
      }
    }
    // Refuse an empty selection only when there was something to select. Someone
    // whose only holding is property has nothing ticked by default, and must
    // still be able to save a horizon or a target.
    if (!resetBuckets && defaultBuckets.length && !form.buckets.length) {
      setErr('Tick at least one thing to count toward your target.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      // null clears an override: spending goes back to what the transactions
      // say, the target to the cost of those years of living, and the pot to
      // everything but property. Those are the honest defaults.
      await api('/insights/prefs', {
        method: 'PUT',
        body: {
          fi_years: y,
          expected_return: r,
          inflation: i,
          annual_spend: spend,
          fi_target: target,
          fi_buckets: bucketPayload(resetBuckets),
        },
      });
      if (clearSpend) setForm((f) => ({ ...f, annual_spend: '' }));
      if (clearTarget) setForm((f) => ({ ...f, fi_target: '' }));
      onSaved?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative mt-6 border-t border-white/10 pt-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-1 text-left transition hover:text-white"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-brand-100">
          <SlidersHorizontal size={15} className="text-gold-300" />
          Assumptions
        </span>
        <span className="flex items-center gap-2 text-xs text-brand-200">
          <span className="num hidden sm:inline">
            {fi?.assumptions?.years ?? '—'} years · {fi?.assumptions?.expected_return ?? '—'}% return ·{' '}
            {fi?.assumptions?.inflation ?? '—'}% inflation
          </span>
          <ChevronDown size={16} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-4 rounded-2xl bg-white/5 p-4 ring-1 ring-inset ring-white/10">
              <div className="grid gap-4 sm:grid-cols-3">
                <NumField
                  label="Years to cover"
                  suffix="yrs"
                  value={form.fi_years}
                  onChange={set('fi_years')}
                  hint="How long the pot has to last. 30 is the usual planning horizon."
                />
                <NumField
                  label="Expected return"
                  suffix="%"
                  value={form.expected_return}
                  onChange={set('expected_return')}
                  hint="Before inflation is taken off."
                />
                <NumField
                  label="Inflation"
                  suffix="%"
                  value={form.inflation}
                  onChange={set('inflation')}
                  hint="Subtracted from the return so the date is in today's money."
                />
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <NumField
                  label={`Annual spending (${base})`}
                  value={form.annual_spend}
                  onChange={set('annual_spend')}
                  placeholder="Leave blank to measure it"
                  hint={
                    measured?.annual_spend != null
                      ? `Leave blank to use what you actually spent — ${money(measured.annual_spend, base)} a year, measured across ${measured.months} month${measured.months === 1 ? '' : 's'} of transactions.`
                      : 'Leave blank once you have a couple of months of expenses recorded, and this is measured from them instead.'
                  }
                />
                <NumField
                  label={`My target (${base})`}
                  value={form.fi_target}
                  onChange={set('fi_target')}
                  placeholder="Leave blank to size it from spending"
                  hint={
                    // The live inverse of the sizing formula, so a round number
                    // typed here immediately shows what it actually buys per year.
                    fundsPerYear != null
                      ? `Spread over ${form.fi_years} years that funds about ${money(fundsPerYear, base)} a year.`
                      : 'Already know your number? Set it here and it overrides the spending-based one.'
                  }
                />
              </div>

              <div className="mt-5 border-t border-white/10 pt-4">
                <BucketPicker
                  buckets={available}
                  chosen={form.buckets}
                  onToggle={(bucket) =>
                    setForm((f) => ({
                      ...f,
                      buckets: f.buckets.includes(bucket)
                        ? f.buckets.filter((b) => b !== bucket)
                        : [...f.buckets, bucket],
                    }))
                  }
                  base={base}
                />
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
                <button type="button" className={goldBtn} disabled={saving} onClick={() => save()}>
                  {saving ? 'Saving…' : 'Save assumptions'}
                </button>
                {usingOverride && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-gold-300 underline decoration-gold-300/40 underline-offset-4 transition hover:text-gold-200 disabled:opacity-60"
                    disabled={saving}
                    onClick={() => save({ clearSpend: true })}
                  >
                    Use my measured spending instead
                  </button>
                )}
                {usingTarget && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-gold-300 underline decoration-gold-300/40 underline-offset-4 transition hover:text-gold-200 disabled:opacity-60"
                    disabled={saving}
                    onClick={() => save({ clearTarget: true })}
                  >
                    Size my target from spending instead
                  </button>
                )}
                {fi?.pot_source === 'custom' && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-gold-300 underline decoration-gold-300/40 underline-offset-4 transition hover:text-gold-200 disabled:opacity-60"
                    disabled={saving}
                    onClick={() => save({ resetBuckets: true })}
                  >
                    Count everything but property again
                  </button>
                )}
              </div>

              {err && (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-medium text-rose-100">
                  <AlertTriangle size={14} className="mt-0.5 flex-none" />
                  {err}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* --------------------------------- panel ---------------------------------- */
export default function FiPanel({ data, base, prefs, onSaved }) {
  const [open, setOpen] = useState(false);
  if (!data) return null;

  const shell = (children) => (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-6 text-white shadow-xl sm:p-8">
      <Aurora />
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/10" />
      <div className="relative">{children}</div>
    </div>
  );

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div>
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-300">
          <Target size={14} /> Financial independence
        </p>
        <h2 className="font-display mt-1.5 text-xl font-bold tracking-tight sm:text-2xl">
          The point where work becomes optional
        </h2>
      </div>
    </div>
  );

  if (data.error) {
    return shell(
      <>
        {header}
        <p className="mt-4 flex items-start gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm text-brand-100">
          <AlertTriangle size={16} className="mt-0.5 flex-none text-gold-300" />
          {data.error}
        </p>
      </>
    );
  }

  const measured = data.measured;

  // Not enough real data to size the target. We say exactly what's missing and
  // offer the one shortcut that unblocks it — never a placeholder number.
  if (!data.ready) {
    const held = (data.buckets || []).filter((b) => b.counted && b.value > 0);
    // Why we're stuck, in the server's own order of checks — so the headline
    // names the actual blocker rather than blaming missing data for a rate the
    // user set to zero. The full server reason is one click down.
    const blocked = (() => {
      if (data.spend_source === 'measured') {
        if (!data.months_measured) return "I don't know yet what a year of your life costs.";
        if (data.months_measured < 2) return "One month of spending isn't enough to work this out.";
      }
      if (!(data.annual_spend > 0))
        return data.spend_source === 'override'
          ? "Your spending is set to zero, so there's no target to reach."
          : 'The spending recorded so far adds up to nothing.';
      if (!(data.assumptions?.years > 0)) return 'Your horizon needs to be at least a year.';
      return "There isn't enough here yet to work out your number.";
    })();

    return shell(
      <>
        {header}

        <p className="mt-4 text-[15px] font-semibold leading-snug text-white">{blocked}</p>

        {data.liquid_net_worth > 0 && (
          <div className="mt-5">
            <p className="num text-4xl font-bold leading-none tracking-tight text-white">
              {money(data.liquid_net_worth, base)}
            </p>
            <p className="mt-1.5 text-sm text-brand-200">is saved so far — that much is real</p>
          </div>
        )}

        <p className="mt-5 text-sm text-brand-100">Set your target, or what you spend in a year, below.</p>

        {!open && (
          <button type="button" className={`${quietBtn} mt-4`} onClick={() => setOpen(true)}>
            <SlidersHorizontal size={15} /> Set my target
          </button>
        )}

        <Working label="Why there's no number yet">
          <p>{data.reason}</p>
          {held.length > 0 && (
            <p>
              What&apos;s counted so far:{' '}
              <span className="font-semibold text-brand-100">{held.map((b) => b.label).join(', ')}</span> —{' '}
              <span className="num font-semibold text-brand-100">{money(data.liquid_net_worth, base)}</span>. It&apos;s
              the target to measure it against that&apos;s missing, not the money.
            </p>
          )}
          {measured?.annual_spend != null && (
            <p>
              Your recorded spending so far works out at{' '}
              <span className="num font-semibold text-brand-100">{money(measured.annual_spend, base)}</span> a year,
              across {measured.months} month{measured.months === 1 ? '' : 's'} of transactions.
            </p>
          )}
        </Working>
        <Assumptions
          open={open}
          onToggle={() => setOpen((v) => !v)}
          prefs={prefs}
          fi={data}
          base={base}
          onSaved={onSaved}
        />
      </>
    );
  }

  const coastPct = data.fi_number > 0 && data.coast_fi_number != null ? (data.coast_fi_number / data.fi_number) * 100 : null;
  // Past 100% the tick would be clamped onto the end of the arc, where it looks
  // like a mark on the dial that nothing explains. Better no mark than a wrong one.
  const coastMark = coastPct != null && coastPct <= 100 ? coastPct : null;
  const years = data.fi_years ?? data.assumptions?.years ?? 30;
  const surplusKnown = data.monthly_surplus != null;
  const custom = data.target_source === 'custom';
  const counted = (data.buckets || []).filter((b) => b.counted);
  const leftOut = (data.buckets || []).filter((b) => !b.counted && b.value > 0);

  // Where the target came from. A number the user set is theirs, and saying so
  // matters — the alternative reads as though we worked it out for them.
  const targetHint = custom
    ? `The target you set.${
        data.implied_annual_spend
          ? ` Spread over ${years} years it funds about ${money(
              data.implied_annual_spend,
              base
            )} a year${
              data.annual_spend > 0
                ? `, against the ${money(data.annual_spend, base)} a year you ${
                    data.spend_source === 'override' ? 'told me you spend' : 'actually spend'
                  }`
                : ''
            }.`
          : ''
      }`
    : `${money(data.monthly_spend, base)} a month × 12 × ${years} years, with each year grown at ${
        data.assumptions?.inflation
      }% inflation — spending ${
        data.spend_source === 'override'
          ? 'you set yourself'
          : `measured across ${data.months_measured} month${data.months_measured === 1 ? '' : 's'} of your own transactions`
      }.`;

  // "Reached" against a target the user picked says nothing about whether it
  // covers their life. Someone who set a round ₹1 crore while spending ₹12 lakh
  // a year must not be told their pot covers their spending — at 4% it funds
  // ₹4 lakh. Only the spending-derived target earns that sentence.
  const reachedHint =
    custom && data.implied_annual_spend
      ? `Your pot covers the ${money(data.fi_number, base)} target you set. Spread over ${
          years
        } years that funds about ${money(data.implied_annual_spend, base)} a year${
          data.annual_spend > 0
            ? ` — ${
                data.implied_annual_spend >= data.annual_spend ? 'comfortably above' : 'short of'
              } the ${money(data.annual_spend, base)} a year you spend`
            : ''
        }.`
      : `Your pot already covers ${years} years of your spending, inflation included.`;

  // What's in the pot, and — just as importantly — what isn't. Anything left out
  // is named with its value, so the gap against the dashboard's net worth is
  // always explained rather than discovered.
  const potHint =
    data.pot_source === 'custom'
      ? `${counted.map((b) => b.label).join(', ') || 'Nothing selected'}${
          leftOut.length
            ? `. Deliberately leaves out ${leftOut
                .map((b) => `${b.label} (${money(b.value, base)})`)
                .join(', ')} — which is why this is smaller than your dashboard net worth.`
            : ' — everything you hold counts toward this.'
        }`
      : data.breakdown?.excluded_assets > 0
        ? `Investments and cash only. This deliberately leaves out ${money(
            data.breakdown.excluded_assets,
            base
          )} of property and other assets — a home you live in can't pay for your retirement, which is why this is smaller than your dashboard net worth.`
        : 'Investments and cash — the money that can actually fund your retirement.';

  // The verdict. One sentence, derived: the reader came here to ask "when", and
  // every branch maps onto one the server can actually return — you're there,
  // here's the date, nothing measured, nothing going in, or no date worth giving.
  const verdict = (() => {
    if (data.reached) return "You've reached your number.";
    if (data.fi_date) return `You should get there around ${dateLabel(data.fi_date)}.`;
    if (!surplusKnown || data.months_measured < 2) return "There isn't enough recorded yet to put a date on this.";
    if (data.monthly_surplus < 0) return "You're spending more than you earn, so there's no date yet.";
    if (data.monthly_surplus === 0) return "Nothing is going into the pot, so there's no date yet.";
    // Two payloads land here: returns never catch the target, and a date so far
    // out the server refuses to print it. "No date is produced" is false of the
    // second — it produced one and threw it away — so say neither.
    return "There's no sensible date at these assumptions.";
  })();

  // The one supporting line, and only where there is something true to add.
  // "Reached" against a target the user picked says nothing about whether it
  // covers their life, so that case names what it actually funds.
  const support = data.reached
    ? custom
      ? data.implied_annual_spend
        ? `Spread over ${years} years it funds about ${money(data.implied_annual_spend, base)} a year.`
        : 'That covers the target you set for yourself.'
      : `What you have covers ${years} years of your spending, inflation included.`
    : data.fi_date
      ? `About ${yearsText(data.years_to_fi)} away if you keep saving ${money(data.monthly_surplus, base)} a month.`
      : null;

  // Only when there is something to do about it.
  const action = (() => {
    if (data.reached || data.fi_date) return null;
    if (!surplusKnown || data.months_measured < 2)
      return 'Record a couple of months of income and spending to get a date.';
    if (data.monthly_surplus <= 0) return 'Put something aside each month, and a date can appear here.';
    return 'Adjust the assumptions below and see whether a date appears.';
  })();

  const projected = !data.reached && data.fi_date != null;
  const beyond = data.liquid_net_worth - data.fi_number;

  // Being past a target you picked yourself is not the same as being past one
  // sized from your spending, and only the second one covers your life. So a
  // custom target is never described as "what you need".
  const gaugeCaption = !data.reached
    ? 'of the way there'
    : custom
      ? 'of the target you set'
      : 'Financially independent';
  const gapLabel = !data.reached ? 'Still to go' : custom ? 'Past your target' : 'More than you need';

  return shell(
    <>
      {header}

      {/* -------------------------------- verdict --------------------------- */}
      <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold leading-snug text-white">
        {verdict}
        {projected && (
          <span className="chip bg-white/10 text-[10px] font-bold uppercase tracking-wider text-gold-200">
            Projection
          </span>
        )}
      </p>
      {support && <p className="mt-1.5 text-sm leading-relaxed text-brand-200">{support}</p>}

      {/* The dial IS this panel's one big figure — how far along you are. Every
          other number here is a row beside it, none of them competing at its size. */}
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:gap-10">
        <div className="flex flex-col items-center">
          <Gauge pct={data.pct} coastPct={coastMark} caption={gaugeCaption} />
          {/* The tick on the arc means nothing without this line. */}
          {coastMark != null && (
            <p className="mt-3 flex items-center gap-2 text-center text-[11px] text-brand-200">
              <span aria-hidden className="inline-block h-3.5 w-[2.5px] flex-none rounded bg-gold-100" />
              The mark is where you could stop adding money
            </p>
          )}
        </div>

        <dl className="divide-y divide-white/10 border-t border-white/10 lg:self-center">
          <Row label="Your number" tone="gold" value={money(data.fi_number, base)} />
          <Row
            label={data.pot_source === 'custom' ? "What you're counting" : 'What you have'}
            value={money(data.liquid_net_worth, base)}
          />
          <Row label={gapLabel} value={money(data.reached ? beyond : data.shortfall, base)} />
          <Row
            label="Saving each month"
            // A deficit is the single most consequential fact on this panel —
            // it's why there's no date — so it doesn't get to look like a win.
            tone={surplusKnown && data.monthly_surplus < 0 ? 'warn' : 'plain'}
            value={surplusKnown ? money(data.monthly_surplus, base) : 'Not measured yet'}
          />
        </dl>
      </div>

      {action && <p className="mt-5 text-sm text-brand-100">{action}</p>}

      {/* -------------------------------- working --------------------------- */}
      <Working>
        <div>
          <p className="font-semibold text-brand-100">
            Your number — <span className="num">{money(data.fi_number, base)}</span>
          </p>
          <p className="mt-1">{targetHint}</p>
          {/* The arithmetic itself, spelled out. The inflation line is the one
              people query — thirty flat years reads like the whole answer until
              you see that the thirtieth year costs five times the first. */}
          {!custom && data.flat_total != null && (
            <p className="mt-1.5">
              {years} years at today&apos;s prices would be{' '}
              <span className="num">{money(data.flat_total, base)}</span>
              {data.inflation_uplift > 0 && (
                <>
                  ; inflation at <span className="num">{data.assumptions?.inflation}%</span> adds{' '}
                  <span className="num">{money(data.inflation_uplift, base)}</span> on top, because the last of
                  those years costs far more than the first.
                </>
              )}
            </p>
          )}
          <p className="mt-1.5 text-brand-200/80">
            This is the whole bill up front: it does not assume the pot keeps earning while you spend it. A pot
            left invested through retirement would not need to be this large, so treat this as the safe end of
            the range rather than the smallest number that works.
          </p>
        </div>

        <div>
          <p className="font-semibold text-brand-100">
            What&apos;s counted — <span className="num">{money(data.liquid_net_worth, base)}</span>
          </p>
          <p className="mt-1">{potHint}</p>
        </div>

        <div>
          <p className="font-semibold text-brand-100">The date</p>
          <p className="mt-1">
            {data.reached
              ? reachedHint
              : data.fi_date
                ? `About ${yearsText(data.years_to_fi)} away if you keep adding ${money(
                    data.monthly_surplus,
                    base
                  )} a month and returns hold. An estimate, not a promise.`
                : data.years_reason}
          </p>
          <p className="mt-1">
            {surplusKnown
              ? `What you save each month is your income minus your spending, averaged over ${
                  data.months_measured
                } month${data.months_measured === 1 ? '' : 's'}${
                  measured?.includes_current_month ? ', including this one, which is still in progress' : ''
                }.`
              : 'Record income and expenses for a couple of months and the monthly figure fills in.'}
          </p>
        </div>

        <div>
          <p className="font-semibold text-brand-100">
            Coast-FI — {data.coast_fi_number != null ? <span className="num">{money(data.coast_fi_number, base)}</span> : '—'}
          </p>
          <p className="mt-1">
            {data.coast_fi_number == null
              ? 'Not projectable at these assumptions.'
              : data.coast_reached
                ? `You're past it. If you stopped adding money today, growth alone should carry you to your number${
                    data.coast_horizon_assumed ? ` within ${yearsText(data.coast_horizon_years)}` : ''
                  }.`
                : `Reach this and you could stop adding money — growth alone would cover the rest over ${yearsText(
                    data.coast_horizon_years
                  )}${data.coast_horizon_assumed ? ', an assumed horizon since no date could be projected' : ''}. ${money(
                    Math.max(0, data.coast_fi_number - data.liquid_net_worth),
                    base
                  )} to go.`}
            {coastMark != null && (
              <> It is the champagne mark on the dial, at <span className="num">{pctText(coastMark)}</span>.</>
            )}
          </p>
        </div>

        <div>
          <p className="font-semibold text-brand-100">Projections, not forecasts</p>
          <p className="mt-1">
            The date and the Coast-FI figure grow the pot in real terms — a{' '}
            <span className="num">{percent(data.assumptions?.real_return)}</span> return after{' '}
            <span className="num">{data.assumptions?.inflation}%</span> inflation — so today&apos;s spending stays
            comparable with tomorrow&apos;s pot. Change any assumption below and every figure here moves with it.
          </p>
        </div>
      </Working>

      <Assumptions
        open={open}
        onToggle={() => setOpen((v) => !v)}
        prefs={prefs}
        fi={data}
        base={base}
        onSaved={onSaved}
      />
    </>
  );
}
