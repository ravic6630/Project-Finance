import { useEffect, useState } from 'react';
import { Building2, Crown, Loader2, Sparkles } from 'lucide-react';
import { api } from '../lib/api.js';
import { ErrorBanner, Modal } from './ui.jsx';
import ImportReview from './ImportReview.jsx';
import UpgradeModal from './UpgradeModal.jsx';

const BROKERS = [
  { id: 'zerodha', label: 'Zerodha', blurb: 'Kite Connect — holdings API is free' },
  { id: 'upstox', label: 'Upstox', blurb: 'OAuth 2.0 holdings API' },
];

export default function BrokerConnect({ open, onClose, onImported }) {
  const [configured, setConfigured] = useState({});
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setError('');
    api('/broker/status')
      .then((d) => setConfigured(d.configured || {}))
      .catch(() => setConfigured({}));
  }, [open]);

  function close() {
    setData(null);
    setError('');
    onClose();
  }

  async function connect(broker) {
    setError('');
    setNeedsUpgrade(false);
    setBusy(broker);
    try {
      const { url } = await api(`/broker/${broker}/login-url`);
      window.location.href = url; // broker returns to /broker/<broker>/callback
    } catch (err) {
      if (/premium/i.test(err.message)) setNeedsUpgrade(true);
      setError(err.message);
      setBusy('');
    }
  }

  async function demo(broker) {
    setError('');
    setBusy(broker + ':demo');
    try {
      setData(await api(`/broker/${broker}/connect`, { method: 'POST', body: { demo: true } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
    <Modal open={open} onClose={close} title="Connect a broker" wide>
      {data ? (
        <ImportReview
          data={data}
          source={`Imported from ${data.broker_label}`}
          onBack={() => setData(null)}
          onClose={close}
          onImported={onImported}
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Log in at your broker to pull your stock holdings automatically. We only read holdings —
            we never place orders. You can also preview the flow with sample data.
          </p>

          {BROKERS.map((b) => (
            <div key={b.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <Building2 size={20} />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">{b.label}</p>
                  <p className="text-xs text-slate-400">
                    {b.blurb}
                    {!configured[b.id] && ' · needs API keys in server/.env'}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => demo(b.id)} disabled={!!busy}>
                  {busy === b.id + ':demo' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  Sample
                </button>
                <button className="btn-primary" onClick={() => connect(b.id)} disabled={!!busy}>
                  {busy === b.id ? <Loader2 size={16} className="animate-spin" /> : null}
                  Connect
                </button>
              </div>
            </div>
          ))}

          <ErrorBanner message={error} />
          {needsUpgrade && (
            <button className="btn-primary w-full" onClick={() => setUpgradeOpen(true)}>
              <Crown size={16} /> Upgrade to connect a broker
            </button>
          )}
          <p className="text-xs text-slate-400">
            To enable live connect, create a free developer app at the broker, set its redirect URL to
            <code className="mx-1 rounded bg-slate-100 px-1">http://localhost:3000/broker/&lt;broker&gt;/callback</code>
            and add the keys to <code className="rounded bg-slate-100 px-1">server/.env</code>.
          </p>
        </div>
      )}
    </Modal>
    <UpgradeModal
      open={upgradeOpen}
      onClose={() => setUpgradeOpen(false)}
      onChanged={() => { setNeedsUpgrade(false); setError(''); }}
    />
    </>
  );
}
