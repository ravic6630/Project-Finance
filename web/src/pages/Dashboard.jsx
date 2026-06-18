import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
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
  PieChart as PieIcon,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { money, percent } from '../lib/format.js';
import { ErrorBanner, Spinner } from '../components/ui.jsx';

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
const MONTH_LABEL = (key) =>
  new Date(`${key}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' });

function StatCard({ icon: Icon, label, value, sub, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    brand: 'bg-brand-100 text-brand-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
  };
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon size={20} />
        </div>
        <span className="text-sm font-semibold text-slate-500">{label}</span>
      </div>
      <p className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900">{value}</p>
      {sub && <div className="mt-1 text-sm">{sub}</div>}
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

  const { net_worth, investments, cash, allocation, cashflow, counts } = data;
  const gainPositive = investments.gain >= 0;
  const isEmpty = counts.holdings === 0 && counts.accounts === 0 && counts.transactions === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">Total net worth</p>
          <p className="text-4xl font-extrabold tracking-tight text-slate-900">
            {money(net_worth, base)}
          </p>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={TrendingUp}
          tone="brand"
          label="Investments"
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
          value={money(cash.total, base)}
          sub={<span className="text-slate-400">{counts.accounts} account(s)</span>}
        />
        <StatCard
          icon={cashflow.this_month_net >= 0 ? ArrowUpRight : ArrowDownRight}
          tone="amber"
          label="This month's cashflow"
          value={money(cashflow.this_month_net, base)}
          sub={
            <span className="text-slate-400">
              +{money(cashflow.this_month_income, base)} / −{money(cashflow.this_month_expense, base)}
            </span>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Allocation */}
        <div className="card p-5">
          <h3 className="mb-1 flex items-center gap-2 font-bold text-slate-900">
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
          <h3 className="mb-1 flex items-center gap-2 font-bold text-slate-900">
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
              <Bar dataKey="income" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={28} />
              <Bar dataKey="expense" fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Investments by class */}
      {investments.by_kind.length > 0 && (
        <div className="card p-5">
          <h3 className="mb-4 font-bold text-slate-900">Investments by class</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {investments.by_kind.map((k) => {
              const gain = k.value - k.cost;
              const up = gain >= 0;
              return (
                <div key={k.key} className="rounded-xl border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-500">{k.label}</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">{money(k.value, base)}</p>
                  <p className={`mt-0.5 text-sm font-medium ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {up ? '▲' : '▼'} {money(Math.abs(gain), base)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
