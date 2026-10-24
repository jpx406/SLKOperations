import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { JobStatus } from '../../shared/types';
import { api } from '../api';
import { useMe } from '../auth';
import { Banner, Button, EmptyState, PageTitle, Skeleton, cx } from '../components/ui';

interface ScheduleData {
  month: string; first: string; last: string;
  units: { unit_number: string; country: string; year: number | null }[];
  jobs: { id: string; ticket_no: string | null; well: string | null; unit_number: string; status: JobStatus; start_date: string; end_date: string }[];
  events: { id: string; unit_number: string; kind: string; starts_on: string; ends_on: string }[];
  unscheduled: { id: string; ticket_no: string | null; well: string | null }[];
}

const BAR: Record<JobStatus, string> = {
  planned: 'border-info bg-info-subtle text-info',
  ongoing: 'border-warning bg-warning-subtle text-warning',
  completed: 'border-success bg-success-subtle text-success',
  canceled: 'border-neutral bg-neutral-subtle text-neutral line-through',
};

const BLOCK_LABEL: Record<string, string> = {
  maintenance: 'Maintenance', loan: 'On loan', transferred: 'Transferred', junk: 'Junk', backup_on_location: 'Backup on site',
};

const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).slice(0, 7);
function shift(month: string, by: number) {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** Assigns each bar a lane so overlapping jobs on one unit stack instead of hiding each other. */
function lanes<T extends { start: number; end: number }>(items: T[]): (T & { lane: number })[] {
  const ends: number[] = [];
  return [...items].sort((a, b) => a.start - b.start).map((it) => {
    let lane = ends.findIndex((e) => e < it.start);
    if (lane === -1) { lane = ends.length; ends.push(it.end); } else ends[lane] = it.end;
    return { ...it, lane };
  });
}

export function Schedule() {
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? thisMonth();
  const [showCanceled, setShowCanceled] = useState(false);
  const { data: me } = useMe();
  const canCreate = !!me?.menus.jobs?.edit;
  const q = useQuery({
    queryKey: ['schedule', month, showCanceled],
    queryFn: () => api<ScheduleData>(`/schedule?month=${month}${showCanceled ? '&canceled=1' : ''}`),
    refetchInterval: 30_000,
  });

  const days = useMemo(() => {
    if (!q.data) return [];
    const n = Number(q.data.last.slice(8, 10));
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, i + 1));
      return { day: i + 1, iso: d.toISOString().slice(0, 10), weekday: d.toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' }), weekend: [5, 6].includes(d.getUTCDay()) };
    });
  }, [q.data, month]);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dayIndex = (iso: string) => Math.max(1, Math.min(days.length, iso < q.data!.first ? 1 : iso > q.data!.last ? days.length : Number(iso.slice(8, 10))));

  return (
    <section aria-labelledby="sched-title">
      <PageTitle aside={
        <>
          <Button size="sm" onClick={() => setParams({ month: shift(month, -1) })} aria-label="Previous month"><ChevronLeft aria-hidden className="size-4" /></Button>
          <span className="min-w-36 text-center font-mono text-sm font-semibold" aria-live="polite">{monthLabel}</span>
          <Button size="sm" onClick={() => setParams({ month: shift(month, 1) })} aria-label="Next month"><ChevronRight aria-hidden className="size-4" /></Button>
          <Button size="sm" onClick={() => setParams({})}>Today</Button>
          {canCreate && <Link to="/operation/jobs/new" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-hover"><Plus aria-hidden className="size-4" />New job</Link>}
        </>
      }>
        <span id="sched-title">Unit schedule</span>
      </PageTitle>

      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-2 text-text-muted">
          <input type="checkbox" checked={showCanceled} onChange={(e) => setShowCanceled(e.target.checked)} /> Show canceled jobs
        </label>
        <span className="flex flex-wrap gap-3 text-xs text-text-muted" aria-label="Legend">
          {(['planned', 'ongoing', 'completed'] as JobStatus[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5"><i className={cx('inline-block size-2.5 rounded-xs border-l-3', BAR[s])} />{s}</span>
          ))}
          <span className="inline-flex items-center gap-1.5"><i className="hatch-blocked inline-block size-2.5 rounded-xs" />unit blocked</span>
        </span>
      </div>

      {q.data && q.data.unscheduled.length > 0 && (
        <div className="mb-3">
          <Banner tone="warning">
            {q.data.unscheduled.length} job{q.data.unscheduled.length === 1 ? ' has' : 's have'} no unit or start date and {q.data.unscheduled.length === 1 ? "isn't" : "aren't"} on the schedule:{' '}
            {q.data.unscheduled.slice(0, 5).map((j, i) => (
              <span key={j.id}>{i > 0 && ', '}<Link className="font-semibold underline" to={`/operation/jobs/${j.id}/design`}>{j.ticket_no ?? j.well ?? 'untitled job'}</Link></span>
            ))}
            {q.data.unscheduled.length > 5 && ` and ${q.data.unscheduled.length - 5} more`}
          </Banner>
        </div>
      )}

      {q.isPending && <Skeleton className="h-96" />}
      {q.isError && <Banner tone="danger" action={<Button size="sm" onClick={() => q.refetch()}>Retry</Button>}>Couldn't load the schedule. {q.error.message}</Banner>}
      {q.data && q.data.units.length === 0 && (
        <EmptyState title="No units yet">Units come from WIREGUARD. Run a sync from the header, or check that WIREGUARD has units for your country.</EmptyState>
      )}

      {q.data && q.data.units.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <div role="grid" aria-label={`Unit schedule, ${monthLabel}`} className="grid w-full"
            style={{
              gridTemplateColumns: `calc(var(--spacing) * 36) repeat(${days.length}, minmax(0, 1fr))`,
              minWidth: `calc(var(--spacing) * (36 + ${days.length} * 9))`,
            }}>
            <div role="row" className="contents">
              <div role="columnheader" className="label-caps sticky left-0 z-10 border-r border-b border-border bg-surface-2 px-3 py-2 text-text-muted">Unit</div>
              {days.map((d) => (
                <div role="columnheader" key={d.day} aria-label={d.iso}
                  className={cx('border-b border-border py-1 text-center font-mono text-xs text-text-muted', d.weekend && 'bg-surface-2', d.iso === today && 'shadow-[inset_0_-2px_0_var(--color-accent)] text-text')}>
                  <div>{d.weekday}</div><div>{d.day}</div>
                </div>
              ))}
            </div>
            {q.data.units.map((u) => {
              const bars = lanes([
                ...q.data.jobs.filter((j) => j.unit_number === u.unit_number).map((j) => ({ kind: 'job' as const, job: j, start: dayIndex(j.start_date), end: dayIndex(j.end_date) })),
                ...q.data.events.filter((e) => e.unit_number === u.unit_number).map((e) => ({ kind: 'block' as const, block: e, start: dayIndex(e.starts_on), end: dayIndex(e.ends_on) })),
              ]);
              const laneCount = Math.max(1, ...bars.map((b) => b.lane + 1));
              return (
                <div role="row" key={u.unit_number} className="contents">
                  <div role="rowheader" className="sticky left-0 z-10 flex items-baseline gap-2 border-r border-b border-border bg-surface px-3 py-2 whitespace-nowrap">
                    <span className="font-display text-sm font-bold">{u.unit_number}</span>
                    {(me?.countries.length ?? 0) > 1 && <span className="truncate font-mono text-xs text-text-subtle">{u.country}</span>}
                  </div>
                  <div role="gridcell" className="relative grid border-b border-border"
                    style={{ gridColumn: `2 / span ${days.length}`, gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${laneCount}, calc(var(--spacing) * 7))`, rowGap: 'var(--spacing)', paddingBlock: 'var(--spacing)' }}>
                    {days.map((d) => d.weekend && <div key={d.day} aria-hidden className="bg-surface-2" style={{ gridColumn: d.day, gridRow: `1 / span ${laneCount}`, marginBlock: 'calc(var(--spacing) * -1)' }} />)}
                    {bars.map((b) => b.kind === 'job' ? (
                      <Link key={b.job.id} to={`/operation/jobs/${b.job.id}/design`}
                        aria-label={`Job ${b.job.ticket_no ?? 'without ticket'}, ${b.job.well ?? 'no well'}, ${b.job.start_date} to ${b.job.end_date}, ${b.job.status}, unit ${u.unit_number}`}
                        className={cx('z-[1] mx-0.5 flex items-center overflow-hidden rounded-sm border-l-3 px-1.5 font-mono text-xs font-semibold whitespace-nowrap hover:brightness-125', BAR[b.job.status])}
                        style={{ gridColumn: `${b.start} / ${b.end + 1}`, gridRow: b.lane + 1 }}>
                        {b.job.ticket_no ?? 'No ticket'}{b.job.well ? ` · ${b.job.well}` : ''}
                      </Link>
                    ) : (
                      <div key={b.block.id} className="hatch-blocked z-[1] mx-0.5 flex items-center overflow-hidden rounded-sm border-l-3 border-blocked px-1.5 font-mono text-xs text-blocked"
                        style={{ gridColumn: `${b.start} / ${b.end + 1}`, gridRow: b.lane + 1 }}>
                        {BLOCK_LABEL[b.block.kind] ?? b.block.kind}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-text-subtle">Units and their countries come from WIREGUARD. Click a bar to open the job. Drag-to-reschedule arrives with milestone 2c.</p>
    </section>
  );
}
