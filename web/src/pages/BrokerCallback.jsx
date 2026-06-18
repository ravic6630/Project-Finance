import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ErrorBanner, Spinner } from '../components/ui.jsx';
import ImportReview from '../components/ImportReview.jsx';

// Brokers redirect here after login (Zerodha → ?request_token=…, Upstox → ?code=…).
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
    if (!request_token && !code) {
      setError('No login token came back from the broker. Please try connecting again.');
      setLoading(false);
      return;
    }
    api(`/broker/${broker}/connect`, { method: 'POST', body: { request_token, code } })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [broker, params]);

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
          <ImportReview
            data={data}
            source={`Imported from ${data.broker_label}`}
            onClose={() => navigate('/investments')}
          />
        ) : null}
      </div>
    </div>
  );
}
