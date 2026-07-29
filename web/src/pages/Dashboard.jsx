import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
  PieChart as PieIcon,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { dateLabel, money, percent } from '../lib/format.js';
import { ErrorBanner, Spinner } from '../components/ui.jsx';
import UpgradeModal from '../components/UpgradeModal.jsx';

const COLORS = ['#1f3a66', '#c2a368', '#2f7a53', '#3e7c8c', '#8a3b4c', '#7c6a48'];
const MONTH_LABEL = (key) =>
  new Date(`${key}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' });

function StatCard({ icon: Icon, label, value, sub, tone = 'slate', to }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    brand: 'bg-brand-100 text-brand-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
  };
  const content = (
    <>
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon size={20} />
        </div>
        <span className="flex flex-1 items-center justify-between text-sm font-semibold text-slate-500">
          {label}
          {to && <ChevronRight size={16} className="text-slate-300" />}
        </span>
      </div>
      <p className="num mt-4 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      {sub && <div className="mt-1 text-sm">{sub}</div>}
    </>
  );
  if (to) {
    return (
      <Link
        to={to}
        className="card block p-5 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
      >
        {content}
      </Link>
    );
  }
  return <div className="card p-5">{content}</div>;
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
  // Declared before the non-premium early return so the hook order is stable
  // if the user upgrades without a reload.
  const [range, setRange] = useState('1M');

  if (!data.premium) {
    return (
      <div className="card p-5">
        <h3 className="mb-1 flex flex-wrap items-center gap-2 font-display text-lg font-bold text-slate-900">
          <LineChartIcon size={18} className="text-brand-600" /> Net worth over time
          <span className="chip bg-amber-100 text-amber-700">
            <Crown size={12} className="mr-1" /> Premium
          </span>
        </h3>
        <p className="max-w-md text-sm text-slate-500">
          Watch your wealth grow with a daily net-worth trend. We&apos;re already recording your
          history — upgrade to unlock the chart.
        </p>
        <button className="btn-primary mt-4" onClick={onUpgrade}>
          <Sparkles size={16} /> Upgrade to Premium
        </button>
      </div>
    );
  }
  const hist = data.net_worth_history || [];
  const active = RANGES.find((r) => r.key === range) || RANGES[2];
  const { view, startMs, endMs, exact, from } = buildWindow(hist, active.days);

  const latest = view[view.length - 1]?.net_worth ?? 0;
  const delta = latest - from;
  const up = delta >= 0;
  const spanDays = startMs && endMs ? Math.max(1, Math.round((endMs - startMs) / DAY)) : 0;
  // Claim the requested range only when our history actually covers it;
  // otherwise say how far back the data really goes.
  const spanLabel = exact ? active.label : `since ${sinceLabel(startMs)}`;

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-display text-lg font-bold text-slate-900">
            <LineChartIcon size={18} className="text-brand-600" /> Net worth over time
          </h3>
          {view.length > 1 && (
            <p className="mt-0.5 text-sm">
              <span className={`font-semibold ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
                {up ? '▲' : '▼'} {money(Math.abs(delta), base)}
                {from > 0 && ` (${percent((delta / from) * 100)})`}
              </span>
              <span className="text-slate-400"> · {spanLabel}</span>
            </p>
          )}
        </div>
        <div className="inline-flex flex-wrap gap-0.5 rounded-xl border border-[#e8e2d4] bg-white p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                range === r.key ? 'bg-brand-700 text-white' : 'text-slate-500 hover:text-brand-700'
              }`}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>

      {view.length < 2 ? (
        <p className="py-16 text-center text-sm text-slate-400">
          Your net-worth history will build here day by day — check back tomorrow to see the trend.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={view} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
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
            <Tooltip formatter={(v) => [money(v, base), 'Net worth']} labelFormatter={(ms) => dateLabel(new Date(ms).toISOString().slice(0, 10))} />
            <Area type="monotone" dataKey="net_worth" stroke="#1f3a66" strokeWidth={2} fill="url(#nwFill)" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const base = user.base_currency;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const load = useCallback(async (refresh = false) => {
    try {
      setError('');
      const d = await api(`/dashboard${refresh ? '?refresh=1' : ''}`);
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load, base]);

  if (loading) return <Spinner label="Loading your dashboard…" />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  const { net_worth, investments, cash, assets, allocation, cashflow, counts } = data;
  const gainPositive = investments.gain >= 0;
  const isEmpty =
    counts.holdings === 0 &&
    counts.accounts === 0 &&
    (counts.assets ?? 0) === 0 &&
    counts.transactions === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">Total net worth</p>
          <p className="num text-4xl font-bold tracking-tight text-brand-900">
            {money(net_worth, base)}
          </p>
          <div className="gold-rule mt-2.5" />
        </div>
        <button
          className="btn-ghost"
          onClick={() => {
            setRefreshing(true);
            load(true);
          }}
          disabled={refreshing}
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing prices…' : 'Refresh prices'}
        </button>
      </div>

      {isEmpty && (
        <div className="card flex flex-col items-start gap-3 bg-brand-50/60 p-6">
          <div className="flex items-center gap-2 font-bold text-brand-800">
            <Sparkles size={18} /> Welcome to Sampada!
          </div>
          <p className="text-sm text-brand-900/70">
            Add your first holding or account to see your wealth come to life.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/investments" className="btn-primary">
              Add an investment
            </Link>
            <Link to="/cash" className="btn-ghost">
              Add a bank account
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={TrendingUp}
          tone="brand"
          label="Investments"
          to="/investments"
          value={money(investments.value, base)}
          sub={
            <span className={gainPositive ? 'text-emerald-600' : 'text-rose-600'}>
              {gainPositive ? '▲' : '▼'} {money(Math.abs(investments.gain), base)} (
              {percent(investments.gain_pct)})
            </span>
          }
        />
        <StatCard
          icon={Wallet}
          tone="emerald"
          label="Cash & Bank"
          to="/cash"
          value={money(cash.total, base)}
          sub={<span className="text-slate-400">{counts.accounts} account(s)</span>}
        />
        <StatCard
          icon={Building2}
          tone="brand"
          label="Assets"
          to="/assets"
          value={money(assets?.total ?? 0, base)}
          sub={<span className="text-slate-400">{counts.assets ?? 0} asset(s)</span>}
        />
        <StatCard
          icon={cashflow.this_month_net >= 0 ? ArrowUpRight : ArrowDownRight}
          tone="amber"
          label="This month's cashflow"
          to="/transactions"
          value={money(cashflow.this_month_net, base)}
          sub={
            <span className="text-slate-400">
              +{money(cashflow.this_month_income, base)} / −{money(cashflow.this_month_expense, base)}
            </span>
          }
        />
      </div>

      {!isEmpty && <NetWorthHistory data={data} base={base} onUpgrade={() => setUpgradeOpen(true)} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Allocation */}
        <div className="card p-5">
          <h3 className="mb-1 flex items-center gap-2 font-display text-lg font-bold text-slate-900">
            <PieIcon size={18} className="text-brand-600" /> Asset allocation
          </h3>
          {allocation.length === 0 ? (
            <p className="py-16 text-center text-sm text-slate-400">
              No assets yet — add investments or accounts.
            </p>
          ) : (
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
        <div className="card p-5">
          <h3 className="mb-1 flex items-center gap-2 font-display text-lg font-bold text-slate-900">
            <ArrowUpRight size={18} className="text-emerald-600" /> Income vs expense (6 months)
          </h3>
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
      </div>

      {/* Investments by class */}
      {investments.by_kind.length > 0 && (
        <div className="card p-5">
          <h3 className="mb-4 font-display text-lg font-bold text-slate-900">Investments by class</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {investments.by_kind.map((k) => {
              const gain = k.value - k.cost;
              const up = gain >= 0;
              return (
                <Link
                  key={k.key}
                  to="/investments"
                  className="rounded-xl border border-slate-200 p-4 transition hover:border-brand-200 hover:bg-slate-50"
                >
                  <p className="text-sm font-semibold text-slate-500">{k.label}</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">{money(k.value, base)}</p>
                  <p className={`mt-0.5 text-sm font-medium ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {up ? '▲' : '▼'} {money(Math.abs(gain), base)}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} onChanged={() => load()} />
    </div>
  );
}
