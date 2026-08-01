import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sprout } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { ErrorBanner } from '../components/ui.jsx';
import AuthAside from '../components/AuthAside.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [slowHint, setSlowHint] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    // A slow sign-in almost always means Render's free tier is waking up.
    const slow = setTimeout(() => setSlowHint(true), 2500);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      clearTimeout(slow);
      setSlowHint(false);
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
          <h1 className="text-2xl font-bold text-slate-900">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to see your portfolio.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
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
            <div>
              <span className="label">Password</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <div className="text-right">
              <Link to="/forgot" className="text-sm font-medium text-brand-600 hover:underline">
                Forgot password?
              </Link>
            </div>
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            {slowHint && (
              <p className="text-center text-xs text-slate-400">
                Waking the server 🌱 — this first request can take up to a minute.
              </p>
            )}
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            New here?{' '}
            <Link to="/signup" className="font-semibold text-brand-600 hover:underline">
              Create an account
            </Link>
          </p>
          <p className="mt-2 text-center text-sm text-slate-400">
            Just exploring?{' '}
            <Link to="/calculators" className="font-medium text-brand-600 hover:underline">
              Try our free calculators
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
