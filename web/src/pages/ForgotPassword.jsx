import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Sprout } from 'lucide-react';
import { api } from '../lib/api.js';
import { ErrorBanner } from '../components/ui.jsx';
import AuthAside from '../components/AuthAside.jsx';
import PasswordField from '../components/PasswordField.jsx';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState('email'); // 'email' | 'reset'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const cleanEmail = () => email.trim().toLowerCase();

  async function requestCode() {
    const r = await api('/auth/forgot', { method: 'POST', body: { email: cleanEmail() } });
    setEmailConfigured(r.email_configured !== false);
  }

  // Step 1 — ask for a code (always advances; no account-exists leak).
  async function onEmail(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await requestCode();
      setNote('');
      setStep('reset');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Step 2 — confirm the code + set the new password.
  async function onReset(e) {
    e.preventDefault();
    if (password.length < 6) return setError('Password must be at least 6 characters');
    if (password !== confirm) return setError('Passwords do not match');
    setError('');
    setBusy(true);
    try {
      await api('/auth/reset', { method: 'POST', body: { email: cleanEmail(), code: code.trim(), password } });
      setDone(true);
      setTimeout(() => navigate('/login'), 1800);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    setError('');
    setNote('');
    try {
      await requestCode();
      setNote('A new code is on its way.');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="flex min-h-screen">
      <AuthAside />
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
              <Sprout size={20} />
            </div>
            <span className="text-lg font-extrabold">Sampada</span>
          </div>

          {done ? (
            <div className="space-y-4">
              <CheckCircle2 className="text-emerald-500" size={40} />
              <h1 className="text-2xl font-bold text-slate-900">Password updated</h1>
              <p className="text-sm text-slate-500">Taking you to sign in…</p>
              <Link to="/login" className="btn-primary inline-flex">
                Sign in
              </Link>
            </div>
          ) : step === 'email' ? (
            <>
              <h1 className="text-2xl font-bold text-slate-900">Forgot your password?</h1>
              <p className="mt-1 text-sm text-slate-500">
                Enter your email and we&apos;ll send you a 6-digit reset code.
              </p>
              <form onSubmit={onEmail} className="mt-8 space-y-4">
                <ErrorBanner message={error} />
                <div>
                  <span className="label">Email</span>
                  <input
                    className="input"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <button className="btn-primary w-full" disabled={busy}>
                  {busy ? 'Sending…' : 'Send reset code'}
                </button>
              </form>
              <p className="mt-6 text-center text-sm text-slate-500">
                Remembered it?{' '}
                <Link to="/login" className="font-semibold text-brand-600 hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setStep('email');
                  setError('');
                  setCode('');
                }}
                className="mb-4 flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-brand-700"
              >
                <ArrowLeft size={15} /> Back
              </button>
              <h1 className="text-2xl font-bold text-slate-900">Reset your password</h1>
              <p className="mt-1 text-sm text-slate-500">
                If an account exists for <span className="font-semibold text-slate-700">{cleanEmail()}</span>,
                we&apos;ve sent a 6-digit code. Enter it with your new password.
              </p>
              <form onSubmit={onReset} className="mt-8 space-y-4">
                <ErrorBanner message={error} />
                {!emailConfigured && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Email delivery isn&apos;t set up on the server yet, so the code couldn&apos;t be sent. The
                    owner can read it from the server logs.
                  </p>
                )}
                <div>
                  <span className="label">Reset code</span>
                  <input
                    className="input text-center text-2xl font-bold tracking-[0.4em]"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <PasswordField
                    label="New password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                    placeholder="At least 6 characters"
                    minLength={6}
                    required
                  />
                </div>
                <div>
                  <PasswordField
                    label="Confirm new password"
                    value={confirm}
                    onChange={setConfirm}
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                    minLength={6}
                    required
                  />
                </div>
                <button className="btn-primary w-full" disabled={busy || code.length !== 6}>
                  {busy ? 'Updating…' : 'Update password'}
                </button>
              </form>
              <p className="mt-6 text-center text-sm text-slate-500">
                Didn&apos;t get it?{' '}
                <button onClick={onResend} className="font-semibold text-brand-600 hover:underline">
                  Resend code
                </button>
              </p>
              {note && <p className="mt-1 text-center text-xs text-emerald-600">{note}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
