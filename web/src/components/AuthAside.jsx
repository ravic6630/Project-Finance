import { motion } from 'framer-motion';
import { Sprout, TrendingUp, Globe2, Users } from 'lucide-react';
import { Aurora, TextReveal, settle } from './fx.jsx';

const POINTS = [
  { icon: TrendingUp, text: 'Indian stocks, US stocks & mutual funds — live prices' },
  { icon: Globe2, text: 'See everything in ₹ or $ with live exchange rates' },
  { icon: Users, text: 'Private accounts for you, family & friends' },
];

export default function AuthAside() {
  return (
    <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-brand-700 p-12 text-white lg:flex">
      <Aurora />
      {/* A faint champagne grid, masked to fade toward the edges — gives the
          panel a sense of material instead of a flat block of navy. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(216,187,121,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(216,187,121,.6) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse at 30% 40%, #000 20%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 30% 40%, #000 20%, transparent 75%)',
        }}
      />

      <motion.div
        className="relative flex items-center gap-2.5"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={settle}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-gold-300 ring-1 ring-gold-400/30">
          <Sprout size={22} />
        </div>
        <span className="font-display text-2xl font-bold">Sampada</span>
      </motion.div>

      <div className="relative">
        <h2 className="font-display text-[2.75rem] font-bold leading-[1.08] tracking-tight">
          <TextReveal text="All your wealth," />
          <br />
          <TextReveal text="in one place." delay={0.12} />
        </h2>
        <motion.p
          className="mt-4 max-w-sm text-brand-100"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.5 }}
        >
          Track every investment and account across India and the US, and always know your true net
          worth.
        </motion.p>
        <ul className="mt-8 space-y-4">
          {POINTS.map(({ icon: Icon, text }, i) => (
            <motion.li
              key={text}
              className="flex items-center gap-3"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...settle, delay: 0.45 + i * 0.09 }}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/10">
                <Icon size={18} />
              </div>
              <span className="text-sm font-medium text-brand-50">{text}</span>
            </motion.li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-brand-200">Your data stays private to your account.</p>
    </div>
  );
}
