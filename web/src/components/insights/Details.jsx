import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

/* ============================================================================
   The place where the working goes.

   Every insight on this page rests on a method, and the method matters — but it
   is not the answer, and printing it beside the answer buries the answer. So
   each panel says its one plain thing, and everything that justifies it lives
   in here: the scores, the ratios, the caveats, the splits.

   One component for all four panels, so the gesture is identical everywhere:
   the reader learns it once.
   ========================================================================== */

export default function Details({ label = 'How this is worked out', children }) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();

  return (
    <div className="mt-5 border-t border-slate-100 pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-lg py-1.5 text-left text-xs font-semibold text-slate-500 transition hover:text-slate-700"
      >
        {label}
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-4 pb-1 pt-2 text-xs leading-relaxed text-slate-500">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
