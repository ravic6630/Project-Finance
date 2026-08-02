import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Link2, Loader2, Mail, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
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
  const { profiles, family, active, setActive, reload, activeLabel } = useProfile();
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
        className="relative flex items-center gap-1.5 rounded-xl border border-[#e8e2d4] bg-white px-3 py-2 text-sm font-semibold text-brand-700 transition hover:border-gold-300 hover:bg-[#faf8f1]"
      >
        <Users size={15} />
        <span className="max-w-[90px] truncate">{activeLabel}</span>
        <ChevronDown size={15} className={`text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
        {family.received_pending.length > 0 && (
          <span
            title="Family invite waiting"
            className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-gold-500 ring-2 ring-white"
          />
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-[#e8e2d4] bg-white p-1.5 shadow-xl">
          <Row value="all" label="Everyone" sub="The whole family together" />
          <Row value="me" label="Me" sub="Just your own money" />
          {profiles.map((p) => (
            <Row key={p.id} value={p.id} label={p.name} sub={p.relation || 'Family member'} />
          ))}
          {family.members.length > 0 && (
            <p className="mt-1 border-t border-slate-100 px-3 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Linked accounts
            </p>
          )}
          {family.members.map((m) => (
            <Row key={`u:${m.user_id}`} value={`u:${m.user_id}`} label={m.name} sub="Their own login · view-only" />
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
  const { family } = useProfile();
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [editing, setEditing] = useState(null); // profile being renamed
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invBusy, setInvBusy] = useState(false);
  const [invError, setInvError] = useState('');
  const [invNote, setInvNote] = useState('');
  const confirm = useConfirm();

  useEffect(() => {
    if (!open) return;
    setName('');
    setRelation('');
    setEditing(null);
    setError('');
    setInvEmail('');
    setInvError('');
    setInvNote('');
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

  async function invite(e) {
    e?.preventDefault();
    const email = invEmail.trim();
    if (!email) return;
    setInvBusy(true);
    setInvError('');
    setInvNote('');
    try {
      const r = await api('/family/invite', { method: 'POST', body: { email } });
      setInvEmail('');
      setInvNote(
        r.account_exists
          ? 'Invite sent — they can accept it from Manage family on their account.'
          : "Invite saved — it'll be waiting once they create a Sampada account with that email."
      );
      onChanged();
    } catch (err) {
      setInvError(err.message);
    } finally {
      setInvBusy(false);
    }
  }

  async function respondInvite(id, verb) {
    setInvError('');
    try {
      await api(`/family/${id}/${verb}`, { method: 'POST' });
      onChanged();
    } catch (err) {
      setInvError(err.message);
    }
  }

  async function unlink(l, isPending) {
    if (!isPending) {
      const sure = await confirm({
        title: `Unlink ${l.name}?`,
        message: 'You stop seeing each other’s money immediately. Nothing is deleted on either side.',
        confirmLabel: 'Unlink',
        danger: true,
      });
      if (!sure) return;
    }
    try {
      await api(`/family/${isPending ? l.id : l.link_id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      setInvError(err.message);
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

        {/* ------------------- Linked real accounts ------------------- */}
        <div className="border-t border-slate-100 pt-4">
          <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <Link2 size={14} className="text-gold-600" /> Linked accounts
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            Invite someone with their own Sampada login — a spouse, a parent who manages their own
            money. Once they accept, you <b>both</b> see the household total under “Everyone”.
            View-only, and either side can unlink anytime.
          </p>

          {invError && <p className="mt-2 text-sm font-medium text-rose-600">{invError}</p>}
          {invNote && <p className="mt-2 text-sm font-medium text-emerald-600">{invNote}</p>}

          {family.received_pending.length > 0 && (
            <ul className="mt-3 space-y-2">
              {family.received_pending.map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl bg-gold-50 px-3 py-2 ring-1 ring-gold-200"
                >
                  <p className="min-w-0 flex-1 text-sm text-slate-700">
                    <span className="font-semibold">{inv.inviter_name}</span>{' '}
                    <span className="text-slate-500">({inv.inviter_email})</span> invited you
                  </p>
                  <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => respondInvite(inv.id, 'accept')}>
                    <Check size={13} /> Accept
                  </button>
                  <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => respondInvite(inv.id, 'decline')}>
                    <X size={13} /> Decline
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={invite} className="mt-3 flex items-end gap-2">
            <div className="min-w-[160px] flex-1">
              <span className="label">Their email</span>
              <input
                className="input"
                type="email"
                value={invEmail}
                onChange={(e) => setInvEmail(e.target.value)}
                placeholder="spouse@example.com"
              />
            </div>
            <button className="btn-primary" disabled={invBusy || !invEmail.trim()}>
              {invBusy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />} Invite
            </button>
          </form>

          {(family.members.length > 0 || family.sent_pending.length > 0) && (
            <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {family.members.map((m) => (
                <li key={m.link_id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold-100 text-xs font-bold text-gold-700">
                    {initials(m.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{m.name}</p>
                    <p className="truncate text-xs text-slate-400">{m.email} · linked</p>
                  </div>
                  <button
                    onClick={() => unlink(m, false)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600"
                    title="Unlink"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
              {family.sent_pending.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                    <Mail size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-700">{inv.email}</p>
                    <p className="text-xs text-gold-700">Invited — waiting for them to accept</p>
                  </div>
                  <button
                    onClick={() => unlink(inv, true)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600"
                    title="Cancel invite"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {family.members.length > 0 && (
            <p className="mt-2 text-[11px] text-slate-400">
              Tip: if you also track a linked person as a plain member above, remove that copy so
              “Everyone” doesn&apos;t count them twice.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
