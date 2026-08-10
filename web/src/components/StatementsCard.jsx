import { useEffect, useState } from 'react';
import { Crown, FileText, Loader2 } from 'lucide-react';
import { api, apiUrl, getToken } from '../lib/api.js';

// Monthly statements: pick a month and open a crisp printable statement
// (browser print = save as PDF). Premium users can also opt in to receive
// last month's statement by email on the 1st.
export default function StatementsCard({ onUpgrade }) {
  const [months, setMonths] = useState([]);
  const [ym, setYm] = useState('');
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api('/statements')
      .then((d) => {
        setMonths(d.months || []);
        // Default to last month when it exists, else the newest available.
        setYm(d.months?.[1]?.ym || d.months?.[0]?.ym || '');
      })
      .catch(() => {});
    api('/email/prefs').then(setPrefs).catch(() => {});
  }, []);

  async function view() {
    setError('');
    setBusy('view');
    try {
      const res = await fetch(apiUrl(`/statements/${ym}/html`), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Could not build that statement — try again.');
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function toggleEmail() {
    if (!prefs?.premium) return onUpgrade?.();
    setError('');
    setBusy('toggle');
    try {
      const d = await api('/email/prefs', {
        method: 'PUT',
        body: { monthly_statement: !prefs.monthly_statement },
      });
      setPrefs((p) => ({ ...p, monthly_statement: d.monthly_statement }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const emailOn = !!prefs?.monthly_statement;

  return (
    <div className="card p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <FileText size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-slate-900">Monthly statements</h3>
          <p className="mt-1 text-sm text-slate-500">
            One crisp page per month — how your net worth moved, money in and out, where it went,
            and where everything stands. Open it and use your browser&apos;s print to save a PDF.
          </p>

          {error && <p className="mt-2 text-sm font-medium text-rose-600">{error}</p>}

          <div className="mt-4 flex flex-wrap items-stretch gap-2">
            <select className="input w-auto min-w-[150px]" value={ym} onChange={(e) => setYm(e.target.value)}>
              {months.map((m) => (
                <option key={m.ym} value={m.ym}>
                  {m.label}
                </option>
              ))}
            </select>
            <button className="btn-primary shrink-0" onClick={view} disabled={!ym || busy === 'view'}>
              {busy === 'view' ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
              View statement
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                Email me each month {!prefs?.premium && <Crown size={13} className="text-amber-500" />}
              </p>
              <p className="text-xs text-slate-400">
                Last month&apos;s statement lands in your inbox on the 1st.
              </p>
            </div>
            <button
              onClick={toggleEmail}
              disabled={busy === 'toggle'}
              aria-pressed={emailOn}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${emailOn ? 'bg-brand-600' : 'bg-slate-200'}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${emailOn ? 'left-[22px]' : 'left-0.5'}`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
