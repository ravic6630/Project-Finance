import { lazy } from 'react';

/* One place that knows which chunk each page lives in.

   Pages are code-split, which keeps the first load small — but it also means
   the first click on any page waits for its chunk to download before anything
   renders. That wait is the "why is it thinking?" pause between pages.

   The loaders live here rather than inline in App.jsx so the sidebar can start
   a download the moment a link is hovered or focused, and so the rest can be
   pulled in during idle time once the first page is up. Vite dedupes the
   import, so React.lazy finds the module already in the module cache and
   renders on the same frame as the click. */

const loaders = {
  '/': () => import('../pages/Dashboard.jsx'),
  '/investments': () => import('../pages/Investments.jsx'),
  '/goals': () => import('../pages/Goals.jsx'),
  '/returns': () => import('../pages/Returns.jsx'),
  '/cash': () => import('../pages/Cash.jsx'),
  '/assets': () => import('../pages/Assets.jsx'),
  '/transactions': () => import('../pages/Transactions.jsx'),
  '/settings': () => import('../pages/Settings.jsx'),
  '/legacy': () => import('../pages/Legacy.jsx'),
  '/admin': () => import('../pages/Admin.jsx'),
};

// React.lazy components, one per page, sharing the loader above so a prefetch
// and the real render resolve to the same in-flight import.
export const pages = Object.fromEntries(Object.entries(loaders).map(([path, load]) => [path, lazy(load)]));

const started = new Set();

// Kick off the chunk download for a path. Idempotent; a failure (offline) is
// swallowed because React.lazy will simply try again on the real navigation.
export function prefetchRoute(path) {
  const load = loaders[path];
  if (!load || started.has(path)) return;
  started.add(path);
  load().catch(() => started.delete(path));
}

// After the first page is interactive, warm the rest one at a time in idle
// slices. The whole set is a few hundred KB gzipped and cached forever, so this
// is a one-time cost per deploy — and it is what makes every later click land
// on the same frame.
export function prefetchAllRoutes() {
  const queue = Object.keys(loaders);
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  const step = () => {
    const next = queue.shift();
    if (!next) return;
    prefetchRoute(next);
    idle(step, { timeout: 2000 });
  };
  idle(step, { timeout: 2000 });
}
