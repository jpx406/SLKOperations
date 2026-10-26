import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudOff, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, isoToLocalInput, localInputToIso } from '../api';
import { Banner, Button, cx, inputClass } from './ui';

// Job Log · Sequence of Events (S42) on the Execution stage. Works at a wellsite without signal: an entry is kept
// on the device and uploaded when the connection is back. Each entry has its own id, so a retry never doubles it.

export interface LogEvent { id: string; client_id: string; occurred_at: string; run_no: number | null; depth_ft: number | null; text: string; created_by: string | null }
interface Pending { jobId: string; client_id: string; occurred_at: string; run_no: string; depth_ft: string; text: string }

const KEY = 'slk-joblog-queue';
const readQueue = (): Pending[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Pending[]; } catch { return []; } };
const writeQueue = (q: Pending[]) => { try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* storage blocked: the entry stays on screen until it uploads */ } };
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Uploads what is waiting for this job; a server refusal is dropped with its message, a network failure keeps it. */
async function flushQueue(jobId: string): Promise<{ sent: number; refused: string[] }> {
  let sent = 0;
  const refused: string[] = [];
  for (const p of readQueue().filter((x) => x.jobId === jobId)) {
    try {
      await api(`/jobs/${jobId}/events`, { method: 'POST', json: { client_id: p.client_id, occurred_at: p.occurred_at, run_no: p.run_no, depth_ft: p.depth_ft, text: p.text } });
      sent++;
      writeQueue(readQueue().filter((x) => x.client_id !== p.client_id));
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) { refused.push(`${p.text.slice(0, 40)}: ${e.message}`); writeQueue(readQueue().filter((x) => x.client_id !== p.client_id)); }
      else break;
    }
  }
  return { sent, refused };
}

export function JobLogEvents({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const events = useQuery({ queryKey: ['job-events', jobId], queryFn: () => api<LogEvent[]>(`/jobs/${jobId}/events`), retry: false });
  const [queue, setQueue] = useState<Pending[]>(() => readQueue().filter((x) => x.jobId === jobId));
  const [f, setF] = useState({ at: isoToLocalInput(new Date().toISOString()), run: '', depth: '', text: '' });
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  const sync = useCallback(async () => {
    const r = await flushQueue(jobId);
    setQueue(readQueue().filter((x) => x.jobId === jobId));
    if (r.refused.length) setError(`Not saved: ${r.refused.join(' · ')}`);
    if (r.sent) qc.invalidateQueries({ queryKey: ['job-events', jobId] });
  }, [jobId, qc]);
  useEffect(() => {
    const up = () => { setOnline(true); void sync(); };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    void sync();
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, [sync]);

  const add = async () => {
    const iso = localInputToIso(f.at);
    if (!iso) { setError('Give the time of the entry'); return; }
    if (!f.text.trim()) { setError('Write what happened'); return; }
    setError(null);
    writeQueue([...readQueue(), { jobId, client_id: crypto.randomUUID(), occurred_at: iso, run_no: f.run, depth_ft: f.depth, text: f.text.trim() }]);
    setQueue(readQueue().filter((x) => x.jobId === jobId));
    setF({ ...f, text: '', depth: '', at: isoToLocalInput(new Date().toISOString()) });
    await sync();
  };
  const remove = async (e: LogEvent) => {
    try { await api(`/jobs/${jobId}/events/${e.id}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['job-events', jobId] }); } catch (x) { setError((x as Error).message); }
  };
  const list = [...(events.data ?? []), ...queue.map((p) => ({ id: p.client_id, client_id: p.client_id, occurred_at: p.occurred_at, run_no: p.run_no ? Number(p.run_no) : null, depth_ft: p.depth_ft ? Number(p.depth_ft) : null, text: p.text, created_by: null, pending: true }))]
    .filter((e, i, a) => a.findIndex((x) => x.client_id === e.client_id) === i).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  return (
    <div>
      {(!online || queue.length > 0) && (
        <div className="mb-3"><Banner tone="warning" action={online && queue.length ? <Button size="sm" onClick={sync}>Upload now</Button> : undefined}>
          <span className="inline-flex items-center gap-1.5"><CloudOff aria-hidden className="size-4" />{online ? '' : 'No connection. '}{queue.length} entr{queue.length === 1 ? 'y is' : 'ies are'} kept on this device and will upload when the connection is back.</span>
        </Banner></div>
      )}
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      {list.length === 0 ? <p className="mb-3 text-sm text-text-subtle">No entries yet. Log arrival, rig-up, each run and anything unusual as it happens.</p> : (
        <ol className="mb-3 divide-y divide-border rounded-md border border-border">
          {list.map((e) => (
            <li key={e.client_id} className={cx('flex flex-wrap items-baseline gap-x-3 px-3 py-1.5 text-sm', 'pending' in e && 'text-text-muted')}>
              <span className="font-mono text-xs whitespace-nowrap">{when(e.occurred_at)}</span>
              {e.run_no != null && <span className="font-mono text-xs">run {e.run_no}</span>}
              {e.depth_ft != null && <span className="font-mono text-xs">{e.depth_ft.toLocaleString()} ft</span>}
              <span className="min-w-0 flex-1">{e.text}</span>
              {'pending' in e ? <span className="text-xs text-warning">waiting to upload</span> : <span className="text-xs text-text-subtle">{e.created_by}</span>}
              {canEdit && !('pending' in e) && <Button size="sm" variant="ghost" aria-label={`Remove entry ${e.text.slice(0, 30)}`} onClick={() => remove(e as LogEvent)}><Trash2 aria-hidden className="size-3.5" /></Button>}
            </li>
          ))}
        </ol>
      )}
      {canEdit && (
        <form className="grid grid-cols-1 items-end gap-2 md:grid-cols-[12rem_6rem_8rem_1fr_auto]" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <label className="block"><span className="label-caps mb-1 block text-text-muted">Time</span>
            <input type="datetime-local" className={inputClass} value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></label>
          <label className="block"><span className="label-caps mb-1 block text-text-muted">Run</span>
            <input type="number" min={0} className={inputClass} value={f.run} onChange={(e) => setF({ ...f, run: e.target.value })} /></label>
          <label className="block"><span className="label-caps mb-1 block text-text-muted">Depth (ft)</span>
            <input type="number" min={0} className={inputClass} value={f.depth} onChange={(e) => setF({ ...f, depth: e.target.value })} /></label>
          <label className="block"><span className="label-caps mb-1 block text-text-muted">What happened</span>
            <input className={inputClass} aria-describedby="log-hint" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
          <Button type="submit" disabled={!f.text.trim()} aria-describedby="log-hint"><Plus aria-hidden className="size-4" />Log</Button>
          {!f.text.trim() && <p id="log-hint" className="text-xs text-text-subtle md:col-span-5">Write what happened to log the entry. Run and depth are optional.</p>}
        </form>
      )}
    </div>
  );
}
