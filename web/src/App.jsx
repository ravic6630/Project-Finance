import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx'; // eager: first paint for logged-out visitors
import Landing from './pages/Landing.jsx'; // eager: the public front door (motion lib is already in the entry chunk)

// Everything else is code-split, so the initial bundle stays small and heavy
// pages (charts, etc.) only download when they're actually opened.
const Signup = lazy(() => import('./pages/Signup.jsx'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'));
const Privacy = lazy(() => import('./pages/Privacy.jsx'));
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

function Splash({ waking = false }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center text-slate-400">
      <div className="animate-pulse text-sm font-medium">Loading Sampada…</div>
      {waking && (
        <p className="max-w-xs text-xs text-slate-400">
          Waking the server 🌱 — free hosting naps when idle, so the first visit
          can take up to a minute. Hang tight!
        </p>
      )}
    </div>
  );
}

export default function App() {
  const { user, loading, waking } = useAuth();
  if (loading) return <Splash waking={waking} />;

  if (!user) {
    return (
      <Suspense fallback={<Splash />}>
        <Routes>
          {/* The public marketing page is the logged-out front door. */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot" element={<ForgotPassword />} />
          {/* Reset is now code-based and lives on /forgot; redirect old links. */}
          <Route path="/reset" element={<Navigate to="/forgot" replace />} />
          <Route path="/calculators" element={<Calculators />} />
          {/* Public: app stores require a policy URL reachable without signing in. */}
          <Route path="/privacy" element={<Privacy />} />
          {/* Deep links from a signed-out session (e.g. /investments) land on
              the landing page; after sign-in they go where they wanted. */}
          <Route path="*" element={<Navigate to="/" replace />} />
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
      <Route
        path="/privacy"
        element={
          <Suspense fallback={<Splash />}>
            <Privacy />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
