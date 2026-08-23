import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

// Promise-based confirm dialog — a premium replacement for window.confirm().
// Usage:  const confirm = useConfirm();
//         if (!(await confirm({ title, message, confirmLabel, danger: true }))) return;
const ConfirmContext = createContext(() => Promise.resolve(true));

export function ConfirmProvider({ children }) {
  const [opts, setOpts] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setOpts({ confirmLabel: 'Confirm', cancelLabel: 'Cancel', danger: false, ...options });
      }),
    []
  );

  const settle = useCallback((value) => {
    setOpts(null);
    if (resolver.current) {
      resolver.current(value);
      resolver.current = null;
    }
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && <ConfirmDialog {...opts} onCancel={() => settle(false)} onConfirm={() => settle(true)} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger, onCancel, onConfirm }) {
  const confirmRef = useRef(null);

  useEffect(() => {
    confirmRef.current?.focus();
    // Capture phase + stopPropagation: otherwise Escape here ALSO reaches the
    // Modal underneath and closes both dialogs at once.
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel, onConfirm]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onMouseDown={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="card w-full max-w-sm p-6 text-center"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${
            danger ? 'bg-rose-100 text-rose-600' : 'bg-brand-50 text-brand-600'
          }`}
        >
          <AlertTriangle size={24} />
        </div>
        <h3 className="mt-4 text-lg font-bold text-slate-900">{title}</h3>
        {message && <p className="mt-1.5 text-sm text-slate-500">{message}</p>}
        <div className="mt-6 flex gap-2">
          <button className="btn-ghost flex-1 justify-center" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`flex-1 justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition ${
              danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-brand-700 hover:bg-brand-800'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
