import { useCallback, useEffect, useState, useRef} from 'react';
import { motion } from 'framer-motion';
import { ArrowDownCircle, ArrowUpCircle, Pencil, PiggyBank, Plus, Repeat, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { dateLabel, money, todayISO } from '../lib/format.js';
import { CURRENCIES } from '../lib/markets.js';
import { EmptyState, ErrorBanner, Field, Modal } from '../components/ui.jsx';
import { Magnetic, Shimmer, Spotlight, settle } from '../components/fx.jsx';
import { pageVisible } from '../lib/motion.js';
import { useConfirm } from '../lib/confirm.jsx';
import RecurringRules from '../components/RecurringRules.jsx';
import Budgets from '../components/Budgets.jsx';

const FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'INCOME', label: 'Income' },
  { value: 'EXPENSE', label: 'Expenses' },
];

// Rows arrive in reading order, but only the first dozen stagger — a long
// ledger should land at once rather than trickle in for seconds.
const STAGGER_CAP = 12;
const rowDelay = (i) => Math.min(i, STAGGER_CAP) * 0.022;

// A skeleton shaped like the ledger itself, so the real rows drop into the
// outline instead of replacing a spinner with a layout jump.
function LedgerSkeleton({ rows = 8 }) {
  return (
    <div className="card overflow-hidden" aria-hidden>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Shimmer className="h-9 w-9 shrink-0 !rounded-full" />
            <div className="min-w-0 flex-1">
              <Shimmer className="h-3.5 w-32 max-w-full" />
              <Shimmer className="mt-2 h-2.5 w-44 max-w-full" />
            </div>
            <Shimmer className="h-4 w-24 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

const blankFor = () => ({
  type: 'EXPENSE',
  amount: '',
  currency: 'INR',
  category: '',
  account: '',
  date: todayISO(),
  note: '',
});

function TxnForm({ open, onClose, onSaved, editing, categories }) {
  const [form, setForm] = useState(blankFor());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(
      editing
        ? {
            type: editing.type,
            amount: String(editing.amount ?? ''),
            currency: editing.currency || 'INR',
            category: editing.category || '',
            account: editing.account || '',
            date: editing.date || todayISO(),
            note: editing.note || '',
          }
        : blankFor()
    );
  }, [open, editing]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = {
        type: form.type,
        amount: Number(form.amount || 0),
        currency: form.currency,
        category: form.category,
        account: form.account,
        date: form.date,
        note: form.note,
      };
      if (editing) await api(`/transactions/${editing.id}`, { method: 'PATCH', body: payload });
      else await api('/transactions', { method: 'POST', body: payload });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const suggestions = categories?.[form.type] || [];

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit transaction' : 'Add transaction'}>
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorBanner message={error} />
        <div className="grid grid-cols-2 gap-2">
          {['EXPENSE', 'INCOME'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set({ type: t })}
              className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                form.type === t
                  ? t === 'INCOME'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-rose-500 bg-rose-50 text-rose-700'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {t === 'INCOME' ? <ArrowUpCircle size={16} /> : <ArrowDownCircle size={16} />}
              {t === 'INCOME' ? 'Income' : 'Expense'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <input
              className="input"
              type="number"
              step="any"
              value={form.amount}
              onChange={(e) => set({ amount: e.target.value })}
              required
            />
          </Field>
          <Field label="Currency">
            <select
              className="input"
              value={form.currency}
              onChange={(e) => set({ currency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <input
              className="input"
              list="txn-categories"
              value={form.category}
              onChange={(e) => set({ category: e.target.value })}
              placeholder="e.g. Food"
            />
            <datalist id="txn-categories">
              {suggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Date">
            <input
              className="input"
              type="date"
              value={form.date}
              onChange={(e) => set({ date: e.target.value })}
              required
            />
          </Field>
        </div>
        <Field label="Account / note (optional)">
          <input
            className="input"
            value={form.note}
            onChange={(e) => set({ note: e.target.value })}
            placeholder="e.g. Grocery run at DMart"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add transaction'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Transactions() {
  const [txns, setTxns] = useState([]);
  const [categories, setCategories] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const confirm = useConfirm();

  // Filter changes fire overlapping requests; only the newest may paint.
  const reqRef = useRef(0);

  const load = useCallback(async (f) => {
    const ticket = ++reqRef.current;
    try {
      setError('');
      const q = f && f !== 'ALL' ? `?type=${f}` : '';
      const d = await api(`/transactions${q}`);
      if (reqRef.current !== ticket) return;
      setTxns(d.transactions);
      setCategories(d.categories);
    } catch (err) {
      if (reqRef.current === ticket) setError(err.message);
    } finally {
      if (reqRef.current === ticket) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(filter);
  }, [load, filter]);

  async function onDelete(t) {
    if (!(await confirm({ title: 'Delete this transaction?', message: 'This permanently removes the transaction.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/transactions/${t.id}`, { method: 'DELETE' });
      load(filter);
    } catch (err) {
      setError(err.message);
    }
  }

  // Per-currency income/expense totals for the loaded list.
  const totals = txns.reduce((acc, t) => {
    const c = (acc[t.currency] ||= { income: 0, expense: 0 });
    if (t.type === 'INCOME') c.income += t.amount;
    else c.expense += t.amount;
    return acc;
  }, {});

  const animateIn = pageVisible();

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-brand-900">
              Transactions
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Everything in and out — filtered, budgeted, and repeated for you.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-ghost" onClick={() => setBudgetsOpen(true)}>
              <PiggyBank size={16} /> Budgets
            </button>
            <button className="btn-ghost" onClick={() => setRecurringOpen(true)}>
              <Repeat size={16} /> Recurring
            </button>
            <Magnetic>
              <button
                className="btn-primary"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus size={16} /> Add transaction
              </button>
            </Magnetic>
          </div>
        </div>
        <div className="rule-fade mt-4" />
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Filter transactions"
          className="flex items-center rounded-xl bg-slate-100 p-1 text-sm font-semibold"
        >
          {FILTERS.map((f) => {
            const on = filter === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                aria-pressed={on}
                className={`relative rounded-lg px-3.5 py-1.5 transition-colors duration-200 ${
                  on ? 'text-brand-700' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {/* the pill slides between tabs instead of blinking on/off */}
                {on && (
                  <motion.span
                    layoutId="txn-filter-pill"
                    transition={{ type: 'spring', stiffness: 440, damping: 38 }}
                    className="absolute inset-0 rounded-lg bg-white shadow-sm"
                    aria-hidden
                  />
                )}
                <span className="relative">{f.label}</span>
              </button>
            );
          })}
        </div>

        {Object.keys(totals).length > 0 && (
          <div className="flex flex-wrap gap-3">
            {Object.entries(totals).map(([cur, t]) => {
              const net = t.income - t.expense;
              return (
                <Spotlight key={cur} className="card flex items-center gap-5 px-5 py-2.5">
                  <div className="relative">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      In ({cur})
                    </p>
                    <p className="num font-semibold text-emerald-600 dark:text-emerald-400">
                      {money(t.income, cur)}
                    </p>
                  </div>
                  <div className="relative h-8 w-px bg-slate-100 dark:bg-[#22324f]" aria-hidden />
                  <div className="relative">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Out ({cur})
                    </p>
                    <p className="num font-semibold text-rose-600 dark:text-rose-300">
                      {money(t.expense, cur)}
                    </p>
                  </div>
                  <div className="relative h-8 w-px bg-slate-100 dark:bg-[#22324f]" aria-hidden />
                  <div className="relative">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Net ({cur})
                    </p>
                    <p
                      className={`num font-bold ${
                        net >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-300'
                      }`}
                    >
                      {money(net, cur)}
                    </p>
                  </div>
                </Spotlight>
              );
            })}
          </div>
        )}
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <LedgerSkeleton rows={8} />
      ) : txns.length === 0 ? (
        <EmptyState
          illo="transactions"
          icon={ArrowUpCircle}
          title={
            filter === 'INCOME'
              ? 'No income logged yet'
              : filter === 'EXPENSE'
                ? 'No expenses logged yet'
                : 'No transactions yet'
          }
          hint={
            filter === 'ALL'
              ? 'Log your income and expenses to track your monthly cashflow.'
              : 'Nothing here under this filter — switch back to All, or log one now.'
          }
          action={
            <Magnetic>
              <button
                className="btn-primary"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus size={16} /> Add a transaction
              </button>
            </Magnetic>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="divide-y divide-slate-100">
            {txns.map((t, i) => {
              const income = t.type === 'INCOME';
              return (
                <motion.div
                  key={t.id}
                  initial={animateIn ? { opacity: 0, y: 6 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...settle, delay: rowDelay(i) }}
                  /* the gold hairline is a pseudo-element, so hovering a row
                     never nudges the amounts sideways */
                  className="group relative flex items-center gap-3 px-4 py-3 transition-colors duration-150 before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:origin-center before:scale-y-0 before:rounded-full before:bg-gold-400 before:opacity-0 before:transition before:duration-200 before:content-[''] hover:bg-slate-50/60 hover:before:scale-y-100 hover:before:opacity-100"
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      income
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'
                    }`}
                  >
                    {income ? <ArrowUpCircle size={18} /> : <ArrowDownCircle size={18} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">
                      {t.category || (income ? 'Income' : 'Expense')}
                    </p>
                    <p className="flex items-center gap-1 truncate text-xs text-slate-400">
                      {t.recurring_rule_id && <Repeat size={11} className="shrink-0 text-brand-400" title="Logged automatically" />}
                      {dateLabel(t.date)}
                      {t.note ? ` · ${t.note}` : ''}
                    </p>
                  </div>
                  <span
                    className={`num shrink-0 font-semibold ${
                      income
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-300'
                    }`}
                  >
                    {income ? '+' : '−'}
                    {money(t.amount, t.currency)}
                  </span>
                  <div className="flex shrink-0 gap-1 opacity-0 transition duration-200 focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      onClick={() => {
                        setEditing(t);
                        setFormOpen(true);
                      }}
                      aria-label="Edit transaction"
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => onDelete(t)}
                      aria-label="Delete transaction"
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-100 hover:text-rose-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      <RecurringRules
        open={recurringOpen}
        onClose={() => setRecurringOpen(false)}
        categories={categories}
        onChanged={() => load(filter)}
      />
      <Budgets open={budgetsOpen} onClose={() => setBudgetsOpen(false)} categories={categories} />

      <TxnForm
        open={formOpen}
        editing={editing}
        categories={categories}
        onClose={() => setFormOpen(false)}
        onSaved={() => load(filter)}
      />
    </div>
  );
}
