import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useDeferredValue } from 'react';
import { Link, useSearchParams } from 'react-router';
import { STAGES, stagePercent } from '../../shared/stages';
import type { Job } from '../../shared/types';
import { api, formatDate } from '../api';
import { useMe } from '../auth';
import { Banner, Button, EmptyState, PageTitle, ProgressBar, Skeleton, StatusPill, inputClass } from '../components/ui';
import { ReconBanner } from '../components/ReconBanner';

export function JobBoard() {
  const [params, setParams] = useSearchParams();
  const qText = params.get('q') ?? '';
  const status = params.get('status') ?? 'all';
  const q = useDeferredValue(qText);
  const { data: me } = useMe();
  const jobs = useQuery({
    queryKey: ['jobs', q, status],
    queryFn: () => api<Job[]>(`/jobs?q=${encodeURIComponent(q)}&status=${status}`),
    refetchInterval: 30_000,
  });
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v && v !== 'all') next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <section aria-labelledby="board-title">
      <PageTitle aside={
        <>
          <label className="relative block w-64 max-w-full">
            <span className="sr-only">Search jobs</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-subtle" />
            <input className={`${inputClass} pl-8`} placeholder="Ticket, well, rig, unit, SDM" value={qText} onChange={(e) => set('q', e.target.value)} />
          </label>
          <label>
            <span className="sr-only">Status</span>
            <select className={`${inputClass} w-36`} value={status} onChange={(e) => set('status', e.target.value)}>
              <option value="all">All statuses</option>
              <option value="planned">Planned</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
              <option value="canceled">Canceled</option>
            </select>
          </label>
          {me?.menus.jobs?.edit && (
            <Link to="/operation/jobs/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-semibold text-on-accent hover:bg-accent-hover">
              <Plus aria-hidden className="size-4" />New job
            </Link>
          )}
        </>
      }>
        <span id="board-title">Job board</span>
        {jobs.data && <span className="ml-3 align-middle font-mono text-sm font-medium normal-case text-text-muted">{jobs.data.length} jobs</span>}
      </PageTitle>
      <ReconBanner />

      {jobs.isPending && <div className="flex flex-col gap-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>}
      {jobs.isError && <Banner tone="danger" action={<Button size="sm" onClick={() => jobs.refetch()}>Retry</Button>}>Couldn't load jobs. {jobs.error.message}</Banner>}
      {jobs.data && jobs.data.length === 0 && (qText || status !== 'all'
        ? <EmptyState title="No jobs match" action={<Button onClick={() => setParams({})}>Clear filters</Button>}>Try a different ticket, well or status.</EmptyState>
        : <EmptyState title="No jobs yet">Jobs you and your team create appear here, newest first.</EmptyState>)}

      <ul className="flex flex-col gap-3">
        {jobs.data?.map((j) => (
          <li key={j.id}>
            <Link to={`/operation/jobs/${j.id}/design`}
              className="grid grid-cols-1 items-center gap-3 rounded-lg border border-border bg-surface p-4 hover:border-border-strong md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,22rem)_11rem]">
              <div className="min-w-0">
                <p className="truncate font-display text-lg font-bold">{j.ticket_no ?? <span className="text-text-subtle italic">No ticket yet</span>}</p>
                <p className="truncate text-sm text-text-muted">{j.well ?? 'Well —'} · {j.rig ?? 'Rig —'}</p>
                <p className="font-mono text-xs text-text-subtle">{j.start_date ? `${formatDate(j.start_date)}${j.end_date && j.end_date !== j.start_date ? ` – ${formatDate(j.end_date)}` : ''}` : 'no dates yet'}</p>
              </div>
              <div className="min-w-0 text-sm">
                <p className="truncate">{j.unit_number ? `Unit ${j.unit_number}` : <span className="text-text-subtle">No unit</span>}{j.sdm_username ? ` · SDM ${j.sdm_username}` : ''}</p>
                <p className="truncate text-text-muted">{[j.location, j.field].filter(Boolean).join(' / ') || '—'}{j.services[0] ? ` · ${j.services[0]}` : ''}{j.services.length > 1 ? ` +${j.services.length - 1}` : ''}</p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {STAGES.map((s) => (
                  <div key={s}>
                    <p className="label-caps mb-1 truncate text-text-subtle">{s}</p>
                    <ProgressBar value={stagePercent(j, s)} label={s} />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 md:justify-end">
                {j.job_efficiency_pct != null && <span className="font-mono text-xs text-text-muted">{j.job_efficiency_pct}% eff</span>}
                <StatusPill status={j.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
