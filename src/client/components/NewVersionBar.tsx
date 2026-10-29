import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

// "A new version is available": the page knows the build it was loaded from (__APP_BUILD__); every few minutes,
// and whenever the tab comes back into view, it reads the build id the server now serves in index.html. When they
// differ a yellow bar asks the person to save first and then refresh. Nothing reloads by itself, so unsaved
// typing is never lost. Local development ("dev") never shows it.

const CHECK_EVERY = 5 * 60_000;

async function servedBuild(): Promise<string | null> {
  try {
    const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.text()).match(/<meta name="app-build" content="([^"]+)"/)?.[1] ?? null;
  } catch {
    return null; // offline: try again later
  }
}

export function useNewVersion() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (__APP_BUILD__ === 'dev') return;
    let stop = false;
    const check = async () => {
      const b = await servedBuild();
      if (!stop && b && b !== 'dev' && b !== __APP_BUILD__) setReady(true);
    };
    const onShow = () => { if (document.visibilityState === 'visible') void check(); };
    const t = setInterval(check, CHECK_EVERY);
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('online', check);
    void check();
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', onShow); window.removeEventListener('online', check); };
  }, []);
  return ready;
}

/** Fetches a fresh copy of the page first, so the reload can't come back from the browser cache as the old version. */
async function refresh() {
  try { await fetch(window.location.href, { cache: 'reload', credentials: 'same-origin' }); } catch { /* reload anyway */ }
  window.location.reload();
}

export function NewVersionBar({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div role="status" aria-live="polite" className="bg-notice-bg px-4 py-2.5 text-sm text-notice-fg md:px-5 print:hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1">
          <span className="font-bold">A new version of SLK Operations Hub is available.</span>{' '}
          Finish what you are typing and save it, then click <span className="font-bold">Refresh now</span>.
        </p>
        <button type="button" onClick={refresh}
          className="inline-flex h-(--layout-control-md) shrink-0 items-center gap-2 rounded-md border-2 border-notice-fg bg-notice-fg px-4 font-bold text-notice-bg hover:opacity-90">
          <RefreshCw aria-hidden className="size-4" />Refresh now
        </button>
      </div>
      <p className="mt-1 flex items-start gap-2 text-xs">
        <span className="inline-flex shrink-0 items-center gap-1 rounded-xs border border-notice-fg px-1.5 font-mono font-bold tracking-wide">
          <AlertTriangle aria-hidden className="size-3.5" />CAUTION
        </span>
        <span>Save your entry before pressing <b>Refresh now</b>. Refreshing reloads the page, and anything not yet saved on the screen will be cleared.</span>
      </p>
    </div>
  );
}
