import { useEffect } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { isStaleChunk, reloadOnce } from '../staleBuild';

/**
 * Shown when a page fails to open (6z.48). A page left open across a deploy asks for code the new version replaced:
 * then it reloads into the new version by itself. Anything else says so plainly, with a way to try again.
 */
export function RouteError() {
  const error = useRouteError();
  const stale = isStaleChunk(error);
  useEffect(() => { if (stale) reloadOnce(); }, [stale]);
  const text = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : String(error ?? '');
  return (
    <main id="main" className="grid min-h-full place-items-center bg-bg p-6">
      <div role="alert" className="max-w-md rounded-lg border border-border bg-surface p-5 text-sm shadow-card">
        {stale ? (
          <>
            <h1 className="mb-1 font-display text-lg font-bold">A new version is ready</h1>
            <p className="text-text-muted">SLK Operations Hub was updated while this page was open. Loading the new version…</p>
          </>
        ) : (
          <>
            <h1 className="mb-1 font-display text-lg font-bold">This page could not open</h1>
            <p className="mb-2 text-text-muted">Try again. If it keeps happening, send this to the admin:</p>
            <pre className="mb-3 overflow-x-auto rounded-sm bg-surface-2 p-2 font-mono text-xs whitespace-pre-wrap">{text}</pre>
          </>
        )}
        <button type="button" className="inline-flex h-(--layout-control-sm) items-center rounded-md bg-accent px-3 text-sm font-semibold text-on-accent hover:bg-accent-hover" onClick={() => window.location.reload()}>Reload the page</button>
      </div>
    </main>
  );
}
