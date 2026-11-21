import { useEffect, useState } from 'react';
import { NesrLogo } from '../../components/Brand';
import { Banner, Skeleton } from '../../components/ui';
import { RunsView, type WinchPayload } from './Report';

// The winch analysis window (6z.41): the same report, full width and taller, in a window of its own beside the job.
// It asks the job page that opened it for the report and draws it; nothing is saved or fetched.

export default function WinchWindow() {
  const [p, setP] = useState<WinchPayload | null>(null);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    document.title = 'Winch data analysis · SLK Operations Hub';
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'slk-winch' || !e.data.payload) return;
      setP(e.data.payload as WinchPayload);
    };
    window.addEventListener('message', onMsg);
    const ask = () => window.opener?.postMessage({ type: 'slk-winch-ready' }, window.location.origin);
    ask();
    const again = setTimeout(ask, 800);
    const give = setTimeout(() => setLost(true), 4000);
    return () => { window.removeEventListener('message', onMsg); clearTimeout(again); clearTimeout(give); };
  }, []);
  return (
    <main id="main" className="min-h-full bg-bg px-4 py-4 md:px-6">
      <div className="mb-3 flex items-center gap-2">
        <NesrLogo className="h-7" />
        <h1 className="font-display text-base font-bold">Winch data analysis</h1>
      </div>
      {p ? <RunsView p={p} wide />
        : lost ? <Banner tone="warning">Open this window from a job: Closure, Winch data, then Open in a new window once the runs are checked. If the job page was closed or reloaded, open it again from there.</Banner>
        : <Skeleton className="h-96" />}
    </main>
  );
}
