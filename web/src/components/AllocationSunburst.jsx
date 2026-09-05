import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ChevronLeft, PieChart as PieIcon } from 'lucide-react';
import { money } from '../lib/format.js';

/* Asset allocation, as the hierarchy it actually is.

   A flat ring can show exactly one level, so the old donut had to pick — and it
   picked the least interesting one. "74% Assets" is true and useless; the
   question underneath it ("which asset?") was thrown away before it could be
   asked. This draws every level the data has, and lets you click into any slice
   to make it the whole circle.

   Hand-rolled SVG rather than a chart library: no library ships a zoomable
   sunburst, and the layout is a straightforward recursive subdivision of angle
   — each child takes the share of its parent's arc that its value deserves.

   The geometry is the honest part and worth stating plainly: an arc's ANGLE is
   always its share of its parent. So a slice that fills a quarter of the ring is
   a quarter of whatever you're currently looking at, at every zoom level. */

const TAU = Math.PI * 2;

// Ring palette. Each top-level branch takes a hue and its children are drawn in
// progressively lighter steps of it, so a glance down any radius stays visibly
// one family. Values are HSL triples so the lightening is arithmetic, not a
// hand-picked ladder that breaks when a new bucket appears.
const HUES = [
  [214, 52], // deep navy — the brand
  [41, 46], // champagne
  [162, 38], // green
  [348, 42], // wine
  [265, 38], // violet
  [190, 40], // teal
];

const shade = (i, depth) => {
  const [h, s] = HUES[i % HUES.length];
  // Depth 1 is the darkest; each ring outward lightens by a fixed step, floored
  // so the outermost ring never washes out into the card behind it.
  const l = Math.min(78, 34 + (depth - 1) * 13);
  return `hsl(${h} ${s}% ${l}%)`;
};

// One SVG arc between two angles and two radii. Angles run clockwise from 12
// o'clock, which is where a reader expects a chart to start.
function arcPath(a0, a1, r0, r1) {
  const x = (a, r) => 200 + r * Math.sin(a);
  const y = (a, r) => 200 - r * Math.cos(a);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  // A full circle can't be drawn as one arc — its start and end points are the
  // same, so the renderer draws nothing at all. Split it in two.
  if (a1 - a0 >= TAU - 1e-9) {
    return [
      `M ${x(0, r1)} ${y(0, r1)}`,
      `A ${r1} ${r1} 0 1 1 ${x(Math.PI, r1)} ${y(Math.PI, r1)}`,
      `A ${r1} ${r1} 0 1 1 ${x(0, r1)} ${y(0, r1)}`,
      `M ${x(0, r0)} ${y(0, r0)}`,
      `A ${r0} ${r0} 0 1 0 ${x(Math.PI, r0)} ${y(Math.PI, r0)}`,
      `A ${r0} ${r0} 0 1 0 ${x(0, r0)} ${y(0, r0)}`,
      'Z',
    ].join(' ');
  }
  return [
    `M ${x(a0, r0)} ${y(a0, r0)}`,
    `L ${x(a0, r1)} ${y(a0, r1)}`,
    `A ${r1} ${r1} 0 ${large} 1 ${x(a1, r1)} ${y(a1, r1)}`,
    `L ${x(a1, r0)} ${y(a1, r0)}`,
    `A ${r0} ${r0} 0 ${large} 0 ${x(a0, r0)} ${y(a0, r0)}`,
    'Z',
  ].join(' ');
}

// Flatten the tree under `focus` into drawable arcs. Rings are laid out from
// the focus outward, so zooming in genuinely re-allocates the whole circle
// rather than just highlighting part of it.
function layout(focus, maxRings) {
  const arcs = [];
  const R0 = 84; // the hole: it carries the focused node's own figures
  const RING = 34;

  const walk = (node, a0, a1, depth, branch, trail) => {
    if (depth > maxRings) return;
    const total = (node.children || []).reduce((s, c) => s + (c.value > 0 ? c.value : 0), 0);
    if (!(total > 0)) return;
    let a = a0;
    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i];
      if (!(child.value > 0)) continue;
      const span = ((a1 - a0) * child.value) / total;
      // At the top level each branch seeds its own hue; deeper rings inherit it.
      const hue = depth === 1 ? arcs.filter((x) => x.depth === 1).length : branch;
      arcs.push({
        node: child,
        depth,
        a0: a,
        a1: a + span,
        r0: R0 + (depth - 1) * RING,
        r1: R0 + depth * RING,
        hue,
        // The index path from the focus down to this arc. Carrying it here is
        // what makes drilling exact: the alternative — searching the tree for
        // the clicked node by identity — breaks the moment a re-render hands
        // back a structurally equal but different object.
        path: [...trail, i],
        // Share of the CURRENT focus, which is what the ring visually encodes.
        pct: ((child.value / focus.value) * 100) || 0,
      });
      walk(child, a, a + span, depth + 1, hue, [...trail, i]);
      a += span;
    }
  };

  walk(focus, 0, TAU, 1, 0, []);
  return arcs;
}

// A label only earns a place on the arc if it fits inside it. Anything narrower
// gets nothing rather than a rotated sliver of text overlapping its neighbour —
// the tooltip and the legend already carry the name.
const MIN_LABEL_ANGLE = 0.34;

function ArcLabel({ arc }) {
  const mid = (arc.a0 + arc.a1) / 2;
  const r = (arc.r0 + arc.r1) / 2;
  const x = 200 + r * Math.sin(mid);
  const y = 200 - r * Math.cos(mid);
  let deg = (mid * 180) / Math.PI - 90;
  // Keep text upright on the left half rather than upside down.
  if (deg > 90 || deg < -90) deg += 180;
  const name = arc.node.name.length > 18 ? `${arc.node.name.slice(0, 17)}…` : arc.node.name;
  return (
    <text
      x={x}
      y={y}
      transform={`rotate(${deg} ${x} ${y})`}
      textAnchor="middle"
      dominantBaseline="middle"
      className="pointer-events-none select-none fill-white text-[9px] font-semibold"
      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}
    >
      {name}
    </text>
  );
}

export default function AllocationSunburst({ tree, base = 'INR', byKind = [] }) {
  const reduced = useReducedMotion();
  // The path from the root to what's currently in the middle. Index 0 is always
  // the root, so the trail doubles as the breadcrumb.
  const [trail, setTrail] = useState([]);
  const [hover, setHover] = useState(null);

  const focus = useMemo(() => {
    let node = tree;
    for (const i of trail) node = node?.children?.[i] || node;
    return node;
  }, [tree, trail]);

  const crumbs = useMemo(() => {
    const out = [tree];
    let node = tree;
    for (const i of trail) {
      node = node?.children?.[i];
      if (node) out.push(node);
    }
    return out;
  }, [tree, trail]);

  const arcs = useMemo(() => (focus ? layout(focus, 3) : []), [focus]);

  if (!tree || !(tree.value > 0) || !tree.children?.length) return null;

  const drill = (arc) => {
    // Only descend into something that has an inside. A leaf is already the
    // whole answer, and zooming into it would show an empty circle.
    if (!arc.node.children?.length) return;
    setHover(null);
    setTrail([...trail, ...arc.path]);
  };

  // Only classes with money in them, biggest first — the same order the ring
  // uses, so the two readings of the same portfolio line up.
  const classRows = (byKind || [])
    .filter((k) => Number(k.value) > 0)
    .slice()
    .sort((a, b) => b.value - a.value);

  const shown = hover?.node || focus;
  const shownPct = hover ? hover.pct : 100;

  return (
    <div>
      {/* -------------------------------- breadcrumb ------------------------ */}
      <div className="mb-3 flex flex-wrap items-center gap-1 text-xs">
        {trail.length > 0 && (
          <button
            type="button"
            onClick={() => setTrail(trail.slice(0, -1))}
            className="mr-1 flex items-center gap-0.5 rounded-lg px-1.5 py-1 font-semibold text-brand-700 transition hover:bg-brand-50 dark:hover:bg-[#16233c]"
          >
            <ChevronLeft size={13} /> Back
          </button>
        )}
        {crumbs.map((c, i) => (
          <span key={`${c.name}-${i}`} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate-300">/</span>}
            <button
              type="button"
              onClick={() => setTrail(trail.slice(0, i))}
              disabled={i === crumbs.length - 1}
              className={
                i === crumbs.length - 1
                  ? 'cursor-default font-semibold text-slate-700'
                  : 'rounded px-1 py-0.5 text-slate-400 transition hover:text-brand-700'
              }
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>

      <div className="relative">
        <svg
          viewBox="0 0 400 400"
          className="mx-auto w-full max-w-[420px]"
          role="img"
          aria-label={`Asset allocation for ${focus.name}, ${money(focus.value, base)}`}
        >
          {/* Deliberately NOT wrapped in AnimatePresence. An exiting ring stays
              mounted for the length of its fade, still carrying the click
              handler of the level you just left — so the first click after any
              drill would land on a stale arc and do nothing. Unmounting at once
              and animating only the entrance costs one fade and removes a bug
              the user would read as "the chart ignored me". */}
          {arcs.map((arc, i) => {
              const isHover = hover?.node === arc.node;
              const clickable = !!arc.node.children?.length;
              return (
                <motion.path
                  // Keyed by position so a zoom re-draws rather than morphing an
                  // arc into an unrelated one.
                  key={`${focus.name}-${arc.depth}-${arc.node.name}-${i}`}
                  d={arcPath(arc.a0, arc.a1, arc.r0, arc.r1)}
                  fill={shade(arc.hue, arc.depth)}
                  stroke="var(--sunburst-gap, #fff)"
                  strokeWidth="1.5"
                  initial={reduced ? false : { opacity: 0, scale: 0.94 }}
                  animate={{ opacity: isHover ? 1 : hover ? 0.55 : 1, scale: 1 }}
                  transition={{ duration: reduced ? 0 : 0.3, delay: reduced ? 0 : arc.depth * 0.04 }}
                  style={{ transformOrigin: '200px 200px', cursor: clickable ? 'pointer' : 'default' }}
                  onMouseEnter={() => setHover(arc)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => drill(arc)}
                />
              );
            })}

          {arcs
            .filter((a) => a.a1 - a.a0 >= MIN_LABEL_ANGLE)
            .map((a, i) => (
              <ArcLabel key={`l-${a.depth}-${a.node.name}-${i}`} arc={a} />
            ))}

          {/* The hole is not decoration: it always names what the ring is a
              breakdown OF, and what the pointer is currently over. */}
          <foreignObject x="112" y="150" width="176" height="110">
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="line-clamp-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {shown.name}
              </p>
              <p className="num mt-0.5 text-lg font-bold leading-tight text-slate-900">
                {money(shown.value, base, { compact: true })}
              </p>
              {hover && (
                <p className="num text-[11px] font-semibold text-brand-600">
                  {shownPct.toFixed(shownPct < 10 ? 1 : 0)}% of {focus.name}
                </p>
              )}
            </div>
          </foreignObject>
        </svg>
      </div>

      {/* --------------------------------- legend --------------------------- */}
      <ul className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2">
        {(focus.children || [])
          .filter((c) => c.value > 0)
          .map((c, i) => (
            <li key={c.name}>
              <button
                type="button"
                onClick={() => c.children?.length && setTrail([...trail, i])}
                onMouseEnter={() => setHover(arcs.find((a) => a.node === c) || null)}
                onMouseLeave={() => setHover(null)}
                className={`flex items-center gap-1.5 text-xs ${
                  c.children?.length ? 'cursor-pointer hover:text-brand-700' : 'cursor-default'
                } text-slate-600`}
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: shade(i, 1) }}
                />
                <span className="truncate">{c.name}</span>
                <span className="num font-semibold text-slate-800">
                  {((c.value / focus.value) * 100).toFixed(1)}%
                </span>
              </button>
            </li>
          ))}
      </ul>

      {/* The one thing the retired "Investments by class" card said that this
          chart does not: what each class has MADE. Composition and performance
          are different questions, and the ring only answers the first — so the
          second lives here rather than in a card of its own repeating the
          split a third time. */}
      {classRows.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-[#223250]">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            What each class has made
          </p>
          <ul className="divide-y divide-slate-100 dark:divide-[#1c2c49]">
            {classRows.map((k) => {
              const gain = k.value - k.cost;
              const up = gain >= 0;
              return (
                <li key={k.key}>
                  <Link
                    to="/investments"
                    className="group flex items-center justify-between gap-3 py-2 transition hover:text-brand-700"
                  >
                    <span className="truncate text-sm text-slate-600 group-hover:text-brand-700">{k.label}</span>
                    <span className="flex shrink-0 items-baseline gap-3">
                      <span className="num text-sm font-semibold text-slate-800">
                        {money(k.value, base, { compact: true })}
                      </span>
                      <span
                        className={`num w-24 text-right text-xs font-medium ${
                          up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {up ? '▲' : '▼'} {money(Math.abs(gain), base, { compact: true })}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="mt-3 text-center text-[11px] text-slate-400">
        {focus.children?.some((c) => c.children?.length)
          ? 'Click a slice to see what’s inside it.'
          : 'This is the deepest level — every holding here is named.'}
        {tree.omitted && (
          <>
            {' '}
            Leaves out {money(tree.omitted.value, base)} across {tree.omitted.count}{' '}
            {tree.omitted.count === 1 ? 'entry' : 'entries'} with no positive value (an overdraft, or
            something not priced yet).
          </>
        )}
      </p>
    </div>
  );
}

export { PieIcon };
