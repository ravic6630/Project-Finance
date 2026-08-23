import { useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  MotionConfig,
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from 'framer-motion';
import {
  ArrowRight,
  Bell,
  Building2,
  Calculator,
  Globe2,
  LineChart,
  Link2,
  MessageCircle,
  PiggyBank,
  ShieldCheck,
  Sprout,
  Target,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import {
  Aurora,
  Counter,
  Magnetic,
  Marquee,
  Reveal,
  Sparkline,
  Spotlight,
  TextReveal,
  Tilt,
  settle,
} from '../components/fx';

/* ---------------------------------------------------------------- helpers -- */

const fmtINR = (v) => '₹' + Math.round(v).toLocaleString('en-IN');

// Entrance animations only play when the page loads in a VISIBLE tab. Opened in
// a background tab (or anywhere requestAnimationFrame is frozen), the page
// renders its finished state instantly — marketing content must never be stuck
// invisible waiting for an animation that can't run.
const ENTER =
  typeof document === 'undefined' || document.visibilityState === 'visible';

// Hero entrances are hand-sequenced rather than variant-staggered, so the
// headline's word-rise and the copy beneath it read as one movement.
const enter = (delay) => ({
  initial: ENTER ? { opacity: 0, y: 18 } : false,
  animate: { opacity: 1, y: 0 },
  transition: { ...settle, delay },
});

// Display type: Fraunces ships with -0.01em baked into .font-display, which
// beats Tailwind's tracking-* utilities in the cascade — so the tighter
// setting large sizes need has to come through style.
const TIGHT = { letterSpacing: '-0.028em' };

/* ---------------------------------------------------- hero mock dashboard -- */

function MockDashboard({ cardStyle, chipTopStyle, chipBottomStyle }) {
  return (
    <motion.div style={cardStyle} className="relative">
      <Tilt max={4} className="relative">
        <Spotlight
          as={motion.div}
          initial={ENTER ? { opacity: 0, y: 30, rotate: -1 } : false}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 160, damping: 22, delay: 0.15 }}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-6 text-white shadow-2xl shadow-brand-900/30 ring-1 ring-white/10"
        >
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="aurora-blob absolute -right-14 -top-20 h-52 w-52 rounded-full bg-gold-400/25 blur-3xl" />
          </div>

          <p className="relative flex items-center gap-1.5 text-xs font-medium text-gold-300">
            <Sprout size={13} /> Good morning, Asha
          </p>
          <p className="relative mt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-200">
            Total net worth
          </p>
          <p
            className="num relative mt-1 text-[2rem] font-bold leading-none sm:text-[2.6rem]"
            style={TIGHT}
          >
            {ENTER ? <Counter value={2460000} format={fmtINR} /> : fmtINR(2460000)}
          </p>
          <div aria-hidden className="gold-rule relative mt-3" />
          <p className="relative mt-3 text-xs">
            <span className="num font-semibold text-emerald-300">▲ ₹41,280 (+1.7%)</span>{' '}
            <span className="text-brand-200">this month · growing 🌱</span>
          </p>

          {/* self-drawing wealth curve */}
          <svg viewBox="0 0 320 110" className="relative mt-4 w-full" aria-hidden>
            <defs>
              <linearGradient id="lgFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c2a368" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#c2a368" stopOpacity="0" />
              </linearGradient>
            </defs>
            <motion.path
              d="M0,96 C30,92 48,84 72,80 C100,75 118,64 148,60 C176,56 196,44 224,36 C252,28 284,20 320,12 L320,110 L0,110 Z"
              fill="url(#lgFill)"
              initial={ENTER ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.15, duration: 0.7 }}
            />
            <motion.path
              d="M0,96 C30,92 48,84 72,80 C100,75 118,64 148,60 C176,56 196,44 224,36 C252,28 284,20 320,12"
              fill="none"
              stroke="#e7d2a4"
              strokeWidth="2.5"
              strokeLinecap="round"
              initial={ENTER ? { pathLength: 0 } : false}
              animate={{ pathLength: 1 }}
              transition={{ delay: 0.45, duration: 1.6, ease: 'easeInOut' }}
            />
          </svg>

          <div className="relative mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              ['Stocks', '₹14.2L'],
              ['Mutual funds', '₹6.8L'],
              ['Cash', '₹3.6L'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-white/10 px-2 py-2 ring-1 ring-inset ring-white/10">
                <p className="text-[10px] font-medium text-brand-200">{k}</p>
                <p className="num text-sm font-bold">{v}</p>
              </div>
            ))}
          </div>
        </Spotlight>
      </Tilt>

      {/* floating accent chips — they drift on scroll rather than looping, so
          nothing is ever moving next to the number while you read it. */}
      <motion.div
        style={chipTopStyle}
        initial={ENTER ? { opacity: 0, scale: 0.85 } : false}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...settle, delay: 1.05 }}
        className="num absolute -right-3 -top-4 flex items-center gap-1.5 rounded-full bg-gold-400 px-3 py-1.5 text-xs font-bold text-brand-900 shadow-lg shadow-brand-900/20 sm:-right-6"
      >
        <Trophy size={13} /> ₹10L club
      </motion.div>
      <motion.div
        style={chipBottomStyle}
        initial={ENTER ? { opacity: 0, scale: 0.85 } : false}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...settle, delay: 1.25 }}
        className="absolute -bottom-4 -left-3 flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-emerald-600 shadow-lg ring-1 ring-slate-200 dark:text-emerald-400 sm:-left-6"
      >
        <TrendingUp size={13} /> Live prices, 7 markets
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ page --- */

// Bento layout: one wide anchor tile carrying the biggest promise, the rest
// sized to their weight. `span` is the only thing that changes per tile.
const FEATURES = [
  {
    icon: Globe2,
    title: 'Every market, one page',
    body: 'Indian, US, UK, Irish, Australian, NZ and Canadian stocks plus mutual funds — priced live, converted to your currency.',
    span: 'sm:col-span-2 lg:col-span-4 lg:row-span-2',
    feature: true,
  },
  {
    icon: Link2,
    title: 'Import in minutes',
    body: 'Connect Upstox, Zerodha, Angel One or Fyers, drop in a CAS PDF, or bring a CSV from any broker on earth.',
    span: 'lg:col-span-2',
  },
  {
    icon: LineChart,
    title: 'Watch it grow',
    body: 'A daily net-worth trend from 1 day to 10 years — with confetti when you cross ₹1Cr and beyond.',
    span: 'lg:col-span-2',
    spark: true,
  },
  {
    icon: Target,
    title: 'Goals that talk back',
    body: 'Retirement, a house, an education — see if you’re on pace and exactly what to invest monthly to get there.',
    span: 'lg:col-span-2',
  },
  {
    icon: Building2,
    title: 'Beyond the demat',
    body: 'Property, land, business, gold and cash sit beside your portfolio, so your net worth is actually complete.',
    span: 'lg:col-span-2',
  },
  {
    icon: Bell,
    title: 'Stays in touch',
    body: 'A morning email digest of your wealth, price alerts, and a real human on the in-app support chat.',
    span: 'lg:col-span-2',
  },
];

const MARKETS = [
  'India',
  'United States',
  'United Kingdom',
  'Ireland',
  'Australia',
  'New Zealand',
  'Canada',
];

const SOURCES = ['Upstox', 'Zerodha', 'Angel One', 'Fyers', 'NSDL / CDSL CAS', 'Any CSV'];

// A calm rise with two small pullbacks — honest about markets without the
// jagged, "look at me" look of noisy demo data.
const TREND = [14, 16, 15, 18, 21, 23, 22, 26, 29, 31, 30, 35, 39, 43];

const STEPS = [
  ['Create your account', 'Free, with email verification. Your currency is auto-detected.'],
  ['Bring your money in', 'Connect a broker, import a CAS PDF or CSV — or add holdings by hand.'],
  ['Watch it grow', 'Live prices, a daily net-worth trend, goals and projections. 🌱'],
];

const PREMIUM = [
  [TrendingUp, 'Auto-sync brokers with unlimited holdings'],
  [LineChart, 'Net-worth history from a day to a decade'],
  [Target, 'Goals, projections & true returns (XIRR) with tax reports'],
  [PiggyBank, 'Daily email digest of your whole portfolio'],
  [MessageCircle, 'Priority human support, right in the app'],
];

export default function Landing() {
  const heroRef = useRef(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });

  // The mockup leaves a little slower than the page and eases off as it goes —
  // felt as depth rather than noticed as an effect.
  const mockY = useTransform(scrollYProgress, [0, 1], reduced ? [0, 0] : [0, -56]);
  const mockScale = useTransform(scrollYProgress, [0, 1], reduced ? [1, 1] : [1, 0.965]);
  const mockOpacity = useTransform(scrollYProgress, [0, 0.9], reduced ? [1, 1] : [1, 0.55]);
  const chipTopY = useTransform(scrollYProgress, [0, 1], reduced ? [0, 0] : [0, -22]);
  const chipBottomY = useTransform(scrollYProgress, [0, 1], reduced ? [0, 0] : [0, 18]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[#f4f2ec] text-slate-900">
        {/* ---------------------------------------------------------- nav -- */}
        <header className="glass sticky top-0 z-40 border-b border-[#e8e2d4]">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 lg:px-8">
            <Link to="/" className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-gold-300 ring-1 ring-gold-400/30">
                <Sprout size={20} />
              </span>
              <span className="font-display truncate text-lg font-bold text-brand-800 sm:text-xl">
                Sampada
              </span>
            </Link>
            <nav className="hidden items-center gap-7 text-sm font-semibold text-slate-500 md:flex">
              <a href="#features" className="transition hover:text-brand-700">Features</a>
              <a href="#premium" className="transition hover:text-brand-700">Premium</a>
              <Link to="/calculators" className="transition hover:text-brand-700">Calculators</Link>
            </nav>
            {/* Shrink-proof: the wordmark truncates before the actions do, so the
                two entry points never collide on a small phone. */}
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <Link to="/login" className="btn-ghost px-3 sm:px-4">Sign in</Link>
              <Link to="/signup" className="btn-primary px-3 text-[13px] sm:px-4 sm:text-sm">
                Get started free
              </Link>
            </div>
          </div>
        </header>

        {/* --------------------------------------------------------- hero -- */}
        <section ref={heroRef} className="relative overflow-hidden">
          <Aurora className="opacity-70 dark:opacity-90" />

          <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-24 pt-16 lg:grid-cols-[1.06fr_0.94fr] lg:px-8 lg:pb-32 lg:pt-24">
            <div>
              <motion.p
                {...enter(0)}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700 ring-1 ring-brand-100 dark:ring-white/10"
              >
                <Sprout size={13} className="text-gold-500" /> Sampada — your wealth, all in one place
              </motion.p>

              <h1
                className="font-display mt-6 text-[2.75rem] font-bold leading-[1.02] text-brand-900 sm:text-6xl lg:text-[3.75rem] xl:text-[4.1rem]"
                style={TIGHT}
              >
                <TextReveal
                  text="Watch your wealth"
                  delay={0.1}
                  className="block [&>span]:-mb-[0.14em] [&>span]:pb-[0.14em]"
                />
                <span className="block -mb-[0.14em] overflow-hidden pb-[0.14em]">
                  <motion.span
                    className="text-gradient-gold inline-block"
                    initial={ENTER ? { y: '110%' } : false}
                    animate={{ y: 0 }}
                    transition={{ ...settle, delay: 0.27 }}
                  >
                    grow.
                  </motion.span>
                </span>
              </h1>

              <motion.p {...enter(0.34)} className="mt-6 max-w-lg text-lg leading-relaxed text-slate-600">
                Stocks across 7 markets, mutual funds, cash, property and gold — tracked live, in your
                currency, with goals that tell you exactly what it takes to get there.
              </motion.p>

              <motion.div {...enter(0.42)} className="mt-9 flex flex-wrap items-center gap-3">
                <Magnetic strength={0.2}>
                  <Link
                    to="/signup"
                    className="group inline-flex items-center gap-2 rounded-xl bg-brand-700 px-7 py-4 font-semibold text-white shadow-lg shadow-brand-900/20 ring-1 ring-inset ring-white/10 transition duration-200 hover:bg-brand-800"
                  >
                    Start free
                    <ArrowRight size={17} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                  </Link>
                </Magnetic>
                <Link
                  to="/calculators"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-4 font-semibold text-brand-700 ring-1 ring-[#e8e2d4] transition duration-200 hover:ring-gold-300 dark:ring-white/10"
                >
                  <Calculator size={17} /> Try the calculators
                </Link>
              </motion.div>

              <motion.p {...enter(0.5)} className="mt-5 flex items-center gap-1.5 text-sm text-slate-400">
                <ShieldCheck size={15} className="text-emerald-500" />
                Free to start · no card needed · read-only broker access
              </motion.p>
            </div>

            <MockDashboard
              cardStyle={{ y: mockY, scale: mockScale, opacity: mockOpacity }}
              chipTopStyle={{ y: chipTopY }}
              chipBottomStyle={{ y: chipBottomY }}
            />
          </div>
        </section>

        {/* --------------------------------------------------- trust strip -- */}
        <section className="border-y border-[#e8e2d4] bg-[#faf9f5]">
          <div className="mx-auto max-w-6xl px-4 py-7 lg:px-8">
            <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              Brings your money in from
            </p>
            <Marquee speed={34} className="mt-4">
              {SOURCES.map((n) => (
                <span
                  key={n}
                  className="flex shrink-0 items-center gap-3 whitespace-nowrap text-sm font-bold text-slate-500"
                >
                  <span aria-hidden className="h-1.5 w-1.5 rotate-45 bg-gold-300" />
                  {n}
                </span>
              ))}
            </Marquee>
          </div>
        </section>

        {/* ------------------------------------------------------ features -- */}
        <section id="features" className="mx-auto max-w-6xl px-4 py-24 lg:px-8">
          <Reveal className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-600">
              The whole picture
            </p>
            <h2
              className="font-display mt-4 text-4xl font-bold text-brand-900 sm:text-5xl"
              style={TIGHT}
            >
              Everything you own, <span className="text-gold-600">finally together</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-500">
              Sampada means prosperity. We built the calm, complete picture of yours.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={0.05 + i * 0.05} className={f.span}>
                <Spotlight className={`card-interactive flex h-full flex-col ${f.feature ? 'p-8' : 'p-6'}`}>
                  <div
                    className={
                      f.feature
                        ? 'flex h-12 w-12 items-center justify-center rounded-xl bg-brand-700 text-gold-300 ring-1 ring-gold-400/30'
                        : 'flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700'
                    }
                  >
                    <f.icon size={f.feature ? 23 : 21} />
                  </div>

                  <h3
                    className={`font-display mt-5 font-bold text-slate-900 ${f.feature ? 'text-2xl sm:text-[1.75rem]' : 'text-lg'}`}
                    style={f.feature ? TIGHT : undefined}
                  >
                    {f.title}
                  </h3>
                  <p
                    className={`mt-2 leading-relaxed text-slate-500 ${f.feature ? 'max-w-md text-[15px]' : 'text-sm'}`}
                  >
                    {f.body}
                  </p>

                  {/* the anchor tile carries the biggest visual: the markets it
                      prices, and the count stated in the hero, counting up. */}
                  {f.feature && (
                    <div className="mt-auto">
                      <div aria-hidden className="rule-fade mt-8" />
                      <div className="mt-6 flex flex-wrap gap-2">
                        {MARKETS.map((m) => (
                          <span
                            key={m}
                            className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-100 dark:ring-white/10"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                      <div className="mt-7 flex items-end justify-between gap-8">
                        <div>
                          <p className="num text-4xl font-bold leading-none text-brand-900" style={TIGHT}>
                            <Counter value={7} />
                          </p>
                          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            markets, priced live
                          </p>
                        </div>
                        <div className="hidden w-40 sm:block">
                          <Sparkline points={TREND} stroke="#c2a368" height={38} />
                        </div>
                      </div>
                    </div>
                  )}

                  {f.spark && (
                    <div className="mt-auto pt-6 text-emerald-500">
                      <Sparkline points={TREND} height={30} />
                    </div>
                  )}
                </Spotlight>
              </Reveal>
            ))}
          </div>
        </section>

        {/* --------------------------------------------------- how it works -- */}
        <section className="border-y border-[#e8e2d4] bg-[#faf9f5]">
          <div className="mx-auto max-w-6xl px-4 py-24 lg:px-8">
            <Reveal>
              <h2
                className="font-display text-center text-4xl font-bold text-brand-900 sm:text-5xl"
                style={TIGHT}
              >
                Growing takes three steps
              </h2>
            </Reveal>
            <div className="mt-14 grid gap-4 md:grid-cols-3">
              {STEPS.map(([title, body], i) => (
                <Reveal key={title} delay={0.05 + i * 0.08}>
                  <Spotlight className="card-interactive flex h-full flex-col p-7">
                    <span className="num text-[2.75rem] font-bold leading-none text-gold-600">
                      {`0${i + 1}`}
                    </span>
                    <div aria-hidden className="rule-fade mt-5" />
                    <h3 className="font-display mt-5 text-lg font-bold text-slate-900">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-500">{body}</p>
                  </Spotlight>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- premium -- */}
        <section id="premium" className="mx-auto max-w-6xl px-4 py-24 lg:px-8">
          <Reveal>
            <Spotlight className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-8 text-white shadow-2xl shadow-brand-900/30 ring-1 ring-white/10 sm:p-14">
              <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="aurora-blob absolute -right-20 -top-24 h-72 w-72 rounded-full bg-gold-400/20 blur-3xl" />
                <div
                  className="aurora-blob absolute -bottom-28 -left-16 h-64 w-64 rounded-full bg-brand-400/20 blur-3xl"
                  style={{ animationDelay: '-8s' }}
                />
              </div>
              <div className="relative grid items-center gap-12 lg:grid-cols-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gold-300">
                    Sampada Premium · from <span className="num">₹99</span>/mo
                  </p>
                  <h2 className="font-display mt-4 text-4xl font-bold sm:text-5xl" style={TIGHT}>
                    For wealth that’s going places
                  </h2>
                  <p className="mt-4 max-w-md leading-relaxed text-brand-100">
                    Start free with live tracking. Go Premium when you want the full growth toolkit.
                  </p>
                  <Link
                    to="/signup"
                    className="group mt-8 inline-flex items-center gap-2 rounded-xl bg-gold-400 px-6 py-3.5 font-semibold text-brand-900 transition duration-200 hover:bg-gold-300"
                  >
                    Start free, upgrade any time
                    <ArrowRight size={17} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                  </Link>
                </div>
                <ul className="grid gap-2.5 text-sm">
                  {PREMIUM.map(([Icon, text]) => (
                    <li
                      key={text}
                      className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3.5 ring-1 ring-inset ring-white/10"
                    >
                      <Icon size={17} className="shrink-0 text-gold-300" />
                      <span>{text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Spotlight>
          </Reveal>
        </section>

        {/* ----------------------------------------------------- final CTA -- */}
        <section className="relative overflow-hidden">
          <div className="relative mx-auto max-w-3xl px-4 pb-28 pt-4 text-center lg:px-8">
            <Reveal>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-gold-300 ring-1 ring-gold-400/30">
                <Sprout size={28} />
              </div>
            </Reveal>
            <Reveal delay={0.06}>
              <h2
                className="font-display mt-7 text-4xl font-bold text-brand-900 sm:text-5xl"
                style={TIGHT}
              >
                Plant it today. Watch it grow.
              </h2>
              <p className="mt-4 text-slate-500">Your first holding takes under a minute.</p>
            </Reveal>
            <Reveal delay={0.12}>
              <div className="mt-9">
                <Magnetic strength={0.2}>
                  <Link
                    to="/signup"
                    className="group inline-flex items-center gap-2 rounded-xl bg-brand-700 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-brand-900/20 ring-1 ring-inset ring-white/10 transition duration-200 hover:bg-brand-800"
                  >
                    Get started free
                    <ArrowRight size={19} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                  </Link>
                </Magnetic>
              </div>
            </Reveal>
          </div>
        </section>

        {/* -------------------------------------------------------- footer -- */}
        <footer className="border-t border-[#e8e2d4] bg-[#faf9f5]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 lg:px-8">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
              <Sprout size={16} className="text-gold-500" /> Sampada · wealth, all in one place
            </div>
            <div className="flex gap-5 text-sm font-medium text-slate-500">
              <Link to="/login" className="transition hover:text-brand-700">Sign in</Link>
              <Link to="/signup" className="transition hover:text-brand-700">Create account</Link>
              <Link to="/calculators" className="transition hover:text-brand-700">Calculators</Link>
              <Link to="/privacy" className="transition hover:text-brand-700">Privacy</Link>
            </div>
          </div>
          <p className="pb-8 text-center text-xs text-slate-400">
            Prices can be delayed. Projections are estimates for planning only — not investment advice.
          </p>
        </footer>
      </div>
    </MotionConfig>
  );
}
