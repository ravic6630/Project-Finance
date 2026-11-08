import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/* The band palette, in one place, so the ring, the chips and the bars can never
   disagree about what colour "Fair" is. Emerald/teal/amber/rose rather than
   the theme's tones: a score needs a scale people already read as good→bad.
   Only shades WITHOUT a `.dark` override in index.css are used here — an
   override and a `dark:` variant on the same element fight on source order. */
export const BAND_STYLE = {
  excellent: {
    stroke: '#10b981',
    chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
    bar: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-300',
  },
  good: {
    stroke: '#14b8a6',
    chip: 'bg-teal-500/10 text-teal-600 dark:text-teal-300',
    bar: 'bg-teal-500',
    text: 'text-teal-600 dark:text-teal-300',
  },
  fair: {
    stroke: '#f59e0b',
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
    bar: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-300',
  },
  needs_attention: {
    stroke: '#f43f5e',
    chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
    bar: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-300',
  },
};

export const bandStyle = (band) => BAND_STYLE[band?.key] || null;

export function BandChip({ band, className = '' }) {
  const s = bandStyle(band);
  if (!s) return null;
  return <span className={`chip whitespace-nowrap ${s.chip} ${className}`}>{band.label}</span>;
}

/* A score ring. The arc is drawn with a CSS transition rather than a JS
   animation on purpose: a background tab hands out no animation frames, and an
   arc stuck at zero would read as a score of zero. A CSS transition is
   time-based, so whenever the tab is next painted the arc is where it belongs. */
export default function HealthRing({ score, band, size = 120, stroke = 10, children, label }) {
  const reduced = useReducedMotion();
  const [drawn, setDrawn] = useState(!!reduced);
  useEffect(() => {
    if (reduced) return undefined;
    const t = setTimeout(() => setDrawn(true), 40);
    return () => clearTimeout(t);
  }, [reduced]);

  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = score == null ? 0 : Math.max(0, Math.min(1, score / 100));
  const color = bandStyle(band)?.stroke || '#c2a368';

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label || (score == null ? 'No score yet' : `Score ${score} out of 100`)}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-slate-200 dark:stroke-white/10"
          strokeDasharray={score == null ? `${stroke * 0.6} ${stroke * 0.9}` : undefined}
        />
        {score != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={drawn ? c * (1 - frac) : c}
            style={{ transition: reduced ? 'none' : 'stroke-dashoffset 900ms cubic-bezier(.22,1,.36,1)' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
