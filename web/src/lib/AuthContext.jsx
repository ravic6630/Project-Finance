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

  async function signup(name, email, password) {
    const d = await api('/auth/signup', { method: 'POST', body: { name, email, password } });
    setToken(d.token);
    setUser(d.user);
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
    <AuthContext.Provider value={{ user, loading, login, signup, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
