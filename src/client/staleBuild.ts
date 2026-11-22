// A page opened before a deploy still runs the old version, whose code files the new deploy replaced: the next
// on-demand load fails with "Failed to fetch dynamically imported module" (6z.48). The fix is the newest version,
// so the page reloads itself once; a second failure within 30 s shows the error instead of looping.

const KEY = 'slk-stale-reload';

/** Whether an error is a code file that could not be loaded (the browsers word it differently). */
export const isStaleChunk = (e: unknown) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed|Unable to preload CSS|Failed to load module script/i
    .test(String((e as { message?: unknown } | null)?.message ?? e));

/** Reloads the page unless it already did in the last 30 s; true when it reloads. */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* private mode: reload anyway, the browser keeps nothing to loop on */ }
  window.location.reload();
  return true;
}

/** An import that reloads the page into the new version when its file is gone. */
export function lazyRetry<T>(load: () => Promise<T>): () => Promise<T> {
  return () => load().catch((e) => {
    if (isStaleChunk(e) && reloadOnce()) return new Promise<T>(() => { /* the page is reloading */ });
    throw e;
  });
}

/** Vite's own preloading reports a missing file this way: reload instead of failing. */
export function watchPreloadErrors() {
  window.addEventListener('vite:preloadError', (ev) => { if (reloadOnce()) ev.preventDefault(); });
}
