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
  // `cta` is what the button says when this is the step you're on, and `why` is
  // the one line explaining what it buys you. A checklist that only names tasks
  // asks for effort without saying what the effort is for.
  const steps = [
    {
      label: 'Add your first investment',
      done: (c.holdings || 0) > 0,
      to: '/investments',
      cta: 'Add a holding',
      why: 'Live prices start the moment one is in.',
    },
    {
      label: 'Add a bank account or asset',
      done: (c.accounts || 0) + (c.assets || 0) > 0,
      to: '/cash',
      cta: 'Add an account',
      why: 'Cash and property are what make net worth true.',
    },
    {
      // Third, not last: with the cashflow panels hidden until there is
      // something in them, this is now the only thing on the dashboard that
      // points at spending — and it is what the FI number in Insights is sized
      // from, so it earns a place near the top.
      label: 'Record income & spending',
      done: (c.transactions || 0) > 0,
      to: '/transactions',
      cta: 'Add one',
      why: 'Powers your FI number, budgets and monthly statements.',
    },
    {
      label: 'Import a CAS/CSV or connect your broker',
      done: !!setup.imported,
      to: '/investments',
      cta: 'Import holdings',
      why: 'Brings your whole portfolio in at once, instead of one by one.',
    },
    {
      label: 'Set a goal',
      done: (c.goals || 0) > 0,
      to: '/goals',
      cta: 'Create a goal',
      why: 'Turns a number into a plan with a date on it.',
    },
    {
      label: 'Turn on the daily digest',
      done: !!setup.daily_email,
      to: '/settings',
      cta: 'Turn it on',
      why: 'A morning email so you never have to remember to check.',
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  // The first thing left to do. Everything else stays visible but recedes —
  // five equally-weighted rows is a list, not a next action.
  const next = steps.find((s) => !s.done) || null;

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
            {doneCount === 0
              ? `${steps.length} quick steps — a complete picture takes about two minutes.`
              : `${doneCount} of ${steps.length} done — ${steps.length - doneCount} to go.`}
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

      {/* The next step, given room to be acted on rather than scanned past. */}
      {next && (
        <Link
          to={next.to}
          className="mt-4 flex items-center gap-3 rounded-xl bg-brand-50 px-4 py-3 transition hover:bg-brand-100/70 dark:bg-[#16233c] dark:hover:bg-[#1c2c49]"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <ChevronRight size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-800">{next.label}</span>
            <span className="block text-xs text-slate-500">{next.why}</span>
          </span>
          <span className="btn-primary shrink-0 px-3 py-1.5 text-xs">{next.cta}</span>
        </Link>
      )}

      <motion.ul
        variants={gridStagger}
        initial={pageVisible() ? 'hidden' : false}
        animate="show"
        className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3"
      >
        {steps.map((s) => (
          <motion.li key={s.label} variants={cardRise}>
            <Link
              to={s.to}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                s.done
                  ? 'text-slate-400 line-through'
                  : s === next
                    ? 'text-brand-800 dark:text-brand-100'
                    : 'text-slate-700 hover:bg-brand-50/40 hover:text-brand-800'
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                  s.done
                    ? 'bg-emerald-500 text-white'
                    : s === next
                      ? 'border-2 border-brand-500'
                      : 'border-2 border-slate-300 dark:border-[#2e4064]'
                }`}
              >
                {s.done && <Check size={12} strokeWidth={3} />}
              </span>
              <span className="flex-1">{s.label}</span>
              {!s.done && s !== next && <ChevronRight size={15} className="text-slate-300" />}
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </motion.div>
  );
}
