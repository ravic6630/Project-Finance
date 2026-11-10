import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';

/* The strip across the top of a live demo. It answers the three things a
   visitor wonders inside someone else's numbers: whose money is this (a
   sample family's), how long do I have (the countdown), and how do I get my
   own (one button). "Start over" hands out a fresh copy, for anyone who has
   edited the sample beyond recognition. */

function timeLeft(expiresAt, at = Date.now()) {
  const ms = Date.parse(expiresAt) - at;
  if (!(ms > 0)) return 'ending now';
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m left` : `${Math.max(1, m)}m left`;
}

export default function DemoBar() {
  const { user, logout, startDemo } = useAuth();
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  const [restarting, setRestarting] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  if (!user?.demo_expires_at) return null;

  const signUp = () => {
    logout();
    navigate('/signup', { replace: true });
  };
  const restart = async () => {
    setRestarting(true);
    try {
      await startDemo();
      navigate('/', { replace: true });
    } catch {
      // The old demo is still perfectly usable; nothing to undo.
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="border-b border-gold-400/30 bg-gradient-to-r from-brand-700 via-brand-700 to-brand-800 text-white dark:from-[#162a4c] dark:via-[#14233d] dark:to-[#101d33]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 lg:px-8">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <Sparkles size={15} className="shrink-0 text-gold-300" aria-hidden="true" />
          <span>
            <span className="font-semibold">Live demo</span>
            <span className="text-brand-100"> · a sample family’s money, every feature on · </span>
            <span className="num text-gold-200">{timeLeft(user.demo_expires_at, now)}</span>
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={restart}
            disabled={restarting}
            title="Swap in a fresh copy of the demo"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-100 transition hover:bg-white/10 hover:text-white disabled:cursor-wait"
          >
            {restarting ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            Start over
          </button>
          <button
            type="button"
            onClick={signUp}
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-bold text-brand-900 transition hover:bg-gold-300"
          >
            Create your free account
          </button>
        </div>
      </div>
    </div>
  );
}
