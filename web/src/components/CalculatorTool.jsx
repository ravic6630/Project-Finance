import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TrendingUp, Coins, Target } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { money } from '../lib/format.js';
import { CURRENCIES, guessCurrency } from '../lib/markets.js';

const GOLD = '#c2a368';
const NAVY = '#1f3a66';

// ---- Math ----------------------------------------------------------------
function simulateSip({ monthly, annualReturn, years, stepUp }) {
  const i = annualReturn / 100 / 12;
  let balance = 0;
  let invested = 0;
  let m = monthly;
  const series = [{ year: 0, invested: 0, gains: 0, value: 0 }];
  for (let y = 1; y <= years; y += 1) {
    for (let mo = 0; mo < 12; mo += 1) {
      balance = (balance + m) * (1 + i);
      invested += m;
    }
    series.push({
      year: y,
      invested: Math.round(invested),
      gains: Math.round(balance - invested),
      value: Math.round(balance),
    });
    m *= 1 + stepUp / 100;
  }
  return { futureValue: balance, invested, series };
}

function simulateLumpsum({ amount, annualReturn, years }) {
  const r = annualReturn / 100;
  const series = [];
  for (let y = 0; y <= years; y += 1) {
    const value = amount * (1 + r) ** y;
    series.push({ year: y, invested: amount, gains: Math.round(value - amount), value: Math.round(value) });
  }
  return { futureValue: amount * (1 + r) ** years, invested: amount, series };
}

function requiredSip({ target, annualReturn, years }) {
  const i = annualReturn / 100 / 12;
  const n = years * 12;
  if (i === 0) return target / n;
  return target / ((((1 + i) ** n - 1) / i) * (1 + i));
}

const realValue = (nominal, inflation, years) => nominal / (1 + inflation / 100) ** years;
const compactMoney = (v, cur) => money(v, cur, { compact: true });

const MODES = [
  { key: 'sip', label: 'SIP', icon: TrendingUp },
  { key: 'lumpsum', label: 'Lumpsum', icon: Coins },
  { key: 'goal', label: 'Reach a goal', icon: Target },
];

function Slider({ label, value, set, min, max, step, fmt }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-slate-600">{label}</span>
        <span className="num text-base font-bold text-brand-800">{fmt(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="mt-2 w-full accent-brand-600"
      />
    </div>
  );
}

// A stat chip that sits on the dark result banner.
function Chip({ label, value, gold }) {
  return (
    <div className="rounded-xl bg-white/10 px-3.5 py-2">
      <p className="text-[11px] font-medium text-brand-200">{label}</p>
      <p className={`num text-sm font-bold ${gold ? 'text-gold-300' : 'text-white'}`}>{value}</p>
    </div>
  );
}

// The interactive calculator (tabs + sliders + result + chart). Reused by the
// public standalone page and the in-app page, so it carries no page chrome of
// its own. `stickyTop` lets the in-app version clear the sticky app header.
export default function CalculatorTool({ stickyTop = 'top-2' }) {
  const { user } = useAuth();
  const [params] = useSearchParams();
  // Allow deep-linking a starting mode, e.g. /calculators?mode=goal from Goals.
  const [mode, setMode] = useState(() => MODES.find((m) => m.key === params.get('mode'))?.key || 'sip');
  const [cur, setCur] = useState(user?.base_currency || guessCurrency());

  // Money inputs start at 0 so visitors enter their own figures — no pre-filled
  // amounts that could be mistaken for a recommendation. Return / time / inflation
  // keep sensible assumptions (clearly labelled) so the tool works the moment an
  // amount is typed.
  const [annualReturn, setReturn] = useState(12);
  const [years, setYears] = useState(15);
  const [inflation, setInflation] = useState(6);
  const [showReal, setShowReal] = useState(false);
  const [monthly, setMonthly] = useState(0);
  const [stepUp, setStepUp] = useState(0);
  const [amount, setAmount] = useState(0);
  const [target, setTarget] = useState(0);

  const result = useMemo(() => {
    if (mode === 'sip') return simulateSip({ monthly, annualReturn, years, stepUp });
    if (mode === 'lumpsum') return simulateLumpsum({ amount, annualReturn, years });
    const reqM = requiredSip({ target, annualReturn, years });
    const sim = simulateSip({ monthly: reqM, annualReturn, years, stepUp: 0 });
    return { ...sim, requiredMonthly: reqM, requiredLumpsum: target / (1 + annualReturn / 100) ** years };
  }, [mode, monthly, annualReturn, years, stepUp, amount, target]);

  const fv = result.futureValue;
  const gains = fv - result.invested;

  return (
    <div className="space-y-5">
      {/* Mode tabs + currency picker */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex w-full overflow-x-auto rounded-xl border border-[#e8e2d4] bg-white p-1 sm:w-auto">
          {MODES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition sm:flex-none ${
                mode === key ? 'bg-brand-700 text-white' : 'text-slate-500 hover:text-brand-700'
              }`}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
        <select
          aria-label="Currency"
          value={cur}
          onChange={(e) => setCur(e.target.value)}
          className="rounded-xl border border-[#e8e2d4] bg-white px-3 py-2 text-sm font-semibold text-brand-700"
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.symbol} {c.code}
            </option>
          ))}
        </select>
      </div>

      {/* STICKY RESULT — always visible while you drag the sliders below */}
      <div className={`sticky ${stickyTop} z-20`}>
        <div className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 p-5 text-white shadow-lg sm:p-6">
          {mode === 'goal' ? (
            <>
              <p className="text-sm font-medium text-brand-200">
                To reach {money(target, cur)} in {years} years, invest
              </p>
              <p className="num text-3xl font-bold tracking-tight sm:text-4xl">
                {money(result.requiredMonthly, cur)}
                <span className="text-lg font-medium text-brand-200"> /month</span>
              </p>
              <div className="mt-3 h-0.5 w-12 rounded bg-gold-400" />
              <div className="mt-4 flex flex-wrap gap-2.5">
                <Chip label="Or one-time, today" value={money(result.requiredLumpsum, cur)} gold />
                <Chip label="Assumed return" value={`${annualReturn}% p.a.`} />
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-brand-200">Estimated value in {years} years</p>
              <p className="num text-3xl font-bold tracking-tight sm:text-4xl">{money(fv, cur)}</p>
              <div className="mt-3 h-0.5 w-12 rounded bg-gold-400" />
              <div className="mt-4 flex flex-wrap gap-2.5">
                <Chip label="You invest" value={money(result.invested, cur)} />
                <Chip label="Est. returns" value={money(gains, cur)} gold />
                {showReal && (
                  <Chip label={`Today's value (${inflation}% infl.)`} value={money(realValue(fv, inflation, years), cur)} />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Inputs */}
        <div className="card space-y-6 p-6">
          <h2 className="font-display text-lg font-bold text-slate-900">Your plan</h2>
          {mode === 'sip' && (
            <>
              <Slider label="Monthly investment" value={monthly} set={setMonthly} min={0} max={200000} step={500} fmt={(v) => money(v, cur)} />
              <Slider label="Annual step-up" value={stepUp} set={setStepUp} min={0} max={25} step={1} fmt={(v) => `${v}%`} />
            </>
          )}
          {mode === 'lumpsum' && (
            <Slider label="One-time investment" value={amount} set={setAmount} min={0} max={10000000} step={10000} fmt={(v) => money(v, cur)} />
          )}
          {mode === 'goal' && (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-slate-600">Target amount</span>
                <span className="num text-base font-bold text-brand-800">{money(target, cur)}</span>
              </div>
              <input type="range" min={0} max={100000000} step={500000} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="mt-2 w-full accent-brand-600" />
              <div className="mt-2.5 flex flex-wrap gap-2">
                {[5000000, 10000000, 50000000].map((t) => (
                  <button key={t} onClick={() => setTarget(t)} className={`chip border transition ${target === t ? 'border-gold-400 bg-gold-50 text-gold-700' : 'border-[#e8e2d4] bg-white text-slate-500 hover:border-gold-300'}`}>
                    {compactMoney(t, cur)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Slider label="Expected return (p.a.)" value={annualReturn} set={setReturn} min={1} max={20} step={0.5} fmt={(v) => `${v}%`} />
          <Slider label="Time period" value={years} set={setYears} min={1} max={40} step={1} fmt={(v) => `${v} yr`} />
          <Slider label="Inflation (p.a.)" value={inflation} set={setInflation} min={0} max={12} step={0.5} fmt={(v) => `${v}%`} />

          <label className="flex cursor-pointer items-center gap-2 border-t border-[#efeadd] pt-4 text-sm text-slate-600">
            <input type="checkbox" checked={showReal} onChange={(e) => setShowReal(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            Show inflation-adjusted value
          </label>
        </div>

        {/* Chart */}
        <div className="card flex flex-col p-6">
          <h2 className="font-display text-lg font-bold text-slate-900">Growth over time</h2>
          <div className="mt-2 flex-1">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={result.series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ece6d8" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(y) => `${y}y`} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => compactMoney(v, cur)} />
                <Tooltip formatter={(v, n) => [money(v, cur), n === 'invested' ? 'Invested' : 'Gains']} labelFormatter={(y) => `Year ${y}`} />
                <Area type="monotone" dataKey="invested" stackId="1" stroke={GOLD} fill={GOLD} fillOpacity={0.85} />
                <Area type="monotone" dataKey="gains" stackId="1" stroke={NAVY} fill={NAVY} fillOpacity={0.9} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex items-center justify-center gap-5 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: GOLD }} /> Invested</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: NAVY }} /> Gains</span>
          </div>
        </div>
      </div>
    </div>
  );
}
