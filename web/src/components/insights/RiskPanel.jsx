import { motion, useReducedMotion } from 'framer-motion';
import { Gauge } from 'lucide-react';
import { money } from '../../lib/format.js';
import { Spotlight } from '../fx.jsx';
import Details from './Details.jsx';

/* Concentration & exposure.

   Plain first. The reader wants one thing from this panel — "is any of this too
   big?" — and they should get it in a sentence and a number, before anything
   else asks for their attention. The score, the ratio behind it, and the splits
   by currency and market are all real and all stay, one click down.

   A normal portfolio must never light up red: severity is carried by a quiet
   dot and a plain sentence, never by alarm colour. */

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

const DOT = { high: 'bg-gold-500', medium: 'bg-brand-400', low: 'bg-slate-300' };

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
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Gauge size={18} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <h2 className="font-display text-lg font-bold tracking-tight text-slate-900">Concentration</h2>
      </div>
      {children}
    </Spotlight>
  );
}

export default function RiskPanel({ data, base = 'INR' }) {
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
        <p className="mt-5 text-sm leading-relaxed text-slate-500">{scoreNote}</p>
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

  // The verdict, from the loudest finding. A flag about the biggest holding says
  // its name and its share — which is exactly what the number below already
  // says — so those become a judgement instead, and everything else keeps the
  // flag's own words. Nothing here is a slogan: each line is only reachable on
  // the data that earns it.
  const loud = flags.find((f) => f.level === 'high') || flags.find((f) => f.level === 'medium') || null;
  const verdict = !loud
    ? 'Nothing here is too big.'
    : loud.kind === 'size'
      ? loud.level === 'high'
        ? "That's a lot riding on one holding."
        : 'One holding is on the large side.'
      : loud.kind === 'top3'
        ? 'Your three biggest holdings carry most of this.'
        : loud.title;
  const quiet = flags.filter((f) => f !== loud);

  // As-if-equal holdings: 26 positions of different sizes behave like this many
  // of the same size. Said in words, in the drawer, never as "Herfindahl".
  const effective = hhi > 0 ? 1 / hhi : null;

  return (
    <Shell>
      {/* -------------------------------- verdict ---------------------------- */}
      <p className="mt-4 text-[15px] font-semibold leading-snug text-slate-800">{verdict}</p>
      {loud && <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{loud.detail}</p>}

      {/* ------------------------------ the number --------------------------- */}
      <div className="mt-5">
        <p className="num text-4xl font-bold leading-none tracking-tight text-slate-900">
          {pct1(largest?.pct_of_investments)}
        </p>
        <p className="mt-1.5 text-sm text-slate-500">
          is your biggest holding — <span className="text-slate-700">{largest?.name}</span>
        </p>
      </div>

      {/* --------------------------- largest positions ----------------------- */}
      <ul className="mt-5 space-y-3">
        {top.map((h, i) => (
          <li key={`${h.name}-${i}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm text-slate-700" title={h.name}>
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
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        {positions} positions · <span className="num">{money(total, base, { compact: true })}</span> invested
      </p>

      {/* -------------------------------- working ---------------------------- */}
      <Details>
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold text-slate-700">
              Concentration score <span className="num">{score.toFixed(1)}</span>/10 — {scoreLabel}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-400 to-gold-400 dark:from-brand-300 dark:to-gold-300"
              style={{ width: `${meter}%` }}
              role="img"
              aria-label={`Concentration ${score.toFixed(1)} out of 10 — ${scoreLabel}`}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] font-medium uppercase tracking-wide text-slate-500">
            <span>Spread out</span>
            <span>Concentrated</span>
          </div>
          <p className="mt-2">
            A guide, not a measurement. It weighs how evenly your money is spread against how big
            the single largest position is.
            {effective != null && (
              <>
                {' '}Your {positions} holdings are different sizes, so they behave like about{' '}
                <span className="num font-semibold text-slate-600">{effective.toFixed(0)}</span>{' '}
                equal ones.
              </>
            )}
          </p>
        </div>

        <p>
          Your top three are <span className="num font-semibold text-slate-600">{pct1(top3)}</span> of
          your investments
          {largest?.pct_of_net_worth != null ? (
            <>
              , and your largest is{' '}
              <span className="num font-semibold text-slate-600">{pct1(largest.pct_of_net_worth)}</span>{' '}
              of everything you own.
            </>
          ) : (
            <>. Net worth isn&apos;t positive right now, so we can&apos;t place these against it.</>
          )}
        </p>

        <div>
          <p className="font-semibold text-slate-700">By currency</p>
          <div className="mt-2">
            <Split rows={byCurrency} keyOf={(r) => r.currency} labelOf={(r) => r.currency} />
          </div>
          <p className="mt-2">
            Investments only. Cash and other assets are held already converted to {base}, without
            the currency they sit in.
          </p>
        </div>

        {byKind.length > 0 && (
          <div>
            <p className="font-semibold text-slate-700">By market</p>
            <div className="mt-2">
              <Split rows={byKind} keyOf={(r) => r.kind} labelOf={(r) => r.label} />
            </div>
          </div>
        )}

        {quiet.length > 0 && (
          <div>
            <p className="font-semibold text-slate-700">Also worth knowing</p>
            <ul className="mt-2 space-y-2">
              {quiet.map((f, i) => (
                <li key={`${f.level}-${i}`} className="flex items-start gap-2">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[f.level] || DOT.low}`}
                    aria-hidden="true"
                  />
                  <span>
                    <span className="text-slate-600">{f.title}.</span> {f.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Details>
    </Shell>
  );
}
