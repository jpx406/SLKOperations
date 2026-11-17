import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, HelpCircle, ListOrdered, Maximize2, Network, Printer, RefreshCw, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { fallbackSlides, mindSize, type Digest, type MindMap, type MindNode, type Slide } from '../../../shared/docDigest';
import type { KnowledgeDoc } from '../../../shared/knowledge';
import { ApiError, api, formatDate } from '../../api';
import { Banner, Button, Skeleton, cx } from '../../components/ui';
import { Dialog } from './common';

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
          <Button variant="primary" loading={making} onClick={() => make()}><Sparkles aria-hidden className="size-4" />{making ? 'Reading the document…' : 'Make the mind map and slides'}</Button>
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

// ---- slides ------------------------------------------------------------------------------------------------------

interface DeckSlide extends Slide { doc: string }

const KIND_ICON = { steps: ListOrdered, warning: AlertTriangle, question: HelpCircle } as const;

function SlideView({ s }: { s: DeckSlide }) {
  const Icon = s.kind in KIND_ICON ? KIND_ICON[s.kind as keyof typeof KIND_ICON] : null;
  if (s.kind === 'title') {
    return (
      <div className="flex flex-col justify-center">
        <p className="label-caps text-warning">{s.doc}</p>
        <h2 className="mt-3 font-display text-4xl font-extrabold md:text-6xl">{s.title}</h2>
        {s.points.map((p, i) => <p key={i} className="mt-4 text-lg text-text-muted md:text-2xl">{p}</p>)}
      </div>
    );
  }
  return (
    <div className={cx('flex flex-col justify-center', s.kind === 'warning' && 'rounded-xl border-2 border-warning bg-warning-subtle p-6 md:p-10')}>
      <p className={cx('label-caps flex items-center gap-2', s.kind === 'warning' ? 'text-warning' : 'text-text-muted')}>{Icon && <Icon aria-hidden className="size-4" />}{s.doc}</p>
      <h2 className={cx('mt-2 font-display text-3xl font-extrabold md:text-5xl', s.kind === 'warning' && 'text-warning')}>{s.title}</h2>
      {s.kind === 'steps' ? (
        <ol className="mt-6 flex flex-col gap-3">
          {s.points.map((p, i) => <li key={i} className="flex gap-4 text-lg md:text-2xl"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent font-display font-bold text-on-accent md:size-11">{i + 1}</span><span className="pt-1">{p}</span></li>)}
        </ol>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {s.points.map((p, i) => <li key={i} className={cx('flex gap-3 text-lg md:text-2xl', s.kind === 'warning' && 'font-semibold')}><span aria-hidden className={cx('mt-3 size-2.5 shrink-0 rounded-full', s.kind === 'warning' ? 'bg-warning' : s.kind === 'question' ? 'bg-accent' : 'bg-text-muted')} />{p}</li>)}
        </ul>
      )}
      {s.note && <p className="mt-6 border-l-2 border-border-strong pl-3 text-sm text-text-muted md:text-base">{s.note}</p>}
    </div>
  );
}

/**
 * Toolbox talk: the detailed slides made from each document (made the first time if a single document is
 * presented); documents without saved slides show their summary and key action. Arrow keys move, Escape leaves.
 */
export function Present({ docs, onClose }: { docs: KnowledgeDoc[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [slides, setSlides] = useState<DeckSlide[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [i, setI] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      const out: DeckSlide[] = [];
      let missing = 0;
      for (const d of docs) {
        const label = [d.doc_no, d.title].filter(Boolean).join(' · ');
        let dg: Digest | null = null;
        if (d.published_at) {
          try {
            const got = await api<DigestOut>(`/knowledge/${d.id}/digest`);
            dg = got.digest;
            // one document: make its slides now, the first time
            if (!dg && docs.length === 1) {
              const made = await api<DigestOut>(`/knowledge/${d.id}/digest`, { method: 'POST', json: {} });
              dg = made.digest;
              qc.setQueryData(['knowledge-digest', d.id, d.revision], made);
            }
          } catch (e) { if (docs.length === 1) setNote(`${(e as ApiError).message} Showing the summary instead.`); }
        }
        if (!dg) missing++;
        out.push(...(dg?.slides ?? fallbackSlides(d)).map((s) => ({ ...s, doc: label })));
      }
      if (docs.length > 1 && missing) setNote(`${missing} of ${docs.length} documents have no slides yet and show their summary. Open one and present it alone to make its slides.`);
      if (live) setSlides(out);
    })();
    return () => { live = false; };
  }, [docs]); // eslint-disable-line react-hooks/exhaustive-deps
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
      <div className="flex items-center gap-3 text-sm text-text-muted">
        <span className="label-caps">Toolbox talk{slides && ` · ${i + 1} of ${n}`}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}><X aria-hidden className="size-4" />Close</Button>
      </div>
      {note && <div className="mx-auto mt-2 w-full max-w-5xl"><Banner tone="info">{note}</Banner></div>}
      <div aria-live="polite" className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center overflow-y-auto py-4">
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
