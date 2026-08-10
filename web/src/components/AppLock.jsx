import { useCallback, useEffect, useState } from 'react';
import { Fingerprint, Lock } from 'lucide-react';
import { biometricAvailable, biometricUnlock, haptic, isNative } from '../lib/native.js';

// Biometric app lock for the native builds. Net worth is exactly the kind of
// thing you don't want visible to whoever picks up an unlocked phone, so the
// app can require Face ID / fingerprint on launch and when it returns from the
// background. Purely local — no server state, nothing to leak.
const KEY = 'sampada_applock';
// Coming back within this window (paying, answering a message) shouldn't
// demand a re-scan; anything longer re-locks.
const GRACE_MS = 60_000;

export const lockEnabled = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
const setLockEnabled = (on) => {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode */
  }
};

export function AppLockGate({ children }) {
  const [locked, setLocked] = useState(() => isNative && lockEnabled());
  const [failed, setFailed] = useState(false);

  const unlock = useCallback(async () => {
    setFailed(false);
    const ok = await biometricUnlock('Unlock Sampada');
    if (ok) {
      haptic('success');
      setLocked(false);
    } else {
      setFailed(true);
    }
  }, []);

  // Prompt as soon as we mount locked.
  useEffect(() => {
    if (locked) unlock();
  }, [locked, unlock]);

  // Re-lock when the app comes back from the background after the grace window.
  useEffect(() => {
    if (!isNative) return undefined;
    let remove;
    let leftAt = 0;
    import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('appStateChange', ({ isActive }) => {
          if (!isActive) {
            leftAt = Date.now();
          } else if (lockEnabled() && leftAt && Date.now() - leftAt > GRACE_MS) {
            setLocked(true);
          }
        })
      )
      .then((h) => {
        remove = () => h.remove();
      })
      .catch(() => {});
    return () => remove?.();
  }, []);

  if (!locked) return children;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#faf9f5] px-8 text-center dark:bg-[#0d1626]">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
        <Lock size={30} />
      </div>
      <div>
        <h1 className="text-xl font-bold text-slate-900">Sampada is locked</h1>
        <p className="mt-1 text-sm text-slate-500">
          {failed ? 'Unlock failed — try again.' : 'Unlock to see your wealth.'}
        </p>
      </div>
      <button className="btn-primary" onClick={unlock}>
        <Fingerprint size={16} /> Unlock
      </button>
    </div>
  );
}

// Settings card — only rendered on a device that actually has biometrics.
export function AppLockCard() {
  const [info, setInfo] = useState(null);
  const [on, setOn] = useState(lockEnabled);

  useEffect(() => {
    if (isNative) biometricAvailable().then(setInfo);
  }, []);

  if (!isNative || !info?.available) return null;

  async function toggle() {
    if (!on) {
      // Prove the biometric works before trusting it to guard the app.
      const ok = await biometricUnlock('Turn on the Sampada app lock');
      if (!ok) return;
    }
    const next = !on;
    setLockEnabled(next);
    setOn(next);
    haptic('success');
  }

  return (
    <div className="card flex flex-wrap items-center justify-between gap-4 p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Fingerprint size={20} />
        </div>
        <div>
          <h3 className="font-bold text-slate-900">App lock</h3>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Require {info.name || 'biometrics'} to open Sampada, and again after it&apos;s been in the
            background for a minute.
          </p>
        </div>
      </div>
      <button
        onClick={toggle}
        aria-pressed={on}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-brand-600' : 'bg-slate-300'}`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`}
        />
      </button>
    </div>
  );
}
