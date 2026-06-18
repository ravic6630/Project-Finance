import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Sprout } from 'lucide-react';
import { api } from '../lib/api.js';
import { ErrorBanner } from '../components/ui.jsx';
import AuthAside from '../components/AuthAside.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match.');
    setError('');
    setBusy(true);
    try {
      await api('/auth/reset', { method: 'POST', body: { token, password } });
      setDone(true);
      setTimeout(() => navigate('/login'), 2000);
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

          {done ? (
            <div className="space-y-4">
              <CheckCircle2 className="text-emerald-500" size={40} />
              <h1 className="text-2xl font-bold text-slate-900">Password updated</h1>
              <p className="text-sm text-slate-500">Taking you to sign in…</p>
              <Link to="/login" className="btn-primary inline-flex">
                Sign in
              </Link>
            </div>
          ) : !token ? (
            <div className="space-y-4">
              <h1 className="text-2xl font-bold text-slate-900">Invalid link</h1>
              <p className="text-sm text-slate-500">
                This reset link is missing or broken. Please request a new one.
              </p>
              <Link to="/forgot" className="btn-primary inline-flex">
                Request a new link
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-900">Set a new password</h1>
              <form onSubmit={onSubmit} className="mt-8 space-y-4">
                <ErrorBanner message={error} />
                <div>
                  <span className="label">New password</span>
                  <input
                    className="input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    minLength={6}
                    required
                  />
                </div>
                <div>
                  <span className="label">Confirm password</span>
                  <input
                    className="input"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                  />
                </div>
                <button className="btn-primary w-full" disabled={busy}>
                  {busy ? 'Updating…' : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
