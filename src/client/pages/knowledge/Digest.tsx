import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, FileDown, Maximize2, Network, Presentation, Printer, RefreshCw, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { fallbackSlides, lessonSlides, mindSize, type Digest, type MindMap, type MindNode, type Slide } from '../../../shared/docDigest';
import type { KnowledgeDoc } from '../../../shared/knowledge';
import { ApiError, api, formatDate } from '../../api';
import { Banner, Button, Skeleton, cx } from '../../components/ui';
import { Dialog } from './common';
import { downloadLesson } from './lessonExport';

// Slides and mind map of a published document (6z.16). Made once per revision by AI from the document and saved,
// so presenting to the crew or checking the mind map during the job never reads the document again.

interface DigestOut { digest: Digest | null; revision?: number; source?: string; made_at?: string; reason?: string; mayMake?: boolean }

/** The saved slides and mind map, with make() to create them the first time (or again, for staff). */
export function useDigest(doc: KnowledgeDoc | null, enabled = true) {
  const qc = useQueryClient();
  const key = ['knowledge-digest', doc?.id, doc?.revision];
  const q = useQuery({ queryKey: key, queryFn: () => api<DigestOut>(`/knowledge/${doc!.id}/digest`), enabled: !!doc && !!doc.published_at && enabled, staleTime: Infinity });
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const make = useCallback(async (again = false) => {
    if (!doc) return null;
    setMaking(true); setError(null);
    try {
      const r = await api<DigestOut>(`/knowledge/${doc.id}/digest`, { method: 'POST', json: { again } });
      qc.setQueryData(key, r);
      return r.digest;
    } catch (e) { setError((e as ApiError).message); return null; } finally { setMaking(false); }
  }, [doc?.id, doc?.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data: q.data, loading: q.isLoading, making, error, make };
}

// ---- mind map ----------------------------------------------------------------------------------------------------

const BRANCH = ['border-accent-text', 'border-warning', 'border-success', 'border-danger', 'border-border-strong', 'border-accent-text', 'border-warning', 'border-success', 'border-danger', 'border-border-strong'];

function Branch({ b, i, side }: { b: MindNode; i: number; side: 'left' | 'right' }) {
  return (
    <div className={cx('relative rounded-md border border-border bg-surface p-3', side === 'left' ? 'border-l-4 lg:border-l lg:border-r-4 lg:text-right' : 'border-l-4', BRANCH[i % BRANCH.length],
      // the line to the centre, on wide screens
      side === 'left' ? 'lg:after:absolute lg:after:top-1/2 lg:after:-right-6 lg:after:w-6 lg:after:border-t lg:after:border-border-strong'
        : 'lg:before:absolute lg:before:top-1/2 lg:before:-left-6 lg:before:w-6 lg:before:border-t lg:before:border-border-strong')}>
      <p className="font-display text-sm font-bold">{b.label}</p>
      {b.children.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {b.children.map((c, j) => (
            <li key={j} className="text-sm">
              <span className="font-semibold">{c.label}</span>
              {c.children.length > 0 && (
                <span className={cx('mt-0.5 flex flex-wrap gap-1', side === 'left' && 'lg:justify-end')}>
                  {c.children.map((g, k) => <span key={k} className="rounded-sm bg-surface-3 px-1.5 text-xs">{g.label}</span>)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The map: the subject in the middle, half the branches on each side on wide screens, one column on a phone. */
export function MindMapView({ map }: { map: MindMap }) {
  const half = Math.ceil(map.branches.length / 2);
  const left = map.branches.slice(0, half), right = map.branches.slice(half);
  return (
    <div className="grid grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_auto_1fr] lg:gap-x-12">
      <div className="order-2 flex flex-col gap-3 lg:order-1">{left.map((b, i) => <Branch key={i} b={b} i={i} side="left" />)}</div>
      <div className="order-1 mx-auto max-w-60 rounded-xl border-2 border-accent-text bg-accent px-5 py-4 text-center font-display text-lg font-extrabold text-on-accent lg:order-2">{map.center}</div>
      <div className="order-3 flex flex-col gap-3">{right.map((b, i) => <Branch key={i} b={b} i={i + half} side="right" />)}</div>
    </div>
  );
}

/** The mind map of one document: the saved one, or a button to make it the first time. */
export function MindMapPanel({ doc, canRemake }: { doc: KnowledgeDoc; canRemake?: boolean }) {
  const { data, loading, making, error, make } = useDigest(doc);
  const [full, setFull] = useState(false);
  if (!doc.published_at) return <p className="text-sm text-text-muted">The mind map is made once the document is published.</p>;
  if (loading) return <Skeleton className="h-40" />;
  const map = data?.digest?.mindmap;
  return (
    <div>
      {error && <div className="mb-2"><Banner tone="danger">{error}</Banner></div>}
      {!map ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 basis-56 text-sm text-text-muted">No mind map yet. It is made once from the document, then opens straight away for everyone.</p>
          <Button variant="primary" loading={making} onClick={() => make()}><Sparkles aria-hidden className="size-4" />{making ? 'Reading the document…' : doc.section === 'lesson' ? 'Make the mind map and slides' : 'Make the mind map'}</Button>
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span className="basis-full sm:flex-1 sm:basis-auto">Rev {data?.revision} · {mindSize(map)} points · made from {data?.source}{data?.made_at && ` on ${formatDate(data.made_at.slice(0, 10))}`}. Check the document for anything critical.</span>
            <Button size="sm" variant="ghost" onClick={() => setFull(true)}><Maximize2 aria-hidden className="size-3.5" />Full screen</Button>
            <Button size="sm" variant="ghost" onClick={() => printMap(doc, map)}><Printer aria-hidden className="size-3.5" />Print</Button>
            {canRemake && <Button size="sm" variant="ghost" loading={making} onClick={() => make(true)}><RefreshCw aria-hidden className="size-3.5" />Make again</Button>}
          </div>
          <MindMapView map={map} />
        </>
      )}
      {full && map && (
        <div role="dialog" aria-modal="true" aria-label={`Mind map: ${doc.title}`} className="fixed inset-0 z-[60] overflow-y-auto bg-bg p-4 md:p-8 md:[&_li]:text-lg md:[&_p]:text-lg md:[&_span]:text-base">
          {/* larger type full screen, to read at the unit */}
          <div className="mb-4 flex items-center gap-3"><h2 className="min-w-0 flex-1 font-display text-lg font-bold">{doc.doc_no && <span className="mr-2 font-mono text-sm">{doc.doc_no}</span>}{doc.title}</h2><Button size="sm" variant="ghost" aria-label="Close" onClick={() => setFull(false)}><X aria-hidden className="size-4" /></Button></div>
          <MindMapView map={map} />
        </div>
      )}
    </div>
  );
}

export function MindMapDialog({ doc, onClose, canRemake }: { doc: KnowledgeDoc; onClose: () => void; canRemake?: boolean }) {
  return <Dialog title={`Mind map · ${doc.doc_no ?? doc.title}`} onClose={onClose} wide><p className="mb-3 text-sm font-semibold">{doc.title}</p><MindMapPanel doc={doc} canRemake={canRemake} /></Dialog>;
}

/** A printable page of the map as an outline: one sheet to keep in the unit. */
function printMap(doc: KnowledgeDoc, map: MindMap) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const branches = map.branches.map((b) => `<section><h3>${esc(b.label)}</h3><ul>${b.children.map((c) => `<li><b>${esc(c.label)}</b>${c.children.length ? `<br><span>${c.children.map((g) => esc(g.label)).join(' · ')}</span>` : ''}</li>`).join('')}</ul></section>`).join('');
  w.document.write(`<!doctype html><title>${esc(doc.title)}</title><style>body{font-family:sans-serif;margin:16px;color:#111}h1{font-size:18px;margin:0}h2{font-size:22px;text-align:center;border:2px solid #111;border-radius:12px;padding:8px;margin:12px auto;max-width:420px}
    main{columns:2;column-gap:18px}section{break-inside:avoid;border-left:4px solid #333;padding:4px 10px;margin:0 0 12px}h3{margin:0 0 4px;font-size:14px}ul{margin:0;padding-left:16px;font-size:12px}span{color:#444}p{font-size:10px;color:#555}</style>
    <h1>${esc(doc.doc_no ?? '')} ${esc(doc.title)} · Rev ${doc.revision}</h1><h2>${esc(map.center)}</h2><main>${branches}</main><p>Summary made from the document. The document is the reference. Printed ${new Date().toISOString().slice(0, 10)}.</p><script>window.onload=()=>window.print()</script>`);
  w.document.close();
}

// ---- lesson slides -----------------------------------------------------------------------------------------------

interface DeckSlide extends Slide { docId: string; docLabel: string; picture: string | null }

function SlideView({ s }: { s: DeckSlide }) {
  const warn = s.kind === 'warning';
  const [key, ...rest] = warn ? s.points : [null, ...s.points];
  return (
    <div className={cx('grid h-full items-center gap-6 md:gap-10', s.picture && 'md:grid-cols-[1.3fr_1fr]')}>
      <div className="flex min-w-0 flex-col justify-center">
        <p className={cx('label-caps flex items-center gap-2', warn ? 'text-warning' : 'text-text-muted')}>{warn && <AlertTriangle aria-hidden className="size-4" />}{s.docLabel}</p>
        <h2 className={cx('mt-2 font-display text-3xl font-extrabold md:text-5xl', warn && 'text-warning')}>{s.title}</h2>
        {key && <p className="mt-6 rounded-lg border-2 border-warning bg-warning-subtle p-4 text-xl font-bold md:text-3xl">{key}</p>}
        <ul className="mt-6 flex flex-col gap-3">
          {rest.filter((p): p is string => !!p).map((p, i) => <li key={i} className="flex gap-3 text-lg md:text-2xl"><span aria-hidden className={cx('mt-3 size-2.5 shrink-0 rounded-full', warn ? 'bg-warning' : 'bg-accent')} />{p}</li>)}
        </ul>
        {s.note && <p className="mt-6 border-l-2 border-border-strong pl-3 text-sm text-text-muted md:text-base">{s.note}</p>}
      </div>
      {s.picture && <img src={s.picture} alt="" className="max-h-[60vh] w-full rounded-lg border border-border bg-surface-2 object-contain" />}
    </div>
  );
}

/** A lesson's two slides, each with one of its support pictures (the oldest first), from the saved deck or the record. */
async function lessonDeck(d: KnowledgeDoc, makeIfMissing: boolean): Promise<{ slides: Slide[]; pictures: (string | null)[]; made: boolean; error?: string }> {
  let saved: Slide[] | null = null, error: string | undefined;
  if (d.published_at) {
    try {
      const got = await api<DigestOut>(`/knowledge/${d.id}/digest`);
      saved = got.digest?.slides ?? null;
      if (!saved?.length && makeIfMissing) saved = (await api<DigestOut>(`/knowledge/${d.id}/digest`, { method: 'POST', json: {} })).digest?.slides ?? null;
    } catch (e) { error = (e as ApiError).message; }
  }
  const files = await api<{ files: { id: string; content_type: string; uploaded_at: string }[] }>(`/attachments/knowledge/${d.id}`).then((r) => r.files).catch(() => []);
  const pics = files.filter((f) => /^image\/(jpeg|png|gif|webp)$/.test(f.content_type)).sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at)).map((f) => `/api/attachments/knowledge/${d.id}/${f.id}?inline=1`);
  const slides = saved?.length ? lessonSlides(saved) : fallbackSlides(d);
  return { slides, pictures: slides.map((_, i) => pics[i] ?? null), made: !!saved?.length, error };
}

/** PowerPoint and PDF buttons for one lesson's slides. */
export function LessonDownloads({ doc, compact }: { doc: KnowledgeDoc; compact?: boolean }) {
  const [busy, setBusy] = useState<'pptx' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (as: 'pptx' | 'pdf') => {
    setBusy(as); setError(null);
    try { const d = await lessonDeck(doc, true); await downloadLesson(doc, d.slides, d.pictures, as); if (d.error) setError(`${d.error} The slides were made from the summary.`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Button size="sm" variant={compact ? 'ghost' : 'secondary'} loading={busy === 'pptx'} onClick={() => go('pptx')}><Presentation aria-hidden className="size-3.5" />PowerPoint</Button>
      <Button size="sm" variant={compact ? 'ghost' : 'secondary'} loading={busy === 'pdf'} onClick={() => go('pdf')}><FileDown aria-hidden className="size-3.5" />PDF</Button>
      {error && <span className="text-xs text-warning">{error}</span>}
    </span>
  );
}

/**
 * Toolbox talk for lessons: two slides per lesson, with its pictures. One lesson makes its slides the first time;
 * several use the saved slides and the summary for any not made yet. Arrow keys move, Escape leaves.
 */
export function Present({ docs, onClose }: { docs: KnowledgeDoc[]; onClose: () => void }) {
  const [slides, setSlides] = useState<DeckSlide[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [i, setI] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      const out: DeckSlide[] = [];
      let missing = 0;
      for (const d of docs) {
        const r = await lessonDeck(d, docs.length === 1);
        if (!r.made) missing++;
        if (r.error && docs.length === 1) setNote(`${r.error} Showing the summary instead.`);
        out.push(...r.slides.map((s, k) => ({ ...s, docId: d.id, docLabel: [d.doc_no, d.title].filter(Boolean).join(' · '), picture: r.pictures[k] })));
      }
      if (docs.length > 1 && missing) setNote(`${missing} of ${docs.length} lessons have no slides yet and show their summary. Present one alone to make its slides.`);
      if (live) setSlides(out);
    })();
    return () => { live = false; };
  }, [docs]);
  const n = slides?.length ?? 0;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); setI((x) => Math.min(n - 1, x + 1)); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', key);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    return () => { window.removeEventListener('keydown', key); if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined); };
  }, [n, onClose]);
  const s = slides?.[i];
  return (
    <div role="dialog" aria-modal="true" aria-label="Toolbox talk" className="fixed inset-0 z-[60] flex flex-col bg-bg p-6 md:p-12">
      <div className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
        <span className="label-caps">Toolbox talk{slides && ` · ${i + 1} of ${n}`}</span>
        <span className="ml-auto flex items-center gap-1">
          {docs.length === 1 && slides && <LessonDownloads doc={docs[0]} compact />}
          <Button size="sm" variant="ghost" onClick={onClose}><X aria-hidden className="size-4" />Close</Button>
        </span>
      </div>
      {note && <div className="mx-auto mt-2 w-full max-w-6xl"><Banner tone="info">{note}</Banner></div>}
      <div aria-live="polite" className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center overflow-y-auto py-4">
        {!slides ? (
          <div className="flex flex-col items-center gap-3 text-center text-text-muted">
            <Network aria-hidden className="size-10 animate-pulse" />
            <p className="text-lg">Preparing the slides from the document…</p>
            <p className="text-sm">The first time takes up to a minute. After that they open straight away.</p>
          </div>
        ) : s && <SlideView s={s} />}
      </div>
      {slides && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex flex-wrap justify-center gap-1" aria-hidden>{slides.map((_, k) => <span key={k} className={cx('h-1.5 w-5 rounded-pill', k === i ? 'bg-accent' : 'bg-surface-3')} />)}</div>
          <div className="flex items-center gap-3">
            <Button onClick={() => setI(i - 1)} disabled={i === 0}><ChevronLeft aria-hidden className="size-4" />Previous</Button>
            <Button variant="primary" onClick={() => (i >= n - 1 ? onClose() : setI(i + 1))}>{i >= n - 1 ? 'Finish' : <>Next<ChevronRight aria-hidden className="size-4" /></>}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
