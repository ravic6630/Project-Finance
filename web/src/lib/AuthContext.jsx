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
      return undefined;
    }
    const slow = setTimeout(() => setWaking(true), 2500);
    let cancelled = false;

    // A transient failure (network blip, server restarting) must NOT log the
    // user out — that punishes exactly the phone-on-patchy-data case. Retry a
    // couple of times; only a definitive 401 (api() already cleared the token)
    // ends the session.
    const boot = async (attempt = 0) => {
      try {
        const d = await api('/auth/me');
        if (!cancelled) setUser(d.user);
      } catch (err) {
        if (cancelled) return;
        const authFailure = err.status === 401 || err.status === 403;
        if (!authFailure && attempt < 2) {
          setTimeout(() => boot(attempt + 1), 3000);
          return; // keep loading until the retry settles
        }
        // Auth failure: token already cleared by api(). Transient failure after
        // retries: keep the token so the next launch signs straight back in.
      }
      if (!cancelled) {
        clearTimeout(slow);
        setWaking(false);
        setLoading(false);
      }
    };
    boot();

    return () => {
      cancelled = true;
      clearTimeout(slow);
    };
  }, []);

  // Any 401 anywhere in the app drops us back to the sign-in screen.
  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('sampada:logout', onLogout);
    return () => window.removeEventListener('sampada:logout', onLogout);
  }, []);

  // Two ways this stops short of a session, both handled by the caller:
  //   { requires_2fa }          — the account has an authenticator (complete2fa)
  //   { requires_verification } — a run of wrong passwords earned an emailed
  //                               code (completeLoginVerification)
  async function login(email, password) {
    const d = await api('/auth/login', { method: 'POST', body: { email, password } });
    if (d.requires_2fa || d.requires_verification) return d;
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

  async function completeLoginVerification(ticket, code) {
    const d = await api('/auth/login/verify', { method: 'POST', body: { ticket, code } });
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
      value={{ user, loading, waking, login, complete2fa, completeLoginVerification, startSignup, verifySignup, resendSignup, logout, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
