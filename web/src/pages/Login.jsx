import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MailCheck, Sprout } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { ErrorBanner } from '../components/ui.jsx';
import AuthAside from '../components/AuthAside.jsx';
import PasswordField from '../components/PasswordField.jsx';

export default function Login() {
  const { login, complete2fa, completeLoginVerification } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // One ticket, two reasons for it: 'totp' (an authenticator is set up) or
  // 'email' (a run of wrong passwords earned a one-time code). The form below
  // is the same either way; only the wording and the endpoint differ.
  const [ticket, setTicket] = useState(null);
  const [step, setStep] = useState(null); // 'totp' | 'email'
  const [priorFailures, setPriorFailures] = useState(0);
  const [code, setCode] = useState('');

  const [slowHint, setSlowHint] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    // A slow sign-in almost always means Render's free tier is waking up.
    const slow = setTimeout(() => setSlowHint(true), 2500);
    try {
      const d = await login(email, password);
      if (d?.requires_2fa || d?.requires_verification) {
        setTicket(d.ticket);
        setStep(d.requires_2fa ? 'totp' : 'email');
        setPriorFailures(Number(d.failed_attempts) || 0);
        setBusy(false);
        return;
      }
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      clearTimeout(slow);
      setSlowHint(false);
      setBusy(false);
    }
  }

  function backToPassword() {
    setTicket(null);
    setStep(null);
    setCode('');
    setError('');
  }

  async function onSubmitCode(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (step === 'totp') await complete2fa(ticket, code);
      else await completeLoginVerification(ticket, code);
      navigate('/');
    } catch (err) {
      setError(err.message);
      // A dead ticket or a burnt code can only be fixed by starting over, so
      // send them back rather than leaving them typing into a field that can
      // no longer succeed.
      if (/expired|again/i.test(err.message)) {
        setTicket(null);
        setStep(null);
        setCode('');
      }
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
          <h1 className="text-2xl font-bold text-slate-900">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to see your portfolio.</p>

          {ticket ? (
            <form onSubmit={onSubmitCode} className="mt-8 space-y-4">
              {/* Being asked for a code you didn't expect is alarming, so the
                  email step says exactly why it appeared and what it means if
                  the reader wasn't the one getting the password wrong. */}
              {step === 'email' && (
                <div className="flex items-start gap-3 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
                  <MailCheck size={18} className="mt-0.5 shrink-0 text-brand-600" />
                  <span>
                    Your password was right, but{' '}
                    {priorFailures === 1
                      ? 'there was 1 failed attempt'
                      : `there were ${priorFailures || 3} failed attempts`}{' '}
                    on this account first — so we&apos;ve emailed a code to <strong>{email}</strong> to
                    check it&apos;s you.
                  </span>
                </div>
              )}
              <ErrorBanner message={error} />
              <div>
                <span className="label">
                  {step === 'email' ? 'Code from your email' : 'Authenticator code'}
                </span>
                <input
                  className="input text-center text-xl tracking-[0.4em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  autoFocus
                  required
                />
                <p className="mt-1.5 text-xs text-slate-400">
                  {step === 'email'
                    ? "Enter the 6-digit code we just sent. It expires in 10 minutes. If you weren't the one getting the password wrong, don't enter it — change your password instead."
                    : 'Open your authenticator app and enter the 6-digit code for Sampada.'}
                </p>
              </div>
              <button className="btn-primary w-full" disabled={busy || code.length !== 6}>
                {busy ? 'Verifying…' : 'Verify & sign in'}
              </button>
              <button
                type="button"
                className="w-full text-center text-sm font-medium text-slate-400 hover:text-brand-600"
                onClick={backToPassword}
              >
                ← Back to password
              </button>
            </form>
          ) : (
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
            <PasswordField
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              required
            />
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
          )}

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
