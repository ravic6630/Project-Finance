import { Link } from 'react-router-dom';
import { Sprout } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import CalculatorTool from '../components/CalculatorTool.jsx';

// Public, no-login calculator page (linked from the login screen). Logged-in
// users get the same tool in-app at /calculators via CalculatorPage instead.
export default function Calculators() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-[#f4f2ec]">
      <header className="border-b border-[#e8e2d4] bg-[#faf9f5]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 lg:px-8">
          <Link to={user ? '/' : '/login'} className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-700 text-gold-300 ring-1 ring-gold-400/30">
              <Sprout size={20} />
            </span>
            <span className="font-display text-xl font-bold text-brand-800">Sampada</span>
          </Link>
          <div className="flex items-center gap-2">
            {user ? (
              <Link to="/" className="btn-primary">Go to dashboard</Link>
            ) : (
              <>
                <Link to="/login" className="btn-ghost">Sign in</Link>
                <Link to="/signup" className="btn-primary">Get started free</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-12 lg:px-8">
        <div className="pt-7">
          <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900 sm:text-3xl">
            Investment calculators
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Free, no login. SIP &amp; lumpsum with step-up and inflation built in.
          </p>
        </div>

        <div className="mt-5">
          <CalculatorTool />
        </div>

        {/* CTA */}
        <div className="mt-6 overflow-hidden rounded-2xl bg-brand-700 p-6 text-white sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-bold">Now track your real money</h2>
              <p className="mt-1 max-w-lg text-sm text-brand-100">
                See your actual net worth across Indian stocks, US stocks, mutual funds and cash — live,
                in one place. Premium adds goals, true returns (XIRR) and tax reports on your own portfolio.
              </p>
            </div>
            {!user && (
              <Link to="/signup" className="shrink-0 rounded-xl bg-gold-400 px-5 py-3 font-semibold text-brand-900 transition hover:bg-gold-300">
                Create a free account
              </Link>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Estimates for planning only, not investment advice. Returns are assumed and not guaranteed.
        </p>
      </main>
    </div>
  );
}
