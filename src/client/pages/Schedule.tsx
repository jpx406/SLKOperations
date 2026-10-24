import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { canEditField } from '../../shared/fieldPolicy';
import type { JobStatus } from '../../shared/types';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { Banner, Button, EmptyState, Field, PageTitle, Skeleton, cx, inputClass } from '../components/ui';

interface SJob { id: string; ticket_no: string | null; well: string | null; unit_number: string; status: JobStatus; start_date: string; end_date: string; updated_at: string }
interface SEvent { id: string; unit_number: string; kind: string; starts_on: string; ends_on: string; note: string | null }
interface ScheduleData {
  month: string; first: string; last: string;
  units: { unit_number: string; country: string; year: number | null }[];
  jobs: SJob[]; events: SEvent[];
  unscheduled: { id: string; ticket_no: string | null; well: string | null }[];
  retiredUnitJobs: { id: string; ticket_no: string | null; well: string | null; unit_number: string; start_date: string | null }[];
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
  const [showCanceled, setShowCanceled] = useState(false);
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canCreate = !!me?.menus.jobs?.edit;
  const canMove = !!me?.menus.schedule?.edit && !!me && canEditField(me.role, 'unit_number') && canEditField(me.role, 'start_date');
  const canBlock = !!me?.menus.schedule?.edit;
  const key = ['schedule', month, showCanceled];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<ScheduleData>(`/schedule?month=${month}${showCanceled ? '&canceled=1' : ''}`),
    refetchInterval: 30_000,
  });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pending, setPending] = useState<{ id: string; t: Target } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [blockDialog, setBlockDialog] = useState<{ event?: SEvent; unit?: string } | null>(null);
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
    }
    if (t) { e.preventDefault(); move.mutate({ job, t }); }
  };

  return (
    <section aria-labelledby="sched-title">
      <PageTitle aside={
        <>
          <Button size="sm" onClick={() => setParams({ month: shiftMonth(month, -1) })} aria-label="Previous month"><ChevronLeft aria-hidden className="size-4" /></Button>
          <span className="min-w-36 text-center font-mono text-sm font-semibold" aria-live="polite">{monthLabel}</span>
          <Button size="sm" onClick={() => setParams({ month: shiftMonth(month, 1) })} aria-label="Next month"><ChevronRight aria-hidden className="size-4" /></Button>
          <Button size="sm" onClick={() => setParams({})}>Today</Button>
          {canBlock && <Button size="sm" onClick={() => setBlockDialog({})}><Plus aria-hidden className="size-4" />Unit block</Button>}
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

      <p aria-live="polite" className="sr-only">{live}</p>
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
        <div className="mb-3">
          <Banner tone="warning">
            {q.data.unscheduled.length} job{q.data.unscheduled.length === 1 ? ' has' : 's have'} no unit or start date and {q.data.unscheduled.length === 1 ? "isn't" : "aren't"} on the schedule:{' '}
            {q.data.unscheduled.slice(0, 5).map((j, i) => <span key={j.id}>{i > 0 && ', '}<Link className="font-semibold underline" to={`/operation/jobs/${j.id}/design`}>{j.ticket_no ?? j.well ?? 'untitled job'}</Link></span>)}
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
          <div ref={gridRef} role="grid" aria-label={`Unit schedule, ${monthLabel}`} className={cx('grid w-full', drag && 'cursor-grabbing select-none')}
            style={{ gridTemplateColumns: `calc(var(--spacing) * 36) repeat(${days.length}, minmax(0, 1fr))`, minWidth: `calc(var(--spacing) * (36 + ${days.length} * 9))` }}>
            <div role="row" className="contents">
              <div role="columnheader" className="label-caps sticky left-0 z-10 border-r border-b border-border bg-surface-2 px-3 py-2 text-text-muted">Unit</div>
              {days.map((d) => (
                <div role="columnheader" key={d.day} aria-label={d.iso}
                  className={cx('border-b border-border py-1 text-center font-mono text-xs text-text-muted', d.weekend && 'bg-surface-2', d.iso === today && 'text-text shadow-[inset_0_-2px_0_var(--color-accent)]')}>
                  <div>{d.weekday}</div><div>{d.day}</div>
                </div>
              ))}
            </div>
            {q.data.units.map((u) => {
              const bars = lanes([
                ...q.data.jobs.map(placed).filter((j) => j.unit_number === u.unit_number && j.end_date >= q.data.first && j.start_date <= q.data.last)
                  .map((j) => ({ kind: 'job' as const, job: j, start: col(j.start_date), end: col(j.end_date) })),
                ...q.data.events.filter((e) => e.unit_number === u.unit_number).map((e) => ({ kind: 'block' as const, block: e, start: col(e.starts_on), end: col(e.ends_on) })),
              ]);
              const laneCount = Math.max(1, ...bars.map((b) => b.lane + 1));
              return (
                <div role="row" key={u.unit_number} className="contents">
                  <div role="rowheader" className="sticky left-0 z-10 flex items-baseline gap-2 border-r border-b border-border bg-surface px-3 py-2 whitespace-nowrap">
                    <span className="font-display text-sm font-bold">{u.unit_number}</span>
                    {(me?.countries.length ?? 0) > 1 && <span className="truncate font-mono text-xs text-text-subtle">{u.country}</span>}
                  </div>
                  <div role="gridcell" data-unit={u.unit_number}
                    className={cx('relative grid border-b border-border', drag?.mode === 'move' && drag.moved && drag.unit === u.unit_number && 'bg-surface-2')}
                    style={{ gridColumn: `2 / span ${days.length}`, gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${laneCount}, calc(var(--spacing) * 7))`, rowGap: 'var(--spacing)', paddingBlock: 'var(--spacing)' }}>
                    {days.map((d) => d.weekend && <div key={d.day} aria-hidden className="bg-surface-2" style={{ gridColumn: d.day, gridRow: `1 / span ${laneCount}`, marginBlock: 'calc(var(--spacing) * -1)' }} />)}
                    {bars.map((b) => b.kind === 'job' ? (
                      <a key={b.job.id} href={`/operation/jobs/${b.job.id}/design`}
                        onClick={(e) => e.preventDefault()}
                        onPointerDown={(e) => (canMove ? onPointerDown(e, q.data.jobs.find((j) => j.id === b.job.id)!, 'move') : undefined)}
                        onPointerUp={() => { if (!canMove) navigate(`/operation/jobs/${b.job.id}/design`); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/operation/jobs/${b.job.id}/design`); else onBarKey(e, q.data.jobs.find((j) => j.id === b.job.id)!); }}
                        aria-label={`Job ${b.job.ticket_no ?? 'without ticket'}, ${b.job.well ?? 'no well'}, ${b.job.start_date} to ${b.job.end_date}, ${b.job.status}, unit ${u.unit_number}${canMove ? '. Shift+arrows move a day, Alt+up or down changes unit, [ and ] change the end' : ''}`}
                        className={cx('group relative z-[1] mx-0.5 flex touch-none items-center overflow-hidden rounded-sm border-l-3 px-1.5 font-mono text-xs font-semibold whitespace-nowrap hover:brightness-125',
                          BAR[b.job.status], canMove && 'cursor-grab', (drag?.job.id === b.job.id || pending?.id === b.job.id) && 'opacity-80 shadow-pop')}
                        style={{ gridColumn: `${b.start} / ${b.end + 1}`, gridRow: b.lane + 1 }}>
                        {canMove && <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => onPointerDown(e, q.data.jobs.find((j) => j.id === b.job.id)!, 'start')} />}
                        {b.job.ticket_no ?? 'No ticket'}{b.job.well ? ` · ${b.job.well}` : ''}
                        {canMove && <span aria-hidden className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => onPointerDown(e, q.data.jobs.find((j) => j.id === b.job.id)!, 'end')} />}
                      </a>
                    ) : (
                      <button key={b.block.id} type="button" disabled={!canBlock} onClick={() => setBlockDialog({ event: b.block })}
                        aria-label={`${BLOCK_LABEL[b.block.kind]} on ${u.unit_number}, ${b.block.starts_on} to ${b.block.ends_on}${b.block.note ? `: ${b.block.note}` : ''}`}
                        className="hatch-blocked z-[1] mx-0.5 flex items-center overflow-hidden rounded-sm border-l-3 border-blocked px-1.5 text-left font-mono text-xs text-blocked disabled:cursor-default"
                        style={{ gridColumn: `${b.start} / ${b.end + 1}`, gridRow: b.lane + 1 }}>
                        {BLOCK_LABEL[b.block.kind] ?? b.block.kind}
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
        Units come from WIREGUARD. {canMove ? 'Drag a bar to another day or unit, or drag its ends to change the dates. Click to open the job.' : 'Click a bar to open the job.'}
      </p>
      {blockDialog && <BlockDialog init={blockDialog} units={unitsList} onClose={(msg) => { setBlockDialog(null); if (msg) { setNotice({ tone: 'success', text: msg }); qc.invalidateQueries({ queryKey: ['schedule'] }); } }} />}
    </section>
  );
}

function BlockDialog({ init, units, onClose }: { init: { event?: SEvent; unit?: string }; units: string[]; onClose: (msg?: string) => void }) {
  const ev = init.event;
  const [unit, setUnit] = useState(ev?.unit_number ?? init.unit ?? '');
  const [kind, setKind] = useState(ev?.kind ?? 'maintenance');
  const [start, setStart] = useState(ev?.starts_on ?? '');
  const [end, setEnd] = useState(ev?.ends_on ?? '');
  const [note, setNote] = useState(ev?.note ?? '');
  const [conflict, setConflict] = useState<{ ticket_no: string | null; well: string | null; start_date: string; end_date: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (confirmOverlap: boolean) => ev
      ? api(`/unit-events/${ev.id}`, { method: 'PATCH', json: { kind, starts_on: start, ends_on: end, note, confirmOverlap } })
      : api('/unit-events', { method: 'POST', json: { unit_number: unit, kind, starts_on: start, ends_on: end, note, confirmOverlap } }),
    onSuccess: () => onClose(`${BLOCK_LABEL[kind]} saved for ${unit}, ${start} to ${end}`),
    onError: (e: ApiError) => {
      if (e.status === 409 && e.body.needsConfirmation) setConflict(e.body.jobs as typeof conflict);
      else setError(e.message);
    },
  });
  const del = useMutation({
    mutationFn: () => api(`/unit-events/${ev!.id}`, { method: 'DELETE' }),
    onSuccess: () => onClose(`Block removed from ${unit}`),
    onError: (e: ApiError) => setError(e.message),
  });
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="block-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <form className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-pop" onSubmit={(e) => { e.preventDefault(); setError(null); setConflict(null); save.mutate(false); }}>
        <div className="mb-4 flex items-start gap-3">
          <h2 id="block-title" className="flex-1 font-display text-lg font-bold">{ev ? 'Unit block' : 'New unit block'}</h2>
          <Button size="sm" variant="ghost" onClick={() => onClose()} aria-label="Close"><X aria-hidden className="size-4" /></Button>
        </div>
        <p className="mb-4 text-sm text-text-muted">Blocked days can't be booked, and they don't count as available days in utilization. "Backup on site" marks the unit without blocking it.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="b-unit" label="Unit">
            <select id="b-unit" className={inputClass} value={unit} disabled={!!ev} onChange={(e) => setUnit(e.target.value)} autoFocus={!ev}>
              <option value="">Choose…</option>{units.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
          <Field id="b-kind" label="Kind">
            <select id="b-kind" className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(BLOCK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field id="b-start" label="First day"><input id="b-start" type="date" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field id="b-end" label="Last day"><input id="b-end" type="date" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <div className="sm:col-span-2"><Field id="b-note" label="Note"><input id="b-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Drum change, lubricator test" /></Field></div>
        </div>
        {error && <div className="mt-3"><Banner tone="danger">{error}</Banner></div>}
        {conflict && (
          <div className="mt-3">
            <Banner tone="warning">
              Jobs are booked on {unit} in that period: {conflict.map((j) => `${j.ticket_no ?? j.well ?? 'job'} (${j.start_date}–${j.end_date})`).join(', ')}. Save the block anyway?
            </Banner>
            <div className="mt-2 flex gap-2"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(true)}>Save anyway</Button><Button variant="ghost" onClick={() => setConflict(null)}>Back</Button></div>
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          {!conflict && <Button type="submit" variant="primary" loading={save.isPending} disabled={!unit || !start || !end}>Save</Button>}
          <Button variant="ghost" onClick={() => onClose()}>Cancel</Button>
          {ev && <Button variant="danger" className="ml-auto" loading={del.isPending} onClick={() => del.mutate()}>Remove block</Button>}
        </div>
      </form>
    </div>
  );
}
