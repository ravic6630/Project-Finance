import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeftRight,
  Building2,
  LayoutDashboard,
  LineChart,
  Moon,
  Receipt,
  Search,
  Settings,
  Shield,
  Sun,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { getTheme, setTheme } from '../lib/theme.js';

const PAGES = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, keywords: 'home net worth' },
  { label: 'Investments', to: '/investments', icon: TrendingUp, keywords: 'stocks funds portfolio import broker' },
  { label: 'Goals', to: '/goals', icon: Target, keywords: 'projections calculator sip swp' },
  { label: 'Returns & tax', to: '/returns', icon: Receipt, keywords: 'xirr capital gains' },
  { label: 'Cash & Bank', to: '/cash', icon: Wallet, keywords: 'accounts fd deposit' },
  { label: 'Assets', to: '/assets', icon: Building2, keywords: 'property land gold vehicle business' },
  { label: 'Transactions', to: '/transactions', icon: ArrowLeftRight, keywords: 'income expense cashflow' },
  { label: 'Settings', to: '/settings', icon: Settings, keywords: 'profile email digest password' },
];

// Cmd/Ctrl-K palette: jump to any page or holding, or flip the theme.
export default function CommandPalette() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [holdings, setHoldings] = useState(null); // null = not fetched yet
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Global shortcut.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Reset + focus + lazily fetch holdings the first time it opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 30);
    if (holdings === null) {
      api('/holdings')
        .then((d) => setHoldings(d.holdings || []))
        .catch(() => setHoldings([]));
    }
  }, [open, holdings]);

  const close = useCallback(() => setOpen(false), []);

  const items = useMemo(() => {
    const pages = user?.role === 'admin'
      ? [...PAGES, { label: 'Admin', to: '/admin', icon: Shield, keywords: 'users support inbox' }]
      : PAGES;
    const dark = getTheme() === 'dark';
    const actions = [
      {
        label: dark ? 'Switch to light mode' : 'Switch to dark mode',
        icon: dark ? Sun : Moon,
        group: 'Actions',
        run: () => setTheme(dark ? 'light' : 'dark'),
      },
    ];
    const holdingItems = (holdings || []).map((h) => ({
      label: h.name,
      sub: h.symbol || (h.scheme_code ? `#${h.scheme_code}` : ''),
      icon: LineChart,
      group: 'Holdings',
      to: '/investments',
    }));
    const all = [
      ...pages.map((p) => ({ ...p, group: 'Pages' })),
      ...actions,
      ...holdingItems,
    ];
    const q = query.trim().toLowerCase();
    if (!q) return all.filter((i) => i.group !== 'Holdings').slice(0, 12);
    return all
      .filter((i) =>
        `${i.label} ${i.sub || ''} ${i.keywords || ''}`.toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [query, holdings, user?.role, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setActive(0), [query]);

  function runItem(item) {
    close();
    if (item.run) item.run();
    else if (item.to) navigate(item.to);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') return close();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && items[active]) {
      e.preventDefault();
      runItem(items[active]);
    }
  }

  // Keep the active row in view while arrowing.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  let lastGroup = null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={close}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#e8e2d4] bg-white shadow-2xl"
      >
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4">
          <Search size={17} className="shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages, holdings, actions…"
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-slate-400"
          />
          <kbd className="hidden shrink-0 rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 sm:block">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-slate-400">No matches — try a page or holding name.</p>
          )}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={`${item.group}-${item.label}-${i}`}>
                {header && (
                  <p className="px-3 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {header}
                  </p>
                )}
                <button
                  onClick={() => runItem(item)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                    i === active ? 'bg-brand-50 text-brand-800' : 'text-slate-700'
                  }`}
                >
                  <item.icon size={16} className={i === active ? 'text-brand-600' : 'text-slate-400'} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.sub && <span className="truncate text-xs text-slate-400">{item.sub}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
