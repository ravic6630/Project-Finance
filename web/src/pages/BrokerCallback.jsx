import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ErrorBanner, Spinner } from '../components/ui.jsx';
import ImportReview from '../components/ImportReview.jsx';

// Brokers redirect here after login (Zerodha → ?request_token=…, Upstox → ?code=…,
// Angel One → ?auth_token=…, Fyers → ?auth_code=…).
export default function BrokerCallback() {
  const { broker } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard React 18 StrictMode double-run
    ran.current = true;
    const request_token = params.get('request_token');
    const code = params.get('code');
    const auth_token = params.get('auth_token');
    const auth_code = params.get('auth_code');
    // Strip the one-time login params from the URL so a browser back/refresh can't
    // replay a consumed code (the broker rejects a reused code with 401).
    window.history.replaceState(null, '', `/broker/${broker}/callback`);
    if (!request_token && !code && !auth_token && !auth_code) {
      // Nothing to exchange (e.g. user hit Back to this now-stale URL) — just leave.
      navigate('/investments', { replace: true });
      return;
    }
    api(`/broker/${broker}/connect`, { method: 'POST', body: { request_token, code, auth_token, auth_code } })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [broker, params, navigate]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="card p-6">
        <h2 className="mb-4 text-lg font-bold text-slate-900">
          Connecting {broker?.charAt(0).toUpperCase() + broker?.slice(1)}…
        </h2>
        {loading ? (
          <Spinner label="Fetching your holdings…" />
        ) : error ? (
          <div className="space-y-4">
            <ErrorBanner message={error} />
            <button className="btn-ghost" onClick={() => navigate('/investments')}>
              ← Back to Investments
            </button>
          </div>
        ) : data ? (
          // `sync` matters here: this IS a broker sync, just one that came in
          // through a fresh login rather than the saved token. Without it the
          // reconnect path imports but never prunes, so a position sold since
          // the last import survives a reconnect — while "Sync now" removes it.
          // Same source label and same full-snapshot payload as that path, so
          // the prune is scoped identically.
          <ImportReview
            sync
            data={data}
            source={`Imported from ${data.broker_label}`}
            onClose={() => navigate('/investments')}
          />
        ) : null}
      </div>
    </div>
  );
}
