import { useCallback, useEffect, useRef, useState } from 'react';
import { Compass, Crown } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { ErrorBanner } from '../components/ui.jsx';
import { CardSkeleton, Reveal, Shimmer } from '../components/fx.jsx';
import UpgradeModal from '../components/UpgradeModal.jsx';
import FiPanel from '../components/insights/FiPanel.jsx';
import RiskPanel from '../components/insights/RiskPanel.jsx';

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

export default function Insights() {
  const { user } = useAuth();
  const base = user.base_currency; // re-fetch when the base currency changes
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Only the newest request may paint — switching currency mid-fetch otherwise
  // lets a stale response overwrite fresher numbers.
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++reqRef.current;
    try {
      setError('');
      const d = await api('/insights');
      if (reqRef.current !== ticket) return;
      setData(d);
      setLocked(false);
    } catch (err) {
      if (reqRef.current !== ticket) return;
      // 402 is the premium wall, not a failure — show the upsell instead.
      if (err.status === 402) setLocked(true);
      else setError(err.message);
    } finally {
      if (reqRef.current === ticket) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load, base]);

  if (loading) return <InsightsSkeleton />;

  if (locked) {
    return (
      <div className="card relative overflow-hidden p-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <Compass size={26} />
        </div>
        <h2 className="font-display mt-4 text-2xl font-bold tracking-tight text-slate-900">
          Insights is a Premium feature
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
          See how close you are to financial independence, how far your portfolio has drifted from
          your target mix, what your investments pay you each year, and where your risk is
          concentrated.
        </p>
        <button className="btn-primary mt-6" onClick={() => setUpgradeOpen(true)}>
          <Crown size={16} /> See Premium
        </button>
        <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} onChanged={load} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          Insights
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Two readings of the same portfolio: where it&apos;s taking you, and where it&apos;s exposed.
        </p>
        <div className="rule-fade mt-5" />
      </div>

      <ErrorBanner message={error} />

      <Reveal>
        <FiPanel data={data?.fi} base={data?.base_currency || base} prefs={data?.prefs} onSaved={load} />
      </Reveal>

      <Reveal delay={0.05}>
        <RiskPanel data={data?.risk} base={data?.base_currency || base} />
      </Reveal>
    </div>
  );
}
