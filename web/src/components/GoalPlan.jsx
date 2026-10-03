import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, CalendarClock, Check, ChevronDown, Info, Wallet } from 'lucide-react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { Aurora, Counter } from './fx.jsx';

/* ============================================================================
   The goal plan — what you own and what you save, spread across your goals.

   It sits on the navy panel the dashboard and Insights use for their headline
   numbers, and answers the two questions in the order people ask them: "what
   does the money I have cover?" and "can I afford the rest each month?".

   The meters use ONE fill colour, not a colour per goal. Goals can be put in
   any order, so any two could end up side by side, and past three hues no
   palette stays tellable-apart for everyone. So a goal's identity lives in its
   name, and colour only ever says "set aside", "free" or "short" — the last
   always with an icon and a label, never by colour alone.
   ========================================================================== */

// Champagne fill and a red "short" segment, validated as a pair on both ends of
// the navy gradient (colour-blind ΔE 12.9, normal vision 19.7, ≥3:1 contrast).
const FILL = '#d8bb79';
const SHORT = '#e66767';
const TRACK = 'rgba(255,255,255,0.13)';

const goldBtn =
  'btn bg-gold-400 text-brand-900 hover:bg-gold-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-200';
const quietBtn = 'btn bg-white/10 text-white ring-1 ring-inset ring-white/15 hover:bg-white/15';

const short = (v, cur) => money(v, cur, { compact: true });

// "Marriage", "Marriage and House", "Marriage, House and Car".
function names(list) {
  const n = list.map((g) => g.name);
  if (n.length <= 1) return n[0] || '';
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/* --------------------------------- meter ---------------------------------- */
// A single bar in three states. Segments are separated by a 2px gap of the
// panel itself, so the boundary reads even where two colours sit close.
function Meter({ parts, label }) {
  const reduced = useReducedMotion();
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  return (
    <div role="img" aria-label={label} className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full">
      {total <= 0 ? (
        <span className="h-full w-full rounded-full" style={{ background: TRACK }} />
      ) : (
        parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <motion.span
              key={p.key}
              title={p.title}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ background: p.color, ...(p.hatch ? { backgroundImage: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.22) 0 3px, transparent 3px 6px)' } : {}) }}
              initial={reduced ? false : { width: 0 }}
              animate={{ width: `${(p.value / total) * 100}%` }}
              transition={{ duration: reduced ? 0 : 0.7, ease: 'easeOut' }}
            />
          ))
      )}
    </div>
  );
}

function Key({ color, hatch, children }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="h-2 w-2 flex-none rounded-full"
        style={{ background: color, ...(hatch ? { backgroundImage: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.3) 0 2px, transparent 2px 4px)' } : {}) }}
      />
      {children}
    </span>
  );
}

// Each goal's share, by name. Text carries identity; the order is the plan's.
function Shares({ goals, field, cur, empty = '—' }) {
  return (
    <ul className="mt-3 space-y-1.5">
      {goals.map((g) => {
        const v = g.plan[field];
        return (
          <li key={g.id} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-baseline gap-2 text-brand-100">
              <span className="num flex-none text-[10px] font-bold text-gold-300">{g.plan.rank}</span>
              <span className="truncate">{g.name}</span>
              {/* this goal's money was chosen by name, not assigned by the plan */}
              {field === 'funded_now' && g.plan.dedicated && (
                <span className="flex-none text-[10px] font-semibold uppercase tracking-wider text-gold-300/90">chosen</span>
              )}
            </span>
            <span className={`num flex-none font-semibold ${v > 0 ? 'text-white' : 'text-brand-300'}`}>
              {v > 0 ? money(v, cur, { whole: true }) : empty}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------- monthly amount ------------------------------ */
function BudgetEditor({ plan, cur, onSaved, onCancel }) {
  const m = plan.monthly;
  const [value, setValue] = useState(m.amount != null ? String(Math.round(m.amount)) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async (amount) => {
    setBusy(true);
    setErr('');
    try {
      await api('/goals/plan', { method: 'PUT', body: { monthly_budget: amount } });
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    const n = Number(value);
    if (value.trim() === '' || !Number.isFinite(n) || n < 0) {
      setErr('Enter what you can put toward goals each month, or 0.');
      return;
    }
    save(n);
  };

  const measured = m.measured;
  return (
    <form onSubmit={submit} className="mt-3 rounded-2xl bg-white/5 p-3 ring-1 ring-inset ring-white/10">
      <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-200" htmlFor="goal-budget">
        What you can put toward goals each month ({cur})
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          id="goal-budget"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="num min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white outline-none transition placeholder:text-brand-200/60 focus:border-gold-300/70"
          placeholder="e.g. 50000"
        />
        <button className={goldBtn} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={quietBtn} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-rose-200">{err}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-brand-200/90">
        {measured && measured.income > 0
          ? `From your transactions: ${money(measured.income, cur, { whole: true })} in and ${money(measured.spend, cur, { whole: true })} out a month, across ${measured.months} month${measured.months === 1 ? '' : 's'} — ${money(Math.max(0, measured.surplus), cur, { whole: true })} left.`
          : 'Tip: record your salary and spending in Transactions and this is measured for you.'}
      </p>
      {m.source === 'set' && (
        <button
          type="button"
          onClick={() => save(null)}
          disabled={busy}
          className="mt-1.5 text-xs font-semibold text-gold-200 underline decoration-gold-300/40 underline-offset-2 hover:text-gold-100"
        >
          Stop using a set amount — measure it from my transactions
        </button>
      )}
    </form>
  );
}

function sourceLine(m, cur) {
  if (m.source === 'measured')
    return `${money(m.measured.income, cur, { whole: true })} in − ${money(m.measured.spend, cur, { whole: true })} out, averaged over ${m.measured.months} months`;
  if (m.source === 'set')
    return m.entered ? `Set by you as ${money(m.entered.amount, m.entered.currency, { whole: true })}` : 'Set by you';
  if (m.source === 'goals') return 'The monthly amounts saved on your goals';
  return null;
}

/* ------------------------------- the working ------------------------------ */
function HowItWorks({ plan, cur }) {
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
        How this plan works
        <ChevronDown size={16} className={`flex-none text-brand-200 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
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
            <ol className="list-decimal space-y-2.5 px-1 pb-1 pl-5 pt-3 text-xs leading-relaxed text-brand-200">
              <li>
                <span className="font-semibold text-brand-100">Choose what funds a goal, and it tracks exactly that.</span>{' '}
                On any goal, pick the investments and accounts you&apos;ve set aside for it — all of one, a fixed amount, or
                a share. That goal then shows precisely what those are worth, and nothing else is added to it.
              </li>
              <li>
                <span className="font-semibold text-brand-100">Everything you haven&apos;t chosen fills the other goals in order</span>{' '}
                — an emergency fund first, then the soonest date. Use the arrows on a goal to change the order.
              </li>
              <li>
                <span className="font-semibold text-brand-100">Each goal takes only what it needs today</span>: the
                amount that, left invested at the goal&apos;s expected return, grows into its target by its date.
                Whatever no goal needs stays free — it&apos;s never counted twice.
              </li>
              <li>
                <span className="font-semibold text-brand-100">What you save each month is shared the same way.</span>{' '}
                Each goal takes what it needs a month to stay on time, until the money runs out; later goals wait
                their turn. Any gap is shown as &ldquo;short&rdquo;.
              </li>
              <li>
                <span className="font-semibold text-brand-100">It moves with your wealth.</span> When markets rise or
                you add money, goals fill faster; when they fall, the plan says so.
              </li>
              <li>
                Only investments and cash are shared out automatically
                {plan.property_excluded > 0 ? ` — your property (${short(plan.property_excluded, cur)}) isn't` : ''}:
                selling a home to fund a goal means buying or renting another. Property or gold you do mean to sell
                for a goal can be chosen for it by name.
              </li>
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------- the card -------------------------------- */
export default function GoalPlanCard({ goals, plan, cur, onChanged, onResetOrder }) {
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [plan.monthly.amount, plan.monthly.source]);

  const m = plan.monthly;
  const known = m.amount != null;
  const covered = goals.filter((g) => g.plan.status === 'funded');
  const behind = goals.filter((g) => g.plan.status === 'behind');
  const waiting = goals.filter((g) => g.plan.status === 'waiting');
  const allGood = goals.every((g) => ['funded', 'on_track'].includes(g.plan.status));

  const headline = !known
    ? 'How much can you put toward goals each month?'
    : m.shortfall > 0.5
      ? `Your goals need ${short(m.needed, cur)} a month — you have ${short(m.amount, cur)}`
      : covered.length === goals.length
        ? 'Every goal is covered by what you have today'
        : allGood
          ? `You're on track — ${short(m.left_over, cur)} a month to spare`
          : 'Your plan needs a look';

  const sentences = [];
  if (covered.length) sentences.push(`${names(covered)} ${covered.length === 1 ? 'is' : 'are'} covered by what you have.`);
  if (!known) sentences.push(`Together your goals need ${money(m.needed, cur)} a month.`);
  if (behind[0])
    sentences.push(
      `${behind[0].name} gets ${short(behind[0].plan.monthly_share, cur)} a month but needs ${short(behind[0].plan.required_monthly, cur)}.`
    );
  if (waiting.length) sentences.push(`${names(waiting)} ${waiting.length === 1 ? 'waits' : 'wait'} until the goals above are funded.`);

  const pot = plan.pot;
  const setAside = pot.earmarked + pot.assigned;
  const scale = known ? Math.max(m.needed, m.amount) : 0;

  return (
    <section
      aria-labelledby="goal-plan-title"
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-6 text-white shadow-xl sm:p-8"
    >
      <Aurora />
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/10" />
      <div className="relative">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-300">
          <CalendarClock size={14} /> Your goal plan
        </p>
        <h2 id="goal-plan-title" className="font-display mt-2 text-2xl font-bold leading-tight tracking-tight sm:text-[1.7rem]">
          {headline}
        </h2>
        {sentences.length > 0 && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-brand-100">{sentences.join(' ')}</p>}

        <div className="mt-6 grid gap-6 md:grid-cols-2 md:gap-8">
          {/* ------------------------------ today ------------------------------ */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-200">What you have today</p>
            <p className="num mt-1 text-3xl font-extrabold tracking-tight">
              <Counter value={pot.total} format={(v) => money(v, cur)} />
            </p>
            <div className="mt-3">
              <Meter
                label={`${money(setAside, cur)} set aside for goals, ${money(pot.unassigned, cur)} free`}
                parts={[
                  { key: 'set', value: setAside, color: FILL, title: `Set aside for goals: ${money(setAside, cur)}` },
                  { key: 'free', value: pot.unassigned, color: TRACK, title: `Free: ${money(pot.unassigned, cur)}` },
                ]}
              />
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-brand-200">
              <Key color={FILL}>
                Set aside {short(setAside, cur)}
                {pot.earmarked > 0 ? ` (${short(pot.earmarked, cur)} chosen by you)` : ''}
              </Key>
              <Key color={TRACK}>Free {short(pot.unassigned, cur)}</Key>
            </p>
            <Shares goals={goals} field="funded_now" cur={cur} />
            <p className="mt-3 text-[11px] leading-relaxed text-brand-200/85">
              Investments {short(pot.investments, cur)} + cash {short(pot.cash, cur)}
              {plan.earmarked_outside > 0
                ? ` · plus ${short(plan.earmarked_outside, cur)} of property or gold you chose for a goal`
                : plan.property_excluded > 0
                  ? ` · property (${short(plan.property_excluded, cur)}) not counted`
                  : ''}
              .
            </p>
          </div>

          {/* ---------------------------- every month --------------------------- */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-200">Every month</p>
            {known ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="num mt-1 text-3xl font-extrabold tracking-tight">
                    <Counter value={m.amount} format={(v) => money(v, cur)} />
                  </p>
                  {!editing && (
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className="text-xs font-semibold text-gold-200 underline decoration-gold-300/40 underline-offset-2 hover:text-gold-100"
                    >
                      Change
                    </button>
                  )}
                </div>
                {sourceLine(m, cur) && <p className="text-[11px] text-brand-200">{sourceLine(m, cur)}</p>}
                <div className="mt-3">
                  <Meter
                    label={
                      m.shortfall > 0.5
                        ? `Goals need ${money(m.needed, cur)} a month; ${money(m.amount, cur)} available; short by ${money(m.shortfall, cur)}`
                        : `Goals take ${money(m.assigned, cur)} of ${money(m.amount, cur)} a month; ${money(m.left_over, cur)} left over`
                    }
                    parts={[
                      { key: 'goals', value: m.assigned, color: FILL, title: `Going to goals: ${money(m.assigned, cur)}` },
                      { key: 'left', value: m.left_over, color: TRACK, title: `Left over: ${money(m.left_over, cur)}` },
                      { key: 'short', value: m.shortfall, color: SHORT, hatch: true, title: `Short: ${money(m.shortfall, cur)}` },
                    ]}
                  />
                </div>
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-brand-200">
                  <Key color={FILL}>To goals {short(m.assigned, cur)}</Key>
                  {m.shortfall > 0.5 ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-rose-200">
                      <AlertTriangle size={12} aria-hidden /> Short {short(m.shortfall, cur)}
                    </span>
                  ) : (
                    <Key color={TRACK}>Left over {short(m.left_over, cur)}</Key>
                  )}
                  <span className="text-brand-300">of {short(scale, cur)} needed</span>
                </p>
                <Shares goals={goals} field="monthly_share" cur={cur} />
              </>
            ) : (
              <p className="mt-1 text-sm leading-relaxed text-brand-100">
                Your goals need <span className="num font-semibold text-white">{money(m.needed, cur)}</span> a month in
                total. Tell us what you can set aside, and we&apos;ll show which goals it reaches.
              </p>
            )}
            {(editing || !known) && (
              <BudgetEditor
                plan={plan}
                cur={cur}
                onSaved={() => {
                  setEditing(false);
                  onChanged();
                }}
                onCancel={() => setEditing(false)}
              />
            )}
          </div>
        </div>

        {plan.legacy_saved && (
          <p className="mt-6 flex gap-2 rounded-2xl bg-white/5 p-3 text-xs leading-relaxed text-brand-100 ring-1 ring-inset ring-white/10">
            <Info size={14} className="mt-0.5 flex-none text-gold-300" aria-hidden />
            Goals now fill from your real balances, so they rise and fall with your wealth. The &ldquo;saved so
            far&rdquo; amounts typed on goals before aren&apos;t counted any more — money kept somewhere Sampada
            doesn&apos;t track? Add it under Cash &amp; Bank and it counts.
          </p>
        )}

        {plan.custom_order && (
          <p className="mt-4 flex items-center gap-2 text-xs text-brand-200">
            <Wallet size={13} aria-hidden /> Goals are in your own order.
            <button
              type="button"
              onClick={onResetOrder}
              className="font-semibold text-gold-200 underline decoration-gold-300/40 underline-offset-2 hover:text-gold-100"
            >
              Go back to soonest first
            </button>
          </p>
        )}

        <HowItWorks plan={plan} cur={cur} />
      </div>
    </section>
  );
}

// Per-goal verdicts, shared with the goal cards so a status always reads the
// same wherever it appears. `tone` picks the chip; `icon` keeps it from ever
// being colour alone.
export const STATUS = {
  funded: { label: 'Covered', tone: 'bg-emerald-100 text-emerald-700', icon: Check },
  on_track: { label: 'On track', tone: 'bg-emerald-100 text-emerald-700', icon: Check },
  behind: { label: 'Behind', tone: 'bg-amber-100 text-amber-700', icon: AlertTriangle },
  waiting: { label: 'Waiting its turn', tone: 'bg-slate-100 text-slate-600', icon: CalendarClock },
  unknown: { label: 'Needs a monthly amount', tone: 'bg-slate-100 text-slate-600', icon: Info },
  overdue: { label: 'Date passed', tone: 'bg-rose-100 text-rose-700', icon: AlertTriangle },
  no_date: { label: 'No date', tone: 'bg-slate-100 text-slate-600', icon: Info },
};
