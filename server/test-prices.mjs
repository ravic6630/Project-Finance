// Price selection — pure, no network and no server needed.
//   node test-prices.mjs
//
// Guards the rule that decides between Yahoo's realtime quote and its daily
// bars. It exists because Yahoo froze the realtime quote for every Indian REIT
// and InvIT in July 2024 (it files them as MUTUALFUND) while continuing to
// publish correct daily bars: MINDSPACE.NS answered regularMarketPrice 345.06
// stamped 2024-07-23 for over two years against a real ~492 close, which
// reported a genuine +6% position as a 25.8% loss.
import { pickPrice } from './src/services/prices.js';

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label} ${extra}`);
  }
};

const DAY = 86400;
// A fixed clock: these payloads are hand-built, so nothing here depends on when
// the suite runs.
const T = 1787000000; // some session's open

// Build one chart result. `closes` may contain nulls, exactly as Yahoo pads
// holidays and halted sessions.
const chart = ({ quote, quoteTime, closes = [], startTime = T - 4 * DAY, step = DAY }) => ({
  meta: {
    ...(quote === undefined ? {} : { regularMarketPrice: quote }),
    ...(quoteTime === undefined ? {} : { regularMarketTime: quoteTime }),
    currency: 'INR',
  },
  timestamp: closes.map((_, i) => startTime + i * step),
  indicators: { quote: [{ close: closes }] },
});

console.log('— price selection —');

/* ------------------------ the bug this exists for ------------------------- */
// Real shape of the MINDSPACE.NS response, to scale: a quote from 2024 beside
// bars from 2026.
const mindspace = chart({
  quote: 345.06,
  quoteTime: 1721764800, // 2024-07-23
  closes: [496.75, 494.38, 487.72, 487.55, 492.58],
  startTime: 1787000000, // 2026-08
});
const m = pickPrice(mindspace);
ok(m.price === 492.58, 'stale quote is refused in favour of the latest close', String(m.price));
ok(m.source === 'yahoo-close', 'and the fallback is recorded as its own source', m.source);

/* ------------------------- the ordinary stock path ------------------------ */
// Mid-session: the quote is newer than today's in-progress bar, so it wins —
// this is the common case and must not change.
const live = pickPrice(chart({ quote: 443.5, quoteTime: T + 3 * DAY + 3600, closes: [453.3, 448.75, 444, 437.75, 444.6] }));
ok(live.price === 443.5, 'a live quote beats the daily bar', String(live.price));
ok(live.source === 'yahoo', 'and stays labelled as a quote', live.source);

// Exactly at the bar's timestamp — still current, not stale.
const tie = pickPrice(chart({ quote: 100, quoteTime: T + 4 * DAY, closes: [90, 91, 92, 93, 94] }));
ok(tie.price === 100, 'a quote stamped exactly at the bar is still current', String(tie.price));

// A weekend: the last bar is Friday's, the quote is Friday's close.
const weekend = pickPrice(chart({ quote: 275.9, quoteTime: T + 4 * DAY + 20000, closes: [270, 272, 274, 275, 275.74] }));
ok(weekend.price === 275.9, 'a weekend quote is not mistaken for a stale one', String(weekend.price));

/* ------------------------------ ragged data ------------------------------- */
// Yahoo pads holidays with nulls. The newest REAL close must win, not the last
// array slot — and not a null that would read as "no price at all".
const padded = pickPrice(chart({ quote: 10, quoteTime: T - 10 * DAY, closes: [100, 101, 102.5, null, null] }));
ok(padded.price === 102.5, 'null-padded bars fall back to the newest real close', String(padded.price));

// A zero close is not a price.
const zeroed = pickPrice(chart({ quote: 10, quoteTime: T - 10 * DAY, closes: [100, 101, 0, 0, 0] }));
ok(zeroed.price === 101, 'a zero close is skipped, not treated as a price', String(zeroed.price));

/* -------------------------- one side or the other ------------------------- */
// A newly listed instrument can have a quote and no bars yet.
const noBars = pickPrice(chart({ quote: 55, quoteTime: T, closes: [] }));
ok(noBars.price === 55 && noBars.source === 'yahoo', 'no bars at all: the quote stands', JSON.stringify(noBars));

// No quote field, but bars are present.
const noQuote = pickPrice(chart({ closes: [10, 11, 12] }));
ok(noQuote.price === 12 && noQuote.source === 'yahoo-close', 'no quote: the newest bar is used', JSON.stringify(noQuote));

// Nothing usable. The caller turns a null into a thrown "No price" — it must
// never reach a holding as 0, which would read as a total loss.
ok(pickPrice(chart({ closes: [] })).price === null, 'nothing usable => null, never zero');
ok(pickPrice(undefined).price === null, 'a missing result => null, not a crash');
ok(pickPrice({}).price === null, 'an empty result => null, not a crash');

/* ------------------------------ the guard rails --------------------------- */
// Without a timestamp there is no evidence the quote is stale, so it stands.
// This is deliberately conservative: it keeps the pre-existing behaviour for any
// instrument Yahoo answers differently.
const noTime = pickPrice(chart({ quote: 345.06, closes: [490, 491, 492.58] }));
ok(noTime.price === 345.06, 'no quote timestamp: the quote is trusted (no evidence against it)', String(noTime.price));

// A non-positive quote is not a price, whatever its timestamp says.
const zeroQuote = pickPrice(chart({ quote: 0, quoteTime: T + 9 * DAY, closes: [490, 492.58] }));
ok(zeroQuote.price === 492.58, 'a zero quote is refused even when it is the fresher one', String(zeroQuote.price));
const negQuote = pickPrice(chart({ quote: -5, quoteTime: T + 9 * DAY, closes: [490, 492.58] }));
ok(negQuote.price === 492.58, 'a negative quote is refused too', String(negQuote.price));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
