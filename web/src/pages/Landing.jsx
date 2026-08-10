import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MotionConfig, motion } from 'framer-motion';
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

/* ---------------------------------------------------------------- helpers -- */

const fmtINR = (v) =>
  '₹' + Math.round(v).toLocaleString('en-IN');

// Entrance animations only play when the page loads in a VISIBLE tab. Opened in
// a background tab (or anywhere requestAnimationFrame is frozen), the page
// renders its finished state instantly — marketing content must never be stuck
// invisible waiting for an animation that can't run.
const ENTER =
  typeof document === 'undefined' || document.visibilityState === 'visible';

// Small count-up for the mock dashboard number.
function useCountUp(target, duration = 1400, delay = 350) {
  const [val, setVal] = useState(ENTER ? 0 : target);
  const raf = useRef(0);
  useEffect(() => {
    if (!ENTER || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setVal(target);
      return undefined;
    }
    let start;
    const tick = (now) => {
      if (start === undefined) start = now + delay;
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      setVal(target * (1 - (1 - t) ** 3));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration, delay]);
  return val;
}

// Scroll-reveal presets.
const rise = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 210, damping: 26 } },
};
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };
const inView = { once: true, margin: '-60px' };

/* ---------------------------------------------------- hero mock dashboard -- */

function MockDashboard() {
  const worth = useCountUp(2460000);
  return (
    <div className="relative">
      {/* the card */}
      <motion.div
        initial={ENTER ? { opacity: 0, y: 30, rotate: -1 } : false}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 160, damping: 22, delay: 0.15 }}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-6 text-white shadow-2xl ring-1 ring-white/10"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="aurora-blob absolute -right-14 -top-20 h-52 w-52 rounded-full bg-gold-400/25 blur-3xl" />
        </div>

        <p className="relative flex items-center gap-1.5 text-xs font-medium text-gold-300">
          <Sprout size={13} /> Good morning, Asha
        </p>
        <p className="relative mt-3 text-[10px] font-semibold uppercase tracking-widest text-brand-200">
          Total net worth
        </p>
        <p className="num relative mt-0.5 text-3xl font-extrabold tracking-tight sm:text-4xl">
          {fmtINR(worth)}
        </p>
        <p className="relative mt-1.5 text-xs">
          <span className="font-semibold text-emerald-300">▲ ₹41,280 (+1.7%)</span>{' '}
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
            <div key={k} className="rounded-xl bg-white/10 px-2 py-2">
              <p className="text-[10px] font-medium text-brand-200">{k}</p>
              <p className="num text-sm font-bold">{v}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* floating accent chips */}
      <motion.div
        initial={ENTER ? { opacity: 0, scale: 0.8 } : false}
        animate={{ opacity: 1, scale: 1, y: [0, -7, 0] }}
        transition={{
          opacity: { delay: 1.3, duration: 0.4 },
          scale: { delay: 1.3, type: 'spring', stiffness: 260, damping: 18 },
          y: { delay: 1.8, duration: 4.5, repeat: Infinity, ease: 'easeInOut' },
        }}
        className="absolute -right-3 -top-4 flex items-center gap-1.5 rounded-full bg-gold-400 px-3 py-1.5 text-xs font-bold text-brand-900 shadow-lg sm:-right-6"
      >
        <Trophy size={13} /> ₹10L club
      </motion.div>
      <motion.div
        initial={ENTER ? { opacity: 0, scale: 0.8 } : false}
        animate={{ opacity: 1, scale: 1, y: [0, 8, 0] }}
        transition={{
          opacity: { delay: 1.55, duration: 0.4 },
          scale: { delay: 1.55, type: 'spring', stiffness: 260, damping: 18 },
          y: { delay: 2.1, duration: 5, repeat: Infinity, ease: 'easeInOut' },
        }}
        className="absolute -bottom-4 -left-3 flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-emerald-600 shadow-lg ring-1 ring-slate-200 sm:-left-6"
      >
        <TrendingUp size={13} /> Live prices, 7 markets
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ page --- */

const FEATURES = [
  {
    icon: Globe2,
    title: 'Every market, one page',
    body: 'Indian, US, UK, Irish, Australian, NZ and Canadian stocks plus mutual funds — priced live, converted to your currency.',
  },
  {
    icon: Link2,
    title: 'Import in minutes',
    body: 'Connect Upstox, Zerodha, Angel One or Fyers, drop in a CAS PDF, or bring a CSV from any broker on earth.',
  },
  {
    icon: LineChart,
    title: 'Watch it grow',
    body: 'A daily net-worth trend from 1 day to 10 years — with confetti when you cross ₹1Cr and beyond.',
  },
  {
    icon: Target,
    title: 'Goals that talk back',
    body: 'Retirement, a house, an education — see if you’re on pace and exactly what to invest monthly to get there.',
  },
  {
    icon: Building2,
    title: 'Beyond the demat',
    body: 'Property, land, business, gold and cash sit beside your portfolio, so your net worth is actually complete.',
  },
  {
    icon: Bell,
    title: 'Stays in touch',
    body: 'A morning email digest of your wealth, price alerts, and a real human on the in-app support chat.',
  },
];

const STEPS = [
  ['Create your account', 'Free, with email verification. Your currency is auto-detected.'],
  ['Bring your money in', 'Connect a broker, import a CAS PDF or CSV — or add holdings by hand.'],
  ['Watch it grow', 'Live prices, a daily net-worth trend, goals and projections. 🌱'],
];

export default function Landing() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[#f4f2ec] text-slate-900">
        {/* ---------------------------------------------------------- nav -- */}
        <header className="sticky top-0 z-40 border-b border-[#e8e2d4] bg-[#faf9f5]/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 lg:px-8">
            <Link to="/" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-700 text-gold-300 ring-1 ring-gold-400/30">
                <Sprout size={20} />
              </span>
              <span className="font-display text-xl font-bold text-brand-800">Sampada</span>
            </Link>
            <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-500 md:flex">
              <a href="#features" className="hover:text-brand-700">Features</a>
              <a href="#premium" className="hover:text-brand-700">Premium</a>
              <Link to="/calculators" className="hover:text-brand-700">Calculators</Link>
            </nav>
            <div className="flex items-center gap-2">
              <Link to="/login" className="btn-ghost">Sign in</Link>
              <Link to="/signup" className="btn-primary">Get started free</Link>
            </div>
          </div>
        </header>

        {/* --------------------------------------------------------- hero -- */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="aurora-blob absolute -left-24 top-10 h-72 w-72 rounded-full bg-gold-200/50 blur-3xl dark:bg-gold-400/10" />
            <div
              className="aurora-blob absolute -right-20 top-40 h-80 w-80 rounded-full bg-brand-100/60 blur-3xl dark:bg-brand-400/10"
              style={{ animationDelay: '-7s' }}
            />
          </div>

          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 lg:grid-cols-2 lg:px-8 lg:pb-28 lg:pt-20">
            <motion.div variants={stagger} initial={ENTER ? 'hidden' : false} animate="show">
              <motion.p
                variants={rise}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700 ring-1 ring-brand-100"
              >
                <Sprout size={13} className="text-gold-500" /> Sampada — your wealth, all in one place
              </motion.p>
              <motion.h1
                variants={rise}
                className="font-display mt-5 text-4xl font-bold leading-[1.08] tracking-tight text-brand-900 sm:text-5xl lg:text-6xl"
              >
                Watch your wealth{' '}
                <span className="bg-gradient-to-r from-gold-500 via-gold-400 to-gold-600 bg-clip-text text-transparent">
                  grow.
                </span>
              </motion.h1>
              <motion.p variants={rise} className="mt-5 max-w-lg text-lg text-slate-600">
                Stocks across 7 markets, mutual funds, cash, property and gold — tracked live, in your
                currency, with goals that tell you exactly what it takes to get there.
              </motion.p>
              <motion.div variants={rise} className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/signup"
                  className="group inline-flex items-center gap-2 rounded-xl bg-brand-700 px-6 py-3.5 font-semibold text-white shadow-lg shadow-brand-700/20 transition hover:bg-brand-800"
                >
                  Start free
                  <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link
                  to="/calculators"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 font-semibold text-brand-700 ring-1 ring-[#e8e2d4] transition hover:ring-gold-300"
                >
                  <Calculator size={17} /> Try the calculators
                </Link>
              </motion.div>
              <motion.p variants={rise} className="mt-4 flex items-center gap-1.5 text-sm text-slate-400">
                <ShieldCheck size={15} className="text-emerald-500" />
                Free to start · no card needed · read-only broker access
              </motion.p>
            </motion.div>

            <MockDashboard />
          </div>
        </section>

        {/* --------------------------------------------------- trust strip -- */}
        <section className="border-y border-[#e8e2d4] bg-[#faf9f5]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-5 lg:px-8">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Brings your money in from
            </span>
            {['Upstox', 'Zerodha', 'Angel One', 'Fyers', 'NSDL / CDSL CAS', 'Any CSV'].map((n) => (
              <span key={n} className="text-sm font-bold text-slate-500">
                {n}
              </span>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------ features -- */}
        <section id="features" className="mx-auto max-w-6xl px-4 py-20 lg:px-8">
          <motion.div variants={stagger} initial={ENTER ? 'hidden' : false} whileInView="show" viewport={inView}>
            <motion.h2
              variants={rise}
              className="font-display text-center text-3xl font-bold tracking-tight text-brand-900 sm:text-4xl"
            >
              Everything you own, <span className="text-gold-500">finally together</span>
            </motion.h2>
            <motion.p variants={rise} className="mx-auto mt-3 max-w-xl text-center text-slate-500">
              Sampada means prosperity. We built the calm, complete picture of yours.
            </motion.p>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <motion.div
                  key={f.title}
                  variants={rise}
                  whileHover={{ y: -4 }}
                  className="card p-6"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <f.icon size={21} />
                  </div>
                  <h3 className="mt-4 font-display text-lg font-bold text-slate-900">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{f.body}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* --------------------------------------------------- how it works -- */}
        <section className="bg-[#faf9f5]">
          <div className="mx-auto max-w-6xl px-4 py-20 lg:px-8">
            <motion.div variants={stagger} initial={ENTER ? 'hidden' : false} whileInView="show" viewport={inView}>
              <motion.h2
                variants={rise}
                className="font-display text-center text-3xl font-bold tracking-tight text-brand-900"
              >
                Growing takes three steps
              </motion.h2>
              <div className="mt-12 grid gap-6 md:grid-cols-3">
                {STEPS.map(([title, body], i) => (
                  <motion.div key={title} variants={rise} className="relative">
                    <div className="card h-full p-6 pt-8">
                      <span className="num absolute -top-4 left-6 flex h-9 w-9 items-center justify-center rounded-xl bg-gold-400 font-bold text-brand-900 shadow">
                        {i + 1}
                      </span>
                      <h3 className="font-display text-lg font-bold text-slate-900">{title}</h3>
                      <p className="mt-1.5 text-sm text-slate-500">{body}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* ------------------------------------------------------- premium -- */}
        <section id="premium" className="mx-auto max-w-6xl px-4 py-20 lg:px-8">
          <motion.div
            variants={rise}
            initial={ENTER ? 'hidden' : false}
            whileInView="show"
            viewport={inView}
            className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-8 text-white shadow-2xl sm:p-12"
          >
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="aurora-blob absolute -right-20 -top-24 h-72 w-72 rounded-full bg-gold-400/20 blur-3xl" />
            </div>
            <div className="relative grid items-center gap-10 lg:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-gold-300">
                  Sampada Premium · from ₹99/mo
                </p>
                <h2 className="font-display mt-3 text-3xl font-bold sm:text-4xl">
                  For wealth that’s going places
                </h2>
                <p className="mt-3 max-w-md text-brand-100">
                  Start free with live tracking. Go Premium when you want the full growth toolkit.
                </p>
                <Link
                  to="/signup"
                  className="mt-7 inline-flex items-center gap-2 rounded-xl bg-gold-400 px-6 py-3.5 font-semibold text-brand-900 transition hover:bg-gold-300"
                >
                  Start free, upgrade any time <ArrowRight size={17} />
                </Link>
              </div>
              <ul className="grid gap-3 text-sm">
                {[
                  [TrendingUp, 'Auto-sync brokers with unlimited holdings'],
                  [LineChart, 'Net-worth history from a day to a decade'],
                  [Target, 'Goals, projections & true returns (XIRR) with tax reports'],
                  [PiggyBank, 'Daily email digest of your whole portfolio'],
                  [MessageCircle, 'Priority human support, right in the app'],
                ].map(([Icon, text]) => (
                  <li key={text} className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3">
                    <Icon size={17} className="shrink-0 text-gold-300" />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </section>

        {/* ----------------------------------------------------- final CTA -- */}
        <section className="mx-auto max-w-3xl px-4 pb-24 pt-4 text-center lg:px-8">
          <motion.div variants={stagger} initial={ENTER ? 'hidden' : false} whileInView="show" viewport={inView}>
            <motion.div variants={rise} className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-gold-300 ring-1 ring-gold-400/30">
              <Sprout size={28} />
            </motion.div>
            <motion.h2
              variants={rise}
              className="font-display mt-6 text-3xl font-bold tracking-tight text-brand-900 sm:text-4xl"
            >
              Plant it today. Watch it grow.
            </motion.h2>
            <motion.p variants={rise} className="mt-3 text-slate-500">
              Your first holding takes under a minute.
            </motion.p>
            <motion.div variants={rise} className="mt-8">
              <Link
                to="/signup"
                className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-brand-700/20 transition hover:bg-brand-800"
              >
                Get started free <ArrowRight size={19} />
              </Link>
            </motion.div>
          </motion.div>
        </section>

        {/* -------------------------------------------------------- footer -- */}
        <footer className="border-t border-[#e8e2d4] bg-[#faf9f5]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 lg:px-8">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
              <Sprout size={16} className="text-gold-500" /> Sampada · wealth, all in one place
            </div>
            <div className="flex gap-5 text-sm font-medium text-slate-500">
              <Link to="/login" className="hover:text-brand-700">Sign in</Link>
              <Link to="/signup" className="hover:text-brand-700">Create account</Link>
              <Link to="/calculators" className="hover:text-brand-700">Calculators</Link>
              <Link to="/privacy" className="hover:text-brand-700">Privacy</Link>
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
