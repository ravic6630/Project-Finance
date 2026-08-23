import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, Car, Coins, Home, Landmark, Pencil, Plus, Store, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { money } from '../lib/format.js';
import { CURRENCIES } from '../lib/markets.js';
import { cardRise, pageVisible } from '../lib/motion.js';
import { EmptyState, ErrorBanner, Field, Modal } from '../components/ui.jsx';
import { CardSkeleton, Magnetic, Spotlight } from '../components/fx.jsx';
import { useConfirm } from '../lib/confirm.jsx';
import { useProfile } from '../lib/ProfileContext.jsx';
import { LinkedScopeNote } from '../components/FamilyBits.jsx';

// Each asset type carries its own visual identity: an icon-chip tint, a soft
// gradient wash over the card, and a watermark colour. All tones have dark
// variants so the cards stay rich in both themes.
const TYPES = [
  {
    value: 'PROPERTY',
    label: 'Property',
    icon: Home,
    chip: 'bg-brand-100 text-brand-700 dark:bg-[#1a3053] dark:text-[#a9bcdd]',
    wash: 'from-brand-100/70 dark:from-[#1a3053]/40',
    mark: 'text-brand-700 dark:text-[#8fa9cd]',
  },
  {
    value: 'LAND',
    label: 'Land',
    icon: Landmark,
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
    wash: 'from-emerald-100/60 dark:from-emerald-900/25',
    mark: 'text-emerald-700 dark:text-emerald-400',
  },
  {
    value: 'BUSINESS',
    label: 'Business',
    icon: Store,
    chip: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
    wash: 'from-violet-100/60 dark:from-violet-900/25',
    mark: 'text-violet-700 dark:text-violet-400',
  },
  {
    value: 'VEHICLE',
    label: 'Vehicle',
    icon: Car,
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300',
    wash: 'from-sky-100/60 dark:from-sky-900/25',
    mark: 'text-sky-700 dark:text-sky-400',
  },
  {
    value: 'GOLD',
    label: 'Gold',
    icon: Coins,
    chip: 'bg-gold-100 text-gold-700 dark:bg-gold-900/60 dark:text-gold-300',
    wash: 'from-gold-100/70 dark:from-gold-900/30',
    mark: 'text-gold-600 dark:text-gold-400',
  },
  {
    value: 'OTHER',
    label: 'Other',
    icon: Building2,
    chip: 'bg-slate-100 text-slate-600 dark:bg-[#1c2c49] dark:text-slate-300',
    wash: 'from-slate-100/70 dark:from-[#1c2c49]/40',
    mark: 'text-slate-500 dark:text-slate-400',
  },
];
const typeMeta = (t) => TYPES.find((x) => x.value === t) || TYPES[5];

// Cards rise in reading order, with the delay capped so a large portfolio of
// assets lands promptly instead of cascading for several seconds.
const STAGGER_CAP = 12;
const listContainer = { hidden: {}, show: {} };
const riseAt = (i) => ({
  hidden: cardRise.hidden,
  show: {
    ...cardRise.show,
    transition: { ...cardRise.show.transition, delay: Math.min(i, STAGGER_CAP) * 0.045 },
  },
});

// Ease-out count-up for the summary total (skips animation when the tab loads
// hidden or the user prefers reduced motion).
function useCountUp(target, duration = 800) {
  const animate = pageVisible() && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [val, setVal] = useState(animate ? 0 : target);
  const raf = useRef(0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (!animate) {
      setVal(target);
      return undefined;
    }
    const start = performance.now();
    const from = fromRef.current;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setVal(from + (target - from) * (1 - (1 - t) ** 3));
      if (t < 1) raf.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration, animate]);
  return val;
}

const blank = { name: '', type: 'PROPERTY', value: '', currency: 'INR', notes: '' };

function AssetForm({ open, onClose, onSaved, editing, defaultCurrency, profileId = null }) {
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
            type: editing.type || 'PROPERTY',
            value: String(editing.value ?? ''),
            currency: editing.currency || 'INR',
            notes: editing.notes || '',
          }
        : { ...blank, currency: defaultCurrency || 'INR' }
    );
  }, [open, editing, defaultCurrency]);

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
        value: Number(form.value || 0),
        currency: form.currency,
        notes: form.notes,
      };
      if (editing) await api(`/assets/${editing.id}`, { method: 'PATCH', body: payload });
      else await api('/assets', { method: 'POST', body: payload });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit asset' : 'Add asset'}>
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorBanner message={error} />
        <Field label="Type">
          <div className="grid grid-cols-3 gap-2">
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
        <Field label="Name">
          <input
            className="input"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. Whitefield flat"
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Current value">
            <input
              className="input"
              type="number"
              step="any"
              value={form.value}
              onChange={(e) => set({ value: e.target.value })}
              placeholder="0"
              required
            />
          </Field>
          <Field label="Currency">
            <select className="input" value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Notes" hint="Optional — address, ownership %, how you valued it.">
          <input
            className="input"
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="e.g. joint with spouse (50%)"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add asset'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Assets() {
  const { user } = useAuth();
  const { active: activeProfile, activeProfileId, profileQuery } = useProfile();
  const base = user.base_currency;
  const [assets, setAssets] = useState([]);
  const [totalBase, setTotalBase] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      setError('');
      const d = await api(`/assets${profileQuery()}`);
      setAssets(d.assets);
      setTotalBase(d.total_base ?? 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeProfile]);

  // Re-fetch (re-converts) when the base currency changes.
  useEffect(() => {
    load();
  }, [load, base, activeProfile]);

  async function onDelete(a) {
    if (!(await confirm({ title: `Delete “${a.name}”?`, message: 'This permanently removes the asset.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/assets/${a.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const shownTotal = useCountUp(totalBase);
  const typeCount = new Set(assets.map((a) => a.type)).size;

  return (
    <div className="space-y-6">
      <LinkedScopeNote />

      <header>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-brand-900">Assets</h2>
            <p className="mt-1 text-sm text-slate-500">
              Property, land, business, vehicles and gold — what you own outright.
            </p>
          </div>
          <Magnetic>
            <button className="btn-primary" onClick={openAdd}>
              <Plus size={16} /> Add asset
            </button>
          </Magnetic>
        </div>
        <div className="rule-fade mt-4" />
      </header>

      {assets.length > 0 && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-5 py-4 text-white shadow-lg">
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="aurora-blob absolute -right-10 -top-14 h-36 w-36 rounded-full bg-gold-400/25 blur-2xl" />
          </div>
          <p className="relative text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-200">
            Total assets
          </p>
          <p className="num relative mt-0.5 text-2xl font-bold tracking-tight sm:text-3xl">
            {money(shownTotal, base)}
          </p>
          <div className="gold-rule relative mt-2.5" />
          <p className="relative mt-2 text-xs text-brand-200">
            {assets.length} asset{assets.length === 1 ? '' : 's'} · {typeCount} type{typeCount === 1 ? '' : 's'}
          </p>
        </div>
      )}

      <ErrorBanner message={error} />

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <EmptyState
          illo="assets"
          icon={Building2}
          title="No assets yet"
          hint="Add property, land, a business, vehicles or gold — anything with real value — so your net worth reflects everything you own."
          action={
            <Magnetic>
              <button className="btn-primary" onClick={openAdd}>
                <Plus size={16} /> Add an asset
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
          {assets.map((a, i) => {
            const meta = typeMeta(a.type);
            const pct = totalBase > 0 ? ((a.value_base ?? a.value) / totalBase) * 100 : 0;
            return (
              // The hover lift lives on .card-interactive (CSS); framer only owns
              // the entrance, so the two never fight over `transform`.
              <motion.div key={a.id} variants={riseAt(i)} className="h-full">
                <Spotlight className="card-interactive group relative h-full overflow-hidden p-5">
                  {/* type-tinted wash + oversized watermark that stirs on hover */}
                  <div aria-hidden className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${meta.wash} to-transparent`} />
                  <meta.icon
                    aria-hidden
                    size={116}
                    strokeWidth={1}
                    className={`pointer-events-none absolute -bottom-7 -right-6 -rotate-12 ${meta.mark} opacity-[0.08] transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110 dark:opacity-[0.12]`}
                  />

                  <div className="relative">
                    <div className="flex items-start justify-between">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${meta.chip}`}>
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

                    <p className="mt-4 truncate font-semibold text-slate-900">{a.name}</p>
                    <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${meta.chip}`}>
                      {meta.label}
                    </span>
                    <p className="num mt-2.5 text-2xl font-bold tracking-tight text-slate-900">
                      {money(a.value_base ?? a.value, base)}
                    </p>
                    {a.currency !== base && (
                      <p className="num text-xs text-slate-400">entered as {money(a.value, a.currency)}</p>
                    )}

                    {/* share of the whole portfolio of assets */}
                    <div className="mt-3.5">
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[#1c2c49]">
                        <motion.div
                          initial={pageVisible() ? { width: 0 } : false}
                          animate={{ width: `${pct}%` }}
                          transition={{ delay: 0.35, duration: 0.8, ease: 'easeOut' }}
                          className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-300"
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] font-medium text-slate-500">
                        <span className="num font-semibold text-slate-500">
                          {pct.toFixed(pct >= 10 ? 0 : 1)}%
                        </span>{' '}
                        of your assets
                      </p>
                    </div>

                    {a.notes && (
                      <p className="mt-2.5 line-clamp-2 text-xs text-slate-500">{a.notes}</p>
                    )}
                  </div>
                </Spotlight>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      <AssetForm
        profileId={activeProfileId}
        open={formOpen}
        editing={editing}
        defaultCurrency={user.base_currency}
        onClose={() => setFormOpen(false)}
        onSaved={load}
      />
    </div>
  );
}
