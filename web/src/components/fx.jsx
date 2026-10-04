import { useEffect, useRef } from 'react';
import {
  motion,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';

/* ============================================================================
   Motion & surface primitives.

   This is a money product, so the brief is restraint: motion exists to explain
   change (a number moved, a card is interactive, content arrived), never to
   perform. Every effect is transform/opacity only so it stays on the compositor,
   and every one collapses to a static state under prefers-reduced-motion.
   ========================================================================== */

// Two springs cover the whole app: `settle` for entrances (arrives, stops),
// `follow` for anything tracking the cursor (never quite catches up, feels alive).
export const settle = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 };
export const follow = { stiffness: 150, damping: 20, mass: 0.6 };

/* ------------------------------- Spotlight -------------------------------- */
// A cursor-tracking sheen on a surface. Reads as "this responds to you" without
// the neon look of a glow border — the highlight is warm white at 6% over the
// card's own colour, so it lifts the surface rather than tinting it.
export function Spotlight({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();

  const onMove = (e) => {
    if (reduced || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    ref.current.style.setProperty('--mx', `${e.clientX - r.left}px`);
    ref.current.style.setProperty('--my', `${e.clientY - r.top}px`);
  };

  return (
    <Tag ref={ref} onMouseMove={onMove} className={`spotlight ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/* ---------------------------------- Tilt ---------------------------------- */
// A few degrees of perspective on hover. Capped deliberately low: past ~6° it
// starts to feel like a toy, and this sits next to someone's net worth.
export function Tilt({ className = '', max = 5, children, ...rest }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rx = useSpring(useTransform(py, [-0.5, 0.5], [max, -max]), follow);
  const ry = useSpring(useTransform(px, [-0.5, 0.5], [-max, max]), follow);

  if (reduced) {
    return (
      <div className={className} {...rest}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 1200 }}
      onMouseMove={(e) => {
        const r = ref.current.getBoundingClientRect();
        px.set((e.clientX - r.left) / r.width - 0.5);
        py.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onMouseLeave={() => {
        px.set(0);
        py.set(0);
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------- Magnetic -------------------------------- */
// Primary actions lean a few pixels toward the cursor. It makes the one button
// that matters on a screen feel findable without shouting.
export function Magnetic({ children, strength = 0.18, className = '', max = 8 }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const x = useSpring(useMotionValue(0), follow);
  const y = useSpring(useMotionValue(0), follow);

  if (reduced) return <span className={className}>{children}</span>;

  return (
    <motion.span
      ref={ref}
      className={`inline-block ${className}`}
      style={{ x, y }}
      onMouseMove={(e) => {
        const r = ref.current.getBoundingClientRect();
        // Clamp the travel: past ~8px the control moves out from under the
        // pointer, fires mouseleave, springs home, re-enters — it flickers.
        const cap = (v) => Math.max(-max, Math.min(max, v));
        x.set(cap((e.clientX - (r.left + r.width / 2)) * strength));
        y.set(cap((e.clientY - (r.top + r.height / 2)) * strength));
      }}
      onMouseLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.span>
  );
}

/* --------------------------------- Reveal --------------------------------- */
// Scroll-triggered entrance. Fires once, slightly before the element reaches the
// viewport, so content is already settled by the time you read it.
export function Reveal({ children, delay = 0, y = 24, className = '', once = true }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: '-80px' }}
      transition={{ ...settle, delay }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------- TextReveal ------------------------------- */
// Headline words rise in sequence. Whole words, not letters — letter-by-letter
// reads as a gimmick and hurts legibility at display sizes.
export function TextReveal({ text, className = '', delay = 0, stagger = 0.055 }) {
  const reduced = useReducedMotion();
  const words = String(text).split(' ');
  if (reduced) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`}>
          <span className="inline-block overflow-hidden align-bottom">
            <motion.span
              className="inline-block"
              initial={{ y: '110%' }}
              animate={{ y: 0 }}
              transition={{ ...settle, delay: delay + i * stagger }}
            >
              {w}
            </motion.span>
          </span>
          {/* The space belongs OUTSIDE the clipping box: inside it, CSS
              strips trailing whitespace at the end of the line box and the
              headline renders as "Watchyourwealth". */}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
}

/* -------------------------------- Counter --------------------------------- */
// Spring-animated number. Writes straight to the DOM node rather than through
// state, so a 60fps count-up costs zero React renders.
export function Counter({ value, format = (v) => Math.round(v).toLocaleString(), className = '' }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const mv = useMotionValue(0);
  // Duration, not stiffness: a spring's settle time grows with the distance
  // travelled, so a larger portfolio would animate longer — backwards.
  const spring = useSpring(mv, { duration: 900, bounce: 0 });

  // Has the count-up actually put a number on screen? Until it has, what the
  // reader sees is the zero this renders with.
  const painted = useRef(false);

  useEffect(() => {
    if (reduced) return;
    if (inView) mv.set(value);
  }, [inView, value, mv, reduced]);

  // The safety net, and it is not about animation polish. In a background tab
  // the browser hands out no animation frames AND the IntersectionObserver
  // behind `inView` never reports, so neither branch above ever runs and this
  // element keeps the zero it was rendered with. On a page made of money that
  // isn't a missing flourish, it's a WRONG NUMBER — a ₹0.00 sitting where the
  // figure is ₹18,875, until the reader happens to focus the tab. So: if
  // nothing has painted shortly after mount, print the truth and stop waiting.
  // Hidden tabs clamp timers to about a second, which this clears.
  useEffect(() => {
    painted.current = false;
    const id = setTimeout(() => {
      if (!painted.current && ref.current) ref.current.textContent = format(value);
    }, 1500);
    return () => clearTimeout(id);
  }, [value, format]);

  useMotionValueEvent(spring, 'change', (v) => {
    painted.current = true;
    if (ref.current) ref.current.textContent = format(v);
  });

  return (
    <span ref={ref} className={className}>
      {format(reduced ? value : 0)}
    </span>
  );
}

/* -------------------------------- Sparkline ------------------------------- */
// A trend line small enough to live inside a stat card. Draws itself in once,
// which is the cheapest way to say "this is live data" without a legend.
export function Sparkline({ points = [], className = '', stroke = 'currentColor', height = 28 }) {
  const reduced = useReducedMotion();
  if (!points.length || points.length < 2) return null;

  const w = 100;
  const min = Math.min(...points);
  const max = Math.max(...points);
  // A flat series is not a trend — drawing one implies data we do not have.
  if (max === min) return null;
  const span = max - min;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = height - ((p - min) / span) * (height - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  const rising = points[points.length - 1] >= points[0];

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ height, width: '100%' }}
      aria-hidden="true"
    >
      <motion.path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        opacity={rising ? 1 : 0.85}
        initial={reduced ? false : { pathLength: 0 }}
        animate={reduced ? false : { pathLength: 1 }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      />
    </svg>
  );
}

/* --------------------------------- Aurora --------------------------------- */
// Slow colour field behind hero surfaces. Two large, heavily blurred blobs at
// low opacity — enough to kill the "flat rectangle" feel, not enough to notice.
export function Aurora({ className = '' }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <div className="aurora-blob absolute -left-24 -top-32 h-[420px] w-[420px] rounded-full bg-brand-500/25 blur-3xl" />
      <div
        className="aurora-blob absolute -bottom-40 -right-16 h-[380px] w-[380px] rounded-full bg-gold-400/20 blur-3xl"
        style={{ animationDelay: '-7s' }}
      />
    </div>
  );
}

/* --------------------------------- Shimmer -------------------------------- */
// Skeleton that mirrors the shape of what's loading. A spinner tells you to
// wait; this tells you what's coming, so the arrival isn't a layout jump.
export function Shimmer({ className = '' }) {
  return <div className={`shimmer rounded-xl ${className}`} aria-hidden="true" />;
}

export function CardSkeleton() {
  return (
    <div className="card h-full p-5">
      <Shimmer className="h-10 w-10 !rounded-xl" />
      <Shimmer className="mt-4 h-7 w-2/3" />
      <Shimmer className="mt-2 h-4 w-1/3" />
    </div>
  );
}

/* --------------------------------- Marquee -------------------------------- */
// Edge-faded infinite strip. Duplicated content and a transform loop, so it
// never reflows; pauses on hover so a name can actually be read.
export function Marquee({ children, speed = 38, className = '' }) {
  const reduced = useReducedMotion();
  if (reduced) {
    return <div className={`flex flex-wrap items-center justify-center gap-x-10 gap-y-3 ${className}`}>{children}</div>;
  }
  return (
    <div className={`marquee-mask relative overflow-hidden ${className}`}>
      <div className="marquee-track flex w-max items-center gap-10" style={{ animationDuration: `${speed}s` }}>
        {children}
        <span aria-hidden="true" className="flex items-center gap-10">
          {children}
        </span>
      </div>
    </div>
  );
}
