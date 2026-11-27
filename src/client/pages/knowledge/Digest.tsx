import { useQuery, useQueryClient } from '@tanstack/react-query';
import { escHtml } from '../../../shared/html';
import { Maximize2, Printer, RefreshCw, Sparkles, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { mindSize, type Digest, type MindMap, type MindNode } from '../../../shared/docDigest';
import type { KnowledgeDoc } from '../../../shared/knowledge';
import { ApiError, api, formatDate } from '../../api';
import { Banner, Button, Skeleton, cx } from '../../components/ui';
import { Dialog } from './common';
import { useDialogFocus } from '../../components/Dialog';

// Mind map of a published document (6z.16; lesson slides removed in 6z.20). Made once per revision by AI from the document and saved,
// so checking the mind map during the job never reads the document again.

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

// Option C, chosen by the owner (6z.18): the subject on top and one numbered card per topic, in the document's order.
// Values are grey chips, limits amber, stop-work conditions red, and the stop-work topic is a red-tinted card.

const CHART = ['--color-chart-1', '--color-chart-2', '--color-chart-3', '--color-chart-4', '--color-chart-5', '--color-chart-6'];
const CHIP: Record<string, string> = {
  value: 'bg-surface-3 font-mono text-text',
  limit: 'bg-warning-subtle font-semibold text-warning',
  stop: 'bg-danger-subtle font-semibold text-danger',
  '': 'bg-surface-3 text-text',
};
const isStop = (b: MindNode) => b.kind === 'stop' || /^stop\b|stop[- ]work/i.test(b.label);

function Chip({ n }: { n: MindNode }) {
  return <span className={cx('inline-block rounded-xs px-1.5 py-px text-xs whitespace-nowrap', CHIP[n.kind ?? ''])}>{n.label}</span>;
}

/** A key to the chip colours, shown above the map. */
export function MindLegend() {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
      <span className="inline-flex items-center gap-1"><Chip n={{ label: '2.72 in', kind: 'value', children: [] }} />value</span>
      <span className="inline-flex items-center gap-1"><Chip n={{ label: 'max 150 ft/min', kind: 'limit', children: [] }} />limit</span>
      <span className="inline-flex items-center gap-1"><Chip n={{ label: 'stop', kind: 'stop', children: [] }} />stop work</span>
    </span>
  );
}

function Card({ b, i }: { b: MindNode; i: number }) {
  const stop = isStop(b);
  const color = `var(${stop ? '--color-danger' : CHART[i % CHART.length]})`;
  return (
    <li className={cx('relative rounded-lg border border-border p-3.5 sm:before:absolute sm:before:-top-4 sm:before:left-1/2 sm:before:h-4 sm:before:w-0.5 sm:before:bg-border-strong',
      stop ? 'bg-danger-subtle' : 'bg-surface')} style={{ borderTop: `4px solid ${color}` }}>
      <header className="mb-2 flex items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-full text-xs font-extrabold text-bg" style={{ background: color }}>{i + 1}</span>
        <h3 className={cx('font-display text-sm font-bold', stop && 'text-danger')}>{b.label}</h3>
      </header>
      <ul className="flex flex-col gap-1.5">
        {b.children.map((c, j) => (
          <li key={j} className="relative pl-3 text-sm">
            <span aria-hidden className="absolute left-0 top-[0.45rem] size-1.5 rounded-full" style={{ background: color }} />
            <span className={cx(c.kind === 'stop' && 'font-semibold text-danger', c.kind === 'limit' && 'font-semibold')}>{c.label}</span>
            {c.children.length > 0 && <span className="mt-0.5 flex flex-wrap gap-1">{c.children.map((g, k) => <Chip key={k} n={g} />)}</span>}
          </li>
        ))}
      </ul>
    </li>
  );
}

/** The map: the subject on top, a rail, and the numbered topic cards below (one column on a phone). */
export function MindMapView({ map }: { map: MindMap }) {
  return (
    <div>
      <div className="mx-auto w-max max-w-full rounded-lg bg-text px-5 py-2.5 text-center font-display text-lg font-extrabold text-bg">{map.center}</div>
      <div aria-hidden className="mx-auto hidden h-4 w-0.5 bg-border-strong sm:block" />
      <div aria-hidden className="mx-[8%] hidden h-0.5 bg-border-strong sm:block" />
      <ol className="mt-3 grid grid-cols-1 gap-3 sm:mt-4 sm:grid-cols-[repeat(auto-fit,minmax(13.5rem,1fr))] sm:gap-x-3 sm:gap-y-6">
        {map.branches.map((b, i) => <Card key={i} b={b} i={i} />)}
      </ol>
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
          <Button variant="primary" loading={making} onClick={() => make()}><Sparkles aria-hidden className="size-4" />{making ? 'Reading the document…' : 'Make the mind map'}</Button>
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span className="basis-full sm:flex-1 sm:basis-auto">Rev {data?.revision} · {mindSize(map)} points · made from {data?.source}{data?.made_at && ` on ${formatDate(data.made_at.slice(0, 10))}`}. Check the document for anything critical.</span>
            <Button size="sm" variant="ghost" onClick={() => setFull(true)}><Maximize2 aria-hidden className="size-3.5" />Full screen</Button>
            <Button size="sm" variant="ghost" onClick={() => printMap(doc, map)}><Printer aria-hidden className="size-3.5" />Print</Button>
            {canRemake && <Button size="sm" variant="ghost" loading={making} onClick={() => make(true)}><RefreshCw aria-hidden className="size-3.5" />Make again</Button>}
          </div>
          <div className="mb-3"><MindLegend /></div>
          <MindMapView map={map} />
        </>
      )}
      {full && map && <FullScreenMap doc={doc} map={map} onClose={() => setFull(false)} />}
    </div>
  );
}

/** The mind map full screen: focus moves in, Tab stays inside, Escape closes it. */
function FullScreenMap({ doc, map, onClose }: { doc: KnowledgeDoc; map: MindMap; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel, onClose);
  return (
    <div ref={panel} data-dialog-panel role="dialog" aria-modal="true" aria-label={`Mind map: ${doc.title}`} className="fixed inset-0 z-[60] overflow-y-auto bg-bg p-4 md:p-8 md:[&_li]:text-base md:[&_h3]:text-base">
      {/* larger type full screen, to read at the unit */}
      <div className="mb-4 flex flex-wrap items-center gap-3"><h2 className="min-w-0 flex-1 font-display text-lg font-bold">{doc.doc_no && <span className="mr-2 font-mono text-sm">{doc.doc_no}</span>}{doc.title}{doc.published_at && <span className="ml-2 text-sm font-normal text-text-muted">Rev {doc.revision}</span>}</h2><MindLegend /><Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}><X aria-hidden className="size-4" /></Button></div>
      <MindMapView map={map} />
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
  const esc = escHtml;
  // the same numbered cards as the screen, in print colours
  const COLORS = ['#1565c0', '#2e7d32', '#b26b00', '#6a1b9a', '#00838f', '#5b6470'];
  const chip = (g: MindNode) => `<i class="c ${g.kind || 'plain'}">${esc(g.label)}</i>`;
  const cards = map.branches.map((b, i) => {
    const stop = isStop(b), color = stop ? '#c62828' : COLORS[i % COLORS.length];
    return `<section class="${stop ? 'stop' : ''}" style="border-top-color:${color}"><h3><b style="background:${color}">${i + 1}</b>${esc(b.label)}</h3><ul>${b.children.map((c) =>
      `<li style="--d:${color}"><span class="${c.kind || ''}">${esc(c.label)}</span>${c.children.length ? `<div>${c.children.map(chip).join(' ')}</div>` : ''}</li>`).join('')}</ul></section>`;
  }).join('');
  w.document.write(`<!doctype html><title>${esc(doc.title)}</title><style>
    *{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:14px;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    h1{font-size:15px;margin:0}h1 small{color:#555;font-weight:400}.root{width:max-content;margin:10px auto 14px;background:#0b121a;color:#fff;border-radius:8px;padding:8px 18px;font-size:18px;font-weight:800}
    main{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}section{break-inside:avoid;border:1px solid #d5dae0;border-top:4px solid;border-radius:8px;padding:8px 10px}
    section.stop{background:#fdecec}h3{display:flex;gap:6px;align-items:center;margin:0 0 6px;font-size:13px}h3 b{color:#fff;border-radius:50%;width:18px;height:18px;display:grid;place-items:center;font-size:10px;flex:none}
    ul{list-style:none;margin:0;padding:0;font-size:11px}li{margin:0 0 5px;padding-left:9px;position:relative}li:before{content:"";position:absolute;left:0;top:5px;width:4px;height:4px;border-radius:50%;background:var(--d)}
    li span.stop{color:#c62828;font-weight:700}li span.limit{font-weight:700}li div{margin-top:2px}
    .c{display:inline-block;font-style:normal;border-radius:3px;padding:0 4px;font-size:10px;margin:1px 0}.c.plain,.c.value{background:#eef1f4;font-family:Consolas,monospace}.c.limit{background:#fff4d6;color:#8a5200;font-weight:700}.c.stop{background:#fdecec;color:#c62828;font-weight:700}
    p{font-size:9px;color:#555}</style>
    <h1>${esc(doc.doc_no ?? '')} ${esc(doc.title)} <small>· Rev ${doc.revision} · grey value · amber limit · red stop work</small></h1><div class="root">${esc(map.center)}</div><main>${cards}</main>
    <p>Mind map made from the document. The document is the reference. Printed ${new Date().toISOString().slice(0, 10)}.</p><script>window.onload=()=>window.print()</script>`);
  w.document.close();
}
