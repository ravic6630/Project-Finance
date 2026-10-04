import { useEffect, useRef, useState } from 'react';
import { Check, Copy, KeyRound, Shield, Sparkles } from 'lucide-react';
import { api } from '../lib/api.js';
import { ErrorBanner, Modal } from './ui.jsx';
import PasswordField from './PasswordField.jsx';

/* ============================================================================
   Admin: reset someone's password.

   This used to be a browser prompt() followed by an alert() — the one corner of
   the app still speaking in the browser's voice, and about the most sensitive
   thing an admin does. It is two steps, because they are two different moments:

     1. decide  — whose password, how the new one is made, and whether what is
                  already signed in should be ended;
     2. hand over — the new password, once, with a way to copy it.

   The password lives in this component's state only between the server's reply
   and the sheet closing. It is never logged, never put in a URL, and cleared
   the moment the sheet goes away.
   ========================================================================== */

const MIN = 6; // the floor sign-up and the emailed reset use

function Choice({ selected, onSelect, icon: Icon, title, children }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex items-start gap-3 rounded-2xl border p-3.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
        selected ? 'border-brand-500 bg-brand-50 shadow-sm' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <span
        className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl transition ${
          selected ? 'bg-brand-700 text-gold-300 ring-1 ring-gold-400/30' : 'bg-slate-100 text-slate-500'
        }`}
      >
        <Icon size={17} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{children}</span>
      </span>
    </button>
  );
}

// Keyed by person, and unmounted when there is nobody: every opening is a fresh
// sheet, and closing it throws the new password away with the rest of its state.
export default function ResetPasswordModal({ user, self = false, onClose }) {
  if (!user) return null;
  return <Sheet key={user.id} user={user} self={self} onClose={onClose} />;
}

function Sheet({ user, self, onClose }) {
  // Someone else's password is best generated and read out; your own you want
  // to pick, so that is where the sheet starts.
  const [mode, setMode] = useState(self ? 'custom' : 'generate'); // 'generate' | 'custom'
  const [password, setPassword] = useState('');
  const [signOut, setSignOut] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null); // the server's reply, once
  const [copied, setCopied] = useState(''); // '' | 'done' | 'failed'
  const shown = useRef(null); // the password as displayed, for a copy by hand
  const copyTimer = useRef(0);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  // Once the request is on its way the password IS changing. Closing then
  // (Escape, the X) would lose the only sight of the new one, leaving the
  // account with a password nobody knows — so the sheet stays until the reply.
  const close = () => {
    if (!busy) onClose();
  };

  const name = (user.name || '').trim() || user.email.split('@')[0];
  const tooShort = mode === 'custom' && password.length > 0 && password.length < MIN;

  async function submit(e) {
    e.preventDefault();
    if (mode === 'custom' && password.length < MIN) {
      setError(`Type a password of at least ${MIN} characters — or let one be generated.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api(`/admin/users/${user.id}/reset-password`, {
        method: 'POST',
        body: { password: mode === 'custom' ? password : undefined, sign_out: signOut },
      });
      setPassword('');
      setDone(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // A "Copied" that isn't true costs more here than anywhere else in the app:
  // the admin pastes whatever the clipboard held BEFORE into a message to the
  // user. So it only says so when the copy happened; when the browser refuses,
  // the password is selected instead, ready to be copied by hand.
  async function copy() {
    let copiedOk = false;
    try {
      await navigator.clipboard.writeText(done.password);
      copiedOk = true;
    } catch {
      const el = document.createElement('textarea');
      el.value = done.password;
      document.body.appendChild(el);
      el.select();
      try {
        copiedOk = document.execCommand('copy');
      } catch {
        copiedOk = false;
      }
      el.remove();
    }
    if (!copiedOk && shown.current) window.getSelection()?.selectAllChildren(shown.current);
    setCopied(copiedOk ? 'done' : 'failed');
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(''), copiedOk ? 2000 : 8000);
  }

  const who = (
    <div className="flex items-center gap-3 rounded-2xl border border-[#e8e2d4] bg-[#faf8f1] p-3.5">
      <span
        aria-hidden
        className="font-display flex h-11 w-11 flex-none items-center justify-center rounded-full bg-brand-700 text-lg font-bold text-gold-300 ring-1 ring-gold-400/30"
      >
        {name[0].toUpperCase()}
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-slate-900">
          <span className="truncate">{name}</span>
          {user.role === 'admin' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-white">
              <Shield size={10} aria-hidden /> ADMIN
            </span>
          )}
          {self && <span className="chip bg-gold-100 text-gold-700">Your account</span>}
        </p>
        <p className="truncate text-sm text-slate-500">{user.email}</p>
      </div>
    </div>
  );

  return (
    <Modal open onClose={close} title={done ? 'New password ready' : 'Reset password'}>
      {done ? (
        <div>
          {who}

          <div className="mt-5 rounded-2xl border border-gold-200 bg-gold-50 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-700">
              {done.generated ? 'Generated password' : 'New password'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {/* select-all: one click selects the whole thing for anyone who
                  would rather copy by hand than trust a button. */}
              <code
                ref={shown}
                className="num min-w-0 flex-1 select-all break-all text-2xl font-bold tracking-[0.06em] text-brand-900"
              >
                {done.password}
              </code>
              <button type="button" onClick={copy} className="btn-primary flex-none">
                {copied === 'done' ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                {copied === 'done' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p role="status" className={copied === 'failed' ? 'mt-2.5 text-xs leading-relaxed text-gold-700' : 'sr-only'}>
              {copied === 'done' && 'Password copied.'}
              {copied === 'failed' &&
                "This browser wouldn't allow the copy. The password is selected \u2014 copy it with \u2318C or Ctrl+C."}
            </p>
          </div>

          <ul className="mt-4 space-y-2 text-sm leading-relaxed text-slate-600">
            <li className="flex gap-2.5">
              <Check size={15} className="mt-0.5 flex-none text-emerald-600" aria-hidden />
              <span>
                {self ? 'Your' : 'Their'} old password has stopped working.
                {done.signed_out > 0
                  ? ` ${done.signed_out} ${done.signed_out === 1 ? 'device was' : 'devices were'} signed out${self ? ' — this one stays signed in' : ''}.`
                  : signOut
                    ? ` No ${self ? 'other ' : ''}devices were signed in.`
                    : ' Devices already signed in stay signed in.'}
              </span>
            </li>
            <li className="flex gap-2.5">
              <KeyRound size={15} className="mt-0.5 flex-none text-slate-400" aria-hidden />
              <span>
                This is the only time it&apos;s shown. Sampada keeps a scrambled form of it, so nobody — you included —
                can look it up later.
              </span>
            </li>
            {!self && (
              <li className="flex gap-2.5">
                <Sparkles size={15} className="mt-0.5 flex-none text-slate-400" aria-hidden />
                <span>
                  Pass it on privately. They can replace it with one of their own using &ldquo;Forgot password?&rdquo; on
                  the sign-in page.
                </span>
              </li>
            )}
          </ul>

          <div className="mt-6 flex justify-end">
            <button type="button" className="btn-ghost" onClick={close}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-5">
          {who}

          <div>
            <p className="label" id="reset-how">
              New password
            </p>
            <div role="radiogroup" aria-labelledby="reset-how" className="grid gap-2.5 sm:grid-cols-2">
              <Choice selected={mode === 'generate'} onSelect={() => setMode('generate')} icon={Sparkles} title="Generate one">
                Strong and random, in a form that&apos;s easy to read out.
              </Choice>
              <Choice selected={mode === 'custom'} onSelect={() => setMode('custom')} icon={KeyRound} title="Choose it myself">
                Type the password {self ? "you'll" : "they'll"} sign in with.
              </Choice>
            </div>
            {mode === 'custom' && (
              <div className="mt-3">
                <PasswordField
                  value={password}
                  onChange={(v) => {
                    setPassword(v);
                    setError('');
                  }}
                  autoComplete="new-password"
                  placeholder={`At least ${MIN} characters`}
                  autoFocus
                  hint={
                    tooShort
                      ? `${MIN - password.length} more character${MIN - password.length === 1 ? '' : 's'} needed.`
                      : 'Use the eye to check what you typed before saving.'
                  }
                />
              </div>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-3.5 transition hover:border-slate-300">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 flex-none accent-brand-600"
              checked={signOut}
              onChange={(e) => setSignOut(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-semibold text-slate-900">
                {self ? 'Sign out my other devices' : 'Sign them out of every device'}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                {self
                  ? 'Anywhere else you are signed in is logged out. This device stays signed in.'
                  : 'Anything still signed in is logged out. Leave this on if someone else may know the old password.'}
              </span>
            </span>
          </label>

          <ErrorBanner message={error} />

          {/* Stacked on a phone: beside two buttons the note would be squeezed
              into a column three words wide. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-400">The old password stops working straight away.</p>
            <div className="flex flex-none justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button className="btn-primary" disabled={busy || tooShort}>
                <KeyRound size={16} aria-hidden /> {busy ? 'Resetting…' : 'Reset password'}
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
