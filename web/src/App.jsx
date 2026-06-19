import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Investments from './pages/Investments.jsx';
import Goals from './pages/Goals.jsx';
import Cash from './pages/Cash.jsx';
import Transactions from './pages/Transactions.jsx';
import Settings from './pages/Settings.jsx';
import BrokerCallback from './pages/BrokerCallback.jsx';
import Admin from './pages/Admin.jsx';

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
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot" element={<ForgotPassword />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/investments" element={<Investments />} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/cash" element={<Cash />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/broker/:broker/callback" element={<BrokerCallback />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
