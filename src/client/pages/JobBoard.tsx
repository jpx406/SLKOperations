import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Plus, Search } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { STAGES, stagePercent, type Stage } from '../../shared/stages';
import type { Job } from '../../shared/types';
import { api, formatDate } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, EmptyState, PageTitle, Skeleton, StatusPill, cx, inputSized } from '../components/ui';
import { ReconBanner } from '../components/ReconBanner';

// Job board (S03). The record is the product, so the board leads with the jobs whose record isn't complete:
// closed jobs with unfinished stages, and open jobs without a unit or a date. Each reason is said in words.

const STAGE_SHORT: Record<Stage, string> = { design: 'Design', preparation: 'Prep', execution: 'Execution', closure: 'Closure' };
const CLOSED_PREVIEW = 20;
const STATUS_FILTERS = [['all', 'All'], ['planned', 'Planned'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['canceled', 'Canceled']] as const;

/** Why a job needs attention, or null when its record is in order for its status. */
function attention(j: Job): string | null {
  if (j.status === 'canceled') return null;
  if (j.status === 'completed') {
    const open = STAGES.filter((s) => stagePercent(j, s) < 100).map((s) => `${STAGE_SHORT[s]} ${stagePercent(j, s)}%`);
    return open.length ? `Incomplete: ${open.join(' · ')}` : null;
  }
  const missing = [!j.unit_number && 'unit', !j.start_date && 'start date'].filter(Boolean);
  return missing.length ? `Missing ${missing.join(' and ')}` : null;
}

export function JobBoard() {
  const [params, setParams] = useSearchParams();
  const qText = params.get('q') ?? '';
  const status = params.get('status') ?? 'all';
  const onlyAttention = params.get('attention') === '1';
  const q = useDeferredValue(qText);
  const { data: me } = useMe();
  const jobs = useQuery({
    queryKey: ['jobs', q, status],
    queryFn: () => api<Job[]>(`/jobs?q=${encodeURIComponent(q)}&status=${status}`),
    refetchInterval: 30_000,
  });
  const sdms = useQuery({ queryKey: ['sdms'], queryFn: () => api<{ username: string; full_name: string }[]>('/sdms'), staleTime: 300_000 });
  const name = (u: string | null) => (u ? sdms.data?.find((s) => s.username.toLowerCase() === u.toLowerCase())?.full_name ?? u : null);
  const [showAllClosed, setShowAllClosed] = useState(false);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v && v !== 'all') next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  const groups = useMemo(() => {
    const list = jobs.data ?? [];
    const flagged = list.filter((j) => attention(j));
    const rest = list.filter((j) => !attention(j));
    return [
      { key: 'attention', title: 'Needs attention', rows: flagged },
      ...(onlyAttention ? [] : [
        { key: 'ongoing', title: 'Ongoing', rows: rest.filter((j) => j.status === 'ongoing') },
        { key: 'planned', title: 'Planned', rows: rest.filter((j) => j.status === 'planned') },
        { key: 'closed', title: 'Closed', rows: rest.filter((j) => j.status === 'completed' || j.status === 'canceled') },
      ]),
    ].filter((g) => g.rows.length);
  }, [jobs.data, onlyAttention]);
  const flaggedCount = (jobs.data ?? []).filter((j) => attention(j)).length;
  const chip = (on: boolean) => cx('inline-flex h-(--layout-control-sm) items-center rounded-pill border px-3 text-sm font-semibold', on ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text');

  return (
    <section aria-labelledby="board-title">
      <PageTitle aside={me?.menus.jobs?.edit && (
        <Link to="/operation/jobs/new" className="inline-flex h-(--layout-control-md) items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-semibold text-on-accent hover:bg-accent-hover">
          <Plus aria-hidden className="size-4" />New job
        </Link>
      )}>
        <span id="board-title">Job board</span>
        {jobs.data && <span className="ml-3 align-middle font-mono text-sm font-medium normal-case text-text-muted">{jobs.data.length} jobs</span>}
      </PageTitle>
      <ReconBanner />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative block w-72 max-w-full">
          <span className="sr-only">Search jobs</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-subtle" />
          <input className={inputSized('w-full pl-8')} placeholder="Ticket, well, rig, unit, SDM" value={qText} onChange={(e) => set('q', e.target.value)} />
        </label>
        <div role="group" aria-label="Status" className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map(([v, l]) => <button key={v} type="button" aria-pressed={status === v} className={chip(status === v)} onClick={() => set('status', v)}>{l}</button>)}
        </div>
        <button type="button" aria-pressed={onlyAttention} onClick={() => set('attention', onlyAttention ? '' : '1')}
          className={cx(chip(onlyAttention), !onlyAttention && flaggedCount > 0 && 'text-warning')}>
          <AlertTriangle aria-hidden className="mr-1.5 size-4" />Needs attention only{jobs.data && <span className="ml-1.5 font-mono">{flaggedCount}</span>}
        </button>
      </div>

      {jobs.isPending && <div className="flex flex-col gap-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>}
      {jobs.isError && <Banner tone="danger" action={<Button size="sm" onClick={() => jobs.refetch()}>Retry</Button>}>Couldn't load jobs. {jobs.error.message}</Banner>}
      {jobs.data && jobs.data.length === 0 && (qText || status !== 'all'
        ? <EmptyState title="No jobs match" action={<Button onClick={() => setParams({})}>Clear filters</Button>}>Try a different ticket, well or status.</EmptyState>
        : <EmptyState title="No jobs yet">Jobs you and your team create appear here, newest first.</EmptyState>)}
      {jobs.data && jobs.data.length > 0 && onlyAttention && !groups.length && <p className="rounded-lg bg-surface px-4 py-3 text-sm text-text-muted">Every job's record is in order for its status.</p>}

      <div className="flex flex-col gap-6">
        {groups.map((g) => {
          const rows = g.key === 'closed' && !showAllClosed ? g.rows.slice(0, CLOSED_PREVIEW) : g.rows;
          return (
            <section key={g.key} aria-labelledby={`grp-${g.key}`}>
              <h2 id={`grp-${g.key}`} className={cx('label-caps mb-2 flex items-center gap-2', g.key === 'attention' ? 'text-warning' : 'text-text-muted')}>
                {g.key === 'attention' && <AlertTriangle aria-hidden className="size-3.5" />}{g.title}<span className="font-mono">{g.rows.length}</span>
              </h2>
              <Card className="overflow-hidden p-0!">
                <div aria-hidden className="label-caps hidden grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,17rem)_10rem] gap-4 border-b border-border px-4 py-2 text-text-subtle lg:grid">
                  <span>Ticket · well · rig</span><span>Unit · SDM · account</span><span>Stages</span><span className="text-right">Status</span>
                </div>
                <ul className="divide-y divide-border">
                  {rows.map((j) => {
                    const why = attention(j);
                    return (
                      <li key={j.id}>
                        <Link to={`/operation/jobs/${j.id}/design`}
                          className="grid min-h-(--layout-control-lg) grid-cols-1 items-center gap-x-4 gap-y-1.5 px-4 py-2.5 hover:bg-surface-2 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,17rem)_10rem]">
                          <div className="min-w-0">
                            <p className="truncate font-display font-bold">{j.ticket_no ?? <span className="font-sans font-normal text-text-subtle italic">No ticket yet</span>}</p>
                            <p className="truncate text-sm text-text-muted">{j.well ?? 'well —'} · {j.rig ?? 'rig —'}</p>
                          </div>
                          <div className="min-w-0 text-sm">
                            <p className="truncate">{j.unit_number ? `Unit ${j.unit_number}` : <span className="text-text-subtle">No unit</span>}{j.sdm_username ? ` · ${name(j.sdm_username)}` : ''}</p>
                            <p className="truncate text-text-muted">
                              <span className="font-mono text-xs">{j.start_date ? formatDate(j.start_date) : 'no date'}</span>
                              {[j.location, j.field].filter(Boolean).length > 0 && ` · ${[j.location, j.field].filter(Boolean).join(' / ')}`}
                            </p>
                            {why && <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-warning"><AlertTriangle aria-hidden className="size-3.5" />{why}</p>}
                          </div>
                          <div className="grid grid-cols-4 gap-2" aria-label={STAGES.map((s) => `${STAGE_SHORT[s]} ${stagePercent(j, s)} percent`).join(', ')}>
                            {STAGES.map((s) => {
                              const v = stagePercent(j, s);
                              return (
                                <div key={s} aria-hidden>
                                  <p className="mb-1 flex justify-between font-mono text-xs text-text-subtle"><span>{STAGE_SHORT[s][0]}</span><span className={cx(v >= 100 && 'text-success')}>{v}</span></p>
                                  <div className="h-1 overflow-hidden rounded-sm bg-surface-3"><div className={cx('h-full', v >= 100 ? 'bg-success' : 'bg-accent')} style={{ width: `${Math.min(100, v)}%` }} /></div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex items-center gap-x-3 gap-y-1 lg:flex-col lg:items-end">
                            <StatusPill status={j.status} />
                            {j.job_efficiency_pct != null && <span className="font-mono text-xs whitespace-nowrap text-text-muted">efficiency {j.job_efficiency_pct}%</span>}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {g.key === 'closed' && g.rows.length > CLOSED_PREVIEW && (
                  <div className="border-t border-border px-4 py-2">
                    <Button size="sm" variant="ghost" onClick={() => setShowAllClosed(!showAllClosed)}>
                      {showAllClosed ? 'Show the latest 20 only' : `Show all ${g.rows.length} closed jobs`}
                    </Button>
                  </div>
                )}
              </Card>
            </section>
          );
        })}
      </div>
    </section>
  );
}
