import { useQuery } from '@tanstack/react-query';
import { riyadhShort } from '../../shared/dates';
import { ArrowLeft } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { Link, useParams } from 'react-router';
import type { Job } from '../../shared/types';
import { api } from '../api';
import { JobLogEditor } from '../joblog/JobLogEditor';
import { coerceForm, eventCount, hasSig } from '../../shared/jobLogForm';
import { Banner, Card, Skeleton, cx } from '../components/ui';
import { lazyRetry } from '../staleBuild';
import { useJraLock } from './Jra';

// The Job Log and the Winch data on pages of their own (6z.49), opened from a card on Execution and Closure the way
// the JRA is: the stage stays short, and the work has the whole screen.

const WinchDataCard = lazy(lazyRetry(() => import('./WinchData')));
const when = (iso: string) => riyadhShort(iso);
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

/** /operation/jobs/:id/log — the Job log · Sequence of Events form (6z.51). */
export function JobLogPage() {
  const { id = '' } = useParams();
  const job = useJob(id);
  const jraLocked = useJraLock(id);
  if (job.isPending) return <Skeleton className="h-96" />;
  if (job.isError) return <Banner tone="danger" action={<Link className="underline" to="/operation/jobs">Back to jobs</Link>}>{job.error.message}</Banner>;
  return <JobLogEditor jobId={id} jraLocked={jraLocked} title={[job.data.ticket_no, job.data.well].filter(Boolean).join(' · ') || 'Job'} />;
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

/** The card on Execution: the log's version, events and signatures, and the way into it (6z.51). */
export function JobLogBanner({ jobId }: { jobId: string }) {
  const q = useQuery({ queryKey: ['joblog-summary', jobId], queryFn: () => api<{ log: { version: number; form: unknown; savedBy: string | null; savedAt: string; sentAt: string | null } | null }>(`/joblog/${jobId}`), retry: false });
  const log = q.data?.log;
  const form = log ? coerceForm(log.form) : null;
  const events = form ? eventCount(form) : 0;
  const eng = !!form && hasSig(form.engSig), fm = !!form && hasSig(form.fmSig);
  return (
    <div className={cx('mb-4 rounded-md border p-3', events ? (eng && fm ? 'border-success' : 'border-border') : 'border-warning')}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-base font-bold uppercase">Job log · sequence of events</h2>
        <span className="text-sm text-text-muted">{q.isPending ? 'Reading…' : log ? `v${log.version} · ${events} event${events === 1 ? '' : 's'}` : 'Not started'}</span>
        {log && <span className={cx('label-caps rounded-pill px-2 py-0.5', eng ? 'bg-success-subtle text-success' : 'bg-neutral-subtle text-text-muted')}>Crew {eng ? 'signed' : 'not signed'}</span>}
        {log && <span className={cx('label-caps rounded-pill px-2 py-0.5', fm ? 'bg-success-subtle text-success' : 'bg-neutral-subtle text-text-muted')}>Client {fm ? 'signed' : 'not signed'}</span>}
        {log?.sentAt && <span className="label-caps rounded-pill bg-info-subtle px-2 py-0.5 text-info">Emailed</span>}
        <span className="ml-auto"><Link className={openBtn} to={`/operation/jobs/${jobId}/log`}>{log ? 'Open job log' : 'Start job log'}</Link></span>
      </div>
      <p className="mt-1 text-xs text-text-muted">{log ? `Last saved ${when(log.savedAt)}${log.savedBy ? ` by ${log.savedBy}` : ''}. The header, the wire and the crew come from the job above; times, runs and depths are read back from the log.` : 'Fill the times, runs and depths above first: the log’s header, wire and crew come from the job. Every event with its run and depth, crew hours and both signatures, kept on the device with no signal.'}</p>
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
