import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Plus, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import {
  APPROVER_LABEL, APPROVER_ROLES, COPY_COMPANIES, COPY_STATE, copyKind, copyNumber, copyState, mayHaveCopies, type CopyCompany, type CopySettings, type CopyState,
} from '../../../shared/companyCopy';
import type { KnowledgeDoc } from '../../../shared/knowledge';
import { ApiError, api, formatDate } from '../../api';
import { Banner, Button, Card, Field, Skeleton, cx, inputClass } from '../../components/ui';
import { Dialog, linkBtn, type Library } from './common';

// Company copies of global NESR SOPs and SWIs (6z.21, in Word) and of lessons (6z.27, in PowerPoint): the question
// after saving, the panel in the details, the lines under the NESR document in the list, the note on a copy, and the
// company templates in Settings.

/** Words for the kind of file a document's copies are. */
const KIND = {
  word: { file: 'Word file', app: 'Word', ext: '.docx', tpl: 'one of the company’s own SOPs in Word: the copy takes its logo, header and footer' },
  slides: { file: 'PowerPoint file', app: 'PowerPoint', ext: '.pptx', tpl: 'one of the company’s own presentations: the copy takes its slide masters, layouts, theme and logo' },
} as const;

const SWATCH: Record<CopyCompany, string> = { SAPESCO: '#EE0000', 'Gulf Energy': '#863A3A' };
const TONE: Record<CopyState, string> = { draft: 'border-border text-text-muted', review: 'border-warning text-warning', approval: 'border-warning text-warning', behind: 'border-warning text-warning', current: 'border-success text-success' };

interface SettingsReply { copies: CopySettings; isAdmin: boolean }
const useCopySettings = () => useQuery({ queryKey: ['knowledge-settings'], queryFn: () => api<SettingsReply & Record<string, unknown>>('/knowledge/settings') });

function Swatch({ company, colour }: { company: string; colour?: string }) {
  return <span aria-hidden className="inline-block size-3 shrink-0 rounded-xs" style={{ background: colour ? `#${colour}` : SWATCH[company as CopyCompany] ?? 'currentColor' }} />;
}

export const copiesOf = (lib: Library, doc: KnowledgeDoc) => lib.docs.filter((d) => d.copy_of === doc.id);

export function CopyPill({ copy, source }: { copy: KnowledgeDoc; source: KnowledgeDoc }) {
  const s = copyState(copy, source);
  return <span className={cx('label-caps inline-flex items-center rounded-xs border px-1.5 whitespace-nowrap', TONE[s])}>{s === 'current' || s === 'behind' ? `Rev ${copy.revision} · ` : ''}{COPY_STATE[s]}</span>;
}

/** Under a NESR document in the list: its SAPESCO and Gulf Energy copies and where each stands. */
export function CopyLines({ doc, all, onOpen, className }: { doc: KnowledgeDoc; all: KnowledgeDoc[]; onOpen: (d: KnowledgeDoc) => void; className?: string }) {
  const copies = all.filter((d) => d.copy_of === doc.id);
  if (!copies.length) return null;
  return (
    <ul aria-label={`Company copies of ${doc.title}`} className={cx('flex min-w-0 max-w-full flex-col gap-1 border-l-2 border-border pl-3', className)}>
      {copies.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <Swatch company={c.company ?? ''} />
          <span className="font-semibold">{c.company}</span>
          <button type="button" className="font-mono hover:underline" onClick={() => onOpen(c)}>{c.doc_no ?? c.title}</button>
          <CopyPill copy={c} source={doc} />
        </li>
      ))}
    </ul>
  );
}

/** On a copy: what it was made from, and while it is a draft, what the admin does next. */
export function CopyNote({ doc, lib, onOpen }: { doc: KnowledgeDoc; lib: Library; onOpen: (id: string) => void }) {
  if (!doc.copy_of) return null;
  const source = lib.docs.find((d) => d.id === doc.copy_of);
  const state = source ? copyState(doc, source) : null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      <Banner tone="info">
        {doc.company} copy of {source ? <button type="button" className="font-mono underline" onClick={() => onOpen(source.id)}>{source.doc_no ?? source.title}</button> : 'a NESR document'}, made from its Rev {doc.copy_of_revision ?? doc.revision}.
      </Banner>
      {state === 'draft' && doc.open?.status === 'draft' && (
        <Banner tone="warning">
          <span className="font-semibold">Waiting for the PDF.</span> 1. Download the {KIND[copyKind(doc)].file} below. 2. Open it in {KIND[copyKind(doc)].app}, check it and save it as PDF. 3. Add the PDF to this draft and send it for review.
          If you fix anything in {KIND[copyKind(doc)].app}, replace the editable version too.
        </Banner>
      )}
      {state === 'behind' && source && <Banner tone="warning">The NESR source is now at Rev {source.revision}. Make the copy again from its details.</Banner>}
    </div>
  );
}

/** In the details of a global NESR SOP or SWI: its copies, and the button to make them (again). */
export function CopiesPanel({ doc, lib, onOpen, onMake }: { doc: KnowledgeDoc; lib: Library; onOpen: (id: string) => void; onMake: () => void }) {
  const staff = lib.me.admin || lib.me.editor || lib.me.reviewer || lib.me.approver;
  if (!mayHaveCopies(doc) || !staff) return null;
  const copies = copiesOf(lib, doc);
  const mayMake = lib.me.admin || lib.me.editor;
  return (
    <section className="mt-4 rounded-md border border-border p-3" aria-label="Company copies">
      <h3 className="font-display text-sm font-bold">SAPESCO and Gulf Energy copies</h3>
      {copies.length ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {copies.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Swatch company={c.company ?? ''} /><span className="min-w-24 font-semibold">{c.company}</span>
              <button type="button" className="font-mono text-xs hover:underline" onClick={() => onOpen(c.id)}>{c.doc_no ?? c.title}</button>
              <CopyPill copy={c} source={doc} />
            </li>
          ))}
        </ul>
      ) : <p className="mt-1 text-sm text-text-muted">None yet. The app writes each company’s {KIND[copyKind(doc)].file} from this document’s editable version; an admin saves it as PDF and sends it for review.</p>}
      {mayMake && <Button size="sm" className="mt-2" onClick={onMake}><Copy aria-hidden className="size-3.5" />{copies.length ? 'Make the copies again' : 'Make company copies'}</Button>}
    </section>
  );
}

interface Made { company: CopyCompany; id: string; doc_no: string | null; revision: number; changes: { label: string; n: number }[]; leftovers: string[] }

/** Asked after saving a global NESR SOP or SWI (and from its details): which company copies to make. */
export function MakeCopiesDialog({ doc, onClose, onOpen }: { doc: KnowledgeDoc; onClose: (changed: boolean) => void; onOpen: (id: string) => void }) {
  const s = useCopySettings();
  const [pick, setPick] = useState<Record<CopyCompany, boolean>>({ SAPESCO: true, 'Gulf Energy': true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ made: Made[]; skipped: { company: CopyCompany; reason: string }[] } | null>(null);
  const copies = s.data?.copies;
  const kind = copyKind(doc), K = KIND[kind];
  const ready = (co: CopyCompany) => !!(kind === 'slides' ? copies?.companies[co].slides : copies?.companies[co].template);
  const chosen = COPY_COMPANIES.filter((co) => pick[co] && ready(co));
  // when the stored editable version isn't a .docx, the Word file can be picked here, for the copies only
  const [needsWord, setNeedsWord] = useState(false);
  const make = async (word?: File) => {
    setBusy(true); setError(null);
    try {
      setResult(word
        ? await api(`/knowledge/${doc.id}/copies?companies=${encodeURIComponent(chosen.join(','))}`, { method: 'POST', body: word, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(word.name) } })
        : await api(`/knowledge/${doc.id}/copies`, { method: 'POST', json: { companies: chosen } }));
      setNeedsWord(false);
    } catch (e) { setError((e as ApiError).message); if ((e as ApiError).body?.needsWord) setNeedsWord(true); } finally { setBusy(false); }
  };
  // an admin adds a missing template right here, without leaving the document
  const qc = useQueryClient();
  const [adding, setAdding] = useState<CopyCompany | null>(null);
  const addTemplate = async (co: CopyCompany, file: File | undefined) => {
    if (!file) return;
    setAdding(co); setError(null);
    try {
      await api(`/knowledge/settings/copies/${encodeURIComponent(co)}/template${kind === 'slides' ? '?kind=slides' : ''}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } });
      await qc.invalidateQueries({ queryKey: ['knowledge-settings'] });
      setPick((p) => ({ ...p, [co]: true }));
    } catch (e) { setError((e as ApiError).message); } finally { setAdding(null); }
  };
  const admin = !!s.data?.isAdmin;
  return (
    <Dialog title="Make company copies?" onClose={() => onClose(!!result?.made.length)}>
      <p className="text-sm text-text-muted"><span className="font-mono">{doc.doc_no}</span> · {doc.title}</p>
      {error && <div className="mt-2"><Banner tone="danger">{error}</Banner></div>}
      {s.isLoading && <Skeleton className="mt-3 h-24" />}
      {copies && !result && (
        <>
          <div className="mt-3 flex flex-col gap-2">
            {COPY_COMPANIES.map((co) => {
              const t = copies.companies[co];
              const noNames = !Object.values(t.approvers).some(Boolean);
              return (
                <div key={co} className="flex items-start gap-3 rounded-md border border-border p-3">
                  <input id={`mc-${co}`} type="checkbox" className="mt-1 size-4" disabled={!ready(co)} checked={pick[co] && ready(co)} onChange={(e) => setPick({ ...pick, [co]: e.target.checked })} />
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`mc-${co}`} className={cx('flex items-center gap-2 font-semibold', !ready(co) && 'text-text-muted')}><Swatch company={co} colour={t.colour} />{co}</label>
                    {ready(co) ? (
                      <p className="text-xs text-text-muted">
                        {kind === 'slides' ? 'Slides' : 'Word'} copy <span className="font-mono">{copyNumber(doc.doc_no, t.prefix) ?? doc.title}</span> in {kind === 'slides' ? `Lessons › ${doc.country}` : `${doc.section === 'swi' ? 'SWI' : 'SOP'} › Global › ${co}`}
                        {kind === 'word' && noNames && <span className="block">Cover names: kept from the NESR document until an admin sets {co}’s in Settings.</span>}
                      </p>
                    ) : admin ? (
                      <>
                        <p className="text-xs text-text-muted">No {co} {kind === 'slides' ? 'slides ' : ''}template yet. Add {K.tpl.replace('the company’s', `${co}’s`)}.</p>
                        <label className={cx(linkBtn, 'mt-2 cursor-pointer')}><Upload aria-hidden className="size-3.5" />{adding === co ? 'Saving the template…' : `Add the ${co} ${kind === 'slides' ? 'slides ' : ''}template (${K.ext})`}
                          <input type="file" accept={K.ext} className="sr-only" disabled={!!adding} onChange={(e) => addTemplate(co, e.target.files?.[0])} /></label>
                      </>
                    ) : <p className="text-xs text-text-muted">No {co} {kind === 'slides' ? 'slides ' : ''}template yet. Ask an admin to add it in Knowledge Hub › Doc Control › Settings › Company templates.</p>}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-text-muted">Made from this document’s editable {K.file}. Each copy starts as a draft: an admin saves it as PDF and uploads it, then it goes for review and approval.</p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => onClose(false)}>Not now</Button>
            {needsWord && (
              <label className={cx(linkBtn, 'h-(--layout-control-md) cursor-pointer', (busy || !chosen.length) && 'pointer-events-none opacity-50')}><Upload aria-hidden className="size-4" />Pick the {K.ext} file
                <input type="file" accept={K.ext} className="sr-only" disabled={busy || !chosen.length} onChange={(e) => { const f = e.target.files?.[0]; if (f) make(f); }} /></label>
            )}
            <Button variant="primary" loading={busy} disabled={!chosen.length} onClick={() => make()}><Copy aria-hidden className="size-4" />{!chosen.length ? 'Make copies' : chosen.length === 1 ? 'Make the copy' : `Make ${chosen.length} copies`}</Button>
          </div>
        </>
      )}
      {result && (
        <div className="mt-3 flex flex-col gap-2">
          {result.made.map((m) => (
            <div key={m.id} className="rounded-md border border-border p-3">
              <p className="flex flex-wrap items-center gap-2 font-semibold"><Swatch company={m.company} />{m.company} <span className="font-mono text-sm font-normal">{m.doc_no}</span> <span className="text-sm font-normal text-text-muted">Rev {m.revision} draft</span></p>
              <ul className="mt-1 list-disc pl-5 text-xs text-text-muted">{m.changes.map((c) => <li key={c.label}>{c.label}{c.n > 1 ? ` (${c.n})` : ''}</li>)}</ul>
              {m.leftovers.length > 0 && <div className="mt-2"><Banner tone="warning">Check: {m.leftovers.map((x) => (/^The slide size/.test(x) ? x : `still says NESR “…${x}…”`)).join(' · ')}. Fix it in {K.app} before making the PDF.</Banner></div>}
              <Button size="sm" className="mt-2" onClick={() => { onClose(true); onOpen(m.id); }}>Open the copy</Button>
            </div>
          ))}
          {result.skipped.map((x) => <Banner key={x.company} tone="warning">{x.company}: {x.reason}</Banner>)}
          <Button className="self-end" onClick={() => onClose(!!result.made.length)}>Done</Button>
        </div>
      )}
    </Dialog>
  );
}

// ---- Settings › Company templates ----------------------------------------------------------------------------------

export function CompanyTemplates() {
  const qc = useQueryClient();
  const s = useCopySettings();
  if (s.isLoading) return <Skeleton className="h-48" />;
  if (s.isError || !s.data) return null;
  return <TemplatesForm key={JSON.stringify(s.data.copies)} data={s.data} onSaved={() => qc.invalidateQueries({ queryKey: ['knowledge-settings'] })} />;
}

function TemplatesForm({ data, onSaved }: { data: SettingsReply; onSaved: () => void }) {
  const [v, setV] = useState<CopySettings>(data.copies);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const admin = data.isAdmin;
  const set = (co: CopyCompany, patch: Partial<CopySettings['companies'][CopyCompany]>) => setV({ ...v, companies: { ...v.companies, [co]: { ...v.companies[co], ...patch } } });
  const save = async () => {
    setBusy('save'); setMsg(null);
    try { await api('/knowledge/settings/copies', { method: 'PUT', json: v }); setMsg({ tone: 'success', text: 'Company templates saved' }); onSaved(); }
    catch (e) { setMsg({ tone: 'danger', text: (e as ApiError).message }); } finally { setBusy(null); }
  };
  const upload = async (co: CopyCompany, file: File | undefined, slides = false) => {
    if (!file) return;
    setBusy(slides ? `${co}-slides` : co); setMsg(null);
    try {
      await api(`/knowledge/settings/copies/${encodeURIComponent(co)}/template${slides ? '?kind=slides' : ''}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } });
      setMsg({ tone: 'success', text: `${co} ${slides ? 'slides ' : ''}template saved` }); onSaved();
    } catch (e) { setMsg({ tone: 'danger', text: (e as ApiError).message }); } finally { setBusy(null); }
  };
  return (
    <Card>
      <h2 className="font-display text-base font-bold">Company templates</h2>
      <p className="mt-1 text-sm text-text-muted">For SAPESCO and Gulf Energy copies of global NESR SOPs and SWIs (Word template: one of the company’s own SOPs, for its header, footer and logo) and of lessons (PowerPoint template: one of the company’s own presentations, for its slide masters, layouts, theme and logo). The colour replaces the NESR colour, the prefix replaces NESR in document numbers, and the name replaces NESR in the text. Cover names left blank keep the names in the NESR document.</p>
      {msg && <div className="mt-2"><Banner tone={msg.tone}>{msg.text}</Banner></div>}
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {COPY_COMPANIES.map((co) => {
          const t = v.companies[co];
          return (
            <section key={co} className="rounded-md border border-border border-t-4 p-3" style={{ borderTopColor: `#${/^[0-9a-f]{6}$/i.test(t.colour) ? t.colour : '888888'}` }} aria-label={`${co} template`}>
              <h3 className="font-display text-sm font-bold">{co}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {t.template
                  ? <><span className="min-w-0 flex-1 basis-48 break-words">{t.template.file_name}<span className="block text-xs text-text-muted">Added {formatDate(t.template.uploaded_at.slice(0, 10))}</span></span>
                    <a className={linkBtn} href={`/api/knowledge/settings/copies/${encodeURIComponent(co)}/template`} download={t.template.file_name}><Download aria-hidden className="size-3.5" />Download</a></>
                  : <span className="flex-1 text-warning">No template yet: copies can’t be made for {co}.</span>}
                {admin && <label className={cx(linkBtn, 'cursor-pointer')}><Upload aria-hidden className="size-3.5" />{busy === co ? 'Saving…' : t.template ? 'Replace' : 'Add the Word template'}
                  <input type="file" accept=".docx" className="sr-only" disabled={!!busy} onChange={(e) => upload(co, e.target.files?.[0])} /></label>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2 text-sm">
                {t.slides
                  ? <><span className="min-w-0 flex-1 basis-48 break-words"><span className="label-caps mr-1 text-text-muted">Slides</span>{t.slides.file_name}<span className="block text-xs text-text-muted">Added {formatDate(t.slides.uploaded_at.slice(0, 10))}</span></span>
                    <a className={linkBtn} href={`/api/knowledge/settings/copies/${encodeURIComponent(co)}/template?kind=slides`} download={t.slides.file_name}><Download aria-hidden className="size-3.5" />Download</a></>
                  : <span className="flex-1 text-warning">No slides template yet: lesson copies can’t be made for {co}.</span>}
                {admin && <label className={cx(linkBtn, 'cursor-pointer')}><Upload aria-hidden className="size-3.5" />{busy === `${co}-slides` ? 'Saving…' : t.slides ? 'Replace' : 'Add the PowerPoint template'}
                  <input type="file" accept=".pptx" className="sr-only" disabled={!!busy} onChange={(e) => upload(co, e.target.files?.[0], true)} /></label>}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field id={`ct-${co}-prefix`} label="Number prefix" hint={`NESR-8000-SOP-11 → ${copyNumber('NESR-8000-SOP-11', t.prefix || '?')}`}>
                  <input id={`ct-${co}-prefix`} className={inputClass} disabled={!admin} value={t.prefix} onChange={(e) => set(co, { prefix: e.target.value.toUpperCase() })} />
                </Field>
                <Field id={`ct-${co}-colour`} label="Colour (hex)" hint="Replaces the NESR colour">
                  <div className="flex items-center gap-2"><Swatch company={co} colour={t.colour} /><input id={`ct-${co}-colour`} className={inputClass} disabled={!admin} value={t.colour} onChange={(e) => set(co, { colour: e.target.value.replace('#', '').toUpperCase() })} /></div>
                </Field>
                <Field id={`ct-${co}-name`} label="Name in the text" hint="Replaces NESR"><input id={`ct-${co}-name`} className={inputClass} disabled={!admin} value={t.name} onChange={(e) => set(co, { name: e.target.value })} /></Field>
                <Field id={`ct-${co}-long`} label="Full name" hint="Replaces National Energy Services Reunited"><input id={`ct-${co}-long`} className={inputClass} disabled={!admin} value={t.longName} onChange={(e) => set(co, { longName: e.target.value })} /></Field>
                {APPROVER_ROLES.map((k) => (
                  <div key={k} className="sm:col-span-2">
                    <Field id={`ct-${co}-${k}`} label={`Cover: ${APPROVER_LABEL[k]}`}>
                      <input id={`ct-${co}-${k}`} className={inputClass} disabled={!admin} placeholder="Name (role), or blank to keep the NESR name" value={t.approvers[k]} onChange={(e) => set(co, { approvers: { ...t.approvers, [k]: e.target.value } })} />
                    </Field>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs font-semibold">More words to replace</p>
              <ul className="mt-1 flex flex-col gap-1">
                {t.words.map((w, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-1">
                    <input aria-label="Replace" className={cx(inputClass, 'min-w-0 flex-1 basis-28')} disabled={!admin} value={w.from} onChange={(e) => set(co, { words: t.words.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)) })} />
                    <span aria-hidden className="text-text-muted">→</span>
                    <input aria-label="With" className={cx(inputClass, 'min-w-0 flex-1 basis-28')} disabled={!admin} value={w.to} onChange={(e) => set(co, { words: t.words.map((x, k) => (k === i ? { ...x, to: e.target.value } : x)) })} />
                    {admin && <Button size="sm" variant="ghost" aria-label="Remove this word" onClick={() => set(co, { words: t.words.filter((_, k) => k !== i) })}><Trash2 aria-hidden className="size-3.5" /></Button>}
                  </li>
                ))}
              </ul>
              {admin && <Button size="sm" variant="ghost" className="mt-1" onClick={() => set(co, { words: [...t.words, { from: '', to: '' }] })}><Plus aria-hidden className="size-3.5" />Add a word</Button>}
            </section>
          );
        })}
      </div>
      <div className="mt-3 max-w-sm">
        <Field id="ct-nesr" label="NESR colours to replace (hex, comma separated)" hint="The cover blocks and table borders of NESR documents use 024800">
          <input id="ct-nesr" className={inputClass} disabled={!admin} value={v.nesrColours.join(', ')} onChange={(e) => setV({ ...v, nesrColours: e.target.value.split(',').map((x) => x.trim().replace('#', '').toUpperCase()).filter(Boolean) })} />
        </Field>
      </div>
      {admin ? <Button variant="primary" className="mt-3" loading={busy === 'save'} onClick={save}>Save company templates</Button> : <p className="mt-3 text-sm text-text-muted">Only an admin changes the company templates.</p>}
    </Card>
  );
}
