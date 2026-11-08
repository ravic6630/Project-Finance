import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from 'recharts';
import {
  ArrowRight,
  HeartPulse,
  Info,
  Lightbulb,
  LifeBuoy,
  PieChart,
  PiggyBank,
  Receipt,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useApi } from '../../lib/useApi.js';
import { dateLabel } from '../../lib/format.js';
import { ErrorBanner } from '../ui.jsx';
import { CardSkeleton, Counter, Shimmer } from '../fx.jsx';
import { cardRise, gridStagger, pageVisible } from '../../lib/motion.js';
import Details from '../insights/Details.jsx';
import HealthRing, { BandChip, bandStyle } from './HealthRing.jsx';

/* The Health tab of the Goals hub.

   Six readings of the user's finances, each measured from what they've
   recorded — never asked — with the target it's measured against and the one
   change that would move it. The overall number is only their mean; the cards
   are the substance. A reading that can't be measured yet says what would
   unlock it instead of pretending to a zero. */

const ICONS = {
  savings: PiggyBank,
  emergency: LifeBuoy,
  budgets: Receipt,
  diversification: PieChart,
  growth: TrendingUp,
  protect: ShieldCheck,
};

// Short axis labels: beside the hero on a laptop the radar card is barely
// 230px wide, and a side label gets about 40px before it's clipped.
const SHORT = {
  savings: 'Savings',
  emergency: 'Cushion',
  budgets: 'Budgets',
  diversification: 'Spread',
  growth: 'Growth',
  protect: 'Protect',
};

// The rules, as the server applies them (services/health.js). Shown in the
// "how this is scored" drawer so every number on the page can be checked.
const RULES = [
  ['Savings rate', 'Share of income kept, over the months you have recorded. 0% or less scores 0, 10% scores 50, 20% scores 80, 30% or more scores 100.'],
  ['Emergency fund', 'Cash and FDs divided by monthly spending. Nothing scores 0, one month 25, three months 60, six months or more 100.'],
  ['Budget adherence', 'Last complete month, each budgeted category: within budget counts in full, up to 10% over counts half.'],
  ['Diversification', 'The largest single company as a share of investments (10% or less scores 100, 35% scores 45, 60% scores 15), weighted 60%; and how many categories hold at least 5% (one 40, two 75, three or more 100), weighted 40%. Mutual funds and ETFs are baskets, so they never count as a concentration.'],
  ['Investment growth', 'Market value against what you paid, across holdings with a buy price. −20% or worse scores 0, break-even 40, +15% 80, +30% or more 100. Not annualised — holdings carry no purchase date.'],
  ['Plan & protect', 'Accounts and holdings with a registered nominee (weighted 50%), goals with a date that are on track (30%), and a named legacy contact (20%), averaged over whichever of these exist.'],
];

function PanelSkeleton() {
  return (
    <div className="space-y-6" role="status">
      <span className="sr-only">Measuring your financial health…</span>
      <div className="grid gap-4 lg:grid-cols-5">
        <Shimmer className="h-64 w-full lg:col-span-3" />
        <Shimmer className="h-64 w-full lg:col-span-2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}

/* ---------------------------------- hero ---------------------------------- */
function Hero({ data }) {
  const { score, band, scored, total, headline, as_of: asOf } = data;
  const leftOut = data.excluded?.length || 0;
  const s = bandStyle(band);
  return (
    <div className="card flex h-full flex-col items-center gap-6 p-6 text-center sm:flex-row sm:p-8 sm:text-left">
      <HealthRing score={score} band={band} size={168} stroke={14}>
        {score == null ? (
          <HeartPulse size={34} className="text-slate-400" />
        ) : (
          <>
            <span className="num text-5xl font-extrabold leading-none tracking-tight text-slate-900">
              <Counter value={score} format={(v) => String(Math.round(v))} />
            </span>
            <span className="mt-1 text-xs font-semibold text-slate-400">/ 100</span>
          </>
        )}
      </HealthRing>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Financial health</p>
        <h2 className={`font-display mt-1.5 text-3xl font-bold tracking-tight ${s ? s.text : 'text-slate-900'}`}>
          {band ? band.label : 'Not enough to score yet'}
        </h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">{headline}</p>
        <p className="mt-3 text-xs text-slate-400">
          Measured across {scored} of {total} dimensions
          {leftOut ? ` · ${leftOut} left out by you` : ''}
          {asOf ? ` · as of ${dateLabel(asOf)}` : ''}
        </p>
      </div>
    </div>
  );
}

/* --------------------------------- radar ---------------------------------- */
function Breakdown({ dimensions }) {
  const measured = dimensions.filter((d) => d.available && d.counted !== false);
  const rows = measured.map((d) => ({ axis: SHORT[d.key] || d.label, score: d.score }));
  return (
    <div className="card flex h-full flex-col p-5 sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Dimension breakdown</p>
      {rows.length >= 3 ? (
        // Fixed-height box, centred in whatever the row gives it. A 100%-high
        // chart has no content height, so a box sized by flex-1 alone would be
        // zero tall whenever the cards stack and the row has no height to give.
        <div className="mt-2 flex flex-1 items-center">
          <div className="h-56 w-full" role="img" aria-label={measured.map((d) => `${d.label} ${d.score}`).join(', ')}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={rows} outerRadius="68%" margin={{ top: 8, right: 40, bottom: 8, left: 40 }}>
                <PolarGrid stroke="#94a3b8" strokeOpacity={0.3} />
                <PolarAngleAxis dataKey="axis" tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} tickCount={5} />
                <Radar
                  dataKey="score"
                  stroke="#c2a368"
                  strokeWidth={2}
                  fill="#c2a368"
                  fillOpacity={0.22}
                  dot={{ r: 3, fill: '#c2a368', strokeWidth: 0 }}
                  // Drawn in place: Recharts animates on animation frames, and a
                  // tab that isn't painting would leave the shape stuck at nothing.
                  isAnimationActive={false}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <p className="mt-6 flex flex-1 items-center justify-center text-center text-sm text-slate-500">
          The shape appears once three dimensions can be measured.
        </p>
      )}
    </div>
  );
}

/* ------------------------------ count switch ------------------------------ */
// On the optional cards only. Off leaves the reading on the card and takes it
// out of the score, the radar and the weakest-area line.
function CountSwitch({ on, busy, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={busy}
      onClick={() => onChange(!on)}
      className="inline-flex shrink-0 items-center gap-2 rounded-full text-xs font-semibold text-slate-500 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-wait disabled:opacity-60 dark:focus-visible:ring-gold-300"
    >
      Count in my score
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          on ? 'bg-brand-600 dark:bg-gold-400' : 'bg-slate-300 dark:bg-white/15'
        }`}
      >
        {/* Inline white: the theme sheet repaints .bg-white as a dark card colour. */}
        <span
          className={`h-4 w-4 rounded-full shadow transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
          style={{ background: '#fff' }}
        />
      </span>
    </button>
  );
}

/* ------------------------------ dimension card ---------------------------- */
function DimensionCard({ d, busy, onCount }) {
  const Icon = ICONS[d.key] || HeartPulse;
  const counted = d.counted !== false;
  const s = counted ? bandStyle(d.band) : null;
  // "Plan & protect" is its own pillar; printing it twice says nothing.
  const pillar = d.pillar && d.pillar.toLowerCase() !== d.label.toLowerCase() ? d.pillar : null;
  const countRow = d.optional && (
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
      <span className="text-[11px] text-slate-400">{counted ? 'Optional' : 'Left out of your score'}</span>
      <CountSwitch on={counted} busy={busy} onChange={(on) => onCount(d.key, on)} />
    </div>
  );

  if (!d.available) {
    return (
      <motion.div
        variants={cardRise}
        className="flex h-full flex-col rounded-2xl border border-dashed border-slate-300 p-5"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-700">{d.label}</p>
            {pillar && <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{pillar}</p>}
          </div>
          <span className="chip whitespace-nowrap bg-slate-100 text-slate-500">
            {counted ? 'Not measured' : 'Not counted'}
          </span>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-500">{d.reason}</p>
        <div className="mt-auto pt-4">
          {d.action && (
            <Link
              to={d.action.to}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800"
            >
              Open {d.action.label} <ArrowRight size={13} />
            </Link>
          )}
          {countRow}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div variants={cardRise} className="card flex h-full flex-col p-5">
      {/* Dimmed, not hidden, when left out: the reading is still true. */}
      <div className={`flex flex-1 flex-col transition-opacity ${counted ? '' : 'opacity-50'}`}>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">{d.label}</p>
            {pillar && <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{pillar}</p>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="num text-2xl font-bold leading-none tracking-tight text-slate-900">{d.score}</span>
            {counted ? (
              <BandChip band={d.band} className="!px-2 !py-0.5 text-[10px]" />
            ) : (
              <span className="chip whitespace-nowrap bg-slate-100 !px-2 !py-0.5 text-[10px] text-slate-500">
                Not counted
              </span>
            )}
          </div>
        </div>

        <div
          className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuenow={d.score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${d.label} score`}
        >
          <div className={`h-full rounded-full ${s?.bar || 'bg-slate-400'}`} style={{ width: `${d.score}%` }} />
        </div>

        <p className="mt-4 text-sm leading-relaxed text-slate-700">{d.value}</p>
        <p className="mt-1 text-xs text-slate-400">Target: {d.target}</p>

        <div className="mt-auto pt-4">
          {d.tip && (
            <p className="flex items-start gap-2 rounded-xl bg-gold-50 px-3 py-2.5 text-xs leading-relaxed text-slate-700">
              <Lightbulb size={14} className="mt-0.5 shrink-0 text-gold-600" aria-hidden="true" />
              <span>{d.tip}</span>
            </p>
          )}
          {d.action && (
            <Link
              to={d.action.to}
              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800"
            >
              {d.action.label} <ArrowRight size={13} />
            </Link>
          )}
        </div>
      </div>
      {countRow}
    </motion.div>
  );
}

/* ---------------------------------- panel --------------------------------- */
export default function HealthPanel() {
  const { user } = useAuth();
  const base = user.base_currency;
  // Every amount in the readings is pre-formatted in the base currency, so a
  // currency switch must re-fetch rather than repaint stale figures.
  const { data, loading, error, mutate } = useApi('/financial-health', { vary: [base] });
  const [saving, setSaving] = useState(null); // key of the switch being saved
  const [saveError, setSaveError] = useState('');

  async function setCounted(key, on) {
    const current = data?.excluded || [];
    const excluded = on ? current.filter((k) => k !== key) : [...new Set([...current, key])];
    setSaving(key);
    setSaveError('');
    try {
      mutate(await api('/financial-health/settings', { method: 'PUT', body: { excluded } }));
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(null);
    }
  }

  if (loading && !data) return <PanelSkeleton />;
  if (!data) return <ErrorBanner message={error || 'Could not load your financial health.'} />;

  return (
    <div className="space-y-6">
      <ErrorBanner message={saveError || error} />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Hero data={data} />
        </div>
        <div className="lg:col-span-2">
          <Breakdown dimensions={data.dimensions} />
        </div>
      </div>

      <motion.div
        variants={gridStagger}
        initial={pageVisible() ? 'hidden' : false}
        animate="show"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {data.dimensions.map((d) => (
          <DimensionCard key={d.key} d={d} busy={saving === d.key} onCount={setCounted} />
        ))}
      </motion.div>

      <div className="card p-5 sm:p-6">
        {(data.not_scored || []).map((n) => (
          <p key={n} className="flex items-start gap-2 text-sm text-slate-600">
            <Info size={15} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
            {n}
          </p>
        ))}
        <Details label="How this is scored">
          <p>
            Built on the framework of the Financial Health Network’s FinHealth Score, which rates
            financial health 0–100 across how people spend, save, borrow and plan. Every reading here
            is measured from what you’ve recorded in Sampada, not from a questionnaire.
          </p>
          <dl className="space-y-2.5">
            {RULES.map(([k, v]) => (
              <div key={k}>
                <dt className="font-semibold text-slate-600">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p>
            <span className="font-semibold text-slate-600">The overall score</span> is the plain average
            of the dimensions that can be measured — never a zero for one that can’t — and needs at
            least three. Bands: 80 and above Excellent, 60–79 Good, 40–59 Fair, below 40 Needs attention.
          </p>
          <p>
            <span className="font-semibold text-slate-600">Savings rate and Plan &amp; protect are optional.</span>{' '}
            Switch either off on its card and the score is worked out from the rest. Savings rate is only
            right if all your income and spending is recorded, and Plan &amp; protect asks about nominees and
            a legacy contact, which not everyone wants to set up. A dimension you leave out keeps its reading
            on its card.
          </p>
          <p>
            The targets are common rules of thumb rather than personal advice: save about 20% of income;
            keep three to six months of spending in cash; keep any one company to around 10% of a
            portfolio. Your situation may call for different numbers.
          </p>
        </Details>
      </div>
    </div>
  );
}
