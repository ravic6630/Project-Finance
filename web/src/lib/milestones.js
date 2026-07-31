// Net-worth milestones, ascending, in each currency's own units. Crossing one
// for the first time earns a confetti celebration; the highest reached also
// shows as a subtle "club" badge on the dashboard hero.
const TIERS = {
  INR: [1e7, 2.5e7, 5e7, 1e8, 2.5e8, 5e8, 1e9, 5e9], // ₹1Cr … ₹500Cr
  DEFAULT: [1e5, 2.5e5, 5e5, 1e6, 2.5e6, 5e6, 1e7, 5e7], // 100K … 50M
};

// The highest milestone the net worth has reached, or null.
export function reachedMilestone(netWorth, currency) {
  const tiers = TIERS[currency] || TIERS.DEFAULT;
  let hit = null;
  for (const v of tiers) if (netWorth >= v) hit = v;
  return hit;
}

const KEY = 'sampada_milestone';

// True the first time we see a NEW (higher than ever celebrated) milestone, and
// records it so it never re-fires. Guarded so SSR/private-mode can't throw.
export function isNewMilestone(milestone) {
  if (!milestone) return false;
  try {
    const seen = Number(localStorage.getItem(KEY) || 0);
    if (milestone > seen) {
      localStorage.setItem(KEY, String(milestone));
      return true;
    }
  } catch {
    /* storage unavailable — treat as already seen so we don't spam */
  }
  return false;
}
