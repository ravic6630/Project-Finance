import { useEffect, useState } from 'react';
import { ChevronLeft, Crown, Loader2, RefreshCw, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../lib/api.js';
import { ErrorBanner, Modal } from './ui.jsx';
import ImportReview from './ImportReview.jsx';
import { isNative } from '../lib/native.js';
import UpgradeModal from './UpgradeModal.jsx';

// Adding a broker here (+ its backend support) surfaces it in the picker.
const BROKERS = [
  { id: 'zerodha', label: 'Zerodha', blurb: 'Kite Connect — free holdings API', country: 'India', flag: '🇮🇳', color: '#387ED1' },
  { id: 'upstox', label: 'Upstox', blurb: 'OAuth 2.0 holdings API', country: 'India', flag: '🇮🇳', color: '#6C5CE7' },
  { id: 'angelone', label: 'Angel One', blurb: 'SmartAPI — free holdings API', country: 'India', flag: '🇮🇳', color: '#F04E3E' },
  { id: 'fyers', label: 'Fyers', blurb: 'API v3 — free holdings API', country: 'India', flag: '🇮🇳', color: '#00B386' },
];

function Monogram({ broker, lg }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center font-bold text-white ${
        lg ? 'h-14 w-14 rounded-2xl text-2xl' : 'h-10 w-10 rounded-xl text-base'
      }`}
      style={{ backgroundColor: broker.color }}
    >
      {broker.label[0]}
    </span>
  );
}

export default function BrokerConnect({ open, onClose, onImported }) {
  const [configured, setConfigured] = useState({});
  const [connected, setConnected] = useState({});
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setSelected(null);
    setQuery('');
    setError('');
    setNeedsUpgrade(false);
    api('/broker/status')
      .then((d) => {
        setConfigured(d.configured || {});
        setConnected(d.connected || {});
      })
      .catch(() => {
        setConfigured({});
        setConnected({});
      });
  }, [open]);

  function close() {
    setData(null);
    setSelected(null);
    setError('');
    onClose();
  }

  function pick(broker) {
    setError('');
    setNeedsUpgrade(false);
    setSelected(broker);
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

  // Re-pull holdings with the saved token — no OAuth round-trip. If the broker
  // session has expired the server answers 401 with a friendly message.
  async function sync(broker) {
    setError('');
    setBusy(broker + ':sync');
    try {
      setData(await api(`/broker/${broker}/sync`, { method: 'POST' }));
    } catch (err) {
      if (err.status === 402) setNeedsUpgrade(true);
      setError(err.message);
    } finally {
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

  const q = query.trim().toLowerCase();
  const filtered = q
    ? BROKERS.filter((b) => `${b.label} ${b.country} ${b.blurb}`.toLowerCase().includes(q))
    : BROKERS;

  const redirectHint = (id) =>
    `${typeof window !== 'undefined' ? window.location.origin : ''}/broker/${id}/callback`;

  return (
    <>
      <Modal open={open} onClose={close} title="Connect a broker" wide>
        {data ? (
          <ImportReview
            sync
            data={data}
            source={`Imported from ${data.broker_label}`}
            onBack={() => setData(null)}
            onClose={close}
            onImported={onImported}
          />
        ) : selected ? (
          /* ---- Focused connect panel for the chosen broker ---- */
          <div className="space-y-5">
            <button
              onClick={() => {
                setSelected(null);
                setError('');
                setNeedsUpgrade(false);
              }}
              className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-brand-700"
            >
              <ChevronLeft size={15} /> All brokers
            </button>

            <div className="flex items-center gap-4">
              <Monogram broker={selected} lg />
              <div>
                <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                  {selected.label} <span className="text-sm font-normal text-slate-400">{selected.flag} {selected.country}</span>
                </h3>
                <p className="text-sm text-slate-500">{selected.blurb}</p>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-500" />
              Read-only login — we pull your holdings and never place orders or move money.
            </div>

            <ErrorBanner message={error} />
            {needsUpgrade && (
              <button className="btn-primary w-full" onClick={() => setUpgradeOpen(true)}>
                <Crown size={16} /> Upgrade to connect a broker
              </button>
            )}
            {!configured[selected.id] && (
              <p className="text-xs leading-relaxed text-slate-400">
                Live connect needs API keys: create a free developer app at {selected.label}, set its
                redirect URL to{' '}
                <code className="rounded bg-slate-100 px-1">{redirectHint(selected.id)}</code> and add the
                keys to <code className="rounded bg-slate-100 px-1">server/.env</code>. You can preview
                with sample data right now.
              </p>
            )}

            {connected[selected.id] && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                <RefreshCw size={13} /> Connected — you can re-sync without logging in again.
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button className="btn-ghost" onClick={() => demo(selected.id)} disabled={!!busy}>
                {busy === selected.id + ':demo' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                Try sample data
              </button>
              {connected[selected.id] ? (
                <>
                  <button className="btn-ghost" onClick={() => connect(selected.id)} disabled={!!busy}>
                    {busy === selected.id ? <Loader2 size={16} className="animate-spin" /> : null}
                    Reconnect
                  </button>
                  <button className="btn-primary" onClick={() => sync(selected.id)} disabled={!!busy}>
                    {busy === selected.id + ':sync' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                    Sync now
                  </button>
                </>
              ) : (
                isNative ? (
                  <p className="rounded-xl bg-slate-100 px-3 py-2.5 text-xs font-medium text-slate-500">
                    First-time connection to {selected.label} happens on the Sampada website — the
                    broker sends you back there to finish signing in. Once it&apos;s linked,
                    <span className="font-semibold text-slate-700"> Sync now</span> works right here
                    on your phone.
                  </p>
                ) : (
                  <button className="btn-primary" onClick={() => connect(selected.id)} disabled={!!busy}>
                    {busy === selected.id ? <Loader2 size={16} className="animate-spin" /> : null}
                    Connect {selected.label}
                  </button>
                )
              )}
            </div>
          </div>
        ) : (
          /* ---- Searchable broker picker ---- */
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Pick your broker to pull holdings automatically — we only read holdings, never place
              orders. You can also preview the flow with sample data.
            </p>

            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered.length) pick(filtered[0]);
                }}
                placeholder="Search brokers…"
                className="input pl-9"
              />
            </div>

            {filtered.length ? (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {filtered.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => pick(b)}
                    className="group flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-brand-400 hover:bg-brand-50/40 hover:shadow-sm"
                  >
                    <Monogram broker={b} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 font-semibold text-slate-900">
                        {b.label} <span className="text-xs">{b.flag}</span>
                      </p>
                      <p className="truncate text-xs text-slate-400">{b.blurb}</p>
                    </div>
                    {configured[b.id] && <span className="chip bg-emerald-50 text-emerald-600">Ready</span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm">
                <p className="text-slate-600">No broker matches “{query}”.</p>
                <p className="mt-1 text-slate-400">Add holdings manually, or use Import CSV (works with any broker).</p>
              </div>
            )}

            <ErrorBanner message={error} />
            <p className="text-xs text-slate-400">
              {BROKERS.length} broker{BROKERS.length === 1 ? '' : 's'} available, more on the way. Don&apos;t
              see yours? Add holdings manually or import a CSV from any broker.
            </p>
          </div>
        )}
      </Modal>
      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        onChanged={() => {
          setNeedsUpgrade(false);
          setError('');
        }}
      />
    </>
  );
}
