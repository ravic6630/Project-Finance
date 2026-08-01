import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, clearToken, getToken, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // True when the first request is taking suspiciously long — almost always
  // Render's free tier waking the server from sleep (~30-60s cold start).
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    const slow = setTimeout(() => setWaking(true), 2500);
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => clearToken())
      .finally(() => {
        clearTimeout(slow);
        setWaking(false);
        setLoading(false);
      });
    return () => clearTimeout(slow);
  }, []);

  // Resolves to { requires_2fa, ticket } when the account has 2FA — the caller
  // then collects the 6-digit code and finishes with complete2fa().
  async function login(email, password) {
    const d = await api('/auth/login', { method: 'POST', body: { email, password } });
    if (d.requires_2fa) return d;
    setToken(d.token);
    setUser(d.user);
    return d;
  }

  async function complete2fa(ticket, code) {
    const d = await api('/auth/login/2fa', { method: 'POST', body: { ticket, code } });
    setToken(d.token);
    setUser(d.user);
    return d;
  }

  // Step 1 — email a verification code (no account yet). Returns { email_sent }.
  async function startSignup({ name, email, password, base_currency, ref }) {
    return api('/auth/signup', { method: 'POST', body: { name, email, password, base_currency, ref } });
  }

  // Step 2 — confirm the code, which creates the account and logs them in.
  async function verifySignup(email, code) {
    const d = await api('/auth/signup/verify', { method: 'POST', body: { email, code } });
    setToken(d.token);
    setUser(d.user);
  }

  function resendSignup(email) {
    return api('/auth/signup/resend', { method: 'POST', body: { email } });
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  async function updateProfile(patch) {
    const d = await api('/auth/me', { method: 'PATCH', body: patch });
    setUser(d.user);
    return d.user;
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, waking, login, complete2fa, startSignup, verifySignup, resendSignup, logout, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
