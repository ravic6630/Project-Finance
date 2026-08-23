import { AlertCircle, X } from 'lucide-react';
import Illo from './Illustrations.jsx';
import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Magnetic, settle } from './fx.jsx';

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500 dark:border-t-gold-400" />
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

/* A primary action carries an inner top highlight (the light catching the top
   edge of the button) plus a short navy drop — the same lighting model as .card.
   Exported as a string so call sites can opt in without a wrapper component. */
export const btnPrimary =
  'btn-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_8px_20px_-10px_rgba(16,30,55,0.65)]';

// Use `magnetic` only where the primary action is alone on screen — a row of
// buttons that all lean toward the cursor reads as fidgety, not precise.
export function PrimaryButton({ children, className = '', magnetic = false, ...rest }) {
  const button = (
    <button className={`${btnPrimary} ${className}`} {...rest}>
      {children}
    </button>
  );
  return magnetic ? <Magnetic strength={0.18}>{button}</Magnetic> : button;
}

/* Section heading for card groups: display serif title, quiet subtitle, and an
   optional trailing action, so every section on every page lines up the same. */
export function SectionHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={`mb-4 flex items-end justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h2 className="font-display text-lg font-bold tracking-tight text-slate-900">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false }) {
  const reduced = useReducedMotion();
  const titleId = useId();

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
  // The scrim is .glass (frost) plus a thin navy wash: frost alone leaves the
  // page legible enough to compete with the dialog, a flat dim alone looks cheap.
  return createPortal(
    <div className="modal-backdrop glass-scrim fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={reduced ? false : { opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={settle}
        className={`card relative z-10 my-8 flex max-h-[calc(100vh-4rem)] w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} flex-col overflow-hidden p-0`}
      >
        {/* Champagne hairline along the top edge of the sheet. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-300/70 to-transparent"
        />
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <h3 id={titleId} className="font-display text-lg font-bold tracking-tight text-slate-900">
            {title}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </motion.div>
    </div>,
    document.body
  );
}

export function EmptyState({ icon: Icon, illo, title, hint, action }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-gradient-to-b from-white/70 to-transparent px-6 py-14 text-center dark:from-white/[0.03]"
    >
      {illo ? (
        <div className="mb-1"><Illo name={illo} /></div>
      ) : (
        Icon && (
          // The icon sits in its own small surface rather than floating loose —
          // it gives the composition a centre of gravity above the text.
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-[0_6px_18px_-10px_rgba(16,30,55,0.5)] ring-1 ring-gold-200">
            <Icon className="text-brand-500 dark:text-brand-300" size={24} strokeWidth={1.7} />
          </span>
        )
      )}
      <p className="font-display text-base font-bold tracking-tight text-slate-800">{title}</p>
      {hint && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-400">{hint}</p>}
      {action && (
        <>
          <div className="rule-fade mt-6 w-24" />
          {/* The empty state's action is the only thing to do on the screen, so
              it earns the magnetic pull — unless the call site already wrapped
              it, in which case wrapping again would double the offset. */}
          <div className="mt-5">
            {action.type === Magnetic ? action : <Magnetic>{action}</Magnetic>}
          </div>
        </>
      )}
    </motion.div>
  );
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{message}</span>
    </div>
  );
}
