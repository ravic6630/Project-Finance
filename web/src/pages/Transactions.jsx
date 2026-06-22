import { useCallback, useEffect, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { dateLabel, money, todayISO } from '../lib/format.js';
import { CURRENCIES } from '../lib/markets.js';
import { EmptyState, ErrorBanner, Field, Modal, Spinner } from '../components/ui.jsx';
import { useConfirm } from '../lib/confirm.jsx';

const FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'INCOME', label: 'Income' },
  { value: 'EXPENSE', label: 'Expenses' },
];

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
  const confirm = useConfirm();

  const load = useCallback(async (f) => {
    try {
      setError('');
      const q = f && f !== 'ALL' ? `?type=${f}` : '';
      const d = await api(`/transactions${q}`);
      setTxns(d.transactions);
      setCategories(d.categories);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center rounded-xl bg-slate-100 p-1 text-sm font-semibold">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-lg px-3.5 py-1.5 transition ${
                filter === f.value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus size={16} /> Add transaction
        </button>
      </div>

      {Object.keys(totals).length > 0 && (
        <div className="flex flex-wrap gap-3">
          {Object.entries(totals).map(([cur, t]) => (
            <div key={cur} className="card flex gap-6 px-5 py-3">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Income ({cur})</p>
                <p className="font-bold text-emerald-600">{money(t.income, cur)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Expense ({cur})</p>
                <p className="font-bold text-rose-600">{money(t.expense, cur)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Net ({cur})</p>
                <p className="font-bold text-slate-900">{money(t.income - t.expense, cur)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading transactions…" />
      ) : txns.length === 0 ? (
        <EmptyState
          icon={ArrowUpCircle}
          title="No transactions yet"
          hint="Log your income and expenses to track your monthly cashflow."
          action={
            <button
              className="btn-primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus size={16} /> Add a transaction
            </button>
          }
        />
      ) : (
        <div className="card divide-y divide-slate-100">
          {txns.map((t) => {
            const income = t.type === 'INCOME';
            return (
              <div key={t.id} className="group flex items-center gap-3 px-4 py-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    income ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'
                  }`}
                >
                  {income ? <ArrowUpCircle size={18} /> : <ArrowDownCircle size={18} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">
                    {t.category || (income ? 'Income' : 'Expense')}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {dateLabel(t.date)}
                    {t.note ? ` · ${t.note}` : ''}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-bold tabular-nums ${
                    income ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {income ? '+' : '−'}
                  {money(t.amount, t.currency)}
                </span>
                <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={() => {
                      setEditing(t);
                      setFormOpen(true);
                    }}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => onDelete(t)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
