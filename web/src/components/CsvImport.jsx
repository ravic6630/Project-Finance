import { useState } from 'react';
import { FileSpreadsheet, Loader2, Sparkles, Upload } from 'lucide-react';
import { api } from '../lib/api.js';
import { ErrorBanner, Field, Modal } from './ui.jsx';
import { STOCK_MARKETS } from '../lib/markets.js';
import ImportReview from './ImportReview.jsx';

const SAMPLE = `Symbol,Quantity,Avg Cost
AAPL,10,150.20
MSFT,5,400.00
GOOGL,3,135.50`;

export default function CsvImport({ open, onClose, onImported }) {
  const [kind, setKind] = useState('US_STOCK');
  const [csv, setCsv] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setCsv('');
    setData(null);
    setError('');
  }
  function close() {
    reset();
    onClose();
  }

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    // Clear it, or picking the SAME file again fires no change event at all.
    e.target.value = '';
    setError('');
    try {
      setCsv(await f.text());
    } catch {
      setError('Could not read that file.');
    }
  }

  async function preview() {
    setError('');
    setBusy(true);
    try {
      setData(await api('/import/csv/preview', { method: 'POST', body: { csv, kind } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const marketLabel = STOCK_MARKETS.find((m) => m.kind === kind)?.label || '';

  return (
    <Modal open={open} onClose={close} title="Import holdings from CSV" wide>
      {data ? (
        <ImportReview
          data={data}
          source={`Imported from ${marketLabel} CSV`}
          onBack={() => setData(null)}
          onClose={close}
          onImported={onImported}
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Works with <strong>any broker, in any country</strong>. Export your holdings as a CSV from
            your broker, pick the market, and paste or upload it. We only read the symbol, quantity and
            cost columns.
          </p>

          <Field label="Which market is this CSV from?">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              {STOCK_MARKETS.map((m) => (
                <option key={m.kind} value={m.kind}>
                  {m.flag} {m.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Paste CSV" hint="The first row should be column headers (e.g. Symbol, Quantity, Avg cost).">
            <textarea
              className="input font-mono text-xs"
              rows={7}
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setError('');
              }}
              placeholder={SAMPLE}
            />
          </Field>

          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-brand-600 hover:underline">
            <Upload size={15} /> or upload a .csv file
            <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onFile} />
          </label>

          <ErrorBanner message={error} />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              className="btn-ghost"
              onClick={() => {
                setCsv(SAMPLE);
                setError('');
              }}
              disabled={busy}
            >
              <Sparkles size={16} /> Use sample data
            </button>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={close}>
                Cancel
              </button>
              <button className="btn-primary" onClick={preview} disabled={busy || !csv.trim()}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
                Preview holdings
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
