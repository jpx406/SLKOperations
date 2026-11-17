import { Select } from '../components/Select';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive as ArchiveIcon, BookOpen, Download, ExternalLink, FileText, Files, Info, Network, Pencil, Play, Plus, QrCode, RotateCcw, Search, Sparkles, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  ADD_TYPES, DOC_TYPES, GLOBAL, SECTIONS, SOP_COMPANIES, addTypeOf, filterLibrary, groupByPlace, hasCompany, isSection, lessonOfWeek, matches, proceduresForJob, reviewState,
  type AddType, type DocType, type KnowledgeDoc, type Section,
} from '../../shared/knowledge';
import { expiryState, formatNumber, guessType, numberPrefix, splitBase } from '../../shared/knowledgeControl';
import type { Suggestion } from '../../shared/docAnalysis';
import { ApiError, api, formatDate } from '../api';
import { Attachments } from '../components/Attachments';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass, inputSized } from '../components/ui';
import { ACCEPT, DocState, Dialog, EDITABLE_ACCEPT, QrBlock, QrDialog, fileUrl, linkBtn, today, uploadFile, type Library } from './knowledge/common';
import { Archive, BatchAdd, Dashboard, ManualsView, Queue, Register, Settings } from './knowledge/Control';
import { MindMapDialog, MindMapPanel, Present } from './knowledge/Digest';
import { Revisions } from './knowledge/Revisions';

/** Read opens the PDF itself, in a new tab (stamped, as every download). Null when there is no PDF to open. */
const pdfHref = (d: KnowledgeDoc) => (d.file && d.file.content_type === 'application/pdf' ? fileUrl(d.id, d.file, true) : null);

// Knowledge Hub (S21, S43, 6z.13, 6z.14): lessons and best practices, SLK SOPs and client procedures, each under
// document control (draft, review, approval, published revision, history, stamped downloads), plus the reference
// manuals library, and for staff the approval queue, the register, the archive and the settings.

type View = Section | 'manuals' | 'dashboard' | 'queue' | 'register' | 'archive' | 'settings';
const VIEWS: Record<View, string> = {
  lesson: SECTIONS.lesson, sop: SECTIONS.sop, swi: SECTIONS.swi, form: SECTIONS.form, client: SECTIONS.client, manuals: 'Reference manuals',
  dashboard: 'Dashboard', queue: 'Queue', register: 'Register', archive: 'Archive', settings: 'Settings',
};

export function KnowledgeHub() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['knowledge'], queryFn: () => api<Library>('/knowledge') });
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const lib = q.data;
  const me = lib?.me;
  const staff = !!me && (me.admin || me.editor || me.reviewer || me.approver);
  const views: View[] = ['lesson', 'sop', 'swi', 'form', 'client', 'manuals', ...(staff ? (['dashboard', 'queue', 'register'] as View[]) : []), ...(me && (me.admin || me.approver) ? (['archive'] as View[]) : []), ...(staff ? (['settings'] as View[]) : [])];
  const raw = params.get('s') ?? params.get('view') ?? 'lesson';
  const view: View = (views as string[]).includes(raw) ? (raw as View) : 'lesson';
  const section: Section = isSection(view) ? view : 'lesson';
  const all = lib?.docs ?? [];
  const reading = params.get('doc');
  const [editing, setEditing] = useState<KnowledgeDoc | 'new' | null>(null);
  const [batch, setBatch] = useState(false);
  const [qr, setQr] = useState<KnowledgeDoc | null>(null);
  const [map, setMap] = useState<KnowledgeDoc | null>(null);
  const canEdit = !!lib?.canEdit;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['knowledge'] }); qc.invalidateQueries({ queryKey: ['knowledge-queue'] }); qc.invalidateQueries({ queryKey: ['knowledge-register'] }); };
  const counts = (sec: Section) => all.filter((d) => d.section === sec && !d.duplicate_of && d.published_at).length;
  const open = (id: string) => set('doc', id);
  const pick = (v: View) => { const n = new URLSearchParams(); if (v !== 'lesson') n.set('s', v); setParams(n, { replace: true }); };

  return (
    <section aria-labelledby="kh-title">
      <PageTitle aside={canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setBatch(true)}><Files aria-hidden className="size-4" />Add several</Button>
          <Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Add document</Button>
        </div>
      )}>
        <span id="kh-title">Knowledge Hub</span>
      </PageTitle>
      <div role="tablist" aria-label="Knowledge Hub sections" className="mb-4 flex flex-wrap gap-2">
        {views.map((k) => (
          <button key={k} role="tab" aria-selected={view === k} onClick={() => pick(k)}
            className={cx('h-(--layout-control-sm) rounded-pill border px-3.5 text-sm font-semibold', view === k ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text',
              k === 'dashboard' && 'ml-0 sm:ml-2')}>
            {VIEWS[k]}
            {isSection(k) && lib && <span className="ml-1 font-mono font-normal opacity-80">{counts(k)}</span>}
            {k === 'queue' && !!lib?.queueCount && <span className="ml-1 rounded-pill bg-warning px-1.5 font-mono text-xs text-on-accent">{lib.queueCount}</span>}
          </button>
        ))}
      </div>
      {q.isLoading && <Skeleton className="h-64" />}
      {q.isError && <Banner tone="danger">{q.error.message}</Banner>}
      {lib && (
        <div role="tabpanel" aria-label={VIEWS[view]}>
          {view === 'lesson' && <Lessons all={all.filter((d) => d.section === 'lesson')} canEdit={canEdit} params={params} set={set} onRead={(d) => open(d.id)} onEdit={setEditing} onQr={setQr} onMap={setMap} refresh={refresh} />}
          {isSection(view) && view !== 'lesson' && <Controlled section={view} all={all.filter((d) => d.section === view)} canEdit={canEdit} params={params} set={set} onRead={(d) => open(d.id)} onQr={setQr} onMap={setMap} />}
          {view === 'manuals' && <ManualsView />}
          {view === 'dashboard' && <Dashboard onOpen={open} />}
          {view === 'queue' && <Queue onOpen={open} />}
          {view === 'register' && <Register onOpen={open} />}
          {view === 'archive' && <Archive onOpen={open} onChange={refresh} />}
          {view === 'settings' && <Settings />}
        </div>
      )}
      {reading && lib && <Reader id={reading} lib={lib} onClose={() => set('doc', '')} onEdit={(d) => setEditing(d)} refresh={refresh} />}
      {editing && lib && <Editor doc={editing === 'new' ? null : editing} lib={lib} section={section} onClose={(changed, id) => { setEditing(null); if (changed) refresh(); if (id) open(id); }} />}
      {batch && lib && <BatchAdd lib={lib} section={section} onClose={(changed) => { setBatch(false); if (changed) refresh(); }} />}
      {qr && <QrDialog doc={qr} onClose={() => setQr(null)} />}
      {map && <MindMapDialog doc={map} canRemake={staff} onClose={() => setMap(null)} />}
    </section>
  );
}

/** Read: the PDF itself in a new tab; a document without a PDF opens its details instead. */
function ReadButton({ d, onRead, small }: { d: KnowledgeDoc; onRead: (d: KnowledgeDoc) => void; small?: boolean }) {
  const href = pdfHref(d);
  const icon = <BookOpen aria-hidden className={small ? 'size-3.5' : 'size-4'} />;
  return href
    ? <a className={cx(linkBtn, !small && 'h-(--layout-control-sm)')} href={href} target="_blank" rel="noreferrer" aria-label={`Read ${d.title} (PDF)`}>{icon}Read</a>
    : <Button size="sm" onClick={() => onRead(d)} aria-label={`Read ${d.title}`}>{icon}Read</Button>;
}

// ---- section 1: lessons, best practices, learnings from incidents --------------------------------------------

function Lessons({ all, canEdit, params, set, onRead, onEdit, onQr, onMap, refresh }: {
  all: KnowledgeDoc[]; canEdit: boolean; params: URLSearchParams; set: (k: string, v: string) => void;
  onRead: (d: KnowledgeDoc) => void; onEdit: (d: KnowledgeDoc) => void; onQr: (d: KnowledgeDoc) => void; onMap: (d: KnowledgeDoc) => void; refresh: () => void;
}) {
  const f = { q: params.get('q') ?? '', type: params.get('type') ?? '', category: params.get('category') ?? '', failure: params.get('failure') ?? '', place: params.get('place') ?? '',
    sort: (params.get('sort') === 'az' ? 'az' : 'newest') as 'az' | 'newest', duplicates: params.get('dups') === '1' };
  const lib = useMemo(() => filterLibrary(all, f), [all, f.q, f.type, f.category, f.failure, f.place, f.sort, f.duplicates]); // eslint-disable-line react-hooks/exhaustive-deps
  const published = useMemo(() => all.filter((d) => d.published_at), [all]);
  const hero = useMemo(() => lessonOfWeek(published, today()), [published]);
  const [present, setPresent] = useState<KnowledgeDoc[] | null>(null);
  const pick = async (d: KnowledgeDoc) => { await api(`/knowledge/${d.id}/lesson-of-week`, { method: 'POST' }); refresh(); };
  const chip = (on: boolean) => cx('h-(--layout-control-sm) rounded-pill border px-3 text-sm font-semibold', on ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text');
  const presentable = lib.docs.filter((d) => d.published_at);

  if (!all.length) return <EmptyState title="No lessons yet">{canEdit ? 'Add lessons learnt, best practices and learnings from incidents with Add document. Each one is reviewed and approved before readers see it.' : 'Nothing has been published yet.'}</EmptyState>;
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
            <ReadButton d={hero} onRead={onRead} />
            <Button size="sm" variant="ghost" onClick={() => onMap(hero)}><Network aria-hidden className="size-4" />Mind map</Button>
            <Button size="sm" variant="ghost" onClick={() => onRead(hero)}><Info aria-hidden className="size-4" />Details</Button>
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
        {presentable.length > 0 && <Button className="ml-auto" onClick={() => setPresent(presentable)}><Play aria-hidden className="size-4" />Present these {presentable.length} as a toolbox talk</Button>}
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
            <Card className={cx('flex h-full flex-col', (d.duplicate_of || !d.published_at) && 'opacity-80')}>
              <p className="label-caps flex flex-wrap items-center gap-1.5 text-text-muted">{d.doc_type && DOC_TYPES[d.doc_type]} · {d.country}{d.duplicate_of && ' · duplicate'} <DocState d={d} /></p>
              <h3 className="mt-1 font-display text-base font-bold"><button type="button" className="text-left hover:underline" onClick={() => onRead(d)}>{d.title}</button></h3>
              {d.summary && <p className="mt-1 line-clamp-3 text-sm text-text-muted">{d.summary}</p>}
              {d.failure_types.length > 0 && <p className="mt-2 flex flex-wrap gap-1">{d.failure_types.map((t) => <span key={t} className="rounded-sm bg-surface-3 px-1.5 text-xs">{t}</span>)}</p>}
              <p className="mt-2 text-xs text-text-subtle">
                {d.category}{d.category && ' · '}{d.published_on ? formatDate(d.published_on) : 'no date'}
                {d.doc_no && <> · <span className="font-mono">{d.doc_no}</span></>}{d.published_at && ` · Rev ${d.revision}`}{d.rilr_ref && <> · <span className="font-mono">{d.rilr_ref}</span></>}
              </p>
              <div className="mt-auto flex flex-wrap gap-1 pt-3">
                <ReadButton d={d} onRead={onRead} small />
                {d.file && <a className={linkBtn} href={fileUrl(d.id, d.file)} download={d.file.file_name} aria-label={`Download ${d.title}`}><Download aria-hidden className="size-3.5" /></a>}
                {d.published_at && <Button size="sm" variant="ghost" onClick={() => setPresent([d])}><Play aria-hidden className="size-3.5" />Present</Button>}
                {d.published_at && <Button size="sm" variant="ghost" aria-label={`Mind map of ${d.title}`} title="Mind map" onClick={() => onMap(d)}><Network aria-hidden className="size-3.5" /></Button>}
                <Button size="sm" variant="ghost" aria-label={`Details of ${d.title}`} title="Details" onClick={() => onRead(d)}><Info aria-hidden className="size-3.5" /></Button>
                <Button size="sm" variant="ghost" aria-label={`QR code for ${d.title}`} title="QR code" onClick={() => onQr(d)}><QrCode aria-hidden className="size-3.5" /></Button>
                {canEdit && <Button size="sm" variant="ghost" aria-label={`Edit ${d.title}`} onClick={() => onEdit(d)}><Pencil aria-hidden className="size-3.5" /></Button>}
                {canEdit && d.published_at && !d.duplicate_of && hero?.id !== d.id && <Button size="sm" variant="ghost" aria-label={`Make ${d.title} the lesson of the week`} title="Make this the lesson of the week" onClick={() => pick(d)}><Star aria-hidden className="size-3.5" /></Button>}
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

const EMPTY: Record<Exclude<Section, 'lesson'>, [string, string]> = {
  sop: ['No SOPs yet', 'Add an SOP with Add document: upload the file, check what was read from it, then send it for review.'],
  swi: ['No work instructions yet', 'Add a Standard Work Instruction with Add document: upload the file, check what was read from it, then send it for review.'],
  form: ['No forms yet', 'Add a form with Add document: upload the Excel, Word, PowerPoint or PDF file. Once approved, everyone downloads it in its original format.'],
  client: ['No client procedures yet', 'Add a client procedure with Add document: upload the file and pick the country and the client. Once approved it shows on every job in that country.'],
};

function Controlled({ section, all, canEdit, params, set, onRead, onQr, onMap }: {
  section: Exclude<Section, 'lesson'>; all: KnowledgeDoc[]; canEdit: boolean; params: URLSearchParams; set: (k: string, v: string) => void; onRead: (d: KnowledgeDoc) => void;
  onQr: (d: KnowledgeDoc) => void; onMap: (d: KnowledgeDoc) => void;
}) {
  const qText = params.get('q') ?? '';
  const company = hasCompany(section) ? params.get('company') ?? '' : '';
  const place = params.get('place') ?? '';
  const places = groupByPlace(all).map((g) => g.place);
  const shown = all.filter((d) => matches(d, qText) && (!company || d.company === company) && (!place || d.country === place));
  const groups = groupByPlace(shown);
  const chip = (on: boolean) => cx('h-(--layout-control-sm) rounded-pill border px-3 text-sm font-semibold', on ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text');
  if (!all.length) return <EmptyState title={EMPTY[section][0]}>{canEdit ? EMPTY[section][1] : 'Nothing has been published yet.'}</EmptyState>;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <SearchBox value={qText} onChange={(v) => set('q', v)} placeholder={section === 'client' ? 'Search procedures and clients' : 'Search titles and numbers'} />
        <Select aria-label="Country" className={inputSized('w-44')} value={place} onChange={(e) => set('place', e.target.value)}>
          <option value="">All countries</option>{places.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
      </div>
      {hasCompany(section) && (
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
                  <DocList docs={docs} onRead={onRead} onQr={onQr} onMap={onMap} />
                </div>
              ))
              : <DocList docs={[...g.docs].sort((a, b) => (a.doc_no ?? a.title).localeCompare(b.doc_no ?? b.title))} onRead={onRead} onQr={onQr} onMap={onMap} />}
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

function Flags({ d }: { d: KnowledgeDoc }) {
  const now = today();
  const review = d.published_at ? reviewState(d.review_due, now) : null;
  const expiry = d.published_at ? expiryState(d.expires_on ?? null, now) : null;
  return (
    <>
      {review && <span className={cx('ml-1.5 font-semibold', review === 'overdue' ? 'text-danger' : 'text-warning')}>· review {review === 'overdue' ? 'overdue' : 'due'} {formatDate(d.review_due!)}</span>}
      {expiry && <span className={cx('ml-1.5 font-semibold', expiry === 'expired' ? 'text-danger' : 'text-warning')}>· {expiry === 'expired' ? 'expired' : 'expires'} {formatDate(d.expires_on!)}</span>}
      {d.origin === 'external' && <span className="ml-1.5">· external</span>}
    </>
  );
}

const extOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toUpperCase();

function DocList({ docs, onRead, onQr, onMap }: { docs: KnowledgeDoc[]; onRead: (d: KnowledgeDoc) => void; onQr: (d: KnowledgeDoc) => void; onMap: (d: KnowledgeDoc) => void }) {
  return (
    <ul className="divide-y divide-border">
      {docs.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
          <FileText aria-hidden className="size-4 shrink-0 text-text-subtle" />
          <div className="min-w-0 flex-1 basis-56">
            <button type="button" className="text-left font-semibold hover:underline" onClick={() => onRead(d)}>{d.title}</button>
            <p className="text-xs text-text-muted">
              {d.doc_no && <span className="font-mono">{d.doc_no}</span>}{d.doc_no && ' · '}{d.published_at ? `Rev ${d.revision}` : 'not published'}
              {d.company && ` · ${d.company}`}{d.is_form ? ' · form' : ''}{d.published_on && ` · ${formatDate(d.published_on)}`}
              <Flags d={d} />
            </p>
          </div>
          <DocState d={d} />
          <div className="flex flex-wrap gap-1">
            {pdfHref(d) && <ReadButton d={d} onRead={onRead} small />}
            {d.file && <a className={linkBtn} href={fileUrl(d.id, d.file)} download={d.file.file_name} aria-label={`Download ${d.title} (${extOf(d.file.file_name)})`}><Download aria-hidden className="size-3.5" />{d.section === 'form' ? extOf(d.file.file_name) : ''}</a>}
            {d.is_form && d.source ? <a className={linkBtn} href={fileUrl(d.id, d.source)} download={d.source.file_name} aria-label={`Download the form ${d.title} (${extOf(d.source.file_name)})`}><Download aria-hidden className="size-3.5" />{extOf(d.source.file_name)}</a> : null}
            {d.published_at && <Button size="sm" variant="ghost" aria-label={`Mind map of ${d.title}`} title="Mind map" onClick={() => onMap(d)}><Network aria-hidden className="size-3.5" /></Button>}
            <Button size="sm" variant="ghost" aria-label={`QR code for ${d.title}`} title="QR code" onClick={() => onQr(d)}><QrCode aria-hidden className="size-3.5" /></Button>
            <Button size="sm" variant="ghost" aria-label={`Details of ${d.title}`} onClick={() => onRead(d)}><Info aria-hidden className="size-3.5" />Details</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---- reader -------------------------------------------------------------------------------------------------------

function Reader({ id, lib, onClose, onEdit, refresh }: { id: string; lib: Library; onClose: () => void; onEdit: (d: KnowledgeDoc) => void; refresh: () => void }) {
  const inList = lib.docs.find((d) => d.id === id);
  // retired entries (from the archive) aren't in the list: fetch them
  const one = useQuery({ queryKey: ['knowledge-doc', id], queryFn: () => api<KnowledgeDoc>(`/knowledge/${id}`), enabled: !inList });
  const doc = inList ?? one.data;
  const [present, setPresent] = useState(false);
  const [qr, setQr] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  if (!doc) {
    return <Dialog title="Document" onClose={onClose}>{one.isError ? <Banner tone="danger">{one.error.message}</Banner> : <Skeleton className="h-24" />}</Dialog>;
  }
  const original = lib.docs.find((x) => x.id === doc.duplicate_of);
  const lesson = doc.section === 'lesson';
  const review = doc.published_at ? reviewState(doc.review_due, today()) : null;
  const expiry = doc.published_at ? expiryState(doc.expires_on ?? null, today()) : null;
  const mayRetire = lib.me.admin || lib.me.approver;
  const retire = async (on: boolean) => {
    setError(null);
    try {
      await api(`/knowledge/${doc.id}/${on ? 'retire' : 'restore'}`, { method: 'POST', json: { reason } });
      setRetiring(false); refresh(); qc.invalidateQueries({ queryKey: ['knowledge-archive'] }); qc.invalidateQueries({ queryKey: ['knowledge-doc', id] });
      if (on) onClose();
    } catch (e) { setError((e as ApiError).message); }
  };
  const meta = [ADD_TYPES[addTypeOf(doc)].label, doc.country, doc.company, doc.client, doc.category, doc.author && `Author ${doc.author}`, doc.published_on && formatDate(doc.published_on), doc.rilr_ref].filter(Boolean).join(' · ');
  if (present) return <Present docs={[doc]} onClose={() => setPresent(false)} />;
  return (
    <Dialog title={doc.title} onClose={onClose} wide>
      <p className="text-xs text-text-muted">{doc.doc_no && <span className="font-mono">{doc.doc_no} · </span>}{doc.published_at ? `Rev ${doc.revision}` : 'Not published'} · {meta}</p>
      {error && <div className="mt-2"><Banner tone="danger">{error}</Banner></div>}
      {doc.retired_at && <div className="mt-2"><Banner tone="warning">Retired {formatDate(doc.retired_at.slice(0, 10))}{doc.retire_reason && `: ${doc.retire_reason}`}. Only admins and approvers see it.</Banner></div>}
      {doc.origin === 'external' && <div className="mt-2"><Banner tone="info">External document: controlled distribution. Check with its owner before sharing it outside NESR.</Banner></div>}
      {original && <div className="mt-2"><Banner tone="info">This repeats “{original.title}”.</Banner></div>}
      {review && <div className="mt-2"><Banner tone={review === 'overdue' ? 'danger' : 'warning'}>Periodic review {review === 'overdue' ? 'was due' : 'is due'} on {formatDate(doc.review_due!)}.</Banner></div>}
      {expiry && <div className="mt-2"><Banner tone={expiry === 'expired' ? 'danger' : 'warning'}>{expiry === 'expired' ? 'Expired' : 'Expires'} on {formatDate(doc.expires_on!)}.</Banner></div>}
      {doc.summary && <p className="mt-3 whitespace-pre-wrap text-sm">{doc.summary}</p>}
      {doc.key_action && <div className="mt-3 rounded-md bg-warning-subtle p-3 text-sm"><span className="font-semibold">Key action: </span>{doc.key_action}</div>}
      {doc.failure_types.length > 0 && <p className="mt-3 flex flex-wrap gap-1">{doc.failure_types.map((t) => <span key={t} className="rounded-sm bg-surface-3 px-1.5 text-xs">{t}</span>)}</p>}
      <Revisions doc={doc} people={lib.people} onChange={() => { refresh(); qc.invalidateQueries({ queryKey: ['knowledge-doc', id] }); }} />
      {lesson && <div className="mt-4 rounded-md border border-border p-3"><Attachments entity="knowledge" id={doc.id} title="Supporting files" /></div>}
      {doc.published_at && (
        <details className="mt-4 rounded-md border border-border p-3" open={mapOpen} onToggle={(e) => setMapOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer font-display text-sm font-bold">Mind map: the whole document on one screen</summary>
          {mapOpen && <div className="mt-3"><MindMapPanel doc={doc} canRemake={lib.me.admin || lib.me.editor || lib.me.reviewer || lib.me.approver} /></div>}
        </details>
      )}
      {qr && <div className="mt-4"><QrBlock doc={doc} /></div>}
      {retiring && (
        <div className="mt-4 rounded-md bg-surface-2 p-3">
          <Field id="kr-retire" label="Why is it retired?"><input id="kr-retire" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Replaced by SOP-GL-NESR-014" /></Field>
          <Button className="mt-2" variant="danger" disabled={!reason.trim()} onClick={() => retire(true)}>Retire and move to the archive</Button>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {doc.published_at && <Button variant="primary" onClick={() => setPresent(true)}><Play aria-hidden className="size-4" />Present to the crew</Button>}
        {pdfHref(doc) && <a href={pdfHref(doc)!} target="_blank" rel="noreferrer" className="inline-flex h-(--layout-control-md) items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold hover:bg-surface-2"><BookOpen aria-hidden className="size-4" />Read the PDF</a>}
        {doc.source_ref && <a href={doc.source_ref} target="_blank" rel="noreferrer noopener" className="inline-flex h-(--layout-control-md) items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold hover:bg-surface-2"><ExternalLink aria-hidden className="size-4" />Open the source link</a>}
        <Button onClick={() => setQr(!qr)}><QrCode aria-hidden className="size-4" />QR code</Button>
        {lib.canEdit && !doc.retired_at && <Button onClick={() => onEdit(doc)}><Pencil aria-hidden className="size-4" />Edit details</Button>}
        {mayRetire && (doc.retired_at
          ? <Button className="ml-auto" onClick={() => retire(false)}><RotateCcw aria-hidden className="size-4" />Restore</Button>
          : <Button variant="danger" className="ml-auto" onClick={() => setRetiring(!retiring)}><ArchiveIcon aria-hidden className="size-4" />Retire</Button>)}
      </div>
    </Dialog>
  );
}

// ---- add / edit ------------------------------------------------------------------------------------------------

type Suggested = Suggestion & Record<string, unknown>;

/**
 * Add document starts with the file (6z.15): it is read by AI and every field is filled in from it, then the person
 * checks and corrects them before saving. Editing an existing entry goes straight to the fields.
 */
function Editor({ doc, lib, section, onClose }: { doc: KnowledgeDoc | null; lib: Library; section: Section; onClose: (changed: boolean, openId?: string) => void }) {
  const startType: AddType = doc ? addTypeOf(doc) : section === 'lesson' ? 'lesson_learnt' : section;
  const [f, setF] = useState({
    type: startType, country: doc?.country ?? (section === 'client' ? lib.places[0] ?? '' : GLOBAL), company: doc?.company ?? 'NESR', client: doc?.client ?? '',
    category: doc?.category ?? '', title: doc?.title ?? '', doc_no: doc?.doc_no ?? '', summary: doc?.summary ?? '', key_action: doc?.key_action ?? '',
    failure_types: (doc?.failure_types ?? []).join(', '), published_on: doc?.published_on ?? '', review_due: doc?.review_due ?? '',
    rilr_ref: doc?.rilr_ref ?? '', source_ref: doc?.source_ref ?? '', duplicate_of: doc?.duplicate_of ?? '',
    origin: doc?.origin ?? 'internal', author: doc?.author ?? '', is_form: !!doc?.is_form,
    revision: '0', revision_date: today(), expires_on: '', change_note: 'First issue',
  });
  const [step, setStep] = useState<'upload' | 'fields'>(doc ? 'fields' : 'upload');
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [read, setRead] = useState<{ from: string; filled: Set<string>; notes: string } | null>(null);
  const sec = ADD_TYPES[f.type].section;
  const lesson = sec === 'lesson';
  const places = sec === 'client' ? lib.places : [GLOBAL, ...lib.places];
  const placeOptions = doc && !places.includes(doc.country) ? [doc.country, ...places] : places;
  const categories = [...new Set(lib.docs.filter((d) => d.section === sec).map((d) => d.category).filter((c): c is string => !!c))].sort();
  const manual = lib.numbering.mode === 'manual';
  const setType = (type: AddType) => {
    const next = ADD_TYPES[type].section;
    setF({ ...f, type, country: next === 'client' && f.country === GLOBAL ? lib.places[0] ?? '' : f.country });
  };

  /** Reads the file with AI and fills every field it found; the name alone is used when AI isn't available. */
  const analyse = async () => {
    const target = file ?? source;
    if (!target) return;
    setBusy(true); setError(null);
    const fromName = splitBase(target.name.replace(/\.[a-z0-9]{1,6}$/i, ''));
    try {
      const r = await api<{ suggestion: Suggested }>(`/knowledge/analyse?section=${startType}`, { method: 'POST', body: target, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(target.name) } });
      const s = r.suggestion;
      const filled = new Set<string>();
      const next = { ...f };
      const take = (k: keyof typeof f, v: string) => { if (v) { (next as Record<string, unknown>)[k] = v; filled.add(k); } };
      next.type = s.type; filled.add('type');
      take('country', s.country); take('company', s.company); take('client', s.client); take('title', s.title || fromName.title); take('doc_no', s.doc_no || fromName.doc_no || '');
      take('category', s.category); take('summary', s.summary); take('key_action', s.key_action); take('failure_types', s.failure_types.join(', '));
      take('author', s.author); take('revision', s.revision); take('revision_date', s.revision_date); take('published_on', s.published_on); take('expires_on', s.expires_on);
      if (s.origin === 'external') { next.origin = 'external'; filled.add('origin'); }
      setF(next);
      setRead({ from: target.name, filled, notes: s.notes });
    } catch (e) {
      setError(`${(e as ApiError).message}`);
      setF({ ...f, type: guessType(fromName.title, startType), title: f.title || fromName.title, doc_no: f.doc_no || fromName.doc_no || '' });
    } finally { setBusy(false); setStep('fields'); }
  };

  const save = async () => {
    setBusy(true); setError(null);
    const body = { ...f, failure_types: f.failure_types.split(',').map((x) => x.trim()).filter(Boolean) };
    try {
      if (doc) { await api(`/knowledge/${doc.id}`, { method: 'PUT', json: body }); onClose(true); return; }
      const { id } = await api<{ id: string }>('/knowledge', { method: 'POST', json: body });
      if (file) await uploadFile(id, file, 'published');
      if (source) await uploadFile(id, source, 'source');
      onClose(true, id);
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  const hint = (k: string, h?: string) => (read?.filled.has(k) ? `Read from the document${h ? `. ${h}` : ''}` : h);
  const input = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}, h?: string) => (
    <Field id={`kd-${k}`} label={label} hint={hint(k, h)}><input id={`kd-${k}`} className={cx(inputClass, read?.filled.has(k) && 'border-accent-text')} value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></Field>
  );
  const nextNo = formatNumber(numberPrefix({ section: sec, country: f.country || GLOBAL, company: f.company }, lib.numbering), 1, lib.numbering.digits).replace(/\d+$/, (m) => 'N'.repeat(m.length));
  const isFormish = sec === 'form' || f.is_form;

  if (step === 'upload') {
    return (
      <Dialog title="Add document" onClose={() => onClose(false)} wide>
        <p className="text-sm text-text-muted">Start with the file. It is read by AI and every field is filled in from it; you check and correct them before saving. The document starts as a draft and readers see it once it is approved.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
          <Field id="kd-file" label="Document" hint="PDF, or for a form its Excel, Word or PowerPoint file">
            <input id="kd-file" type="file" accept={ACCEPT} className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field id="kd-source" label="Editable version (optional)" hint="Word or Excel. Needed before review for SOPs, SWIs and client procedures">
            <input id="kd-source" type="file" accept={EDITABLE_ACCEPT} className="text-sm" onChange={(e) => setSource(e.target.files?.[0] ?? null)} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={busy} disabled={!file && !source} onClick={analyse}><Sparkles aria-hidden className="size-4" />{busy ? 'Reading the document…' : 'Read the document'}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => setStep('fields')}>Fill in by hand</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={doc ? 'Edit document details' : 'Add document'} onClose={() => onClose(false)} wide>
      {error && <div className="mb-3"><Banner tone="warning">{error}</Banner></div>}
      {read && <div className="mb-3"><Banner tone="info">Filled in from “{read.from}”: {read.filled.size} fields, outlined. Check every field before saving.{read.notes && ` ${read.notes}`}</Banner></div>}
      {!doc && (file || source) && <p className="mb-3 text-xs text-text-muted">Files: {[file?.name, source && `${source.name} (editable)`].filter(Boolean).join(' · ')}. <button type="button" className="underline" onClick={() => { setStep('upload'); setRead(null); }}>Change</button></p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="kd-type" label="Type" hint={hint('type', `Filed under ${SECTIONS[sec]}`)}>
          <Select id="kd-type" className={cx(inputClass, read?.filled.has('type') && 'border-accent-text')} value={f.type} onChange={(e) => setType(e.target.value as AddType)}>
            <optgroup label={SECTIONS.lesson}>{(['lesson_learnt', 'best_practice', 'learning_from_incident'] as const).map((k) => <option key={k} value={k}>{ADD_TYPES[k].label}</option>)}</optgroup>
            <optgroup label="Controlled documents">{(['sop', 'swi', 'form', 'client'] as const).map((k) => <option key={k} value={k}>{ADD_TYPES[k].label}</option>)}</optgroup>
          </Select>
        </Field>
        <Field id="kd-country" label={sec === 'client' ? 'Country' : 'Country or Global'} hint={hint('country')}>
          <Select id="kd-country" className={inputClass} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{placeOptions.map((c) => <option key={c}>{c}</option>)}</Select>
        </Field>
        {hasCompany(sec) && (
          <Field id="kd-company" label="Company" hint={hint('company')}>
            <Select id="kd-company" className={inputClass} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })}>{SOP_COMPANIES.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
        )}
        {sec === 'client' && <>{input('client', 'Client', { list: 'kd-clients', placeholder: 'e.g. Saudi Aramco' }, 'Shown on jobs in this country, this client first')}<datalist id="kd-clients">{lib.clients.map((c) => <option key={c} value={c} />)}</datalist></>}
        <div className="sm:col-span-2">{input('title', 'Title')}</div>
        {input('doc_no', manual ? 'Document number' : 'Document number (optional)', { placeholder: doc ? '' : manual ? 'Numbering is manual: type it' : `Leave blank for ${nextNo}` }, doc || manual ? undefined : 'The official number, or blank for the next one')}
        {input('category', lesson ? 'Category' : 'Category (optional)', { list: 'kd-cats', placeholder: 'e.g. Wireline, Pressure control' })}
        <datalist id="kd-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        {input('author', 'Author')}
        <Field id="kd-origin" label="Origin" hint={hint('origin', "External: a client's or a manufacturer's document")}>
          <Select id="kd-origin" className={inputClass} value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value as 'internal' | 'external' })}><option value="internal">Internal (NESR)</option><option value="external">External</option></Select>
        </Field>
        {!lesson && sec !== 'form' && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.is_form} onChange={(e) => setF({ ...f, is_form: e.target.checked })} />People fill this in: everyone can download the Word or Excel file too</label>}
        <div className="sm:col-span-2"><Field id="kd-summary" label={lesson ? 'Summary' : 'Scope / summary'} hint={hint('summary')}><textarea id="kd-summary" rows={3} className={cx(inputClass, 'h-auto py-2', read?.filled.has('summary') && 'border-accent-text')} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field></div>
        {lesson && <div className="sm:col-span-2">{input('key_action', 'Key action')}</div>}
        {lesson && input('failure_types', 'Failure types', { placeholder: 'Comma separated, e.g. Wire parted, Stuck tool' })}
        {input('published_on', lesson ? 'Published' : 'Issued', { type: 'date' })}
        {lesson && input('rilr_ref', 'RILR / reference')}
        {input('source_ref', 'Link to the source (optional)', { type: 'url', placeholder: 'https://…sharepoint.com/…' })}
        {doc && !lesson && lib.isAdmin && input('review_due', 'Next periodic review', { type: 'date' }, 'Set by approval; admins may move it')}
        {lesson && (
          <Field id="kd-dup" label="Duplicate of" hint="Hidden from the library unless Show duplicates is on">
            <Select id="kd-dup" className={inputClass} value={f.duplicate_of} onChange={(e) => setF({ ...f, duplicate_of: e.target.value })}>
              <option value="">Not a duplicate</option>{lib.docs.filter((d) => d.section === 'lesson' && d.id !== doc?.id && !d.duplicate_of).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </Select>
          </Field>
        )}
        {!doc && (
          <div className="grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:col-span-2 sm:grid-cols-2">
            <p className="text-sm font-semibold sm:col-span-2">First revision</p>
            {input('revision', 'Revision', { type: 'number', min: 0 }, 'Rev 0 for a new document; the current number when bringing one in')}
            {input('change_note', 'Comment')}
            {input('revision_date', 'Revision date', { type: 'date' })}
            {input('expires_on', 'Expires (blank: the usual period)', { type: 'date' })}
            {!file && <Field id="kd-file2" label="Document" hint={isFormish ? 'The form in its original format, or a PDF' : 'PDF'}><input id="kd-file2" type="file" accept={isFormish ? ACCEPT : '.pdf'} className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>}
            {!source && <Field id="kd-source2" label="Editable version" hint="Word or Excel"><input id="kd-source2" type="file" accept={EDITABLE_ACCEPT} className="text-sm" onChange={(e) => setSource(e.target.files?.[0] ?? null)} /></Field>}
          </div>
        )}
      </div>
      <Button className="mt-4" variant="primary" loading={busy} disabled={!f.title.trim() || (lesson && !f.category.trim()) || (sec === 'client' && !f.client.trim()) || (!doc && manual && !f.doc_no.trim())} onClick={save}>{doc ? 'Save changes' : 'Add as a draft'}</Button>
    </Dialog>
  );
}

// ---- on the job: client procedures for the job's country ---------------------------------------------------------

function JobDocRow({ d, client, onMap }: { d: KnowledgeDoc; client?: string | null; onMap: (d: KnowledgeDoc) => void }) {
  const mine = client && d.client?.toLowerCase() === client.toLowerCase();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-semibold">{d.title}</p>
        <p className="text-xs text-text-muted">{[d.client ?? d.company, mine && 'this job’s client', d.doc_no, `Rev ${d.revision}`].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="flex flex-wrap gap-1">
        {pdfHref(d) && <a className={linkBtn} href={pdfHref(d)!} target="_blank" rel="noreferrer" aria-label={`Read ${d.title} (PDF)`}><BookOpen aria-hidden className="size-3.5" />Read</a>}
        <Button size="sm" variant="ghost" onClick={() => onMap(d)}><Network aria-hidden className="size-3.5" />Mind map</Button>
        {d.file && <a className={linkBtn} href={fileUrl(d.id, d.file)} download={d.file.file_name} aria-label={`Download ${d.title}`}><Download aria-hidden className="size-3.5" /></a>}
      </div>
    </li>
  );
}

/**
 * Procedures for the job: the published client procedures of the job's country (its client first), and the SLK SOPs
 * and work instructions for that country and Global, each with Read and its mind map. Hidden without the tab.
 */
export function ClientProcedures({ country, client }: { country: string; client?: string | null }) {
  const q = useQuery({ queryKey: ['knowledge'], queryFn: () => api<Library>('/knowledge'), retry: false });
  const [map, setMap] = useState<KnowledgeDoc | null>(null);
  if (!q.data) return null;
  const live = q.data.docs.filter((d) => d.published_at && !d.retired_at);
  const docs = proceduresForJob(live, country, client);
  const sops = live.filter((d) => (d.section === 'sop' || d.section === 'swi') && (d.country === country || d.country === GLOBAL))
    .sort((a, b) => a.section.localeCompare(b.section) || (a.doc_no ?? a.title).localeCompare(b.doc_no ?? b.title));
  return (
    <div className="flex flex-col gap-2">
      {docs.length ? <ul className="divide-y divide-border rounded-md border border-border">{docs.map((d) => <JobDocRow key={d.id} d={d} client={client} onMap={setMap} />)}</ul>
        : <p className="text-sm text-text-muted">No client procedures for {country} yet. They are added in the <Link className="underline" to="/knowledge?s=client">Knowledge Hub</Link>.</p>}
      {sops.length > 0 && (
        <details className="rounded-md border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">SLK SOPs and work instructions for {country} and Global ({sops.length})</summary>
          <ul className="divide-y divide-border border-t border-border">{sops.map((d) => <JobDocRow key={d.id} d={d} onMap={setMap} />)}</ul>
        </details>
      )}
      {map && <MindMapDialog doc={map} onClose={() => setMap(null)} />}
    </div>
  );
}
