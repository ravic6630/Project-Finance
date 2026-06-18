import { useState } from 'react';
import { FileText, Info, Loader2, Sparkles, Upload } from 'lucide-react';
import { api, apiUpload } from '../lib/api.js';
import { ErrorBanner, Field, Modal } from './ui.jsx';
import ImportReview from './ImportReview.jsx';

export default function CasImport({ open, onClose, onImported }) {
  const [step, setStep] = useState('upload'); // upload | review
  const [file, setFile] = useState(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notSetup, setNotSetup] = useState(false);
  const [data, setData] = useState(null);

  function reset() {
    setStep('upload');
    setFile(null);
    setPassword('');
    setError('');
    setNotSetup(false);
    setData(null);
  }
  function close() {
    reset();
    onClose();
  }

  async function onUpload() {
    if (!file) return setError('Please choose your CAS PDF first.');
    setError('');
    setNotSetup(false);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('password', password);
      setData(await apiUpload('/import/cas', fd));
      setStep('review');
    } catch (err) {
      if (/set up|setup\.sh/i.test(err.message)) setNotSetup(true);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onDemo() {
    setError('');
    setNotSetup(false);
    setBusy(true);
    try {
      setData(await api('/import/cas/demo', { method: 'POST' }));
      setStep('review');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} title="Import from CAS statement" wide>
      {step === 'review' && data ? (
        <ImportReview
          data={data}
          source="Imported from CAS"
          onBack={() => setStep('upload')}
          onClose={close}
          onImported={onImported}
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Upload your <strong>Consolidated Account Statement (CAS)</strong> — one PDF that lists all
            your demat stocks and mutual funds. We read it and let you review before importing.
          </p>

          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center transition hover:border-brand-400 hover:bg-brand-50/40">
            <Upload className="text-brand-500" size={28} />
            {file ? (
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <FileText size={16} /> {file.name}
              </span>
            ) : (
              <>
                <span className="text-sm font-semibold text-slate-700">Click to choose your CAS PDF</span>
                <span className="text-xs text-slate-400">Original PDF from CDSL/NSDL or CAMS/KFintech</span>
              </>
            )}
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setError('');
              }}
            />
          </label>

          <Field label="PDF password (if protected)" hint="Usually the password set when you requested the statement.">
            <input
              className="input"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank if not protected"
            />
          </Field>

          {notSetup ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <Info size={16} className="mt-0.5 shrink-0" />
              <span>
                CAS parsing isn&apos;t enabled on this server yet. Run{' '}
                <code className="rounded bg-amber-100 px-1">server/tools/cas/setup.sh</code> once, then
                try again. You can still preview the flow with sample data below.
              </span>
            </div>
          ) : (
            <ErrorBanner message={error} />
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button className="btn-ghost" onClick={onDemo} disabled={busy}>
              <Sparkles size={16} /> Try with sample data
            </button>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={close}>
                Cancel
              </button>
              <button className="btn-primary" onClick={onUpload} disabled={busy || !file}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Read statement
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
