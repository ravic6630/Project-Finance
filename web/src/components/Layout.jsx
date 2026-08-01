import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
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
      <div className="flex items-center gap-2.5 px-2 py-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-700 text-gold-300 ring-1 ring-gold-400/30">
          <Sprout size={20} />
        </div>
        <div>
          <p className="font-display text-xl font-bold leading-none text-brand-800">Sampada</p>
          <p className="text-[11px] font-medium text-slate-400">Wealth, all in one place</p>
        </div>
      </div>
      <nav className="mt-8 space-y-1">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${
                isActive ? 'text-brand-800' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  // The active highlight is a shared element, so it glides
                  // between items when you change pages.
                  <motion.span
                    layoutId={pillId}
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    className="absolute inset-0 rounded-xl bg-brand-50 ring-1 ring-gold-200"
                  />
                )}
                <span className="relative flex items-center gap-3">
                  <Icon size={18} />
                  {label}
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
  const firstRender = useRef(true);
  useEffect(() => {
    firstRender.current = false;
  }, []);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const title = PAGE_TITLES[location.pathname] || 'Sampada';
  const initial = (user.name || user.email)[0].toUpperCase();

  return (
    <ProfileProvider>
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-[#e8e2d4] bg-white p-4 lg:block">
        <SidebarContent pillId="nav-pill-desktop" />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-white p-4 shadow-xl">
            <SidebarContent pillId="nav-pill-mobile" onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[#e8e2d4] bg-[#faf9f5]/80 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={20} />
            </button>
            <h1 className="font-display text-xl font-bold text-brand-900">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <ProfileSwitcher />
            <button
              onClick={() =>
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
              }
              aria-label="Search (Cmd+K)"
              title="Search — ⌘K / Ctrl+K"
              className="hidden h-9 items-center gap-2 rounded-xl border border-[#e8e2d4] bg-white px-3 text-sm text-slate-400 transition hover:border-gold-300 hover:text-brand-700 sm:flex"
            >
              <SearchIcon size={15} />
              <kbd className="rounded-md border border-slate-200 px-1.5 text-[10px] font-semibold">⌘K</kbd>
            </button>
            <ThemeToggle />
            <CurrencyToggle />
            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700 ring-1 ring-gold-200 transition hover:ring-gold-300"
              >
                {initial}
              </button>
              {menuOpen && (
                <>
                  {/* Click-away backdrop — keeps the menu open until you act or click out. */}
                  <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-12 z-40 w-56 rounded-xl border border-[#e8e2d4] bg-white p-2 shadow-lg">
                    <p className="truncate px-3 py-1.5 text-sm font-semibold text-slate-700">
                      {user.name || 'Account'}
                    </p>
                    <p className="truncate px-3 pb-2 text-xs text-slate-400">{user.email}</p>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        logout();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
                    >
                      <LogOut size={16} /> Sign out
                    </button>
                  </div>
                </>
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
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500" />
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
  );
}
