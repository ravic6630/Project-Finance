import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Flag,
  SlidersHorizontal,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';
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
function Gauge({ pct, coastPct, reached }) {
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
          {reached ? 'Financially independent' : 'of the way there'}
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------- stat ---------------------------------- */
function Stat({ icon: Icon, label, value, hint, tone = 'plain', estimate = false }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span
        className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-xl ${
          tone === 'gold'
            ? 'bg-gold-400/15 text-gold-200'
            : tone === 'warn'
              ? 'bg-rose-400/15 text-rose-200'
              : 'bg-white/10 text-brand-100'
        }`}
      >
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-200">
          {label}
          {estimate && (
            <span className="chip bg-white/10 text-[10px] font-bold uppercase tracking-wider text-gold-200">
              Projection
            </span>
          )}
        </p>
        <p
          className={`num mt-1 text-lg font-bold tracking-tight ${
            tone === 'gold' ? 'text-gold-200' : tone === 'warn' ? 'text-rose-200' : 'text-white'
          }`}
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-xs leading-relaxed text-brand-200/80">{hint}</p>}
      </div>
    </div>
  );
}

/* ------------------------------- assumptions ------------------------------ */
const seed = (prefs) => ({
  withdrawal_rate: String(prefs?.withdrawal_rate ?? 4),
  expected_return: String(prefs?.expected_return ?? 10),
  inflation: String(prefs?.inflation ?? 6),
  annual_spend: prefs?.annual_spend == null ? '' : String(prefs.annual_spend),
});

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
  const [form, setForm] = useState(() => seed(prefs));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const reduced = useReducedMotion();

  // Re-seed whenever the server's saved prefs change, so a reload after saving
  // shows what was actually stored rather than what was typed.
  useEffect(() => setForm(seed(prefs)), [prefs]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const measured = fi?.measured;
  const usingOverride = fi?.spend_source === 'override';

  const save = async (clearOverride = false) => {
    const w = Number(form.withdrawal_rate);
    const r = Number(form.expected_return);
    const i = Number(form.inflation);
    if (![w, r, i].every(Number.isFinite)) {
      setErr('Enter a number for the withdrawal rate, expected return and inflation.');
      return;
    }
    const raw = String(form.annual_spend).trim();
    let spend = null;
    if (!clearOverride && raw !== '') {
      spend = Number(raw);
      if (!Number.isFinite(spend) || spend < 0) {
        setErr('Annual spending must be a positive amount, or blank to use what you actually spent.');
        return;
      }
    }
    setSaving(true);
    setErr('');
    try {
      // null clears the override and returns to spending measured from real
      // transactions — the honest default.
      await api('/insights/prefs', {
        method: 'PUT',
        body: { withdrawal_rate: w, expected_return: r, inflation: i, annual_spend: spend },
      });
      if (clearOverride) setForm((f) => ({ ...f, annual_spend: '' }));
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
            {fi?.assumptions?.withdrawal_rate ?? '—'}% withdrawal · {fi?.assumptions?.expected_return ?? '—'}% return ·{' '}
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
                  label="Withdrawal rate"
                  suffix="%"
                  value={form.withdrawal_rate}
                  onChange={set('withdrawal_rate')}
                  hint="4% is the conventional study figure — a 25× target."
                />
                <NumField
                  label="Expected return"
                  suffix="%"
                  value={form.expected_return}
                  onChange={set('expected_return')}
                  hint="Nominal, before inflation."
                />
                <NumField
                  label="Inflation"
                  suffix="%"
                  value={form.inflation}
                  onChange={set('inflation')}
                  hint="Subtracted from the return so the date is in today's money."
                />
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
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
                </div>
                <div className="flex items-end gap-2">
                  <button type="button" className={`${goldBtn} w-full`} disabled={saving} onClick={() => save(false)}>
                    {saving ? 'Saving…' : 'Save assumptions'}
                  </button>
                </div>
              </div>

              {usingOverride && (
                <button
                  type="button"
                  className="mt-3 text-xs font-semibold text-gold-300 underline decoration-gold-300/40 underline-offset-4 transition hover:text-gold-200 disabled:opacity-60"
                  disabled={saving}
                  onClick={() => save(true)}
                >
                  Clear the override and use my measured spending
                </button>
              )}

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
    return shell(
      <>
        {header}
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-brand-100">{data.reason}</p>
        {data.liquid_net_worth > 0 && (
          <p className="mt-4 text-sm text-brand-200">
            What&apos;s here so far:{' '}
            <span className="num font-bold text-white">{money(data.liquid_net_worth, base)}</span> of investments and
            cash. That much is real — it&apos;s the target it has to be measured against that&apos;s missing.
          </p>
        )}
        {!open && (
          <button type="button" className={`${quietBtn} mt-5`} onClick={() => setOpen(true)}>
            <SlidersHorizontal size={15} /> Set my annual spending
          </button>
        )}
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
  const multiple = data.assumptions?.withdrawal_rate > 0 ? 100 / data.assumptions.withdrawal_rate : null;
  const surplusKnown = data.monthly_surplus != null;

  return shell(
    <>
      {header}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:gap-10">
        <div className="flex flex-col items-center">
          <Gauge pct={data.pct} coastPct={coastPct} reached={data.reached} />
          <div className="-mt-1 flex w-full max-w-[300px] items-start justify-between gap-4 px-1">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-200/80">Today</p>
              <p className="num text-sm font-bold text-white">
                {money(data.liquid_net_worth, base, { compact: true })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-200/80">FI number</p>
              <p className="num text-sm font-bold text-gold-200">{money(data.fi_number, base, { compact: true })}</p>
            </div>
          </div>
          {/* The tick on the arc means nothing without this line. */}
          {coastPct != null && coastPct <= 100 && (
            <p className="mt-4 flex items-center gap-2 text-[11px] text-brand-200">
              <span aria-hidden className="inline-block h-3.5 w-[2.5px] flex-none rounded bg-gold-100" />
              Coast-FI sits at <span className="num font-semibold text-brand-100">{pctText(coastPct)}</span>
            </p>
          )}

          <div className="mt-5 w-full max-w-[300px] rounded-2xl bg-white/5 px-4 py-3 text-center ring-1 ring-inset ring-white/10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-200/80">
              {data.reached ? 'Beyond your FI number' : 'Still to go'}
            </p>
            <p className="num mt-1 text-xl font-bold text-white">
              {money(
                data.reached ? data.liquid_net_worth - data.fi_number : data.shortfall,
                base
              )}
            </p>
          </div>
        </div>

        <div className="divide-y divide-white/10">
          <Stat
            icon={Flag}
            tone="gold"
            label="Your FI number"
            value={money(data.fi_number, base)}
            hint={`${multiple ? `${multiple.toFixed(multiple % 1 ? 1 : 0)}× ` : ''}your annual spending of ${money(
              data.annual_spend,
              base
            )} — ${
              data.spend_source === 'override'
                ? 'the figure you set'
                : `measured across ${data.months_measured} month${data.months_measured === 1 ? '' : 's'} of your own transactions`
            }.`}
          />
          <Stat
            icon={Wallet}
            label="Liquid net worth"
            value={money(data.liquid_net_worth, base)}
            hint={
              data.breakdown?.excluded_assets > 0
                ? `Investments and cash only. This deliberately leaves out ${money(
                    data.breakdown.excluded_assets,
                    base
                  )} of property and other assets — a home you live in can't pay for your retirement, which is why this is smaller than your dashboard net worth.`
                : 'Investments and cash — the money that can actually fund a withdrawal.'
            }
          />
          <Stat
            icon={TrendingUp}
            // A deficit is the single most consequential fact on this panel —
            // it's why there's no date — so it doesn't get to look like a win.
            tone={surplusKnown && data.monthly_surplus < 0 ? 'warn' : 'plain'}
            label="Monthly surplus"
            value={surplusKnown ? money(data.monthly_surplus, base) : 'Not measured yet'}
            hint={
              surplusKnown
                ? `Income minus spending, averaged over ${data.months_measured} month${
                    data.months_measured === 1 ? '' : 's'
                  }${measured?.includes_current_month ? ', including this one, which is still in progress' : ''}.`
                : 'Record income and expenses for a couple of months and this fills in.'
            }
          />
          <Stat
            icon={CalendarClock}
            // "Reached" is a fact about today, not a projection — no chip.
            estimate={!data.reached && data.fi_date != null}
            label="Projected FI date"
            value={
              data.reached
                ? 'Reached'
                : data.fi_date
                  ? dateLabel(data.fi_date)
                  : 'No date yet'
            }
            hint={
              data.reached
                ? 'Your liquid net worth already covers your spending at this withdrawal rate.'
                : data.fi_date
                  ? `About ${yearsText(data.years_to_fi)} away if you keep adding ${money(
                      data.monthly_surplus,
                      base
                    )} a month and returns hold. An estimate, not a promise.`
                  : data.years_reason
            }
          />
          <Stat
            icon={CheckCircle2}
            estimate={!data.coast_reached && data.coast_fi_number != null}
            label="Coast-FI"
            value={data.coast_fi_number != null ? money(data.coast_fi_number, base) : '—'}
            hint={
              data.coast_fi_number == null
                ? 'Not projectable at these assumptions.'
                : data.coast_reached
                  ? `You're past it. If you stopped adding money today, growth alone should carry you to your FI number${
                      data.coast_horizon_assumed ? ` within ${yearsText(data.coast_horizon_years)}` : ''
                    }.`
                  : `Reach this and you could stop adding money — growth alone would cover the rest over ${yearsText(
                      data.coast_horizon_years
                    )}${data.coast_horizon_assumed ? ', an assumed horizon since no date could be projected' : ''}. ${money(
                      Math.max(0, data.coast_fi_number - data.liquid_net_worth),
                      base
                    )} to go.`
            }
          />
        </div>
      </div>

      <p className="mt-6 flex items-start gap-2 rounded-2xl bg-white/5 px-4 py-3 text-xs leading-relaxed text-brand-200 ring-1 ring-inset ring-white/10">
        <AlertTriangle size={14} className="mt-0.5 flex-none text-gold-300" />
        <span>
          The date and Coast-FI figures are <strong className="font-semibold text-brand-100">projections</strong>, not
          forecasts. They grow the pot in <strong className="font-semibold text-brand-100">real terms</strong> — a{' '}
          <span className="num">{percent(data.assumptions?.real_return)}</span> return after{' '}
          <span className="num">{data.assumptions?.inflation}%</span> inflation — so today&apos;s spending stays
          comparable with tomorrow&apos;s pot. Change any assumption below and every figure here moves with it.
        </span>
      </p>

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
