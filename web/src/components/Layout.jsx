import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowLeftRight,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Sprout,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/investments', label: 'Investments', icon: TrendingUp },
  { to: '/cash', label: 'Cash & Bank', icon: Wallet },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/investments': 'Investments',
  '/cash': 'Cash & Bank',
  '/transactions': 'Transactions',
  '/settings': 'Settings',
};

function CurrencyToggle() {
  const { user, updateProfile } = useAuth();
  const set = (c) => c !== user.base_currency && updateProfile({ base_currency: c });
  return (
    <div className="flex items-center rounded-xl bg-slate-100 p-1 text-sm font-semibold">
      {['INR', 'USD'].map((c) => (
        <button
          key={c}
          onClick={() => set(c)}
          className={`rounded-lg px-3 py-1.5 transition ${
            user.base_currency === c ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'
          }`}
        >
          {c === 'INR' ? '₹ INR' : '$ USD'}
        </button>
      ))}
    </div>
  );
}

function SidebarContent({ onNavigate }) {
  return (
    <>
      <div className="flex items-center gap-2.5 px-2 py-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
          <Sprout size={20} />
        </div>
        <div>
          <p className="text-lg font-extrabold leading-none text-slate-900">Sampada</p>
          <p className="text-[11px] font-medium text-slate-400">Wealth, all in one place</p>
        </div>
      </div>
      <nav className="mt-8 space-y-1">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const title = PAGE_TITLES[location.pathname] || 'Sampada';
  const initial = (user.name || user.email)[0].toUpperCase();

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white p-4 lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-white p-4 shadow-xl">
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={20} />
            </button>
            <h1 className="text-xl font-bold text-slate-900">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <CurrencyToggle />
            <div className="group relative">
              <button className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700">
                {initial}
              </button>
              <div className="invisible absolute right-0 top-11 z-40 w-52 rounded-xl border border-slate-200 bg-white p-2 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100">
                <p className="truncate px-3 py-1.5 text-sm font-semibold text-slate-700">
                  {user.name || 'Account'}
                </p>
                <p className="truncate px-3 pb-2 text-xs text-slate-400">{user.email}</p>
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
                >
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
