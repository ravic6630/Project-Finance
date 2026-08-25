import { AlertTriangle, Coins, Info, Landmark, Wallet } from 'lucide-react';
import { Counter, Spotlight } from '../fx.jsx';
import { dateLabel, money } from '../../lib/format.js';

/* ============================================================================
   "Your portfolio pays you X a year."

   Two numbers live on this card and they are NOT the same kind of thing:
   the forward income is an ESTIMATE projected from the last twelve months of
   declared payouts, and the received figure is CASH the user actually logged.
   Everything here — chips, colour, wording, placement — exists to keep those
   two apart. An estimate that reads as money in the bank is a lie told softly.
   ========================================================================== */

// format.js's percent() prefixes a sign ("+3.2%") because it formats CHANGE.
// A yield isn't a change, and "+3.2% yield" reads as growth in the yield.
const pct = (n, digits = 2) => (n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(digits)}%`);

// Per-share payouts are often sub-unit (a $0.21 Alphabet dividend), where the
// 2-decimal money() would round a real payout down to nothing.
function perShare(v, currency) {
  if (v == null || !Number.isFinite(v)) return '—';
  const digits = Math.abs(v) < 1 ? 4 : 2;
  if (digits === 2) return money(v, currency);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(v);
  } catch {
    return money(v, currency);
  }
}

const shares = (n) =>
  !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n);

/* --------------------------------- shell ---------------------------------- */
function Panel({ children }) {
  return (
    <Spotlight className="card overflow-hidden">
      <div className="p-6 sm:p-8">
        <header className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <Coins size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-bold tracking-tight text-slate-900">
              What your portfolio pays you
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              The income your holdings throw off on their own — dividends declared over the last
              twelve months, carried forward.
            </p>
          </div>
        </header>
        {children}
      </div>
    </Spotlight>
  );
}

function Quiet({ icon: Icon, title, body }) {
  return (
    <Panel>
      <div className="rule-fade my-6" />
      <div className="flex items-start gap-3 text-sm">
        <Icon size={16} className="mt-0.5 shrink-0 text-slate-400" />
        <div>
          <p className="font-semibold text-slate-700">{title}</p>
          <p className="mt-1 max-w-xl leading-relaxed text-slate-500">{body}</p>
        </div>
      </div>
    </Panel>
  );
}

/* --------------------------------- stats ---------------------------------- */
function Stat({ label, value, sub, tone = 'plain' }) {
  const skin =
    tone === 'actual'
      ? 'border-gold-200 bg-gold-50/60'
      : 'border-[#e8e2d4] bg-[#faf8f1]';
  return (
    <div className={`rounded-xl border p-4 ${skin}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="num mt-1.5 text-lg font-semibold tracking-tight text-slate-900">{value}</p>
      {sub ? <p className="mt-1 text-xs leading-snug text-slate-500">{sub}</p> : null}
    </div>
  );
}

/* --------------------------------- panel ---------------------------------- */
export default function DividendsPanel({ data, base = 'INR' }) {
  if (!data) return null;

  if (data.error) {
    return (
      <Quiet
        icon={AlertTriangle}
        title="This section didn't load"
        body={data.error}
      />
    );
  }

  const cov = data.coverage || { holdings: 0, covered: 0, unsupported: 0 };
  const funds = cov.funds ?? 0;
  const noTicker = Math.max(0, (cov.unsupported ?? 0) - funds);
  const failed = cov.failed ?? 0;
  const rows = Array.isArray(data.by_holding) ? data.by_holding : [];
  const payers = rows.filter((h) => h.income > 0);
  const nonPayers = cov.covered - payers.length;
  const recent = Array.isArray(data.recent) ? data.recent : [];
  const received = Number(data.received_12m) || 0;
  const receivedCount = data.received_count ?? 0;

  // Nothing to price yet.
  if (!cov.holdings) {
    return (
      <Quiet
        icon={Wallet}
        title="No holdings to pay you yet"
        body="Add your first stock or fund and this card will show what it pays out — real declared dividends, not a model."
      />
    );
  }

  // Holdings exist, but not one of them could be checked. Say so; don't render
  // a confident zero over a portfolio we never looked at.
  if (!cov.covered) {
    return (
      <Quiet
        icon={Info}
        title="No income data for this portfolio"
        body={
          data.note ||
          "None of your holdings have a dividend feed we can read, so there's no income figure to show."
        }
      />
    );
  }

  const max = Math.max(...payers.map((h) => h.income), 0);
  const coverageBits = [`${cov.covered} of ${cov.holdings} holdings checked`];
  if (funds) coverageBits.push(`${funds} mutual ${funds === 1 ? 'fund' : 'funds'} not covered`);
  if (noTicker) coverageBits.push(`${noTicker} without a ticker`);
  if (failed) coverageBits.push(`${failed} couldn't be reached`);

  return (
    <Panel>
      <div className="rule-fade my-6" />

      {/* ---- the headline. An estimate, and it says so twice. ---- */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Forward income · next 12 months
            </span>
            <span className="chip bg-gold-100 text-gold-700">Estimate</span>
          </div>
          <p className="num mt-2 text-4xl font-semibold tracking-tight text-slate-900 sm:text-[2.75rem]">
            <Counter value={data.forward_income || 0} format={(v) => money(v, base)} />
          </p>
          <div className="gold-rule mt-4" />
          {payers.length ? (
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              About{' '}
              <span className="num font-semibold text-slate-700">
                {money(data.monthly_equivalent, base)}
              </span>{' '}
              a month — projected by assuming the payouts of the last twelve months repeat.
              Companies can raise, cut or skip a dividend at any time.
            </p>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              Not a gap in the data: none of the {cov.covered} holdings we checked declared a
              dividend in the last twelve months, so there is nothing to carry forward.
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Yield on cost"
            value={pct(data.yield_on_cost_pct)}
            sub={
              data.yield_on_cost_pct == null
                ? 'No cost basis recorded'
                : `of ${money(data.covered_cost, base, { compact: true })} invested`
            }
          />
          <Stat
            label="Current yield"
            value={pct(data.current_yield_pct)}
            sub={
              data.current_yield_pct == null
                ? 'No market value to divide by'
                : `of ${money(data.covered_value, base, { compact: true })} today`
            }
          />
          <Stat
            tone="actual"
            label="Received · 12 mo"
            value={receivedCount ? money(received, base) : '—'}
            sub={
              receivedCount
                ? `Actual cash — ${receivedCount} logged ${receivedCount === 1 ? 'entry' : 'entries'}`
                : 'No dividend or interest income logged'
            }
          />
        </div>
      </div>

      <div className="rule-fade my-7" />

      {/* ---- who pays what, and what landed when ---- */}
      <div className="grid gap-7 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Where it comes from
          </h3>
          {payers.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[440px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th scope="col" className="pb-2 font-semibold">
                      Holding
                    </th>
                    <th scope="col" className="pb-2 text-right font-semibold">
                      Per share
                    </th>
                    <th scope="col" className="pb-2 text-right font-semibold">
                      Yield
                    </th>
                    <th scope="col" className="pb-2 text-right font-semibold">
                      A year
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payers.map((h, i) => (
                    <tr
                      key={`${h.symbol}-${h.name}-${i}`}
                      className="border-t border-slate-100 transition-colors duration-200 hover:bg-slate-50/60"
                    >
                      <td className="py-2.5 pr-3 align-top">
                        <p className="truncate font-medium text-slate-800" title={h.name}>
                          {h.name}
                        </p>
                        <p className="num mt-0.5 text-xs text-slate-500">
                          {h.symbol} · {shares(h.shares)} sh
                          {h.stale ? ' · cached' : ''}
                        </p>
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-gold-400 to-gold-200"
                            style={{ width: `${max > 0 ? Math.max(3, (h.income / max) * 100) : 0}%` }}
                          />
                        </div>
                      </td>
                      <td className="num py-2.5 text-right align-top text-slate-600">
                        {perShare(h.per_share_12m, h.currency)}
                      </td>
                      <td className="num py-2.5 text-right align-top text-slate-600">
                        {pct(h.yield_pct, 1)}
                      </td>
                      <td className="num py-2.5 pl-3 text-right align-top font-semibold text-slate-900">
                        {money(h.income, base)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              None of the {cov.covered} holdings we checked declared a dividend in the last twelve
              months. That&apos;s a real answer, not a gap — growth companies commonly pay nothing.
            </p>
          )}

          {payers.length && nonPayers > 0 ? (
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              {nonPayers} other checked {nonPayers === 1 ? 'holding paid' : 'holdings paid'} nothing
              over the period.
            </p>
          ) : null}
        </div>

        <div className="lg:col-span-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Recent payouts
          </h3>
          {recent.length ? (
            <>
              <ul className="mt-3 divide-y divide-slate-100">
                {recent.map((p, i) => (
                  <li key={`${p.symbol}-${p.date}-${i}`} className="flex items-baseline gap-3 py-2">
                    <span className="num w-[86px] shrink-0 text-xs text-slate-500">
                      {dateLabel(p.date)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700" title={p.name}>
                      {p.name}
                    </span>
                    <span className="num shrink-0 text-sm font-semibold text-slate-900">
                      {money(p.amount, base)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                Declared per-share amounts are exact; the value shown applies them to the number of
                shares you hold <span className="italic">today</span>, so it isn&apos;t necessarily
                what reached your account then.
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              No payouts recorded against your holdings in the last twelve months.
            </p>
          )}
        </div>
      </div>

      {/* ---- the honest footer ---- */}
      <div className="mt-7 rounded-xl border border-[#e8e2d4] bg-[#faf8f1] p-4">
        <div className="flex items-start gap-2.5">
          <Landmark size={14} className="mt-0.5 shrink-0 text-slate-400" />
          <div className="min-w-0 text-xs leading-relaxed text-slate-500">
            <p className="font-semibold text-slate-600">{coverageBits.join(' · ')}</p>
            {data.note ? <p className="mt-1">{data.note}</p> : null}
            {data.window ? (
              <p className="mt-1">
                Trailing twelve months to {dateLabel(data.window.to)}. Every figure is converted to{' '}
                {base}.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </Panel>
  );
}
