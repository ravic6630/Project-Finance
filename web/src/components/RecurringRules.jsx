import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pause, Pencil, Play, Plus, Repeat, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { dateLabel, money } from '../lib/format.js';
import { CURRENCIES } from '../lib/markets.js';
import { ErrorBanner, Field, Modal, Spinner } from './ui.jsx';
import { useConfirm } from '../lib/confirm.jsx';

const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || (n % 100 >= 11 && n % 100 <= 13) ? 0 : n % 10]}`;

const blank = {
  type: 'EXPENSE',
  amount: '',
  currency: 'INR',
  category: '',
  note: '',
  day_of_month: '1',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: '',
};

function RuleForm({ editing, categories, defaultCurrency, onSaved, onCancel }) {
  const [form, setForm] = useState(
    editing
      ? {
          type: editing.type,
          amount: String(editing.amount),
          currency: editing.currency,
          category: editing.category || '',
          note: editing.note || '',
          day_of_month: String(editing.day_of_month),
          start_date: editing.start_date,
          end_date: editing.end_date || '',
        }
      : { ...blank, currency: defaultCurrency || 'INR' }
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const suggestions = categories?.[form.type] || [];

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = {
        type: form.type,
        amount: Number(form.amount || 0),
        currency: form.currency,
        category: form.category,
        note: form.note,
        day_of_month: Number(form.day_of_month || 1),
        start_date: form.start_date,
        end_date: form.end_date || null,
      };
      if (editing) await api(`/recurring/${editing.id}`, { method: 'PATCH', body: payload });
      else await api('/recurring', { method: 'POST', body: payload });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBanner message={error} />
      <div className="grid grid-cols-2 gap-2">
        {['EXPENSE', 'INCOME'].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => set({ type: t })}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
              form.type === t
                ? 'border-brand-500 bg-brand-50 text-brand-700'
                : 'border-slate-200 text-slate-500 hover:border-slate-300'
            }`}
          >
            {t === 'EXPENSE' ? 'Expense' : 'Income'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount">
          <input className="input" type="number" step="any" min="0" value={form.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="25000" required />
        </Field>
        <Field label="Currency">
          <select className="input" value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <input className="input" list="rec-categories" value={form.category} onChange={(e) => set({ category: e.target.value })} placeholder="e.g. Salary, Rent, SIP" />
          <datalist id="rec-categories">
            {suggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Repeats on day" hint="Clamped in short months (31st → 28th in Feb).">
          <input className="input" type="number" min="1" max="31" value={form.day_of_month} onChange={(e) => set({ day_of_month: e.target.value })} required />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts" hint="Back-date to auto-fill past months.">
          <input className="input" type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} required />
        </Field>
        <Field label="Ends (optional)">
          <input className="input" type="date" value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} />
        </Field>
      </div>
      <Field label="Note (optional)">
        <input className="input" value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. Axis SIP · Nifty 50 index" />
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : null}
          {editing ? 'Save changes' : 'Add recurring'}
        </button>
      </div>
    </form>
  );
}

// Manage monthly rules (salary, rent, SIPs). Past occurrences are logged
// automatically the moment a back-dated rule is saved.
export default function RecurringRules({ open, onClose, categories, onChanged }) {
  const { user } = useAuth();
  const [rules, setRules] = useState(null);
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState('');
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      setError('');
      const d = await api('/recurring');
      setRules(d.rules);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setRules(null);
    setFormOpen(false);
    setEditing(null);
    load();
  }, [open, load]);

  async function toggleActive(rule) {
    try {
      await api(`/recurring/${rule.id}`, { method: 'PATCH', body: { active: !rule.active } });
      load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  }

  async function onDelete(rule) {
    const okToDelete = await confirm({
      title: `Delete “${rule.category || rule.note || 'this rule'}”?`,
      message: 'Future occurrences stop. Transactions it already logged are kept.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!okToDelete) return;
    try {
      await api(`/recurring/${rule.id}`, { method: 'DELETE' });
      load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Recurring transactions" wide>
      {formOpen ? (
        <RuleForm
          editing={editing}
          categories={categories}
          defaultCurrency={user.base_currency}
          onCancel={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={() => {
            setFormOpen(false);
            setEditing(null);
            load();
            onChanged?.();
          }}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-slate-500">
              Salary, rent, SIPs — logged automatically every month on the day you pick.
            </p>
            <button
              className="btn-primary shrink-0"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus size={16} /> Add
            </button>
          </div>

          <ErrorBanner message={error} />

          {rules === null ? (
            <Spinner label="Loading rules…" />
          ) : rules.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 py-10 text-center">
              <Repeat className="mx-auto mb-2 text-slate-300" size={32} />
              <p className="font-semibold text-slate-700">Nothing recurring yet</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-slate-400">
                Add your salary or a SIP — back-date it and past months fill in automatically.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {rules.map((r) => (
                <li key={r.id} className={`flex items-center gap-3 px-4 py-3 ${r.active ? '' : 'opacity-50'}`}>
                  <span
                    className={`chip shrink-0 ${
                      r.type === 'INCOME' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'
                    }`}
                  >
                    {r.type === 'INCOME' ? 'Income' : 'Expense'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {r.category || r.note || 'Untitled'}
                      <span className="num ml-2">{money(r.amount, r.currency)}</span>
                    </p>
                    <p className="text-xs text-slate-400">
                      {ordinal(r.day_of_month)} of every month
                      {r.active && r.next_date ? ` · next ${dateLabel(r.next_date)}` : ''}
                      {!r.active ? ' · paused' : ''}
                      {r.end_date ? ` · ends ${dateLabel(r.end_date)}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleActive(r)}
                    title={r.active ? 'Pause' : 'Resume'}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    {r.active ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(r);
                      setFormOpen(true);
                    }}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => onDelete(r)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600"
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
