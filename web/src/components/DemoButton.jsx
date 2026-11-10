import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, MousePointerClick } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';

/* "Try the live demo": one click, no form. The server hands back a private
   account already filled with a sample family's money, and the app opens on
   its dashboard. The first click after the server has slept can take a while
   (Render's free tier wakes in up to a minute), so the button says so rather
   than looking broken. */

export function useDemoLauncher() {
  const { startDemo } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function launch() {
    if (busy) return;
    setBusy(true);
    setError('');
    timer.current = setTimeout(() => setSlow(true), 3500);
    try {
      await startDemo();
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err.status === 429
          ? 'You’ve opened a lot of demos in the last hour — please try again a little later.'
          : err.message || 'The demo didn’t open. Please try again.'
      );
      setBusy(false);
    } finally {
      clearTimeout(timer.current);
      setSlow(false);
    }
  }

  return { launch, busy, slow, error };
}

const STYLES = {
  // White, beside the hero's navy "Start free".
  secondary:
    'group inline-flex items-center gap-2 rounded-xl bg-white px-6 py-4 font-semibold text-brand-700 ring-1 ring-[#e8e2d4] transition duration-200 hover:ring-gold-300 disabled:cursor-wait dark:ring-white/10',
  primary:
    'group inline-flex items-center gap-2 rounded-xl bg-brand-700 px-7 py-4 font-semibold text-white shadow-lg shadow-brand-900/20 ring-1 ring-inset ring-white/10 transition duration-200 hover:bg-brand-800 disabled:cursor-wait',
  link: 'font-semibold text-brand-600 hover:underline disabled:cursor-wait',
};

export default function DemoButton({ variant = 'secondary', label = 'Explore the live demo', className = '', hintClassName = '' }) {
  const { launch, busy, slow, error } = useDemoLauncher();
  const isLink = variant === 'link';
  return (
    <span className={`inline-flex flex-col ${isLink ? '' : 'items-start'} ${className}`}>
      <button type="button" onClick={launch} disabled={busy} className={STYLES[variant]} aria-busy={busy}>
        {!isLink &&
          (busy ? (
            <Loader2 size={17} className="animate-spin" aria-hidden="true" />
          ) : (
            <MousePointerClick size={17} aria-hidden="true" />
          ))}
        {busy ? 'Opening the demo…' : label}
        {!isLink && !busy && (
          <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
        )}
      </button>
      {(slow || error) && (
        <span role={error ? 'alert' : 'status'} className={`mt-2 max-w-xs text-xs ${error ? 'text-rose-600 dark:text-rose-300' : 'text-slate-400'} ${hintClassName}`}>
          {error || 'Waking the server — the first visit can take up to a minute. 🌱'}
        </span>
      )}
    </span>
  );
}
