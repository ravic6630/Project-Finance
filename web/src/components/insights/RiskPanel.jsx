import { motion, useReducedMotion } from 'framer-motion';
import { CircleCheck, Coins, Gauge, Globe, Layers } from 'lucide-react';
import { money } from '../../lib/format.js';
import { Counter, Spotlight } from '../fx.jsx';

/* Concentration & exposure.

   The brief for this panel is a calm advisor, not a security scanner: a normal
   portfolio must never light up red. So the strongest finding gets champagne,
   not rose; severity is carried by a dot and a quiet word rather than by alarm
   colour; and when there is nothing to say, the panel says so warmly and shows
   the numbers that earned that verdict. */

const EASE = [0.16, 1, 0.3, 1];

// Shares of a whole, so no +/- sign — `percent()` is for changes, not weights.
const pct1 = (n) => (Number.isFinite(n) ? `${n.toFixed(1)}%` : '—');

const TONES = [
  'bg-brand-600 dark:bg-brand-300',
  'bg-gold-400',
  'bg-brand-400 dark:bg-brand-200',
  'bg-gold-600 dark:bg-gold-300',
  'bg-brand-800 dark:bg-brand-400',
  'bg-slate-400',
];

const FLAG = {
  high: { box: 'border-gold-200 bg-gold-50', dot: 'bg-gold-500', word: 'Worth acting on' },
  medium: { box: 'border-slate-200 bg-slate-50', dot: 'bg-brand-400', word: 'Worth knowing' },
  low: { box: 'border-slate-100', dot: 'bg-slate-300', word: 'For context' },
};

function Bar({ pct, tone = 'bg-brand-500 dark:bg-brand-300', delay = 0 }) {
  const reduced = useReducedMotion();
  const w = `${Math.max(0, Math.min(100, Number(pct) || 0))}%`;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <motion.div
        className={`h-full rounded-full ${tone}`}
        initial={reduced ? false : { width: 0 }}
        animate={{ width: w }}
        transition={{ duration: 0.45, ease: EASE, delay }}
      />
    </div>
  );
}

// One stacked rule + its legend. Used for both splits so they read as siblings.
function Split({ rows, labelOf, keyOf }) {
  const reduced = useReducedMotion();
  if (!rows.length) return null;
  return (
    <>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
        {rows.map((r, i) => (
          <motion.div
            key={keyOf(r)}
            className={TONES[i % TONES.length]}
            // A sliver of a percent still deserves a mark you can see; the
            // number beside it in the legend is always the exact one.
            style={{ minWidth: r.pct > 0 ? 2 : 0 }}
            initial={reduced ? false : { width: 0 }}
            animate={{ width: `${Math.max(0, Math.min(100, r.pct))}%` }}
            transition={{ duration: 0.45, ease: EASE, delay: 0.04 * i }}
          />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {rows.map((r, i) => (
          <li key={keyOf(r)} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className={`h-2 w-2 shrink-0 rounded-full ${TONES[i % TONES.length]}`} aria-hidden="true" />
            <span className="truncate">{labelOf(r)}</span>
            <span className="num font-semibold text-slate-700">{pct1(r.pct)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Shell({ children }) {
  return (
    <Spotlight className="card h-full p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Gauge size={18} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold tracking-tight text-slate-900">Concentration</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            The quiet risks: one position too large, one currency, one market.
          </p>
        </div>
      </div>
      {children}
    </Spotlight>
  );
}

export default function RiskPanel({ data, base = 'INR' }) {
  const reduced = useReducedMotion();
  if (!data) return null;

  if (data.error) {
    return (
      <Shell>
        <p className="mt-6 text-sm leading-relaxed text-slate-500">{data.error}</p>
      </Shell>
    );
  }

  const {
    score = 0,
    score_label: scoreLabel = '',
    score_note: scoreNote = '',
    top_holdings: top = [],
    top3_pct: top3 = 0,
    hhi = 0,
    by_currency: byCurrency = [],
    by_kind: byKind = [],
    flags = [],
    positions_count: positions = 0,
    investments_total: total = 0,
  } = data;

  // Fewer than two priced positions: there is no spread to measure. The server
  // says so in score_note; we print that instead of a score that would be
  // arithmetically true and completely meaningless.
  const measurable = positions >= 2 && total > 0;

  if (!measurable) {
    return (
      <Shell>
        <div className="rule-fade my-5" />
        <p className="text-sm leading-relaxed text-slate-500">{scoreNote}</p>
        {top.length === 1 && (
          <p className="mt-3 text-sm text-slate-500">
            <span className="font-medium text-slate-700">{top[0].name}</span> —{' '}
            <span className="num">{money(top[0].value, base)}</span>
            {top[0].pct_of_net_worth != null && (
              <span className="text-slate-400">
                {' '}· <span className="num">{pct1(top[0].pct_of_net_worth)}</span> of your net worth
              </span>
            )}
          </p>
        )}
      </Shell>
    );
  }

  const largest = top[0];
  const meter = Math.max(0, Math.min(100, (score / 10) * 100));

  return (
    <Shell>
      {/* -------------------------------- score ------------------------------ */}
      <div className="mt-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="flex items-baseline gap-1">
              <Counter
                value={score}
                format={(v) => v.toFixed(1)}
                className="num text-4xl font-bold leading-none tracking-tight text-slate-900"
              />
              <span className="num text-base font-semibold text-slate-300">/10</span>
            </div>
            <p className="font-display mt-1.5 text-base font-bold tracking-tight text-slate-800">
              {scoreLabel}
            </p>
          </div>
          <span className="chip shrink-0 bg-gold-50 text-gold-700 ring-1 ring-gold-200">
            A guide, not a measurement
          </span>
        </div>

        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-brand-400 to-gold-400 dark:from-brand-300 dark:to-gold-300"
            initial={reduced ? false : { width: 0 }}
            animate={{ width: `${meter}%` }}
            transition={{ duration: 0.45, ease: EASE }}
            role="img"
            aria-label={`Concentration ${score.toFixed(1)} out of 10 — ${scoreLabel}`}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] font-medium uppercase tracking-wide text-slate-500">
          <span>Spread out</span>
          <span>Concentrated</span>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-slate-500">{scoreNote}</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          It blends two things: how evenly your money is spread across positions — the standard
          Herfindahl measure, <span className="num">{hhi.toFixed(3)}</span> here, where 1 would be
          everything in one holding — and how big your single largest position is.
        </p>
      </div>

      <div className="rule-fade my-5" />

      {/* ---------------------------- largest positions ---------------------- */}
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="label mb-0 flex items-center gap-1.5">
            <Layers size={13} strokeWidth={2} aria-hidden="true" /> Largest positions
          </h3>
          <span className="text-xs text-slate-500">
            of <span className="num">{money(total, base, { compact: true })}</span> invested
          </span>
        </div>

        <ul className="mt-3 space-y-3">
          {top.map((h, i) => (
            <li key={`${h.name}-${i}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium text-slate-700" title={h.name}>
                  {h.name}
                </span>
                <span className="num shrink-0 text-sm font-semibold text-slate-900">
                  {pct1(h.pct_of_investments)}
                </span>
              </div>
              <div className="mt-1.5">
                <Bar
                  pct={h.pct_of_investments}
                  tone={i === 0 ? 'bg-brand-600 dark:bg-brand-300' : 'bg-brand-300 dark:bg-brand-400'}
                  delay={0.04 * i}
                />
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-3 text-xs text-slate-500">
                <span className="num">{money(h.value, base, { compact: true })}</span>
                {h.lots > 1 && <span>{h.lots} lots combined</span>}
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Top three: <span className="num font-semibold text-slate-600">{pct1(top3)}</span> of
          investments.
          {largest?.pct_of_net_worth != null ? (
            <>
              {' '}Your largest is{' '}
              <span className="num font-semibold text-slate-600">{pct1(largest.pct_of_net_worth)}</span>{' '}
              of everything you own.
            </>
          ) : (
            <> Net worth isn&apos;t positive right now, so we can&apos;t place these against it.</>
          )}
        </p>
      </div>

      <div className="rule-fade my-5" />

      {/* --------------------------------- splits ---------------------------- */}
      <div className="space-y-5">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="label mb-0 flex items-center gap-1.5">
              <Coins size={13} strokeWidth={2} aria-hidden="true" /> By currency
            </h3>
            <span className="text-xs text-slate-500">investments only</span>
          </div>
          <div className="mt-2.5">
            <Split rows={byCurrency} keyOf={(r) => r.currency} labelOf={(r) => r.currency} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Cash and other assets aren&apos;t included here — we hold those already converted to{' '}
            {base}, without the currency they sit in.
          </p>
        </div>

        {byKind.length > 0 && (
          <div>
            <h3 className="label mb-0 flex items-center gap-1.5">
              <Globe size={13} strokeWidth={2} aria-hidden="true" /> By market
            </h3>
            <div className="mt-2.5">
              <Split rows={byKind} keyOf={(r) => r.kind} labelOf={(r) => r.label} />
            </div>
          </div>
        )}
      </div>

      <div className="rule-fade my-5" />

      {/* --------------------------------- flags ----------------------------- */}
      {flags.length > 0 ? (
        <ul className="space-y-2.5">
          {flags.map((f, i) => {
            const s = FLAG[f.level] || FLAG.low;
            return (
              <li key={`${f.level}-${i}`} className={`rounded-xl border px-3.5 py-3 ${s.box}`}>
                <div className="flex items-start gap-2.5">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.dot}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p className="text-sm font-semibold text-slate-800">{f.title}</p>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {s.word}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-slate-500">{f.detail}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3">
          <CircleCheck size={16} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-emerald-700">
            Nothing stands out. Your largest position is{' '}
            <span className="num font-semibold">{pct1(largest?.pct_of_investments)}</span> of your
            investments, spread over <span className="num font-semibold">{positions}</span> positions
            in <span className="num font-semibold">{byCurrency.length}</span>{' '}
            {byCurrency.length === 1 ? 'currency' : 'currencies'}.
          </p>
        </div>
      )}
    </Shell>
  );
}
