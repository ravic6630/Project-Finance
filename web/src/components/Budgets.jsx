import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, PiggyBank, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { ErrorBanner, Modal, Spinner } from './ui.jsx';
import { useConfirm } from '../lib/confirm.jsx';

const monthLabel = (ym) =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

function Bar({ item, base, onDelete }) {
  const over = item.pct > 100;
  const width = Math.min(100, item.pct);
  return (
    <div className="rounded-xl border border-slate-200 p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-sm font-semibold text-slate-800">{item.category}</p>
        <button
          onClick={() => onDelete(item)}
          aria-label={`Remove ${item.category} budget`}
          className="rounded-lg p-1 text-slate-300 transition hover:bg-rose-100 hover:text-rose-600"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-[#1c2c49]">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${width}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className={`h-full rounded-full ${
            over
              ? 'bg-gradient-to-r from-rose-500 to-rose-400'
              : item.pct >= 80
                ? 'bg-gradient-to-r from-amber-500 to-amber-300'
                : 'bg-gradient-to-r from-gold-500 to-gold-300'
          }`}
        />
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        <span className={`num font-semibold ${over ? 'text-rose-600' : 'text-slate-700'}`}>
          {money(item.spent_base, base)}
        </span>{' '}
        of {money(item.amount_base, base)}
        <span className={`ml-1 font-semibold ${over ? 'text-rose-600' : 'text-slate-400'}`}>
          · {item.pct}%{over ? ' — over budget' : ''}
        </span>
      </p>
    </div>
  );
}

// Monthly category budgets with live month-to-date progress.
export default function Budgets({ open, onClose, categories }) {
  const [data, setData] = useState(null);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await api('/budgets'));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setCategory('');
    setAmount('');
    load();
  }, [open, load]);

  async function save(e) {
    e?.preventDefault();
    if (!category.trim() || !Number(amount)) return;
    setBusy(true);
    setError('');
    try {
      await api('/budgets', { method: 'PUT', body: { category: category.trim(), amount: Number(amount) } });
      setCategory('');
      setAmount('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(item) {
    if (!(await confirm({ title: `Remove the ${item.category} budget?`, message: 'Your transactions are untouched — only the budget line goes away.', confirmLabel: 'Remove', danger: true }))) return;
    try {
      await api(`/budgets/${item.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const suggestions = [
    ...new Set([...(data?.unbudgeted.map((u) => u.category) || []), ...(categories?.EXPENSE || [])]),
  ];

  return (
    <Modal open={open} onClose={onClose} title="Monthly budgets" wide>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          {data ? `${monthLabel(data.month)} — spending against each budget, in ${data.base_currency}.` : 'Set a monthly cap per category and watch the bars fill.'}
        </p>

        <ErrorBanner message={error} />

        {/* add / update */}
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[160px] flex-1">
            <span className="label">Category</span>
            <input className="input" list="budget-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Groceries" />
            <datalist id="budget-categories">
              {suggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="w-36">
            <span className="label">Monthly cap</span>
            <input className="input" type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" />
          </div>
          <button className="btn-primary" disabled={busy || !category.trim() || !Number(amount)}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Set
          </button>
        </form>

        {data === null ? (
          <Spinner label="Loading budgets…" />
        ) : data.items.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 py-10 text-center">
            <PiggyBank className="mx-auto mb-2 text-slate-300" size={32} />
            <p className="font-semibold text-slate-700">No budgets yet</p>
            <p className="mx-auto mt-1 max-w-xs text-sm text-slate-400">
              Pick a category above — spending this month shows up against it instantly.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.items.map((item) => (
              <Bar key={item.id} item={item} base={data.base_currency} onDelete={onDelete} />
            ))}
          </div>
        )}

        {/* quick-add candidates */}
        {data && data.unbudgeted.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Spending without a budget this month
            </p>
            <div className="flex flex-wrap gap-1.5">
              {data.unbudgeted.map((u) => (
                <button
                  key={u.category}
                  onClick={() => {
                    setCategory(u.category);
                    setAmount(String(Math.ceil(u.spent_base / 100) * 100));
                  }}
                  className="chip border border-[#e8e2d4] bg-white text-slate-500 transition hover:border-gold-300 hover:text-brand-700"
                >
                  {u.category} · {money(u.spent_base, data.base_currency)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
