import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx'; // eager: first paint for logged-out visitors

// Everything else is code-split, so the initial bundle stays small and heavy
// pages (charts, etc.) only download when they're actually opened.
const Signup = lazy(() => import('./pages/Signup.jsx'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Calculators = lazy(() => import('./pages/Calculators.jsx'));
const Investments = lazy(() => import('./pages/Investments.jsx'));
const Goals = lazy(() => import('./pages/Goals.jsx'));
const Returns = lazy(() => import('./pages/Returns.jsx'));
const Cash = lazy(() => import('./pages/Cash.jsx'));
const Assets = lazy(() => import('./pages/Assets.jsx'));
const Transactions = lazy(() => import('./pages/Transactions.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const BrokerCallback = lazy(() => import('./pages/BrokerCallback.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));

function Splash() {
  return (
    <div className="flex h-screen items-center justify-center text-slate-400">
      <div className="animate-pulse text-sm font-medium">Loading Sampada…</div>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;

  if (!user) {
    return (
      <Suspense fallback={<Splash />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot" element={<ForgotPassword />} />
          {/* Reset is now code-based and lives on /forgot; redirect old links. */}
          <Route path="/reset" element={<Navigate to="/forgot" replace />} />
          <Route path="/calculators" element={<Calculators />} />
          {/* Logged-out visitors land on the login page; the public calculators
              stay reachable via the "Try our free calculators" link there. */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  // Layout renders the shell + a Suspense boundary around the page, so switching
  // pages only swaps the content area — the sidebar/header never flash.
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/investments" element={<Investments />} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/returns" element={<Returns />} />
        <Route path="/cash" element={<Cash />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/broker/:broker/callback" element={<BrokerCallback />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
