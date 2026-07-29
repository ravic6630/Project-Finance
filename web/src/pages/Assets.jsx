import { useCallback, useEffect, useState } from 'react';
import { Building2, Car, Coins, Home, Landmark, Pencil, Plus, Store, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { money } from '../lib/format.js';
import { CURRENCIES } from '../lib/markets.js';
import { EmptyState, ErrorBanner, Field, Modal, Spinner } from '../components/ui.jsx';
import { useConfirm } from '../lib/confirm.jsx';

const TYPES = [
  { value: 'PROPERTY', label: 'Property', icon: Home },
  { value: 'LAND', label: 'Land', icon: Landmark },
  { value: 'BUSINESS', label: 'Business', icon: Store },
  { value: 'VEHICLE', label: 'Vehicle', icon: Car },
  { value: 'GOLD', label: 'Gold', icon: Coins },
  { value: 'OTHER', label: 'Other', icon: Building2 },
];
const typeMeta = (t) => TYPES.find((x) => x.value === t) || TYPES[5];

const blank = { name: '', type: 'PROPERTY', value: '', currency: 'INR', notes: '' };

function AssetForm({ open, onClose, onSaved, editing, defaultCurrency }) {
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
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      setError('');
      const d = await api('/assets');
      setAssets(d.assets);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onDelete(a) {
    if (!(await confirm({ title: `Delete “${a.name}”?`, message: 'This permanently removes the asset.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/assets/${a.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  // Subtotal per currency (no FX on this page; the dashboard converts to base).
  const subtotals = assets.reduce((acc, a) => {
    acc[a.currency] = (acc[a.currency] || 0) + a.value;
    return acc;
  }, {});
  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(subtotals).map(([cur, total]) => (
            <div key={cur} className="rounded-xl bg-white px-4 py-2 shadow-sm ring-1 ring-slate-200">
              <span className="text-xs font-semibold uppercase text-slate-400">{cur} total</span>
              <p className="text-lg font-bold text-slate-900">{money(total, cur)}</p>
            </div>
          ))}
          {assets.length === 0 && <p className="text-sm text-slate-500">No assets yet.</p>}
        </div>
        <button className="btn-primary" onClick={openAdd}>
          <Plus size={16} /> Add asset
        </button>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading assets…" />
      ) : assets.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No assets yet"
          hint="Add property, land, a business, vehicles or gold — anything with real value — so your net worth reflects everything you own."
          action={
            <button className="btn-primary" onClick={openAdd}>
              <Plus size={16} /> Add an asset
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a) => {
            const meta = typeMeta(a.type);
            return (
              <div key={a.id} className="card group p-5">
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <meta.icon size={20} />
                  </div>
                  <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                    <button
                      onClick={() => {
                        setEditing(a);
                        setFormOpen(true);
                      }}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => onDelete(a)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <p className="mt-4 font-semibold text-slate-900">{a.name}</p>
                <p className="text-xs font-medium uppercase text-slate-400">{meta.label}</p>
                <p className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">
                  {money(a.value, a.currency)}
                </p>
                {a.notes && <p className="mt-2 text-xs text-slate-500">{a.notes}</p>}
              </div>
            );
          })}
        </div>
      )}

      <AssetForm
        open={formOpen}
        editing={editing}
        defaultCurrency={user.base_currency}
        onClose={() => setFormOpen(false)}
        onSaved={load}
      />
    </div>
  );
}
