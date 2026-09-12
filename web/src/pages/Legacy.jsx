import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Send,
  HeartHandshake,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { api, apiUrl, getToken } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { dateLabel, money } from '../lib/format.js';
import { ErrorBanner, Field, Spinner } from '../components/ui.jsx';
import { cardRise, pageVisible } from '../lib/motion.js';

/* Legacy — make sure your family finds everything.

   Three things on one page, in the order they matter:
     1. The switch: who is told, and after how long a silence.
     2. The nominee audit: which accounts have a nominee, which don't, and
        which we simply don't know about yet.
     3. The Money Map: the one document a family actually needs.

   The same page, reached as /legacy/view/:userId, is the CONTACT's side: the
   map of someone who named you, readable only once their switch has fired. */

const THRESHOLDS = [
  { days: 30, label: '30 days' },
  { days: 60, label: '60 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
];

// The map is HTML behind the API's auth header, so a plain <a href> can't open
// it. Fetch it with the token and hand the browser a blob URL instead.
async function openPrintable(path) {
  const res = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Could not open the map (${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* -------------------------------- the switch ------------------------------ */
function SwitchCard({ settings, onSaved }) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [contact, setContact] = useState(settings.contact?.user_id ?? '');
  const [days, setDays] = useState(settings.inactivity_days);
  const [note, setNote] = useState(settings.note || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // The invite-from-here flow, so an empty dropdown is a step, not a dead end.
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');
  const [inviteErr, setInviteErr] = useState('');

  // Re-sync a field only when ITS server value changed. Settings also reload
  // after an invite is sent or accepted — nothing about the switch changed on
  // the server then, and wiping a half-filled form (the not-yet-saved "on"
  // checkbox included) would hide the very panel the user is working in.
  const prevRef = useRef(settings);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = settings;
    if (prev === settings) return;
    if (settings.enabled !== prev.enabled) setEnabled(settings.enabled);
    if (String(settings.contact?.user_id ?? '') !== String(prev.contact?.user_id ?? '')) {
      setContact(settings.contact?.user_id ?? '');
    }
    if (settings.inactivity_days !== prev.inactivity_days) setDays(settings.inactivity_days);
    if ((settings.note || '') !== (prev.note || '')) setNote(settings.note || '');
  }, [settings]);

  async function sendInvite() {
    setInviteBusy(true);
    setInviteErr('');
    setInviteMsg('');
    try {
      const d = await api('/family/invite', { method: 'POST', body: { email: inviteEmail.trim() } });
      setInviteMsg(
        d.account_exists
          ? `Invite sent. ${inviteEmail.trim()} already has a Sampada account — they'll see it under Manage family, and the moment they accept you can pick them above.`
          : `Invite sent to ${inviteEmail.trim()}. They'll need to create a free account with that email and accept — then you can pick them above.`
      );
      setInviteEmail('');
      onSaved();
    } catch (err) {
      setInviteErr(err.message);
    } finally {
      setInviteBusy(false);
    }
  }

  async function acceptInvite(id) {
    setInviteBusy(true);
    setInviteErr('');
    try {
      await api(`/family/${id}/accept`, { method: 'POST' });
      setInviteMsg('Linked. You can now pick them above — and they can name you too.');
      onSaved();
    } catch (err) {
      setInviteErr(err.message);
    } finally {
      setInviteBusy(false);
    }
  }

  const dirty =
    enabled !== settings.enabled ||
    String(contact) !== String(settings.contact?.user_id ?? '') ||
    Number(days) !== Number(settings.inactivity_days) ||
    note !== (settings.note || '');

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/legacy/settings', {
        method: 'PUT',
        body: { enabled, contact_user_id: contact ? Number(contact) : null, inactivity_days: Number(days), note },
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const armed = settings.enabled && settings.contact && !settings.contact_unlinked;
  const state = !armed
    ? null
    : settings.released_at
      ? { tone: 'rose', icon: AlertTriangle, text: `Your Money Map is OPEN to ${settings.contact.name} — it opened ${dateLabel(settings.released_at.slice(0, 10))}. Signing in has already closed it if you're reading this on the site; save any change below to be sure.` }
      : settings.warned_at
        ? { tone: 'amber', icon: AlertTriangle, text: `A warning went out ${dateLabel(settings.warned_at.slice(0, 10))}. Any sign-in resets it — this one counts.` }
        : { tone: 'emerald', icon: ShieldCheck, text: `Armed. Last seen today; ${settings.contact.name} is told only after ${settings.inactivity_days} days of silence, and you'd be warned ${settings.warn_lead_days} days before that.` };

  return (
    <motion.form
      onSubmit={save}
      variants={cardRise}
      initial={pageVisible() ? 'hidden' : false}
      animate="show"
      className="card space-y-5 p-6"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <HeartHandshake size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold text-slate-900">If you go quiet, who should know?</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            Name one linked family member. If you stop signing in for the period you choose, Sampada warns
            you first — and if you still don&apos;t, shows them your Money Map: every account, holding and
            asset, where it&apos;s held, and who the nominee is. Read-only, and it closes again the moment you
            sign in.
          </p>
        </div>
      </div>

      {state && (
        <p
          className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${
            state.tone === 'emerald'
              ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
              : state.tone === 'amber'
                ? 'bg-amber-500/10 text-amber-800 dark:text-amber-200'
                : 'bg-rose-500/10 text-rose-800 dark:text-rose-200'
          }`}
        >
          <state.icon size={16} className="mt-0.5 shrink-0" />
          <span>{state.text}</span>
        </p>
      )}
      {settings.contact_unlinked && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          Your legacy contact is no longer linked to your account, so the switch has no one to tell. Pick
          someone else below, or re-link them from the family menu.
        </p>
      )}

      <label className="flex cursor-pointer items-center gap-3">
        <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span className="text-sm font-medium text-slate-800">Turn the legacy switch on</span>
      </label>

      <div className={`grid gap-4 sm:grid-cols-2 ${enabled ? '' : 'opacity-50'}`}>
        <Field
          label="Who to tell"
          hint={
            settings.members.length
              ? 'Only linked family members can be named — the link is their consent.'
              : 'No linked accounts yet — send an invite below and they appear here the moment they accept.'
          }
        >
          <select className="input" value={contact} onChange={(e) => setContact(e.target.value)} disabled={!enabled || !settings.members.length}>
            <option value="">Choose…</option>
            {settings.members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name} · {m.email}
              </option>
            ))}
          </select>
        </Field>
        <Field label="After how long a silence" hint="You're warned a week before (less for short periods). Any sign-in resets the clock.">
          <select className="input" value={days} onChange={(e) => setDays(e.target.value)} disabled={!enabled}>
            {THRESHOLDS.map((t) => (
              <option key={t.days} value={t.days}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* From "the dropdown is empty" to a nameable contact without leaving the
          page: accept an invite that's waiting on you, see the ones you've sent,
          send a new one. A name-only profile is the thing people expect to pick
          here, so the difference is spelled out rather than implied. */}
      {enabled && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-[#223250]">
          {settings.members.length === 0 && (
            <p className="text-sm leading-relaxed text-slate-600">
              {settings.profile_count > 0
                ? `The ${settings.profile_count === 1 ? 'person' : `${settings.profile_count} people`} in Manage family ${settings.profile_count === 1 ? 'is a name-only profile' : 'are name-only profiles'} — profiles have no login or email of their own, so there's no one for Sampada to warn or show the map to. Naming someone needs a linked account: invite them to their own free login here.`
                : 'Naming someone needs a linked account — a real Sampada login that accepted a link to yours. Invite a family member here; it takes them a minute.'}
            </p>
          )}

          {settings.received_invites?.map((inv) => (
            <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm dark:bg-[#16233c]">
              <span className="text-slate-700">
                <b>{inv.inviter_name}</b> has already invited you to link accounts.
              </span>
              <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={inviteBusy} onClick={() => acceptInvite(inv.id)}>
                Accept &amp; link
              </button>
            </div>
          ))}

          {settings.pending_invites?.map((inv) => (
            <p key={inv.id} className="flex items-center gap-2 text-sm text-slate-500">
              <Send size={14} className="shrink-0 text-gold-600" />
              <span>
                <b className="text-slate-700">{inv.email}</b> — invited, waiting for them to accept. They appear in the list above the moment they do.
              </span>
            </p>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input min-w-0 flex-1"
              type="email"
              placeholder="family-member@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (inviteEmail.trim()) sendInvite();
                }
              }}
            />
            <button type="button" className="btn-ghost" disabled={inviteBusy || !inviteEmail.trim()} onClick={sendInvite}>
              <Send size={15} /> {inviteBusy ? 'Sending…' : 'Invite to link'}
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Linking is mutual and view-only — you each keep your own login, and either side can unlink at any time.
          </p>
          {inviteMsg && <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{inviteMsg}</p>}
          <ErrorBanner message={inviteErr} />
        </div>
      )}

      <Field label="A note for them (optional)" hint="Shown at the top of the Money Map. Where the papers are, who to call, anything they'd need.">
        <textarea
          className="input min-h-[88px]"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          placeholder="Meera — everything is listed here. The flat papers are in the steel cupboard, second shelf."
          disabled={!enabled}
        />
      </Field>

      <ErrorBanner message={error} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-400">
          {settings.last_active_at ? `Last activity ${dateLabel(settings.last_active_at.slice(0, 10))}` : ''}
        </p>
        <button className="btn-primary" disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </motion.form>
  );
}

/* ------------------------------ nominee audit ----------------------------- */
const STATUS_META = {
  registered: { label: 'Registered', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  none: { label: 'No nominee', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  unknown: { label: 'Not recorded', cls: 'bg-slate-500/10 text-slate-500' },
};

function NomineeRow({ item, onChange }) {
  const [name, setName] = useState(item.nominee_name || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(item.nominee_name || ''), [item.nominee_name]);

  const set = async (status, nm) => {
    setBusy(true);
    try {
      await onChange({ kind: item.kind, id: item.id, status, name: nm });
    } finally {
      setBusy(false);
    }
  };
  const meta = STATUS_META[item.status];

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{item.name}</p>
        <p className="text-[11px] uppercase tracking-wide text-slate-400">{item.sub}</p>
      </div>
      <span className={`chip text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
      <div className="flex items-center gap-1.5">
        {item.status === 'registered' ? (
          <input
            className="input w-36 py-1 text-xs"
            value={name}
            placeholder="Nominee's name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== (item.nominee_name || '') && set('registered', name)}
            disabled={busy}
          />
        ) : (
          <button type="button" className="btn-ghost px-2.5 py-1 text-xs" disabled={busy} onClick={() => set('registered', name)}>
            Mark registered
          </button>
        )}
        {item.status !== 'none' && (
          <button type="button" className="btn-ghost px-2.5 py-1 text-xs" disabled={busy} onClick={() => set('none', '')}>
            No nominee
          </button>
        )}
      </div>
    </li>
  );
}

function AuditCard({ audit, onChange }) {
  const c = audit.counts;
  const gaps = c.none + c.unknown;
  const groups = useMemo(
    () => [
      { key: 'none', title: 'No nominee — worth fixing', items: audit.items.filter((i) => i.status === 'none') },
      { key: 'unknown', title: 'Not recorded yet', items: audit.items.filter((i) => i.status === 'unknown') },
      { key: 'registered', title: 'Registered', items: audit.items.filter((i) => i.status === 'registered') },
    ],
    [audit]
  );

  return (
    <motion.div variants={cardRise} initial={pageVisible() ? 'hidden' : false} animate="show" className="card p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Users size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold text-slate-900">Nominees</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            {c.total === 0
              ? 'Add accounts, holdings or assets and they appear here.'
              : gaps === 0
                ? `All ${c.total} of your accounts, holdings and assets have a registered nominee. That is rarer than it should be.`
                : `${c.registered} of ${c.total} have a registered nominee. The other ${gaps} ${gaps === 1 ? 'is' : 'are'} what take${gaps === 1 ? 's' : ''} a family longest to claim — a nominee turns months of paperwork into a form.`}
          </p>
          <p className="mt-1.5 text-xs text-slate-400">
            Sampada can&apos;t read nominee status from statements yet, so this is yours to record — once, then it&apos;s kept.
          </p>
        </div>
      </div>

      {c.total > 0 && (
        <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-[#1c2c49]" aria-hidden="true">
          <span className="h-full bg-emerald-500" style={{ width: `${(c.registered / c.total) * 100}%` }} />
          <span className="h-full bg-amber-400" style={{ width: `${(c.none / c.total) * 100}%` }} />
        </div>
      )}

      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <div key={g.key} className="mt-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {g.title} · {g.items.length}
            </p>
            <ul className="mt-1 divide-y divide-slate-100 dark:divide-[#1c2c49]">
              {g.items.map((i) => (
                <NomineeRow key={`${i.kind}-${i.id}`} item={i} onChange={onChange} />
              ))}
            </ul>
          </div>
        ))}
    </motion.div>
  );
}

/* --------------------------------- the map -------------------------------- */
function MapCard({ path, title, blurb, cta }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <motion.div variants={cardRise} initial={pageVisible() ? 'hidden' : false} animate="show" className="card flex flex-wrap items-center justify-between gap-4 p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-100 text-gold-700">
          <FileText size={20} />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">{title}</h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-500">{blurb}</p>
          <ErrorBanner message={error} />
        </div>
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await openPrintable(path);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ExternalLink size={16} /> {busy ? 'Opening…' : cta}
      </button>
    </motion.div>
  );
}

/* ------------------------------- contact side ----------------------------- */
function ContactView({ userId }) {
  const { data, loading, error, status } = useApi(`/legacy/map/${userId}`);
  if (loading) return <Spinner label="Opening the Money Map…" />;
  if (status === 403) {
    return (
      <div className="card p-8 text-center">
        <ShieldCheck size={28} className="mx-auto text-brand-600" />
        <h2 className="font-display mt-3 text-xl font-bold text-slate-900">Not open yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">{error}</p>
      </div>
    );
  }
  if (error || !data) return <ErrorBanner message={error || 'Not found'} />;
  const m = data.map;
  const base = m.owner.base_currency;
  const gaps = [...m.cash, ...m.holdings, ...m.assets].filter((x) => x.nominee.status !== 'registered').length;
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-600">Money Map · shared with you</p>
        <h1 className="font-display mt-1 text-2xl font-bold tracking-tight text-slate-900">Everything {m.owner.name} owns, and where it is</h1>
        <p className="mt-1 text-sm text-slate-500">
          Open to you because {m.owner.name} hasn&apos;t signed in for a while and asked that you be shown this if that happened. It closes again if they do.
        </p>
        {m.note && <p className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700 dark:bg-[#16233c]">{m.note}</p>}
        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ['Net worth', m.net_worth],
            ['Investments', m.totals.investments],
            ['Cash & bank', m.totals.cash],
            ['Assets', m.totals.assets],
          ].map(([l, v]) => (
            <div key={l}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{l}</dt>
              <dd className="num text-lg font-bold text-slate-900">{money(v, base)}</dd>
            </div>
          ))}
        </dl>
        {gaps > 0 && (
          <p className="mt-4 text-sm text-amber-700 dark:text-amber-300">
            {gaps} item{gaps === 1 ? '' : 's'} {gaps === 1 ? 'has' : 'have'} no registered nominee recorded — those take longest to claim.
          </p>
        )}
      </div>
      <MapCard
        path={`/legacy/map/${userId}/print`}
        title="The full document"
        blurb="Every account, holding and asset with its nominee, plus how to claim each kind. Save it as a PDF."
        cta="Open the Money Map"
      />
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */
export default function Legacy() {
  const { userId } = useParams();
  const { user } = useAuth();
  const isContactView = !!userId && Number(userId) !== user.id;

  const settings = useApi('/legacy/settings', { enabled: !isContactView });
  const audit = useApi('/legacy/nominees', { enabled: !isContactView });

  if (isContactView) return <ContactView userId={userId} />;
  if (settings.loading || audit.loading) return <Spinner label="Loading…" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900">Legacy</h1>
        <p className="text-sm text-slate-500">
          Around a lakh crore rupees sits unclaimed in India because families never knew an account existed.
          This page makes sure yours does.
        </p>
      </div>

      <ErrorBanner message={settings.error || audit.error} />

      {settings.data && <SwitchCard settings={settings.data} onSaved={settings.reload} />}

      {settings.data?.named_by?.length > 0 && (
        <div className="card p-6">
          <h2 className="font-display text-lg font-bold text-slate-900">People who named you</h2>
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-[#1c2c49]">
            {settings.data.named_by.map((o) => (
              <li key={o.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{o.name}</p>
                  <p className="text-xs text-slate-400">Opens to you after {o.inactivity_days} days of silence</p>
                </div>
                {o.released ? (
                  <Link to={`/legacy/view/${o.user_id}`} className="btn-primary px-3 py-1.5 text-xs">
                    Open their Money Map
                  </Link>
                ) : (
                  <span className="chip bg-emerald-500/10 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 size={12} className="mr-1" /> Active — nothing to do
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {audit.data && <AuditCard audit={audit.data} onChange={async (body) => { await api('/legacy/nominees', { method: 'POST', body }); audit.reload(); }} />}

      <MapCard
        path="/legacy/map/print"
        title="Your Money Map"
        blurb="One document with every account, holding and asset, where it's held, the nominee, and how to claim each. This is what your contact would see — see it yourself first, and keep a printed copy somewhere they'd look."
        cta="Preview & print"
      />
    </div>
  );
}
