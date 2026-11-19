import { Select } from '../../components/Select';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, FileSpreadsheet, FolderPlus, Pencil, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { INLINE, sizeText } from '../../../shared/attachments';
import { csv, workbook } from '../../../shared/xlsx';
import { ADD_TYPES, GLOBAL, SECTIONS, SOP_COMPANIES, hasCompany, reviewState, type AddType, type KnowledgeDoc, type Section } from '../../../shared/knowledge';
import {
  DEFAULT_NUMBERING, DEFAULT_PERIODS, REGISTER_FILTERS, REGISTER_HEADER, REV_STATUS, editableProblem, expiryState, formatNumber, groupFiles, guessType, numberPrefix, registerCells, registerMatches, splitBase,
  type Numbering, type Periods, type RegisterFilter, type RegisterRow, type Revision,
} from '../../../shared/knowledgeControl';
import { ApiError, api, formatDate } from '../../api';
import { BarChart, KpiTile } from '../../components/charts';
import { Banner, Button, Card, EmptyState, Field, Skeleton, cx, inputClass, inputSized } from '../../components/ui';
import { Dialog, RevPill, isEditable, linkBtn, today, uploadFile, type Library } from './common';
import { CompanyTemplates } from './Copies';

// Document control screens for the Knowledge Hub (6z.14), after the NESR Document Control app: the approval queue,
// the document register (with its export), the archive of retired documents, the reference manuals library,
// the settings (numbering, periods, reviewers and approvers) and batch upload.

const saveFile = (data: BlobPart, name: string, type: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ---- queue ----------------------------------------------------------------------------------------------------

type QueueRow = Revision & { title: string; doc_no: string | null; section: Section; country: string; company: string | null; client: string | null; published_at: string | null; waitingOnMe: boolean; copy_of_no: string | null; has_pdf: number };

export function Queue({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ['knowledge-queue'], queryFn: () => api<{ rows: QueueRow[] }>('/knowledge/queue') });
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError) return <Banner tone="danger">{q.error.message}</Banner>;
  const rows = q.data!.rows;
  const mine = rows.filter((r) => r.waitingOnMe);
  const rest = rows.filter((r) => !r.waitingOnMe);
  const list = (items: QueueRow[]) => (
    <ul className="divide-y divide-border">
      {items.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
          <div className="min-w-0 flex-1 basis-60">
            <button type="button" className="text-left font-semibold hover:underline" onClick={() => onOpen(r.doc_id)}>{r.title}</button>
            <p className="text-xs text-text-muted">
              {r.doc_no && <span className="font-mono">{r.doc_no}</span>} · Rev {r.revision}{r.published_at ? ' (new revision)' : ' (first issue)'} · {SECTIONS[r.section]} · {r.country}{r.company && ` · ${r.company}`}{r.client && ` · ${r.client}`}{r.copy_of_no && <> · copy of <span className="font-mono">{r.copy_of_no}</span></>}
            </p>
            <p className="text-xs text-text-subtle">
              {r.status === 'review' && `With ${r.reviewer_name} for review, sent by ${r.submitted_by_name}`}
              {r.status === 'approval' && `With ${r.approver_name} for approval, reviewed by ${r.reviewer_name}`}
              {r.status === 'draft' && (r.sent_back_reason ? `Sent back: ${r.sent_back_reason}` : r.copy_of_no && !r.has_pdf ? `${r.section === 'lesson' ? 'Slides' : 'Word'} copy made: waiting for an admin to add the PDF` : `Draft by ${r.created_by_name}`)}
              {r.change_note && ` · ${r.change_note}`}
            </p>
          </div>
          <RevPill status={r.status} />
          <Button size="sm" onClick={() => onOpen(r.doc_id)}>Open</Button>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-0">
        <h2 className="border-b border-border px-4 py-2.5 font-display text-base font-bold">Waiting on you <span className="font-mono text-xs font-normal text-text-muted">{mine.length}</span></h2>
        {mine.length ? list(mine) : <p className="px-4 py-3 text-sm text-text-muted">Nothing is waiting on you.</p>}
      </Card>
      {rest.length > 0 && <Card className="p-0"><h2 className="border-b border-border px-4 py-2.5 font-display text-base font-bold">Everything in progress <span className="font-mono text-xs font-normal text-text-muted">{rest.length}</span></h2>{list(rest)}</Card>}
    </div>
  );
}

// ---- dashboard ------------------------------------------------------------------------------------------------

interface DashData {
  docs: KnowledgeDoc[];
  open: { doc_id: string; revision: number; status: 'draft' | 'review' | 'approval'; submitted_at: string | null; reviewer_name: string | null; approver_name: string | null }[];
  approvers: { label: string; n: number }[]; downloads: { month: string; n: number }[]; top: { id: string; title: string; doc_no: string | null; n: number }[];
}

/** Document control at a glance, after Document Control's dashboard: totals, work in progress, what falls due, downloads. */
export function Dashboard({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ['knowledge-dashboard'], queryFn: () => api<DashData>('/knowledge/dashboard') });
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError) return <Banner tone="danger">{q.error.message}</Banner>;
  const d = q.data!;
  const now = today();
  const pub = d.docs.filter((x) => x.published_at);
  const byId = new Map(d.docs.map((x) => [x.id, x]));
  const reviewOver = pub.filter((x) => reviewState(x.review_due, now) === 'overdue');
  const reviewSoon = pub.filter((x) => reviewState(x.review_due, now) === 'soon');
  const expired = pub.filter((x) => expiryState(x.expires_on ?? null, now) === 'expired');
  const expiring = pub.filter((x) => expiryState(x.expires_on ?? null, now) === 'soon');
  const inReview = d.open.filter((o) => o.status === 'review'), inApproval = d.open.filter((o) => o.status === 'approval'), drafts = d.open.filter((o) => o.status === 'draft');
  const bucket = (label: string, value: number, key = label) => ({ key, label, value, ids: [] as string[] });
  const bySection = (Object.keys(SECTIONS) as Section[]).map((s) => bucket(SECTIONS[s], pub.filter((x) => x.section === s).length, s));
  const byPlace = [...new Set(pub.map((x) => x.country))].sort((a, b) => (a === GLOBAL ? -1 : b === GLOBAL ? 1 : a.localeCompare(b))).map((p) => bucket(p, pub.filter((x) => x.country === p).length));
  const byCompany = SOP_COMPANIES.map((co) => bucket(co, pub.filter((x) => x.company === co).length));
  const downloads = d.downloads.map((m) => bucket(m.month, m.n));
  const list = (title: string, docs: KnowledgeDoc[], date: (x: KnowledgeDoc) => string | null | undefined, tone: string) => (
    <Card className="p-0">
      <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold">{title} <span className="font-mono text-xs text-text-muted">{docs.length}</span></h2>
      {docs.length ? (
        <ul className="divide-y divide-border">
          {docs.slice(0, 8).map((x) => (
            <li key={x.id} className="flex items-center gap-2 px-4 py-2 text-sm">
              <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onOpen(x.id)}>{x.doc_no && <span className="mr-1 font-mono text-xs">{x.doc_no}</span>}{x.title}</button>
              <span className={cx('shrink-0 text-xs font-semibold', tone)}>{date(x) ? formatDate(date(x)!) : ''}</span>
            </li>
          ))}
        </ul>
      ) : <p className="px-4 py-3 text-sm text-text-muted">None.</p>}
    </Card>
  );
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <KpiTile label="Published" value={pub.length} />
        <KpiTile label="In review" value={inReview.length} />
        <KpiTile label="Awaiting approval" value={inApproval.length} />
        <KpiTile label="Drafts" value={drafts.length} />
        <KpiTile label="Review overdue" value={reviewOver.length} note={reviewSoon.length ? `${reviewSoon.length} due in 30 days` : undefined} />
        <KpiTile label="Expired" value={expired.length} note={expiring.length ? `${expiring.length} within 90 days` : undefined} />
        <KpiTile label="External" value={pub.filter((x) => x.origin === 'external').length} />
        <KpiTile label="Downloads" value={d.downloads.reduce((a, m) => a + m.n, 0)} note="last 6 months" />
      </dl>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarChart title="Published documents by section" buckets={bySection} horizontal />
        <BarChart title="Published documents by country" buckets={byPlace} horizontal />
        <BarChart title="SOPs, SWIs and forms by company" buckets={byCompany} horizontal />
        <BarChart title="Approvals by approver" buckets={d.approvers.map((a) => bucket(a.label, a.n))} horizontal />
        <BarChart title="Downloads by month" buckets={downloads} />
        <Card className="p-0">
          <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold">Most downloaded, last 6 months</h2>
          {d.top.length ? <ul className="divide-y divide-border">{d.top.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-4 py-2 text-sm">
              <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onOpen(t.id)}>{t.doc_no && <span className="mr-1 font-mono text-xs">{t.doc_no}</span>}{t.title}</button>
              <span className="font-mono text-xs">{t.n}</span>
            </li>
          ))}</ul> : <p className="px-4 py-3 text-sm text-text-muted">No downloads yet.</p>}
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {list('Periodic review overdue or due in 30 days', [...reviewOver, ...reviewSoon], (x) => x.review_due, 'text-warning')}
        {list('Expired or expiring in 90 days', [...expired, ...expiring], (x) => x.expires_on, 'text-danger')}
        <Card className="p-0 lg:col-span-2">
          <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold">In review and awaiting approval <span className="font-mono text-xs text-text-muted">{inReview.length + inApproval.length}</span></h2>
          {inReview.length + inApproval.length ? (
            <ul className="divide-y divide-border">
              {[...inApproval, ...inReview].map((o) => { const x = byId.get(o.doc_id); return x && (
                <li key={o.doc_id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                  <button type="button" className="min-w-0 flex-1 basis-56 truncate text-left hover:underline" onClick={() => onOpen(o.doc_id)}>{x.doc_no && <span className="mr-1 font-mono text-xs">{x.doc_no}</span>}{x.title} · Rev {o.revision}</button>
                  <RevPill status={o.status} />
                  <span className="text-xs text-text-muted">with {o.status === 'review' ? o.reviewer_name : o.approver_name}{o.submitted_at && ` since ${formatDate(o.submitted_at.slice(0, 10))}`}</span>
                </li>
              ); })}
            </ul>
          ) : <p className="px-4 py-3 text-sm text-text-muted">Nothing is waiting.</p>}
        </Card>
      </div>
    </div>
  );
}

// ---- register -------------------------------------------------------------------------------------------------

export function Register({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ['knowledge-register'], queryFn: () => api<{ rows: RegisterRow[] }>('/knowledge/register') });
  const [filter, setFilter] = useState<RegisterFilter>('all');
  const now = today();
  const overdue = (due: string | null) => reviewState(due, now) === 'overdue';
  const flagsOf = (r: RegisterRow) => {
    const out: string[] = [];
    const rv = reviewState(r.doc.review_due, now), ex = expiryState(r.doc.expires_on ?? null, now);
    if (r.doc.published_at && rv) out.push(rv === 'overdue' ? 'Review overdue' : 'Review due soon');
    if (ex) out.push(ex === 'expired' ? 'Expired' : 'Expires soon');
    if (r.doc.origin === 'external') out.push('External');
    return out;
  };
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => registerMatches(r, filter, now, overdue)), [q.data, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError) return <Banner tone="danger">{q.error.message}</Banner>;
  const all = q.data!.rows;
  const count = (f: RegisterFilter) => all.filter((r) => registerMatches(r, f, now, overdue)).length;
  const tiles: [RegisterFilter, string][] = [['published', 'Published'], ['in_work', 'In review or approval'], ['draft', 'Drafts'], ['review_overdue', 'Review overdue'], ['expiring', 'Expired or expiring'], ['external', 'External']];
  const exportAs = (kind: 'xlsx' | 'csv') => {
    const cells = rows.map((r) => registerCells(r, flagsOf(r)));
    const name = `Knowledge Hub register ${now}${filter === 'all' ? '' : ` (${REGISTER_FILTERS[filter]})`}`;
    if (kind === 'xlsx') saveFile(workbook('Register', REGISTER_HEADER, cells, [18, 44, 16, 26, 14, 18, 10, 6, 26, 20, 12, 12, 12, 28, 10]), `${name}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    else saveFile(csv(REGISTER_HEADER, cells), `${name}.csv`, 'text/csv');
  };
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(filter === k ? 'all' : k)}
            className={cx('rounded-md border p-3 text-left', filter === k ? 'border-accent-text bg-surface-2' : 'border-border hover:bg-surface-2')}>
            <span className={cx('block font-display text-2xl font-bold', (k === 'review_overdue' || k === 'expiring') && count(k) > 0 && 'text-danger')}>{count(k)}</span>
            <span className="text-xs text-text-muted">{label}</span>
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Select aria-label="Show" className={inputSized('w-56')} value={filter} onChange={(e) => setFilter(e.target.value as RegisterFilter)}>
          {(Object.keys(REGISTER_FILTERS) as RegisterFilter[]).map((k) => <option key={k} value={k}>{REGISTER_FILTERS[k]} ({count(k)})</option>)}
        </Select>
        <Button className="ml-auto" onClick={() => exportAs('xlsx')}><FileSpreadsheet aria-hidden className="size-4" />Export Excel</Button>
        <Button variant="ghost" onClick={() => exportAs('csv')}>CSV</Button>
      </div>
      {!rows.length ? <EmptyState title="Nothing here">No documents match this view.</EmptyState> : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-surface-2 text-left text-xs text-text-muted">
              <tr>{['Doc No', 'Title', 'Place', 'Rev', 'Status', 'Approved', 'Next review', 'Expires', 'Flags'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const d = r.doc, flags = flagsOf(r);
                return (
                  <tr key={d.id} className={cx(d.retired_at && 'opacity-60')}>
                    <td className="px-3 py-2 font-mono text-xs">{d.doc_no}</td>
                    <td className="px-3 py-2"><button type="button" className="text-left font-semibold hover:underline" onClick={() => onOpen(d.id)}>{d.title}</button>
                      <span className="block text-xs text-text-muted">{d.section === 'lesson' ? ADD_TYPES[(d.doc_type ?? 'lesson_learnt') as AddType].label : SECTIONS[d.section]}{d.is_form ? ' · form' : ''}</span></td>
                    <td className="px-3 py-2 text-xs">{d.country}{(d.company || d.client) && <span className="block text-text-muted">{d.company ?? d.client}</span>}</td>
                    <td className="px-3 py-2 font-mono text-xs">{d.published_at ? d.revision : '–'}</td>
                    <td className="px-3 py-2">{d.retired_at ? <RevPill status="discarded">Retired</RevPill> : d.published_at ? <RevPill status="approved" /> : null}
                      {r.open && <span className="ml-1"><RevPill status={r.open.status}>Rev {r.open.revision} {REV_STATUS[r.open.status]}</RevPill></span>}</td>
                    <td className="px-3 py-2 text-xs">{d.published_at ? <>{formatDate(d.published_at.slice(0, 10))}<span className="block text-text-muted">{d.approved_by_name}</span></> : ''}</td>
                    <td className="px-3 py-2 text-xs">{d.review_due ? formatDate(d.review_due) : ''}</td>
                    <td className="px-3 py-2 text-xs">{d.expires_on ? formatDate(d.expires_on) : ''}</td>
                    <td className="px-3 py-2 text-xs">{flags.map((f) => <span key={f} className={cx('mr-1 block font-semibold', /overdue|Expired/.test(f) ? 'text-danger' : f === 'External' ? 'text-text-muted' : 'text-warning')}>{f}</span>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---- archive --------------------------------------------------------------------------------------------------

export function Archive({ onOpen, onChange }: { onOpen: (id: string) => void; onChange: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['knowledge-archive'], queryFn: () => api<{ docs: (KnowledgeDoc & { retired_by_name: string })[] }>('/knowledge/archive') });
  const [error, setError] = useState<string | null>(null);
  const restore = async (id: string) => {
    try { await api(`/knowledge/${id}/restore`, { method: 'POST', json: {} }); qc.invalidateQueries({ queryKey: ['knowledge-archive'] }); onChange(); } catch (e) { setError((e as ApiError).message); }
  };
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError) return <Banner tone="danger">{q.error.message}</Banner>;
  if (!q.data!.docs.length) return <EmptyState title="The archive is empty">Retired documents are kept here with the reason, and can be restored.</EmptyState>;
  return (
    <Card className="p-0">
      {error && <div className="p-3"><Banner tone="danger">{error}</Banner></div>}
      <ul className="divide-y divide-border">
        {q.data!.docs.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
            <div className="min-w-0 flex-1 basis-60">
              <button type="button" className="text-left font-semibold hover:underline" onClick={() => onOpen(d.id)}>{d.title}</button>
              <p className="text-xs text-text-muted">{d.doc_no && <span className="font-mono">{d.doc_no}</span>} · Rev {d.revision} · {SECTIONS[d.section]} · {d.country}</p>
              <p className="text-xs text-text-subtle">Retired {formatDate(d.retired_at!.slice(0, 10))} by {d.retired_by_name}{d.retire_reason && `: ${d.retire_reason}`}</p>
            </div>
            <Button size="sm" onClick={() => restore(d.id)}><RotateCcw aria-hidden className="size-3.5" />Restore</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---- reference manuals (uncontrolled) ---------------------------------------------------------------------------

interface Manuals { folders: { id: string; name: string }[]; files: { id: string; folder_id: string; file_name: string; content_type: string; size_bytes: number; uploaded_at: string; uploaded_by_name: string }[]; canManage: boolean; storage: boolean }

export function ManualsView() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['knowledge-manuals'], queryFn: () => api<Manuals>('/knowledge/manuals') });
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); qc.invalidateQueries({ queryKey: ['knowledge-manuals'] }); } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  const folderName = (id?: string, current = '') => { const name = window.prompt(id ? 'Rename the folder' : 'Name the new folder', current); if (name?.trim()) run(() => api('/knowledge/manuals/folders', { method: 'POST', json: { id, name } })); };
  const upload = (folder: string, files: FileList | null) => run(async () => {
    for (const f of [...(files ?? [])]) await api(`/knowledge/manuals/folders/${folder}/files`, { method: 'POST', body: f, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) } });
  });
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError) return <Banner tone="danger">{q.error.message}</Banner>;
  const m = q.data!;
  const s = search.trim().toLowerCase();
  const url = (id: string, inline = false) => `/api/knowledge/manuals/files/${id}${inline ? '?inline=1' : ''}`;
  return (
    <>
      <p className="mb-3 text-sm text-text-muted">Reference only: manufacturer manuals and catalogues. Not subject to document control, and not checked for the latest version.</p>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <input type="search" aria-label="Search manuals" className={inputSized('w-full sm:w-72')} placeholder="Search file names" value={search} onChange={(e) => setSearch(e.target.value)} />
        {m.canManage && <Button className="ml-auto" onClick={() => folderName()}><FolderPlus aria-hidden className="size-4" />New folder</Button>}
      </div>
      {!m.folders.length && <EmptyState title="No manuals yet">{m.canManage ? 'Make a folder, then add the manuals to it.' : 'Nothing has been added yet.'}</EmptyState>}
      <div className="flex flex-col gap-3">
        {m.folders.map((f) => {
          const files = m.files.filter((x) => x.folder_id === f.id && (!s || x.file_name.toLowerCase().includes(s)));
          if (s && !files.length) return null;
          return (
            <Card key={f.id} className="p-0">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
                <h2 className="flex-1 font-display text-base font-bold">{f.name} <span className="font-mono text-xs font-normal text-text-muted">{files.length}</span></h2>
                {m.canManage && m.storage && <label className={cx(linkBtn, 'cursor-pointer')}><Upload aria-hidden className="size-3.5" />Add files<input type="file" multiple className="sr-only" disabled={busy} onChange={(e) => upload(f.id, e.target.files)} /></label>}
                {m.canManage && <Button size="sm" variant="ghost" aria-label={`Rename ${f.name}`} onClick={() => folderName(f.id, f.name)}><Pencil aria-hidden className="size-3.5" /></Button>}
                {m.canManage && !files.length && <Button size="sm" variant="ghost" aria-label={`Remove ${f.name}`} onClick={() => run(() => api(`/knowledge/manuals/folders/${f.id}/remove`, { method: 'POST', json: {} }))}><Trash2 aria-hidden className="size-3.5" /></Button>}
              </div>
              {files.length ? (
                <ul className="divide-y divide-border">
                  {files.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                      <div className="min-w-0 flex-1 basis-48"><p className="truncate text-sm font-semibold">{x.file_name}</p><p className="text-xs text-text-subtle">{sizeText(x.size_bytes)} · {x.uploaded_by_name} · {formatDate(x.uploaded_at.slice(0, 10))}</p></div>
                      <div className="flex gap-1">
                        {INLINE.has(x.content_type) && <a className={linkBtn} href={url(x.id, true)} target="_blank" rel="noreferrer"><Eye aria-hidden className="size-3.5" />View</a>}
                        <a className={linkBtn} href={url(x.id)} download={x.file_name}><Download aria-hidden className="size-3.5" />Download</a>
                        {m.canManage && <Button size="sm" variant="ghost" aria-label={`Remove ${x.file_name}`} onClick={() => run(() => api(`/knowledge/manuals/files/${x.id}/remove`, { method: 'POST', json: {} }))}><Trash2 aria-hidden className="size-3.5" /></Button>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="px-4 py-3 text-sm text-text-muted">Empty folder.</p>}
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ---- settings -------------------------------------------------------------------------------------------------

interface SettingsData { numbering: Numbering; periods: Periods; people: { username: string; full_name: string; role: string; can_review: number; can_approve: number }[]; isAdmin: boolean }

export function Settings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['knowledge-settings'], queryFn: () => api<SettingsData>('/knowledge/settings') });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError) return <Banner tone="danger">{q.error.message}</Banner>;
  return <SettingsForm data={q.data!} onSaved={() => { qc.invalidateQueries({ queryKey: ['knowledge-settings'] }); qc.invalidateQueries({ queryKey: ['knowledge'] }); }} />;
}

function SettingsForm({ data, onSaved }: { data: SettingsData; onSaved: () => void }) {
  const [n, setN] = useState<Numbering>({ ...DEFAULT_NUMBERING, ...data.numbering, prefix: { ...DEFAULT_NUMBERING.prefix, ...data.numbering.prefix } });
  const [p, setP] = useState<Periods>({ ...DEFAULT_PERIODS, ...data.periods });
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState(data.people);
  const [who, setWho] = useState('');
  const admin = data.isAdmin;
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await api('/knowledge/settings', { method: 'PUT', json: { numbering: n, periods: p } }); setMsg({ tone: 'success', text: 'Saved' }); onSaved(); }
    catch (e) { setMsg({ tone: 'danger', text: (e as ApiError).message }); } finally { setBusy(false); }
  };
  const setRole = async (username: string, patch: { can_review?: number; can_approve?: number }) => {
    const cur = people.find((x) => x.username === username)!;
    const next = { ...cur, ...patch };
    try { await api(`/knowledge/people/${encodeURIComponent(username)}`, { method: 'PUT', json: { can_review: !!next.can_review, can_approve: !!next.can_approve } }); setPeople(people.map((x) => (x.username === username ? next : x))); onSaved(); }
    catch (e) { setMsg({ tone: 'danger', text: (e as ApiError).message }); }
  };
  // admins stay listed even when unticked, so they can be ticked again
  const holders = people.filter((x) => x.role === 'admin' || x.can_review || x.can_approve);
  const sample = (s: Section) => formatNumber(numberPrefix({ section: s, country: s === 'client' ? 'Saudi Arabia' : GLOBAL, company: hasCompany(s) ? 'NESR' : null }, n), 1, n.digits);
  return (
    <div className="flex flex-col gap-4">
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      <Card>
        <h2 className="font-display text-base font-bold">Reviewers and approvers</h2>
        <p className="mt-1 text-sm text-text-muted">A document goes to a reviewer, then an approver, before readers see it. Whoever sent it can’t review or approve it. Only the people ticked here are offered as reviewers and approvers; admins are ticked until you change them, and can always step in on any document.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-text-muted"><tr><th className="py-1 pr-3 font-semibold">Person</th><th className="py-1 pr-3 font-semibold">Reviewer</th><th className="py-1 font-semibold">Approver</th></tr></thead>
            <tbody className="divide-y divide-border">
              {holders.map((x) => (
                <tr key={x.username}>
                  <td className="py-1.5 pr-3">{x.full_name} <span className="text-xs text-text-muted">{x.username}{x.role === 'admin' && ' · admin'}</span></td>
                  <td className="py-1.5 pr-3"><input type="checkbox" aria-label={`${x.full_name} reviews`} disabled={!admin} checked={!!x.can_review} onChange={(e) => setRole(x.username, { can_review: e.target.checked ? 1 : 0 })} /></td>
                  <td className="py-1.5"><input type="checkbox" aria-label={`${x.full_name} approves`} disabled={!admin} checked={!!x.can_approve} onChange={(e) => setRole(x.username, { can_approve: e.target.checked ? 1 : 0 })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {admin && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field id="ks-who" label="Add a person">
              <Select id="ks-who" className={inputSized('w-64')} value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Pick a person</option>{people.filter((x) => !holders.includes(x)).map((x) => <option key={x.username} value={x.username}>{x.full_name} ({x.username})</option>)}
              </Select>
            </Field>
            <Button disabled={!who} onClick={() => { setRole(who, { can_review: 1 }); setWho(''); }}>As reviewer</Button>
            <Button disabled={!who} onClick={() => { setRole(who, { can_approve: 1 }); setWho(''); }}>As approver</Button>
          </div>
        )}
      </Card>
      <Card>
        <h2 className="font-display text-base font-bold">Document numbering</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field id="ks-mode" label="Mode" hint={n.mode === 'auto' ? 'The next number is given when the document is added' : 'The number must be typed (useful when bringing in an existing numbered library)'}>
            <Select id="ks-mode" className={inputClass} disabled={!admin} value={n.mode} onChange={(e) => setN({ ...n, mode: e.target.value as Numbering['mode'] })}><option value="auto">Automatic</option><option value="manual">Manual</option></Select>
          </Field>
          <Field id="ks-digits" label="Digits"><input id="ks-digits" type="number" min={2} max={6} className={inputClass} disabled={!admin} value={n.digits} onChange={(e) => setN({ ...n, digits: Number(e.target.value) })} /></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" disabled={!admin} checked={n.place} onChange={(e) => setN({ ...n, place: e.target.checked })} />Add the place code (GL, SA, BAH)</label>
          {(Object.keys(SECTIONS) as Section[]).map((s) => (
            <Field key={s} id={`ks-${s}`} label={`${SECTIONS[s]} prefix`} hint={`Next issued looks like ${sample(s)}`}>
              <input id={`ks-${s}`} className={inputClass} disabled={!admin} value={n.prefix[s]} onChange={(e) => setN({ ...n, prefix: { ...n.prefix, [s]: e.target.value.toUpperCase() } })} />
            </Field>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="font-display text-base font-bold">Review and expiry</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="ks-review" label="Next review, months after approval" hint="Flagged 30 days before and when overdue"><input id="ks-review" type="number" min={1} max={60} className={inputClass} disabled={!admin} value={p.reviewMonths} onChange={(e) => setP({ ...p, reviewMonths: Number(e.target.value) })} /></Field>
          <Field id="ks-expiry" label="Expiry, months after the revision date" hint="Default for each new revision, flagged 90 days before"><input id="ks-expiry" type="number" min={1} max={120} className={inputClass} disabled={!admin} value={p.expiryMonths} onChange={(e) => setP({ ...p, expiryMonths: Number(e.target.value) })} /></Field>
        </div>
      </Card>
      {admin ? <Button variant="primary" className="self-start" loading={busy} onClick={save}>Save numbering and periods</Button> : <p className="text-sm text-text-muted">Only an admin changes these settings.</p>}
      <CompanyTemplates />
    </div>
  );
}

// ---- batch upload -----------------------------------------------------------------------------------------------

/**
 * Several documents at once. Files with the same base name make one document (the PDF is the document, Word or
 * Excel the editable version). Type and number are read from the name where they can be; each becomes a draft,
 * and can go straight to a reviewer when it has what review needs.
 */
export function BatchAdd({ lib, section, onClose }: { lib: Library; section: Section; onClose: (changed: boolean) => void }) {
  const fallback: AddType = section === 'lesson' ? 'lesson_learnt' : section;
  const [files, setFiles] = useState<File[]>([]);
  const [types, setTypes] = useState<Record<string, AddType>>({});
  const [shared, setShared] = useState({ country: section === 'client' ? lib.places[0] ?? '' : GLOBAL, company: 'NESR', client: '', category: '', author: '', change_note: 'First issue', reviewer: '' });
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const groups = groupFiles(files);
  const typeOf = (base: string) => types[base] ?? guessType(base, fallback);
  const reviewers = lib.people.filter((p) => p.can_review && (lib.isAdmin || p.username.toLowerCase() !== lib.me.username.toLowerCase()));
  const go = async () => {
    setBusy(true);
    const out: string[] = [];
    for (const g of groups) {
      const t = typeOf(g.base);
      const sec = ADD_TYPES[t].section;
      const { doc_no, title } = splitBase(g.base);
      const pdf = g.files.find((f) => /\.pdf$/i.test(f.name)) ?? g.files.find((f) => !isEditable(f.name));
      const found = g.files.find((f) => isEditable(f.name) && f !== pdf);
      // editable versions are Word .docx only (6z.24): an older .doc or an Excel file is left out, and said so
      const source = found && (sec === 'form' || !editableProblem({ section: sec }, found.name)) ? found : undefined;
      const leftOut = found && !source ? `, editable “${found.name}” left out (${sec === 'lesson' ? 'PowerPoint .pptx or Word .docx' : 'Word .docx'} only)` : '';
      try {
        if (sec === 'client' && (!shared.client.trim() || shared.country === GLOBAL)) throw new ApiError(400, 'Client procedures need a country and a client', {});
        const r = await api<{ id: string; doc_no: string }>('/knowledge', { method: 'POST', json: { type: t, title, doc_no: doc_no ?? '', country: shared.country, company: shared.company, client: shared.client,
          category: shared.category || (sec === 'lesson' ? 'General' : ''), author: shared.author, change_note: shared.change_note } });
        if (pdf) await uploadFile(r.id, pdf, 'published');
        if (source) await uploadFile(r.id, source, 'source');
        let sent = '';
        if (shared.reviewer) {
          try { await api(`/knowledge/${r.id}/revisions/0/submit`, { method: 'POST', json: { reviewer: shared.reviewer } }); sent = ', sent for review'; }
          catch (e) { sent = `, kept as a draft (${(e as ApiError).message})`; }
        }
        out.push(`✓ ${r.doc_no} ${title}${sent}${leftOut}`);
      } catch (e) { out.push(`✗ ${g.base}: ${(e as ApiError).message}`); }
      setLog([...out]);
    }
    setBusy(false);
  };
  const set = (k: keyof typeof shared, v: string) => setShared({ ...shared, [k]: v });
  const done = log.length > 0 && !busy;
  return (
    <Dialog title="Add several documents" onClose={() => onClose(log.length > 0)} wide>
      <p className="text-sm text-text-muted">Pick the files. Files with the same name make one document: the PDF is the document, the Word file (.docx) the editable version. A name like “SOP-GL-NESR-012 Rig up.pdf” gives the number and the title.</p>
      <input type="file" multiple aria-label="Files" className="mt-3 text-sm" disabled={busy} onChange={(e) => { setFiles([...(e.target.files ?? [])]); setLog([]); }} />
      {groups.length > 0 && (
        <>
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            {groups.map((g) => (
              <li key={g.base} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1 basis-56"><p className="truncate text-sm font-semibold">{g.base}</p><p className="text-xs text-text-muted">{g.files.map((f) => f.name.split('.').pop()?.toUpperCase()).join(' + ')}</p></div>
                <Select aria-label={`Type of ${g.base}`} className={inputSized('w-56')} value={typeOf(g.base)} onChange={(e) => setTypes({ ...types, [g.base]: e.target.value as AddType })}>
                  {(Object.keys(ADD_TYPES) as AddType[]).map((k) => <option key={k} value={k}>{ADD_TYPES[k].label}</option>)}
                </Select>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="kb-country" label="Country or Global"><Select id="kb-country" className={inputClass} value={shared.country} onChange={(e) => set('country', e.target.value)}>{[GLOBAL, ...lib.places].map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field id="kb-company" label="Company (SOPs, SWIs, forms)"><Select id="kb-company" className={inputClass} value={shared.company} onChange={(e) => set('company', e.target.value)}>{SOP_COMPANIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field id="kb-client" label="Client (client procedures)"><input id="kb-client" className={inputClass} list="kb-clients" value={shared.client} onChange={(e) => set('client', e.target.value)} /></Field>
            <datalist id="kb-clients">{lib.clients.map((c) => <option key={c} value={c} />)}</datalist>
            <Field id="kb-category" label="Category"><input id="kb-category" className={inputClass} value={shared.category} onChange={(e) => set('category', e.target.value)} placeholder="Lessons need one; General if blank" /></Field>
            <Field id="kb-author" label="Author"><input id="kb-author" className={inputClass} value={shared.author} onChange={(e) => set('author', e.target.value)} /></Field>
            <Field id="kb-note" label="Comment for this issue"><input id="kb-note" className={inputClass} value={shared.change_note} onChange={(e) => set('change_note', e.target.value)} /></Field>
            <Field id="kb-reviewer" label="Send for review to" hint="Leave blank to keep them as drafts">
              <Select id="kb-reviewer" className={inputClass} value={shared.reviewer} onChange={(e) => set('reviewer', e.target.value)}>
                <option value="">Keep as drafts</option>{reviewers.map((p) => <option key={p.username} value={p.username}>{p.full_name}</option>)}
              </Select>
            </Field>
          </div>
        </>
      )}
      {log.length > 0 && <ul className="mt-3 text-sm">{log.map((l) => <li key={l} className={l.startsWith('✗') ? 'text-danger' : ''}>{l}</li>)}</ul>}
      <div className="mt-4 flex gap-2">
        {!done && <Button variant="primary" loading={busy} disabled={!groups.length} onClick={go}><Upload aria-hidden className="size-4" />Add {groups.length || ''} document{groups.length === 1 ? '' : 's'}</Button>}
        {done && <Button variant="primary" onClick={() => onClose(true)}>Done</Button>}
      </div>
    </Dialog>
  );
}
