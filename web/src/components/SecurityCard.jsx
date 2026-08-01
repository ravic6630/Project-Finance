import { useCallback, useEffect, useState } from 'react';
import { Laptop, Loader2, LogOut, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { api } from '../lib/api.js';
import { relativeTime } from '../lib/format.js';
import { ErrorBanner, Field, Modal } from './ui.jsx';
import { useConfirm } from '../lib/confirm.jsx';

// Rough-but-friendly device line from the user agent.
function deviceLabel(ua = '') {
  const os = /iPhone|iPad/.test(ua)
    ? 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Safari\//.test(ua) && !/Chrome/.test(ua)
        ? 'Safari'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : 'Browser';
  return `${browser} on ${os}`;
}

const isMobileUa = (ua = '') => /iPhone|iPad|Android|Mobile/.test(ua);

export default function SecurityCard({ user, onUserChanged }) {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 2FA setup modal state
  const [setupOpen, setSetupOpen] = useState(false);
  const [setup, setSetup] = useState(null); // { qr, secret }
  const [codeIn, setCodeIn] = useState('');
  // disable modal
  const [disableOpen, setDisableOpen] = useState(false);
  const confirm = useConfirm();

  const loadSessions = useCallback(() => {
    api('/auth/sessions')
      .then((d) => setSessions(d.sessions))
      .catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  async function startSetup() {
    setError('');
    setCodeIn('');
    setSetup(null);
    setSetupOpen(true);
    try {
      setSetup(await api('/auth/2fa/setup', { method: 'POST', body: {} }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirmEnable(e) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/2fa/enable', { method: 'POST', body: { code: codeIn } });
      setSetupOpen(false);
      onUserChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable(e) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/2fa/disable', { method: 'POST', body: { code: codeIn } });
      setDisableOpen(false);
      setCodeIn('');
      onUserChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(sess) {
    if (sess.current) {
      const sure = await confirm({
        title: 'Sign out this device?',
        message: 'This is the device you are using right now — you will be signed out immediately.',
        confirmLabel: 'Sign out',
        danger: true,
      });
      if (!sure) return;
    }
    try {
      await api(`/auth/sessions/${sess.id}`, { method: 'DELETE' });
      if (sess.current) window.location.reload();
      else loadSessions();
    } catch (err) {
      setError(err.message);
    }
  }

  async function revokeOthers() {
    try {
      const d = await api('/auth/sessions/revoke-others', { method: 'POST', body: {} });
      setError('');
      loadSessions();
      return d;
    } catch (err) {
      setError(err.message);
    }
  }

  const twofa = !!user.totp_enabled;

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              twofa ? 'bg-emerald-50 text-emerald-700' : 'bg-brand-50 text-brand-700'
            }`}
          >
            {twofa ? <ShieldCheck size={20} /> : <ShieldOff size={20} />}
          </div>
          <div>
            <h3 className="font-bold text-slate-900">Security</h3>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              {twofa
                ? 'Two-factor authentication is on — sign-ins need your password and a 6-digit code.'
                : 'Add two-factor authentication: your password plus a 6-digit code from an authenticator app.'}
            </p>
          </div>
        </div>
        {twofa ? (
          <button className="btn-ghost shrink-0" onClick={() => { setCodeIn(''); setError(''); setDisableOpen(true); }}>
            Turn off 2FA
          </button>
        ) : (
          <button className="btn-primary shrink-0" onClick={startSetup}>
            <ShieldCheck size={16} /> Enable 2FA
          </button>
        )}
      </div>

      <ErrorBanner message={!setupOpen && !disableOpen ? error : ''} />

      {/* devices */}
      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Signed-in devices</p>
          {sessions && sessions.length > 1 && (
            <button className="text-xs font-semibold text-rose-600 hover:underline" onClick={revokeOthers}>
              Sign out all other devices
            </button>
          )}
        </div>
        {sessions === null ? (
          <p className="py-2 text-sm text-slate-400">Loading…</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sessions.map((sess) => (
              <li key={sess.id} className="flex items-center gap-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  {isMobileUa(sess.ua) ? <Smartphone size={15} /> : <Laptop size={15} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {deviceLabel(sess.ua)}
                    {sess.current && (
                      <span className="chip ml-2 bg-emerald-100 text-emerald-700">this device</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {sess.ip ? `${sess.ip} · ` : ''}active {relativeTime(sess.last_seen || sess.created_at)}
                  </p>
                </div>
                <button
                  onClick={() => revoke(sess)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-400 transition hover:bg-rose-100 hover:text-rose-600"
                >
                  <LogOut size={13} /> Sign out
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* setup modal */}
      <Modal open={setupOpen} onClose={() => setSetupOpen(false)} title="Enable two-factor authentication">
        <form onSubmit={confirmEnable} className="space-y-4">
          <ErrorBanner message={error} />
          {!setup ? (
            <p className="py-6 text-center text-sm text-slate-400">Preparing your secret…</p>
          ) : (
            <>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
                <li>Open Google Authenticator, Authy or 1Password.</li>
                <li>Scan this QR code (or type the key below).</li>
                <li>Enter the 6-digit code it shows to confirm.</li>
              </ol>
              <div className="flex flex-col items-center gap-2">
                <img src={setup.qr} alt="2FA QR code" className="h-44 w-44 rounded-xl border border-slate-200 bg-white p-1" />
                <code className="select-all rounded-lg bg-slate-100 px-2.5 py-1 text-xs tracking-wider text-slate-600">
                  {setup.secret}
                </code>
              </div>
              <Field label="6-digit code">
                <input
                  className="input text-center text-xl tracking-[0.4em]"
                  inputMode="numeric"
                  maxLength={6}
                  value={codeIn}
                  onChange={(e) => setCodeIn(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  required
                />
              </Field>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => setSetupOpen(false)}>
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy || codeIn.length !== 6}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                  Turn on
                </button>
              </div>
            </>
          )}
        </form>
      </Modal>

      {/* disable modal */}
      <Modal open={disableOpen} onClose={() => setDisableOpen(false)} title="Turn off two-factor?">
        <form onSubmit={confirmDisable} className="space-y-4">
          <ErrorBanner message={error} />
          <p className="text-sm text-slate-500">
            Enter a current code from your authenticator app to confirm. Sign-ins will go back to
            password only.
          </p>
          <Field label="6-digit code">
            <input
              className="input text-center text-xl tracking-[0.4em]"
              inputMode="numeric"
              maxLength={6}
              value={codeIn}
              onChange={(e) => setCodeIn(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              required
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setDisableOpen(false)}>
              Cancel
            </button>
            <button className="btn-danger" disabled={busy || codeIn.length !== 6}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldOff size={16} />}
              Turn off 2FA
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
