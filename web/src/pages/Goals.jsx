import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowUp,
  Calculator,
  Compass,
  Link2,
  Car,
  Crown,
  GraduationCap,
  Home,
  LifeBuoy,
  Palmtree,
  Pencil,
  Plane,
  Plus,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { dateLabel, money } from '../lib/format.js';
import { EmptyState, ErrorBanner, Field, Modal, Spinner } from '../components/ui.jsx';
import { useApi } from '../lib/useApi.js';
import InsightsPanel from '../components/insights/InsightsPanel.jsx';
import UpgradeModal from '../components/UpgradeModal.jsx';
import CalculatorTool from '../components/CalculatorTool.jsx';
import GoalPlanCard, { STATUS } from '../components/GoalPlan.jsx';
import { useConfirm } from '../lib/confirm.jsx';
import { gridStagger, cardRise, pageVisible } from '../lib/motion.js';

const TYPES = [
  { value: 'RETIREMENT', label: 'Retirement', icon: Palmtree },
  { value: 'HOUSE', label: 'House', icon: Home },
  { value: 'EDUCATION', label: 'Education', icon: GraduationCap },
  { value: 'CAR', label: 'Car', icon: Car },
  { value: 'TRAVEL', label: 'Travel', icon: Plane },
  { value: 'EMERGENCY', label: 'Emergency', icon: LifeBuoy },
  { value: 'WEALTH', label: 'Wealth', icon: TrendingUp },
  { value: 'CUSTOM', label: 'Custom', icon: Target },
];
const typeMeta = (t) => TYPES.find((x) => x.value === t) || TYPES[7];

const blank = {
  name: '',
  type: 'RETIREMENT',
  target_amount: '',
  target_date: '',
  expected_return: '12',
  currency: 'INR',
};

// Money needed soon shouldn't ride the stock market, so a near goal starts from
// a safer return. The bands follow investor-education guidance (AMFI, SEBI):
// debt for money needed within ~3 years, a hybrid mix up to ~10, equity only
// beyond that. Only a starting point — the field stays the user's.
const yearsTo = (date) => (Date.parse(`${date}T00:00:00`) - Date.now()) / (365.25 * 864e5);
const suggestedReturn = (date) => {
  const y = yearsTo(date);
  if (!Number.isFinite(y)) return null;
  return y < 3 ? 7 : y < 10 ? 10 : 12;
};
const returnHint = (date) => {
  const y = yearsTo(date);
  if (!Number.isFinite(y)) return 'What you expect this money to earn a year.';
  if (y < 3) return 'Needed within 3 years — usually kept safe in FDs or debt funds, so expect less.';
  if (y < 10) return 'A 3–10 year goal suits a mix of equity and debt.';
  return 'Ten years or more can stay mostly in equity for higher growth.';
};
// A near goal planned at an equity-like return looks better covered than it is.
const SAFE_RETURN = 7;
const optimistic = (goal) => goal.plan.years_left > 0 && goal.plan.years_left < 3 && Number(goal.expected_return) > SAFE_RETURN + 1;

function GoalForm({ open, onClose, onSaved, editing }) {
  const { user } = useAuth();
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Portfolio linking: when items are linked, "saved so far" tracks them live.
  const [links, setLinks] = useState([]); // [{kind, ref_id}]
  const [linksReady, setLinksReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkables, setLinkables] = useState(null); // {holdings, accounts, assets}
  // Once the user types their own return, picking a date stops suggesting one.
  const [returnTouched, setReturnTouched] = useState(false);

  async function openPicker() {
    setPickerOpen((o) => !o);
    if (linkables) return;
    try {
      const [h, c, a] = await Promise.all([api('/holdings'), api('/cash'), api('/assets')]);
      setLinkables({
        holdings: h.holdings || [],
        accounts: c.accounts || [],
        assets: a.assets || [],
      });
    } catch {
      setLinkables({ holdings: [], accounts: [], assets: [] });
    }
  }

  const linkKey = (k, id) => `${k}:${id}`;
  const isLinked = (k, id) => links.some((l) => l.kind === k && l.ref_id === id);
  const toggleLink = (k, id) =>
    setLinks((ls) =>
      ls.some((l) => l.kind === k && l.ref_id === id)
        ? ls.filter((l) => !(l.kind === k && l.ref_id === id))
        : [...ls, { kind: k, ref_id: id }]
    );

  useEffect(() => {
    if (!open) return;
    setError('');
    setPickerOpen(false);
    setLinks([]);
    // Saving PUTs the full link list, so an unloaded/failed GET would wipe the
    // goal's existing links. Track readiness, and ignore a response that
    // belongs to a goal we've since navigated away from.
    setLinksReady(!editing);
    if (editing) {
      const forGoal = editing.id;
      api(`/goals/${forGoal}/links`)
        .then((d) => {
          if (forGoal !== editing.id) return;
          setLinks((d.links || []).map((l) => ({ kind: l.kind, ref_id: l.ref_id })));
          setLinksReady(true);
        })
        .catch(() => setError("Couldn't load this goal's linked investments — reopen it before saving."));
    }
    // An existing goal's return is already a choice someone made.
    setReturnTouched(!!editing);
    setForm(
      editing
        ? {
            name: editing.name || '',
            type: editing.type || 'CUSTOM',
            target_amount: String(editing.target_amount ?? ''),
            target_date: editing.target_date || '',
            expected_return: String(editing.expected_return ?? '12'),
            currency: editing.currency || 'INR',
          }
        : // New goals are denominated in the user's base currency, not a hardcoded ₹.
          { ...blank, currency: user.base_currency || 'INR' }
    );
  }, [open, editing, user.base_currency]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setDate = (target_date) => {
    const r = returnTouched ? null : suggestedReturn(target_date);
    set(r == null ? { target_date } : { target_date, expected_return: String(r) });
  };

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // No "saved so far" or monthly figure: the plan works both out from what
      // you actually own and earn.
      const payload = {
        name: form.name,
        type: form.type,
        target_amount: Number(form.target_amount || 0),
        target_date: form.target_date || null,
        expected_return: Number(form.expected_return || 0),
        currency: form.currency,
      };
      let goalId = editing?.id;
      if (editing) await api(`/goals/${editing.id}`, { method: 'PATCH', body: payload });
      else {
        const d = await api('/goals', { method: 'POST', body: payload });
        goalId = d.goal.id;
      }
      // Only write links when we actually know what they were.
      if (linksReady) await api(`/goals/${goalId}/links`, { method: 'PUT', body: { links } });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit goal' : 'New goal'}>
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorBanner message={error} />
        <Field label="Goal type">
          <div className="grid grid-cols-4 gap-2">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => set({ type: t.value })}
                className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-[11px] font-semibold transition ${
                  form.type === t.value
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                <t.icon size={16} />
                {t.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Goal name">
          <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Retire by 50" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Target amount (${form.currency})`}>
            <input className="input" type="number" step="any" value={form.target_amount} onChange={(e) => set({ target_amount: e.target.value })} placeholder="10000000" required />
          </Field>
          <Field label="Target date">
            <input className="input" type="date" value={form.target_date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <Field
          label="How it's funded"
          hint={
            links.length > 0
              ? 'These fund this goal first; anything more it needs comes from your other investments and cash, in priority order.'
              : "Automatically — from your investments and cash, in priority order, so it moves with your wealth. You don't type a saved amount."
          }
        >
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[#e8e2d4] bg-[#faf8f1] px-3.5 py-2.5">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <Link2 size={14} className="text-brand-600" />
              {links.length > 0
                ? `${links.length} item${links.length === 1 ? '' : 's'} earmarked for this goal`
                : 'From your whole portfolio'}
            </span>
            <button type="button" className="text-sm font-semibold text-brand-600 hover:underline" onClick={openPicker}>
              {pickerOpen ? 'Hide' : links.length > 0 ? 'Change' : 'Earmark specific items'}
            </button>
          </div>
        </Field>

        {pickerOpen && (
          <div className="max-h-56 space-y-3 overflow-y-auto rounded-xl border border-slate-200 p-3">
            {!linkables ? (
              <p className="py-4 text-center text-sm text-slate-400">Loading your portfolio…</p>
            ) : (
              [
                ['Investments', 'holding', linkables.holdings.map((h) => ({ id: h.id, name: h.name, value: h.market_value_base, cur: null }))],
                ['Cash & Bank', 'account', linkables.accounts.map((a) => ({ id: a.id, name: a.name, value: a.balance, cur: a.currency }))],
                ['Assets', 'asset', linkables.assets.map((a) => ({ id: a.id, name: a.name, value: a.value_base ?? a.value, cur: null }))],
              ].map(([label, kind, rows]) =>
                rows.length === 0 ? null : (
                  <div key={kind}>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
                    {rows.map((row) => (
                      <label key={linkKey(kind, row.id)} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-600"
                          checked={isLinked(kind, row.id)}
                          onChange={() => toggleLink(kind, row.id)}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{row.name}</span>
                        <span className="num shrink-0 text-xs text-slate-400">
                          {row.value != null ? money(row.value, row.cur || user.base_currency) : ''}
                        </span>
                      </label>
                    ))}
                  </div>
                )
              )
            )}
            {linkables && !linkables.holdings.length && !linkables.accounts.length && !linkables.assets.length && (
              <p className="py-3 text-center text-sm text-slate-400">
                Nothing to link yet — add holdings, accounts or assets first.
              </p>
            )}
          </div>
        )}
        <Field label="Expected return (% a year)" hint={returnHint(form.target_date)}>
          <input
            className="input"
            type="number"
            step="any"
            value={form.expected_return}
            onChange={(e) => {
              setReturnTouched(true);
              set({ expected_return: e.target.value });
            }}
            placeholder="12"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add goal'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// "8 months left", "4.2 years left".
function timeLeft(years) {
  const m = Math.round((years || 0) * 12);
  if (m <= 0) return null;
  return m < 24 ? `${m} month${m === 1 ? '' : 's'} left` : `${years.toFixed(1)} years left`;
}
const monthYear = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

// What the goal's verdict means in its own numbers — at most three short lines,
// the first saying where it stands, the last what would change it.
function verdictLines(goal) {
  const p = goal.plan;
  const cur = goal.base_currency;
  const target = goal.target_amount_base;
  const by = goal.target_date ? monthYear(goal.target_date) : null;
  const m = (v) => money(v, cur, { whole: true });
  const c = (v) => money(v, cur, { compact: true });
  switch (p.status) {
    case 'funded':
      return [
        p.funded_now >= target
          ? 'What’s set aside already covers it.'
          : `What’s set aside grows to ${c(target)} by ${by} at ${goal.expected_return}% a year — nothing more needed.`,
      ];
    case 'on_track':
      return [`Gets ${m(p.monthly_share)} a month — lands on ${c(target)} by ${by}.`];
    case 'behind':
      return [
        p.monthly_share > 0
          ? `Gets ${m(p.monthly_share)} a month · needs ${m(p.required_monthly)}.`
          : `Needs ${m(p.required_monthly)} a month — nothing is left for it yet.`,
        `At this pace: ${c(p.projected_value)} by ${by} (${Math.round(p.projected_pct)}%).`,
        p.reached_on
          ? `Arrives ${monthYear(p.reached_on)} — or add ${m(p.extra_needed)} a month to stay on time.`
          : `Add ${m(p.extra_needed)} a month to stay on time.`,
      ];
    case 'waiting':
      return [
        `Needs ${m(p.required_monthly)} a month to arrive on time.`,
        'It starts once the goals above it are covered — or move it up.',
      ];
    case 'unknown':
      return [`Needs ${m(p.required_monthly)} a month to arrive on time.`, 'Set your monthly amount above to see whether that fits.'];
    case 'overdue':
      return [`${m(p.funded_now)} set aside of ${m(target)}. Move the date to keep planning it.`];
    default:
      return ['Add a target date to plan the monthly amount.'];
  }
}

function GoalCard({ goal, onEdit, onDelete, onMove, onSafeReturn, first, last, moving }) {
  const meta = typeMeta(goal.type);
  const p = goal.plan;
  const cur = goal.base_currency || goal.currency || 'INR';
  const target = goal.target_amount_base ?? goal.target_amount;
  const funded = Math.min(100, p.funded_pct ?? 0);
  const status = STATUS[p.status] || STATUS.unknown;
  const iconBtn = 'rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-30';

  return (
    // `layout`: when the order changes, cards glide to their new places rather
    // than jumping — the move is the feedback that the reorder happened.
    <motion.div layout variants={cardRise} className="card group relative flex flex-col overflow-hidden p-5">
      {/* oversized goal-icon watermark, stirring gently on hover */}
      <meta.icon
        aria-hidden
        size={116}
        strokeWidth={1}
        className="pointer-events-none absolute -bottom-7 -right-6 -rotate-12 text-brand-700 opacity-[0.07] transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110 dark:text-[#8fa9cd] dark:opacity-[0.12]"
      />
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className="num flex h-7 w-7 items-center justify-center rounded-full bg-gold-100 text-xs font-bold text-gold-700"
            title={`Priority ${p.rank}`}
          >
            {p.rank}
          </span>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <meta.icon size={20} />
          </div>
        </div>
        <div className="flex gap-0.5">
          <button aria-label={`Move ${goal.name} up`} title="Higher priority" disabled={first || moving} onClick={() => onMove(goal.id, -1)} className={iconBtn}>
            <ArrowUp size={15} />
          </button>
          <button aria-label={`Move ${goal.name} down`} title="Lower priority" disabled={last || moving} onClick={() => onMove(goal.id, 1)} className={iconBtn}>
            <ArrowDown size={15} />
          </button>
          <button aria-label={`Edit ${goal.name}`} onClick={() => onEdit(goal)} className={iconBtn}>
            <Pencil size={15} />
          </button>
          <button aria-label={`Delete ${goal.name}`} onClick={() => onDelete(goal)} className={`${iconBtn} hover:bg-rose-100 hover:text-rose-600`}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <p className="relative mt-4 font-semibold text-slate-900">{goal.name}</p>
      <p className="text-xs font-medium uppercase text-slate-400">
        {meta.label}
        {goal.target_date ? ` · by ${dateLabel(goal.target_date)}` : ''}
        {timeLeft(p.years_left) ? ` · ${timeLeft(p.years_left)}` : ''}
      </p>

      <p className="num mt-2 text-2xl font-bold tracking-tight text-brand-900">{money(target, cur)}</p>

      {/* what's set aside for it today, out of your real balances */}
      <div className="mt-3">
        <div
          className="h-2 overflow-hidden rounded-full bg-slate-100"
          role="img"
          aria-label={`${money(p.funded_now, cur)} set aside, ${Math.round(funded)}% of the target`}
        >
          <motion.div
            className="h-full rounded-full bg-gold-400"
            initial={false}
            animate={{ width: `${funded}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <span className="num">{money(p.funded_now, cur)}</span> set aside today · {Math.round(funded)}%
          {goal.links_count > 0 && (
            <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
              <Link2 size={10} className="mr-1" /> {goal.links_count} earmarked
            </span>
          )}
        </p>
      </div>

      <div className="relative mt-4 rounded-xl border border-[#efeadd] bg-[#faf8f1] p-3">
        <span className={`chip gap-1 ${status.tone}`}>
          <status.icon size={12} aria-hidden /> {status.label}
        </span>
        {verdictLines(goal).map((line, i) => (
          <p key={i} className={`mt-1.5 text-sm ${i === 0 ? 'text-slate-700' : 'text-slate-500'}`}>
            {line}
          </p>
        ))}
        {optimistic(goal) && (
          <p className="mt-2.5 border-t border-[#efeadd] pt-2.5 text-xs leading-relaxed text-slate-500">
            {goal.expected_return}% is optimistic for money needed this soon — safer places like FDs pay about{' '}
            {SAFE_RETURN}%.{' '}
            <button
              type="button"
              disabled={moving}
              onClick={() => onSafeReturn(goal.id)}
              className="font-semibold text-brand-600 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
            >
              Plan at {SAFE_RETURN}%
            </button>
          </p>
        )}
      </div>
    </motion.div>
  );
}

function PremiumLock({ onUpgrade }) {
  return (
    <div className="card flex flex-col items-center gap-3 p-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
        <Crown size={24} />
      </div>
      <h2 className="font-display text-xl font-bold text-slate-900">Goals & projections is Premium</h2>
      <p className="max-w-md text-sm text-slate-500">
        Set targets like retirement, a house or your child&apos;s education, track progress against what
        you&apos;ve saved, and see if you&apos;re on track — with the exact monthly amount needed to get there.
      </p>
      <button className="btn-primary mt-1" onClick={onUpgrade}>
        <Sparkles size={16} /> Upgrade to Premium
      </button>
    </div>
  );
}

/* ------------------------------------ hub ---------------------------------- */
// Goals, the calculator and Insights are three answers to one question — "am I
// going to get there?" — so they share a page. The tab lives in the URL (?tab=)
// so a link to Insights is a real link and a refresh lands where you were.
const TABS = [
  { key: 'goals', label: 'Goals', icon: Target, blurb: 'What you own and what you save, spread across your goals.' },
  { key: 'calculator', label: 'Calculator', icon: Calculator, blurb: 'SIP, lumpsum and goal maths, with step-up and inflation built in.' },
  { key: 'insights', label: 'Insights', icon: Compass, blurb: 'Where your money is taking you, and where it’s exposed.' },
];

function TabBar({ active, onChange }) {
  const refs = useRef({});
  // Arrow keys move between tabs, as a tablist is expected to; Home/End jump.
  const onKey = (e) => {
    const i = TABS.findIndex((t) => t.key === active);
    let next = null;
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
    if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length];
    if (e.key === 'Home') next = TABS[0];
    if (e.key === 'End') next = TABS[TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.key);
    refs.current[next.key]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Goals sections"
      onKeyDown={onKey}
      className="inline-flex gap-1 rounded-2xl bg-slate-100 p-1 dark:bg-[#16233c]"
    >
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            ref={(el) => (refs.current[t.key] = el)}
            role="tab"
            id={`goals-tab-${t.key}`}
            aria-selected={on}
            aria-controls={`goals-panel-${t.key}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.key)}
            className={`relative flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:focus-visible:ring-gold-300 ${
              on ? 'text-brand-800' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {on && (
              // The same gliding highlight the sidebar uses, so a tab reads as
              // navigation within the page rather than a second kind of button.
              <motion.span
                layoutId="goals-tab-pill"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                className="absolute inset-0 rounded-xl bg-white shadow-sm ring-1 ring-gold-200 dark:bg-brand-700/50 dark:ring-[#2e4a75]"
              />
            )}
            <t.icon size={15} className={`relative ${on ? 'text-gold-500 dark:text-gold-300' : ''}`} />
            <span className="relative">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function Goals() {
  const { user } = useAuth();
  const base = user.base_currency; // goals re-fetch (re-convert) when this changes
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab = TABS.some((t) => t.key === requested) ? requested : 'goals';
  const setTab = (key) => {
    const next = new URLSearchParams(params);
    if (key === 'goals') next.delete('tab');
    else next.set('tab', key);
    setParams(next, { replace: true });
  };

  // A panel stays mounted once it has been opened, just hidden. Switching tabs
  // is then instant, and what you typed into the calculator is still there
  // when you come back from checking Insights.
  const [visited, setVisited] = useState(() => new Set([tab]));
  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set([...v, tab])));
  }, [tab]);

  const billing = useApi('/billing/status');
  // null while unknown; a failed check reads as "not premium" rather than
  // leaving a paying member staring at a spinner over a network blip.
  const premium = billing.data ? !!billing.data?.state?.premium : billing.error ? false : null;
  const goalsQ = useApi('/goals', { vary: [base], enabled: premium === true });
  const goals = goalsQ.data?.goals || [];
  const plan = goalsQ.data?.plan;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [error, setError] = useState('');
  const [moving, setMoving] = useState(false);
  const confirm = useConfirm();

  // Priority is the whole list's order, so a move sends the full new order.
  // `ids: null` hands the order back to the automatic one.
  async function saveOrder(ids) {
    setMoving(true);
    setError('');
    try {
      await api('/goals/order', { method: 'PUT', body: { ids } });
      goalsQ.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setMoving(false);
    }
  }
  const move = (id, dir) => {
    const ids = goals.map((g) => g.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    saveOrder(ids);
  };
  async function planAtSafeReturn(id) {
    setMoving(true);
    setError('');
    try {
      await api(`/goals/${id}`, { method: 'PATCH', body: { expected_return: SAFE_RETURN } });
      goalsQ.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setMoving(false);
    }
  }

  const reloadAll = () => {
    billing.reload();
    goalsQ.reload();
  };

  async function onDelete(g) {
    if (!(await confirm({ title: `Delete “${g.name}”?`, message: 'This permanently removes the goal.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/goals/${g.id}`, { method: 'DELETE' });
      goalsQ.reload();
    } catch (err) {
      setError(err.message);
    }
  }

  const current = TABS.find((t) => t.key === tab);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900">Goals &amp; projections</h1>
          <p className="text-sm text-slate-500">{current.blurb}</p>
        </div>
        {tab === 'goals' && premium && (
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus size={16} /> Add goal
          </button>
        )}
      </div>

      <TabBar active={tab} onChange={setTab} />

      {/* ---------------------------------- goals -------------------------------- */}
      <div role="tabpanel" id="goals-panel-goals" aria-labelledby="goals-tab-goals" hidden={tab !== 'goals'}>
        {premium === null ? (
          <Spinner label="Loading your goals…" />
        ) : !premium ? (
          <PremiumLock onUpgrade={() => setUpgradeOpen(true)} />
        ) : (
          <div className="space-y-6">
            <ErrorBanner message={error || goalsQ.error} />
            {goalsQ.loading ? (
              <Spinner label="Loading your goals…" />
            ) : goals.length === 0 ? (
              <EmptyState
                illo="goals"
                icon={Target}
                title="No goals yet"
                hint="Add your first goal — retirement, a house, your child's education — and see how your money and monthly savings cover it."
                action={
                  <button
                    className="btn-primary"
                    onClick={() => {
                      setEditing(null);
                      setFormOpen(true);
                    }}
                  >
                    <Plus size={16} /> Add a goal
                  </button>
                }
              />
            ) : (
              <>
                {plan && (
                  <GoalPlanCard
                    goals={goals}
                    plan={plan}
                    cur={goalsQ.data?.base_currency || base}
                    onChanged={goalsQ.reload}
                    onResetOrder={() => saveOrder(null)}
                  />
                )}
                <motion.div
                  variants={gridStagger}
                  initial={pageVisible() ? 'hidden' : false}
                  animate="show"
                  className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {goals.map((g, i) => (
                    <GoalCard
                      key={g.id}
                      goal={g}
                      first={i === 0}
                      last={i === goals.length - 1}
                      moving={moving}
                      onMove={move}
                      onSafeReturn={planAtSafeReturn}
                      onEdit={(goal) => {
                        setEditing(goal);
                        setFormOpen(true);
                      }}
                      onDelete={onDelete}
                    />
                  ))}
                </motion.div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------- calculator ------------------------------ */}
      {/* Free for everyone — it is the same tool as the public page. A free
          account can plan here even though goals and insights are Premium. */}
      {visited.has('calculator') && (
        <div role="tabpanel" id="goals-panel-calculator" aria-labelledby="goals-tab-calculator" hidden={tab !== 'calculator'}>
          <div className="card p-5 sm:p-6">
            <CalculatorTool currency={base} showCurrencyPicker={false} stickyTop="top-16" />
          </div>
        </div>
      )}

      {/* -------------------------------- insights ------------------------------- */}
      {visited.has('insights') && (
        <div role="tabpanel" id="goals-panel-insights" aria-labelledby="goals-tab-insights" hidden={tab !== 'insights'}>
          <InsightsPanel />
        </div>
      )}

      <GoalForm open={formOpen} editing={editing} onClose={() => setFormOpen(false)} onSaved={goalsQ.reload} />
      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} onChanged={reloadAll} />
    </div>
  );
}
