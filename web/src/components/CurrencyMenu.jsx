import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { CURRENCIES } from '../lib/markets.js';

// Premium replacement for the native <select> base-currency picker:
// flag + symbol + code + full name, with the app's navy/gold styling.
export default function CurrencyMenu({ value, onChange, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const cur = CURRENCIES.find((c) => c.code === value) || CURRENCIES[0];

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(code) {
    setOpen(false);
    if (code !== value) onChange(code);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Base currency"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-xl border border-[#e8e2d4] bg-white px-3 py-2 text-sm font-semibold text-brand-700 transition hover:border-gold-300 hover:bg-[#faf8f1]"
      >
        <span className="text-base leading-none">{cur.flag}</span>
        <span>
          {cur.symbol} {cur.code}
        </span>
        <ChevronDown size={15} className={`text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-[#e8e2d4] bg-white p-1.5 shadow-xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {CURRENCIES.map((c) => {
            const active = c.code === value;
            return (
              <button
                key={c.code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(c.code)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
                  active ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="text-lg leading-none">{c.flag}</span>
                <span className="flex w-8 justify-center font-semibold text-slate-500">{c.symbol}</span>
                <span className="flex-1 truncate font-semibold">{c.name}</span>
                {active && <Check size={16} className="shrink-0 text-gold-500" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
