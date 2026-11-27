import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, FileDown, FolderOpen, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { FAMILY_OF, MAX_ROWS, diagramChecks, insertIndex, rowFromPart, type DiagramKind, type Part, type Row } from '../../shared/diagram';
import { EMPTY_FACTS, FACT_NUM, FACT_TEXT, UTIL_LABEL, UTIL_PATH, cleanFacts, type DiagramData, type UtilFacts, type UtilKind } from '../../shared/utilities';
import { ApiError, api, countryScope } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass } from '../components/ui';
import { Dialog } from './knowledge/common';
import { Catalogue, RowEditor, Sheet, Totals, type JobFacts } from './Diagrams';
import type { WinchHost } from './WinchData';
import { lazyRetry } from '../staleBuild';

// the winch tool (and its guide and demo data) loads only when a winch project is opened
const WinchWorkbench = lazy(lazyRetry(() => import('./WinchData').then((m) => ({ default: m.WinchWorkbench }))));
import type { Meta } from './winch/Report';

// Utilities (6z.47): the Rig Up Diagram, the Tool String Diagram and the Winch Report, the same tools as on a job but
// not tied to one. Each piece of work is a project: give it a name, type the job details, and it is saved as you go;
// a project can be opened again, renamed, duplicated or deleted.

interface ProjectListRow { id: string; name: string; updated_at: string; updated_by_name: string | null; created_by_name: string | null; well: string | null; winch_well: string | null; files: number; canDelete: boolean }
interface Project { id: string; kind: UtilKind; name: string; data: Record<string, unknown>; updated_at: string; updated_by_name: string | null; canEdit: boolean; canDelete: boolean }

const KIND_OF_SLUG: Record<string, UtilKind> = { 'rig-up': 'rigup', 'tool-string': 'toolstring', winch: 'winch' };
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const BLURB: Record<UtilKind, string> = {
  rigup: 'Rig up diagrams (QAF14009) on their own: type the job details, build the stack and make the PDF.',
  toolstring: 'Tool string diagrams (QAF14010) on their own: type the job details, build the string and make the PDF.',
  winch: 'Winch reports on their own: add the Lineminder recordings or winch exports, type the job details, check the runs and keep the report.',
};

/** /utilities/:slug — the projects of one tool. */
export function UtilityList() {
  const { slug = '' } = useParams();
  const kind = KIND_OF_SLUG[slug];
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ['utilities', kind], queryFn: () => api<{ projects: ProjectListRow[]; canEdit: boolean }>(`/utilities?kind=${kind}`), enabled: !!kind });
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<ProjectListRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['utilities', kind] });
  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/utilities', { method: 'POST', json: { kind, name, data: kind === 'winch' ? {} : { facts: EMPTY_FACTS, rows: [], run: 1, rev: 0 } } }),
    onSuccess: (r) => { refresh(); navigate(`${UTIL_PATH[kind]}/${r.id}`); },
    onError: (e: ApiError) => setError(e.message),
  });
  const duplicate = useMutation({ mutationFn: (id: string) => api(`/utilities/${id}/duplicate`, { method: 'POST' }), onSuccess: refresh, onError: (e: ApiError) => setError(e.message) });
  const rename = useMutation({ mutationFn: (r: { id: string; name: string }) => api(`/utilities/${r.id}`, { method: 'PUT', json: { name: r.name } }), onSuccess: () => { setRenaming(null); refresh(); }, onError: (e: ApiError) => setError(e.message) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/utilities/${id}`, { method: 'DELETE' }), onSuccess: () => { setDeleting(null); refresh(); }, onError: (e: ApiError) => setError(e.message) });
  if (!kind) return <Banner tone="danger">There is no such utility.</Banner>;
  const canEdit = !!list.data?.canEdit;
  return (
    <section aria-labelledby="ut-title">
      <PageTitle><span id="ut-title">{UTIL_LABEL[kind]}</span></PageTitle>
      <p className="-mt-3 mb-4 text-sm text-text-muted">{BLURB[kind]} Not tied to a job: each piece of work is a project, saved as you go.</p>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      {canEdit && (
        <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="w-full max-w-sm"><Field id="ut-new" label="New project"><input id="ut-new" className={inputClass} value={name} placeholder={`e.g. ${kind === 'winch' ? 'HWYH-1506 run check' : 'Well 801 rig up'}`} onChange={(e) => setName(e.target.value)} /></Field></div>
          <Button type="submit" variant="primary" loading={create.isPending}><Plus aria-hidden className="size-4" />Start a project</Button>
        </form>
      )}
      {list.isPending ? <Skeleton className="h-40" /> : !list.data?.projects.length ? (
        <EmptyState title="No projects yet">{canEdit ? 'Name one above to start.' : 'Nobody has saved one in your countries yet.'}</EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">{UTIL_LABEL[kind]} projects</caption>
            <thead><tr className="border-b border-border">{['Project', 'Well', 'Last saved', 'Made by', ''].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-mono text-label font-semibold tracking-wide text-text-muted uppercase">{h}</th>)}</tr></thead>
            <tbody>{list.data.projects.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                <td className="px-3 py-2 font-semibold">
                  {renaming?.id === p.id ? (
                    <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); rename.mutate(renaming); }}>
                      <input aria-label="Project name" autoFocus className={cx(inputClass, 'h-(--layout-control-sm)')} value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
                      <Button size="sm" type="submit" loading={rename.isPending}>Save</Button><Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                    </form>
                  ) : <Link className="hover:underline" to={`${UTIL_PATH[kind]}/${p.id}`}>{p.name}</Link>}
                  {kind === 'winch' && p.files > 0 && <span className="ml-2 text-xs font-normal text-text-subtle">{p.files} file{p.files > 1 ? 's' : ''}</span>}
                </td>
                <td className="px-3 py-2">{p.well || p.winch_well || <span className="text-text-subtle">—</span>}</td>
                <td className="px-3 py-2 text-text-muted">{when(p.updated_at)}{p.updated_by_name && ` · ${p.updated_by_name}`}</td>
                <td className="px-3 py-2 text-text-muted">{p.created_by_name}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <Link to={`${UTIL_PATH[kind]}/${p.id}`} className="inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-sm px-2 text-xs font-semibold hover:bg-surface-3"><FolderOpen aria-hidden className="size-3.5" />Open</Link>
                    {canEdit && <Button size="sm" variant="ghost" aria-label={`Rename ${p.name}`} onClick={() => setRenaming({ id: p.id, name: p.name })}><Pencil aria-hidden className="size-3.5" /></Button>}
                    {canEdit && <Button size="sm" variant="ghost" aria-label={`Duplicate ${p.name}`} loading={duplicate.isPending && duplicate.variables === p.id} onClick={() => duplicate.mutate(p.id)}><Copy aria-hidden className="size-3.5" /></Button>}
                    {p.canDelete && <Button size="sm" variant="ghost" aria-label={`Delete ${p.name}`} className="text-danger" onClick={() => setDeleting(p)}><Trash2 aria-hidden className="size-3.5" /></Button>}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
      {deleting && (
        <Dialog title={`Delete “${deleting.name}”?`} onClose={() => setDeleting(null)}>
          <p className="mb-4 text-sm">The project and its saved work are deleted for everyone. This cannot be undone. Its duplicates are not touched.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>Keep it</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(deleting.id)}><Trash2 aria-hidden className="size-4" />Delete</Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

/** /utilities/:slug/:id — one project, saved as you go. */
export function UtilityProject() {
  const { slug = '', id = '' } = useParams();
  const kind = KIND_OF_SLUG[slug];
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['utility', id], queryFn: () => api<Project>(`/utilities/${id}`), gcTime: 0, refetchOnMount: 'always' });
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const duplicate = useMutation({ mutationFn: () => api<{ id: string }>(`/utilities/${id}/duplicate`, { method: 'POST' }), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['utilities', kind] }); navigate(`${UTIL_PATH[kind]}/${r.id}`); }, onError: (e: ApiError) => setError(e.message) });
  const remove = useMutation({ mutationFn: () => api(`/utilities/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['utilities', kind] }); navigate(UTIL_PATH[kind]); }, onError: (e: ApiError) => setError(e.message) });
  if (!kind) return <Banner tone="danger">There is no such utility.</Banner>;
  if (q.isPending) return <Skeleton className="h-[60vh]" />;
  if (q.isError || !q.data) return <Banner tone="danger" action={<Link className="underline" to={UTIL_PATH[kind]}>Back to the projects</Link>}>{q.error?.message ?? 'Project not found'}</Banner>;
  const p = q.data;
  return (
    <section aria-labelledby="up-title">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to={UTIL_PATH[kind]} className="inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-xs font-semibold hover:bg-surface-3"><ArrowLeft aria-hidden className="size-3.5" />{UTIL_LABEL[kind]}</Link>
        <ProjectName project={p} onError={setError} />
        <span className="flex-1" />
        {p.canEdit && <Button size="sm" variant="ghost" loading={duplicate.isPending} onClick={() => duplicate.mutate()}><Copy aria-hidden className="size-3.5" />Duplicate</Button>}
        {p.canDelete && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting(true)}><Trash2 aria-hidden className="size-3.5" />Delete</Button>}
      </div>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      {kind === 'winch' ? <UtilityWinch project={p} /> : <UtilityDiagram kind={kind} project={p} />}
      {deleting && (
        <Dialog title={`Delete “${p.name}”?`} onClose={() => setDeleting(false)}>
          <p className="mb-4 text-sm">The project and its saved work are deleted for everyone. This cannot be undone.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(false)}>Keep it</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}><Trash2 aria-hidden className="size-4" />Delete</Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function ProjectName({ project, onError }: { project: Project; onError: (e: string) => void }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (name: string) => api<{ name: string }>(`/utilities/${project.id}`, { method: 'PUT', json: { name } }),
    onSuccess: (r) => { setEdit(null); qc.setQueryData<Project>(['utility', project.id], (o) => o && { ...o, name: r.name }); qc.invalidateQueries({ queryKey: ['utilities', project.kind] }); },
    onError: (e: ApiError) => onError(e.message),
  });
  if (edit !== null) return (
    <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); save.mutate(edit); }}>
      <input aria-label="Project name" autoFocus className={cx(inputClass, 'h-(--layout-control-sm) w-64')} value={edit} onChange={(e) => setEdit(e.target.value)} />
      <Button size="sm" type="submit" loading={save.isPending}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
    </form>
  );
  return (
    <h1 id="up-title" className="flex items-center gap-2 font-display text-xl font-bold">{project.name}
      {project.canEdit && <Button size="sm" variant="ghost" aria-label="Rename the project" onClick={() => setEdit(project.name)}><Pencil aria-hidden className="size-3.5" /></Button>}
    </h1>
  );
}

/** Saves a project's data a moment after each change; says when it last did. */
function useAutosave(project: Project) {
  const qc = useQueryClient();
  const [note, setNote] = useState<{ ok: boolean; text: string }>({ ok: true, text: `Saved ${when(project.updated_at)}` });
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const save = (data: Record<string, unknown>) => {
    if (!project.canEdit) { setNote({ ok: false, text: 'Not saved: your role can only view Utilities.' }); return; }
    setNote({ ok: true, text: 'Saving…' });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api<{ updated_at: string }>(`/utilities/${project.id}`, { method: 'PUT', json: { data } })
        .then((r) => { setNote({ ok: true, text: `Saved ${when(r.updated_at)}` }); qc.invalidateQueries({ queryKey: ['utilities', project.kind] }); })
        .catch((e) => setNote({ ok: false, text: `Not saved: ${(e as Error).message}` }));
    }, 700);
  };
  return { note, save };
}

// ---- the winch report, on a project

function UtilityWinch({ project }: { project: Project }) {
  const { data: me } = useMe();
  const { note, save } = useAutosave(project);
  const [meta, setMeta] = useState<Meta>(() => ({ drss: '', field: '', well: '', unit: '', cable: '', date: '', by: me?.fullName ?? '', crew: '', client: '', ...((project.data.meta as Partial<Meta>) ?? {}) }));
  const host: WinchHost = {
    key: `util-${project.id}`, stateUrl: `/utilities/${project.id}/state`, filesUrl: `/utilities/${project.id}/files`, filesKey: ['utility-files', project.id],
    // only the details: the server keeps the winch check, which is saved on its own
    meta, onMeta: (m) => { setMeta(m); save({ meta: m }); }, services: [], home: 'project',
  };
  return (
    <div className="space-y-3">
      <p role="status" className={cx('text-xs', note.ok ? 'text-text-subtle' : 'text-danger')}>Job details: {note.text}</p>
      <Card className="p-4"><Suspense fallback={<Skeleton className="h-96" />}><WinchWorkbench host={host} /></Suspense></Card>
    </div>
  );
}

// ---- the rig up and tool string diagrams, on a project

function UtilityDiagram({ kind, project }: { kind: Exclude<UtilKind, 'winch'>; project: Project }) {
  const dkind: DiagramKind = kind;
  const family = FAMILY_OF[dkind];
  const parts = useQuery({ queryKey: ['parts'], queryFn: () => api<Part[]>('/diagrams/parts'), staleTime: 5 * 60_000 });
  const start = project.data as Partial<DiagramData>;
  const [facts, setFacts] = useState<UtilFacts>(() => cleanFacts(start.facts));
  const [rows, setRows] = useState<Row[]>(() => (Array.isArray(start.rows) ? start.rows : []));
  const [run, setRun] = useState(() => Math.max(1, Number(start.run) || 1));
  const [rev, setRev] = useState(() => Math.max(0, Number(start.rev) || 0));
  const [sel, setSel] = useState<number | null>(null);
  const [history, setHistory] = useState<Row[][]>([]);
  const [unit, setUnit] = useState<'ft' | 'm'>('ft');
  const [error, setError] = useState<string | null>(null);
  const [pdfNote, setPdfNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { note, save } = useAutosave(project);
  const canEdit = project.canEdit;
  const persist = (next: { facts?: UtilFacts; rows?: Row[]; run?: number }) => save({ facts: next.facts ?? facts, rows: next.rows ?? rows, run: next.run ?? run, rev });
  const change = (next: Row[], keepSel?: number | null) => {
    if (!canEdit) return;
    setHistory((h) => [...h.slice(-49), rows]); setRows(next);
    if (keepSel !== undefined) setSel(keepSel);
    setError(null); persist({ rows: next });
  };
  const undo = () => { const prev = history[history.length - 1]; if (!prev) return; setHistory((h) => h.slice(0, -1)); setRows(prev); setSel(null); persist({ rows: prev }); };
  const addPart = (r: Row, at?: number) => {
    if (rows.length >= MAX_ROWS) { setError(`A diagram has at most ${MAX_ROWS} parts`); return; }
    const i = at ?? insertIndex(rows, r.kind);
    change([...rows.slice(0, i), r, ...rows.slice(i)], i);
  };
  const move = (i: number, by: number) => { const j = i + by; if (j < 0 || j >= rows.length) return; const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; change(n, j); };
  const setFact = (k: keyof UtilFacts, v: string | number | null) => { const next = { ...facts, [k]: v } as UtilFacts; setFacts(next); persist({ facts: next }); };
  const well = { mpwhp_psi: facts.siwhp_psi, h2s_ppm: facts.h2s_ppm, min_id_in: facts.min_restriction_in, wire_in: facts.wire_in };
  const checks = useMemo(() => diagramChecks(dkind, dkind === 'rigup' ? rows : null, dkind === 'toolstring' ? [rows] : [], well), [dkind, rows, well.mpwhp_psi, well.h2s_ppm, well.min_id_in, well.wire_in]); // eslint-disable-line react-hooks/exhaustive-deps
  const job: JobFacts = {
    client: facts.client, id: project.id, ticket_no: facts.ticket_no || null, drss_no: facts.drss_no || null, well: facts.well || null, field: facts.field || null, rig: facts.rig || null,
    unit_number: facts.unit_number || null, start_date: facts.date || null, sdm_username: null, sdm_name: null, siwhp_psi: facts.siwhp_psi, h2s_ppm: facts.h2s_ppm,
    min_restriction_in: facts.min_restriction_in, wire_serial_number: null, wire_in: facts.wire_in, target_depth_ft: facts.md_ft,
  };
  const makePdf = async (style: 'sheet' | 'data') => {
    setBusy(true); setError(null); setPdfNote(null);
    const w = window.open('', '_blank');
    try {
      // the latest rows first, so the PDF has them
      await api(`/utilities/${project.id}`, { method: 'PUT', json: { data: { facts, rows, run, rev } } });
      const res = await fetch(`/api/utilities/${project.id}/pdf?style=${style}`, { method: 'POST', credentials: 'same-origin', headers: countryScope() ? { 'X-SLK-Country': countryScope()! } : {} });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `PDF failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      if (w) w.location.href = url; else window.location.href = url;
      setRev(Number(res.headers.get('X-Rev')) || rev + 1);
      setPdfNote(res.headers.get('X-Filed') === 'yes' ? `PDF made and kept with the project as Rev ${rev}. The next PDF is Rev ${rev + 1}.` : 'PDF made, but it could not be kept with the project.');
    } catch (e) { w?.close(); setError((e as Error).message); } finally { setBusy(false); }
  };
  const files = useQuery({ queryKey: ['utility-files', project.id], queryFn: () => api<{ files: { id: string; file_name: string; uploaded_at: string; uploaded_by_name: string }[] }>(`/utilities/${project.id}/files`) });
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Job details <span className="font-normal text-text-subtle">for the sheet and its checks</span></h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {FACT_TEXT.map((f) => (
            <Field key={f.key} id={`uf-${f.key}`} label={f.label}>
              <input id={`uf-${f.key}`} className={inputClass} disabled={!canEdit} type={f.key === 'date' ? 'date' : 'text'} value={(facts[f.key] as string) ?? ''} onChange={(e) => setFact(f.key, e.target.value)} />
            </Field>
          ))}
          {FACT_NUM.map((f) => (
            <Field key={f.key} id={`uf-${f.key}`} label={f.label} unit={f.unit}>
              <input id={`uf-${f.key}`} className={cx(inputClass, 'pr-12')} disabled={!canEdit} type="number" step="any" min={0} value={(facts[f.key] as number | null) ?? ''} onChange={(e) => setFact(f.key, e.target.value === '' ? null : Number(e.target.value))} />
            </Field>
          ))}
          {dkind === 'toolstring' && (
            <Field id="uf-run" label="Run">
              <input id="uf-run" className={inputClass} disabled={!canEdit} type="number" min={1} max={20} value={run} onChange={(e) => { const v = Math.max(1, Math.min(20, Number(e.target.value) || 1)); setRun(v); persist({ run: v }); }} />
            </Field>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2">
        <Button size="sm" variant="ghost" onClick={undo} disabled={!history.length || !canEdit}><Undo2 aria-hidden className="size-3.5" />Undo</Button>
        <div role="group" aria-label="Units" className="flex rounded-md border border-border-strong p-0.5">
          {(['ft', 'm'] as const).map((u) => <button key={u} aria-pressed={unit === u} onClick={() => setUnit(u)} className={cx('h-7 rounded px-2.5 text-xs font-semibold', unit === u ? 'bg-surface-3 text-text' : 'text-text-muted')}>{u}</button>)}
        </div>
        <span className="flex-1" />
        <span role="status" className={cx('text-xs', note.ok ? 'text-text-muted' : 'text-danger')}>{note.text} · Rev {rev}</span>
        <Button size="sm" onClick={() => makePdf('sheet')} loading={busy} disabled={!rows.length}><FileDown aria-hidden className="size-3.5" />PDF</Button>
        <Button size="sm" variant="ghost" onClick={() => makePdf('data')} disabled={!rows.length || busy}>Data sheet PDF</Button>
      </div>
      {error && <Banner tone="danger">{error}</Banner>}
      {pdfNote && <Banner tone="success">{pdfNote}</Banner>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[14rem_minmax(0,1fr)_18rem]">
        <div className="order-2 xl:order-1">
          <Catalogue family={family} parts={parts.data ?? []} loading={parts.isPending} canEdit={canEdit} well={well} onAdd={(p) => addPart(rowFromPart(p))} />
        </div>
        <div className="order-1 min-w-0 xl:order-2">
          <Sheet kind={dkind} run={run} rows={rows} sel={sel} unit={unit} job={job} rev={rev} diagram={null} canEdit={canEdit}
            onSelect={setSel} onMove={move} onChange={change} onDropPart={(pid, at) => { const pt = parts.data?.find((x) => x.id === pid); if (pt) addPart(rowFromPart(pt), at); }} />
        </div>
        <div className="order-3 space-y-4">
          {sel != null && rows[sel] ? (
            <RowEditor key={`${sel}`} family={family} row={rows[sel]} index={sel} canEdit={canEdit} onChange={(r) => change(rows.map((x, i) => (i === sel ? r : x)), sel)} onClose={() => setSel(null)} />
          ) : <Totals kind={dkind} rows={rows} unit={unit} />}
          <Card className="p-4">
            <h2 className="label-caps mb-2 text-text-muted">Checks</h2>
            <ul className="space-y-1.5">
              {checks.map((c) => (
                <li key={c.text} className={cx('grid grid-cols-[1rem_1fr] gap-2 rounded-md px-2.5 py-2 text-xs', c.level === 'ok' ? 'bg-success-subtle' : c.level === 'warning' ? 'bg-warning-subtle' : 'bg-danger-subtle')}>
                  <span aria-hidden className={cx('font-bold', c.level === 'ok' ? 'text-success' : c.level === 'warning' ? 'text-warning' : 'text-danger')}>{c.level === 'ok' ? '✓' : c.level === 'warning' ? '!' : '✕'}</span>
                  <span><span className="sr-only">{c.level === 'ok' ? 'Pass: ' : c.level === 'warning' ? 'Review: ' : 'Fix: '}</span>{c.text}<span className="mt-0.5 block text-text-subtle">{c.cite}</span></span>
                </li>
              ))}
            </ul>
          </Card>
          {(files.data?.files.length ?? 0) > 0 && (
            <Card className="p-4">
              <h2 className="label-caps mb-2 text-text-muted">PDFs made</h2>
              <ul className="space-y-1 text-xs">
                {files.data!.files.map((f) => <li key={f.id}><a className="text-accent-text underline" href={`/api/utilities/${project.id}/files/${f.id}?inline=1`} target="_blank" rel="noreferrer">{f.file_name}</a> <span className="text-text-subtle">· {f.uploaded_by_name}</span></li>)}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
