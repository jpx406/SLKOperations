import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Columns3, Download, Eye, EyeOff, FileText, ImagePlus, LayoutGrid, LayoutTemplate, Maximize2, Move, Plus, Presentation, Send, Sparkles, Trash2, Undo2, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  DAMAGE_SUGGESTIONS, EMPTY_CONTENT, LESSON_COMPANIES, LESSON_KINDS, LESSON_STATUS, LIMITS, SHOW_AS, headings, submitProblems,
  type LessonCompany, type LessonContent, type LessonKind, type LessonPicture, type LessonStatus, type Part, type Rect,
} from '../../shared/lessons';
import {
  DESIGNS, PAGE, bodyOf, chrome, designBoxes, fitPictureBoxes, layoutLesson, layoutProblem, partLabel, partsOf, pictureHeight, picturesSideBySide, tidyBoxes, toOps,
  type Design, type LayoutIssue, type Op, type PageInput, type TemplateStyle,
} from '../../shared/lessonLayout';
import { ApiError, api } from '../api';
import { MenuButton } from '../components/MenuButton';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass } from '../components/ui';
import { Dialog } from './knowledge/common';
import { useConfirm } from '../components/Dialog';

// Lessons & Best Practices (Utilities, 6z.57): write a lesson learnt or best practice on the company template, by
// hand or drafted by AI from a failure report; send it to a reviewer and an approver; once approved it is published
// to the Knowledge Hub for its country as PDF and PowerPoint.

interface ListRow {
  id: string; kind: LessonKind; company: LessonCompany; country: string; title: string; status: LessonStatus; doc_no: string | null; revision: number | null; kb_doc_id: string | null;
  updated_at: string; updated_by_name: string | null; created_by_name: string | null; reviewer_name: string | null; approver_name: string | null; withMe: boolean; mine: boolean;
}
interface Person { username: string; name: string }
interface ListData {
  lessons: ListRow[]; canCreate: boolean; places: string[]; myCountry: string; reviewers: Person[]; approvers: Person[];
  templates: Record<LessonCompany, Record<LessonKind, boolean>>; ai: boolean; admin: boolean;
}
interface Lesson {
  id: string; kind: LessonKind; company: LessonCompany; country: string; title: string; content: LessonContent; status: LessonStatus;
  reviewer: string | null; approver: string | null; reviewer_name: string; approver_name: string; created_by_name: string; submit_note: string | null; review_comment: string | null;
  sent_back_reason: string | null; source_name: string | null; kb_doc_id: string | null; doc_no: string | null; revision: number | null; change_note: string | null; updated_at: string;
}
interface LessonData { lesson: Lesson; can: Record<'edit' | 'submit' | 'review' | 'approve' | 'send_back' | 'delete' | 'revise', boolean>; colour: string; style: TemplateStyle | null; template: boolean; templateName: string | null; ownTemplate: boolean; ai: boolean; me: string }

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const pad = (n: number | null) => (n === null ? '' : String(n).padStart(2, '0'));
const STATUS_TONE: Record<LessonStatus, string> = { draft: 'border-border text-text-muted', review: 'border-info text-info', approval: 'border-warning text-warning', approved: 'border-success text-success' };
function StatusPill({ status, children }: { status: LessonStatus; children?: ReactNode }) {
  return <span className={cx('label-caps inline-flex items-center rounded-xs border px-1.5 whitespace-nowrap', STATUS_TONE[status])}>{children ?? LESSON_STATUS[status]}</span>;
}

/** Fetches a file and saves it, so an error shows as a message instead of a downloaded error page. */
async function download(path: string, fallbackName: string) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Download failed (${res.status})`);
  const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name ? decodeURIComponent(name) : fallbackName });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function sendFile<T>(path: string, file: Blob, headers: Record<string, string> = {}): Promise<T> {
  return api<T>(path, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream', ...headers } });
}

/** A picture resized to at most 1600 px on its long side: JPEG, or PNG when it is a small drawing. */
async function shrink(file: File): Promise<Blob> {
  if (file.type === 'image/png' && file.size < 1_500_000) return file;
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('The picture could not be read'))), 'image/jpeg', 0.86));
}

// ---- the list ------------------------------------------------------------------------------------------------------------

type Tab = 'all' | 'draft' | 'me' | 'approved';

export function LessonList() {
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ['lessons'], queryFn: () => api<ListData>('/lessons') });
  const [tab, setTab] = useState<Tab>('all');
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = list.data;
  const rows = useMemo(() => (d?.lessons ?? []).filter((l) => tab === 'all' || (tab === 'draft' ? l.status === 'draft' : tab === 'me' ? l.withMe : l.status === 'approved')), [d, tab]);
  const counts = { all: d?.lessons.length ?? 0, draft: d?.lessons.filter((l) => l.status === 'draft').length ?? 0, me: d?.lessons.filter((l) => l.withMe).length ?? 0, approved: d?.lessons.filter((l) => l.status === 'approved').length ?? 0 };
  const blanks = d ? (Object.keys(LESSON_KINDS) as LessonKind[]).flatMap((k) => LESSON_COMPANIES.map((co) => ({
    label: `${LESSON_KINDS[k]} · ${co}`, disabled: !d.templates[co]?.[k], hint: d.templates[co]?.[k] ? undefined : 'No template yet: an admin adds it in Knowledge Hub › Doc Control › Settings',
    onSelect: () => { setError(null); download(`/lessons/templates/${encodeURIComponent(co)}/${k}`, `${co} ${LESSON_KINDS[k]} template.pptx`).catch((e: Error) => setError(e.message)); },
  }))) : [];
  return (
    <section aria-labelledby="ll-title">
      <PageTitle aside={<div className="flex flex-wrap gap-2"><MenuButton label="Blank templates" icon={<Download aria-hidden className="size-3.5" />} items={blanks} disabled={!d} />
        {d?.admin && <Button size="sm" onClick={() => setTemplates(true)}><LayoutTemplate aria-hidden className="size-3.5" />Templates</Button>}
        {d?.canCreate && <Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus aria-hidden className="size-4" />New</Button>}</div>}>
        <span id="ll-title">Lessons &amp; Best Practices</span>
      </PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">Write a lesson learnt or a best practice on the company template, by hand or drafted by AI from a failure report. It goes to a reviewer and an approver, and once approved it is published to the Knowledge Hub as PDF and PowerPoint.</p>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      {d && !d.canCreate && <div className="mb-3"><Banner tone="info">Knowledge Hub approvers and admins start lessons and best practices. You can open the ones sent to you, and the approved ones.</Banner></div>}
      <div role="tablist" aria-label="Show" className="mb-3 flex flex-wrap gap-x-1 border-b border-border">
        {([['all', 'All'], ['draft', 'Drafts'], ['me', 'With me'], ['approved', 'Approved']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap', tab === k ? 'border-accent-edge font-semibold text-text' : 'border-transparent text-text-muted hover:text-text')}>
            {label} <span className="font-mono text-xs text-text-subtle">{counts[k]}</span>
          </button>
        ))}
      </div>
      {list.isLoading && <Skeleton className="h-40" />}
      {list.error && <Banner tone="danger">{(list.error as Error).message}</Banner>}
      {d && !rows.length && <EmptyState title={tab === 'me' ? 'Nothing waiting for you' : 'Nothing here yet'}>{d.canCreate && tab !== 'me' ? 'Start one with New. A failure report can be drafted into the page by AI.' : null}</EmptyState>}
      {!!rows.length && (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {rows.map((l) => (
            <li key={l.id}>
              <Link to={`/utilities/lessons/${l.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2">
                <span className="w-28 shrink-0 font-mono text-xs text-text-subtle">{l.doc_no ?? '—'}</span>
                <span className="min-w-0 flex-1 basis-60">
                  <span className="block font-semibold text-text">{l.title || 'Untitled'}</span>
                  <span className="block text-xs text-text-muted">{LESSON_KINDS[l.kind]} · {l.company} · {l.country} · updated {when(l.updated_at)}{l.updated_by_name ? ` by ${l.updated_by_name}` : ''}</span>
                </span>
                <StatusPill status={l.status}>{l.status === 'review' ? `With ${l.reviewer_name}` : l.status === 'approval' ? `With ${l.approver_name}` : l.status === 'approved' ? `Approved · Rev ${pad(l.revision)}` : undefined}</StatusPill>
                {l.withMe && <span className="label-caps rounded-xs bg-accent px-1.5 text-on-accent">Your turn</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {templates && <TemplatesDialog onClose={() => setTemplates(false)} />}
      {creating && d && <NewDialog data={d} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/utilities/lessons/${id}`)} />}
    </section>
  );
}

interface Slot { company: LessonCompany; kind: LessonKind; file_name: string | null; uploaded_at: string | null; uploaded_by: string | null; uses: string | null }

/** Admins: every company template in one place, to download, replace or remove (6z.61). */
function TemplatesDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['lesson-company-templates'], queryFn: () => api<{ slots: Slot[] }>('/lessons/company-templates') });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef<Slot | null>(null);
  const path = (s: Slot) => `/lessons/company-templates/${encodeURIComponent(s.company)}/${s.kind}`;
  const changed = () => { qc.invalidateQueries({ queryKey: ['lesson-company-templates'] }); qc.invalidateQueries({ queryKey: ['lessons'] }); qc.invalidateQueries({ queryKey: ['lesson'] }); qc.invalidateQueries({ queryKey: ['lesson-logo'] }); };
  const send = async (f: File) => {
    const s = target.current; if (!s) return;
    setBusy(`${s.company}/${s.kind}`); setError(null); setNote(null);
    try { await sendFile(path(s), f, { 'X-File-Name': encodeURIComponent(f.name) }); setNote(`${s.company} ${LESSON_KINDS[s.kind].toLowerCase()} template: ${f.name}`); changed(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); if (fileRef.current) fileRef.current.value = ''; }
  };
  const [ask, confirmDialog] = useConfirm();
  const remove = async (s: Slot) => {
    if (!(await ask({ title: `Remove the ${s.company} ${LESSON_KINDS[s.kind].toLowerCase()} template “${s.file_name}”?`, body: s.kind === 'best_practice' ? 'Best practices then use the lesson learnt template.' : 'Lessons on it can only make the PDF until a new one is added.', confirm: 'Remove template', danger: true }))) return;
    setError(null); setNote(null);
    try { await api(path(s), { method: 'DELETE' }); changed(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <Dialog title="Company templates" onClose={onClose} wide>
      {confirmDialog}
      <p className="mb-3 text-sm text-text-muted">The PowerPoint each lesson and best practice is made on. The page, the PDF and the PowerPoint take the header, the words, the colours, the logo and the sign-off tables from the template&apos;s slide master. The same files are used in Knowledge Hub › Doc Control › Settings.</p>
      <input ref={fileRef} type="file" accept=".pptx" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); }} />
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      {note && <div className="mb-3"><Banner tone="success">Saved: {note}</Banner></div>}
      {q.isLoading && <Skeleton className="h-40" />}
      {q.error && <Banner tone="danger">{(q.error as Error).message}</Banner>}
      {q.data && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {q.data.slots.map((s) => (
            <li key={`${s.company}/${s.kind}`} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div><b className="text-sm">{s.company}</b> <span className="text-sm text-text-muted">· {LESSON_KINDS[s.kind]}</span></div>
              {s.file_name && <SlotPreview slot={s} />}
              <p className="min-w-0 text-xs break-words">{s.file_name ? <>{s.file_name}<span className="block text-text-subtle">added {s.uploaded_at ? when(s.uploaded_at) : ''}{s.uploaded_by ? ` by ${s.uploaded_by}` : ''}</span></>
                : s.uses ? <span className="text-text-muted">None: uses the lesson learnt template ({s.uses})</span> : <span className="text-danger">None: only the PDF can be made</span>}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" loading={busy === `${s.company}/${s.kind}`} onClick={() => { target.current = s; fileRef.current?.click(); }}>{s.file_name ? 'Replace' : 'Add'}</Button>
                {s.file_name && <Button size="sm" variant="ghost" onClick={() => download(`${path(s)}/file`, s.file_name!).catch((e: Error) => setError(e.message))}><Download aria-hidden className="size-3.5" />Download</Button>}
                {s.file_name && <Button size="sm" variant="ghost" aria-label={`Remove the ${s.company} ${LESSON_KINDS[s.kind]} template`} onClick={() => remove(s)}><Trash2 aria-hidden className="size-3.5" />Remove</Button>}
              </div>
              {s.company !== 'NESR' && <MakeFromNesr slot={s} hasNesr={!!q.data.slots.find((x) => x.company === 'NESR' && x.file_name)} path={path(s)}
                onDone={(name) => { setError(null); setNote(`${s.company} ${LESSON_KINDS[s.kind].toLowerCase()} template: ${name}`); changed(); }} onError={setError} />}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/**
 * Makes a company template from the NESR one (6z.64): the NESR layout, sign-off tables and words, with this company's
 * logo, colour and database name, so every company's page lines up the same.
 */
function MakeFromNesr({ slot, hasNesr, path, onDone, onError }: { slot: Slot; hasNesr: boolean; path: string; onDone: (name: string) => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [band, setBand] = useState<'white' | 'solid'>('white');
  const [logo, setLogo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return <div><Button size="sm" variant="ghost" disabled={!hasNesr} title={hasNesr ? undefined : 'Add the NESR template first'} onClick={() => setOpen(true)}><Wand2 aria-hidden className="size-3.5" />Make from the NESR template</Button></div>;
  const go = async () => {
    setBusy(true);
    try {
      const r = await api<{ name: string }>(`${path}/from-nesr?band=${band}`, { method: 'POST', body: logo ?? new Uint8Array(), headers: { 'Content-Type': 'application/octet-stream' } });
      setOpen(false); setLogo(null); onDone(r.name);
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-2 text-xs">
      <p className="text-text-muted">The NESR template with the {slot.company} logo, colour and database name. It takes the place of this slot&apos;s file.</p>
      <Segmented label="Header band" value={band} options={{ white: 'White band, coloured title', solid: 'Band in the company colour' }} onChange={setBand} />
      <label className="flex flex-col gap-1"><span className="text-text-muted">Logo: {logo ? logo.name : slot.file_name ? `from the current ${slot.company} template` : 'pick the logo picture'}</span>
        <input type="file" accept="image/png,image/jpeg" className="text-xs file:mr-2 file:rounded-sm file:border file:border-border-strong file:bg-surface file:px-2 file:py-1" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} /></label>
      <p className="text-text-subtle">A logo on a white background looks best on the white band.</p>
      <div className="flex gap-2"><Button size="sm" variant="primary" loading={busy} onClick={go}>Make it</Button><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </div>
  );
}

/** The header and footer the app reads from a slot's template, as a page with no content yet (6z.62). */
function SlotPreview({ slot }: { slot: Slot }) {
  const path = `/lessons/company-templates/${encodeURIComponent(slot.company)}/${slot.kind}`;
  const style = useQuery({ queryKey: ['lesson-slot-style', slot.company, slot.kind, slot.file_name, slot.uploaded_at], queryFn: () => api<{ style: TemplateStyle | null; colour: string }>(`${path}/style`) });
  const logo = useQuery({
    queryKey: ['lesson-slot-logo', slot.company, slot.kind, slot.file_name, slot.uploaded_at],
    queryFn: async () => {
      const res = await fetch(`/api/lessons/logo/${encodeURIComponent(slot.company)}/${slot.kind}?v=${encodeURIComponent(slot.uploaded_at ?? '')}`, { credentials: 'same-origin' });
      if (!res.ok) return null;
      const [w, h] = (res.headers.get('x-logo-size') ?? '1x1').split('x').map(Number);
      return { url: URL.createObjectURL(await res.blob()), w, h };
    },
  });
  if (style.isLoading || logo.isLoading) return <Skeleton className="aspect-[540/780] w-full" />;
  if (!style.data?.style) return <p className="text-xs text-danger">The slide master of this file has nothing the app can read.</p>;
  const input: PageInput = {
    style: style.data.style, kind: slot.kind, company: slot.company, country: '', title: 'Title of the lesson', content: { ...EMPTY_CONTENT, hidden: ['meta', 'key'] }, colour: style.data.colour,
    docNo: null, revision: null, signoff: { date: '', changes: '', prepared: '', reviewed: '', approver: '', position: '' },
  };
  return <div className="overflow-hidden rounded-sm border border-border"><PagePreview input={input} lessonId="" logo={logo.data ?? null} /></div>;
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Record<T, string>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap overflow-hidden rounded-md border border-border-strong">
      {(Object.keys(options) as T[]).map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={cx('px-3 py-1.5 text-sm', value === k ? 'bg-text font-semibold text-bg' : 'bg-surface text-text hover:bg-surface-2')}>{options[k]}</button>
      ))}
    </div>
  );
}

function NewDialog({ data, onClose, onCreated }: { data: ListData; onClose: () => void; onCreated: (id: string) => void }) {
  const [kind, setKind] = useState<LessonKind>('lesson_learnt');
  const [company, setCompany] = useState<LessonCompany>('NESR');
  const [country, setCountry] = useState(data.places.includes(data.myCountry) ? data.myCountry : data.places[0] ?? '');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const start = async () => {
    setError(null);
    setStep('Starting…');
    try {
      const { id } = await api<{ id: string }>('/lessons', { method: 'POST', json: { kind, company, country, title } });
      qc.invalidateQueries({ queryKey: ['lessons'] });
      if (file) {
        setStep('Reading the failure report and drafting the page. This can take a minute…');
        try { await sendFile(`/lessons/${id}/analyse`, file, { 'X-File-Name': encodeURIComponent(file.name) }); }
        catch (e) { sessionStorage.setItem(`lesson-note-${id}`, (e as Error).message); }
      }
      onCreated(id);
    } catch (e) { setError((e as Error).message); setStep(null); }
  };
  const tpl = data.templates[company]?.[kind];
  return (
    <Dialog title={`New ${LESSON_KINDS[kind].toLowerCase()}`} onClose={step ? () => undefined : onClose}>
      <div className="flex flex-col gap-4">
        <div><span className="label-caps mb-1.5 block text-text-muted">Type</span><Segmented label="Type" value={kind} options={LESSON_KINDS} onChange={setKind} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ll-co" label="Company"><select id="ll-co" className={inputClass} value={company} onChange={(e) => setCompany(e.target.value as LessonCompany)}>{LESSON_COMPANIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field id="ll-country" label="Country" hint={country === data.myCountry ? 'Yours' : undefined}><select id="ll-country" className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)}>{data.places.map((c) => <option key={c}>{c}</option>)}</select></Field>
        </div>
        {!tpl && <Banner tone="warning">There is no {company} {LESSON_KINDS[kind].toLowerCase()} slides template yet, so only the PDF can be made. An admin adds it in Knowledge Hub › Doc Control › Settings.</Banner>}
        <Field id="ll-title" label="Title" hint={file ? 'Leave empty to let AI suggest one from the report' : undefined}>
          <input id="ll-title" className={inputClass} value={title} maxLength={LIMITS.title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. PR plug not found in nipple profile" />
        </Field>
        <Field id="ll-file" label="Failure report (optional)" hint={data.ai ? 'PDF, Word (.docx) or PowerPoint (.pptx). AI drafts every section from it; pictures inside Word and PowerPoint files are added too.' : 'AI isn’t set up on the server: the report is kept, and you fill in the page.'}>
          <input id="ll-file" type="file" accept=".pdf,.docx,.pptx" className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-semibold"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        {error && <Banner tone="danger">{error}</Banner>}
        {step && <p role="status" className="flex items-center gap-2 text-sm text-text-muted"><Sparkles aria-hidden className="size-4 text-accent-text" />{step}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={!!step}>Cancel</Button>
          <Button variant="primary" loading={!!step} onClick={start}>{file ? <><Sparkles aria-hidden className="size-4" />Draft with AI</> : 'Start empty'}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---- the page preview ------------------------------------------------------------------------------------------------------

/** The logo of the template a lesson is made on (its own template's when it has one, 6z.61). */
function useLogo(lessonId: string, template: string | null) {
  return useQuery({
    queryKey: ['lesson-logo', lessonId, template], staleTime: 600_000, enabled: !!lessonId,
    queryFn: async () => {
      const res = await fetch(`/api/lessons/${lessonId}/logo`, { credentials: 'same-origin' });
      if (!res.ok) return null;
      const [w, h] = (res.headers.get('x-logo-size') ?? '1x1').split('x').map(Number);
      return { url: URL.createObjectURL(await res.blob()), w, h };
    },
  });
}

interface Boxes { boxes: Record<string, Rect>; issues: LayoutIssue[]; onChange: (b: Record<string, Rect>) => void; editable: boolean }

function PagePreview({ input, lessonId, logo, boxes }: { input: PageInput; lessonId: string; logo: { url: string; w: number; h: number } | null; boxes?: Boxes }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'size'; sx: number; sy: number; start: Rect } | null>(null);
  const [live, setLive] = useState<Record<string, Rect> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const shown = useMemo(() => (live ? { ...input, content: { ...input.content, layout: { mode: 'free' as const, boxes: live } } } : input), [input, live]);
  const ops = useMemo(() => {
    const ch = chrome(shown, logo ? { w: logo.w, h: logo.h } : null);
    return toOps([...ch.master, ...ch.slide, ...layoutLesson(shown).blocks]);
  }, [shown, logo]);
  const free = !!boxes && input.content.layout.mode === 'free';
  const parts = free ? partsOf(input) : [];
  const rects = live ?? boxes?.boxes ?? {};
  const bad = new Set((boxes?.issues ?? []).flatMap((i) => (i.also ? [i.id, i.also] : [i.id])));
  const body = bodyOf(input);
  const pt = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const r = p.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: r.x, y: r.y };
  };
  const snap = (v: number) => Math.round(v / 3) * 3;
  const move = (e: React.PointerEvent) => {
    if (!drag || !boxes) return;
    const p = pt(e), dx = p.x - drag.sx, dy = p.y - drag.sy, s = drag.start;
    const pic = drag.id.startsWith('pic:') ? input.content.pictures.find((p) => `pic:${p.id}` === drag.id) : null;
    const w = Math.max(24, snap(s.w + dx));
    const next = drag.mode === 'move' ? { ...s, x: snap(s.x + dx), y: snap(s.y + dy) } : pic ? { ...s, w, h: pictureHeight(pic, w) } : { ...s, w, h: Math.max(15, snap(s.h + dy)) };
    setLive({ ...boxes.boxes, [drag.id]: next });
  };
  const end = () => { if (drag && live && boxes) boxes.onChange(live); setDrag(null); setLive(null); };
  const key = (id: string, e: React.KeyboardEvent) => {
    if (!boxes || !boxes.editable) return;
    const d = { ArrowLeft: [-3, 0], ArrowRight: [3, 0], ArrowUp: [0, -3], ArrowDown: [0, 3] }[e.key];
    if (!d) return;
    e.preventDefault();
    const r = boxes.boxes[id];
    const pic = id.startsWith('pic:') ? input.content.pictures.find((p) => `pic:${p.id}` === id) : null;
    const w = Math.max(24, r.w + (d[0] || d[1]));
    boxes.onChange({ ...boxes.boxes, [id]: !e.shiftKey ? { ...r, x: r.x + d[0], y: r.y + d[1] } : pic ? { ...r, w, h: pictureHeight(pic, w) } : { ...r, w: Math.max(24, r.w + d[0]), h: Math.max(15, r.h + d[1]) } });
  };
  const href = (pic: string) => (pic === '__logo__' ? logo?.url ?? '' : `/api/lessons/${lessonId}/pictures/${pic}`);
  const el = (op: Op, i: number) => {
    if (op.o === 'rect') return <rect key={i} x={op.x} y={op.y} width={op.w} height={op.h} fill={op.fill ? `#${op.fill}` : 'none'} stroke={op.stroke ? `#${op.stroke}` : undefined} strokeWidth={op.sw} />;
    if (op.o === 'line') return <line key={i} x1={op.x1} y1={op.y1} x2={op.x2} y2={op.y2} stroke={`#${op.c}`} strokeWidth={op.sw} />;
    if (op.o === 'img') return <image key={i} href={href(op.pic)} x={op.x} y={op.y} width={op.w} height={op.h} preserveAspectRatio="none" />;
    return <text key={i} x={op.x} y={op.y} fontSize={op.size} fontWeight={op.b ? 700 : 400} fill={`#${op.c}`} xmlSpace="preserve">{op.t}</text>;
  };
  return (
    <svg ref={svgRef} viewBox={`0 0 ${PAGE.w} ${PAGE.h}`} role={free ? 'group' : 'img'} aria-label="Page preview" className={cx('block h-auto w-full touch-none bg-white shadow-md', drag && 'cursor-grabbing')}
      style={{ fontFamily: 'Helvetica, Arial, sans-serif' }} onPointerMove={move} onPointerUp={end} onPointerLeave={end}>
      <rect width={PAGE.w} height={PAGE.h} fill="#fff" />
      {ops.map(el)}
      {free && <rect x={body.left} y={body.top} width={body.right - body.left} height={body.bottom - body.top} fill="none" stroke="#94a3b8" strokeDasharray="2 3" strokeWidth={0.6} pointerEvents="none" />}
      {free && parts.map((id) => {
        const r = rects[id];
        if (!r) return null;
        const label = partLabel(id, input.kind, input.content.pictures);
        const colour = bad.has(id) ? '#dc2626' : selected === id ? '#1d4ed8' : '#2563eb';
        return (
          <g key={id}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={bad.has(id) ? 'rgba(220,38,38,0.08)' : 'rgba(37,99,235,0.04)'} stroke={colour} strokeWidth={bad.has(id) ? 1.4 : 0.8} strokeDasharray={bad.has(id) ? undefined : '4 3'}
              tabIndex={boxes!.editable ? 0 : -1} role="button" aria-label={`${label}${bad.has(id) ? ', has a problem' : ''}. Drag to move; arrow keys move it, Shift and arrow keys resize it`}
              className={boxes!.editable ? 'cursor-move focus:outline-none' : ''} onFocus={() => setSelected(id)} onKeyDown={(e) => key(id, e)}
              onPointerDown={(e) => { if (!boxes!.editable) return; e.preventDefault(); setSelected(id); const p = pt(e); setDrag({ id, mode: 'move', sx: p.x, sy: p.y, start: r }); }} />
            <g pointerEvents="none"><rect x={r.x} y={r.y - 9} width={Math.min(r.w, label.length * 4.2 + 8)} height={9} fill={colour} /><text x={r.x + 3} y={r.y - 2.4} fontSize={6.5} fill="#fff" fontWeight={700}>{label.length > 40 ? `${label.slice(0, 38)}…` : label}</text></g>
            {boxes!.editable && <rect x={r.x + r.w - 7} y={r.y + r.h - 7} width={10} height={10} fill={colour} className="cursor-nwse-resize" aria-hidden
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setSelected(id); const p = pt(e); setDrag({ id, mode: 'size', sx: p.x, sy: p.y, start: r }); }} />}
          </g>
        );
      })}
    </svg>
  );
}

// ---- the editor --------------------------------------------------------------------------------------------------------------

export function LessonEditor() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['lesson', id], queryFn: () => api<LessonData>(`/lessons/${id}`) });
  const list = useQuery({ queryKey: ['lessons'], queryFn: () => api<ListData>('/lessons') });
  const [title, setTitle] = useState('');
  const [content, setContent] = useState<LessonContent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(() => sessionStorage.getItem(`lesson-note-${id}`));
  const [dialog, setDialog] = useState<null | 'submit' | 'review' | 'approve' | 'send-back' | 'revise' | 'delete'>(null);
  const [arranging, setArranging] = useState(false);
  const [designs, setDesigns] = useState(false);
  const tplRef = useRef<HTMLInputElement>(null);
  const loadedAt = useRef<string | null>(null);
  const d = q.data;
  const logo = useLogo(d?.lesson.id ?? '', d?.templateName ?? null);

  useEffect(() => { if (note) sessionStorage.removeItem(`lesson-note-${id}`); }, [id, note]);
  // take the server copy when it changes and nothing is waiting to be saved
  useEffect(() => {
    if (!d || dirty) return;
    if (loadedAt.current === d.lesson.updated_at && content) return;
    loadedAt.current = d.lesson.updated_at;
    setTitle(d.lesson.title); setContent(d.lesson.content);
  }, [d, dirty, content]);

  // every change counts up; a save that finishes after a newer change leaves the page unsaved, so the server copy never overwrites it
  const edits = useRef(0);
  const save = useMutation({
    mutationFn: (v: { title: string; content: LessonContent; at: number }) => api<{ updated_at: string }>(`/lessons/${id}`, { method: 'PUT', json: { title: v.title, content: v.content } }).then((r) => ({ ...r, at: v.at })),
    onSuccess: (r) => { setSaved(r.updated_at); if (r.at === edits.current) { setDirty(false); loadedAt.current = null; qc.invalidateQueries({ queryKey: ['lesson', id] }); } },
    onError: (e: ApiError) => setError(e.message),
  });
  // saved a moment after the last change
  useEffect(() => {
    if (!dirty || !content) return;
    const t = setTimeout(() => save.mutate({ title, content, at: edits.current }), 900);
    return () => clearTimeout(t);
  }, [dirty, title, content]); // eslint-disable-line react-hooks/exhaustive-deps
  const flush = async () => { if (dirty && content) await save.mutateAsync({ title, content, at: edits.current }); };
  const reload = () => { setDirty(false); loadedAt.current = null; qc.invalidateQueries({ queryKey: ['lesson', id] }); qc.invalidateQueries({ queryKey: ['lessons'] }); };

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error || !d) return <Banner tone="danger">{(q.error as Error)?.message ?? 'Not found'}</Banner>;
  if (!content) return <Skeleton className="h-96" />;
  const l = d.lesson;
  const hd = headings(l.kind);
  const editable = d.can.edit;
  const set = (part: Part | null, patch: Partial<LessonContent>) => {
    setContent((c) => (c ? { ...c, ...patch, ai: part ? c.ai.filter((x) => x !== part) : c.ai } : c));
    edits.current++;
    setDirty(true);
  };
  const input: PageInput = {
    style: d.style, kind: l.kind, company: l.company, country: l.country, title, content, colour: d.colour,
    docNo: l.status === 'approved' ? l.doc_no : null, revision: l.status === 'approved' ? pad(l.revision) : null,
    signoff: { date: '', changes: '', prepared: l.created_by_name, reviewed: l.reviewer_name, approver: l.approver_name, position: '' },
  };
  const laid = layoutLesson(input);
  const fits = laid.fits;
  const problems = submitProblems(title, content, layoutProblem(laid) ?? true);
  const free = content.layout.mode === 'free';
  const setBoxes = (boxes: Record<string, Rect>) => set(null, { layout: { mode: 'free', boxes } });
  const hidden = new Set(content.hidden);
  const toggle = (id: string) => set(null, { hidden: hidden.has(id) ? content.hidden.filter((x) => x !== id) : [...content.hidden, id] });
  const showSwitch = (id: string) => <ShowSwitch shown={!hidden.has(id)} onToggle={() => toggle(id)} disabled={!editable} />;
  // the boxes start where the parts sit in order down the page
  const tidy = () => {
    const auto = layoutLesson({ ...input, content: { ...content, layout: { mode: 'auto', boxes: {} } } });
    setBoxes(tidyBoxes(auto.regions, input));
  };
  const arrange = async () => {
    setError(null); setArranging(true);
    try {
      const r = await api<{ boxes: Record<string, Rect>; issues: LayoutIssue[] }>(`/lessons/${l.id}/arrange`, { method: 'POST', json: { title, content } });
      setBoxes(r.boxes);
    } catch (e) { setError((e as Error).message); } finally { setArranging(false); }
  };
  const flag = (p: Part) => content.ai.includes(p) && (
    <span className="flex items-center gap-2"><span className="label-caps rounded-xs bg-info-subtle px-1.5 text-info">AI draft</span>
      {editable && <Button size="sm" variant="ghost" onClick={() => set(p, {})}><Check aria-hidden className="size-3.5" />Mark checked</Button>}</span>);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await flush(); await fn(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <section aria-labelledby="le-title">
      <div className="mb-2"><Link to="/utilities/lessons" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"><ArrowLeft aria-hidden className="size-4" />Lessons &amp; Best Practices</Link></div>
      <PageTitle aside={<div className="flex flex-wrap items-center gap-2">
        <StatusPill status={l.status}>{l.status === 'review' ? `With ${l.reviewer_name}` : l.status === 'approval' ? `With ${l.approver_name}` : l.status === 'approved' ? `${l.doc_no} · Rev ${pad(l.revision)}` : undefined}</StatusPill>
        {editable && <span className="text-xs text-text-subtle" role="status">{save.isPending ? 'Saving…' : dirty ? 'Changes not saved yet' : saved ? `Saved ${when(saved)}` : ''}</span>}
      </div>}>
        <span id="le-title">{LESSON_KINDS[l.kind]}</span>
      </PageTitle>
      <p className="-mt-3 mb-3 text-sm text-text-muted">{l.company} · {l.country} · written by {l.created_by_name}{l.source_name ? <> · from <a className="underline" href={`/api/lessons/${l.id}/source?inline=1`} target="_blank" rel="noreferrer">{l.source_name}</a></> : null}</p>

      {note && <div className="mb-3"><Banner tone="warning" action={<Button size="sm" variant="ghost" onClick={() => setNote(null)}><X aria-hidden className="size-4" /></Button>}>{note}</Banner></div>}
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      {l.status === 'draft' && l.sent_back_reason && <div className="mb-3"><Banner tone="warning">Sent back: {l.sent_back_reason}</Banner></div>}
      {l.status !== 'draft' && l.submit_note && <div className="mb-3"><Banner tone="info">Note from the writer: {l.submit_note}</Banner></div>}
      {l.status === 'approval' && l.review_comment && <div className="mb-3"><Banner tone="info">Reviewer’s comment: {l.review_comment}</Banner></div>}
      {l.status === 'approved' && (
        <div className="mb-3"><Banner tone="success" action={l.kb_doc_id ? <Link className="text-sm font-semibold underline" to={`/knowledge?doc=${l.kb_doc_id}`}>Open in Knowledge Hub</Link> : undefined}>
          Published in the Knowledge Hub as {l.doc_no} Rev {pad(l.revision)}, PDF and PowerPoint.</Banner></div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {d.can.submit && <Button variant="primary" onClick={() => setDialog('submit')}><Send aria-hidden className="size-4" />Send for review</Button>}
        {d.can.review && <Button variant="primary" onClick={() => setDialog('review')}><Check aria-hidden className="size-4" />Pass review</Button>}
        {d.can.approve && <Button variant="primary" onClick={() => setDialog('approve')}><Check aria-hidden className="size-4" />Approve and publish</Button>}
        {d.can.send_back && <Button onClick={() => setDialog('send-back')}><Undo2 aria-hidden className="size-4" />Send back</Button>}
        {d.can.revise && <Button onClick={() => setDialog('revise')}>New revision</Button>}
        <Button onClick={() => act(() => download(`/lessons/${l.id}/pdf`, `${l.title}.pdf`))}><FileText aria-hidden className="size-4" />PDF</Button>
        <Button disabled={!d.template} title={d.template ? undefined : `No ${l.company} slides template yet`} onClick={() => act(() => download(`/lessons/${l.id}/pptx`, `${l.title}.pptx`))}><Presentation aria-hidden className="size-4" />PowerPoint</Button>
        {d.can.delete && <Button variant="ghost" onClick={() => setDialog('delete')}><Trash2 aria-hidden className="size-4" />Delete draft</Button>}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-3 lg:order-2">
          <Section title="Header" aside={flag('header')}>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span className="flex items-center gap-2">Event facts strip {showSwitch('meta')}</span>
              <span className="flex items-center gap-2">{hd.key} {showSwitch('key')}</span>
            </div>
            <Field id="le-t" label="Title"><input id="le-t" className={inputClass} value={title} maxLength={LIMITS.title} onChange={(e) => { setTitle(e.target.value); set('header', {}); }} /></Field>
            <Field id="le-key" label={`${hd.key} (one line at the top)`}><input id="le-key" className={inputClass} value={content.key_lesson} maxLength={300} onChange={(e) => set('header', { key_lesson: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="le-date" label="Event date"><input id="le-date" type="date" className={inputClass} value={content.event_date} onChange={(e) => set('header', { event_date: e.target.value })} /></Field>
              <Field id="le-field" label="Field"><input id="le-field" className={inputClass} value={content.field} onChange={(e) => set('header', { field: e.target.value })} /></Field>
              <Field id="le-well" label="Well"><input id="le-well" className={inputClass} value={content.well} onChange={(e) => set('header', { well: e.target.value })} /></Field>
              <Field id="le-job" label="Job"><input id="le-job" className={inputClass} value={content.job} onChange={(e) => set('header', { job: e.target.value })} /></Field>
              <Field id="le-unit" label="Unit"><input id="le-unit" className={inputClass} value={content.unit} onChange={(e) => set('header', { unit: e.target.value })} /></Field>
              <Field id="le-cat" label="Category"><input id="le-cat" className={inputClass} value={content.category} onChange={(e) => set('header', { category: e.target.value })} /></Field>
            </div>
          </Section>

          <Section title={hd.description} hidden={hidden.has('description')} aside={<>{flag('description')}{showSwitch('description')}</>}>
            <ShowAs label={`${hd.description}: show as`} value={content.description_as} options={SHOW_AS.description} onChange={(v) => set(null, { description_as: v })} />
            <Field id="le-desc" label={content.description_as === 'timeline' ? 'One line per step, “time – what happened”' : content.description_as === 'bullets' ? 'One line per bullet' : 'Text'}>
              <textarea id="le-desc" rows={6} className={cx(inputClass, 'h-auto py-2')} value={content.description} maxLength={LIMITS.text} onChange={(e) => set('description', { description: e.target.value })} />
            </Field>
          </Section>

          <Section title={hd.facts} hidden={hidden.has('facts')} aside={<>{flag('facts')}{showSwitch('facts')}</>}>
            <ShowAs label={`${hd.facts}: show as`} value={content.facts_as} options={SHOW_AS.facts} onChange={(v) => set(null, { facts_as: v })} />
            <Field id="le-facts" label="One fact or finding per line" hint="Optional: left out of the page when empty. “Reading: what was found” puts the first part in bold.">
              <textarea id="le-facts" rows={4} className={cx(inputClass, 'h-auto py-2')} value={content.facts} maxLength={LIMITS.text} onChange={(e) => set('facts', { facts: e.target.value })} />
            </Field>
          </Section>

          {l.kind === 'lesson_learnt' && (
            <Section title="Potential damage" hidden={hidden.has('damage')} aside={<>{flag('damage')}{showSwitch('damage')}</>}>
              <ShowAs label="Potential damage: show as" value={content.damage_as} options={SHOW_AS.damage} onChange={(v) => set(null, { damage_as: v })} />
              <Chips values={content.damage} onChange={(v) => set('damage', { damage: v })} />
            </Section>
          )}

          <Section title={hd.analysis} hidden={hidden.has('analysis')} aside={<>{flag('analysis')}{showSwitch('analysis')}</>}>
            <ShowAs label={`${hd.analysis}: show as`} value={content.analysis_as} options={SHOW_AS.analysis} onChange={(v) => set(null, { analysis_as: v })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="le-imm" label={hd.immediate} hint="One per line. “Category: explanation” puts the category in bold.">
                <textarea id="le-imm" rows={5} className={cx(inputClass, 'h-auto py-2')} value={content.immediate_cause} maxLength={1500} onChange={(e) => set('analysis', { immediate_cause: e.target.value })} />
              </Field>
              <Field id="le-root" label={hd.root}>
                <textarea id="le-root" rows={5} className={cx(inputClass, 'h-auto py-2')} value={content.root_cause} maxLength={1500} onChange={(e) => set('analysis', { root_cause: e.target.value })} />
              </Field>
            </div>
            {content.analysis_as === 'whys' && (
              <div className="grid gap-2">{Array.from({ length: LIMITS.whys }, (_, i) => (
                <Field key={i} id={`le-why${i}`} label={`Why ${i + 1}`}><input id={`le-why${i}`} className={inputClass} value={content.whys[i] ?? ''} onChange={(e) => {
                  const w = [...content.whys]; while (w.length <= i) w.push(''); w[i] = e.target.value; set('analysis', { whys: w.filter((x, j) => x || j < i).slice(0, LIMITS.whys) });
                }} /></Field>))}</div>
            )}
          </Section>

          <Section title="Pictures and diagrams">
            <ShowAs label="Pictures: show as" value={content.pictures_as} options={SHOW_AS.pictures} onChange={(v) => set(null, { pictures_as: v })} />
            <Pictures lessonId={l.id} pictures={content.pictures} editable={editable} kind={l.kind} hidden={hidden} onToggle={toggle}
              onChange={(pics) => set(null, { pictures: pics })} onUploaded={async (f, section) => {
                await flush();
                const blob = await shrink(f);
                await sendFile(`/lessons/${l.id}/pictures?section=${section}`, blob, { 'X-Caption': encodeURIComponent(f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 80)) });
                reload();
              }} onRemove={async (p) => { await flush(); await api(`/lessons/${l.id}/pictures/${p.id}`, { method: 'DELETE' }); reload(); }} onError={setError} />
          </Section>

          <Section title={hd.actions} hidden={hidden.has('actions')} aside={<>{flag('actions')}{showSwitch('actions')}</>}>
            <ShowAs label={`${hd.actions}: show as`} value={content.actions_as} options={SHOW_AS.actions} onChange={(v) => set(null, { actions_as: v })} />
            <Actions actions={content.actions} onChange={(a) => set('actions', { actions: a })} />
          </Section>

          <Section title="Revision and sign-off">
            <p className="text-sm text-text-muted">Filled in by the app on approval: the revision, the approval date, “First version” or what changed, prepared by {l.created_by_name}, reviewed and approved by the people it is sent to with the approver’s position, and the number from the Knowledge Hub.</p>
            {l.kb_doc_id && l.status === 'draft' && (
              <Field id="le-change" label="What changes in this revision"><input id="le-change" className={inputClass} value={l.change_note ?? ''} readOnly /></Field>
            )}
          </Section>

          {editable && l.status === 'draft' && list.data?.ai && <ReportDraft lessonId={l.id} onDone={(msg) => { if (msg) setError(msg); reload(); }} before={flush} />}
        </fieldset>

        <div className="min-w-0 lg:sticky lg:top-4 lg:order-1">
          <div className="mb-3 rounded-lg border border-border bg-surface p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2"><LayoutTemplate aria-hidden className="size-4 text-text-muted" /><b className="text-sm">Page layout</b>
              <span className="min-w-0 flex-1 truncate text-xs text-text-muted" title={d.templateName ?? undefined}>{d.templateName ? `${d.ownTemplate ? 'Own template' : `${l.company} template`}: ${d.templateName}` : 'No slides template: PDF only'}</span></div>
            <fieldset disabled={!editable} className="flex flex-col gap-2">
              <Segmented label="Page layout" value={content.layout.mode} options={{ auto: 'In order', free: 'Boxes I can move' }}
                onChange={(v) => { if (v === 'free' && !Object.keys(content.layout.boxes).length) tidy(); else set(null, { layout: { ...content.layout, mode: v } }); }} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setDesigns(true)}><LayoutGrid aria-hidden className="size-3.5" />Choose a layout</Button>
                {free && d.ai && <Button size="sm" variant="primary" loading={arranging} onClick={arrange}><Wand2 aria-hidden className="size-3.5" />Arrange with AI</Button>}
                {free && <Button size="sm" onClick={tidy}><Move aria-hidden className="size-3.5" />Tidy up</Button>}
              </div>
              {free && content.pictures.some((p) => !hidden.has(`pic:${p.id}`)) && <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setBoxes(picturesSideBySide(input, content.layout.boxes))}><Columns3 aria-hidden className="size-3.5" />Pictures side by side</Button>
                <Button size="sm" variant="ghost" onClick={() => setBoxes(fitPictureBoxes(input, content.layout.boxes))}><Maximize2 aria-hidden className="size-3.5" />Fit boxes to pictures</Button>
              </div>}
              <p className="text-xs text-text-subtle">{free ? 'Drag a box to move it, drag its corner to resize it; text shrinks to fit its box. Arrow keys move the box in focus, Shift and arrows resize it.' : 'Each part follows the one before; the text shrinks so the page fits on one page.'}</p>
              <div className="flex flex-wrap gap-2">
                <input ref={tplRef} type="file" accept=".pptx" className="sr-only" onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  await act(() => sendFile(`/lessons/${l.id}/template`, f, { 'X-File-Name': encodeURIComponent(f.name) }));
                  if (tplRef.current) tplRef.current.value = '';
                  reload(); qc.invalidateQueries({ queryKey: ['lesson-logo'] });
                }} />
                <Button size="sm" variant="ghost" onClick={() => tplRef.current?.click()}>Use another template (.pptx)</Button>
                {d.ownTemplate && <Button size="sm" variant="ghost" onClick={() => act(async () => { await api(`/lessons/${l.id}/template`, { method: 'DELETE' }); reload(); })}>Back to the {l.company} template</Button>}
              </div>
            </fieldset>
          </div>
          <div className="rounded-lg border border-border bg-surface-3 p-3">
            <div className="mb-2 flex items-center justify-between text-sm"><b>Page 1 of 1</b>
              <span className={fits ? 'text-success' : 'font-semibold text-danger'}>{fits ? (free ? 'All boxes fit' : 'Fits on one page') : free ? `${laid.issues.length} to fix` : 'Runs past one page'}</span></div>
            <PagePreview input={input} lessonId={l.id} logo={logo.data ?? null} boxes={free ? { boxes: content.layout.boxes, issues: laid.issues, onChange: setBoxes, editable } : undefined} />
            {free && laid.issues.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-xs text-danger">{laid.issues.map((i, n) => <li key={n}>• {i.text}</li>)}</ul>
            )}
          </div>
          {l.status === 'draft' && problems.length > 0 && (
            <div className="mt-3 rounded-lg border border-border bg-surface p-3 text-sm"><b>Before it can go for review</b>
              <ul className="mt-1 list-disc pl-5 text-text-muted">{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
          )}
        </div>
      </div>

      {designs && <DesignsDialog input={input} lessonId={l.id} logo={logo.data ?? null} onClose={() => setDesigns(false)} onPick={(b) => { setBoxes(b); setDesigns(false); }} />}
      {dialog === 'submit' && list.data && <SubmitDialog lesson={l} data={list.data} me={d.me} problems={problems} onClose={() => setDialog(null)} onDone={reload} before={flush} />}
      {dialog && dialog !== 'submit' && (
        <StepDialog step={dialog} lesson={l} onClose={() => setDialog(null)} before={flush} onDone={(deleted) => { if (deleted) { qc.invalidateQueries({ queryKey: ['lessons'] }); window.history.back(); } else reload(); }} />
      )}
    </section>
  );
}

function Section({ title, aside, hidden, children }: { title: string; aside?: ReactNode; hidden?: boolean; children: ReactNode }) {
  return (
    <Card className="!p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="font-display text-sm font-bold">{title}{hidden && <span className="ml-2 font-sans text-xs font-normal text-text-subtle">not on the page</span>}</h2>
        {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
      </div>
      <div className={cx('flex flex-col gap-3 p-4', hidden && 'opacity-60')}>{children}</div>
    </Card>
  );
}

/** Shows or hides a part on the page; what is written is kept either way. */
function ShowSwitch({ shown, onToggle, disabled }: { shown: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={shown} disabled={disabled} onClick={onToggle} title={shown ? 'Shown on the page: click to hide it (the text is kept)' : 'Hidden from the page: click to show it'}
      className={cx('inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-xs font-semibold disabled:opacity-50', shown ? 'border-success text-success' : 'border-border-strong text-text-subtle')}>
      {shown ? <Eye aria-hidden className="size-3.5" /> : <EyeOff aria-hidden className="size-3.5" />}{shown ? 'Shown' : 'Hidden'}
    </button>
  );
}

/** The same content in each ready-made layout, to pick one. */
function DesignsDialog({ input, lessonId, logo, onClose, onPick }: { input: PageInput; lessonId: string; logo: { url: string; w: number; h: number } | null; onClose: () => void; onPick: (b: Record<string, Rect>) => void }) {
  const options = useMemo(() => (Object.keys(DESIGNS) as Design[]).map((k) => {
    const boxes = designBoxes(input, k);
    const shown = { ...input, content: { ...input.content, layout: { mode: 'free' as const, boxes } } };
    return { k, boxes, shown, issues: layoutLesson(shown).issues.length };
  }), [input]);
  return (
    <Dialog title="Choose a layout" onClose={onClose} wide>
      <p className="mb-3 text-sm text-text-muted">The same content arranged four ways. Each part keeps its own box, which you can still move after.</p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {options.map((o) => (
          <li key={o.k} className="flex flex-col gap-2">
            <button type="button" onClick={() => onPick(o.boxes)} className="rounded-md border border-border p-1 hover:border-accent-edge focus:border-accent-edge" aria-label={`Use the layout ${DESIGNS[o.k].label}`}>
              <PagePreview input={o.shown} lessonId={lessonId} logo={logo} />
            </button>
            <div className="text-sm"><b>{DESIGNS[o.k].label}</b><p className="text-xs text-text-muted">{DESIGNS[o.k].blurb}</p>
              {o.issues > 0 && <p className="text-xs text-danger">{o.issues} to fix after</p>}</div>
            <Button size="sm" onClick={() => onPick(o.boxes)}>Use this layout</Button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function ShowAs<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (v: T) => void }) {
  return <div className="flex flex-wrap items-center gap-2"><span className="label-caps text-text-muted">Show as</span><Segmented label={label} value={value} options={options} onChange={onChange} /></div>;
}

function Chips({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  const add = (v: string) => { const t = v.trim(); if (t && !values.includes(t) && values.length < LIMITS.damage) onChange([...values, t]); setText(''); };
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-1.5">
        {values.map((v) => <li key={v} className="inline-flex items-center gap-1 rounded-pill border border-border bg-surface-2 py-0.5 pr-1 pl-2.5 text-sm">{v}
          <button type="button" aria-label={`Remove ${v}`} className="rounded-pill p-0.5 hover:bg-surface-3" onClick={() => onChange(values.filter((x) => x !== v))}><X aria-hidden className="size-3.5" /></button></li>)}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(text); }}>
        <input aria-label="Add potential damage" className={inputClass} list="ll-damage" value={text} placeholder="Add (people injury, equipment damage…)" onChange={(e) => setText(e.target.value)} />
        <datalist id="ll-damage">{DAMAGE_SUGGESTIONS.filter((s) => !values.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
        <Button type="submit" disabled={!text.trim()}><Plus aria-hidden className="size-4" />Add</Button>
      </form>
    </div>
  );
}

function Actions({ actions, onChange }: { actions: LessonContent['actions']; onChange: (a: LessonContent['actions']) => void }) {
  const upd = (i: number, patch: Partial<LessonContent['actions'][number]>) => onChange(actions.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div className="flex flex-col gap-3">
      {actions.map((a, i) => (
        <div key={i} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_150px_150px_auto]">
          <Field id={`la-a${i}`} label={`Action ${i + 1}`}><input id={`la-a${i}`} className={inputClass} value={a.action} maxLength={300} onChange={(e) => upd(i, { action: e.target.value })} /></Field>
          <Field id={`la-r${i}`} label="Responsible"><input id={`la-r${i}`} className={inputClass} value={a.responsible} maxLength={60} placeholder="Role" onChange={(e) => upd(i, { responsible: e.target.value })} /></Field>
          <Field id={`la-d${i}`} label="Target date"><input id={`la-d${i}`} type="date" className={inputClass} value={a.due} onChange={(e) => upd(i, { due: e.target.value })} /></Field>
          <div className="flex items-end"><Button variant="ghost" aria-label={`Remove action ${i + 1}`} onClick={() => onChange(actions.filter((_, j) => j !== i))}><Trash2 aria-hidden className="size-4" /></Button></div>
        </div>
      ))}
      {actions.length < LIMITS.actions && <div><Button onClick={() => onChange([...actions, { action: '', responsible: '', due: '' }])}><Plus aria-hidden className="size-4" />Add action</Button></div>}
      <p className="text-xs text-text-subtle">An action with no text is left out of the page.</p>
    </div>
  );
}

function Pictures({ lessonId, pictures, editable, kind, hidden, onToggle, onChange, onUploaded, onRemove, onError }: {
  lessonId: string; pictures: LessonPicture[]; editable: boolean; kind: LessonKind; hidden: Set<string>; onToggle: (id: string) => void; onChange: (p: LessonPicture[]) => void;
  onUploaded: (f: File, section: 'description' | 'analysis') => Promise<void>; onRemove: (p: LessonPicture) => Promise<void>; onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const hd = headings(kind);
  const upload = async (files: File[]) => {
    setBusy(true);
    try { for (const f of files.filter((x) => /^image\/(jpeg|png|webp|gif)$/.test(x.type)).slice(0, LIMITS.pictures - pictures.length)) await onUploaded(f, 'description'); }
    catch (e) { onError((e as Error).message); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const move = (i: number, by: number) => { const p = [...pictures]; const [x] = p.splice(i, 1); p.splice(Math.max(0, Math.min(p.length, i + by)), 0, x); onChange(p); };
  const [ask, confirmDialog] = useConfirm();
  return (
    <div className="flex flex-col gap-3" onPaste={(e) => { if (!editable) return; const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); upload(f); } }}>
      {confirmDialog}
      {!pictures.length && <p className="text-sm text-text-muted">No pictures yet. Add photos, sketches or diagrams; each gets a caption and its place.</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {pictures.map((p, i) => (
          <li key={p.id} className="flex gap-3 rounded-md border border-border p-2">
            <img src={`/api/lessons/${lessonId}/pictures/${p.id}`} alt={p.caption || `Picture ${i + 1}`} className="size-20 shrink-0 rounded-sm bg-surface-3 object-cover" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <input aria-label={`Caption of picture ${i + 1}`} className={inputClass} value={p.caption} maxLength={LIMITS.caption} placeholder="Caption" onChange={(e) => onChange(pictures.map((x) => (x.id === p.id ? { ...x, caption: e.target.value } : x)))} />
              <div className="flex flex-wrap items-center gap-1">
                <select aria-label={`Where picture ${i + 1} goes`} className={cx(inputClass, '!w-auto py-1 text-xs')} value={p.section} onChange={(e) => onChange(pictures.map((x) => (x.id === p.id ? { ...x, section: e.target.value as LessonPicture['section'] } : x)))}>
                  <option value="description">After {hd.description.toLowerCase()}</option><option value="analysis">After {hd.analysis.toLowerCase()}</option>
                </select>
                <Button size="sm" variant="ghost" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
                <Button size="sm" variant="ghost" aria-label="Move later" disabled={i === pictures.length - 1} onClick={() => move(i, 1)}>↓</Button>
                <ShowSwitch shown={!hidden.has(`pic:${p.id}`)} onToggle={() => onToggle(`pic:${p.id}`)} disabled={!editable} />
                {editable && <Button size="sm" variant="ghost" aria-label={`Remove picture ${i + 1}`} onClick={async () => { if (await ask({ title: `Remove picture ${i + 1}?`, body: 'It is taken off the lesson.', confirm: 'Remove picture', danger: true })) onRemove(p).catch((e: Error) => onError(e.message)); }}><Trash2 aria-hidden className="size-3.5" /></Button>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {editable && pictures.length < LIMITS.pictures && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" id={`pic-${lessonId}`} onChange={(e) => upload([...(e.target.files ?? [])])} />
          <Button loading={busy} onClick={() => fileRef.current?.click()}><ImagePlus aria-hidden className="size-4" />Add picture or diagram</Button>
          <span className="text-xs text-text-subtle">or paste one here. Up to {LIMITS.pictures}.</span>
        </div>
      )}
    </div>
  );
}

function ReportDraft({ lessonId, onDone, before }: { lessonId: string; onDone: (msg?: string) => void; before: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const go = async (f: File) => {
    setBusy(true);
    try { await before(); await sendFile(`/lessons/${lessonId}/analyse`, f, { 'X-File-Name': encodeURIComponent(f.name) }); onDone(); }
    catch (e) { onDone((e as Error).message); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <Sparkles aria-hidden className="size-5 text-accent-text" />
        <p className="min-w-0 flex-1 text-sm text-text-muted">Draft the page with AI from a failure report. What AI writes replaces the text of each part and is marked to check.</p>
        <input ref={ref} type="file" accept=".pdf,.docx,.pptx" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) go(f); }} />
        <Button loading={busy} onClick={() => ref.current?.click()}>{busy ? 'Reading the report…' : 'Pick the failure report'}</Button>
      </div>
    </Card>
  );
}

function SubmitDialog({ lesson, data, me, problems, onClose, onDone, before }: { lesson: Lesson; data: ListData; me: string; problems: string[]; onClose: () => void; onDone: () => void; before: () => Promise<void> }) {
  const others = (list: Person[]) => list.filter((p) => p.username.toLowerCase() !== me.toLowerCase());
  const [reviewer, setReviewer] = useState(lesson.reviewer ?? '');
  const [approver, setApprover] = useState(lesson.approver ?? '');
  const [note, setNote] = useState('');
  const [change, setChange] = useState(lesson.change_note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true); setError(null);
    try { await before(); await api(`/lessons/${lesson.id}/submit`, { method: 'POST', json: { reviewer, approver, note, change_note: change } }); onClose(); onDone(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Send for review" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">The reviewer can edit it and passes it to the approver. Approval numbers it, makes the PDF and PowerPoint and publishes them in the Knowledge Hub for {lesson.country}.</p>
        <Field id="ls-rev" label="Reviewer"><select id="ls-rev" className={inputClass} value={reviewer} onChange={(e) => setReviewer(e.target.value)}><option value="">Pick…</option>{others(data.reviewers).map((p) => <option key={p.username} value={p.username}>{p.name}</option>)}</select></Field>
        <Field id="ls-app" label="Approver"><select id="ls-app" className={inputClass} value={approver} onChange={(e) => setApprover(e.target.value)}><option value="">Pick…</option>{others(data.approvers).map((p) => <option key={p.username} value={p.username}>{p.name}</option>)}</select></Field>
        {lesson.kb_doc_id && <Field id="ls-ch" label="What changes in this revision"><input id="ls-ch" className={inputClass} value={change} maxLength={200} onChange={(e) => setChange(e.target.value)} /></Field>}
        <Field id="ls-note" label="Note to the reviewer (optional)"><textarea id="ls-note" rows={2} className={cx(inputClass, 'h-auto py-2')} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
        {problems.length > 0 && <Banner tone="warning">{problems.join('. ')}.</Banner>}
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!reviewer || !approver || problems.length > 0} onClick={send}><Send aria-hidden className="size-4" />Send</Button></div>
      </div>
    </Dialog>
  );
}

const STEP_TEXT = {
  review: { title: 'Pass review', field: 'Comment for the approver (optional)', button: 'Pass to approver', need: false },
  approve: { title: 'Approve and publish', field: 'Comment (optional)', button: 'Approve and publish', need: false },
  'send-back': { title: 'Send back', field: 'Why it is sent back', button: 'Send back', need: true },
  revise: { title: 'New revision', field: 'What changes in this revision', button: 'Start the revision', need: true },
  delete: { title: 'Delete this draft', field: '', button: 'Delete', need: false },
} as const;

function StepDialog({ step, lesson, onClose, onDone, before }: { step: keyof typeof STEP_TEXT; lesson: Lesson; onClose: () => void; onDone: (deleted?: boolean) => void; before: () => Promise<void> }) {
  const t = STEP_TEXT[step];
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setError(null);
    try {
      await before();
      if (step === 'delete') await api(`/lessons/${lesson.id}`, { method: 'DELETE' });
      else await api(`/lessons/${lesson.id}/${step}`, { method: 'POST', json: step === 'send-back' ? { reason: text } : step === 'revise' ? { change_note: text } : { comment: text } });
      onClose(); onDone(step === 'delete');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog title={t.title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {step === 'approve' && <p className="text-sm text-text-muted">It gets its Knowledge Hub number{lesson.kb_doc_id ? ` (${lesson.doc_no}, next revision)` : ''}, the PDF and PowerPoint are made, and both are published for {lesson.country}. Approving again later never adds copies.</p>}
        {step === 'revise' && <p className="text-sm text-text-muted">It comes back here as a draft. The published revision stays in the Knowledge Hub until this one is approved.</p>}
        {step === 'delete' && <p className="text-sm text-text-muted">The draft, its pictures and the failure report are deleted. This can’t be undone.</p>}
        {t.field && <Field id="ls-step" label={t.field}><textarea id="ls-step" rows={3} className={cx(inputClass, 'h-auto py-2')} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} /></Field>}
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button>
          <Button variant={step === 'delete' ? 'danger' : 'primary'} loading={busy} disabled={t.need && !text.trim()} onClick={go}>{t.button}</Button></div>
      </div>
    </Dialog>
  );
}

