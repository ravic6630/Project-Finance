// Premium pricing per currency + which payment provider serves which country.
// Annual = 12 months minus a 10% discount.

const ANNUAL_DISCOUNT = 0.1;

// Monthly price in each supported currency.
const MONTHLY = { INR: 99, USD: 1.99, GBP: 1.49, EUR: 1.79, AUD: 2.99, NZD: 3.49, CAD: 2.79 };
const SYMBOL = { INR: '₹', USD: '$', GBP: '£', EUR: '€', AUD: 'A$', NZD: 'NZ$', CAD: 'C$' };

const round2 = (n) => Math.round(n * 100) / 100;

export function planFor(currency, interval = 'monthly') {
  const cur = MONTHLY[currency] ? currency : 'USD';
  const monthly = MONTHLY[cur];
  if (interval === 'annual') {
    const amount = round2(monthly * 12 * (1 - ANNUAL_DISCOUNT));
    return {
      currency: cur,
      symbol: SYMBOL[cur],
      interval: 'annual',
      amount,
      monthly_equiv: round2(amount / 12),
      save_pct: Math.round(ANNUAL_DISCOUNT * 100),
    };
  }
  return { currency: cur, symbol: SYMBOL[cur], interval: 'monthly', amount: round2(monthly) };
}

// India → Razorpay (UPI + card). Everyone else → Stripe (Apple Pay / Google Pay / card).
export const providerFor = (currency) => (currency === 'INR' ? 'razorpay' : 'stripe');

// Smallest currency unit (paise / cents) for the payment APIs.
export const minorUnits = (amount) => Math.round(amount * 100);
