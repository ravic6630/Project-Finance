import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MotionConfig, motion, useReducedMotion } from 'framer-motion';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  ChevronRight,
  Crown,
  LineChart as LineChartIcon,
  Loader2,
  PieChart as PieIcon,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useProfile } from '../lib/ProfileContext.jsx';
import { dateLabel, money, percent } from '../lib/format.js';
import { ErrorBanner } from '../components/ui.jsx';
import { Aurora, CardSkeleton, Shimmer, Sparkline, Spotlight } from '../components/fx.jsx';
import { cardRise, gridStagger } from '../lib/motion.js';
import { cacheSignature, readDashboardCache, writeDashboardCache } from '../lib/dashboardCache.js';
import WealthHero from '../components/WealthHero.jsx';
import GettingStarted from '../components/GettingStarted.jsx';
import WelcomeBack from '../components/WelcomeBack.jsx';
import AllocationSunburst from '../components/AllocationSunburst.jsx';
import { FamilyInviteBanner, FamilyScopeNote } from '../components/FamilyBits.jsx';
import UpgradeModal from '../components/UpgradeModal.jsx';

const COLORS = ['#1f3a66', '#c2a368', '#2f7a53', '#3e7c8c', '#8a3b4c', '#7c6a48'];

const MONTH_LABEL = (key) =>
  new Date(`${key}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' });

// Icon tiles. Amber has no `.dark` override in the theme sheet, so the one warm
// tone here is the brand's own champagne — which does.
const TONES = {
  slate: 'bg-slate-100 text-slate-600',
  brand: 'bg-brand-100 text-brand-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  gold: 'bg-gold-100 text-gold-700',
};

// Shared eyebrow + fading hairline. Gives the page chapters instead of one long
// run of cards, without adding another heavy heading weight.
function SectionRule({ label }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <div className="rule-fade flex-1" aria-hidden="true" />
    </div>
  );
}

// One bento tile. `size="lg"` is the wide/tall variant; `footer` is where a tile
// earns its extra span (a sparkline, a class breakdown) instead of just being
// the same card stretched.
function StatCard({ icon: Icon, label, value, sub, tone = 'slate', to, size = 'sm', footer }) {
  const content = (
    <>
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONES[tone]}`}>
          <Icon size={18} />
        </div>
        <span className="flex flex-1 items-center justify-between gap-2 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          {label}
          {to && (
            <ChevronRight
              size={15}
              className="text-slate-300 transition duration-200 group-hover:translate-x-0.5 group-hover:text-brand-500"
            />
          )}
        </span>
      </div>
      <p
        className={`num font-bold tracking-tight text-slate-900 ${
          size === 'lg' ? 'mt-6 text-3xl sm:text-4xl' : 'mt-5 text-2xl'
        }`}
      >
        {value}
      </p>
      {sub && <div className="mt-1 text-sm">{sub}</div>}
      {footer && <div className="mt-auto pt-5">{footer}</div>}
    </>
  );
  const shell = `group flex h-full flex-col ${size === 'lg' ? 'p-5 sm:p-6' : 'p-5'}`;
  if (to) {
    return (
      <Spotlight as={Link} to={to} className={`card-interactive ${shell}`}>
        {content}
      </Spotlight>
    );
  }
  return <Spotlight className={`card ${shell}`}>{content}</Spotlight>;
}

const DAY = 86400000;
const asMs = (d) => new Date(`${d}T00:00:00`).getTime();

// Ranges offered above the net-worth chart. Snapshots are daily, so 1D is
// "today vs yesterday" rather than an intraday curve.
const RANGES = [
  { key: '1D', days: 1, label: 'the last day' },
  { key: '1W', days: 7, label: 'the last week' },
  { key: '1M', days: 30, label: 'the last month' },
  { key: '1Y', days: 365, label: 'the last year' },
  { key: '3Y', days: 365 * 3, label: 'the last 3 years' },
  { key: '5Y', days: 365 * 5, label: 'the last 5 years' },
  { key: '7Y', days: 365 * 7, label: 'the last 7 years' },
  { key: '10Y', days: 365 * 10, label: 'the last 10 years' },
];

// Benchmark options for the comparison overlay; the default adapts to the
// user's base currency (their home market), and the choice is remembered.
const BENCH_LABELS = {
  nifty50: 'NIFTY 50',
  sp500: 'S&P 500',
  ftse100: 'FTSE 100',
  stoxx50: 'EURO STOXX 50',
  asx200: 'ASX 200',
  nzx50: 'NZX 50',
  tsx: 'S&P/TSX',
};
const BENCH_FOR_CURRENCY = {
  INR: 'nifty50', USD: 'sp500', GBP: 'ftse100', EUR: 'stoxx50',
  AUD: 'asx200', NZD: 'nzx50', CAD: 'tsx',
};

// Build the series for the selected window on a REAL time axis. The x-axis
// domain is pinned to [start, end] of the range (not the data extent), and the
// last-known net worth is carried forward to the window's start — so a day, a
// week and a month look genuinely different even when the app wasn't opened
// every day. `exact` is false when we have less history than the range asks for.
function buildWindow(hist, days) {
  const pts = hist.map((p) => ({ ms: asMs(p.date), net_worth: p.net_worth }));
  if (pts.length < 2) return { view: pts, startMs: null, endMs: null, exact: false, from: pts[0]?.net_worth ?? 0 };

  const endMs = pts[pts.length - 1].ms;
  const firstMs = pts[0].ms;
  const wantStart = endMs - days * DAY;
  // "Exact" if our history reaches (within a few days of) the requested start.
  const exact = firstMs <= wantStart + 3 * DAY;
  const startMs = Math.max(wantStart, firstMs);

  const within = pts.filter((p) => p.ms >= startMs);
  const prior = pts.filter((p) => p.ms < startMs).pop(); // last value known before the window
  const series = [];
  if (!within.length || within[0].ms > startMs) {
    series.push({ ms: startMs, net_worth: (prior || within[0]).net_worth }); // carry-forward anchor
  }
  series.push(...within);
  return { view: downsample(series), startMs, endMs, exact, from: series[0].net_worth };
}

// "since" dates need the year once we're looking back past this one.
const sinceLabel = (ms) => {
  const dt = new Date(ms);
  const sameYear = dt.getFullYear() === new Date().getFullYear();
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
};

// Keep long ranges readable/fast — a decade of dailies is ~3,650 points.
// Evenly spaced, and always keeps the first and last point.
function downsample(points, max = 180) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

// Evenly spaced ticks across the pinned domain (fewer for tiny spans).
function makeTicks(a, b) {
  if (a == null || b == null || b <= a) return undefined;
  const n = Math.min(7, Math.max(2, Math.round((b - a) / DAY) + 1));
  return Array.from({ length: n }, (_, i) => Math.round(a + ((b - a) * i) / (n - 1)));
}

// Day/month for short spans, month once it's a few months, month + year beyond
// that (a 1-year span otherwise reads "Jul … Jul", which is ambiguous).
const tickFormatter = (spanDays) => (ms) => {
  const dt = new Date(ms);
  if (spanDays <= 45) return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  if (spanDays <= 120) return dt.toLocaleDateString('en-IN', { month: 'short' });
  return dt.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};

// Premium: net-worth trend chart. Free: a teaser that upsells (we record the
// history for everyone, so it's already waiting when they upgrade).
function NetWorthHistory({ data, base, onUpgrade }) {
  // All hooks live above the non-premium early return so the order is stable
  // if the user upgrades without a reload.
  const reduced = useReducedMotion();
  const [range, setRange] = useState('1M');
  const [bench, setBench] = useState(() => {
    try {
      return localStorage.getItem('sampada_bench') || BENCH_FOR_CURRENCY[base] || 'sp500';
    } catch {
      return BENCH_FOR_CURRENCY[base] || 'sp500';
    }
  });
  const [benchData, setBenchData] = useState(null);

  const hist = data.premium ? data.net_worth_history || [] : [];
  const active = RANGES.find((r) => r.key === range) || RANGES[2];
  const { view, startMs, endMs, exact, from } = useMemo(
    () => buildWindow(hist, active.days),

    [data.net_worth_history, active.days]
  );

  // Fetch the index series for the visible window (silently absent on failure).
  useEffect(() => {
    if (!data.premium || bench === 'none' || !startMs || !endMs || view.length < 2) {
      setBenchData(null);
      return undefined;
    }
    let stale = false;
    api(`/prices/benchmark?index=${bench}&from=${startMs}&to=${endMs}`)
      .then((d) => !stale && setBenchData(d.points?.length >= 2 ? d : null))
      .catch(() => !stale && setBenchData(null));
    return () => {
      stale = true;
    };
  }, [data.premium, bench, startMs, endMs, view.length]);

  // Rebase the index to the window's starting net worth: "if my money had
  // grown like the index". Skipped when net worth starts at 0 (nothing to scale).
  const overlay = useMemo(() => {
    if (!benchData || view.length < 2) return null;
    const pts = benchData.points;
    const closeAtOrBefore = (ms) => {
      let c = null;
      for (const pt of pts) {
        if (pt.ms <= ms) c = pt.close;
        else break;
      }
      return c;
    };
    const baseline = closeAtOrBefore(startMs) ?? pts[0]?.close;
    const factor = baseline > 0 ? (from || 0) / baseline : 0;
    if (!Number.isFinite(factor) || factor <= 0) return null;
    const merged = view.map((pt) => ({ ...pt, bench: (closeAtOrBefore(pt.ms) ?? baseline) * factor }));
    const lastClose = closeAtOrBefore(endMs) ?? pts[pts.length - 1].close;
    return {
      merged,
      label: benchData.label,
      youPct: from > 0 ? ((view[view.length - 1].net_worth - from) / from) * 100 : null,
      benchPct: ((lastClose - baseline) / baseline) * 100,
    };
  }, [benchData, view, startMs, endMs, from]);

  const setBenchmark = (key) => {
    setBench(key);
    try {
      localStorage.setItem('sampada_bench', key);
    } catch {
      /* private mode */
    }
  };

  if (!data.premium) {
    return (
      <div className="card relative overflow-hidden rounded-3xl p-5 sm:p-6">
        <Aurora className="opacity-40" />
        <div className="relative">
          <div className="flex items-start gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONES.gold}`}>
              <LineChartIcon size={18} />
            </div>
            <div>
              <h3 className="flex flex-wrap items-center gap-2 font-display text-lg font-bold text-slate-900">
                Net worth over time
                <span className="chip bg-gold-100 text-gold-700">
                  <Crown size={12} className="mr-1" /> Premium
                </span>
              </h3>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                Watch your wealth grow with a daily net-worth trend. We&apos;re already recording your
                history — upgrade to unlock the chart.
              </p>
            </div>
          </div>
          <button className="btn-primary mt-5" onClick={onUpgrade}>
            <Sparkles size={16} /> Upgrade to Premium
          </button>
        </div>
      </div>
    );
  }
  const latest = view[view.length - 1]?.net_worth ?? 0;
  const delta = latest - from;
  const up = delta >= 0;
  const spanDays = startMs && endMs ? Math.max(1, Math.round((endMs - startMs) / DAY)) : 0;
  // Claim the requested range only when our history actually covers it;
  // otherwise say how far back the data really goes.
  const spanLabel = exact ? active.label : `since ${sinceLabel(startMs)}`;

  return (
    <div className="card rounded-3xl p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONES.brand}`}>
            <LineChartIcon size={18} />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Trend</p>
            <h3 className="font-display text-xl font-bold tracking-tight text-slate-900">
              Net worth over time
            </h3>
            {view.length > 1 && (
              <p className="mt-1 text-sm">
                <span
                  className={`num font-semibold ${
                    up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {up ? '▲' : '▼'} {money(Math.abs(delta), base)}
                  {from > 0 && ` (${percent((delta / from) * 100)})`}
                </span>
                <span className="text-slate-400"> · {spanLabel}</span>
                {overlay && overlay.youPct != null && (
                  <span className="ml-1.5 text-slate-400">
                    · you {percent(overlay.youPct)} vs {overlay.label} {percent(overlay.benchPct)}
                    {overlay.youPct >= overlay.benchPct ? ' 🌱' : ''}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Segmented control: one shared pill slides between ranges, so the
              selection reads as a single object moving rather than two states
              blinking. */}
          <div className="inline-flex flex-wrap gap-0.5 rounded-xl border border-[#e8e2d4] bg-white p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                aria-pressed={range === r.key}
                className={`relative rounded-lg px-2.5 py-1 text-xs font-semibold transition duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  range === r.key ? 'text-white' : 'text-slate-500 hover:text-brand-700'
                }`}
              >
                {range === r.key && (
                  <motion.span
                    layoutId="nw-range-pill"
                    aria-hidden="true"
                    className="absolute inset-0 rounded-lg bg-brand-700 dark:bg-brand-500"
                    transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 38 }}
                  />
                )}
                <span className="relative">{r.key}</span>
              </button>
            ))}
          </div>
          <select
            value={bench}
            onChange={(e) => setBenchmark(e.target.value)}
            aria-label="Benchmark index"
            className="rounded-xl border border-[#e8e2d4] bg-white px-2 py-1.5 text-xs font-semibold text-slate-500"
          >
            <option value="none">No benchmark</option>
            {Object.entries(BENCH_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                vs {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {view.length < 2 ? (
        <p className="py-16 text-center text-sm text-slate-400">
          Your net-worth history will build here day by day — check back tomorrow to see the trend.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={overlay ? overlay.merged : view} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1f3a66" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#1f3a66" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ece6d8" vertical={false} />
            <XAxis
              type="number"
              dataKey="ms"
              domain={[startMs, endMs]}
              ticks={makeTicks(startMs, endMs)}
              tickFormatter={tickFormatter(spanDays)}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              minTickGap={20}
            />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => money(v, base, { compact: true })} />
            <Tooltip
              formatter={(v, name) => [money(v, base), name === 'bench' ? overlay?.label || 'Index' : 'Net worth']}
              labelFormatter={(ms) => dateLabel(new Date(ms).toISOString().slice(0, 10))}
            />
            <Area type="monotone" dataKey="net_worth" stroke="#1f3a66" strokeWidth={2} fill="url(#nwFill)" />
            {overlay && (
              <Area
                type="monotone"
                dataKey="bench"
                stroke="#c2a368"
                strokeWidth={2}
                strokeDasharray="6 4"
                fill="none"
                dot={false}
                activeDot={{ r: 3 }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}
      {overlay && view.length >= 2 && (
        <div className="mt-1 flex items-center justify-center gap-5 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 rounded bg-brand-600" /> Your net worth
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 rounded border-t-2 border-dashed border-gold-500" /> {overlay.label}
            <span className="text-slate-400">(scaled to your start)</span>
          </span>
        </div>
      )}
    </div>
  );
}

// Loading state mirrors the real bento, so content lands where the eye is
// already looking instead of replacing a spinner with a different layout.
function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <span className="sr-only">Loading your dashboard…</span>
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-6 shadow-xl sm:p-8">
        <Aurora />
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/10" />
        <div className="relative space-y-3" aria-hidden="true">
          <div className="h-3.5 w-44 rounded-full bg-white/15" />
          <div className="h-2.5 w-28 rounded-full bg-white/10" />
          <div className="h-10 w-56 rounded-xl bg-white/15 sm:h-12 sm:w-72" />
          <div className="h-0.5 w-14 rounded bg-gold-400/70" />
          <div className="h-3 w-64 max-w-full rounded-full bg-white/10" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card flex flex-col p-5 sm:p-6 lg:col-span-2 lg:row-span-2">
          <Shimmer className="h-10 w-10 !rounded-xl" />
          <Shimmer className="mt-6 h-9 w-3/5" />
          <Shimmer className="mt-2 h-4 w-2/5" />
          <Shimmer className="mt-auto h-1.5 w-full !rounded-full" />
        </div>
        <div className="lg:col-span-2">
          <CardSkeleton />
        </div>
        <CardSkeleton />
        <CardSkeleton />
      </div>

      <div className="card rounded-3xl p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Shimmer className="h-3 w-16" />
            <Shimmer className="mt-2 h-6 w-52" />
          </div>
          <Shimmer className="h-8 w-52 !rounded-xl" />
        </div>
        <Shimmer className="mt-6 h-[280px] w-full !rounded-2xl" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <Shimmer className="h-6 w-44" />
          <Shimmer className="mt-4 h-[280px] w-full !rounded-2xl" />
        </div>
        <div className="card p-5">
          <Shimmer className="h-6 w-56" />
          <Shimmer className="mt-4 h-[280px] w-full !rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

// Shown only while the numbers on screen came from the local cache. It is the
// whole reason caching money is acceptable: the figures are never presented as
// current, and the line says exactly when they were true.
function StaleNote({ at }) {
  const when = new Date(at);
  const mins = Math.max(0, Math.round((Date.now() - when.getTime()) / 60000));
  const ago =
    mins < 1 ? 'a moment ago' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : 'yesterday';
  return (
    <p className="flex items-center gap-2 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-medium text-slate-500 dark:bg-[#16233c]">
      <Loader2 size={13} className="animate-spin text-brand-500" aria-hidden="true" />
      Showing your last saved figures from {ago} — fetching today&apos;s now.
    </p>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { active: activeProfile, dashboardQuery, activeLabel } = useProfile();
  const base = user.base_currency;
  const signature = cacheSignature(user.id, base, activeProfile);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Non-null while what's on screen came from the cache rather than the server.
  // Every figure below is then rendered under an explicit "as of" marker.
  const [staleAt, setStaleAt] = useState(null);

  const load = useCallback(async (refresh = false) => {
    try {
      setError('');
      const params = [refresh ? 'refresh=1' : '', dashboardQuery('').replace('?', '')]
        .filter(Boolean)
        .join('&');
      const d = await api(`/dashboard${params ? `?${params}` : ''}`);
      setData(d);
      setStaleAt(null);
      writeDashboardCache(signature, d);
    } catch (err) {
      // A cached dashboard already on screen is more useful than an error page
      // replacing it — keep it, keep its marker, and say what went wrong above.
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeProfile, signature]);

  useEffect(() => {
    // Paint the last known numbers first, if there are any for exactly this
    // user + currency + profile, then let the real request replace them.
    const cached = readDashboardCache(signature);
    if (cached) {
      setData(cached.data);
      setStaleAt(cached.at);
      setLoading(false);
    } else {
      setData(null);
      setStaleAt(null);
      setLoading(true);
    }
    load();

  }, [load, base, activeProfile, signature]);

  if (loading) return <DashboardSkeleton />;
  if (error && !data) return <ErrorBanner message={error} />;
  if (!data) return null;

  const { net_worth, investments, cash, assets, allocation, cashflow, counts } = data;
  const gainPositive = investments.gain >= 0;
  const isEmpty =
    counts.holdings === 0 &&
    counts.accounts === 0 &&
    (counts.assets ?? 0) === 0 &&
    counts.transactions === 0;

  // The only per-tile series the payload genuinely supports: six months of
  // net cashflow. Investments/cash/assets have no history on the wire, so those
  // tiles get real structure instead of an invented trend line.
  const cashflowSeries = (cashflow.months || []).map((m) => m.income - m.expense);
  // Both cashflow surfaces key off the same question: has anything actually been
  // recorded in the window they cover? Neither was badly designed — they were
  // just showing zero to someone who has never logged a transaction, and a panel
  // with nothing in it still costs a scroll and a glance. They are hidden, not
  // deleted: the day a transaction exists both come back on their own, and a
  // genuine zero month then MEANS something, because you are someone who logs.
  const hasCashflow = (cashflow.months || []).some((m) => m.income > 0 || m.expense > 0);
  const kinds = (investments.by_kind || []).filter((k) => k.value > 0);
  const kindsTotal = kinds.reduce((s, k) => s + k.value, 0);

  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-6">
        <WealthHero
          data={data}
          base={base}
          user={user}
          isEmpty={isEmpty}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load(true);
          }}
        />

        {staleAt && <StaleNote at={staleAt} />}
        {error && <ErrorBanner message={error} />}

        <FamilyInviteBanner />
        <FamilyScopeNote data={data} active={activeProfile} />

        <WelcomeBack data={data.since_last_visit} base={base} name={user.name} />
        <GettingStarted data={data} />

        <SectionRule label="Your holdings" />

        {/* Bento: one tile carries the weight (investments, wide + tall), the
            rest step down in size. A uniform 4-across grid gave four things
            equal importance when they don't have it. */}
        <motion.div
          variants={gridStagger}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <motion.div variants={cardRise} className="lg:col-span-2 lg:row-span-2">
            <StatCard
              icon={TrendingUp}
              tone="brand"
              size="lg"
              label="Investments"
              to="/investments"
              value={money(investments.value, base)}
              sub={
                <span
                  className={`num font-semibold ${
                    gainPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {gainPositive ? '▲' : '▼'} {money(Math.abs(investments.gain), base)} (
                  {percent(investments.gain_pct)})
                </span>
              }
              footer={
                kindsTotal > 0 ? (
                  <>
                    <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                      {kinds.map((k, i) => (
                        <span
                          key={k.key}
                          title={`${k.label} · ${money(k.value, base)}`}
                          style={{ width: `${(k.value / kindsTotal) * 100}%`, background: COLORS[i % COLORS.length] }}
                          className="h-full"
                        />
                      ))}
                    </div>
                    <p className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      {kinds.slice(0, 4).map((k, i) => (
                        <span key={k.key} className="inline-flex items-center gap-1.5">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: COLORS[i % COLORS.length] }}
                            aria-hidden="true"
                          />
                          {k.label}
                        </span>
                      ))}
                    </p>
                    <p className="mt-2 text-[11px] text-slate-500">
                      Invested <span className="num">{money(investments.cost, base)}</span>
                    </p>
                  </>
                ) : null
              }
            />
          </motion.div>
          <motion.div variants={cardRise} className="lg:col-span-2">
            <StatCard
              icon={Wallet}
              tone="emerald"
              label="Cash & Bank"
              to="/cash"
              value={money(cash.total, base)}
              sub={<span className="text-slate-400">{counts.accounts} account(s)</span>}
            />
          </motion.div>
          {/* Assets shares the bottom-right cell with the cashflow tile. When
              that tile is hidden it would otherwise sit in half a cell with
              dead space beside it, so it takes the whole row instead — leaving
              a clean 2x2: investments tall on the left, cash over assets on
              the right. */}
          <motion.div variants={cardRise} className={hasCashflow ? '' : 'sm:col-span-2 lg:col-span-2'}>
            <StatCard
              icon={Building2}
              tone="brand"
              label="Assets"
              to="/assets"
              value={money(assets?.total ?? 0, base)}
              sub={<span className="text-slate-400">{counts.assets ?? 0} asset(s)</span>}
            />
          </motion.div>
          {hasCashflow && (
          <motion.div variants={cardRise}>
            <StatCard
              icon={cashflow.this_month_net >= 0 ? ArrowUpRight : ArrowDownRight}
              tone="gold"
              label="This month's cashflow"
              to="/transactions"
              value={money(cashflow.this_month_net, base)}
              sub={
                <span className="num text-slate-400">
                  +{money(cashflow.this_month_income, base)} / −{money(cashflow.this_month_expense, base)}
                </span>
              }
              footer={
                cashflowSeries.length > 1 ? (
                  <Sparkline
                    points={cashflowSeries}
                    height={24}
                    className="text-gold-500 dark:text-gold-300"
                  />
                ) : null
              }
            />
          </motion.div>
          )}
        </motion.div>

        {!isEmpty && (
          <>
            <SectionRule label="Performance" />
            <NetWorthHistory data={data} base={base} onUpgrade={() => setUpgradeOpen(true)} />
          </>
        )}

        <SectionRule label="Breakdown" />

        <div className={`grid grid-cols-1 gap-6 ${hasCashflow ? 'lg:grid-cols-2' : ''}`}>
          {/* Allocation */}
          <div className="card p-5">
            <div className="mb-2 flex items-center gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONES.brand}`}>
                <PieIcon size={18} />
              </div>
              <h3 className="font-display text-lg font-bold text-slate-900">Asset allocation</h3>
            </div>
            {allocation.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-400">
                No assets yet — add investments or accounts.
              </p>
            ) : data.allocation_tree?.children?.length ? (
              <AllocationSunburst tree={data.allocation_tree} base={base} byKind={investments.by_kind} />
            ) : (
              /* An older cached payload, or a linked member's view, may arrive
                 without the tree. The flat ring still tells the truth, so it
                 stays as the fallback rather than blanking the card. */
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={allocation}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                  >
                    {allocation.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => money(v, base)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Cashflow */}
          {hasCashflow && (
          <div className="card p-5">
            <div className="mb-2 flex items-center gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONES.emerald}`}>
                <ArrowUpRight size={18} />
              </div>
              <h3 className="font-display text-lg font-bold text-slate-900">
                Income vs expense
                <span className="ml-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  6 months
                </span>
              </h3>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={cashflow.months} margin={{ top: 16, right: 8, left: -8, bottom: 0 }}>
                <XAxis
                  dataKey="key"
                  tickFormatter={MONTH_LABEL}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v) => money(v, base, { compact: true })}
                />
                <Tooltip
                  formatter={(v, n) => [money(v, base), n === 'income' ? 'Income' : 'Expense']}
                  labelFormatter={MONTH_LABEL}
                />
                <Bar dataKey="income" fill="#2f7a53" radius={[6, 6, 0, 0]} maxBarSize={28} />
                <Bar dataKey="expense" fill="#b0455a" radius={[6, 6, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          )}
        </div>

        <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} onChanged={() => load()} />
      </div>
    </MotionConfig>
  );
}
