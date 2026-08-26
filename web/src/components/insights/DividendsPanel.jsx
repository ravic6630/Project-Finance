import { motion, useReducedMotion } from 'framer-motion';
import { Coins } from 'lucide-react';
import { Counter, Spotlight } from '../fx.jsx';
import { dateLabel, money } from '../../lib/format.js';
import Details from './Details.jsx';

/* ============================================================================
   "What your portfolio pays you."

   One sentence, one number. The number is the income the holdings are set to
   throw off over the next year — an estimate, said once, quietly, in the
   caption under it. The cash the user actually logged is a different kind of
   thing and sits beside the verdict as a plain fact.

   Everything that justifies the estimate — the yields, the per-holding table,
   the payout history, what we could and couldn't check — is one click down.
   ========================================================================== */

const EASE = [0.16, 1, 0.3, 1];

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

function Bar({ pct: value, delay = 0 }) {
  const reduced = useReducedMotion();
  const w = `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-gold-400 to-gold-200"
        initial={reduced ? false : { width: 0 }}
        animate={{ width: w }}
        transition={{ duration: 0.45, ease: EASE, delay }}
      />
    </div>
  );
}

/* --------------------------------- shell ---------------------------------- */
function Panel({ children }) {
  return (
    <Spotlight className="card overflow-hidden">
      <div className="p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Coins size={18} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <h2 className="font-display text-lg font-bold tracking-tight text-slate-900">
            What your portfolio pays you
          </h2>
        </div>
        {children}
      </div>
    </Spotlight>
  );
}

// The quiet states all read the same way: the verdict, then one plain line.
function Plain({ verdict, body, action, children }) {
  return (
    <Panel>
      <p className="mt-4 text-[15px] font-semibold leading-snug text-slate-800">{verdict}</p>
      {body ? <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{body}</p> : null}
      {action ? <p className="mt-5 text-sm text-slate-500">{action}</p> : null}
      {children}
    </Panel>
  );
}

/* --------------------------------- panel ---------------------------------- */
export default function DividendsPanel({ data, base = 'INR' }) {
  if (!data) return null;

  if (data.error) {
    return <Plain verdict="This section didn't load." body={data.error} />;
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

  // Nothing to price yet. Logged cash still exists in this state (bank interest
  // needs no holding), so it must be said rather than swallowed.
  if (!cov.holdings) {
    return (
      <Plain
        verdict="Nothing you hold pays you yet."
        body={
          receivedCount
            ? `You did log ${money(received, base)} of dividend and interest income last year.`
            : null
        }
        action="Add a stock or a fund and this card will show what it pays out."
      >
        {receivedCount ? (
          <Details label="The detail">
            <p>
              That is {receivedCount} {receivedCount === 1 ? 'entry' : 'entries'} you filed as
              dividend or interest income
              {data.window ? <> in the twelve months to {dateLabel(data.window.to)}</> : null}, all
              converted to {base}. It isn&apos;t attached to a holding, so nothing here projects it
              forward.
            </p>
          </Details>
        ) : null}
      </Plain>
    );
  }

  // Holdings exist, but not one of them could be checked. Say so; don't render
  // a confident zero over a portfolio we never looked at — and don't claim there
  // is no income figure when the reader has logged one.
  if (!cov.covered) {
    return (
      <Plain
        verdict="We couldn't check any of your holdings for payouts."
        body={
          receivedCount
            ? `You logged ${money(received, base)} of dividend and interest income last year.`
            : "So there's no income figure to show here."
        }
      >
        {data.note || receivedCount ? (
          <Details label={data.note ? 'Why' : 'The detail'}>
            {data.note ? <p>{data.note}</p> : null}
            {receivedCount ? (
              <p>
                <span className="num font-semibold text-slate-600">{money(received, base)}</span> is
                cash you logged yourself — {receivedCount}{' '}
                {receivedCount === 1 ? 'entry' : 'entries'} filed as dividend or interest income.
                Nothing on this card is estimated from your holdings.
              </p>
            ) : null}
          </Details>
        ) : null}
      </Plain>
    );
  }

  const yieldPct = data.current_yield_pct;
  const top = payers.slice(0, 5);
  const max = Math.max(...payers.map((h) => h.income), 0);

  // Some holdings are always out of reach — Indian funds have no payout feed,
  // untickered rows can't be looked up, a feed can time out. Every sentence
  // below is about the ones we actually priced, so when that isn't the whole
  // portfolio the sentence has to say so.
  const partial = cov.covered < cov.holdings;
  const who = partial ? 'The holdings we checked' : 'Your holdings';

  // The verdict, read off the payload. A portfolio of growth stocks paying
  // nothing is a real answer, not a gap — and it must never be dressed up.
  // Nothing here claims consistency over time: a trailing year of payouts can
  // say how much, never how reliably.
  let verdict;
  if (!payers.length) {
    verdict = partial
      ? 'None of the holdings we could check paid a dividend last year.'
      : 'Nothing you hold paid a dividend last year.';
  } else if (yieldPct != null && yieldPct >= 3) verdict = `${who} pay you a solid income.`;
  else if (yieldPct != null && yieldPct >= 1.5) verdict = `${who} pay you a modest income.`;
  else if (yieldPct != null && yieldPct > 0) verdict = `${who} pay you a little.`;
  else verdict = 'Some of your holdings pay you an income.';

  // Only when there is something for the reader to do about it.
  let action = null;
  if (payers.length && !receivedCount) {
    action = 'Log your payouts as income to see what actually reached you.';
  } else if (noTicker) {
    action =
      noTicker === 1
        ? 'Add a ticker to that holding and it counts here too.'
        : 'Add a ticker to those holdings and they count here too.';
  }

  const coverageBits = [`${cov.covered} of ${cov.holdings} holdings checked`];
  if (funds) coverageBits.push(`${funds} mutual ${funds === 1 ? 'fund' : 'funds'} not covered`);
  if (noTicker) coverageBits.push(`${noTicker} without a ticker`);
  if (failed) coverageBits.push(`${failed} couldn't be reached`);

  return (
    <Panel>
      {/* -------------------------------- verdict ---------------------------- */}
      <p className="mt-4 text-[15px] font-semibold leading-snug text-slate-800">{verdict}</p>
      {receivedCount ? (
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
          You logged <span className="num font-semibold text-slate-700">{money(received, base)}</span>{' '}
          of dividend and interest income over the past year.
        </p>
      ) : null}

      <div
        className={
          payers.length
            ? 'mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start'
            : 'mt-5'
        }
      >
        {/* ----------------------------- the number -------------------------- */}
        <div>
          <p className="num text-4xl font-bold leading-none tracking-tight text-slate-900">
            <Counter value={data.forward_income || 0} format={(v) => money(v, base)} />
          </p>
          <p className="mt-1.5 text-sm text-slate-500">
            {payers.length ? (
              <>
                estimated for the next year — about{' '}
                <span className="num text-slate-700">{money(data.monthly_equivalent, base)}</span> a
                month
              </>
            ) : (
              <>estimated for the next year, from the holdings we checked</>
            )}
          </p>
        </div>

        {/* --------------------------- where it comes from ------------------- */}
        {payers.length ? (
          <div>
            <h3 className="text-xs font-semibold text-slate-500">Where it comes from</h3>
            <ul className="mt-3 space-y-3">
              {top.map((h, i) => (
                <li key={`${h.symbol}-${h.name}-${i}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm text-slate-700" title={h.name}>
                      {h.name}
                    </span>
                    <span className="num shrink-0 text-sm font-semibold text-slate-900">
                      {money(h.income, base)}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Bar pct={max > 0 ? Math.max(3, (h.income / max) * 100) : 0} delay={0.04 * i} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              {payers.length} of {cov.covered} checked holdings pay out
            </p>
          </div>
        ) : null}
      </div>

      {/* ------------------------------ action line -------------------------- */}
      {action ? <p className="mt-5 text-sm text-slate-500">{action}</p> : null}

      {/* -------------------------------- working ---------------------------- */}
      <Details label="How this is estimated">
        <p>
          The figure above assumes the payouts of the last twelve months repeat over the next
          twelve. Companies can raise, cut or skip a dividend at any time, so treat it as a guide.
        </p>

        <div>
          <p className="font-semibold text-slate-700">What that income is a share of</p>
          <ul className="mt-2 space-y-1.5">
            <li>
              <span className="num font-semibold text-slate-600">{pct(data.yield_on_cost_pct)}</span>{' '}
              {data.yield_on_cost_pct == null
                ? '— no cost recorded for the holdings we checked'
                : `of the ${money(data.covered_cost, base, { compact: true })} you put into them`}
            </li>
            <li>
              <span className="num font-semibold text-slate-600">{pct(data.current_yield_pct)}</span>{' '}
              {data.current_yield_pct == null
                ? '— no market value to compare it against'
                : `of the ${money(data.covered_value, base, { compact: true })} they are worth today`}
            </li>
          </ul>
        </div>

        <p>
          {receivedCount ? (
            <>
              <span className="num font-semibold text-slate-600">{money(received, base)}</span> is
              cash you actually logged — {receivedCount} {receivedCount === 1 ? 'entry' : 'entries'}{' '}
              filed as dividend or interest income. The estimate above doesn&apos;t use it.
            </>
          ) : (
            <>
              You haven&apos;t logged any dividend or interest income, so there is nothing to
              compare the estimate against.
            </>
          )}
        </p>

        {payers.length ? (
          <div>
            <p className="font-semibold text-slate-700">Every holding that pays</p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[440px] text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
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
                    <tr key={`${h.symbol}-${h.name}-${i}`} className="border-t border-slate-100">
                      <td className="py-2 pr-3 align-top">
                        <p className="truncate text-slate-700" title={h.name}>
                          {h.name}
                        </p>
                        <p className="num mt-0.5 text-slate-500">
                          {h.symbol} · {shares(h.shares)} sh
                          {h.stale ? ' · cached' : ''}
                        </p>
                      </td>
                      <td className="num py-2 text-right align-top">
                        {perShare(h.per_share_12m, h.currency)}
                      </td>
                      <td className="num py-2 text-right align-top">{pct(h.yield_pct, 1)}</td>
                      <td className="num py-2 pl-3 text-right align-top font-semibold text-slate-600">
                        {money(h.income, base)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {nonPayers > 0 ? (
              <p className="mt-2">
                {nonPayers} other checked {nonPayers === 1 ? 'holding paid' : 'holdings paid'}{' '}
                nothing over the period.
              </p>
            ) : null}
          </div>
        ) : (
          <p>
            None of the {cov.covered} holdings we checked declared a dividend in the last twelve
            months. Growth companies commonly pay nothing, so that is an answer rather than a gap.
          </p>
        )}

        {recent.length ? (
          <div>
            <p className="font-semibold text-slate-700">Recent payouts</p>
            <ul className="mt-2 divide-y divide-slate-100">
              {recent.map((p, i) => (
                <li key={`${p.symbol}-${p.date}-${i}`} className="flex items-baseline gap-3 py-1.5">
                  <span className="num w-[86px] shrink-0 text-slate-500">{dateLabel(p.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-600" title={p.name}>
                    {p.name}
                  </span>
                  <span className="num shrink-0 font-semibold text-slate-600">
                    {money(p.amount, base)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2">
              The declared per-share amounts are exact; the value beside each one applies them to
              the number of shares you hold <span className="italic">today</span>, so it isn&apos;t
              necessarily what reached your account then.
            </p>
          </div>
        ) : (
          <p>No payouts were recorded against your holdings in the last twelve months.</p>
        )}

        <div>
          <p className="font-semibold text-slate-700">{coverageBits.join(' · ')}</p>
          {data.note ? <p className="mt-1">{data.note}</p> : null}
          {data.window ? (
            <p className="mt-1">
              The twelve months to {dateLabel(data.window.to)}. Every figure is converted to {base}.
            </p>
          ) : null}
        </div>
      </Details>
    </Panel>
  );
}
