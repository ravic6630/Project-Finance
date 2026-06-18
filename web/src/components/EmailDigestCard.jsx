import { useEffect, useState } from 'react';
import { Crown, Eye, Loader2, Mail, Send } from 'lucide-react';
import { api } from '../lib/api.js';
import { Modal } from './ui.jsx';

export default function EmailDigestCard({ onUpgrade }) {
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null); // {type:'ok'|'err', text}
  const [previewHtml, setPreviewHtml] = useState(null);

  const load = () => api('/email/prefs').then(setPrefs).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  async function toggle() {
    if (!prefs.premium) return onUpgrade?.();
    setMsg(null);
    setBusy('toggle');
    try {
      const d = await api('/email/prefs', { method: 'PUT', body: { daily: !prefs.daily } });
      setPrefs((p) => ({ ...p, daily: d.daily }));
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function preview() {
    setBusy('preview');
    try {
      const d = await api('/email/preview');
      setPreviewHtml(d.html);
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function test() {
    setMsg(null);
    setBusy('test');
    try {
      const d = await api('/email/test', { method: 'POST' });
      setMsg({ type: 'ok', text: `Test email sent to ${d.to}.` });
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    } finally {
      setBusy('');
    }
  }

  const on = prefs?.daily;

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Mail size={20} />
          </div>
          <div>
            <h3 className="flex items-center gap-2 font-bold text-slate-900">
              Daily summary email
              {prefs && !prefs.premium && (
                <span className="chip bg-amber-100 text-amber-700">
                  <Crown size={12} className="mr-1" /> Premium
                </span>
              )}
            </h3>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Get a “good morning” email each day with your net worth, investments and this month’s
              cashflow{prefs?.email ? ` at ${prefs.email}` : ''}.
            </p>
          </div>
        </div>

        {/* toggle switch */}
        <button
          onClick={toggle}
          disabled={busy === 'toggle' || !prefs}
          className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-brand-600' : 'bg-slate-300'}`}
          aria-pressed={!!on}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`}
          />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="btn-ghost" onClick={preview} disabled={!!busy}>
          {busy === 'preview' ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
          Preview email
        </button>
        {prefs?.premium && (
          <button className="btn-ghost" onClick={test} disabled={!!busy}>
            {busy === 'test' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Send test
          </button>
        )}
      </div>

      {msg && (
        <p className={`mt-3 text-sm ${msg.type === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>
          {msg.text}
        </p>
      )}
      {prefs && !prefs.configured && (
        <p className="mt-2 text-xs text-slate-400">
          Sending isn’t set up on this server yet — add SMTP keys in{' '}
          <code className="rounded bg-slate-100 px-1">server/.env</code>. Preview still works.
        </p>
      )}

      <Modal open={!!previewHtml} onClose={() => setPreviewHtml(null)} title="Daily email preview" wide>
        <iframe
          title="email-preview"
          srcDoc={previewHtml || ''}
          className="h-[60vh] w-full rounded-xl border border-slate-200"
        />
      </Modal>
    </div>
  );
}
