import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Banknote, Landmark, Lock, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { api } from '../lib/api.js';
import { dateLabel, money } from '../lib/format.js';
import { CURRENCIES } from '../lib/markets.js';
import { EmptyState, ErrorBanner, Field, Modal } from '../components/ui.jsx';
import { CardSkeleton, Magnetic, Spotlight } from '../components/fx.jsx';
import { useConfirm } from '../lib/confirm.jsx';
import { useProfile } from '../lib/ProfileContext.jsx';
import { LinkedScopeNote } from '../components/FamilyBits.jsx';
import { cardRise, pageVisible } from '../lib/motion.js';

// Cards rise in reading order, but the delay is capped so a long list of
// accounts arrives promptly instead of trickling in for several seconds.
const STAGGER_CAP = 12;
const listContainer = { hidden: {}, show: {} };
const riseAt = (i) => ({
  hidden: cardRise.hidden,
  show: {
    ...cardRise.show,
    transition: { ...cardRise.show.transition, delay: Math.min(i, STAGGER_CAP) * 0.045 },
  },
});

const TYPES = [
  { value: 'BANK', label: 'Bank', icon: Landmark },
  { value: 'CASH', label: 'Cash', icon: Banknote },
  { value: 'FD', label: 'Fixed Deposit', icon: Lock },
  { value: 'OTHER', label: 'Other', icon: Wallet },
];
const typeMeta = (t) => TYPES.find((x) => x.value === t) || TYPES[3];

const blank = {
  name: '',
  type: 'BANK',
  balance: '',
  currency: 'INR',
  interest_rate: '',
  maturity_date: '',
  notes: '',
};

function CashForm({ open, onClose, onSaved, editing, profileId = null }) {
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
            type: editing.type || 'BANK',
            balance: String(editing.balance ?? ''),
            currency: editing.currency || 'INR',
            interest_rate: editing.interest_rate != null ? String(editing.interest_rate) : '',
            maturity_date: editing.maturity_date || '',
            notes: editing.notes || '',
          }
        : blank
    );
  }, [open, editing]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = {
        ...(profileId && !editing ? { profile_id: profileId } : {}),
        name: form.name,
        type: form.type,
        balance: Number(form.balance || 0),
        currency: form.currency,
        interest_rate: form.interest_rate === '' ? null : Number(form.interest_rate),
        maturity_date: form.type === 'FD' ? form.maturity_date || null : null,
        notes: form.notes,
      };
      if (editing) await api(`/cash/${editing.id}`, { method: 'PATCH', body: payload });
      else await api('/cash', { method: 'POST', body: payload });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit account' : 'Add account'}>
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorBanner message={error} />
        <Field label="Type">
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
        <Field label="Account name">
          <input
            className="input"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="HDFC Savings"
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Balance">
            <input
              className="input"
              type="number"
              step="any"
              value={form.balance}
              onChange={(e) => set({ balance: e.target.value })}
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
        {form.type === 'FD' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Interest rate (% p.a.)">
              <input
                className="input"
                type="number"
                step="any"
                value={form.interest_rate}
                onChange={(e) => set({ interest_rate: e.target.value })}
                placeholder="7.1"
              />
            </Field>
            <Field label="Maturity date">
              <input
                className="input"
                type="date"
                value={form.maturity_date}
                onChange={(e) => set({ maturity_date: e.target.value })}
              />
            </Field>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add account'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Cash() {
  const { active: activeProfile, activeProfileId, profileQuery } = useProfile();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      setError('');
      const d = await api(`/cash${profileQuery()}`);
      setAccounts(d.accounts);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeProfile]);

  const confirm = useConfirm();

  useEffect(() => {
    load();
  }, [load, activeProfile]);

  async function onDelete(a) {
    if (!(await confirm({ title: `Delete “${a.name}”?`, message: 'This permanently removes the account.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/cash/${a.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  // Subtotals per currency (no FX needed on this page).
  const subtotals = accounts.reduce((acc, a) => {
    acc[a.currency] = (acc[a.currency] || 0) + a.balance;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <LinkedScopeNote />

      <header>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-brand-900">
              Cash &amp; deposits
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Savings, current accounts, fixed deposits and cash in hand.
            </p>
          </div>
          <Magnetic>
            <button
              className="btn-primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus size={16} /> Add account
            </button>
          </Magnetic>
        </div>
        <div className="rule-fade mt-4" />
      </header>

      {/* Per-currency subtotals. No FX here on purpose — each currency stands
          on its own so nothing is quietly converted behind the user's back. */}
      {Object.keys(subtotals).length > 0 && (
        <div className="flex flex-wrap items-stretch gap-3">
          {Object.entries(subtotals).map(([cur, total]) => (
            <Spotlight key={cur} className="card px-4 py-2.5">
              <span className="relative block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {cur} total
              </span>
              <p className="num relative mt-0.5 text-lg font-bold tracking-tight text-slate-900">
                {money(total, cur)}
              </p>
            </Spotlight>
          ))}
        </div>
      )}

      <ErrorBanner message={error} />

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          illo="cash"
          icon={Wallet}
          title="No cash or bank accounts yet"
          hint="Add your savings accounts, fixed deposits and cash so your net worth is complete."
          action={
            <Magnetic>
              <button
                className="btn-primary"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus size={16} /> Add an account
              </button>
            </Magnetic>
          }
        />
      ) : (
        <motion.div
          variants={listContainer}
          initial={pageVisible() ? 'hidden' : false}
          animate="show"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {accounts.map((a, i) => {
            const meta = typeMeta(a.type);
            return (
              // The lift lives on .card-interactive (CSS); framer only owns the
              // entrance, so the two never fight over `transform`.
              <motion.div key={a.id} variants={riseAt(i)} className="h-full">
                <Spotlight className="card-interactive group relative h-full overflow-hidden p-5">
                  <meta.icon
                    aria-hidden
                    size={116}
                    strokeWidth={1}
                    className="pointer-events-none absolute -bottom-7 -right-6 -rotate-12 text-brand-700 opacity-[0.07] transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110 dark:text-[#8fa9cd] dark:opacity-[0.12]"
                  />
                  <div className="relative flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 dark:ring-[#22375c]">
                      <meta.icon size={20} />
                    </div>
                    <div className="flex gap-1 opacity-0 transition duration-200 focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        onClick={() => {
                          setEditing(a);
                          setFormOpen(true);
                        }}
                        aria-label={`Edit ${a.name}`}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => onDelete(a)}
                        aria-label={`Delete ${a.name}`}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-100 hover:text-rose-600"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <p className="relative mt-4 truncate font-semibold text-slate-900">{a.name}</p>
                  <p className="relative mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {meta.label} · {a.currency}
                  </p>
                  <p className="num relative mt-2 text-2xl font-bold tracking-tight text-slate-900">
                    {money(a.balance, a.currency)}
                  </p>
                  {a.type === 'FD' && (a.interest_rate || a.maturity_date) && (
                    <>
                      <div className="rule-fade relative mt-3" />
                      <p className="relative mt-2.5 text-xs text-slate-500">
                        {a.interest_rate ? (
                          <span className="num font-semibold text-gold-600">
                            {a.interest_rate}% p.a.
                          </span>
                        ) : null}
                        {a.interest_rate && a.maturity_date ? ' · ' : ''}
                        {a.maturity_date ? `matures ${dateLabel(a.maturity_date)}` : ''}
                      </p>
                    </>
                  )}
                </Spotlight>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      <CashForm
        profileId={activeProfileId}
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={load}
      />
    </div>
  );
}
