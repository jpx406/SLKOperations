import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Check, ChevronLeft, ChevronRight, Filter, Play, Plus, Tag, Wrench, X, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { canEditField } from '../../shared/fieldPolicy';
import { activeFilterCount, filtersToQuery } from '../../shared/filters';
import { EVENT_LABEL, MAINTENANCE_TYPES, STATUS_KINDS, isOpenEnd } from '../../shared/unitEvents';
import { FilterBar, useFilters } from '../components/FilterBar';
import type { JobStatus } from '../../shared/types';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { Banner, Button, EmptyState, Field, Skeleton, cx, inputClass } from '../components/ui';
import { ReconBanner } from '../components/ReconBanner';

interface SJob { id: string; ticket_no: string | null; well: string | null; unit_number: string; status: JobStatus; start_date: string; end_date: string; updated_at: string; sdm_username: string | null; sdm_name: string | null; location: string | null }
interface SEvent { id: string; unit_number: string; kind: string; detail: string | null; starts_on: string; ends_on: string; note: string | null }
interface SWire { unit_number: string; drum_position: string | null; wire_grade: string | null; wire_size: string | null; remaining_length_ft: number | null }
interface ScheduleData {
  month: string; first: string; last: string;
  units: { unit_number: string; country: string; year: number | null }[];
  jobs: SJob[]; events: SEvent[];
  unscheduled: { id: string; ticket_no: string | null; well: string | null }[];
  retiredUnitJobs: { id: string; ticket_no: string | null; well: string | null; unit_number: string; start_date: string | null }[];
  wires: SWire[];
}

/** 0.28125 → 9/32, the way the crews say wire sizes. */
function inchFraction(size: string | null) {
  const v = Number(size);
  if (!size || !Number.isFinite(v) || v <= 0) return size ?? '';
  const n = Math.round(v * 32);
  if (Math.abs(n / 32 - v) > 0.002) return String(v);
  let num = n, den = 32;
  while (num % 2 === 0 && den > 1) { num /= 2; den /= 2; }
  return `${num}/${den}`;
}
const wireLine = (w: SWire) => [w.wire_grade?.split(' ')[0], `${inchFraction(w.wire_size)}"`, w.remaining_length_ft != null ? `${Math.round(w.remaining_length_ft).toLocaleString()}'` : null].filter(Boolean).join(', ');

// WL Hub bars: a full outline in the status colour over a tinted fill
const BAR: Record<JobStatus, string> = {
  planned: 'border-info bg-info-subtle text-info',
  ongoing: 'border-warning bg-warning-subtle text-warning',
  completed: 'border-success bg-success-subtle text-success',
  canceled: 'border-neutral bg-neutral-subtle text-neutral line-through',
};
const DOT: Record<string, string> = { planned: 'bg-info', ongoing: 'bg-warning', completed: 'bg-success' };
// a shape per status, so the bar doesn't depend on its colour alone
const BAR_ICON: Record<JobStatus, LucideIcon> = { planned: CalendarClock, ongoing: Play, completed: Check, canceled: X };
const BLOCK_LABEL = EVENT_LABEL;

const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).slice(0, 7);
function shiftMonth(month: string, by: number) {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1)).toISOString().slice(0, 7);
}
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lanes so overlapping bars on one unit stack instead of hiding each other. */
function lanes<T extends { start: number; end: number }>(items: T[]): (T & { lane: number })[] {
  const ends: number[] = [];
  return [...items].sort((a, b) => a.start - b.start).map((it) => {
    let lane = ends.findIndex((e) => e < it.start);
    if (lane === -1) { lane = ends.length; ends.push(it.end); } else ends[lane] = it.end;
    return { ...it, lane };
  });
}

type DragMode = 'move' | 'start' | 'end';
interface Drag { job: SJob; mode: DragMode; x0: number; dayW: number; days: number; unit: string; moved: boolean }
interface Target { unit_number: string; start_date: string; end_date: string }

function targetOf(d: Drag): Target {
  const { job, mode, days, unit } = d;
  if (mode === 'move') return { unit_number: unit, start_date: addDays(job.start_date, days), end_date: addDays(job.end_date, days) };
  if (mode === 'start') {
    const s = addDays(job.start_date, days);
    return { unit_number: job.unit_number, start_date: s > job.end_date ? job.end_date : s, end_date: job.end_date };
  }
  const e = addDays(job.end_date, days);
  return { unit_number: job.unit_number, start_date: job.start_date, end_date: e < job.start_date ? job.start_date : e };
}

export function Schedule() {
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? thisMonth();
  const showCanceled = params.get('canceled') === '1';
  // the standard filters (SDM, account, area, service, unit ...) narrow the jobs drawn; Unit # also narrows the rows.
  // Events and free days stay visible.
  const [filters] = useFilters();
  const fq = filtersToQuery({ ...filters, year: undefined, month: undefined });
  const nFilters = activeFilterCount({ ...filters, year: undefined, month: undefined });
  const [showFilters, setShowFilters] = useState(nFilters > 0);
  const setParam = (k: string, v: string | null) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const shown = (_j: SJob) => true;
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canCreate = !!me?.menus.jobs?.edit;
  const canMove = !!me?.menus.schedule?.edit && !!me && canEditField(me.role, 'unit_number') && canEditField(me.role, 'start_date');
  const canBlock = !!me?.menus.schedule?.edit;
  const key = ['schedule', month, showCanceled, fq];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<ScheduleData>(`/schedule?month=${month}${showCanceled ? '&canceled=1' : ''}${fq ? `&${fq}` : ''}`),
    refetchInterval: 30_000,
  });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pending, setPending] = useState<{ id: string; t: Target } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [blockDialog, setBlockDialog] = useState<{ event?: SEvent; unit?: string; mode: 'maintenance' | 'status' } | null>(null);
  const [live, setLive] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);

  const move = useMutation({
    mutationFn: ({ job, t }: { job: SJob; t: Target }) =>
      api<{ job: { unit_number: string; start_date: string; end_date: string | null; updated_at: string } }>(`/jobs/${job.id}/move`, { method: 'POST', json: { ...t, expectedUpdatedAt: job.updated_at } }),
    onMutate: ({ job, t }) => setPending({ id: job.id, t }),
    onSuccess: (res, { job, t }) => {
      // take the server's answer at once, so a second quick move carries the new timestamp
      qc.setQueryData<ScheduleData>(key, (old) => old && {
        ...old,
        jobs: old.jobs.map((j) => j.id === job.id
          ? { ...j, unit_number: res.job.unit_number, start_date: res.job.start_date, end_date: res.job.end_date ?? res.job.start_date, updated_at: res.job.updated_at }
          : j),
      });
      const msg = `${job.ticket_no ?? 'Job'} moved to ${t.unit_number}, ${t.start_date} to ${t.end_date}`;
      setNotice({ tone: 'success', text: msg });
      setLive(msg);
    },
    onError: (e: ApiError) => { setNotice({ tone: 'danger', text: e.message }); setLive(`Not moved: ${e.message}`); },
    onSettled: async () => { await qc.invalidateQueries({ queryKey: ['schedule'] }); setPending(null); qc.invalidateQueries({ queryKey: ['jobs'] }); },
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
  const col = (iso: string) => Math.max(1, Math.min(days.length, iso < q.data!.first ? 1 : iso > q.data!.last ? days.length : Number(iso.slice(8, 10))));
  const unitsList = q.data?.units.map((u) => u.unit_number) ?? [];

  // where each job is drawn right now: dragging > saving > server
  const placed = (j: SJob): SJob => {
    if (drag?.job.id === j.id && drag.moved) return { ...j, ...targetOf(drag) };
    if (pending?.id === j.id) return { ...j, ...pending.t };
    return j;
  };

  // The dragged bar is redrawn in the row under the pointer, which replaces its element, so pointer
  // capture can't be used: move and release are followed on the window for the length of the drag.
  const dragRef = useRef<Drag | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLElement>, job: SJob, mode: DragMode) => {
    if (!canMove || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const cell = (e.currentTarget.closest('[data-unit]') as HTMLElement | null);
    const dayW = (cell?.getBoundingClientRect().width ?? 1) / Math.max(1, days.length);
    const d: Drag = { job, mode, x0: e.clientX, dayW, days: 0, unit: job.unit_number, moved: false };
    dragRef.current = d;
    setDrag(d);
  };
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: globalThis.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dd = Math.round((e.clientX - d.x0) / d.dayW);
      let unit = d.unit;
      if (d.mode === 'move') {
        const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-unit]') as HTMLElement | null;
        if (over?.dataset.unit) unit = over.dataset.unit;
      }
      if (dd !== d.days || unit !== d.unit) {
        const next = { ...d, days: dd, unit, moved: true };
        dragRef.current = next;
        setDrag(next);
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      if (!d.moved || (d.days === 0 && d.unit === d.job.unit_number)) { navigate(`/operation/jobs/${d.job.id}/design`); return; }
      move.mutate({ job: d.job, t: targetOf(d) });
    };
    const onCancel = () => { dragRef.current = null; setDrag(null); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // listeners are attached once per drag; they read the latest state from dragRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.job.id]);
  const onBarKey = (e: KeyboardEvent<HTMLElement>, job: SJob) => {
    if (!canMove) return;
    let t: Target | null = null;
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const n = e.key === 'ArrowLeft' ? -1 : 1;
      t = { unit_number: job.unit_number, start_date: addDays(job.start_date, n), end_date: addDays(job.end_date, n) };
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const i = unitsList.indexOf(job.unit_number) + (e.key === 'ArrowUp' ? -1 : 1);
      if (i >= 0 && i < unitsList.length) t = { unit_number: unitsList[i], start_date: job.start_date, end_date: job.end_date };
    } else if (e.key === ']' || e.key === '[') {
      const end = addDays(job.end_date, e.key === ']' ? 1 : -1);
      if (end >= job.start_date) t = { unit_number: job.unit_number, start_date: job.start_date, end_date: end };
    } else if (e.key === '}' || e.key === '{') {
      const start = addDays(job.start_date, e.key === '}' ? 1 : -1);
      if (start <= job.end_date) t = { unit_number: job.unit_number, start_date: start, end_date: job.end_date };
    }
    if (t) { e.preventDefault(); move.mutate({ job, t }); }
  };

  const wiresOf = (unit: string) => (q.data?.wires ?? []).filter((w) => w.unit_number === unit);
  const outline = 'inline-flex h-(--layout-control-md) items-center gap-2 rounded-md border px-4 text-sm font-bold';

  return (
    <section aria-labelledby="sched-title">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 id="sched-title" className="font-display text-3xl font-extrabold tracking-wide uppercase">Unit schedule</h1>
        <div className="flex items-center gap-2">
          <Button onClick={() => setParam('month', shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft aria-hidden className="size-4" /></Button>
          <span className="min-w-36 text-center font-mono text-base font-bold text-accent-text" aria-live="polite">{monthLabel}</span>
          <Button onClick={() => setParam('month', shiftMonth(month, 1))} aria-label="Next month"><ChevronRight aria-hidden className="size-4" /></Button>
          <Button onClick={() => setParam('month', null)}>Today</Button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex flex-wrap gap-3 text-sm text-text-muted" aria-label="Legend">
            {(['planned', 'ongoing', 'completed'] as JobStatus[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5"><i className={cx('inline-block size-3 rounded-xs', DOT[s])} />{s[0].toUpperCase() + s.slice(1)}</span>
            ))}
          </span>
          {canCreate && <Link to="/operation/jobs/new" className="inline-flex h-(--layout-control-md) items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-bold text-on-accent hover:bg-accent-hover"><Plus aria-hidden className="size-4" />Create Job</Link>}
          <Button aria-expanded={showFilters} aria-controls="sched-filters" onClick={() => setShowFilters(!showFilters)}>
            <Filter aria-hidden className="size-4" />Filters{nFilters > 0 && <span className="rounded-pill bg-accent px-1.5 font-mono text-xs text-on-accent">{nFilters}</span>}
          </Button>
          <label className="inline-flex items-center gap-2 text-sm text-text-muted">
            <input type="checkbox" className="size-4" checked={showCanceled} onChange={(e) => setParam('canceled', e.target.checked ? '1' : null)} /> Show canceled jobs
          </label>
        </div>
      </div>
      {canBlock && (
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <button type="button" className={cx(outline, 'border-maint text-maint hover:bg-maint-subtle')} onClick={() => setBlockDialog({ mode: 'maintenance' })}>
            <Wrench aria-hidden className="size-4" />+ Maintenance Event
          </button>
          <button type="button" className={cx(outline, 'border-status-event text-status-event hover:bg-status-event-subtle')} onClick={() => setBlockDialog({ mode: 'status' })}>
            <Tag aria-hidden className="size-4" />+ Unit Status Event
          </button>
        </div>
      )}
      {showFilters && <div id="sched-filters"><FilterBar optionsPath="/filter-options" variant="panel" dims={['account', 'area', 'domain', 'service', 'sdm', 'unit', 'conveyance']} /></div>}

      <p aria-live="polite" className="sr-only">{live}</p>
      <ReconBanner />
      {notice && <div className="mb-3"><Banner tone={notice.tone} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)} aria-label="Dismiss"><X aria-hidden className="size-4" /></Button>}>{notice.text}</Banner></div>}
      {q.data && q.data.retiredUnitJobs.length > 0 && (
        <div className="mb-3">
          <Banner tone="danger">
            WIREGUARD no longer lists {[...new Set(q.data.retiredUnitJobs.map((j) => j.unit_number))].join(', ')}, but open jobs are still booked on {q.data.retiredUnitJobs.length === 1 ? 'it' : 'them'}:{' '}
            {q.data.retiredUnitJobs.map((j, i) => <span key={j.id}>{i > 0 && ', '}<Link className="font-semibold underline" to={`/operation/jobs/${j.id}/design`}>{j.ticket_no ?? j.well ?? 'untitled job'}</Link></span>)}. Move them to another unit.
          </Banner>
        </div>
      )}
      {q.data && q.data.unscheduled.length > 0 && (
        <p className="mb-3 flex flex-wrap items-center gap-1.5 text-sm text-text-muted">
          <AlertTriangle aria-hidden className="size-4 text-warning" />
          {q.data.unscheduled.length} job{q.data.unscheduled.length === 1 ? '' : 's'} without dates or unit not shown:{' '}
          {q.data.unscheduled.slice(0, 5).map((j, i) => <span key={j.id}>{i > 0 && ', '}<Link className="underline hover:text-text" to={`/operation/jobs/${j.id}/design`}>{j.ticket_no ?? j.well ?? 'untitled job'}</Link></span>)}
          {q.data.unscheduled.length > 5 && '…'} — set Start / End date and unit in the Design tab.
        </p>
      )}

      {q.isPending && <Skeleton className="h-96" />}
      {q.isError && <Banner tone="danger" action={<Button size="sm" onClick={() => q.refetch()}>Retry</Button>}>Couldn't load the schedule. {q.error.message}</Banner>}
      {q.data && q.data.units.length === 0 && (
        <EmptyState title={nFilters ? 'No units match the filters' : 'No units yet'}>{nFilters ? 'Clear the Unit # filter to see every unit.' : 'Units come from WIREGUARD. Run a sync from the header, or check that WIREGUARD has units for your country.'}</EmptyState>
      )}

      {q.data && q.data.units.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-card-edge bg-surface shadow-card">
          <div ref={gridRef} role="grid" aria-label={`Unit schedule, ${monthLabel}`} className={cx('grid w-full', drag && 'cursor-grabbing select-none')}
            style={{ gridTemplateColumns: `calc(var(--spacing) * 56) repeat(${days.length}, minmax(0, 1fr))`, minWidth: `calc(var(--spacing) * (56 + ${days.length} * 11))` }}>
            <div role="row" className="contents">
              <div role="columnheader" className="label-caps sticky left-0 z-10 flex items-center border-r border-b border-border bg-surface-2 px-4 py-2 text-text-muted">Unit</div>
              {days.map((d) => (
                <div role="columnheader" key={d.day} aria-label={d.iso}
                  className={cx('border-b border-border py-1.5 text-center font-mono', d.iso === today ? 'bg-today text-accent-text' : d.weekend ? 'bg-surface-2 text-text-muted' : 'text-text-muted')}>
                  <div className="text-label">{d.weekday}</div>
                  <div className={cx('text-sm font-semibold', d.iso === today ? 'text-accent-text underline decoration-2 underline-offset-4' : 'text-text')}>{d.day}</div>
                </div>
              ))}
            </div>
            {q.data.units.map((u) => {
              const bars = lanes([
                ...q.data.jobs.filter(shown).map(placed).filter((j) => j.unit_number === u.unit_number && j.end_date >= q.data.first && j.start_date <= q.data.last)
                  .map((j) => ({ kind: 'job' as const, job: j, start: col(j.start_date), end: col(j.end_date) })),
                ...q.data.events.filter((e) => e.unit_number === u.unit_number).map((e) => ({ kind: 'block' as const, block: e, start: col(e.starts_on), end: col(e.ends_on) })),
              ]);
              const laneCount = Math.max(1, ...bars.map((b) => b.lane + 1));
              const ws = wiresOf(u.unit_number);
              return (
                <div role="row" key={u.unit_number} className="contents">
                  <div role="rowheader" className="sticky left-0 z-10 border-r border-b border-border bg-surface px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-base font-bold whitespace-nowrap">{u.unit_number}</span>
                      <span className="label-caps ml-auto rounded-xs border border-pill-completed-border bg-pill-completed-bg px-1.5 text-pill-completed-fg">Active</span>
                    </div>
                    {ws.length ? ws.map((w, i) => <p key={i} className="font-mono text-xs leading-snug font-semibold text-text-muted">{wireLine(w)}</p>)
                      : <p className="font-mono text-xs text-text-subtle">no wire on file</p>}
                    {(me?.countries.length ?? 0) > 1 && <p className="truncate text-xs text-text-subtle">{u.country}</p>}
                  </div>
                  <div role="gridcell" data-unit={u.unit_number}
                    className={cx('relative grid border-b border-border', drag?.mode === 'move' && drag.moved && drag.unit === u.unit_number && 'bg-surface-2')}
                    style={{ gridColumn: `2 / span ${days.length}`, gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${laneCount}, calc(var(--spacing) * 7)) minmax(0, 1fr)`, rowGap: 'calc(var(--spacing) * 1.5)', paddingBlock: 'calc(var(--spacing) * 2)' }}>
                    {days.map((d) => (d.weekend || d.iso === today) && <div key={d.day} aria-hidden className={d.iso === today ? 'bg-today' : 'bg-surface-2/60'} style={{ gridColumn: d.day, gridRow: '1 / -1', marginBlock: 'calc(var(--spacing) * -2)' }} />)}
                    {bars.map((b) => b.kind === 'job' ? (
                      <a key={b.job.id} href={`/operation/jobs/${b.job.id}/design`} title={`${b.job.ticket_no ?? 'No ticket'} · ${b.job.well ?? ''}${b.job.sdm_name ? ` · SDM ${b.job.sdm_name}` : ''}`}
                        onClick={(e) => e.preventDefault()}
                        onPointerDown={(e) => (canMove ? onPointerDown(e, q.data.jobs.find((j) => j.id === b.job.id)!, 'move') : undefined)}
                        onPointerUp={() => { if (!canMove) navigate(`/operation/jobs/${b.job.id}/design`); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/operation/jobs/${b.job.id}/design`); else onBarKey(e, q.data.jobs.find((j) => j.id === b.job.id)!); }}
                        aria-label={`Job ${b.job.ticket_no ?? 'without ticket'}, ${b.job.well ?? 'no well'}, ${b.job.start_date} to ${b.job.end_date}, ${b.job.status}, unit ${u.unit_number}${b.job.sdm_name ? `, SDM ${b.job.sdm_name}` : ''}${canMove ? '. Shift+arrows move a day, Alt+up or down changes unit, [ and ] change the end, { and } change the start' : ''}`}
                        className={cx('group relative z-[1] mx-0.5 flex touch-none items-center gap-1.5 overflow-hidden rounded-md border px-2 font-mono text-xs font-bold whitespace-nowrap hover:brightness-125',
                          BAR[b.job.status], canMove && 'cursor-grab', (drag?.job.id === b.job.id || pending?.id === b.job.id) && 'opacity-80 shadow-pop')}
                        style={{ gridColumn: `${b.start} / ${b.end + 1}`, gridRow: b.lane + 1 }}>
                        {canMove && <span aria-hidden className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize" onPointerDown={(e) => onPointerDown(e, q.data.jobs.find((j) => j.id === b.job.id)!, 'start')} />}
                        <StatusGlyph status={b.job.status} />
                        <span>{b.job.ticket_no ?? 'No ticket'}</span>
                        {b.job.well && <span className="font-sans font-medium text-text">{b.job.well}</span>}
                        {canMove && <span aria-hidden className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize" onPointerDown={(e) => onPointerDown(e, q.data.jobs.find((j) => j.id === b.job.id)!, 'end')} />}
                      </a>
                    ) : (
                      <button key={b.block.id} type="button" disabled={!canBlock} onClick={() => setBlockDialog({ event: b.block, mode: b.block.kind === 'maintenance' ? 'maintenance' : 'status' })}
                        aria-label={`${b.block.kind === 'maintenance' ? `Maintenance, ${b.block.detail ?? ''}` : BLOCK_LABEL[b.block.kind]} on ${u.unit_number}, ${b.block.starts_on} to ${isOpenEnd(b.block.ends_on) ? 'ongoing' : b.block.ends_on}${b.block.note ? `: ${b.block.note}` : ''}`}
                        title={b.block.note ?? undefined}
                        className={cx('z-[1] mx-0.5 flex items-center gap-1.5 overflow-hidden rounded-md border border-dashed px-2 text-left text-xs font-bold whitespace-nowrap disabled:cursor-default',
                          b.block.kind === 'maintenance' ? 'hatch-maint border-maint text-maint' : 'hatch-status border-status-event text-status-event')}
                        style={{ gridColumn: `${b.start} / ${b.end + 1}`, gridRow: b.lane + 1 }}>
                        {b.block.kind === 'maintenance' ? <Wrench aria-hidden className="size-3.5 shrink-0" /> : <Tag aria-hidden className="size-3.5 shrink-0" />}
                        <span className="rounded-xs bg-surface/80 px-1">{b.block.kind === 'maintenance' ? b.block.detail ?? 'Maintenance' : BLOCK_LABEL[b.block.kind]}{isOpenEnd(b.block.ends_on) ? ' · ongoing' : ''}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-text-subtle">
        Units and wires come from WIREGUARD. {canMove ? 'Drag a bar to another day or unit, or drag its ends to change the dates. Click to open the job. By keyboard: Tab to a bar, Shift+arrows move it a day, Alt+up or down changes the unit, [ ] change the end and { } the start, Enter opens it.' : 'Click a bar to open the job.'}
        {canBlock && ' Click a maintenance or status event to change or remove it.'}
      </p>
      {blockDialog && <EventDialog init={blockDialog} units={unitsList} onClose={(msg) => { setBlockDialog(null); if (msg) { setNotice({ tone: 'success', text: msg }); qc.invalidateQueries({ queryKey: ['schedule'] }); } }} />}
    </section>
  );
}

function StatusGlyph({ status, className }: { status: JobStatus; className?: string }) {
  const I = BAR_ICON[status];
  return <I aria-hidden className={cx('size-3 shrink-0', className)} />;
}

/**
 * The WL Hub's two dialogs in one: a maintenance event (type, start and end) or a unit status event (loan,
 * transferred, junk, backup on location; no end date = ongoing). Both adjust the unit's utilization and, except
 * backup on location, stop bookings on those days.
 */
function EventDialog({ init, units, onClose }: { init: { event?: SEvent; unit?: string; mode: 'maintenance' | 'status' }; units: string[]; onClose: (msg?: string) => void }) {
  const ev = init.event;
  const maint = init.mode === 'maintenance';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  const [unit, setUnit] = useState(ev?.unit_number ?? init.unit ?? units[0] ?? '');
  const [kind, setKind] = useState<string>(ev?.kind ?? (maint ? 'maintenance' : 'loan'));
  const [detail, setDetail] = useState<string>(ev?.detail ?? MAINTENANCE_TYPES[0]);
  const [start, setStart] = useState(ev?.starts_on ?? today);
  const [end, setEnd] = useState(ev ? (isOpenEnd(ev.ends_on) ? '' : ev.ends_on) : maint ? today : '');
  const [note, setNote] = useState(ev?.note ?? '');
  const [conflict, setConflict] = useState<{ ticket_no: string | null; well: string | null; start_date: string; end_date: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = (confirmOverlap: boolean) => ({ kind, detail: maint ? detail : null, starts_on: start, ends_on: end || null, note, confirmOverlap });
  const save = useMutation({
    mutationFn: (confirmOverlap: boolean) => ev
      ? api(`/unit-events/${ev.id}`, { method: 'PATCH', json: body(confirmOverlap) })
      : api('/unit-events', { method: 'POST', json: { unit_number: unit, ...body(confirmOverlap) } }),
    onSuccess: () => onClose(`${maint ? detail : BLOCK_LABEL[kind]} saved for unit ${unit}, ${start} to ${end || 'ongoing'}`),
    onError: (e: ApiError) => {
      if (e.status === 409 && e.body.needsConfirmation) setConflict(e.body.jobs as typeof conflict);
      else setError(e.message);
    },
  });
  const del = useMutation({
    mutationFn: () => api(`/unit-events/${ev!.id}`, { method: 'DELETE' }),
    onSuccess: () => onClose(`Event removed from unit ${unit}`),
    onError: (e: ApiError) => setError(e.message),
  });
  const tone = maint ? 'text-maint' : 'text-status-event';
  const missing = !unit ? 'Pick the unit.' : !start ? 'Enter the start date.' : maint && !end ? 'Enter the end date.' : null;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="ev-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <form className="w-full max-w-lg rounded-xl border border-border bg-surface p-7 shadow-pop" onSubmit={(e) => { e.preventDefault(); setError(null); setConflict(null); if (missing) { setError(missing); return; } save.mutate(false); }}>
        <div className="mb-4 flex items-start gap-3">
          <h2 id="ev-title" className={cx('flex-1 font-display text-xl font-extrabold uppercase', tone)}>{ev ? (maint ? 'Maintenance event' : 'Unit status event') : maint ? 'New maintenance event' : 'New unit status event'}</h2>
          <Button size="sm" variant="ghost" onClick={() => onClose()} aria-label="Close"><X aria-hidden className="size-4" /></Button>
        </div>
        {!maint && <p className="-mt-2 mb-4 text-sm text-text-muted">Days inside this period adjust that unit's utilization calculation.</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id="ev-unit" label="Unit">
              <select id="ev-unit" className={inputClass} value={unit} disabled={!!ev} onChange={(e) => setUnit(e.target.value)} autoFocus={!ev}>
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
          </div>
          <div className="sm:col-span-2">
            {maint ? (
              <Field id="ev-type" label="Maintenance type">
                <select id="ev-type" className={inputClass} value={detail} onChange={(e) => setDetail(e.target.value)}>
                  {MAINTENANCE_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
            ) : (
              <Field id="ev-status" label="Status">
                <select id="ev-status" className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
                  {STATUS_KINDS.map((k) => <option key={k} value={k}>{BLOCK_LABEL[k]}</option>)}
                </select>
              </Field>
            )}
          </div>
          <Field id="ev-start" label="Start date"><input id="ev-start" type="date" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field id="ev-end" label="End date" hint={maint ? undefined : 'Blank = ongoing'}><input id="ev-end" type="date" className={inputClass} value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
          <div className="sm:col-span-2"><Field id="ev-note" label="Notes"><textarea id="ev-note" rows={3} className={cx(inputClass, 'h-auto py-2')} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
        </div>
        {error && <div className="mt-3"><Banner tone="danger">{error}</Banner></div>}
        {conflict && (
          <div className="mt-3">
            <Banner tone="warning">
              Jobs are booked on unit {unit} in that period: {conflict.map((j) => `${j.ticket_no ?? j.well ?? 'job'} (${j.start_date}–${j.end_date})`).join(', ')}. Save the event anyway?
            </Banner>
            <div className="mt-2 flex gap-2"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(true)}>Save anyway</Button><Button variant="ghost" onClick={() => setConflict(null)}>Back</Button></div>
          </div>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {ev && <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>Remove event</Button>}
          <span className="ml-auto flex gap-2">
            <Button onClick={() => onClose()}>Cancel</Button>
            {!conflict && <Button type="submit" variant="primary" size="lg" loading={save.isPending}>Save Event</Button>}
          </span>
        </div>
      </form>
    </div>
  );
}
