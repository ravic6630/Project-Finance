/* Hand-drawn empty-state scenes in the brand language: thin navy outlines,
   champagne-gold accents, the sprout motif, and a soft backdrop blob. Every
   colour has a dark-mode variant; the float/sway animations live in index.css
   and stop under prefers-reduced-motion. */

const LINE = 'stroke-brand-500 dark:stroke-[#8fa9cd]';
const SOFT = 'stroke-slate-300 dark:stroke-[#2e4064]';
const BLOB = 'fill-brand-50 dark:fill-[#14233d]';
const GOLD = '#c2a368';
const GOLD_LIGHT = '#e7d2a4';
const GOLD_DEEP = '#8c6f3b';
const LEAF = '#3f8f60';

function Coin({ x, y, r = 11, float = false }) {
  return (
    <g className={float ? 'illo-float' : undefined}>
      <circle cx={x} cy={y} r={r} fill={GOLD_LIGHT} stroke={GOLD} strokeWidth="2" />
      <text
        x={x}
        y={y + 4}
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        fill={GOLD_DEEP}
        style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
      >
        ₹
      </text>
    </g>
  );
}

function Sprout({ x, y, scale = 1 }) {
  // Outer group carries the SVG placement; the CSS sway lives on an inner group,
  // because a CSS `transform` would otherwise replace the placement attribute.
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className="illo-sway">
        <path d="M0,0 C0,-7 0,-12 0,-16" stroke={LEAF} strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <path d="M0,-9 C-8,-11 -12,-17 -13,-23 C-6,-22 -1,-17 0,-9 Z" fill={LEAF} opacity="0.85" />
        <path d="M0,-12 C7,-14 11,-20 12,-26 C5,-25 1,-19 0,-12 Z" fill={LEAF} />
      </g>
    </g>
  );
}

/* Investments — coin stacks climbing, a sprout on top, a rising gold line. */
function InvestScene() {
  return (
    <svg viewBox="0 0 200 150" className="h-36 w-48" aria-hidden>
      <ellipse cx="100" cy="88" rx="88" ry="54" className={BLOB} />
      <line x1="30" y1="126" x2="170" y2="126" className={SOFT} strokeWidth="2" strokeLinecap="round" />
      {[
        [52, 108, 18],
        [92, 92, 34],
        [132, 74, 52],
      ].map(([x, y, h]) => (
        <g key={x}>
          <rect x={x - 14} y={y} width="28" height={h} rx="5" fill="none" strokeWidth="2" className={LINE} />
          <ellipse cx={x} cy={y} rx="14" ry="5" fill={GOLD_LIGHT} stroke={GOLD} strokeWidth="2" />
        </g>
      ))}
      <path
        d="M40,84 C70,76 90,64 118,48 L148,30"
        fill="none"
        stroke={GOLD}
        strokeWidth="2.5"
        strokeDasharray="5 6"
        strokeLinecap="round"
      />
      <path d="M148,30 l-10,-1 M148,30 l-2,10" stroke={GOLD} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Sprout x={132} y={72} />
      <Coin x={44} y={52} float />
    </svg>
  );
}

/* Goals — a summit flag, the dotted path up, a sprout at the trailhead. */
function GoalsScene() {
  return (
    <svg viewBox="0 0 200 150" className="h-36 w-48" aria-hidden>
      <ellipse cx="100" cy="88" rx="88" ry="54" className={BLOB} />
      <path
        d="M22,126 L74,54 L102,88 L128,34 L178,126 Z"
        fill="none"
        strokeWidth="2"
        strokeLinejoin="round"
        className={LINE}
      />
      <path d="M22,126 h156" className={SOFT} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M42,122 C74,112 92,96 108,78 C116,68 122,54 127,42"
        fill="none"
        stroke={GOLD}
        strokeWidth="2.5"
        strokeDasharray="1 8"
        strokeLinecap="round"
      />
      <g className="illo-float">
        <line x1="128" y1="34" x2="128" y2="10" className={LINE} strokeWidth="2" strokeLinecap="round" />
        <path d="M128,11 l20,6 l-20,6 Z" fill={GOLD} />
      </g>
      <Sprout x={40} y={122} scale={0.9} />
    </svg>
  );
}

/* Assets — a little home and a tree, wealth with roots. */
function AssetsScene() {
  return (
    <svg viewBox="0 0 200 150" className="h-36 w-48" aria-hidden>
      <ellipse cx="100" cy="88" rx="88" ry="54" className={BLOB} />
      <line x1="26" y1="124" x2="174" y2="124" className={SOFT} strokeWidth="2" strokeLinecap="round" />
      <rect x="58" y="76" width="62" height="48" rx="4" fill="none" strokeWidth="2" className={LINE} />
      <path d="M52,78 L89,46 L126,78" fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className={LINE} />
      <rect x="80" y="96" width="18" height="28" rx="3" fill={GOLD_LIGHT} stroke={GOLD} strokeWidth="2" />
      <rect x="104" y="88" width="10" height="10" rx="2" fill="none" strokeWidth="2" className={LINE} />
      <g className="illo-sway">
        <line x1="150" y1="124" x2="150" y2="98" className={LINE} strokeWidth="2" strokeLinecap="round" />
        <circle cx="150" cy="84" r="17" fill={LEAF} opacity="0.9" />
      </g>
      <Coin x={44} y={58} float />
    </svg>
  );
}

/* Cash — a piggy bank waiting for its first coin. */
function CashScene() {
  return (
    <svg viewBox="0 0 200 150" className="h-36 w-48" aria-hidden>
      <ellipse cx="100" cy="88" rx="88" ry="54" className={BLOB} />
      <line x1="34" y1="126" x2="166" y2="126" className={SOFT} strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="100" cy="92" rx="44" ry="32" fill="none" strokeWidth="2" className={LINE} />
      <path d="M140,84 c8,-2 12,4 8,10 c-3,4 -8,3 -10,1" fill="none" strokeWidth="2" strokeLinecap="round" className={LINE} />
      <path d="M64,74 c-6,-10 2,-16 10,-12" fill="none" strokeWidth="2" strokeLinecap="round" className={LINE} />
      <line x1="82" y1="122" x2="82" y2="130" strokeWidth="2.5" strokeLinecap="round" className={LINE} />
      <line x1="118" y1="122" x2="118" y2="130" strokeWidth="2.5" strokeLinecap="round" className={LINE} />
      <rect x="88" y="58" width="26" height="4" rx="2" fill={GOLD} />
      <circle cx="88" cy="92" r="3" fill={GOLD} />
      <Coin x={101} y={34} float />
      <path d="M52,44 l4,0 m-2,-2 l0,4 M150,52 l5,0 m-2.5,-2.5 l0,5" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/* Transactions — money in motion: a gentle cycle of coin and leaf. */
function TransactionsScene() {
  return (
    <svg viewBox="0 0 200 150" className="h-36 w-48" aria-hidden>
      <ellipse cx="100" cy="80" rx="88" ry="54" className={BLOB} />
      <path d="M66,52 A44 44 0 0 1 140,58" fill="none" strokeWidth="2" strokeLinecap="round" className={LINE} />
      <path d="M140,58 l-2,-10 M140,58 l-10,1" strokeWidth="2" strokeLinecap="round" fill="none" className={LINE} />
      <path d="M134,108 A44 44 0 0 1 60,102" fill="none" strokeWidth="2" strokeLinecap="round" className={LINE} />
      <path d="M60,102 l2,10 M60,102 l10,-1" strokeWidth="2" strokeLinecap="round" fill="none" className={LINE} />
      <Coin x={156} y={84} r={13} float />
      <g className="illo-sway">
        <path d="M44,96 C30,88 26,72 28,60 C42,64 50,76 48,92 Z" fill={LEAF} opacity="0.9" />
        <path d="M44,96 C40,84 36,72 30,62" stroke="#2c6b47" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

const SCENES = {
  invest: InvestScene,
  goals: GoalsScene,
  assets: AssetsScene,
  cash: CashScene,
  transactions: TransactionsScene,
};

export default function Illo({ name }) {
  const Scene = SCENES[name];
  return Scene ? <Scene /> : null;
}
