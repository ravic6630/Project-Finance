import { useCallback, useEffect, useState } from 'react';
import {
  Calculator,
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

  useEffect(() => {
    if (!open) return;
    setError('');
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
      if (editing) await api(`/goals/${editing.id}`, { method: 'PATCH', body: payload });
      else await api('/goals', { method: 'POST', body: payload });
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
        <Field label={`Saved so far (${form.currency})`}>
          <div className="flex gap-2">
            <input className="input" type="number" step="any" value={form.current_amount} onChange={(e) => set({ current_amount: e.target.value })} placeholder="0" />
            <button type="button" className="btn-ghost shrink-0 whitespace-nowrap" onClick={prefillNetWorth}>
              Use net worth
            </button>
          </div>
        </Field>
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
    <div className="card group p-5">
      <div className="flex items-start justify-between">
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

      <p className="mt-4 font-semibold text-slate-900">{goal.name}</p>
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
        <p className="mt-1.5 text-xs text-slate-500">
          {money(current, cur)} saved · {saved}%
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
    </div>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        </div>
      )}

      <GoalForm open={formOpen} editing={editing} onClose={() => setFormOpen(false)} onSaved={load} />

      {/* Calculator opens over the page (Goals + "Add goal" stay put). It starts
          in "reach a goal" mode and uses your base currency — no extra picker. */}
      <Modal open={calcOpen} onClose={() => setCalcOpen(false)} title="Goal calculator" wide>
        <CalculatorTool initialMode="goal" currency={base} showCurrencyPicker={false} sticky={false} />
      </Modal>
    </div>
  );
}
