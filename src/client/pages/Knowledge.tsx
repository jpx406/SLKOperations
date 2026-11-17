import { Select } from '../components/Select';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, BookOpen, ChevronLeft, ChevronRight, Download, ExternalLink, Eye, FileText, History, Pencil, Play, Plus, RotateCcw, Search, Star, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { INLINE, TYPES, checkUpload, sizeText } from '../../shared/attachments';
import {
  ADD_TYPES, DOC_TYPES, GLOBAL, SECTIONS, SOP_COMPANIES, addTypeOf, docPrefix, filterLibrary, groupByPlace, isSection, lessonOfWeek, matches, proceduresForJob, reviewState,
  type AddType, type DocType, type KbFile, type KnowledgeDoc, type Section,
} from '../../shared/knowledge';
import { ApiError, api, formatDate } from '../api';
import { Attachments } from '../components/Attachments';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass, inputSized } from '../components/ui';

// Knowledge Hub in three sections (6z.13): lessons and best practices (with the reader / toolbox-talk mode, S43),
// SLK SOPs grouped Global first then by country, and client procedures by country and client. Each entry keeps its
// document file for everyone to download and, for admins, the editable version and the older revisions.

interface Library { docs: KnowledgeDoc[]; canEdit: boolean; isAdmin: boolean; places: string[]; clients: string[] }
interface FileRow extends KbFile { kind: 'published' | 'source'; superseded_at: string | null; change_note: string | null }

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
const fileUrl = (docId: string, f: { id: string }, inline = false) => `/api/knowledge/${docId}/files/${f.id}${inline ? '?inline=1' : ''}`;
const ACCEPT = Object.keys(TYPES).map((e) => `.${e}`).join(',');
const EDITABLE_ACCEPT = '.doc,.docx,.xls,.xlsx,.xlsm,.ppt,.pptx,.txt,.csv,.zip';
const linkBtn = 'inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-semibold text-text hover:bg-surface-2';

async function uploadFile(docId: string, file: File, kind: 'published' | 'source', note?: string) {
  const ok = checkUpload(file.name, file.size);
  if ('error' in ok) throw new ApiError(400, ok.error, {});
  const qs = new URLSearchParams({ kind, ...(note ? { note } : {}) });
  return api<{ revision: number }>(`/knowledge/${docId}/files?${qs}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } });
}

export function KnowledgeHub() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['knowledge'], queryFn: () => api<Library>('/knowledge') });
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const s: Section = isSection(params.get('s')) ? (params.get('s') as Section) : 'lesson';
  const showRetired = params.get('retired') === '1';
  const all = useMemo(() => (q.data?.docs ?? []).filter((d) => showRetired || !d.retired_at), [q.data, showRetired]);
  const [reading, setReading] = useState<KnowledgeDoc | null>(null);
  const [editing, setEditing] = useState<KnowledgeDoc | 'new' | null>(null);
  const canEdit = !!q.data?.canEdit;
  const refresh = () => qc.invalidateQueries({ queryKey: ['knowledge'] });
  const counts = (sec: Section) => all.filter((d) => d.section === sec && !d.duplicate_of && !d.retired_at).length;
  // keep the open reader in step with the list after a change
  const open = reading ? all.find((d) => d.id === reading.id) ?? reading : null;

  return (
    <section aria-labelledby="kh-title">
      <PageTitle aside={canEdit && <Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Add document</Button>}>
        <span id="kh-title">Knowledge Hub</span>
      </PageTitle>
      <div role="tablist" aria-label="Knowledge Hub sections" className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(SECTIONS) as Section[]).map((k) => (
          <button key={k} role="tab" aria-selected={s === k} onClick={() => setParams(k === 'lesson' ? {} : { s: k }, { replace: true })}
            className={cx('h-(--layout-control-sm) rounded-pill border px-3.5 text-sm font-semibold', s === k ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>
            {SECTIONS[k]} <span className="font-mono font-normal opacity-80">{q.data ? counts(k) : ''}</span>
          </button>
        ))}
        {q.data?.isAdmin && <label className="ml-auto flex items-center gap-2 text-sm text-text-muted"><input type="checkbox" checked={showRetired} onChange={(e) => set('retired', e.target.checked ? '1' : '')} />Show retired</label>}
      </div>
      {q.isLoading && <Skeleton className="h-64" />}
      {q.isError && <Banner tone="danger">{q.error.message}</Banner>}
      {q.data && (
        <div role="tabpanel" aria-label={SECTIONS[s]}>
          {s === 'lesson'
            ? <Lessons all={all.filter((d) => d.section === 'lesson')} canEdit={canEdit} params={params} set={set} onRead={setReading} onEdit={setEditing} refresh={refresh} />
            : <Controlled section={s} all={all.filter((d) => d.section === s)} canEdit={canEdit} params={params} set={set} onRead={setReading} />}
        </div>
      )}
      {open && q.data && <Reader doc={open} lib={q.data} onClose={() => setReading(null)} onEdit={() => setEditing(open)} refresh={refresh} />}
      {editing && q.data && <Editor doc={editing === 'new' ? null : editing} lib={q.data} section={s} onClose={(changed) => { setEditing(null); if (changed) refresh(); }} />}
    </section>
  );
}

// ---- section 1: lessons, best practices, learnings from incidents --------------------------------------------

function Lessons({ all, canEdit, params, set, onRead, onEdit, refresh }: {
  all: KnowledgeDoc[]; canEdit: boolean; params: URLSearchParams; set: (k: string, v: string) => void;
  onRead: (d: KnowledgeDoc) => void; onEdit: (d: KnowledgeDoc) => void; refresh: () => void;
}) {
  const f = { q: params.get('q') ?? '', type: params.get('type') ?? '', category: params.get('category') ?? '', failure: params.get('failure') ?? '', place: params.get('place') ?? '',
    sort: (params.get('sort') === 'az' ? 'az' : 'newest') as 'az' | 'newest', duplicates: params.get('dups') === '1' };
  const lib = useMemo(() => filterLibrary(all, f), [all, f.q, f.type, f.category, f.failure, f.place, f.sort, f.duplicates]); // eslint-disable-line react-hooks/exhaustive-deps
  const hero = useMemo(() => lessonOfWeek(all, today()), [all]);
  const [present, setPresent] = useState<KnowledgeDoc[] | null>(null);
  const pick = async (d: KnowledgeDoc) => { await api(`/knowledge/${d.id}/lesson-of-week`, { method: 'POST' }); refresh(); };
  const chip = (on: boolean) => cx('h-(--layout-control-sm) rounded-pill border px-3 text-sm font-semibold', on ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text');

  if (!all.length) return <EmptyState title="No lessons yet">{canEdit ? 'Add lessons learnt, best practices and learnings from incidents with Add document. File each one under a country or Global.' : 'Nothing has been added yet.'}</EmptyState>;
  return (
    <>
      {hero && (
        <Card className="mb-4 border-l-4 border-l-warning">
          <p className="label-caps mb-1 flex items-center gap-1 text-warning"><Star aria-hidden className="size-3.5" />Lesson of the week</p>
          <h2 className="font-display text-xl font-bold">{hero.title}</h2>
          <p className="mt-1 text-xs text-text-muted">{hero.doc_type && DOC_TYPES[hero.doc_type]} · {hero.country}{hero.category && ` · ${hero.category}`}{hero.published_on && ` · ${formatDate(hero.published_on)}`}</p>
          {hero.summary && <p className="mt-2 max-w-3xl text-sm">{hero.summary}</p>}
          {hero.key_action && <p className="mt-2 max-w-3xl text-sm"><span className="font-semibold">Key action: </span>{hero.key_action}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => setPresent([hero])}><Play aria-hidden className="size-4" />Present to the crew</Button>
            <Button size="sm" onClick={() => onRead(hero)}><BookOpen aria-hidden className="size-4" />Read</Button>
          </div>
        </Card>
      )}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <SearchBox value={f.q} onChange={(v) => set('q', v)} />
        <Select aria-label="Country" className={inputSized('w-44')} value={f.place} onChange={(e) => set('place', e.target.value)}>
          <option value="">All countries</option>{lib.places.map((x) => <option key={x.value} value={x.value}>{x.value} ({x.n})</option>)}
        </Select>
        <Select aria-label="Failure type" className={inputSized('w-52')} value={f.failure} onChange={(e) => set('failure', e.target.value)}>
          <option value="">All failure types</option>{lib.failures.map((x) => <option key={x.value} value={x.value}>{x.value} ({x.n})</option>)}
        </Select>
        <Select aria-label="Sort" className={inputSized('w-32')} value={f.sort} onChange={(e) => set('sort', e.target.value === 'az' ? 'az' : '')}><option value="newest">Newest</option><option value="az">A → Z</option></Select>
        <label className="flex h-(--layout-control-md) items-center gap-2 text-sm"><input type="checkbox" checked={f.duplicates} onChange={(e) => set('dups', e.target.checked ? '1' : '')} />Show duplicates</label>
        {lib.docs.length > 0 && <Button className="ml-auto" onClick={() => setPresent(lib.docs)}><Play aria-hidden className="size-4" />Present these {lib.docs.length} as a toolbox talk</Button>}
      </div>
      <div role="group" aria-label="Document type" className="mb-2 flex flex-wrap gap-1.5">
        <button type="button" className={chip(!f.type)} onClick={() => set('type', '')}>All types</button>
        {lib.types.map((t) => <button key={t.value} type="button" aria-pressed={f.type === t.value} className={chip(f.type === t.value)} onClick={() => set('type', f.type === t.value ? '' : t.value)}>{DOC_TYPES[t.value as DocType]} ({t.n})</button>)}
      </div>
      <div role="group" aria-label="Category" className="mb-4 flex flex-wrap gap-1.5">
        <button type="button" className={chip(!f.category)} onClick={() => set('category', '')}>All categories</button>
        {lib.categories.map((t) => <button key={t.value} type="button" aria-pressed={f.category === t.value} className={chip(f.category === t.value)} onClick={() => set('category', f.category === t.value ? '' : t.value)}>{t.value} ({t.n})</button>)}
      </div>
      {!lib.docs.length && <EmptyState title="Nothing matches">Clear a filter or search for something else.</EmptyState>}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {lib.docs.map((d) => (
          <li key={d.id}>
            <Card className={cx('flex h-full flex-col', (d.duplicate_of || d.retired_at) && 'opacity-70')}>
              <p className="label-caps text-text-muted">{d.doc_type && DOC_TYPES[d.doc_type]} · {d.country}{d.duplicate_of && ' · duplicate'}{d.retired_at && ' · retired'}</p>
              <h3 className="mt-1 font-display text-base font-bold">{d.title}</h3>
              {d.summary && <p className="mt-1 line-clamp-3 text-sm text-text-muted">{d.summary}</p>}
              {d.failure_types.length > 0 && <p className="mt-2 flex flex-wrap gap-1">{d.failure_types.map((t) => <span key={t} className="rounded-sm bg-surface-3 px-1.5 text-xs">{t}</span>)}</p>}
              <p className="mt-2 text-xs text-text-subtle">
                {d.category}{d.category && ' · '}{d.published_on ? formatDate(d.published_on) : 'no date'}
                {d.doc_no && <> · <span className="font-mono">{d.doc_no}</span></>}{d.rilr_ref && <> · <span className="font-mono">{d.rilr_ref}</span></>}
              </p>
              <div className="mt-auto flex flex-wrap gap-1 pt-3">
                <Button size="sm" onClick={() => onRead(d)}><BookOpen aria-hidden className="size-3.5" />Read</Button>
                {d.file && <a className={linkBtn} href={fileUrl(d.id, d.file)} download={d.file.file_name}><Download aria-hidden className="size-3.5" />Download</a>}
                <Button size="sm" variant="ghost" onClick={() => setPresent([d])}><Play aria-hidden className="size-3.5" />Present</Button>
                {canEdit && <Button size="sm" variant="ghost" aria-label={`Edit ${d.title}`} onClick={() => onEdit(d)}><Pencil aria-hidden className="size-3.5" /></Button>}
                {canEdit && !d.duplicate_of && !d.retired_at && hero?.id !== d.id && <Button size="sm" variant="ghost" aria-label={`Make ${d.title} the lesson of the week`} title="Make this the lesson of the week" onClick={() => pick(d)}><Star aria-hidden className="size-3.5" /></Button>}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {present && <Present docs={present} onClose={() => setPresent(null)} />}
    </>
  );
}

function SearchBox({ value, onChange, placeholder = 'Search titles, numbers, summaries' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="relative w-full sm:w-72">
      <span className="sr-only">Search</span>
      <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-text-subtle" />
      <input type="search" className={inputSized('w-full pl-8')} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// ---- sections 2 and 3: SOPs and client procedures ---------------------------------------------------------------

function Controlled({ section, all, canEdit, params, set, onRead }: {
  section: 'sop' | 'client'; all: KnowledgeDoc[]; canEdit: boolean; params: URLSearchParams; set: (k: string, v: string) => void; onRead: (d: KnowledgeDoc) => void;
}) {
  const qText = params.get('q') ?? '';
  const company = section === 'sop' ? params.get('company') ?? '' : '';
  const place = params.get('place') ?? '';
  const places = groupByPlace(all).map((g) => g.place);
  const shown = all.filter((d) => matches(d, qText) && (!company || d.company === company) && (!place || d.country === place));
  const groups = groupByPlace(shown);
  const chip = (on: boolean) => cx('h-(--layout-control-sm) rounded-pill border px-3 text-sm font-semibold', on ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text');
  const what = section === 'sop' ? 'SOPs' : 'client procedures';

  if (!all.length) {
    return <EmptyState title={`No ${what} yet`}>{canEdit
      ? section === 'sop' ? 'Add an SOP with Add document: pick SLK Standard Operating Procedure, then Global or a country, and the company.' : 'Add a client procedure with Add document: pick Client procedure, the country and the client. It shows on every job in that country.'
      : 'Nothing has been added yet.'}</EmptyState>;
  }
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <SearchBox value={qText} onChange={(v) => set('q', v)} placeholder={section === 'sop' ? 'Search SOP titles and numbers' : 'Search procedures and clients'} />
        <Select aria-label="Country" className={inputSized('w-44')} value={place} onChange={(e) => set('place', e.target.value)}>
          <option value="">All countries</option>{places.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
      </div>
      {section === 'sop' && (
        <div role="group" aria-label="Company" className="mb-4 flex flex-wrap gap-1.5">
          <button type="button" className={chip(!company)} onClick={() => set('company', '')}>All companies</button>
          {SOP_COMPANIES.map((c) => <button key={c} type="button" aria-pressed={company === c} className={chip(company === c)} onClick={() => set('company', company === c ? '' : c)}>{c} ({all.filter((d) => d.company === c).length})</button>)}
        </div>
      )}
      {!shown.length && <EmptyState title="Nothing matches">Clear a filter or search for something else.</EmptyState>}
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <Card key={g.place} className="p-0">
            <h2 className="flex items-baseline gap-2 border-b border-border px-4 py-2.5 font-display text-base font-bold">
              {g.place}<span className="font-mono text-xs font-normal text-text-muted">{g.docs.length}</span>
            </h2>
            {section === 'client'
              ? groupClients(g.docs).map(([client, docs]) => (
                <div key={client}>
                  <p className="label-caps bg-surface-2 px-4 py-1 text-text-muted">{client}</p>
                  <DocList docs={docs} onRead={onRead} />
                </div>
              ))
              : <DocList docs={[...g.docs].sort((a, b) => (a.doc_no ?? a.title).localeCompare(b.doc_no ?? b.title))} onRead={onRead} />}
          </Card>
        ))}
      </div>
    </>
  );
}

const groupClients = (docs: KnowledgeDoc[]) => {
  const m = new Map<string, KnowledgeDoc[]>();
  for (const d of docs) m.set(d.client ?? '', [...(m.get(d.client ?? '') ?? []), d]);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([c, list]) => [c, list.sort((a, b) => a.title.localeCompare(b.title))] as const);
};

function DocList({ docs, onRead }: { docs: KnowledgeDoc[]; onRead: (d: KnowledgeDoc) => void }) {
  const now = today();
  return (
    <ul className="divide-y divide-border">
      {docs.map((d) => {
        const review = reviewState(d.review_due, now);
        return (
          <li key={d.id} className={cx('flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5', d.retired_at && 'opacity-60')}>
            <FileText aria-hidden className="size-4 shrink-0 text-text-subtle" />
            <div className="min-w-0 flex-1 basis-56">
              <button type="button" className="text-left font-semibold hover:underline" onClick={() => onRead(d)}>{d.title}</button>
              <p className="text-xs text-text-muted">
                {d.doc_no && <span className="font-mono">{d.doc_no}</span>}{d.doc_no && ' · '}Rev {d.revision}
                {d.company && ` · ${d.company}`}{d.published_on && ` · ${formatDate(d.published_on)}`}
                {review && <span className={cx('ml-1.5 font-semibold', review === 'overdue' ? 'text-danger' : 'text-warning')}>· review {review === 'overdue' ? 'overdue' : 'due'} {formatDate(d.review_due!)}</span>}
                {d.retired_at && ' · retired'}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {d.file
                ? <a className={linkBtn} href={fileUrl(d.id, d.file)} download={d.file.file_name} aria-label={`Download ${d.title}`}><Download aria-hidden className="size-3.5" />Download</a>
                : <span className="px-2 text-xs text-text-subtle">no file yet</span>}
              <Button size="sm" variant="ghost" onClick={() => onRead(d)}><BookOpen aria-hidden className="size-3.5" />Open</Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---- reader: details, files, revisions ---------------------------------------------------------------------------

function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4">
      <Card className={cx('max-h-[90vh] w-full overflow-y-auto', wide ? 'max-w-3xl' : 'max-w-xl')}>
        <div className="mb-3 flex items-start gap-3"><h2 className="min-w-0 flex-1 font-display text-lg font-bold">{title}</h2><Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}><X aria-hidden className="size-4" /></Button></div>
        {children}
      </Card>
    </div>
  );
}

function Reader({ doc, lib, onClose, onEdit, refresh }: { doc: KnowledgeDoc; lib: Library; onClose: () => void; onEdit: () => void; refresh: () => void }) {
  const [present, setPresent] = useState(false);
  const original = lib.docs.find((x) => x.id === doc.duplicate_of);
  const lesson = doc.section === 'lesson';
  const review = reviewState(doc.review_due, today());
  const retire = async () => { await api(`/knowledge/${doc.id}/${doc.retired_at ? 'restore' : 'retire'}`, { method: 'POST' }); refresh(); };
  const meta = [ADD_TYPES[addTypeOf(doc)].label, doc.country, doc.company, doc.client, doc.category, doc.published_on && formatDate(doc.published_on), doc.rilr_ref].filter(Boolean).join(' · ');
  if (present) return <Present docs={[doc]} onClose={() => setPresent(false)} />;
  return (
    <Dialog title={doc.title} onClose={onClose} wide>
      <p className="text-xs text-text-muted">{doc.doc_no && <span className="font-mono">{doc.doc_no} · </span>}Rev {doc.revision} · {meta}</p>
      {doc.retired_at && <div className="mt-2"><Banner tone="warning">Retired. Only admins see this document.</Banner></div>}
      {original && <div className="mt-2"><Banner tone="info">This repeats “{original.title}”.</Banner></div>}
      {review && <div className="mt-2"><Banner tone={review === 'overdue' ? 'danger' : 'warning'}>Review {review === 'overdue' ? 'was due' : 'is due'} on {formatDate(doc.review_due!)}.</Banner></div>}
      {doc.summary && <p className="mt-3 whitespace-pre-wrap text-sm">{doc.summary}</p>}
      {doc.key_action && <div className="mt-3 rounded-md bg-warning-subtle p-3 text-sm"><span className="font-semibold">Key action: </span>{doc.key_action}</div>}
      {doc.failure_types.length > 0 && <p className="mt-3 flex flex-wrap gap-1">{doc.failure_types.map((t) => <span key={t} className="rounded-sm bg-surface-3 px-1.5 text-xs">{t}</span>)}</p>}
      <Files doc={doc} onChange={refresh} />
      {lesson && <div className="mt-4 rounded-md border border-border p-3"><Attachments entity="knowledge" id={doc.id} title="Supporting files" /></div>}
      <div className="mt-4 flex flex-wrap gap-2">
        {lesson && <Button variant="primary" onClick={() => setPresent(true)}><Play aria-hidden className="size-4" />Present to the crew</Button>}
        {doc.source_ref && <a href={doc.source_ref} target="_blank" rel="noreferrer noopener" className="inline-flex h-(--layout-control-md) items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold hover:bg-surface-2"><ExternalLink aria-hidden className="size-4" />Open the source link</a>}
        {lib.canEdit && <Button onClick={onEdit}><Pencil aria-hidden className="size-4" />Edit details</Button>}
        {lib.isAdmin && <Button variant={doc.retired_at ? 'secondary' : 'danger'} className="ml-auto" onClick={retire}>{doc.retired_at ? <><RotateCcw aria-hidden className="size-4" />Restore</> : <><Archive aria-hidden className="size-4" />Retire</>}</Button>}
      </div>
    </Dialog>
  );
}

/** The document file (everyone), the editable version and the revision history (admins), and uploads. */
function Files({ doc, onChange }: { doc: KnowledgeDoc; onChange: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['knowledge-files', doc.id], queryFn: () => api<{ files: FileRow[]; revision: number; isAdmin: boolean; canUpload: boolean; storage: boolean }>(`/knowledge/${doc.id}/files`) });
  const [mode, setMode] = useState<'replace' | 'source' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const files = q.data?.files ?? [];
  const current = files.find((f) => f.kind === 'published' && !f.superseded_at);
  const source = files.find((f) => f.kind === 'source' && !f.superseded_at);
  const history = files.filter((f) => f.superseded_at);
  const admin = !!q.data?.isAdmin;
  const send = async (file: File | undefined, kind: 'published' | 'source') => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      await uploadFile(doc.id, file, kind, mode === 'replace' ? note.trim() : undefined);
      setMode(null); setNote('');
      qc.invalidateQueries({ queryKey: ['knowledge-files', doc.id] }); onChange();
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); if (pick.current) pick.current.value = ''; }
  };
  const row = (f: FileRow, label: string) => (
    <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <div className="min-w-0 flex-1 basis-48">
        <p className="label-caps text-text-muted">{label}</p>
        <p className="truncate text-sm font-semibold">{f.file_name}</p>
        <p className="text-xs text-text-subtle">Rev {f.revision} · {sizeText(f.size_bytes)} · {f.uploaded_by_name} · {formatDate(f.uploaded_at.slice(0, 10))}{f.change_note && ` · ${f.change_note}`}</p>
      </div>
      <div className="flex gap-1">
        {INLINE.has(f.content_type) && <a className={linkBtn} href={fileUrl(doc.id, f, true)} target="_blank" rel="noreferrer"><Eye aria-hidden className="size-3.5" />View</a>}
        <a className={linkBtn} href={fileUrl(doc.id, f)} download={f.file_name}><Download aria-hidden className="size-3.5" />Download</a>
      </div>
    </li>
  );
  if (q.isLoading) return <Skeleton className="mt-4 h-16" />;
  if (q.isError) return <div className="mt-4"><Banner tone="danger">{q.error.message}</Banner></div>;
  const canFirst = !!q.data?.canUpload && !current;
  return (
    <div className="mt-4 rounded-md border border-border p-3">
      <h3 className="font-display text-sm font-bold">Document</h3>
      {error && <div className="mt-2"><Banner tone="danger">{error}</Banner></div>}
      {!q.data?.storage && <p className="mt-1 text-xs text-text-muted">File storage isn’t set up on the server yet.</p>}
      <ul className="divide-y divide-border">
        {current && row(current, `Current document · Rev ${current.revision}`)}
        {admin && source && row(source, 'Editable version (admins only)')}
      </ul>
      {!current && <p className="mt-1 text-sm text-text-muted">No file yet.{canFirst ? ' Add the document file below.' : ''}</p>}
      {canFirst && (
        <label className={cx(linkBtn, 'mt-2 cursor-pointer')}>
          <Upload aria-hidden className="size-3.5" />{busy ? 'Uploading…' : 'Add the document file'}
          <input ref={pick} type="file" accept={ACCEPT} className="sr-only" disabled={busy} onChange={(e) => send(e.target.files?.[0], 'published')} />
        </label>
      )}
      {admin && q.data?.storage && (
        <div className="mt-2 flex flex-wrap gap-2">
          {current && <Button size="sm" variant={mode === 'replace' ? 'primary' : 'secondary'} onClick={() => setMode(mode === 'replace' ? null : 'replace')}><Upload aria-hidden className="size-3.5" />Replace with a new revision</Button>}
          <label className={cx(linkBtn, 'cursor-pointer')}>
            <Upload aria-hidden className="size-3.5" />{source ? 'Replace the editable version' : 'Add the editable version'}
            <input type="file" accept={EDITABLE_ACCEPT} className="sr-only" disabled={busy} onChange={(e) => send(e.target.files?.[0], 'source')} />
          </label>
          {history.length > 0 && <Button size="sm" variant="ghost" onClick={() => setShowHistory(!showHistory)}><History aria-hidden className="size-3.5" />{showHistory ? 'Hide' : 'Show'} older revisions ({history.length})</Button>}
        </div>
      )}
      {mode === 'replace' && (
        <div className="mt-3 rounded-md bg-surface-2 p-3">
          <p className="text-sm">The new file becomes <strong>Rev {(q.data?.revision ?? 0) + 1}</strong>. Rev {q.data?.revision} is kept and only admins can open it.</p>
          <Field id="kf-note" label="What changed"><input id="kf-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Updated the pressure test steps" /></Field>
          <label className={cx(linkBtn, 'mt-2', note.trim() ? 'cursor-pointer' : 'pointer-events-none opacity-50')}>
            <Upload aria-hidden className="size-3.5" />{busy ? 'Uploading…' : 'Pick the new file'}
            <input type="file" accept={ACCEPT} className="sr-only" disabled={busy || !note.trim()} onChange={(e) => send(e.target.files?.[0], 'published')} />
          </label>
        </div>
      )}
      {showHistory && history.length > 0 && <ul className="mt-2 divide-y divide-border border-t border-border">{history.map((f) => row(f, f.kind === 'source' ? `Editable version · Rev ${f.revision}` : `Rev ${f.revision}, replaced`))}</ul>}
    </div>
  );
}

/** Toolbox talk: one document per slide, large type, arrow keys to move, Escape to leave. */
function Present({ docs, onClose }: { docs: KnowledgeDoc[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const d = docs[i];
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); setI((x) => Math.min(docs.length - 1, x + 1)); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', key);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    return () => { window.removeEventListener('keydown', key); if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined); };
  }, [docs.length, onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Toolbox talk" className="fixed inset-0 z-[60] flex flex-col bg-bg p-6 md:p-12">
      <div className="flex items-center gap-3 text-sm text-text-muted">
        <span className="label-caps">Toolbox talk · {i + 1} of {docs.length}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}><X aria-hidden className="size-4" />Close</Button>
      </div>
      <div aria-live="polite" className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center">
        <p className="label-caps text-warning">{d.doc_type && DOC_TYPES[d.doc_type]}{d.category && ` · ${d.category}`}</p>
        <h2 className="mt-2 font-display text-3xl font-extrabold md:text-5xl">{d.title}</h2>
        {d.summary && <p className="mt-6 whitespace-pre-wrap text-lg md:text-2xl">{d.summary}</p>}
        {d.key_action && <p className="mt-8 rounded-md bg-warning-subtle p-4 text-lg font-semibold text-warning md:text-2xl">Key action: {d.key_action}</p>}
        {d.failure_types.length > 0 && <p className="mt-6 text-sm text-text-muted">{d.failure_types.join(' · ')}</p>}
      </div>
      <div className="flex items-center justify-center gap-3">
        <Button onClick={() => setI(i - 1)} disabled={i === 0}><ChevronLeft aria-hidden className="size-4" />Previous</Button>
        <Button variant="primary" onClick={() => (i === docs.length - 1 ? onClose() : setI(i + 1))}>{i === docs.length - 1 ? 'Finish' : <>Next<ChevronRight aria-hidden className="size-4" /></>}</Button>
      </div>
    </div>
  );
}

// ---- add / edit ------------------------------------------------------------------------------------------------

function Editor({ doc, lib, section, onClose }: { doc: KnowledgeDoc | null; lib: Library; section: Section; onClose: (changed: boolean) => void }) {
  const startType: AddType = doc ? addTypeOf(doc) : section === 'lesson' ? 'lesson_learnt' : section;
  const [f, setF] = useState({
    type: startType, country: doc?.country ?? (section === 'client' ? lib.places[0] ?? '' : GLOBAL), company: doc?.company ?? 'NESR', client: doc?.client ?? '',
    category: doc?.category ?? '', title: doc?.title ?? '', doc_no: doc?.doc_no ?? '', summary: doc?.summary ?? '', key_action: doc?.key_action ?? '',
    failure_types: (doc?.failure_types ?? []).join(', '), published_on: doc?.published_on ?? '', review_due: doc?.review_due ?? '',
    rilr_ref: doc?.rilr_ref ?? '', source_ref: doc?.source_ref ?? '', duplicate_of: doc?.duplicate_of ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sec = ADD_TYPES[f.type].section;
  const lesson = sec === 'lesson';
  const places = sec === 'client' ? lib.places : [GLOBAL, ...lib.places];
  // an entry filed under a country the person doesn't cover keeps that country when it is corrected
  const placeOptions = doc && !places.includes(doc.country) ? [doc.country, ...places] : places;
  const categories = [...new Set(lib.docs.filter((d) => d.section === sec).map((d) => d.category).filter((c): c is string => !!c))].sort();
  const setType = (type: AddType) => {
    const next = ADD_TYPES[type].section;
    setF({ ...f, type, country: next === 'client' && f.country === GLOBAL ? lib.places[0] ?? '' : f.country });
  };
  const save = async () => {
    setBusy(true); setError(null);
    const body = { ...f, failure_types: f.failure_types.split(',').map((x) => x.trim()).filter(Boolean) };
    try {
      let id = doc?.id;
      if (doc) await api(`/knowledge/${doc.id}`, { method: 'PUT', json: body });
      else id = (await api<{ id: string }>('/knowledge', { method: 'POST', json: body })).id;
      if (id && file) await uploadFile(id, file, 'published');
      if (id && source) await uploadFile(id, source, 'source');
      onClose(true);
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  const input = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}, hint?: string) => (
    <Field id={`kd-${k}`} label={label} hint={hint}><input id={`kd-${k}`} className={inputClass} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></Field>
  );
  const nextNo = `${docPrefix({ section: sec, country: f.country || GLOBAL, company: f.company })}-001`;
  return (
    <Dialog title={doc ? 'Edit document' : 'Add document'} onClose={() => onClose(false)} wide>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="kd-type" label="Type" hint={`Filed under ${SECTIONS[sec]}`}>
          <Select id="kd-type" className={inputClass} value={f.type} onChange={(e) => setType(e.target.value as AddType)}>
            <optgroup label={SECTIONS.lesson}>{(['lesson_learnt', 'best_practice', 'learning_from_incident'] as const).map((k) => <option key={k} value={k}>{ADD_TYPES[k].label}</option>)}</optgroup>
            <optgroup label="Procedures"><option value="sop">{ADD_TYPES.sop.label}</option><option value="client">{ADD_TYPES.client.label}</option></optgroup>
          </Select>
        </Field>
        <Field id="kd-country" label={sec === 'client' ? 'Country' : 'Country or Global'}>
          <Select id="kd-country" className={inputClass} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{placeOptions.map((c) => <option key={c}>{c}</option>)}</Select>
        </Field>
        {sec === 'sop' && (
          <Field id="kd-company" label="Company">
            <Select id="kd-company" className={inputClass} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })}>{SOP_COMPANIES.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
        )}
        {sec === 'client' && <>{input('client', 'Client', { list: 'kd-clients', placeholder: 'e.g. Saudi Aramco' }, 'Shown on jobs in this country, this client first')}<datalist id="kd-clients">{lib.clients.map((c) => <option key={c} value={c} />)}</datalist></>}
        <div className="sm:col-span-2">{input('title', 'Title')}</div>
        {input('doc_no', 'Document number', { placeholder: doc ? '' : `Leave blank for ${nextNo.replace(/001$/, 'NNN')}` }, doc ? undefined : 'Type the official number, or leave blank and the next one is given')}
        {input('category', lesson ? 'Category' : 'Category (optional)', { list: 'kd-cats', placeholder: 'e.g. Wireline, Pressure control' })}
        <datalist id="kd-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <div className="sm:col-span-2"><Field id="kd-summary" label={lesson ? 'Summary' : 'Scope / summary'}><textarea id="kd-summary" rows={3} className={cx(inputClass, 'h-auto py-2')} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field></div>
        {lesson && <div className="sm:col-span-2">{input('key_action', 'Key action')}</div>}
        {lesson && input('failure_types', 'Failure types', { placeholder: 'Comma separated, e.g. Wire parted, Stuck tool' })}
        {input('published_on', lesson ? 'Published' : 'Issued', { type: 'date' })}
        {!lesson && input('review_due', 'Next review', { type: 'date' })}
        {lesson && input('rilr_ref', 'RILR / reference')}
        {input('source_ref', 'Link to the source (optional)', { type: 'url', placeholder: 'https://…sharepoint.com/…' })}
        {lesson && (
          <Field id="kd-dup" label="Duplicate of" hint="Hidden from the library unless Show duplicates is on">
            <Select id="kd-dup" className={inputClass} value={f.duplicate_of} onChange={(e) => setF({ ...f, duplicate_of: e.target.value })}>
              <option value="">Not a duplicate</option>{lib.docs.filter((d) => d.section === 'lesson' && d.id !== doc?.id && !d.duplicate_of).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </Select>
          </Field>
        )}
        {!doc && (
          <div className="sm:col-span-2 grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
            <Field id="kd-file" label="Document file" hint="PDF preferred. Everyone can download it">
              <input id="kd-file" type="file" accept={ACCEPT} className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            {lib.isAdmin && (
              <Field id="kd-source" label="Editable version" hint="Word or Excel. Only admins see it">
                <input id="kd-source" type="file" accept={EDITABLE_ACCEPT} className="text-sm" onChange={(e) => setSource(e.target.files?.[0] ?? null)} />
              </Field>
            )}
          </div>
        )}
      </div>
      <Button className="mt-4" variant="primary" loading={busy} disabled={!f.title.trim() || (lesson && !f.category.trim()) || (sec === 'client' && !f.client.trim())} onClick={save}>{doc ? 'Save changes' : 'Add document'}</Button>
    </Dialog>
  );
}

// ---- on the job: client procedures for the job's country ---------------------------------------------------------

/** Client procedures to read before the job: the job's country, its client first. Hidden without the Knowledge Hub tab. */
export function ClientProcedures({ country, client }: { country: string; client?: string | null }) {
  const q = useQuery({ queryKey: ['knowledge'], queryFn: () => api<Library>('/knowledge'), retry: false });
  if (!q.data) return null;
  const docs = proceduresForJob(q.data.docs, country, client);
  if (!docs.length) return <p className="text-sm text-text-muted">No client procedures for {country} yet. They are added in the <Link className="underline" to="/knowledge?s=client">Knowledge Hub</Link>.</p>;
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {docs.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-sm font-semibold">{d.title}</p>
            <p className="text-xs text-text-muted">{d.client}{client && d.client?.toLowerCase() === client.toLowerCase() && ' · this job’s client'}{d.doc_no && <> · <span className="font-mono">{d.doc_no}</span></>} · Rev {d.revision}</p>
          </div>
          {d.file
            ? <a className={linkBtn} href={fileUrl(d.id, d.file)} download={d.file.file_name}><Download aria-hidden className="size-3.5" />Download</a>
            : <Link className={linkBtn} to="/knowledge?s=client">Open in the Knowledge Hub</Link>}
        </li>
      ))}
    </ul>
  );
}
