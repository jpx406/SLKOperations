import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { Link, useParams } from 'react-router';
import type { Job } from '../../shared/types';
import { api } from '../api';
import { useMe } from '../auth';
import { JobLogEvents, type LogEvent } from '../components/JobLogEvents';
import { Banner, Card, Skeleton, cx } from '../components/ui';
import { lazyRetry } from '../staleBuild';
import { useJraLock } from './Jra';

// The Job Log and the Winch data on pages of their own (6z.49), opened from a card on Execution and Closure the way
// the JRA is: the stage stays short, and the work has the whole screen.

const WinchDataCard = lazy(lazyRetry(() => import('./WinchData')));
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const openBtn = 'inline-flex h-(--layout-control-sm) items-center rounded-md bg-accent px-3 text-sm font-semibold text-on-accent hover:bg-accent-hover';
const backBtn = 'inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-xs font-semibold hover:bg-surface-3';

function useJob(id: string) {
  return useQuery({ queryKey: ['job', id], queryFn: () => api<Job>(`/jobs/${id}`) });
}

function Header({ id, back, backLabel, title, job }: { id: string; back: string; backLabel: string; title: string; job?: Job }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Link to={`/operation/jobs/${id}/${back}`} className={backBtn}><ArrowLeft aria-hidden className="size-4" />{backLabel}</Link>
      <h1 className="font-display text-xl font-extrabold uppercase">{title}</h1>
      {job && <span className="text-sm text-text-muted">{[job.ticket_no, job.well, job.unit_number].filter(Boolean).join(' · ')}</span>}
    </div>
  );
}

/** /operation/jobs/:id/log — the sequence of events. */
export function JobLogPage() {
  const { id = '' } = useParams();
  const { data: me } = useMe();
  const job = useJob(id);
  const jraLocked = useJraLock(id);
  if (job.isPending) return <Skeleton className="h-96" />;
  if (job.isError) return <Banner tone="danger" action={<Link className="underline" to="/operation/jobs">Back to jobs</Link>}>{job.error.message}</Banner>;
  const canEdit = !!me?.menus.jobs?.edit && !jraLocked;
  return (
    <section aria-label="Job log">
      <Header id={id} back="execution" backLabel="Execution" title="Job log · sequence of events" job={job.data} />
      {jraLocked && <div className="mb-3"><Banner tone="warning">The JRA has to be approved before entries can be added.</Banner></div>}
      <p className="mb-3 text-sm text-text-muted">Each entry has its time, and the run and depth when they apply. Arrival, rig-up, rig-down, the runs, failed runs, the deepest point and the tag are read from here into Execution's times, runs and depths. Entries are kept on the device when there is no signal.</p>
      <Card><JobLogEvents jobId={id} canEdit={canEdit} /></Card>
    </section>
  );
}

/** /operation/jobs/:id/winch — the winch data and its report. */
export function JobWinchPage() {
  const { id = '' } = useParams();
  const job = useJob(id);
  if (job.isPending) return <Skeleton className="h-96" />;
  if (job.isError) return <Banner tone="danger" action={<Link className="underline" to="/operation/jobs">Back to jobs</Link>}>{job.error.message}</Banner>;
  return (
    <section aria-label="Winch data">
      <Header id={id} back="closure" backLabel="Closure" title="Winch data · plots and guidelines check" job={job.data} />
      <Card><Suspense fallback={<Skeleton className="h-40" />}><WinchDataCard job={job.data} /></Suspense></Card>
    </section>
  );
}

/** The card on Execution: how many entries, the last one, and the way into the Job log. */
export function JobLogBanner({ jobId }: { jobId: string }) {
  const q = useQuery({ queryKey: ['job-events', jobId], queryFn: () => api<LogEvent[]>(`/jobs/${jobId}/events`), retry: false });
  const ev = q.data ?? [];
  const last = [...ev].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
  return (
    <div className={cx('mb-4 rounded-md border p-3', ev.length ? 'border-border' : 'border-warning')}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-base font-bold uppercase">Job log · sequence of events</h2>
        <span className="text-sm text-text-muted">{q.isPending ? 'Reading…' : `${ev.length} entr${ev.length === 1 ? 'y' : 'ies'}`}</span>
        <span className="ml-auto"><Link className={openBtn} to={`/operation/jobs/${jobId}/log`}>{ev.length ? 'Open job log' : 'Start job log'}</Link></span>
      </div>
      <p className="mt-1 text-xs text-text-muted">{last ? `Last: ${when(last.occurred_at)}${last.run_no ? ` · run ${last.run_no}` : ''}${last.depth_ft != null ? ` · ${last.depth_ft.toLocaleString()} ft` : ''} · ${last.text}` : 'Log what happens as it happens: times, runs and depths are read from it.'}</p>
    </div>
  );
}

/** The card on Closure: what the winch check holds, and the way into it. */
export function WinchBanner({ jobId }: { jobId: string }) {
  const st = useQuery({ queryKey: ['winch-state-summary', jobId], queryFn: () => api<{ state: { files?: unknown[]; checked?: boolean } | null; updatedAt: string | null; updatedBy: string | null }>(`/winch/state/${jobId}`), retry: false });
  const atts = useQuery({ queryKey: ['attachments', 'job', jobId], queryFn: () => api<{ files: { note: string | null }[] }>(`/attachments/job/${jobId}`), retry: false });
  const files = st.data?.state?.files?.length ?? 0;
  const reports = (atts.data?.files ?? []).filter((a) => (a.note ?? '').startsWith('Winch data analysis')).length;
  return (
    <div className="mb-4 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-base font-bold uppercase">Winch data</h2>
        <span className="text-sm text-text-muted">{st.isPending ? 'Reading…' : files ? `${files} file${files > 1 ? 's' : ''}${st.data?.state?.checked ? ' · checked' : ''} · ${reports} report${reports === 1 ? '' : 's'} saved` : 'No winch files yet'}</span>
        <span className="ml-auto"><Link className={openBtn} to={`/operation/jobs/${jobId}/winch`}>{files ? 'Open winch data' : 'Add winch data'}</Link></span>
      </div>
      <p className="mt-1 text-xs text-text-muted">Lineminder recordings or winch exports against the Speed and Jarring Guidelines (slickline wire) or the seasoning rules (braided line), with the scorecard and the report.{st.data?.updatedAt ? ` Last kept ${when(st.data.updatedAt)}${st.data.updatedBy ? ` by ${st.data.updatedBy}` : ''}.` : ''}</p>
    </div>
  );
}
