import { useState } from 'react';
import { Check, Eye, Link2, Loader2, Users, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useProfile } from '../lib/ProfileContext.jsx';

// Small family-linking UI bits shared across pages.

// Dashboard banner: someone invited me — accept or decline right here.
export function FamilyInviteBanner() {
  const { family, reload } = useProfile();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const invites = family.received_pending || [];
  if (!invites.length) return null;

  const act = async (id, verb) => {
    setBusyId(id);
    setError('');
    try {
      await api(`/family/${id}/${verb}`, { method: 'POST' });
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card border-gold-200 bg-gold-50/60 p-4">
      {invites.map((inv) => (
        <div key={inv.id} className="flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold-100 text-gold-700">
            <Users size={18} />
          </span>
          <p className="min-w-0 flex-1 text-sm text-slate-700">
            <span className="font-semibold">{inv.inviter_name}</span>{' '}
            <span className="text-slate-500">({inv.inviter_email})</span> invited you to share family
            net worth — mutual and view-only, unlink anytime.
          </p>
          <div className="flex shrink-0 gap-2">
            <button className="btn-primary" disabled={busyId === inv.id} onClick={() => act(inv.id, 'accept')}>
              {busyId === inv.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Accept
            </button>
            <button className="btn-ghost" disabled={busyId === inv.id} onClick={() => act(inv.id, 'decline')}>
              <X size={15} /> Decline
            </button>
          </div>
        </div>
      ))}
      {error && <p className="mt-2 text-sm font-medium text-rose-600">{error}</p>}
    </div>
  );
}

// Dashboard context line: whose money is on screen right now.
export function FamilyScopeNote({ data, active }) {
  if (data?.family?.viewing) {
    return (
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Eye size={13} className="text-gold-600" />
        Viewing <span className="font-semibold text-slate-700">{data.family.viewing.name}</span>&apos;s
        account — view-only, converted to your base currency.
      </p>
    );
  }
  if (active === 'all' && data?.family?.included?.length) {
    return (
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Link2 size={13} className="text-gold-600" />
        Includes linked {data.family.included.length === 1 ? 'account' : 'accounts'}:{' '}
        <span className="font-semibold text-slate-700">
          {data.family.included.map((m) => m.name).join(', ')}
        </span>
      </p>
    );
  }
  return null;
}

// Management pages (Investments / Cash / Assets) always show YOUR account —
// say so when a linked member is picked in the header.
export function LinkedScopeNote() {
  const { activeIsLinked, activeMember } = useProfile();
  if (!activeIsLinked) return null;
  return (
    <p className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-500">
      <Eye size={13} className="shrink-0 text-gold-600" />
      Showing your own account — {activeMember?.name || 'a linked member'}&apos;s money is view-only,
      on their Dashboard view.
    </p>
  );
}
