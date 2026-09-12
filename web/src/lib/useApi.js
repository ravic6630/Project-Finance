import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/* Stale-while-revalidate for GET requests.

   Every page used to fetch from scratch on mount and show a spinner until the
   server answered — so going Dashboard → Investments → Dashboard meant three
   round trips and three spinners for data the browser had held seconds ago.
   Now the last good response for a request is kept in memory: a page that has
   it paints instantly, and the real request runs behind it and replaces the
   numbers in place. The first visit still waits; every visit after is instant.

   Rules, because this is money on screen:
   - Memory only. Nothing here survives a reload, and it is cleared on sign-out
     so a second person signing in on the same tab never sees the first's data.
   - Any write (POST/PATCH/DELETE) empties the whole cache. Coarse, but always
     correct: a stale list after an edit is a bug, a re-fetch after one is free.
   - The key carries whatever the caller says the response varies by (base
     currency, profile scope), so a currency switch can't serve rupee figures
     under a dollar sign for even one frame. */

const cache = new Map(); // key -> { data, at }

// Requests that vary by more than their path (base currency, profile scope)
// fold that into the key, so those variants never collide.
const keyFor = (path, vary) => (vary && vary.length ? `${path}|${JSON.stringify(vary)}` : path);

export const peekApi = (path, vary) => cache.get(keyFor(path, vary))?.data ?? null;
export const primeApi = (path, data, vary) => cache.set(keyFor(path, vary), { data, at: Date.now() });

export function invalidateApi(prefix) {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}

export const clearApiCache = () => cache.clear();

// api() announces every successful write; anything cached before it may now
// be wrong, so all of it goes. (An event rather than an import, so api.js —
// which this module depends on — never has to depend back on this one.)
if (typeof window !== 'undefined') window.addEventListener('sampada:mutated', clearApiCache);

// useApi(path, { vary, enabled })
//   data     — the cached response immediately if there is one, else null
//   loading  — true only while there is nothing at all to show
//   stale    — true while `data` is the cached copy and a refresh is in flight
//   error    — message from the latest failed request ('' otherwise)
//   status   — HTTP status of that failure (402 is the premium wall)
//   reload() — refetch now; keeps whatever is on screen until the answer lands
export function useApi(path, { vary = [], enabled = true } = {}) {
  const key = keyFor(path, vary);
  const initial = cache.get(key);
  const [state, setState] = useState({
    data: initial?.data ?? null,
    loading: enabled && !initial,
    stale: !!initial,
    error: '',
    status: null,
  });
  // Only the newest request may paint. Switching profile or currency mid-fetch
  // would otherwise let a slow, older response overwrite fresher numbers.
  const reqRef = useRef(0);
  const keyRef = useRef(key);

  const reload = useCallback(async () => {
    if (!enabled) return null;
    const ticket = ++reqRef.current;
    const have = cache.get(key);
    setState((s) => ({ ...s, loading: !have && !s.data, stale: !!have, error: '' }));
    try {
      const d = await api(path);
      if (reqRef.current !== ticket) return d;
      cache.set(key, { data: d, at: Date.now() });
      setState({ data: d, loading: false, stale: false, error: '', status: null });
      return d;
    } catch (err) {
      if (reqRef.current !== ticket) return null;
      // Keep whatever was on screen: an error banner over yesterday's list is
      // more useful than an error page instead of it.
      setState((s) => ({ ...s, loading: false, stale: false, error: err.message, status: err.status ?? null }));
      return null;
    }
  }, [path, key, enabled]);

  useEffect(() => {
    // The key changed under us (new profile, new currency): swap to that key's
    // cached copy at once if there is one, rather than showing the old scope's
    // numbers while the new ones load.
    if (keyRef.current !== key) {
      keyRef.current = key;
      const next = cache.get(key);
      setState({ data: next?.data ?? null, loading: enabled && !next, stale: !!next, error: '', status: null });
    }
    reload();
  }, [key, reload, enabled]);

  return { ...state, reload };
}
