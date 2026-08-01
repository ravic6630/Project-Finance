import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { useProfile } from '../lib/ProfileContext.jsx';
import { ErrorBanner, Field, Modal } from './ui.jsx';
import { useConfirm } from '../lib/confirm.jsx';

const initials = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

// Header dropdown: whose wealth are we looking at? Everyone · Me · members,
// plus the "Manage family" modal for add/rename/remove.
export default function ProfileSwitcher() {
  const { profiles, active, setActive, reload, activeLabel } = useProfile();
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (v) => {
    setOpen(false);
    setActive(v);
  };

  const Row = ({ value, label, sub }) => (
    <button
      onClick={() => pick(value)}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition ${
        String(active) === String(value) ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-700">
        {value === 'all' ? <Users size={13} /> : initials(label) || '🙂'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{label}</span>
        {sub && <span className="block truncate text-xs text-slate-400">{sub}</span>}
      </span>
      {String(active) === String(value) && <Check size={15} className="shrink-0 text-gold-500" />}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Whose wealth to show"
        className="flex items-center gap-1.5 rounded-xl border border-[#e8e2d4] bg-white px-3 py-2 text-sm font-semibold text-brand-700 transition hover:border-gold-300 hover:bg-[#faf8f1]"
      >
        <Users size={15} />
        <span className="max-w-[90px] truncate">{activeLabel}</span>
        <ChevronDown size={15} className={`text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-[#e8e2d4] bg-white p-1.5 shadow-xl">
          <Row value="all" label="Everyone" sub="The whole family together" />
          <Row value="me" label="Me" sub="Just your own money" />
          {profiles.map((p) => (
            <Row key={p.id} value={p.id} label={p.name} sub={p.relation || 'Family member'} />
          ))}
          <button
            onClick={() => {
              setOpen(false);
              setManageOpen(true);
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-xl border-t border-slate-100 px-3 py-2 pt-2.5 text-left text-sm font-semibold text-brand-600 hover:bg-slate-50"
          >
            <Plus size={14} /> Manage family…
          </button>
        </div>
      )}

      <ManageFamily open={manageOpen} onClose={() => setManageOpen(false)} profiles={profiles} onChanged={reload} />
    </div>
  );
}

function ManageFamily({ open, onClose, profiles, onChanged }) {
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [editing, setEditing] = useState(null); // profile being renamed
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = useConfirm();

  useEffect(() => {
    if (!open) return;
    setName('');
    setRelation('');
    setEditing(null);
    setError('');
  }, [open]);

  async function save(e) {
    e?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      if (editing) await api(`/profiles/${editing.id}`, { method: 'PATCH', body: { name, relation } });
      else await api('/profiles', { method: 'POST', body: { name, relation } });
      setName('');
      setRelation('');
      setEditing(null);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p) {
    const sure = await confirm({
      title: `Remove ${p.name}?`,
      message: 'Their holdings, accounts and assets are kept — everything moves to "Me".',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!sure) return;
    try {
      await api(`/profiles/${p.id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Family members">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Track a spouse&apos;s or parent&apos;s wealth under your login. Pick a member from the
          header to see (and add to) just their money.
        </p>
        <ErrorBanner message={error} />

        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[140px] flex-1">
            <span className="label">{editing ? `Rename ${editing.name}` : 'Name'}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Asha" />
          </div>
          <div className="w-36">
            <span className="label">Relation</span>
            <input className="input" value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="Spouse" />
          </div>
          <button className="btn-primary" disabled={busy || !name.trim()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {editing ? 'Save' : 'Add'}
          </button>
          {editing && (
            <button type="button" className="btn-ghost" onClick={() => { setEditing(null); setName(''); setRelation(''); }}>
              Cancel
            </button>
          )}
        </form>

        {profiles.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
            No members yet — add your first above.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {profiles.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                  {initials(p.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {p.name} {p.relation && <span className="font-normal text-slate-400">· {p.relation}</span>}
                  </p>
                  <p className="text-xs text-slate-400">
                    {p.counts ? `${p.counts.holdings} holdings · ${p.counts.accounts} accounts · ${p.counts.assets} assets` : ''}
                  </p>
                </div>
                <button
                  onClick={() => { setEditing(p); setName(p.name); setRelation(p.relation || ''); }}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <Pencil size={14} />
                </button>
                <button onClick={() => remove(p)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
