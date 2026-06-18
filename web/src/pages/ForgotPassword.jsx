import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Sprout } from 'lucide-react';
import { api } from '../lib/api.js';
import { ErrorBanner } from '../components/ui.jsx';
import AuthAside from '../components/AuthAside.jsx';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/auth/forgot', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
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

          {sent ? (
            <div className="space-y-4">
              <CheckCircle2 className="text-emerald-500" size={40} />
              <h1 className="text-2xl font-bold text-slate-900">Check your email</h1>
              <p className="text-sm text-slate-500">
                If an account exists for <strong>{email}</strong>, we&apos;ve sent a link to reset your
                password. The link expires in 1 hour.
              </p>
              <Link to="/login" className="btn-primary inline-flex">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-900">Forgot your password?</h1>
              <p className="mt-1 text-sm text-slate-500">
                Enter your email and we&apos;ll send you a reset link.
              </p>
              <form onSubmit={onSubmit} className="mt-8 space-y-4">
                <ErrorBanner message={error} />
                <div>
                  <span className="label">Email</span>
                  <input
                    className="input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <button className="btn-primary w-full" disabled={busy}>
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
              <p className="mt-6 text-center text-sm text-slate-500">
                Remembered it?{' '}
                <Link to="/login" className="font-semibold text-brand-600 hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
