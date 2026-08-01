import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, ChevronRight, Sprout, X } from 'lucide-react';
import { gridStagger, cardRise, pageVisible } from '../lib/motion.js';

const DISMISS_KEY = 'sampada_onboarding_dismissed';

// Activation checklist: walks a new user through their first wins. Hides itself
// once every step is done, and can be dismissed for good.
export default function GettingStarted({ data }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  const c = data.counts || {};
  const setup = data.setup || {};
  const steps = [
    { label: 'Add your first investment', done: (c.holdings || 0) > 0, to: '/investments' },
    { label: 'Add a bank account or asset', done: (c.accounts || 0) + (c.assets || 0) > 0, to: '/cash' },
    { label: 'Import a CAS/CSV or connect your broker', done: !!setup.imported, to: '/investments' },
    { label: 'Set a goal', done: (c.goals || 0) > 0, to: '/goals' },
    { label: 'Turn on the daily digest', done: !!setup.daily_email, to: '/settings' },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  if (dismissed || doneCount === steps.length) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode — dismissal just won't persist */
    }
  };

  return (
    <motion.div
      variants={cardRise}
      initial={pageVisible() ? 'hidden' : false}
      animate="show"
      className="card relative overflow-hidden p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-display text-lg font-bold text-slate-900">
            <Sprout size={18} className="text-gold-500" /> Get growing
          </h3>
          <p className="mt-0.5 text-sm text-slate-500">
            {doneCount} of {steps.length} done — a complete picture takes about two minutes.
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss checklist"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[#1c2c49]">
        <motion.div
          initial={pageVisible() ? { width: 0 } : false}
          animate={{ width: `${(doneCount / steps.length) * 100}%` }}
          transition={{ delay: 0.3, duration: 0.7, ease: 'easeOut' }}
          className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-300"
        />
      </div>

      <motion.ul
        variants={gridStagger}
        initial={pageVisible() ? 'hidden' : false}
        animate="show"
        className="mt-4 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3"
      >
        {steps.map((s) => (
          <motion.li key={s.label} variants={cardRise}>
            <Link
              to={s.to}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                s.done
                  ? 'text-slate-400 line-through'
                  : 'text-slate-700 hover:bg-brand-50/40 hover:text-brand-800'
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                  s.done
                    ? 'bg-emerald-500 text-white'
                    : 'border-2 border-slate-300 dark:border-[#2e4064]'
                }`}
              >
                {s.done && <Check size={12} strokeWidth={3} />}
              </span>
              <span className="flex-1">{s.label}</span>
              {!s.done && <ChevronRight size={15} className="text-slate-300" />}
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </motion.div>
  );
}
