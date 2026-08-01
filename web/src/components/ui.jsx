import { X } from 'lucide-react';
import Illo from './Illustrations.jsx';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500" />
      {label}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function Modal({ open, onClose, title, children, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  // Backdrop click intentionally does NOT close — these modals hold form input,
  // so closing is explicit (the X, a Cancel button, or Escape) to avoid losing work.
  // The header is pinned and only the body scrolls, so the close button stays
  // reachable even in a tall modal (e.g. the calculator).
  // Portaled to <body>: an ancestor with backdrop-filter/transform (like the
  // blurred app header) would otherwise become the containing block for
  // position:fixed and pin the dialog inside itself.
  return createPortal(
    <div className="modal-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm sm:items-center">
      <div className={`modal-pop card my-8 flex max-h-[calc(100vh-4rem)] w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} flex-col overflow-hidden p-0`}>
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}

export function EmptyState({ icon: Icon, illo, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 py-14 text-center">
      {illo ? (
        <div className="mb-1"><Illo name={illo} /></div>
      ) : (
        Icon && <Icon className="mb-3 text-slate-300" size={40} />
      )}
      <p className="font-semibold text-slate-700">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-slate-400">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
      {message}
    </div>
  );
}
