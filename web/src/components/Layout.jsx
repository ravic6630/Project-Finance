import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { MotionConfig, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeftRight, Building2, LayoutDashboard, LogOut, Menu, Receipt, Settings, Shield, Sprout, Target, TrendingUp, Wallet, X, Search as SearchIcon } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import CurrencyMenu from './CurrencyMenu.jsx';
import SupportChat from './SupportChat.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import CommandPalette from './CommandPalette.jsx';
import ProfileSwitcher from './ProfileSwitcher.jsx';
import { ProfileProvider } from '../lib/ProfileContext.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/investments', label: 'Investments', icon: TrendingUp },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/returns', label: 'Returns & tax', icon: Receipt },
  { to: '/cash', label: 'Cash & Bank', icon: Wallet },
  { to: '/assets', label: 'Assets', icon: Building2 },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/investments': 'Investments',
  '/goals': 'Goals',
  '/returns': 'Returns & tax',
  '/cash': 'Cash & Bank',
  '/assets': 'Assets',
  '/transactions': 'Transactions',
  '/settings': 'Settings',
  '/admin': 'Admin',
};

function CurrencyToggle() {
  const { user, updateProfile } = useAuth();
  return (
    <CurrencyMenu
      value={user.base_currency}
      onChange={(code) => updateProfile({ base_currency: code })}
    />
  );
}

function SidebarContent({ onNavigate, pillId }) {
  const { user } = useAuth();
  const nav = user?.role === 'admin' ? [...NAV, { to: '/admin', label: 'Admin', icon: Shield }] : NAV;
  return (
    <>
      {/* Brand lockup. The mark is a small navy "coin" — a gradient plus a gold
          hairline ring and one inset highlight, so it reads as a pressed object
          rather than a flat swatch at 40px. */}
      <div className="flex items-center gap-3 px-2 pb-4 pt-1">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 text-gold-300 shadow-[0_8px_18px_-10px_rgba(16,30,55,0.75),inset_0_1px_0_rgba(255,255,255,0.16)] ring-1 ring-gold-400/30">
          <Sprout size={20} strokeWidth={1.9} />
        </div>
        <div className="min-w-0">
          <p className="font-display text-xl font-bold leading-none tracking-tight text-brand-800">Sampada</p>
          <p className="mt-1.5 text-[11px] font-medium leading-none tracking-wide text-slate-400">
            Wealth, all in one place
          </p>
        </div>
      </div>
      <div className="rule-fade mx-2" />
      <nav className="mt-5 space-y-0.5">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `group relative flex items-center rounded-xl px-3 py-2.5 text-sm font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:focus-visible:ring-gold-300 ${
                isActive
                  ? 'text-brand-800'
                  : 'text-slate-500 hover:translate-x-0.5 hover:bg-slate-100 hover:text-slate-800'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  // The active highlight is a shared element, so it glides
                  // between items when you change pages. The gradient falls off
                  // to the right and a champagne hairline marks the left edge —
                  // the same gesture as a ruled ledger line.
                  <motion.span
                    layoutId={pillId}
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-brand-50 via-brand-50/70 to-brand-50/20 ring-1 ring-gold-200 dark:from-brand-700/50 dark:via-brand-700/25 dark:to-transparent"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-gradient-to-b from-gold-300 via-gold-400 to-gold-500"
                    />
                  </motion.span>
                )}
                <span className="relative flex min-w-0 items-center gap-3">
                  <Icon
                    size={18}
                    strokeWidth={isActive ? 2.15 : 1.85}
                    className={`shrink-0 transition-colors ${
                      isActive ? 'text-gold-500 dark:text-gold-300' : 'text-slate-400 group-hover:text-slate-600'
                    }`}
                  />
                  <span className="truncate">{label}</span>
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const reduced = useReducedMotion();
  const firstRender = useRef(true);
  useEffect(() => {
    firstRender.current = false;
  }, []);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close the avatar menu on outside click / Escape. (A fixed inset-0 overlay
  // can't do this job here: the blurred header is a containing block for
  // position:fixed, so an overlay would only cover the header strip.)
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenuOpen(false);
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);
  const title = PAGE_TITLES[location.pathname] || 'Sampada';
  const initial = (user.name || user.email)[0].toUpperCase();

  return (
    // reducedMotion="user" applies the OS preference to every descendant —
    // including layoutId transitions, which a component can't gate itself.
    <MotionConfig reducedMotion="user">
    <ProfileProvider>
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar. Sticks for the height of the viewport so navigation
          stays put on long ledger pages instead of scrolling away. */}
      <aside className="hidden w-64 shrink-0 border-r border-[#e8e2d4] bg-white px-4 py-5 lg:block lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
        <SidebarContent pillId="nav-pill-desktop" />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <motion.div
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute inset-0 bg-brand-900/45 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <motion.aside
            initial={reduced ? false : { x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="absolute left-0 top-0 h-full w-64 border-r border-[#e8e2d4] bg-white px-4 py-5 shadow-2xl"
          >
            <SidebarContent pillId="nav-pill-mobile" onNavigate={() => setMobileOpen(false)} />
          </motion.aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Frosted bar: .glass gives blur + saturation in both themes, so
            content passing underneath tints the header instead of vanishing. */}
        <header className="glass sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[#e8e2d4] px-4 py-3 lg:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              className="-ml-1 rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-brand-700 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <span aria-hidden="true" className="h-5 w-px bg-slate-200 dark:bg-white/10 lg:hidden" />
            <motion.h1
              key={title}
              initial={reduced || firstRender.current ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="truncate font-display text-xl font-bold tracking-tight text-brand-900"
            >
              {title}
            </motion.h1>
          </div>
          <div className="flex items-center gap-2">
            <ProfileSwitcher />
            <button
              onClick={() =>
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
              }
              aria-label="Search (Cmd+K)"
              title="Search — ⌘K / Ctrl+K"
              className="hidden h-9 items-center gap-2 rounded-xl border border-[#e8e2d4] bg-white px-3 text-sm text-slate-500 transition hover:border-gold-300 hover:text-brand-700 sm:flex"
            >
              <SearchIcon size={15} />
              <kbd className="rounded-md border border-slate-200 px-1.5 text-[10px] font-semibold">⌘K</kbd>
            </button>
            <ThemeToggle />
            <CurrencyToggle />
            <span aria-hidden="true" className="mx-0.5 hidden h-6 w-px bg-slate-200 dark:bg-white/10 sm:block" />
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] ring-1 ring-gold-200 transition hover:ring-gold-300 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]"
              >
                {initial}
              </button>
              {menuOpen && (
                <div className="card modal-pop absolute right-0 top-12 z-40 w-56 p-2">
                    <p className="truncate px-3 py-1.5 text-sm font-semibold text-slate-700">
                      {user.name || 'Account'}
                    </p>
                    <p className="truncate px-3 pb-2 text-xs text-slate-400">{user.email}</p>
                    <div className="rule-fade mx-1 mb-1" />
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        logout();
                      }}
                     
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
                    >
                      <LogOut size={16} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8 lg:py-8">
          {/* Entrance-only page transition, keyed by path so each navigation
              fades/rises in. Skipped on the very first render (initial={false})
              so a load in a background tab is never left invisible. */}
          <motion.div
            key={location.pathname}
            initial={firstRender.current ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-24 text-sm text-slate-400">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500 dark:border-t-gold-400" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </motion.div>
        </main>
      </div>

      {/* Floating support chat, available on every signed-in page. */}
      <SupportChat />
      <CommandPalette />
    </div>
    </ProfileProvider>
    </MotionConfig>
  );
}
