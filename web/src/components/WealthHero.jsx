import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { RefreshCw, Sprout, Trophy } from 'lucide-react';
import { money, percent } from '../lib/format.js';
import { isNewMilestone, reachedMilestone } from '../lib/milestones.js';

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Ease-out count-up to the target when it changes (skipped for reduced motion).
function useCountUp(target, duration = 900) {
  // Start at 0 so the first paint counts up cleanly (no flash of the final value).
  const [val, setVal] = useState(reducedMotion() ? target : 0);
  const raf = useRef(0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (reducedMotion()) {
      fromRef.current = target;
      setVal(target);
      return undefined;
    }
    const start = performance.now();
    const from = fromRef.current;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3; // easeOutCubic
      const v = from + (target - from) * eased;
      // Commit every frame, not just the last one: a refresh mid-count used to
      // restart from the previous target and visibly snap backwards.
      fromRef.current = v;
      setVal(v);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return val;
}

const greetingFor = (h) => (h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening');

// A restrained, on-brand confetti burst (navy · gold · green) — not a party.
function celebrate() {
  if (reducedMotion()) return;
  const colors = ['#c2a368', '#1f3a66', '#2f7a53', '#d8bb79'];
  const fire = (ratio, opts) =>
    confetti({ origin: { y: 0.35 }, colors, disableForReducedMotion: true, particleCount: Math.floor(140 * ratio), ...opts });
  fire(0.25, { spread: 26, startVelocity: 55 });
  fire(0.35, { spread: 60 });
  fire(0.35, { spread: 100, decay: 0.91, scalar: 0.9 });
  fire(0.1, { spread: 120, startVelocity: 45 });
}

// Net-worth change across ~the last 30 days, from the premium history series.
function monthChange(hist) {
  if (!hist || hist.length < 2) return null;
  const ms = (d) => new Date(`${d}T00:00:00`).getTime();
  const cutoff = ms(hist[hist.length - 1].date) - 30 * 86400000;
  const start = hist.find((p) => ms(p.date) >= cutoff) || hist[0];
  const from = start.net_worth;
  const to = hist[hist.length - 1].net_worth;
  if (!(from > 0)) return null;
  return { delta: to - from, pct: ((to - from) / from) * 100 };
}

// The dashboard's personalised hero: greeting + animated net worth + a warm,
// growth-themed insight, over a slowly drifting brand-coloured aurora.
export default function WealthHero({ data, base, user, onRefresh, refreshing, isEmpty }) {
  const shown = useCountUp(data.net_worth || 0);
  const first = (user.name || '').trim().split(' ')[0] || 'there';
  const chg = monthChange(data.net_worth_history);
  const up = chg ? chg.delta >= 0 : true;

  const milestone = reachedMilestone(data.net_worth || 0, base);
  const [justCrossed, setJustCrossed] = useState(false);
  useEffect(() => {
    if (milestone && isNewMilestone(milestone)) {
      setJustCrossed(true);
      celebrate();
      const t = setTimeout(() => setJustCrossed(false), 6000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [milestone]);

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-6 text-white shadow-xl sm:p-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora-blob absolute -right-16 -top-24 h-64 w-64 rounded-full bg-gold-400/25 blur-3xl" />
        <div
          className="aurora-blob absolute -bottom-28 -left-12 h-64 w-64 rounded-full bg-brand-400/30 blur-3xl"
          style={{ animationDelay: '-8s' }}
        />
      </div>

      <AnimatePresence>
        {justCrossed && milestone && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: 'spring', stiffness: 300, damping: 22 }}
            className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-gold-400 px-3.5 py-1.5 text-sm font-bold text-brand-900 shadow-lg"
          >
            🎉 You crossed {money(milestone, base, { compact: true })}!
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-gold-300">
            <span className="flex items-center gap-1.5">
              <Sprout size={15} /> {greetingFor(new Date().getHours())}, {first}
            </span>
            {milestone && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gold-400/15 px-2 py-0.5 text-[11px] font-bold text-gold-200 ring-1 ring-gold-400/30">
                <Trophy size={11} /> {money(milestone, base, { compact: true })} club
              </span>
            )}
          </p>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-brand-200">Total net worth</p>
          <p className="num mt-0.5 text-4xl font-extrabold tracking-tight sm:text-5xl">{money(shown, base)}</p>
          <div className="mt-3 h-0.5 w-14 rounded bg-gold-400" />

          <p className="mt-3 text-sm">
            {isEmpty ? (
              <span className="text-brand-100">Plant your first holding and watch it grow 🌱</span>
            ) : chg ? (
              <>
                <span className={`font-semibold ${up ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {up ? '▲' : '▼'} {money(Math.abs(chg.delta), base)} ({percent(chg.pct)})
                </span>{' '}
                <span className="text-brand-200">
                  this past month · your wealth is {up ? 'growing 🌱' : 'holding steady'}
                </span>
              </>
            ) : (
              <span className="text-brand-100">Your wealth story starts today — check back tomorrow to watch it grow 🌱</span>
            )}
          </p>

          {isEmpty && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                to="/investments"
                className="rounded-xl bg-gold-400 px-4 py-2 text-sm font-semibold text-brand-900 transition hover:bg-gold-300"
              >
                Add an investment
              </Link>
              <Link
                to="/cash"
                className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15"
              >
                Add a bank account
              </Link>
            </div>
          )}
        </div>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-sm font-semibold text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-white/15 disabled:opacity-60"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
