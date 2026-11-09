import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, FileDown, Plus, Search, Send, ShieldCheck, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  CONNECTIONS, FAMILY_OF, FORM, SHEET_STYLES, MAX_ROWS, PART_KINDS, RATINGS, crossoverFor, diagramChecks, drawPart, insertIndex, joints, kindsOf, rigTotals, rowFromPart,
  layoutStack, pictureFor, stringTotals, type DiagramKind, type DiagramStatus, type Family, type Part, type PartKind, type Prim, type Row, type SheetStyle,
} from '../../shared/diagram';
import type { ToolPart } from '../../shared/toolstring';
import { ApiError, api, countryScope, formatDate } from '../api';
import { Select } from '../components/Select';
import { Banner, Button, Card, Skeleton, cx, inputClass, inputSized } from '../components/ui';

// Rig Up (QAF14009) and tool string (QAF14010) diagrams of a job, opened from Preparation. The sheet in the middle is
// the printout; the catalogue adds parts where they belong in the stack; the right side edits a row and shows the checks.

interface Diagram {
  id: string; kind: DiagramKind; run_no: number; items: Row[]; rev: number; pdf_rev: number | null; pdf_at: string | null; pdf_by_name: string | null;
  status: DiagramStatus; sent_by_name: string | null; sent_at: string | null; verified_by_name: string | null; verified_at: string | null; reviewed_by_name: string | null; reviewed_at: string | null;
  updated_by_name: string | null; updated_at: string;
}
interface JobFacts {
  id: string; ticket_no: string | null; drss_no: string | null; well: string | null; field: string | null; rig: string | null; unit_number: string | null; start_date: string | null;
  sdm_username: string | null; sdm_name: string | null; siwhp_psi: number | null; h2s_ppm: number | null; min_restriction_in: number | null;
  wire_serial_number: string | null; wire_in: number | null; target_depth_ft: number | null;
}
interface Data { job: JobFacts; rigup: Diagram | null; toolstrings: Diagram[]; legacy_toolstring: ToolPart[]; canEdit: boolean; canReview: boolean }

const STATUS: Record<DiagramStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-neutral-subtle text-neutral' },
  sent: { label: 'Waiting for SDM review', cls: 'bg-warning-subtle text-warning' },
  reviewed: { label: 'Approved by the SDM', cls: 'bg-success-subtle text-success' },
};
const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const fmt = (n: number | null | undefined, d = 2) => (n == null ? '—' : n.toFixed(d));
const readUnit = () => { try { return localStorage.getItem('slk-diagram-unit') === 'm' ? 'm' : 'ft'; } catch { return 'ft'; } };
const readStyle = (): SheetStyle => { try { return localStorage.getItem('slk-diagram-style') === 'data' ? 'data' : 'sheet'; } catch { return 'sheet'; } };

/** The old Preparation toolstring components, mapped to part types, for "Start from the Preparation toolstring". */
const LEGACY_KIND: Record<string, PartKind> = {
  'rope socket': 'rope_socket', stem: 'stem', 'knuckle joint': 'knuckle', 'spang jar': 'jar_mech', 'hydraulic jar': 'jar_hyd', 'tubular jar': 'jar_tubular',
  accelerator: 'accelerator', 'running tool': 'pulling_tool', 'pulling tool': 'pulling_tool', 'gauge cutter': 'gauge_cutter', bailer: 'bailer', 'lead impression block': 'impression_block',
};
const fromLegacy = (p: ToolPart): Row => ({
  part_id: null, kind: LEGACY_KIND[p.component.toLowerCase()] ?? 'service_tool', name: p.component, rating_psi: null, service: null, id_in: null,
  od_in: p.od_in ?? null, fn_in: null, fn_lower_in: null, top_conn: null, bottom_conn: null, length_ft: p.length_ft ?? null, weight_lb: p.weight_lb ?? null, stroke_ft: null, rams: null,
});

export function Diagrams() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['diagrams', id], queryFn: () => api<Data>(`/diagrams/${id}`) });
  const parts = useQuery({ queryKey: ['parts'], queryFn: () => api<Part[]>('/diagrams/parts'), staleTime: 5 * 60_000 });

  const d = params.get('d') ?? 'rigup';
  const kind: DiagramKind = d === 'rigup' ? 'rigup' : 'toolstring';
  const run = kind === 'rigup' ? 0 : Math.max(1, Number(d.replace('run-', '')) || 1);
  const family = FAMILY_OF[kind];
  const saved = data.data ? (kind === 'rigup' ? data.data.rigup : data.data.toolstrings.find((t) => t.run_no === run) ?? null) : null;

  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [history, setHistory] = useState<Row[][]>([]);
  const [unit, setUnit] = useState<'ft' | 'm'>(readUnit);
  const [style, setStyle] = useState<SheetStyle>(readStyle);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const stamp_ = useRef<string | null>(null);
  const loadedFor = useRef('');

  // load the diagram when the tab or the data changes, unless there are unsaved edits for this tab
  useEffect(() => {
    if (!data.data) return;
    const key = `${kind}-${run}`;
    if (loadedFor.current === key && dirty) return;
    setRows(saved?.items ?? []);
    stamp_.current = saved?.updated_at ?? null;
    if (loadedFor.current !== key) { setSel(null); setHistory([]); }
    loadedFor.current = key;
  }, [data.data, kind, run]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (items: Row[]) => api<{ diagram: Diagram }>(`/diagrams/${id}/${kind}/${run}`, { method: 'PUT', json: { items, updated_at: stamp_.current } }),
    onSuccess: (r) => {
      stamp_.current = r.diagram.updated_at;
      setDirty(false);
      qc.setQueryData<Data>(['diagrams', id], (old) => old && (kind === 'rigup'
        ? { ...old, rigup: r.diagram }
        : { ...old, toolstrings: [...old.toolstrings.filter((t) => t.run_no !== run), r.diagram].sort((a, b) => a.run_no - b.run_no) }));
      qc.invalidateQueries({ queryKey: ['job', id] });
    },
    onError: (e: ApiError) => setError(e.message),
  });
  const timer = useRef<number | undefined>(undefined);
  const change = (next: Row[], keepSel?: number | null) => {
    if (!data.data?.canEdit) return;
    setHistory((h) => [...h.slice(-49), rows]);
    setRows(next);
    if (keepSel !== undefined) setSel(keepSel);
    setDirty(true); setError(null); setNotice(null);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save.mutate(next), 600);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const undo = () => { const prev = history[history.length - 1]; if (!prev) return; setHistory((h) => h.slice(0, -1)); setRows(prev); setSel(null); setDirty(true); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => save.mutate(prev), 300); };

  const act = useMutation({
    mutationFn: (action: 'send' | 'verify' | 'review' | 'reopen') =>
      api<{ ok: boolean; pdf?: string | null; pdf_error?: string }>(`/diagrams/${id}/${kind}/${run}/${action}${action === 'review' ? `?style=${style}` : ''}`, { method: 'POST' }),
    onSuccess: (r, action) => {
      setNotice(action === 'send' ? `Sent to ${data.data?.job.sdm_name ?? 'the SDM'} for review.` : action === 'verify' ? 'Verified. The SDM can approve it now.' : action === 'review' ? `Approved.${r.pdf ? ` The PDF is filed with the job: ${r.pdf}` : ''}${r.pdf_error ? ` The PDF could not be filed: ${r.pdf_error}` : ''}` : 'Back to draft.');
      qc.invalidateQueries({ queryKey: ['diagrams', id] });
    },
    onError: (e: ApiError) => setError(e.message),
  });
  const removeRun = useMutation({
    mutationFn: () => api(`/diagrams/${id}/toolstring/${run}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['diagrams', id] }); setParams({ d: run > 1 ? `run-${run - 1}` : 'rigup' }, { replace: true }); },
    onError: (e: ApiError) => setError(e.message),
  });
  const [pdfBusy, setPdfBusy] = useState(false);
  const makePdf = async () => {
    if (dirty) { window.clearTimeout(timer.current); await save.mutateAsync(rows); }
    setPdfBusy(true); setError(null);
    const w = window.open('', '_blank');
    try {
      const res = await fetch(`/api/diagrams/${id}/${kind}/${run}/pdf?style=${style}`, { method: 'POST', credentials: 'same-origin', headers: countryScope() ? { 'X-SLK-Country': countryScope()! } : {} });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `PDF failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      if (w) w.location.href = url; else window.location.href = url;
      const fileErr = res.headers.get('X-File-Error');
      setNotice(res.headers.get('X-Filed') === 'yes' ? `PDF made and filed with the job as Rev ${saved?.rev ?? 0}. The next change makes Rev ${(saved?.rev ?? 0) + 1}.` : fileErr ? `PDF made, but not filed: ${decodeURIComponent(fileErr)}` : 'PDF made (this revision is already filed).');
      qc.invalidateQueries({ queryKey: ['diagrams', id] });
    } catch (e) { w?.close(); setError((e as Error).message); } finally { setPdfBusy(false); }
  };

  const job = data.data?.job;
  const others = data.data?.toolstrings ?? [];
  const well = { mpwhp_psi: job?.siwhp_psi ?? null, h2s_ppm: job?.h2s_ppm ?? null, min_id_in: job?.min_restriction_in ?? null, wire_in: job?.wire_in ?? null };
  const rigRows = kind === 'rigup' ? rows : data.data?.rigup?.items ?? null;
  const stringRows = kind === 'toolstring' ? [rows, ...others.filter((t) => t.run_no !== run).map((t) => t.items)] : others.map((t) => t.items);
  const checks = useMemo(() => diagramChecks(kind, rigRows, stringRows, well), [kind, rigRows, stringRows, well.mpwhp_psi, well.h2s_ppm, well.min_id_in, well.wire_in]); // eslint-disable-line react-hooks/exhaustive-deps

  const canEdit = !!data.data?.canEdit;
  const addPart = (r: Row, at?: number) => {
    if (rows.length >= MAX_ROWS) { setError(`A diagram has at most ${MAX_ROWS} parts`); return; }
    const i = at ?? insertIndex(rows, r.kind);
    change([...rows.slice(0, i), r, ...rows.slice(i)], i);
  };
  const move = (i: number, by: number) => { const j = i + by; if (j < 0 || j >= rows.length) return; const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; change(n, j); };
  const tabs: { key: string; label: string; sub: string; status: DiagramStatus | undefined }[] = [{ key: 'rigup', label: 'Rig up', sub: FORM.rigup.code, status: data.data?.rigup?.status }, ...others.map((t) => ({ key: `run-${t.run_no}`, label: `Run ${t.run_no}`, sub: FORM.toolstring.code, status: t.status as DiagramStatus | undefined }))];
  if (kind === 'toolstring' && !saved) tabs.push({ key: `run-${run}`, label: `Run ${run}`, sub: 'new', status: undefined });
  const nextRun = Math.max(0, ...others.map((t) => t.run_no), kind === 'toolstring' && !saved ? run : 0) + 1;

  if (data.isPending) return <Skeleton className="h-[70vh]" />;
  if (data.isError) return <Banner tone="danger" action={<Link className="underline" to="/operation/jobs">Back to jobs</Link>}>{data.error.message}</Banner>;
  const st = saved?.status ?? 'draft';

  return (
    <section aria-labelledby="dg-title" className="-mx-1">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link to={`/operation/jobs/${id}/preparation`} className="inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-xs font-semibold hover:bg-surface-3">
          <ArrowLeft aria-hidden className="size-3.5" />Preparation
        </Link>
        <h1 id="dg-title" className="font-display text-xl font-bold">Rig up and tool string diagrams</h1>
        <span className="text-sm text-text-muted">{[job?.ticket_no, job?.well, job?.rig].filter(Boolean).join(' · ')}</span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2">
        <div role="tablist" aria-label="Diagrams" className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={d === t.key || (t.key === 'rigup' && kind === 'rigup')} onClick={() => setParams({ d: t.key }, { replace: true })}
              className={cx('flex h-(--layout-control-sm) items-center gap-2 rounded-md px-3 text-sm font-semibold', (d === t.key || (t.key === 'rigup' && kind === 'rigup')) ? 'bg-surface-3 text-text shadow-[inset_0_-2px_var(--color-accent-edge)]' : 'text-text-muted hover:text-text')}>
              {t.label}<span className="font-mono text-[0.6875rem] font-medium text-text-subtle">{t.sub}</span>
              {t.status && t.status !== 'draft' && <span aria-label={STATUS[t.status].label} className={cx('size-2 rounded-full', t.status === 'reviewed' ? 'bg-success' : 'bg-warning')} />}
            </button>
          ))}
          {canEdit && nextRun <= 20 && <Button size="sm" variant="ghost" onClick={() => setParams({ d: `run-${nextRun}` }, { replace: true })}><Plus aria-hidden className="size-3.5" />Run {nextRun}</Button>}
        </div>
        <span className="flex-1" />
        {canEdit && <StartFrom jobId={id} kind={kind} run={run} rows={rows} parts={parts.data ?? []} others={others} legacy={data.data!.legacy_toolstring} onPick={(r) => change(r, null)} />}
        <Button size="sm" variant="ghost" onClick={undo} disabled={!history.length || !canEdit} aria-label="Undo (Ctrl+Z)"><Undo2 aria-hidden className="size-3.5" />Undo</Button>
        <div role="group" aria-label="Units" className="flex rounded-md border border-border-strong p-0.5">
          {(['ft', 'm'] as const).map((u) => (
            <button key={u} aria-pressed={unit === u} onClick={() => { setUnit(u); try { localStorage.setItem('slk-diagram-unit', u); } catch { /* not kept */ } }}
              className={cx('h-7 rounded px-2.5 text-xs font-semibold', unit === u ? 'bg-surface-3 text-text' : 'text-text-muted')}>{u}</button>
          ))}
        </div>
        <span aria-live="polite" className="min-w-24 text-right text-xs text-text-muted">{save.isPending ? 'Saving…' : dirty ? 'Unsaved' : saved ? `Saved · Rev ${saved.rev}` : 'Not started'}</span>
        <label className="sr-only" htmlFor="dg-style">PDF layout</label>
        <Select id="dg-style" className={inputSized('h-(--layout-control-sm) w-40 text-xs')} value={style}
          onChange={(e) => { const v = e.target.value as SheetStyle; setStyle(v); try { localStorage.setItem('slk-diagram-style', v); } catch { /* not kept */ } }}>
          {(Object.keys(SHEET_STYLES) as SheetStyle[]).map((k) => <option key={k} value={k}>{SHEET_STYLES[k]}</option>)}
        </Select>
        <Button size="sm" onClick={makePdf} loading={pdfBusy} disabled={!rows.length}><FileDown aria-hidden className="size-3.5" />PDF</Button>
      </div>

      {error && <div className="mb-3"><Banner tone="danger" action={/since you opened/.test(error) ? <Button size="sm" onClick={() => { setDirty(false); loadedFor.current = ''; setError(null); qc.invalidateQueries({ queryKey: ['diagrams', id] }); }}>Load their version</Button> : undefined}>{error}</Banner></div>}
      {notice && <div className="mb-3"><Banner tone="success">{notice}</Banner></div>}
      {!canEdit && <div className="mb-3"><Banner tone="info">You can view the diagrams. Your role does not edit Preparation.</Banner></div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[14rem_minmax(0,1fr)_18rem]">
        <div className="order-2 xl:order-1">
          <Catalogue family={family} parts={parts.data ?? []} loading={parts.isPending} canEdit={canEdit} well={well} onAdd={(p) => addPart(rowFromPart(p))} />
        </div>
        <div className="order-1 min-w-0 xl:order-2">
          <Sheet kind={kind} run={run} rows={rows} sel={sel} unit={unit} job={job!} rev={saved?.rev ?? 0} diagram={saved} canEdit={canEdit}
            onSelect={setSel} onMove={move} onChange={change} onDropPart={(id_, at) => { const p = parts.data?.find((x) => x.id === id_); if (p) addPart(rowFromPart(p), at); }} />
        </div>
        <div className="order-3 space-y-4">
          {sel != null && rows[sel] ? (
            <RowEditor key={`${kind}-${run}-${sel}`} family={family} row={rows[sel]} index={sel} canEdit={canEdit}
              onChange={(r) => change(rows.map((x, i) => (i === sel ? r : x)), sel)} onClose={() => setSel(null)} />
          ) : (
            <Totals kind={kind} rows={rows} unit={unit} />
          )}
          <Card className="p-4">
            <h2 className="label-caps mb-2 flex items-center justify-between text-text-muted">Checks
              {(() => { const bad = checks.filter((c) => c.level === 'danger').length, warn = checks.filter((c) => c.level === 'warning').length;
                return <span className={cx('rounded-pill px-2 py-0.5 font-mono normal-case', bad ? 'bg-danger-subtle text-danger' : warn ? 'bg-warning-subtle text-warning' : 'bg-success-subtle text-success')}>{bad ? `${bad} to fix` : warn ? `${warn} to review` : 'All clear'}</span>; })()}
            </h2>
            <ul className="space-y-1.5" aria-live="polite">
              {checks.map((c) => (
                <li key={c.text} className={cx('grid grid-cols-[1rem_1fr] gap-2 rounded-md px-2.5 py-2 text-xs', c.level === 'ok' ? 'bg-success-subtle' : c.level === 'warning' ? 'bg-warning-subtle' : 'bg-danger-subtle')}>
                  <span aria-hidden className={cx('font-bold', c.level === 'ok' ? 'text-success' : c.level === 'warning' ? 'text-warning' : 'text-danger')}>{c.level === 'ok' ? '✓' : c.level === 'warning' ? '!' : '✕'}</span>
                  <span><span className="sr-only">{c.level === 'ok' ? 'Pass: ' : c.level === 'warning' ? 'Review: ' : 'Fix: '}</span>{c.text}<span className="mt-0.5 block text-text-subtle">{c.cite}</span></span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-text-subtle">From Preparation: SIWHP {job?.siwhp_psi ?? '—'} psi · H₂S {job?.h2s_ppm ?? '—'} ppm · min. restriction {job?.min_restriction_in ?? '—'} in · wire {job?.wire_in ?? '—'} in</p>
          </Card>
          <Card className="p-4">
            <h2 className="label-caps mb-2 text-text-muted">Review</h2>
            <p className="mb-2"><span className={cx('label-caps inline-flex h-5.5 items-center rounded-pill px-2', STATUS[st].cls)}>{STATUS[st].label}</span> <span className="font-mono text-xs text-text-muted">Rev {saved?.rev ?? 0}</span></p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-text-muted">SDM</dt><dd>{job?.sdm_name ?? <span className="text-warning">Not set on Design</span>}</dd>
              {saved?.sent_at && <><dt className="text-text-muted">Sent</dt><dd>{saved.sent_by_name} · {stamp(saved.sent_at)}</dd></>}
              {saved?.verified_at && <><dt className="text-text-muted">Verified</dt><dd>{saved.verified_by_name} · {stamp(saved.verified_at)}</dd></>}
              {saved?.reviewed_at && st === 'reviewed' && <><dt className="text-text-muted">Approved</dt><dd>{saved.reviewed_by_name} · {stamp(saved.reviewed_at)}</dd></>}
              {saved?.pdf_at && <><dt className="text-text-muted">Last PDF</dt><dd>Rev {saved.pdf_rev} · {stamp(saved.pdf_at)}</dd></>}
            </dl>
            <p className="mt-2 text-xs text-text-subtle">Starts at Rev 0. After a PDF, the next change makes a new revision and sends it back to draft.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {canEdit && st === 'draft' && <Button size="sm" variant="primary" disabled={!rows.length || dirty} loading={act.isPending} onClick={() => act.mutate('send')}><Send aria-hidden className="size-3.5" />Send for review</Button>}
              {data.data?.canReview && st !== 'reviewed' && <Button size="sm" variant={st === 'sent' ? 'primary' : 'secondary'} disabled={!rows.length || dirty} loading={act.isPending} onClick={() => act.mutate('review')}><ShieldCheck aria-hidden className="size-3.5" />Approve (SDM)</Button>}
              {canEdit && st !== 'reviewed' && saved && !saved.verified_at && <Button size="sm" disabled={!rows.length || dirty} loading={act.isPending} onClick={() => act.mutate('verify')}>Verify</Button>}
              {data.data?.canReview && st !== 'draft' && <Button size="sm" variant="ghost" loading={act.isPending} onClick={() => act.mutate('reopen')}>Back to draft</Button>}
              {canEdit && kind === 'toolstring' && saved && saved.pdf_rev == null && run === Math.max(...others.map((t) => t.run_no)) && (
                <Button size="sm" variant="ghost" className="ml-auto text-danger" loading={removeRun.isPending} onClick={() => removeRun.mutate()}><Trash2 aria-hidden className="size-3.5" />Remove Run {run}</Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

// ---- catalogue ----

function Catalogue({ family, parts, loading, canEdit, well, onAdd }: {
  family: Family; parts: Part[]; loading: boolean; canEdit: boolean; well: { mpwhp_psi: number | null; h2s_ppm: number | null; min_id_in: number | null }; onAdd: (p: Part) => void;
}) {
  const [q, setQ] = useState('');
  const [fitOnly, setFitOnly] = useState(true);
  const fits = (p: Part) => family === 'pce'
    ? p.kind === 'tree' || ((well.mpwhp_psi == null || p.rating_psi == null || p.rating_psi >= well.mpwhp_psi * 1.2) && (!(well.h2s_ppm ?? 0) || p.service === 'h2s'))
    : well.min_id_in == null || p.od_in == null || p.od_in < well.min_id_in;
  const list = parts.filter((p) => p.family === family && (!q || `${p.name} ${p.top_conn ?? ''} ${p.bottom_conn ?? ''} ${PART_KINDS[p.kind]?.label ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const groups = kindsOf(family).map((k) => [k, list.filter((p) => p.kind === k)] as const).filter(([, l]) => l.length);
  return (
    <Card className="p-3 xl:sticky xl:top-3 xl:max-h-[calc(100dvh-1.5rem)] xl:overflow-y-auto">
      <h2 className="label-caps mb-2 text-text-muted">{family === 'pce' ? 'Pressure control parts' : 'Tool string parts'}</h2>
      <label className="relative block">
        <span className="sr-only">Search the catalogue</span>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle" />
        <input type="search" className={cx(inputClass, 'pl-8')} placeholder="Search parts, connections…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <label className="mt-2 flex items-center gap-2 text-xs text-text-muted"><input type="checkbox" checked={fitOnly} onChange={(e) => setFitOnly(e.target.checked)} />Grey out parts that don't fit this job</label>
      {loading && <Skeleton className="mt-3 h-64" />}
      {!loading && !groups.length && <p className="mt-3 text-sm text-text-muted">No parts{q ? ' match' : ' yet'}. The catalogue is kept in Database → Parts catalogue.</p>}
      {groups.map(([k, l]) => (
        <div key={k} className="mt-3">
          <h3 className="label-caps mb-1 text-text-subtle">{PART_KINDS[k].label}</h3>
          <ul className="space-y-0.5">
            {l.map((p) => {
              const ok = fits(p);
              const meta = family === 'pce'
                ? [p.rating_psi && `${p.rating_psi / 1000}K${p.service === 'h2s' ? ' H₂S' : ''}`, p.id_in && `${p.id_in}" ID`, p.length_ft != null && `${p.length_ft} ft`].filter(Boolean).join(' · ')
                : [p.od_in && `OD ${p.od_in}"`, p.length_ft != null && `${p.length_ft} ft`, p.weight_lb != null && `${p.weight_lb} lb`].filter(Boolean).join(' · ');
              return (
                <li key={p.id}>
                  <button type="button" disabled={!canEdit} draggable={canEdit} onDragStart={(e) => { e.dataTransfer.setData('text/x-part', p.id); e.dataTransfer.effectAllowed = 'copy'; }}
                    onClick={() => onAdd(p)} title={ok ? 'Add to the diagram' : 'Does not fit this job’s pressure, H₂S or restriction'}
                    className={cx('group grid w-full grid-cols-[2rem_1fr_auto] items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-2 disabled:cursor-default', fitOnly && !ok && 'opacity-45')}>
                    <PartIcon row={rowFromPart(p)} family={family} />
                    <span className="min-w-0"><span className="block text-[0.8125rem] leading-tight font-semibold">{p.name}</span><span className="block font-mono text-[0.6875rem] text-text-muted">{meta || 'sizes not filled in'}</span></span>
                    {canEdit && <Plus aria-hidden className="size-4 text-accent-text opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </Card>
  );
}

function Svg({ prims, w, h, className }: { prims: Prim[]; w: number; h: number; className?: string }) {
  return <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden preserveAspectRatio="xMidYMid meet"><Shapes prims={prims} /></svg>;
}
function Shapes({ prims }: { prims: Prim[] }) {
  return (
    <g pointerEvents="none" shapeRendering="geometricPrecision">
      {prims.map((p, i) => p.t === 'rect' ? <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.fill ?? 'none'} stroke={p.outline ? '#3b434d' : 'none'} strokeWidth={0.6} />
        : p.t === 'poly' ? <polygon key={i} points={p.pts.map((x) => x.join(',')).join(' ')} fill={p.fill} stroke="#3b434d" strokeWidth={0.6} />
        : p.t === 'circle' ? <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={p.fill ?? 'none'} stroke={p.stroke} strokeWidth={0.8} />
        : p.t === 'image' ? <image key={i} href={`/diagram-parts/${p.key}.png`} x={p.x} y={p.y} width={p.w} height={p.h} preserveAspectRatio="none" />
        : p.t === 'text' ? <text key={i} x={p.x} y={p.y} fontSize={p.size} textAnchor="middle" dominantBaseline="central" fontFamily="Inter, sans-serif" fontWeight={700} fill="#1b2430">{p.s}</text>
        : <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.stroke} strokeWidth={p.width} />)}
    </g>
  );
}
/**
 * The assembly, as on the engineering sheet: the whole stack at one scale, the running length at each joint on the
 * left (the drawing is not to length scale, so the scale labels the joints) and numbered balloons on the right.
 * Clicking a part or its balloon selects the row.
 */
function Assembly({ rows, family, sel, onSelect }: { rows: Row[]; family: Family; sel: number | null; onSelect: (i: number | null) => void }) {
  // drawn at the column's real size, so the stack fills the height beside the parts list
  const box = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 150, h: 520 });
  useEffect(() => {
    const el = box.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { const { width, height } = e.contentRect; if (width > 0 && height > 0) setSize({ w: Math.round(width), h: Math.round(height) }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = size.w, H = size.h, rulerW = 34, balloonW = 30, top = 18;
  const dw = W - rulerW - balloonW;
  const { prims, marks, height } = layoutStack(rows, family, dw, H - top - 8);
  const body = prims.slice(0, prims.length - marks.length * 3); // the sheet draws its own balloons
  const ys: number[] = [];
  marks.forEach((m) => { let y = top + (m.y0 + m.y1) / 2; if (ys.length && y - ys[ys.length - 1] < 15) y = ys[ys.length - 1] + 15; ys.push(y); });
  const axis = rulerW + dw / 2, bx = W - 12, rx = rulerW - 6;
  let run = 0;
  const joints = marks.map((m, i) => { const at = run; run += rows[i].length_ft ?? 0; return { y: top + m.y0, at }; });
  const pick = (i: number) => onSelect(sel === i ? null : i);
  return (
    <svg ref={box} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMin meet" role="img" aria-label="Assembly drawing, top of the stack first">
      <g transform={`translate(${rulerW} ${top})`}>
        {marks.map((m) => <rect key={m.index} x={-rulerW} y={m.y0} width={W} height={m.y1 - m.y0} fill={sel === m.index ? '#e8eef5' : 'transparent'} className="cursor-pointer" onClick={() => pick(m.index)} />)}
        <Shapes prims={body} />
      </g>
      {marks.length > 0 && <>
        <text x={2} y={9} fontSize={7} fontStyle="italic" fill="#6b7480">ft from top · not to scale</text>
        <line x1={rx} y1={top} x2={rx} y2={top + height} stroke="#15191e" strokeWidth={0.7} />
        {[...joints, { y: top + height, at: run }].map((j, i) => (
          <g key={i}><line x1={rx - 4} y1={j.y} x2={rx + 4} y2={j.y} stroke="#15191e" strokeWidth={0.5} />
            <text x={rx - 6} y={j.y + 2.5} fontSize={7} textAnchor="end" fill="#4f5761" fontFamily="Inter, sans-serif">{j.at.toFixed(1)}</text></g>
        ))}
      </>}
      {marks.map((m, i) => {
        const py = top + (m.y0 + m.y1) / 2, by = ys[i];
        return (
          <g key={m.index} className="cursor-pointer" onClick={() => pick(m.index)}>
            <polyline points={`${axis + 5},${py} ${bx - 14},${py} ${bx - 8},${by}`} fill="none" stroke="#15191e" strokeWidth={0.45} />
            <circle cx={bx} cy={by} r={7} fill={sel === m.index ? '#15191e' : '#ffffff'} stroke="#15191e" strokeWidth={0.8} />
            <text x={bx} y={by + 2.6} fontSize={7.5} fontWeight={700} textAnchor="middle" fill={sel === m.index ? '#ffffff' : '#15191e'} fontFamily="Inter, sans-serif">{i + 1}</text>
          </g>
        );
      })}
    </svg>
  );
}
const PartIcon = ({ row, family }: { row: Row; family: Family }) => {
  const pic = family === 'pce' ? pictureFor(row) : null;
  return (
    <span className="flex h-10 w-8 items-center justify-center rounded-sm bg-[#ffffff]">
      {pic ? <img src={`/diagram-parts/${pic}.png`} alt="" className="max-h-9 max-w-7 object-contain" /> : <Svg prims={drawPart(row, family, 60, 90)} w={60} h={90} className="h-9 w-8" />}
    </span>
  );
};

// ---- the sheet: the engineering drawing sheet the PDF prints (owner request 2026-11-09) ----

function Sheet({ kind, run, rows, sel, unit, job, rev, diagram, canEdit, onSelect, onMove, onChange, onDropPart }: {
  kind: DiagramKind; run: number; rows: Row[]; sel: number | null; unit: 'ft' | 'm'; job: JobFacts; rev: number; diagram: Diagram | null; canEdit: boolean;
  onSelect: (i: number | null) => void; onMove: (i: number, by: number) => void; onChange: (rows: Row[], sel?: number | null) => void; onDropPart: (partId: string, at: number) => void;
}) {
  const rig = kind === 'rigup', family = FAMILY_OF[kind];
  const J = joints(rows);
  const [over, setOver] = useState<number | null>(null);
  const drag = useRef<number | null>(null);
  const L = (n: number | null) => (n == null ? '' : unit === 'ft' ? `${n.toFixed(2)} ft` : `${(n * 0.3048).toFixed(2)} m`);
  const L2 = (n: number | null) => (n == null ? '' : unit === 'ft' ? `${(n * 0.3048).toFixed(2)} m` : `${n.toFixed(2)} ft`);
  const conn = (c: string | null, bad: boolean) => {
    if (!c) return <span className="block text-[#9aa4b1]">—</span>;
    const m = /^(.*?)\s*(\(.+\).*)$/.exec(c);
    return <span className={cx('block rounded-xs px-0.5', bad && 'bg-[#fde8e8] font-bold text-[#b4232a]')}>{m ? <>{m[1]} <span className={bad ? '' : 'text-[#6b7480]'}>{m[2]}</span></> : c}</span>;
  };
  const t = rig ? rigTotals(rows) : null, s = rig ? null : stringTotals(rows);
  const drop = (e: DragEvent, at: number) => {
    e.preventDefault(); setOver(null);
    const part = e.dataTransfer.getData('text/x-part');
    if (part) onDropPart(part, at);
    else if (drag.current != null && drag.current !== at) { const n = [...rows]; const [m] = n.splice(drag.current, 1); n.splice(at > drag.current ? at - 1 : at, 0, m); onChange(n, at > drag.current ? at - 1 : at); }
    drag.current = null;
  };
  const key = (e: KeyboardEvent<HTMLTableRowElement>, i: number) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const by = e.key === 'ArrowUp' ? -1 : 1, body = e.currentTarget.parentElement;
      onMove(i, by);
      // the part moved; keep the keyboard on it
      requestAnimationFrame(() => body?.querySelectorAll<HTMLElement>('tr[data-row]')[Math.max(0, Math.min(rows.length - 1, i + by))]?.focus());
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const j = i + (e.key === 'ArrowUp' ? -1 : 1); if (rows[j]) { onSelect(j); (e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('tr[data-row]')[j])?.focus(); } }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) { e.preventDefault(); onChange(rows.filter((_, k) => k !== i), null); }
  };
  const cell = 'border-b border-[#d5dae0] px-1.5 py-1.5 align-middle';
  const num = 'font-mono text-[0.6875rem] leading-snug text-center';
  const dim = 'block text-[0.625rem] text-[#6b7480]';
  const heads = rig ? ['#', 'Description', 'WP', 'OD / ID in', 'Top / bottom conn.', 'Length / wt'] : ['#', 'Description', 'OD / ID in', 'F/N up / low', 'Top / bottom conn.', 'Length / wt'];
  const wt = rig ? rows.filter((r) => r.kind !== 'tree').reduce((a, r) => a + (r.weight_lb ?? 0), 0) : s!.weight_lb;
  const label = 'block text-[0.5625rem] font-semibold tracking-[0.08em] text-[#4f5761] uppercase';
  const sign = (k: string, who: string | null | undefined, at: string | null | undefined, none: string) => (
    <div className="border-r border-[#15191e] px-2 py-1.5 last:border-r-0"><span className={label}>{k}</span>
      <b className={cx('block text-[0.75rem]', !who && 'font-normal text-[#9aa4b1]')}>{who ?? none}</b>{at && <span className="block text-[0.625rem] text-[#6b7480]">{stamp(at)}</span>}</div>
  );
  const fact = (k: string, v: string | null | undefined, strong = false) => (
    <div className="border-t border-l border-[#15191e] px-2 py-1"><span className={label}>{k}</span><span className={cx('block truncate', strong && 'font-bold')}>{v || '—'}</span></div>
  );
  return (
    <div className="overflow-x-auto rounded-lg bg-surface-3 p-2 sm:p-3" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'z') e.preventDefault(); }}>
      <div className="mx-auto min-w-[38rem] max-w-[60rem] rounded bg-[#ffffff] p-3 text-[0.75rem] text-[#15191e] shadow-pop" style={{ colorScheme: 'light' }}>
        <div className="border-[1.5px] border-[#15191e] p-[3px]"><div className="flex flex-col gap-3 border-[0.5px] border-[#15191e] p-3">
          <div className={cx('grid gap-3', rig ? 'grid-cols-[9.5rem_minmax(0,1fr)]' : 'grid-cols-[7.5rem_minmax(0,1fr)]')}>
            <div className="flex flex-col border-r border-[#9aa3ad] pr-2">
              <p className="mb-1 text-[0.625rem] font-bold tracking-[0.12em] text-[#3b434d]">{rig ? 'ASSEMBLY' : 'SCHEMATIC'}</p>
              <div className="relative min-h-[30rem] flex-1">{rows.length > 0 && <Assembly rows={rows} family={family} sel={sel} onSelect={onSelect} />}</div>
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-[0.625rem] font-bold tracking-[0.12em] text-[#3b434d]">{rig ? 'PARTS LIST' : `TOOL STRING · RUN ${run}`}</p>
              <table className="w-full table-fixed border-collapse">
                <caption className="sr-only">{FORM[kind].title}, top of the stack first. Arrow keys move between rows, Alt and an arrow moves a part, Delete removes it.</caption>
                <colgroup><col className="w-7" /><col /><col className="w-[3.25rem]" /><col className="w-[3.5rem]" /><col className="w-[6rem]" /><col className="w-[4.25rem]" /></colgroup>
                <thead>
                  <tr className="text-[0.625rem] leading-tight">{heads.map((h) => <th key={h} scope="col" className="border-t-[1.5px] border-b border-[#15191e] px-1 py-1.5 font-bold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {!rows.length && (
                    <tr onDragOver={(e) => { e.preventDefault(); setOver(0); }} onDrop={(e) => drop(e, 0)}>
                      <td colSpan={6} className={cx('h-40 text-center text-sm text-[#5b6673]', over === 0 && 'bg-[#e8eef5]')}>
                        {canEdit ? <>Add parts from the catalogue, or use <b>Start from</b>.</> : 'No parts yet.'}
                      </td>
                    </tr>
                  )}
                  {rows.map((r, i) => {
                    const topBad = J[i - 1]?.ok === false, botBad = J[i]?.ok === false;
                    return [
                      <tr key={`r${i}`} data-row={i} tabIndex={0} aria-selected={sel === i} draggable={canEdit}
                        onClick={() => onSelect(sel === i ? null : i)} onKeyDown={(e) => key(e, i)}
                        onDragStart={(e) => { drag.current = i; e.dataTransfer.effectAllowed = 'move'; }}
                        onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, i)}
                        className={cx('group cursor-pointer outline-offset-[-2px] hover:bg-[#f3f5f8]', sel === i && 'bg-[#e8eef5] shadow-[inset_3px_0_#15191e]', over === i && '[&>td]:border-t-[3px] [&>td]:border-t-[#15191e]')}>
                        <td className={cx(cell, 'text-center')}><span className={cx('inline-grid size-5 place-items-center rounded-full border border-[#15191e] text-[0.625rem] font-bold', sel === i && 'bg-[#15191e] text-[#ffffff]')}>{i + 1}</span></td>
                        <td className={cx(cell, 'relative leading-tight font-bold')}>{r.name}{r.part_id == null && <span className="ml-1 rounded-xs border border-[#c9d0d8] px-1 text-[0.5625rem] font-normal text-[#6b7480]" title="Not from the catalogue">custom</span>}
                          {canEdit && (
                            <span className="absolute top-0.5 right-0.5 flex gap-0.5 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-aria-selected:opacity-100">
                              {([[ArrowUp, 'Move up', () => onMove(i, -1)], [ArrowDown, 'Move down', () => onMove(i, 1)], [Copy, 'Duplicate', () => onChange([...rows.slice(0, i + 1), { ...r }, ...rows.slice(i + 1)], i + 1)],
                                [X, 'Remove', () => onChange(rows.filter((_, k) => k !== i), null)]] as const).map(([Icon, label_, fn]) => (
                                <button key={label_} type="button" aria-label={`${label_}: row ${i + 1}`} onClick={(e) => { e.stopPropagation(); fn(); }}
                                  className="grid size-6 place-items-center rounded border border-[#c9d0d8] bg-[#ffffff] text-[#45505c] hover:bg-[#e8eef5]"><Icon aria-hidden className="size-3.5" /></button>
                              ))}
                            </span>
                          )}
                        </td>
                        {rig ? <>
                          <td className={cx(cell, num)}>{r.rating_psi ? `${r.rating_psi / 1000}K` : '—'}{r.service === 'h2s' && <span className={dim}>H₂S</span>}</td>
                          <td className={cx(cell, num)}><span className="block">{r.od_in != null ? fmt(r.od_in, 2) : '—'}</span><span className={dim}>{r.id_in != null ? fmt(r.id_in, 3) : 'N/A'}</span></td>
                        </> : <>
                          <td className={cx(cell, num)}><span className="block">{fmt(r.od_in, 3)}</span><span className={dim}>{r.id_in != null ? fmt(r.id_in, 3) : '—'}</span></td>
                          <td className={cx(cell, num)}><span className="block">{fmt(r.fn_in, 3)}</span><span className={dim}>{r.fn_lower_in != null ? fmt(r.fn_lower_in, 3) : '—'}</span></td>
                        </>}
                        <td className={cx(cell, 'font-mono text-[0.625rem] leading-snug')}>{conn(r.top_conn, topBad)}{conn(r.bottom_conn, botBad)}</td>
                        <td className={cx(cell, 'text-right font-mono text-[0.6875rem] leading-snug')}>
                          {r.length_ft == null ? <span className="block text-[#b4232a]">no length</span> : <><span className="block">{L(r.length_ft)}</span><span className={dim}>{L2(r.length_ft)}</span></>}
                          {r.stroke_ft ? <span className={dim}>+{r.stroke_ft} ft open</span> : null}
                          {r.weight_lb != null ? <span className={dim}>{r.weight_lb} lb{rig ? '' : ` · ${(r.weight_lb * 0.4536).toFixed(1)} kg`}</span> : null}
                        </td>
                      </tr>,
                      botBad && (
                        <tr key={`j${i}`}>
                          <td colSpan={6} className="relative h-0 p-0">
                            <span className="absolute -top-3 right-2 z-10 flex items-center gap-2 rounded-pill border border-[#e5a3a6] bg-[#fde8e8] py-0.5 pr-1 pl-2.5 text-[0.6875rem] font-semibold text-[#9c1c22]">
                              {J[i].above} ≠ {J[i].below}
                              {canEdit && <button type="button" onClick={() => onChange([...rows.slice(0, i + 1), crossoverFor(rows[i], rows[i + 1], family), ...rows.slice(i + 1)], i + 1)}
                                className="rounded-pill bg-[#b4232a] px-2 py-0.5 text-[0.6875rem] font-bold text-[#ffffff]">Add crossover</button>}
                            </span>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                  {rows.length > 0 && canEdit && (
                    <tr onDragOver={(e) => { e.preventDefault(); setOver(rows.length); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, rows.length)}>
                      <td colSpan={6} className={cx('h-5', over === rows.length && 'border-t-[3px] border-t-[#15191e]')} />
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-[1.5px] border-[#15191e] font-bold">
                    <td />
                    <td colSpan={3} className="px-1.5 py-1.5 text-[0.6875rem]">
                      {rig ? 'Totals above the tree' : 'Totals · jars open'}
                      <span className="block text-[0.625rem] font-normal text-[#6b7480]">
                        {rig ? `Lubricator ${L(t!.lubricator_ft)} · smallest bore ${t!.min_id_in ?? '—'} in · system WP ${t!.system_wp?.toLocaleString() ?? '—'} psi`
                          : `Closed ${L(s!.length_ft)} · max OD ${fmt(s!.max_od_in, 3)} in${job.target_depth_ft ? ` · total depth MD ${job.target_depth_ft.toLocaleString()} ft` : ''}`}
                      </span>
                    </td>
                    <td />
                    <td className="px-1.5 py-1.5 text-right font-mono text-[0.6875rem]">
                      <span className="block">{L(rig ? t!.length_ft : s!.length_open_ft)}</span><span className={dim}>{L2(rig ? t!.length_ft : s!.length_open_ft)}</span>
                      {wt ? <span className={dim}>{wt} lb{rig ? '' : ` · ${(wt * 0.4536).toFixed(1)} kg`}</span> : null}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* title block */}
          <div className="border-[1.2px] border-[#15191e] text-[0.6875rem]">
            <div className="grid grid-cols-[6rem_repeat(3,minmax(0,1fr))]">
              <div className="row-span-3 grid place-items-center border-[#15191e] p-1.5"><img src="/brand/nesr-dark-160.png" alt="NESR" className="h-9 w-auto" /></div>
              <div className="col-span-2 flex items-center border-l border-[#15191e] px-2 py-1.5 font-display text-[0.95rem] font-extrabold tracking-wide uppercase">
                {rig ? 'Rig up diagram · pressure control' : `Slickline string diagram · BHA · Run ${run}`}
              </div>
              {fact('Form', `${FORM[kind].code}${rig ? '' : ' Rev 2'}`, true)}
              {fact('Client', 'Saudi Aramco')}{fact('Well', job.well)}{fact('Diagram rev', String(rev), true)}
              {fact('Field / Rig', [job.field, job.rig].filter(Boolean).join(' / '))}{fact('Job ref.', [job.ticket_no, job.drss_no].filter(Boolean).join(' / '))}{fact('Date', job.start_date ? formatDate(job.start_date) : null)}
            </div>
            <div className="grid grid-cols-3 border-t border-[#15191e]">
              {sign('Prepared', diagram?.sent_by_name ?? diagram?.updated_by_name, diagram?.sent_at ?? diagram?.updated_at, '—')}
              {sign('Verified', diagram?.verified_at ? diagram.verified_by_name : null, diagram?.verified_at, 'Not verified')}
              {sign('Approved (SDM)', diagram?.status === 'reviewed' ? diagram.reviewed_by_name : null, diagram?.status === 'reviewed' ? diagram.reviewed_at : null, 'Not approved')}
            </div>
          </div>
        </div></div>
      </div>
    </div>
  );
}

// ---- right side ----

function Totals({ kind, rows, unit }: { kind: DiagramKind; rows: Row[]; unit: 'ft' | 'm' }) {
  const L = (n: number | null) => (n == null ? '—' : unit === 'ft' ? `${n.toFixed(2)} ft` : `${(n * 0.3048).toFixed(2)} m`);
  const items: [string, string][] = kind === 'rigup'
    ? (() => { const t = rigTotals(rows); return [['Parts', String(t.parts)], ['Length above the tree', L(t.length_ft)], ['Lubricator', L(t.lubricator_ft)], ['Smallest bore', t.min_id_in != null ? `${t.min_id_in} in` : '—'], ['System working pressure', t.system_wp != null ? `${t.system_wp.toLocaleString()} psi` : '—']] as [string, string][]; })()
    : (() => { const s = stringTotals(rows); return [['Parts', String(s.parts)], ['Length, closed', L(s.length_ft)], ['Length, jars open', L(s.length_open_ft)], ['Widest tool', s.max_od_in != null ? `${s.max_od_in.toFixed(3)} in` : '—'], ['Weight', s.weight_lb != null ? `${s.weight_lb} lb` : '—'], ['Weight above the jar', s.weight_above_jar_lb != null ? `${s.weight_above_jar_lb} lb` : '—']] as [string, string][]; })();
  return (
    <Card className="p-4">
      <h2 className="label-caps mb-2 text-text-muted">{kind === 'rigup' ? 'Rig up' : 'Tool string'}</h2>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">{items.map(([k, v]) => <div key={k} className="contents"><dt className="text-text-muted">{k}</dt><dd className="text-right font-mono text-xs font-semibold">{v}</dd></div>)}</dl>
      <p className="mt-3 text-xs text-text-subtle">Select a row to edit it. Arrow keys move between rows, Alt + arrow moves a part, Delete removes it.</p>
    </Card>
  );
}

function RowEditor({ family, row, index, canEdit, onChange, onClose }: { family: Family; row: Row; index: number; canEdit: boolean; onChange: (r: Row) => void; onClose: () => void }) {
  const set = <K extends keyof Row>(k: K, v: Row[K]) => onChange({ ...row, [k]: v });
  const num = (k: 'rating_psi' | 'id_in' | 'od_in' | 'fn_in' | 'fn_lower_in' | 'length_ft' | 'weight_lb' | 'stroke_ft' | 'rams', label: string, unit?: string, step = 'any') => (
    <label className="grid gap-1 text-xs text-text-muted">{label}{unit && <span className="sr-only"> in {unit}</span>}
      <span className="relative"><input type="number" min={0} step={step} inputMode="decimal" disabled={!canEdit} className={cx(inputClass, unit && 'pr-9')} value={row[k] ?? ''}
        onChange={(e) => set(k, e.target.value === '' ? null : Number(e.target.value))} />{unit && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[0.6875rem] text-text-subtle">{unit}</span>}</span>
    </label>
  );
  const connField = (k: 'top_conn' | 'bottom_conn', label: string) => (
    <label className="grid gap-1 text-xs text-text-muted">{label}
      <input list={`conn-${family}`} disabled={!canEdit} className={inputClass} value={row[k] ?? ''} onChange={(e) => set(k, e.target.value || null)} />
    </label>
  );
  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center justify-between"><span className="label-caps text-text-muted">Row {index + 1}</span><Button size="sm" variant="ghost" onClick={onClose}>Done</Button></h2>
      <datalist id={`conn-${family}`}>{CONNECTIONS[family].map((c) => <option key={c} value={c} />)}</datalist>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <label className="col-span-2 grid gap-1 text-xs text-text-muted">Description
          <input disabled={!canEdit} className={inputClass} value={row.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="col-span-2 grid gap-1 text-xs text-text-muted">Type
          <Select disabled={!canEdit} className={inputClass} value={row.kind} onChange={(e) => set('kind', e.target.value as PartKind)}>
            {kindsOf(family).map((k) => <option key={k} value={k}>{PART_KINDS[k].label}</option>)}
          </Select>
        </label>
        {family === 'pce' ? <>
          <label className="grid gap-1 text-xs text-text-muted">Rating
            <Select disabled={!canEdit} className={inputClass} value={row.rating_psi ?? ''} onChange={(e) => set('rating_psi', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Not set</option>{RATINGS.map((r) => <option key={r} value={r}>{r.toLocaleString()} psi</option>)}
            </Select>
          </label>
          <label className="grid gap-1 text-xs text-text-muted">Service
            <Select disabled={!canEdit} className={inputClass} value={row.service ?? ''} onChange={(e) => set('service', (e.target.value || null) as Row['service'])}>
              <option value="">Not set</option><option value="h2s">H₂S</option><option value="std">Standard</option>
            </Select>
          </label>
          {num('od_in', 'OD', 'in')}{num('id_in', 'ID (bore)', 'in')}
          {row.kind === 'wireline_valve' ? num('rams', 'Rams', undefined, '1') : <span />}
        </> : <>
          {num('od_in', 'Max OD', 'in')}{num('id_in', 'ID', 'in')}{num('fn_in', 'Upper fishing neck', 'in')}{num('fn_lower_in', 'Lower fishing neck', 'in')}
          {num('weight_lb', 'Weight', 'lb')}{num('stroke_ft', 'Jar stroke', 'ft')}
        </>}
        {connField('top_conn', 'Top connection')}{connField('bottom_conn', 'Bottom connection')}
        {num('length_ft', 'Length', 'ft')}
      </div>
      {row.part_id && <p className="mt-3 text-xs text-text-subtle">Copied from the catalogue. Changes here stay on this job.</p>}
    </Card>
  );
}

interface Sample { id: string; name: string; items: Row[]; created_at: string; created_by_name: string }
interface Previous { id: string; run_no: number; items: Row[]; rev: number; updated_at: string; job_id: string; ticket_no: string | null; well: string | null; start_date: string | null; same_well: number }

/**
 * Start from: saved samples, the same kind of diagram on previous jobs (this well first), this job's other runs and
 * the built-in templates. Save as sample keeps the rows here under a name, to pull into any job and reconfigure.
 */
function StartFrom({ jobId, kind, run, rows, parts, others, legacy, onPick }: {
  jobId: string; kind: DiagramKind; run: number; rows: Row[]; parts: Part[]; others: Diagram[]; legacy: ToolPart[]; onPick: (rows: Row[]) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const samples = useQuery({ queryKey: ['diagram-samples', kind, jobId], queryFn: () => api<{ saved: Sample[]; previous: Previous[] }>(`/diagrams/samples?kind=${kind}&job=${jobId}`), enabled: open });
  const save = useMutation({
    mutationFn: () => api('/diagrams/samples', { method: 'POST', json: { kind, name, items: rows, job: jobId } }),
    onSuccess: () => { setMsg({ tone: 'success', text: `Saved “${name.trim()}”` }); setName(''); qc.invalidateQueries({ queryKey: ['diagram-samples'] }); },
    onError: (e: ApiError) => setMsg({ tone: 'danger', text: e.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/diagrams/samples/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['diagram-samples'] }),
    onError: (e: ApiError) => setMsg({ tone: 'danger', text: e.message }),
  });
  const byName = (names: string[]) => names.map((n) => parts.find((p) => p.name === n)).filter((p): p is Part => !!p).map(rowFromPart);
  const copy = (items: Row[]) => items.map((r) => ({ ...r }));
  const builtIn: { label: string; sub: string; rows: () => Row[] }[] = kind === 'rigup'
    ? [{ label: 'Standard 10K H₂S slickline rig up', sub: 'Stuffing box, catcher, 3" lubricators, crossover, dual ram, adapter, tree',
      rows: () => byName(['Stuffing Box 10K H2S', 'Tool Catcher 10K H2S 3"', 'Lubricator - Lightweight 3" x 10 ft', 'Lubricator - Lightweight 3" x 10 ft', 'WHE Crossover 4.75"-4x2 x 6.125"-4x2', 'Bleed-off Sub 10K H2S 4"', 'Dual Ram BOP 10K H2S 4"', 'Well Head Adapter 10K H2S 4"', 'X-Mas Tree (client)']) }]
    : [
      ...others.filter((t) => t.run_no !== run && t.items.length).map((t) => ({ label: `Copy Run ${t.run_no}`, sub: `${t.items.length} parts`, rows: () => copy(t.items) })),
      ...(legacy.length ? [{ label: 'From the Preparation toolstring', sub: legacy.map((p) => p.component).join(' → '), rows: () => legacy.map(fromLegacy) }] : []),
      { label: 'Basic 1 7/8" string', sub: 'Rope socket, stem, knuckle joint, spang jar (SOP-01 §7.16.9)',
        rows: () => byName(['1 7/8" Rope Socket (0.125")', '1 7/8" x 5\' Stem', '1 7/8" x 3\' Stem', '1 7/8" Knuckle Joint', '1 7/8" Spang Jars (20" Stroke)']) },
    ];
  const pick = (items: Row[]) => { setOpen(false); setMsg(null); onPick(copy(items)); };
  const item = 'block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-surface-3';
  const head = 'label-caps px-2.5 pt-2 pb-1 text-text-subtle';
  return (
    <div className="relative">
      <Button size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Start from ▾</Button>
      {open && (
        <div role="menu" className="absolute top-9 left-0 z-30 max-h-[70vh] w-96 overflow-y-auto rounded-lg border border-border-strong bg-surface-2 p-1.5 shadow-pop" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <form className="flex gap-1.5 px-1 pt-1" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <input aria-label="Sample name" className={cx(inputClass, 'h-8')} placeholder="Save these rows as a sample…" value={name} onChange={(e) => setName(e.target.value)} />
            <Button size="sm" type="submit" disabled={!name.trim() || !rows.length} loading={save.isPending}>Save</Button>
          </form>
          {msg && <p className={cx('px-2.5 pt-1 text-xs', msg.tone === 'success' ? 'text-success' : 'text-danger')}>{msg.text}</p>}

          <p className={head}>Saved samples</p>
          {samples.isPending && <p className="px-2.5 py-1 text-xs text-text-muted">Loading…</p>}
          {samples.data && !samples.data.saved.length && <p className="px-2.5 py-1 text-xs text-text-muted">None yet. Save the rows above to keep one.</p>}
          {samples.data?.saved.map((s) => (
            <div key={s.id} className="flex items-center gap-1">
              <button role="menuitem" type="button" className={cx(item, 'flex-1')} onClick={() => pick(s.items)}>
                <span className="block text-sm font-semibold">{s.name}</span>
                <span className="block truncate text-xs text-text-muted">{s.items.length} parts · {s.created_by_name} · {formatDate(s.created_at.slice(0, 10))}</span>
              </button>
              <Button size="sm" variant="ghost" aria-label={`Remove the sample ${s.name}`} loading={remove.isPending && remove.variables === s.id} onClick={() => remove.mutate(s.id)}><X aria-hidden className="size-3.5" /></Button>
            </div>
          ))}

          <p className={head}>Previous jobs</p>
          {samples.data && !samples.data.previous.length && <p className="px-2.5 py-1 text-xs text-text-muted">No other job has one yet.</p>}
          {samples.data?.previous.map((d) => (
            <button key={d.id} role="menuitem" type="button" className={item} onClick={() => pick(d.items)}>
              <span className="block text-sm font-semibold">{[d.ticket_no, d.well].filter(Boolean).join(' · ') || 'Job'}{kind === 'toolstring' ? ` · Run ${d.run_no}` : ''}{d.same_well ? <span className="ml-1.5 text-xs font-normal text-accent-text">same well</span> : null}</span>
              <span className="block truncate text-xs text-text-muted">{d.items.length} parts · Rev {d.rev} · {d.start_date ? formatDate(d.start_date) : formatDate(d.updated_at.slice(0, 10))}</span>
            </button>
          ))}

          <p className={head}>{kind === 'rigup' ? 'Templates' : 'This job and templates'}</p>
          {builtIn.map((o) => (
            <button key={o.label} role="menuitem" type="button" className={item} onClick={() => pick(o.rows())}>
              <span className="block text-sm font-semibold">{o.label}</span><span className="block truncate text-xs text-text-muted">{o.sub}</span>
            </button>
          ))}
          <p className="px-2.5 pt-2 pb-1 text-xs text-text-subtle">Picking one replaces the rows here; change any part afterwards. Undo puts them back.</p>
        </div>
      )}
    </div>
  );
}

/** Preparation's summary: the rig up and each run's tool string, their status and checks, and the way into the editor. */
export function DiagramsCard({ jobId }: { jobId: string }) {
  const q = useQuery({ queryKey: ['diagrams', jobId], queryFn: () => api<Data>(`/diagrams/${jobId}`) });
  if (q.isPending) return <Skeleton className="h-24" />;
  if (q.isError) return <Banner tone="danger">{q.error.message}</Banner>;
  const { job, rigup, toolstrings, legacy_toolstring } = q.data;
  const well = { mpwhp_psi: job.siwhp_psi, h2s_ppm: job.h2s_ppm, min_id_in: job.min_restriction_in, wire_in: job.wire_in };
  const strings = toolstrings.map((t) => t.items);
  const items: { key: string; title: string; d: Diagram | null; sum: string; kind: DiagramKind }[] = [
    { key: 'rigup', title: `Rig up · ${FORM.rigup.code}`, d: rigup, kind: 'rigup', sum: rigup?.items.length ? (() => { const t = rigTotals(rigup.items); return `${t.parts} parts · ${t.length_ft} ft · lubricator ${t.lubricator_ft} ft · ${t.system_wp?.toLocaleString() ?? '—'} psi`; })() : 'Not started' },
    ...toolstrings.map((t) => ({ key: `run-${t.run_no}`, title: `Run ${t.run_no} tool string · ${FORM.toolstring.code}`, d: t, kind: 'toolstring' as const,
      sum: (() => { const s = stringTotals(t.items); return `${s.parts} parts · ${s.length_open_ft} ft jars open · max OD ${s.max_od_in ?? '—'} in`; })() })),
  ];
  return (
    <div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map((it) => {
          const checks = it.d ? diagramChecks(it.kind, rigup?.items ?? null, it.kind === 'rigup' ? strings : [it.d.items, ...strings.filter((_, i) => toolstrings[i].id !== it.d!.id)], well) : [];
          const bad = checks.filter((c) => c.level === 'danger').length;
          return (
            <li key={it.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5">
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{it.title}</span><span className="block font-mono text-xs text-text-muted">{it.sum}</span></span>
              {it.d && <span className={cx('label-caps inline-flex h-5.5 items-center rounded-pill px-2', STATUS[it.d.status].cls)}>{STATUS[it.d.status].label} · Rev {it.d.rev}</span>}
              {bad > 0 && <span className="label-caps inline-flex h-5.5 items-center rounded-pill bg-danger-subtle px-2 text-danger">{bad} to fix</span>}
              <Link to={`/operation/jobs/${jobId}/diagrams?d=${it.key}`} className="inline-flex h-(--layout-control-sm) items-center rounded-md border border-border-strong bg-surface-2 px-3 text-xs font-semibold hover:bg-surface-3">{it.d ? 'Open' : 'Start'}</Link>
            </li>
          );
        })}
        {!toolstrings.length && (
          <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5">
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Run 1 tool string · {FORM.toolstring.code}</span>
              <span className="block text-xs text-text-muted">{legacy_toolstring.length ? `From before the diagrams: ${legacy_toolstring.map((p) => p.component).join(' → ')}. Open Run 1 and use Start from to bring it in.` : 'Not started'}</span></span>
            <Link to={`/operation/jobs/${jobId}/diagrams?d=run-1`} className="inline-flex h-(--layout-control-sm) items-center rounded-md border border-border-strong bg-surface-2 px-3 text-xs font-semibold hover:bg-surface-3">Start</Link>
          </li>
        )}
      </ul>
      <p className="mt-2 text-xs text-text-subtle">One rig up per job and one tool string per run, reviewed by the job’s SDM{job.sdm_name ? ` (${job.sdm_name})` : ''}. The lubricator length and the toolstring above come from these diagrams.</p>
    </div>
  );
}
