import { useCallback, useEffect, useState } from 'react';
import { Crown, KeyRound, Shield, Trash2, Users as UsersIcon } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { dateLabel } from '../lib/format.js';
import { ErrorBanner, Spinner } from '../components/ui.jsx';

function Stat({ label, value }) {
  return (
    <div className="card p-5">
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-slate-900">{value}</p>
    </div>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(0);

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await api('/admin/overview'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function togglePremium(u) {
    setBusy(u.id);
    try {
      await api(`/admin/users/${u.id}/premium`, { method: 'POST', body: { grant: !u.premium } });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(0);
    }
  }

  async function resetPw(u) {
    const custom = window.prompt(
      `Reset password for ${u.email}.\nType a new password, or leave blank to auto-generate:`,
      ''
    );
    if (custom === null) return; // cancelled
    setBusy(u.id);
    try {
      const r = await api(`/admin/users/${u.id}/reset-password`, {
        method: 'POST',
        body: { password: custom || undefined },
      });
      window.alert(
        `New password for ${r.email}:\n\n${r.password}\n\nShare this with them — they can change it after signing in.`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(0);
    }
  }

  async function remove(u) {
    if (!window.confirm(`Delete ${u.email}? This permanently removes their account and ALL their data.`)) return;
    setBusy(u.id);
    try {
      await api(`/admin/users/${u.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(0);
    }
  }

  if (loading) return <Spinner label="Loading users…" />;
  if (error && !data) return <ErrorBanner message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total users" value={data.counts.users} />
        <Stat label="Premium" value={data.counts.premium} />
        <Stat label="Total holdings" value={data.counts.holdings} />
      </div>

      <ErrorBanner message={error} />

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 font-bold text-slate-900">
          <UsersIcon size={18} className="text-brand-600" /> Users
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pl-4 text-left font-semibold">User</th>
                <th className="px-2 text-left font-semibold">Plan</th>
                <th className="px-2 text-right font-semibold">Holdings</th>
                <th className="px-2 text-right font-semibold">Accounts</th>
                <th className="px-2 text-right font-semibold">Txns</th>
                <th className="px-2 text-left font-semibold">Joined</th>
                <th className="px-2 pr-4 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="py-3 pl-4 pr-2">
                    <p className="font-semibold text-slate-900">
                      {u.name || '—'}
                      {u.role === 'admin' && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-white">
                          <Shield size={10} /> ADMIN
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">{u.email}</p>
                  </td>
                  <td className="px-2">
                    {u.premium ? (
                      <span className="chip bg-amber-100 text-amber-700">
                        <Crown size={11} className="mr-1" /> {u.plan}
                      </span>
                    ) : (
                      <span className="chip bg-slate-100 text-slate-500">free</span>
                    )}
                  </td>
                  <td className="px-2 text-right tabular-nums text-slate-600">{u.holdings}</td>
                  <td className="px-2 text-right tabular-nums text-slate-600">{u.accounts}</td>
                  <td className="px-2 text-right tabular-nums text-slate-600">{u.transactions}</td>
                  <td className="px-2 text-xs text-slate-400">{dateLabel(u.created_at)}</td>
                  <td className="px-2 pr-4">
                    <div className="flex justify-end gap-2">
                      {u.role !== 'admin' && (
                        <button
                          onClick={() => togglePremium(u)}
                          disabled={busy === u.id}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                        >
                          {u.premium ? 'Revoke' : 'Grant'} premium
                        </button>
                      )}
                      <button
                        onClick={() => resetPw(u)}
                        disabled={busy === u.id}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                        title="Reset password"
                      >
                        <KeyRound size={15} />
                      </button>
                      {u.id !== user.id && (
                        <button
                          onClick={() => remove(u)}
                          disabled={busy === u.id}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600"
                          title="Delete account"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
