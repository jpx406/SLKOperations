import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, Pencil, Play, Plus, Search, Star, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { DOC_TYPES, filterLibrary, lessonOfWeek, type DocType, type KnowledgeDoc } from '../../shared/knowledge';
import { ApiError, api, formatDate } from '../api';
import { useMe } from '../auth';
import { Attachments } from '../components/Attachments';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass, inputSized } from '../components/ui';

// Knowledge Hub (S21) and the reader / toolbox-talk mode (S43). The documents stay with their owner; each card
// carries the summary, the key action and a link to the source.

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

export function KnowledgeHub() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['knowledge'], queryFn: () => api<{ docs: KnowledgeDoc[]; canEdit: boolean }>('/knowledge') });
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const f = { q: params.get('q') ?? '', type: params.get('type') ?? '', category: params.get('category') ?? '', failure: params.get('failure') ?? '', sort: (params.get('sort') === 'az' ? 'az' : 'newest') as 'az' | 'newest', duplicates: params.get('dups') === '1' };
  const all = q.data?.docs ?? [];
  const lib = useMemo(() => filterLibrary(all, f), [all, f.q, f.type, f.category, f.failure, f.sort, f.duplicates]); // eslint-disable-line react-hooks/exhaustive-deps
  const hero = useMemo(() => lessonOfWeek(all, today()), [all]);
  const [reading, setReading] = useState<KnowledgeDoc | null>(null);
  const [present, setPresent] = useState<KnowledgeDoc[] | null>(null);
  const [editing, setEditing] = useState<KnowledgeDoc | 'new' | null>(null);
  const canEdit = !!q.data?.canEdit;
  const refresh = () => qc.invalidateQueries({ queryKey: ['knowledge'] });
  const pick = async (d: KnowledgeDoc) => { await api(`/knowledge/${d.id}/lesson-of-week`, { method: 'POST' }); refresh(); };
  const chip = (on: boolean) => cx('h-(--layout-control-sm) rounded-pill border px-3 text-sm font-semibold', on ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text');

  return (
    <section aria-labelledby="kh-title">
      <PageTitle aside={canEdit && <Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Add document</Button>}>
        <span id="kh-title">Knowledge Hub</span> <span className="ml-2 align-middle font-mono text-sm font-normal text-text-muted">{all.filter((d) => !d.duplicate_of).length} documents</span>
      </PageTitle>
      {q.isLoading && <Skeleton className="h-64" />}
      {q.isSuccess && !all.length && (
        <EmptyState title="The library is empty">{canEdit ? 'Add lessons learnt, best practices and learnings from incidents with Add document. Link each one to its source.' : 'Nothing has been added for your countries yet.'}</EmptyState>
      )}
      {hero && (
        <Card className="mb-4 border-l-4 border-l-warning">
          <p className="label-caps mb-1 flex items-center gap-1 text-warning"><Star aria-hidden className="size-3.5" />Lesson of the week</p>
          <h2 className="font-display text-xl font-bold">{hero.title}</h2>
          <p className="mt-1 text-xs text-text-muted">{DOC_TYPES[hero.doc_type]} · {hero.category}{hero.published_on && ` · ${formatDate(hero.published_on)}`}</p>
          {hero.summary && <p className="mt-2 max-w-3xl text-sm">{hero.summary}</p>}
          {hero.key_action && <p className="mt-2 max-w-3xl text-sm"><span className="font-semibold">Key action: </span>{hero.key_action}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => setPresent([hero])}><Play aria-hidden className="size-4" />Present to the crew</Button>
            <Button size="sm" onClick={() => setReading(hero)}><BookOpen aria-hidden className="size-4" />Read</Button>
          </div>
        </Card>
      )}
      {all.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="relative">
              <span className="sr-only">Search the library</span>
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-text-subtle" />
              <input className={inputSized('w-72 pl-8')} placeholder="Search titles, summaries, actions" value={f.q} onChange={(e) => set('q', e.target.value)} />
            </label>
            <select aria-label="Failure type" className={inputSized('w-56')} value={f.failure} onChange={(e) => set('failure', e.target.value)}>
              <option value="">All failure types</option>{lib.failures.map((x) => <option key={x.value} value={x.value}>{x.value} ({x.n})</option>)}
            </select>
            <select aria-label="Sort" className={inputSized('w-36')} value={f.sort} onChange={(e) => set('sort', e.target.value === 'az' ? 'az' : '')}><option value="newest">Newest</option><option value="az">A → Z</option></select>
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
                <Card className={cx('flex h-full flex-col', d.duplicate_of && 'opacity-70')}>
                  <p className="label-caps text-text-muted">{DOC_TYPES[d.doc_type]} · {d.category}{d.duplicate_of && ' · duplicate'}</p>
                  <h3 className="mt-1 font-display text-base font-bold">{d.title}</h3>
                  {d.summary && <p className="mt-1 line-clamp-3 text-sm text-text-muted">{d.summary}</p>}
                  {d.failure_types.length > 0 && <p className="mt-2 flex flex-wrap gap-1">{d.failure_types.map((t) => <span key={t} className="rounded-sm bg-surface-3 px-1.5 text-xs">{t}</span>)}</p>}
                  <p className="mt-2 text-xs text-text-subtle">{d.published_on ? formatDate(d.published_on) : 'no date'}{d.rilr_ref && <> · <span className="font-mono">{d.rilr_ref}</span></>}</p>
                  <div className="mt-auto flex flex-wrap gap-1 pt-3">
                    <Button size="sm" onClick={() => setReading(d)}><BookOpen aria-hidden className="size-3.5" />Read</Button>
                    <Button size="sm" variant="ghost" onClick={() => setPresent([d])}><Play aria-hidden className="size-3.5" />Present</Button>
                    {canEdit && <Button size="sm" variant="ghost" aria-label={`Edit ${d.title}`} onClick={() => setEditing(d)}><Pencil aria-hidden className="size-3.5" /></Button>}
                    {canEdit && !d.duplicate_of && hero?.id !== d.id && <Button size="sm" variant="ghost" onClick={() => pick(d)} title="Make this the lesson of the week"><Star aria-hidden className="size-3.5" /></Button>}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      {reading && <Reader doc={reading} original={all.find((x) => x.id === reading.duplicate_of)} onClose={() => setReading(null)} onPresent={() => { setPresent([reading]); setReading(null); }} />}
      {present && <Present docs={present} onClose={() => setPresent(null)} />}
      {editing && <Editor doc={editing === 'new' ? null : editing} all={all} onClose={(changed) => { setEditing(null); if (changed) refresh(); }} />}
    </section>
  );
}

function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4">
      <Card className={cx('max-h-[90vh] w-full overflow-y-auto', wide ? 'max-w-3xl' : 'max-w-xl')}>
        <div className="mb-3 flex items-start gap-3"><h2 className="flex-1 font-display text-lg font-bold">{title}</h2><Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}><X aria-hidden className="size-4" /></Button></div>
        {children}
      </Card>
    </div>
  );
}

function Reader({ doc, original, onClose, onPresent }: { doc: KnowledgeDoc; original?: KnowledgeDoc; onClose: () => void; onPresent: () => void }) {
  return (
    <Dialog title={doc.title} onClose={onClose} wide>
      <p className="text-xs text-text-muted">{DOC_TYPES[doc.doc_type]} · {doc.category} · {doc.country}{doc.published_on && ` · ${formatDate(doc.published_on)}`}{doc.rilr_ref && ` · ${doc.rilr_ref}`}</p>
      {original && <div className="mt-2"><Banner tone="info">This repeats “{original.title}”.</Banner></div>}
      {doc.summary && <p className="mt-3 whitespace-pre-wrap text-sm">{doc.summary}</p>}
      {doc.key_action && <div className="mt-3 rounded-md bg-warning-subtle p-3 text-sm"><span className="font-semibold">Key action: </span>{doc.key_action}</div>}
      {doc.failure_types.length > 0 && <p className="mt-3 flex flex-wrap gap-1">{doc.failure_types.map((t) => <span key={t} className="rounded-sm bg-surface-3 px-1.5 text-xs">{t}</span>)}</p>}
      <div className="mt-4 rounded-md border border-border p-3"><Attachments entity="knowledge" id={doc.id} title="Files" /></div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={onPresent}><Play aria-hidden className="size-4" />Present to the crew</Button>
        {doc.source_ref && <a href={doc.source_ref} target="_blank" rel="noreferrer noopener" className="inline-flex h-(--layout-control-md) items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold hover:bg-surface-2"><ExternalLink aria-hidden className="size-4" />Open the source document</a>}
      </div>
    </Dialog>
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
        <p className="label-caps text-warning">{DOC_TYPES[d.doc_type]} · {d.category}</p>
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

function Editor({ doc, all, onClose }: { doc: KnowledgeDoc | null; all: KnowledgeDoc[]; onClose: (changed: boolean) => void }) {
  const { data: me } = useMe();
  const [f, setF] = useState({
    country: doc?.country ?? me?.countries[0] ?? '', doc_type: doc?.doc_type ?? 'lesson_learnt', category: doc?.category ?? '', title: doc?.title ?? '',
    summary: doc?.summary ?? '', key_action: doc?.key_action ?? '', failure_types: (doc?.failure_types ?? []).join(', '), published_on: doc?.published_on ?? '',
    rilr_ref: doc?.rilr_ref ?? '', source_ref: doc?.source_ref ?? '', duplicate_of: doc?.duplicate_of ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const categories = [...new Set(all.map((d) => d.category))].sort();
  const save = async () => {
    setBusy(true); setError(null);
    const body = { ...f, failure_types: f.failure_types.split(',').map((x) => x.trim()).filter(Boolean) };
    try {
      if (doc) await api(`/knowledge/${doc.id}`, { method: 'PUT', json: body }); else await api('/knowledge', { method: 'POST', json: body });
      onClose(true);
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  const input = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <Field id={`kd-${k}`} label={label}><input id={`kd-${k}`} className={inputClass} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></Field>
  );
  return (
    <Dialog title={doc ? 'Edit document' : 'Add document'} onClose={() => onClose(false)} wide>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="kd-type" label="Type"><select id="kd-type" className={inputClass} value={f.doc_type} onChange={(e) => setF({ ...f, doc_type: e.target.value as DocType })}>{Object.entries(DOC_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {!doc && (me?.countries.length ?? 0) > 1 && <Field id="kd-country" label="Country"><select id="kd-country" className={inputClass} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{me?.countries.map((c) => <option key={c}>{c}</option>)}</select></Field>}
        {input('category', 'Category', { list: 'kd-cats', placeholder: 'e.g. Wireline, Pressure control' })}
        <datalist id="kd-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <div className="sm:col-span-2">{input('title', 'Title')}</div>
        <div className="sm:col-span-2"><Field id="kd-summary" label="Summary"><textarea id="kd-summary" rows={4} className={cx(inputClass, 'h-auto py-2')} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field></div>
        <div className="sm:col-span-2">{input('key_action', 'Key action')}</div>
        {input('failure_types', 'Failure types', { placeholder: 'Comma separated, e.g. Wire parted, Stuck tool' })}
        {input('published_on', 'Published', { type: 'date' })}
        {input('rilr_ref', 'RILR / reference')}
        {input('source_ref', 'Link to the source', { type: 'url', placeholder: 'https://…sharepoint.com/…' })}
        <Field id="kd-dup" label="Duplicate of" hint="Hidden from the library unless Show duplicates is on">
          <select id="kd-dup" className={inputClass} value={f.duplicate_of} onChange={(e) => setF({ ...f, duplicate_of: e.target.value })}>
            <option value="">Not a duplicate</option>{all.filter((d) => d.id !== doc?.id && !d.duplicate_of).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </Field>
      </div>
      <Button className="mt-4" variant="primary" loading={busy} disabled={!f.title.trim() || !f.category.trim()} onClick={save}>{doc ? 'Save changes' : 'Add document'}</Button>
    </Dialog>
  );
}
