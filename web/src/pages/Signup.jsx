import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Sprout, ArrowLeft } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { ErrorBanner } from '../components/ui.jsx';
import AuthAside from '../components/AuthAside.jsx';
import { CURRENCIES, guessCurrency } from '../lib/markets.js';

export default function Signup() {
  const { startSignup, verifySignup, resendSignup } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref');

  const [step, setStep] = useState('form'); // 'form' | 'verify'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [currency, setCurrency] = useState(() => guessCurrency());

  const [code, setCode] = useState('');
  const [emailSent, setEmailSent] = useState(true);
  const [note, setNote] = useState('');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const cleanEmail = () => email.trim().toLowerCase();

  // Step 1 — validate, then send the verification code.
  async function onStart(e) {
    e.preventDefault();
    setError('');
    if (password.length < 6) return setError('Password must be at least 6 characters');
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      const r = await startSignup({ name, email: cleanEmail(), password, base_currency: currency, ref: refCode });
      setEmailSent(r.email_sent);
      setNote('');
      setStep('verify');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Step 2 — confirm the code (creates the account + logs in).
  async function onVerify(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await verifySignup(cleanEmail(), code.trim());
      navigate('/');
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
      const r = await resendSignup(cleanEmail());
      setEmailSent(r.email_sent);
      setNote(r.email_sent ? 'A new code is on its way.' : 'A new code was generated.');
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

          {step === 'form' ? (
            <>
              <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
              <p className="mt-1 text-sm text-slate-500">Start tracking your wealth in minutes.</p>
              {refCode && (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-gold-50 px-3 py-2 text-sm font-medium text-gold-700 ring-1 ring-gold-200">
                  🎁 Invited by a friend — go Premium later and they get a free month.
                </p>
              )}

              <form onSubmit={onStart} className="mt-8 space-y-4">
                <ErrorBanner message={error} />
                <div>
                  <span className="label">Name</span>
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    required
                  />
                </div>
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
                    autoComplete="new-password"
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
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter your password"
                    minLength={6}
                    required
                  />
                </div>
                <div>
                  <span className="label">Default currency</span>
                  <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-400">
                    Detected from your region — change it anytime in Settings.
                  </p>
                </div>
                <button className="btn-primary w-full" disabled={busy}>
                  {busy ? 'Sending code…' : 'Create account'}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-slate-500">
                Already have an account?{' '}
                <Link to="/login" className="font-semibold text-brand-600 hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setStep('form');
                  setError('');
                  setCode('');
                }}
                className="mb-4 flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-brand-700"
              >
                <ArrowLeft size={15} /> Back
              </button>
              <h1 className="text-2xl font-bold text-slate-900">Verify your email</h1>
              <p className="mt-1 text-sm text-slate-500">
                We sent a 6-digit code to <span className="font-semibold text-slate-700">{cleanEmail()}</span>.
                Enter it below to finish.
              </p>

              <form onSubmit={onVerify} className="mt-8 space-y-4">
                <ErrorBanner message={error} />
                {!emailSent && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Email delivery isn&apos;t set up on the server yet, so the code couldn&apos;t be sent. The
                    owner can read it from the server logs.
                  </p>
                )}
                <div>
                  <span className="label">Verification code</span>
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
                <button className="btn-primary w-full" disabled={busy || code.length !== 6}>
                  {busy ? 'Verifying…' : 'Verify & create account'}
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
