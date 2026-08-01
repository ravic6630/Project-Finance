import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Calculator,
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
import UpgradeModal from '../components/UpgradeModal.jsx';
import CalculatorTool from '../components/CalculatorTool.jsx';
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
  current_amount: '',
  monthly_contribution: '',
  expected_return: '12',
  currency: 'INR',
};

function GoalForm({ open, onClose, onSaved, editing }) {
  const { user } = useAuth();
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Portfolio linking: when items are linked, "saved so far" tracks them live.
  const [links, setLinks] = useState([]); // [{kind, ref_id}]
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkables, setLinkables] = useState(null); // {holdings, accounts, assets}

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
    if (editing) {
      api(`/goals/${editing.id}/links`)
        .then((d) => setLinks((d.links || []).map((l) => ({ kind: l.kind, ref_id: l.ref_id }))))
        .catch(() => {});
    }
    setForm(
      editing
        ? {
            name: editing.name || '',
            type: editing.type || 'CUSTOM',
            target_amount: String(editing.target_amount ?? ''),
            target_date: editing.target_date || '',
            current_amount: String(editing.current_amount ?? ''),
            monthly_contribution: String(editing.monthly_contribution ?? ''),
            expected_return: String(editing.expected_return ?? '12'),
            currency: editing.currency || 'INR',
          }
        : // New goals are denominated in the user's base currency, not a hardcoded ₹.
          { ...blank, currency: user.base_currency || 'INR' }
    );
  }, [open, editing, user.base_currency]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function prefillNetWorth() {
    try {
      const d = await api('/dashboard');
      set({ current_amount: String(Math.round(d.net_worth || 0)) });
    } catch {
      /* ignore — keep manual entry */
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        type: form.type,
        target_amount: Number(form.target_amount || 0),
        target_date: form.target_date || null,
        current_amount: Number(form.current_amount || 0),
        monthly_contribution: Number(form.monthly_contribution || 0),
        expected_return: Number(form.expected_return || 0),
        currency: form.currency,
      };
      let goalId = editing?.id;
      if (editing) await api(`/goals/${editing.id}`, { method: 'PATCH', body: payload });
      else {
        const d = await api('/goals', { method: 'POST', body: payload });
        goalId = d.goal.id;
      }
      await api(`/goals/${goalId}/links`, { method: 'PUT', body: { links } });
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
            <input className="input" type="date" value={form.target_date} onChange={(e) => set({ target_date: e.target.value })} required />
          </Field>
        </div>
        {links.length > 0 ? (
          <Field label="Saved so far" hint="Tracked live from your linked items — no manual updates needed.">
            <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 dark:border-emerald-900 dark:bg-emerald-900/30">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                <Link2 size={14} /> Auto — {links.length} linked item{links.length === 1 ? '' : 's'}
              </span>
              <button type="button" className="text-sm font-semibold text-brand-600 hover:underline" onClick={openPicker}>
                {pickerOpen ? 'Hide' : 'Change'}
              </button>
            </div>
          </Field>
        ) : (
          <Field label={`Saved so far (${form.currency})`}>
            <div className="flex gap-2">
              <input className="input" type="number" step="any" value={form.current_amount} onChange={(e) => set({ current_amount: e.target.value })} placeholder="0" />
              <button type="button" className="btn-ghost shrink-0 whitespace-nowrap" onClick={prefillNetWorth}>
                Use net worth
              </button>
            </div>
            <button type="button" onClick={openPicker} className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline">
              <Link2 size={12} /> {pickerOpen ? 'Hide the picker' : 'Or link investments & accounts to track this automatically'}
            </button>
          </Field>
        )}

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
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Monthly contribution (${form.currency})`}>
            <input className="input" type="number" step="any" value={form.monthly_contribution} onChange={(e) => set({ monthly_contribution: e.target.value })} placeholder="25000" />
          </Field>
          <Field label="Expected return (% p.a.)">
            <input className="input" type="number" step="any" value={form.expected_return} onChange={(e) => set({ expected_return: e.target.value })} placeholder="12" />
          </Field>
        </div>
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

function GoalCard({ goal, onEdit, onDelete }) {
  const meta = typeMeta(goal.type);
  const p = goal.projection || {};
  // Display in the user's base currency. The server converts the goal's amounts
  // (and the projection) into `base_currency`; fall back to native if absent.
  const cur = goal.base_currency || goal.currency || 'INR';
  const target = goal.target_amount_base ?? goal.target_amount;
  const current = goal.current_amount_base ?? goal.current_amount;
  const monthly = goal.monthly_contribution_base ?? goal.monthly_contribution;
  const saved = Math.min(100, p.saved_pct ?? 0);

  return (
    <motion.div variants={cardRise} whileHover={{ y: -5 }} className="card group relative overflow-hidden p-5">
      {/* oversized goal-icon watermark, stirring gently on hover */}
      <meta.icon
        aria-hidden
        size={116}
        strokeWidth={1}
        className="pointer-events-none absolute -bottom-7 -right-6 -rotate-12 text-brand-700 opacity-[0.07] transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110 dark:text-[#8fa9cd] dark:opacity-[0.12]"
      />
      <div className="relative flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <meta.icon size={20} />
        </div>
        <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
          <button onClick={() => onEdit(goal)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
            <Pencil size={15} />
          </button>
          <button onClick={() => onDelete(goal)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <p className="relative mt-4 font-semibold text-slate-900">{goal.name}</p>
      <p className="text-xs font-medium uppercase text-slate-400">
        {meta.label}
        {goal.target_date ? ` · by ${dateLabel(goal.target_date)}` : ''}
        {p.years_to_target ? ` · ${p.years_to_target}y` : ''}
      </p>

      <p className="num mt-2 text-2xl font-bold tracking-tight text-brand-900">{money(target, cur)}</p>

      {/* progress saved so far */}
      <div className="mt-3">
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-gold-400" style={{ width: `${saved}%` }} />
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
          {money(current, cur)} saved · {saved}%
          {goal.links_count > 0 && (
            <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
              <Link2 size={10} className="mr-1" /> auto · {goal.links_count} linked
            </span>
          )}
        </p>
      </div>

      {/* projection */}
      <div className="mt-4 rounded-xl border border-[#efeadd] bg-[#faf8f1] p-3">
        {p.on_track ? (
          <span className="chip bg-emerald-100 text-emerald-700">On track</span>
        ) : (
          <span className="chip bg-amber-100 text-amber-700">Behind</span>
        )}
        <p className="mt-2 text-sm text-slate-600">
          Projected <span className="font-semibold text-slate-900">{money(p.projected_value, cur)}</span>
          {monthly ? ` at ${money(monthly, cur)}/mo` : ''}
        </p>
        {!p.on_track && p.required_monthly != null && (
          <p className="mt-1 text-sm text-amber-700">
            Invest {money(p.required_monthly, cur)}/mo to reach it.
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

export default function Goals() {
  const { user } = useAuth();
  const base = user.base_currency; // re-fetch (re-converts) when this changes
  const [premium, setPremium] = useState(null); // null = loading
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      setError('');
      const status = await api('/billing/status');
      const isPremium = !!status?.state?.premium;
      setPremium(isPremium);
      if (isPremium) {
        const d = await api('/goals');
        setGoals(d.goals);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, base]);

  async function onDelete(g) {
    if (!(await confirm({ title: `Delete “${g.name}”?`, message: 'This permanently removes the goal.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/goals/${g.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <Spinner label="Loading your goals…" />;

  if (!premium) {
    return (
      <div className="space-y-6">
        <PremiumLock onUpgrade={() => setUpgradeOpen(true)} />
        <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} onChanged={load} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900">Goals &amp; projections</h1>
          <p className="text-sm text-slate-500">Set a target, track progress, and see if you&apos;re on pace.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={() => setCalcOpen(true)}>
            <Calculator size={16} /> Calculator
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus size={16} /> Add goal
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {goals.length === 0 ? (
        <EmptyState
          illo="goals"
          icon={Target}
          title="No goals yet"
          hint="Add your first goal — retirement, a house, your child's education — and we'll project whether you're on track."
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
        <motion.div
          variants={gridStagger}
          initial={pageVisible() ? 'hidden' : false}
          animate="show"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              onEdit={(goal) => {
                setEditing(goal);
                setFormOpen(true);
              }}
              onDelete={onDelete}
            />
          ))}
        </motion.div>
      )}

      <GoalForm open={formOpen} editing={editing} onClose={() => setFormOpen(false)} onSaved={load} />

      {/* Calculator opens over the page (Goals + "Add goal" return when you close
          it with × or Escape). Uses your base currency and keeps the result pinned
          at the top while you scroll. */}
      <Modal open={calcOpen} onClose={() => setCalcOpen(false)} title="Calculator" wide>
        <CalculatorTool currency={base} showCurrencyPicker={false} stickyTop="top-0" />
      </Modal>
    </div>
  );
}
