import { Link } from 'react-router-dom';
import { ChevronRight, HeartPulse } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext.jsx';
import { useApi } from '../../lib/useApi.js';
import { Reveal, Spotlight } from '../fx.jsx';
import HealthRing, { BandChip } from './HealthRing.jsx';

/* The dashboard's one-line answer to "how am I doing, overall?" — the ring,
   the band, and the single weakest area, which is the thing worth doing next.
   Everything else lives one click away on the Health tab.

   `health` is the copy the "Everyone" dashboard carries, priced in the same
   request. Every other view of your own money (Me, a managed profile) comes
   without one, so the card asks for it — the score is always the whole
   account, and `wholeAccount` says so beside a narrower view's numbers. */
export default function HealthCard({ health, wholeAccount = false }) {
  const { user } = useAuth();
  const fetched = useApi('/financial-health', { vary: [user.base_currency], enabled: health == null });
  const h = health ?? fetched.data;
  // Nothing measured is nothing to say: Getting Started is already on screen
  // for that account, and an empty ring beside it would only repeat it. A
  // failed fetch also stays quiet here; the Health tab shows the error.
  if (!h || !h.scored) return null;
  const { score, band, scored, total, weakest } = h;

  return (
    <Reveal y={12}>
      <Spotlight
        as={Link}
        to="/goals?tab=health"
        className="card-interactive group flex items-center gap-4 p-4 sm:gap-5 sm:p-5"
        aria-label={score == null ? 'Financial health — building' : `Financial health ${score} out of 100, ${band.label}`}
      >
        <HealthRing score={score} band={band} size={72} stroke={7}>
          {score == null ? (
            <HeartPulse size={20} className="text-slate-400" />
          ) : (
            <span className="num text-xl font-extrabold tracking-tight text-slate-900">{score}</span>
          )}
        </HealthRing>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Financial health
            {wholeAccount && <span className="font-medium normal-case tracking-normal text-slate-400"> · whole account</span>}
          </p>
          {score == null ? (
            <>
              <p className="font-display mt-1 text-lg font-bold tracking-tight text-slate-900">Building your score</p>
              <p className="mt-0.5 text-sm text-slate-500">
                {scored} of {total} areas measured — a score needs three.
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <BandChip band={band} />
                <span className="text-sm text-slate-500">
                  across {scored} of {total} dimensions
                </span>
              </p>
              {weakest && (
                <p className="mt-1.5 truncate text-sm text-slate-600">
                  Weakest: <span className="font-semibold text-slate-800">{weakest.label}</span>{' '}
                  <span className="num text-slate-400">· {weakest.score}</span>
                </p>
              )}
            </>
          )}
        </div>

        <ChevronRight
          size={18}
          className="shrink-0 text-slate-300 transition duration-200 group-hover:translate-x-0.5 group-hover:text-brand-500"
          aria-hidden="true"
        />
      </Spotlight>
    </Reveal>
  );
}
