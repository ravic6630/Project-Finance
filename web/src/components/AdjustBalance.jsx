import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { ErrorBanner, Field, Modal } from './ui.jsx';

/* Add money to an account, or record spending from it, in one step.

   Opening the full edit form and retyping a balance is fine for a correction and
   hopeless for "I just paid for groceries". This asks for one number, shows the
   balance it will produce before anything is saved, and — unless the user says
   it was only a correction — records the same movement as a transaction.

   That last part is why it exists as more than a shortcut. The cashflow panels
   and the FI number are built from recorded spending, and a balance change is
   the one moment that information is already in the user's hand. */

// The few categories that cover most quick adjustments, in the order people
// reach for them. Anything else can be typed; the server keeps whatever it's
// given, and it becomes a suggestion on the Transactions page after first use.
const QUICK = {
  in: ['Salary', 'Interest', 'Refund', 'Gift', 'Other'],
  out: ['Groceries', 'Food', 'Bills', 'Rent', 'Shopping', 'Transport', 'Other'],
};

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function AdjustBalance({ account, direction: initialDirection = 'in', open, onClose, onSaved }) {
  const [direction, setDirection] = useState(initialDirection);
  const [amount, setAmount] = useState('');
  const [record, setRecord] = useState(true);
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Every open starts clean, on the direction the user tapped. Leftover state
  // from the last adjustment would pre-fill an amount they never meant to repeat.
  useEffect(() => {
    if (!open) return;
    setDirection(initialDirection);
    setAmount('');
    setRecord(true);
    setCategory('');
    setNote('');
    setDate(todayLocal());
    setError('');
  }, [open, initialDirection, account?.id]);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;
  const current = Number(account?.balance) || 0;
  const next = valid ? current + (direction === 'in' ? value : -value) : current;
  const goesNegative = valid && next < 0;
  const isIn = direction === 'in';

  const chips = useMemo(() => QUICK[direction], [direction]);

  if (!account) return null;

  async function onSubmit(e) {
    e.preventDefault();
    if (!valid) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const d = await api(`/cash/${account.id}/adjust`, {
        method: 'POST',
        body: {
          direction,
          amount: value,
          record,
          category: record ? category.trim() || 'Other' : undefined,
          note: note.trim() || undefined,
          date,
        },
      });
      onSaved?.(d);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isIn ? `Add money to ${account.name}` : `Spend from ${account.name}`}>
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorBanner message={error} />

        {/* In or out, switchable without closing — tapping the wrong button
            shouldn't cost a round trip back to the card. */}
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-[#16233c]" role="radiogroup">
          {[
            { key: 'in', label: 'Money in', icon: ArrowDownLeft },
            { key: 'out', label: 'Money out', icon: ArrowUpRight },
          ].map((d) => (
            <button
              key={d.key}
              type="button"
              role="radio"
              aria-checked={direction === d.key}
              onClick={() => {
                setDirection(d.key);
                setCategory('');
              }}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${
                direction === d.key
                  ? d.key === 'in'
                    ? 'bg-white text-emerald-700 shadow-sm dark:bg-[#1c2c49] dark:text-emerald-300'
                    : 'bg-white text-rose-700 shadow-sm dark:bg-[#1c2c49] dark:text-rose-300'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <d.icon size={15} />
              {d.label}
            </button>
          ))}
        </div>

        <Field label={`Amount (${account.currency})`}>
          <input
            className="input num text-lg font-semibold"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
            required
          />
        </Field>

        {/* The balance this will produce, before anything is saved. It is the
            one number the user is really deciding on, and a typo in the amount
            is far easier to catch here than after it's been written. */}
        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm dark:bg-[#16233c]">
          <span className="text-slate-500">Balance</span>
          <span className="num flex items-center gap-2">
            <span className="text-slate-400">{money(current, account.currency)}</span>
            <span className="text-slate-300" aria-hidden="true">→</span>
            <span
              className={`font-bold ${
                !valid
                  ? 'text-slate-400'
                  : goesNegative
                    ? 'text-rose-600 dark:text-rose-300'
                    : isIn
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-slate-900'
              }`}
            >
              {money(next, account.currency)}
            </span>
          </span>
        </div>
        {goesNegative && (
          <p className="-mt-2 text-xs text-rose-600 dark:text-rose-300">
            This takes the account below zero. That&apos;s fine for an overdraft — just check the amount.
          </p>
        )}

        {/* Whether this is income/spending, or only a correction. Default on,
            because most adjustments are real money moving — but a transfer
            between your own accounts is neither, and logging it as spending
            would inflate the number your FI target is sized from. */}
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-[#223250]">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-brand-600"
            checked={record}
            onChange={(e) => setRecord(e.target.checked)}
          />
          <span className="text-sm">
            <span className="block font-medium text-slate-800">
              {isIn ? 'Record this as income' : 'Record this as spending'}
            </span>
            <span className="block text-xs text-slate-500">
              {record
                ? 'Counts toward your cashflow, budgets and FI number.'
                : "Just corrects the balance — for a transfer between your own accounts, or fixing a typo."}
            </span>
          </span>
        </label>

        {record && (
          <>
            <Field label="Category">
              <div className="flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    aria-pressed={category === c}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      category === c
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <input
                className="input mt-2"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Or type your own"
                maxLength={60}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </Field>
              <Field label="Note (optional)">
                <input
                  className="input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={isIn ? 'e.g. September salary' : 'e.g. Big Bazaar'}
                  maxLength={280}
                />
              </Field>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !valid}>
            {busy ? 'Saving…' : isIn ? 'Add money' : 'Record spending'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
