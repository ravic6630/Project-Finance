import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, BellRing, Coins, PlusCircle, X } from 'lucide-react';
import { money, percent } from '../lib/format.js';
import { cardRise, pageVisible } from '../lib/motion.js';

/* What changed while you were away.

   A dashboard is a snapshot; this turns the first few seconds after signing in
   into a briefing instead. It only appears when there is something true to say
   — the server returns null rather than a strip reading "nothing happened",
   which would cost attention and return none.

   Dismissal is per-briefing, not forever: the key carries the `since` timestamp,
   so closing today's summary doesn't silence next week's. */

const KEY = 'sampada_briefing_seen';

function agoText(days) {
  if (days <= 0) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

function Line({ icon: Icon, tone = 'plain', children }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
          tone === 'up'
            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
            : tone === 'down'
              ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
              : 'bg-brand-500/10 text-brand-600 dark:text-brand-200'
        }`}
      >
        <Icon size={13} aria-hidden="true" />
      </span>
      <span className="text-sm leading-relaxed text-slate-600">{children}</span>
    </li>
  );
}

export default function WelcomeBack({ data, base = 'INR', name }) {
  const since = data?.since || null;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return !!since && localStorage.getItem(KEY) === since;
    } catch {
      return false;
    }
  });

  if (!data || dismissed) return null;

  const nw = data.net_worth;
  const up = nw ? nw.change > 0 : false;
  const first = name ? String(name).split(' ')[0] : null;

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, since);
    } catch {
      /* private mode — it just reappears next load */
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
          <h3 className="font-display text-lg font-bold text-slate-900">
            {first ? `Welcome back, ${first}` : 'Welcome back'}
          </h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Here&apos;s what changed since you were last here, {agoText(data.days_ago)}.
          </p>
        </div>
        <button
          onClick={close}
          aria-label="Dismiss this summary"
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={16} />
        </button>
      </div>

      <ul className="mt-4 space-y-2.5">
        {nw && nw.change !== 0 && (
          <Line icon={up ? ArrowUpRight : ArrowDownRight} tone={up ? 'up' : 'down'}>
            Your net worth is{' '}
            <span className={`num font-semibold ${up ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
              {up ? '+' : '−'}
              {money(Math.abs(nw.change), base)}
            </span>
            {nw.change_pct != null && (
              <span className="text-slate-400"> ({percent(nw.change_pct)})</span>
            )}{' '}
            against the <span className="num">{money(nw.then, base)}</span> recorded on {nw.as_of}.
          </Line>
        )}

        {data.income && (
          <Line icon={Coins}>
            You received{' '}
            <span className="num font-semibold text-slate-700">{money(data.income.total, base)}</span> in
            dividends and interest
            {data.income.count > 1 ? ` across ${data.income.count} payouts` : ''}.
          </Line>
        )}

        {data.alerts?.length > 0 && (
          <Line icon={BellRing}>
            {data.alerts.length === 1 ? 'A price alert fired' : `${data.alerts.length} price alerts fired`}:{' '}
            {data.alerts.map((a, i) => (
              <span key={`${a.label}-${i}`}>
                {i > 0 && ', '}
                <span className="font-medium text-slate-700">{a.label}</span> went {a.direction}{' '}
                <span className="num">{money(a.threshold, base)}</span>
              </span>
            ))}
            .
          </Line>
        )}

        {data.holdings_added > 0 && (
          <Line icon={PlusCircle}>
            {data.holdings_added === 1
              ? '1 new holding was added to your portfolio.'
              : `${data.holdings_added} new holdings were added to your portfolio.`}
          </Line>
        )}
      </ul>
    </motion.div>
  );
}
