import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, CircleDashed, Home, Search, ShieldCheck, TrendingUp } from 'lucide-react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { ErrorBanner, Modal, Spinner } from './ui.jsx';

/* ============================================================================
   What funds this goal.

   The plan can fill a goal from "everything you own, in order" — a fair guess.
   But someone who has put a liquid fund and part of a bank balance aside for a
   wedding knows exactly what that goal is funded by, and this is where they say
   so: tick the items, and for each choose all of it, a fixed amount, or a share.
   From then on the goal tracks exactly those — nothing is added by guesswork —
   and everything left unticked stays available to the other goals.
   ========================================================================== */

const keyOf = (it) => `${it.kind}:${it.ref_id}`;

// The figures describing other goals' claims arrived over a few releases. An
// app build newer than the server it talks to must still open the picker, so
// anything missing reads as "nobody else has claimed this" rather than
// crashing the sheet.
const withDefaults = (it) => ({
  rate: 1,
  taken_base: 0,
  explicit_base: 0,
  whole_count: 0,
  ahead_base: 0,
  taken_by: [],
  ahead_by: [],
  ...it,
});

// What kind of money an item is, shown as an icon and a word — never by colour
// alone, and never as a verdict: a share isn't "bad", it's just not where money
// needed next year usually sits.
const CLASS_ICON = { safe: ShieldCheck, growth: TrendingUp, physical: Home, unknown: CircleDashed };

const SECTIONS = [
  ['holding', 'Investments'],
  ['account', 'Cash & bank'],
  ['asset', 'Property & other assets'],
];

// What was asked for, before anyone else's claim is considered.
function asked(it, s) {
  if (s.portion === 'amount') return Math.max(0, Number(s.value) || 0) * it.rate;
  if (s.portion === 'percent') return (it.value_base * Math.min(100, Math.max(0, Number(s.value) || 0))) / 100;
  return null;
}

// What this goal would actually get from an item at the chosen portion — the
// same arithmetic the server settles with, so the running total doesn't jump on
// save. A fixed amount or share is capped by what goals ranking ahead leave;
// "all of it" is all of what every fixed claim leaves, shared with any other
// goal that also took all of it.
function countsAs(it, s) {
  if (!s) return 0;
  const want = asked(it, s);
  if (want == null) return Math.max(0, it.value_base - it.explicit_base) / (it.whole_count + 1);
  return Math.min(want, Math.max(0, it.value_base - it.ahead_base));
}

function PortionPicker({ it, s, base, onChange }) {
  // Switching the kind of portion starts its figure afresh: an amount typed in
  // rupees means nothing as a percentage. Half is the natural first share.
  const pick = (portion) => portion !== s.portion && onChange({ portion, value: portion === 'percent' ? '50' : '' });
  const opt = (portion, label) => (
    <button
      type="button"
      aria-pressed={s.portion === portion}
      onClick={() => pick(portion)}
      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
        s.portion === portion ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      {label}
    </button>
  );
  const free = Math.max(0, it.value_base - it.taken_base);
  const room = Math.max(0, it.value_base - it.ahead_base);
  const mine = countsAs(it, s);
  const want = asked(it, s);
  const m = (v) => money(v, base, { whole: true });
  // Two different problems, said differently: asking for more than the goals
  // ahead leave (this goal comes up short), or taking what goals behind were
  // counting on (they do).
  const behind = it.taken_by.filter((n) => !it.ahead_by.includes(n));
  const warning =
    want == null
      ? null
      : want > room + 0.5
        ? `Only ${m(room)} is left after ${it.ahead_by.join(' and ') || 'what it holds'}${it.ahead_by.length ? `, which rank${it.ahead_by.length === 1 ? 's' : ''} ahead` : ''} — this goal would get ${m(room)}, not ${m(want)}.`
        : want > free + 0.5
          ? `That is ${m(want - free)} more than is free — ${behind.join(' and ') || 'another goal'} would come up short.`
          : null;

  return (
    <div className="mt-2.5 pl-7">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex gap-0.5 rounded-xl bg-slate-100 p-0.5" role="group" aria-label={`How much of ${it.name}`}>
          {opt('all', 'All of it')}
          {opt('amount', 'An amount')}
          {opt('percent', 'A share')}
        </div>
        {s.portion !== 'all' && (
          <span className="flex items-center gap-1.5">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max={s.portion === 'percent' ? 100 : undefined}
              step="any"
              value={s.value}
              onChange={(e) => onChange({ ...s, value: e.target.value })}
              aria-label={s.portion === 'percent' ? `Share of ${it.name} in percent` : `Amount of ${it.name} in ${it.currency}`}
              // Suggest what is actually free, in the item's own currency.
              placeholder={s.portion === 'percent' ? '50' : String(Math.round(it.rate > 0 ? free / it.rate : 0))}
              className="input num w-32 py-1.5"
            />
            <span className="text-xs font-semibold text-slate-500">{s.portion === 'percent' ? '%' : it.currency}</span>
          </span>
        )}
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        Counts as <span className="num font-semibold text-slate-700">{m(mine)}</span>
        {s.portion === 'percent' && !warning && ' — and grows or falls with it'}
        {s.portion === 'all' && it.whole_count > 0 && ` — shared equally with ${it.taken_by.join(' and ')}`}
        {s.portion === 'all' && it.whole_count === 0 && it.explicit_base > 0 && ` — what's left after ${it.taken_by.join(' and ')}`}
      </p>
      {warning && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle size={13} className="mt-0.5 flex-none" aria-hidden />
          {warning}
        </p>
      )}
    </div>
  );
}

function Row({ it, s, base, onToggle, onChange }) {
  const Icon = CLASS_ICON[it.cls] || CircleDashed;
  const foreign = it.currency && it.currency !== base;
  return (
    <li className={`rounded-xl border px-3 py-2.5 transition ${s ? 'border-brand-300 bg-brand-50/50' : 'border-transparent hover:bg-slate-50'}`}>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-1 h-4 w-4 flex-none accent-brand-600" checked={!!s} onChange={onToggle} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-800">{it.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Icon size={12} aria-hidden /> {it.tag}
            </span>
            {it.taken_base > 0 && (
              <span>
                · {money(it.taken_base, base, { compact: true })} of it is for {it.taken_by.join(' and ') || 'another goal'}
              </span>
            )}
          </span>
        </span>
        <span className="flex-none text-right">
          <span className="num block text-sm font-semibold text-slate-800">{money(it.value_base, base, { whole: true })}</span>
          {foreign && <span className="num block text-[11px] text-slate-400">{money(it.value_native, it.currency, { whole: true })}</span>}
        </span>
      </label>
      {s && <PortionPicker it={it} s={s} base={base} onChange={onChange} />}
    </li>
  );
}

export default function GoalFunding({ goal, open, fresh = false, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [sel, setSel] = useState({}); // 'account:3' → { portion, value }
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !goal) return undefined;
    setData(null);
    setError('');
    setQuery('');
    // Ignore an answer for a goal we've since moved off.
    let stale = false;
    api(`/goals/${goal.id}/funding`)
      .then((d) => {
        if (stale) return;
        setData({ ...d, items: (d.items || []).map(withDefaults) });
        setSel(
          Object.fromEntries(
            d.items.filter((it) => it.mine).map((it) => [keyOf(it), { portion: it.mine.portion, value: it.mine.value == null ? '' : String(it.mine.value) }])
          )
        );
      })
      .catch((e) => !stale && setError(e.message));
    return () => {
      stale = true;
    };
  }, [open, goal]);

  const base = data?.base_currency;
  const items = data?.items || [];
  const picked = useMemo(() => items.filter((it) => sel[keyOf(it)]), [items, sel]);
  const total = picked.reduce((s, it) => s + countsAs(it, sel[keyOf(it)]), 0);
  const need = data?.goal.needed_today || 0;
  const hadChoices = items.some((it) => it.mine);

  const q = query.trim().toLowerCase();
  const visible = q ? items.filter((it) => `${it.name} ${it.tag}`.toLowerCase().includes(q) || sel[keyOf(it)]) : items;

  const toggle = (it) =>
    setSel((cur) => {
      const next = { ...cur };
      if (next[keyOf(it)]) delete next[keyOf(it)];
      else next[keyOf(it)] = { portion: 'all', value: '' };
      return next;
    });

  async function save(links) {
    setBusy(true);
    setError('');
    try {
      await api(`/goals/${goal.id}/links`, { method: 'PUT', body: { links } });
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    const links = [];
    for (const it of picked) {
      const s = sel[keyOf(it)];
      const value = Number(s.value);
      if (s.portion !== 'all' && !(value > 0)) {
        setError(`Enter how much of ${it.name} is for this goal, or choose “All of it”.`);
        return;
      }
      if (s.portion === 'percent' && value > 100) {
        setError(`A share of ${it.name} can't be more than 100%.`);
        return;
      }
      links.push({ kind: it.kind, ref_id: it.ref_id, portion: s.portion, value: s.portion === 'all' ? null : value });
    }
    save(links);
  }

  const soon = data && data.goal.years_left > 0 && data.goal.years_left < 3;
  const months = data ? Math.max(1, Math.round(data.goal.years_left * 12)) : 0;

  return (
    <Modal open={open} onClose={onClose} title={goal ? `What funds ${goal.name}?` : 'What funds this goal?'} wide>
      {!data ? (
        error ? <ErrorBanner message={error} /> : <Spinner label="Loading what you own…" />
      ) : (
        <form onSubmit={submit}>
          {/* The running total stays in view while the list scrolls. */}
          <div className="sticky -top-5 z-10 -mx-6 -mt-5 border-b border-slate-100 bg-white px-6 pb-4 pt-5">
            <p className="text-sm text-slate-600">
              Tick what you&apos;ve set aside for this goal. It will then track <span className="font-semibold text-slate-800">exactly those</span> —
              nothing else is added — and whatever you leave unticked stays available to your other goals.
            </p>
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="num text-2xl font-bold tracking-tight text-brand-900">{money(total, base, { whole: true })}</p>
              <p className="text-xs text-slate-500">
                {picked.length === 0
                  ? `Nothing ticked — it fills automatically. Needs ${money(need, base, { whole: true })} today.`
                  : total >= need - 0.5
                    ? 'Covers what this goal needs today'
                    : `${money(need - total, base, { whole: true })} short of the ${money(need, base, { whole: true })} it needs today`}
              </p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <div className="h-full rounded-full bg-gold-400 transition-[width] duration-300" style={{ width: `${need > 0 ? Math.min(100, (total / need) * 100) : 0}%` }} />
            </div>
            {soon && (
              <p className="mt-2.5 flex items-start gap-1.5 text-xs text-slate-500">
                <ShieldCheck size={13} className="mt-0.5 flex-none text-emerald-600" aria-hidden />
                Needed in {months} month{months === 1 ? '' : 's'} — bank balances, FDs and liquid or debt funds are the usual home for money wanted this soon.
              </p>
            )}
            {items.length > 8 && (
              <label className="relative mt-3 block">
                <span className="sr-only">Search what you own</span>
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                <input className="input py-2 pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search — try “liquid”, “bank” or a fund name" />
              </label>
            )}
          </div>

          <div className="space-y-4 py-4">
            <ErrorBanner message={error} />
            {items.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">Nothing to choose from yet — add investments, accounts or assets first.</p>
            )}
            {SECTIONS.map(([kind, label]) => {
              const rows = visible.filter((it) => it.kind === kind);
              if (!rows.length) return null;
              return (
                <div key={kind}>
                  <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
                  <ul className="space-y-1">
                    {rows.map((it) => (
                      <Row
                        key={keyOf(it)}
                        it={it}
                        s={sel[keyOf(it)]}
                        base={base}
                        onToggle={() => toggle(it)}
                        onChange={(s) => setSel((cur) => ({ ...cur, [keyOf(it)]: s }))}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
            {q && visible.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Nothing matches “{query}”.</p>}
          </div>

          <div className="sticky -bottom-5 -mx-6 -mb-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-white px-6 py-4">
            {hadChoices ? (
              <button type="button" className="text-sm font-semibold text-brand-600 hover:underline" disabled={busy} onClick={() => save([])}>
                Fill it automatically instead
              </button>
            ) : (
              <span className="text-xs text-slate-400">{picked.length ? `${picked.length} chosen` : ''}</span>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
                {fresh ? 'Skip — fill it automatically' : 'Cancel'}
              </button>
              <button className="btn-primary" disabled={busy || (picked.length === 0 && !hadChoices)}>
                <Check size={16} /> {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
