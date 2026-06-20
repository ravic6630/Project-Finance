import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, clearToken, getToken, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const d = await api('/auth/login', { method: 'POST', body: { email, password } });
    setToken(d.token);
    setUser(d.user);
  }

  // Step 1 — email a verification code (no account yet). Returns { email_sent }.
  async function startSignup({ name, email, password, base_currency }) {
    return api('/auth/signup', { method: 'POST', body: { name, email, password, base_currency } });
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
      value={{ user, loading, login, startSignup, verifySignup, resendSignup, logout, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
