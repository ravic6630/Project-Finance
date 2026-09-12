import { useState } from 'react';
import { Compass, Crown } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useApi } from '../../lib/useApi.js';
import { ErrorBanner } from '../ui.jsx';
import { CardSkeleton, Reveal, Shimmer } from '../fx.jsx';
import UpgradeModal from '../UpgradeModal.jsx';
import FiPanel from './FiPanel.jsx';
import RiskPanel from './RiskPanel.jsx';

/* The Insights tab of the Goals hub — formerly its own page.

   Two readings of the same portfolio: where it's taking you (financial
   independence) and where it's exposed (concentration and allocation). Lives
   beside Goals because both answer "am I going to get there?", and beside the
   calculator because that is where the what-ifs get tried. */

function InsightsSkeleton() {
  return (
    <div className="space-y-6" role="status">
      <span className="sr-only">Loading your insights…</span>
      <Shimmer className="h-56 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <Shimmer className="h-64 w-full" />
    </div>
  );
}

export default function InsightsPanel() {
  const { user } = useAuth();
  const base = user.base_currency;
  // Varies by base currency: every figure comes back converted, so a switch
  // must not paint rupee numbers under a dollar sign even for a frame.
  const { data, loading, error, status, reload } = useApi('/insights', { vary: [base] });
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  if (loading) return <InsightsSkeleton />;

  // 402 is the premium wall, not a failure — show the upsell instead.
  if (status === 402 && !data) {
    return (
      <div className="card relative overflow-hidden p-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <Compass size={26} />
        </div>
        <h2 className="font-display mt-4 text-2xl font-bold tracking-tight text-slate-900">
          Insights is a Premium feature
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
          See how close you are to financial independence, what each year of your life costs, and
          where your portfolio is concentrated.
        </p>
        <button className="btn-primary mt-6" onClick={() => setUpgradeOpen(true)}>
          <Crown size={16} /> See Premium
        </button>
        <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} onChanged={reload} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <ErrorBanner message={error} />

      <Reveal>
        <FiPanel data={data?.fi} base={data?.base_currency || base} prefs={data?.prefs} onSaved={reload} />
      </Reveal>

      <Reveal delay={0.05}>
        <RiskPanel data={data?.risk} base={data?.base_currency || base} />
      </Reveal>
    </div>
  );
}
