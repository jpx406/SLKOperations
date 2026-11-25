// The one-page layout of a lesson learnt or best practice (6z.57), in points on the template's page (540 × 780, the
// size of the company PowerPoint templates). The layout is a list of blocks (text boxes, tables, rectangles,
// pictures) used three ways: drawn as the live preview on the page, drawn into the PDF, and written as PowerPoint
// shapes on the company template. The header band and the footer tables belong to the template ("master"): the
// PowerPoint keeps the template's own, the preview and the PDF draw the same ones here.

import { COMPANY_DB, headings, printDate, type LessonCompany, type LessonContent, type LessonKind, type LessonPicture, type Rect } from './lessons';

export const PAGE = { w: 540, h: 780 } as const;
const L = 18, R = 522, W = R - L, TOP = 84, BOTTOM = 676;

export interface Run { t: string; b?: boolean; c?: string; u?: boolean }
export interface Para { runs: Run[]; size: number; bullet?: string; gap?: number; align?: 'l' | 'c' | 'r' }
export interface Cell { runs: Run[]; align?: 'l' | 'c' | 'r' }
export interface TRow { cells: Cell[]; h: number; size: number; fill?: string }
export type Block =
  | { k: 'text'; x: number; y: number; w: number; h: number; paras: Para[]; pad: number; valign?: 'top' | 'middle' }
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw?: number }
  | { k: 'image'; x: number; y: number; w: number; h: number; pic: string }
  | { k: 'table'; x: number; y: number; w: number; h: number; cols: number[]; rows: TRow[]; grid: string };
export type Op =
  | { o: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw?: number }
  | { o: 'img'; x: number; y: number; w: number; h: number; pic: string }
  | { o: 'text'; x: number; y: number; size: number; b: boolean; c: string; t: string }
  | { o: 'line'; x1: number; y1: number; x2: number; y2: number; c: string; sw: number };

const INK = '111827', GREY = '4B5563', RED = 'C00000', WHITE = 'FFFFFF';

// Helvetica and Helvetica-Bold widths (per 1000) for characters 32–126, from the standard font metrics; Arial, which
// the preview falls back to, has the same widths
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const WIDE: Record<string, [number, number]> = { '•': [350, 350], '–': [556, 556], '—': [1000, 1000], '‘': [222, 278], '’': [222, 278], '“': [333, 500], '”': [333, 500], '°': [400, 400], '…': [1000, 1000], '·': [278, 278] };
/** Width in points of text in Helvetica (bold or not). */
export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    w += c >= 32 && c <= 126 ? (bold ? HELVB : HELV)[c - 32] : WIDE[ch]?.[bold ? 1 : 0] ?? 556;
  }
  return (w * size) / 1000;
}
const LEAD = 1.22;

/** Hex colour mixed towards white: f = 0 keeps it, 1 is white. */
export function tint(hex: string, f: number): string {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * f).toString(16).padStart(2, '0');
  return (ch(16) + ch(8) + ch(0)).toUpperCase();
}

// ---- text measuring ---------------------------------------------------------------------------------------------------

interface Seg { x: number; t: string; b: boolean; c: string; u: boolean }
interface LaidLine { segs: Seg[]; width: number }

/** Lines of a paragraph no wider than `width`, keeping the runs' styles and the author's line breaks. */
function lineUp(runs: Run[], size: number, width: number): LaidLine[] {
  type Tok = { t: string; b: boolean; c: string; u: boolean; br?: boolean };
  const toks: Tok[] = [];
  for (const r of runs) {
    const parts = r.t.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) toks.push({ t: '', b: false, c: INK, u: false, br: true });
      for (const w of p.split(/\s+/).filter(Boolean)) toks.push({ t: w, b: !!r.b, c: r.c ?? INK, u: !!r.u });
    });
  }
  const sp = textWidth(' ', size);
  const lines: { toks: Tok[]; w: number }[] = [{ toks: [], w: 0 }];
  const cur = () => lines[lines.length - 1];
  for (const tk of toks) {
    if (tk.br) { lines.push({ toks: [], w: 0 }); continue; }
    let tw = textWidth(tk.t, size, tk.b);
    // a word wider than the line is cut
    while (tw > width && tk.t.length > 1) {
      let n = tk.t.length - 1;
      while (n > 1 && textWidth(tk.t.slice(0, n), size, tk.b) > width) n--;
      if (cur().toks.length) lines.push({ toks: [], w: 0 });
      cur().toks.push({ ...tk, t: tk.t.slice(0, n) }); cur().w = textWidth(tk.t.slice(0, n), size, tk.b);
      lines.push({ toks: [], w: 0 });
      tk.t = tk.t.slice(n); tw = textWidth(tk.t, size, tk.b);
    }
    const add = cur().toks.length ? sp + tw : tw;
    if (cur().toks.length && cur().w + add > width) { lines.push({ toks: [tk], w: tw }); continue; }
    cur().toks.push(tk); cur().w += add;
  }
  return lines.map((l) => {
    const segs: Seg[] = [];
    let x = 0;
    for (const tk of l.toks) {
      const last = segs[segs.length - 1];
      if (last && last.b === tk.b && last.c === tk.c && last.u === tk.u) last.t += ` ${tk.t}`;
      else segs.push({ x: x + (segs.length ? sp : 0), t: tk.t, b: tk.b, c: tk.c, u: tk.u });
      x = (segs.length ? segs[segs.length - 1].x + textWidth(segs[segs.length - 1].t, size, tk.b) : 0);
    }
    // positions again now that runs are joined
    let px = 0;
    segs.forEach((s, i) => { s.x = px + (i ? sp : 0); px = s.x + textWidth(s.t, size, s.b); });
    return { segs, width: px };
  });
}

const paraIndent = (p: Para) => (p.bullet ? p.size * (p.bullet.length > 1 ? 1.6 : 1.1) : 0);
function paraHeight(p: Para, width: number): number {
  return (p.gap ?? 0) + lineUp(p.runs, p.size, width - paraIndent(p)).length * p.size * LEAD;
}
function textHeight(paras: Para[], w: number, pad: number) {
  return paras.reduce((h, p) => h + paraHeight(p, w - pad * 2), 0) + pad * 2;
}

/** Draw operations for a text box. */
function textOps(b: Extract<Block, { k: 'text' }>): Op[] {
  const ops: Op[] = [];
  const inner = b.w - b.pad * 2;
  let y = b.y + b.pad;
  if (b.valign === 'middle') y = b.y + (b.h - textHeight(b.paras, b.w, b.pad)) / 2 + b.pad;
  for (const p of b.paras) {
    y += p.gap ?? 0;
    const ind = paraIndent(p);
    const lines = lineUp(p.runs, p.size, inner - ind);
    const lh = p.size * LEAD;
    lines.forEach((ln, i) => {
      const base = y + i * lh + p.size * 0.92;
      const off = p.align === 'c' ? (inner - ind - ln.width) / 2 : p.align === 'r' ? inner - ind - ln.width : 0;
      if (i === 0 && p.bullet) ops.push({ o: 'text', x: b.x + b.pad, y: base, size: p.size, b: p.bullet.length > 1, c: p.runs[0]?.c && p.bullet.length > 1 ? p.runs[0].c : INK, t: p.bullet });
      for (const s of ln.segs) {
        const x = b.x + b.pad + ind + off + s.x;
        ops.push({ o: 'text', x, y: base, size: p.size, b: s.b, c: s.c, t: s.t });
        if (s.u) ops.push({ o: 'line', x1: x, y1: base + 1.2, x2: x + textWidth(s.t, p.size, s.b), y2: base + 1.2, c: s.c, sw: 0.6 });
      }
    });
    y += lines.length * lh;
  }
  return ops;
}

function tableOps(t: Extract<Block, { k: 'table' }>): Op[] {
  const ops: Op[] = [];
  let y = t.y;
  for (const row of t.rows) {
    let x = t.x;
    if (row.fill) ops.push({ o: 'rect', x: t.x, y, w: t.w, h: row.h, fill: row.fill });
    row.cells.forEach((cell, i) => {
      const w = t.cols[i];
      ops.push(...textOps({ k: 'text', x, y, w, h: row.h, pad: 3, valign: 'middle', paras: [{ runs: cell.runs, size: row.size, align: cell.align }] }));
      x += w;
    });
    y += row.h;
  }
  // the grid
  if (t.grid) {
    let gy = t.y;
    ops.push({ o: 'line', x1: t.x, y1: gy, x2: t.x + t.w, y2: gy, c: t.grid, sw: 0.5 });
    for (const row of t.rows) { gy += row.h; ops.push({ o: 'line', x1: t.x, y1: gy, x2: t.x + t.w, y2: gy, c: t.grid, sw: 0.5 }); }
    let gx = t.x;
    ops.push({ o: 'line', x1: gx, y1: t.y, x2: gx, y2: t.y + t.h, c: t.grid, sw: 0.5 });
    for (const w of t.cols) { gx += w; ops.push({ o: 'line', x1: gx, y1: t.y, x2: gx, y2: t.y + t.h, c: t.grid, sw: 0.5 }); }
  }
  return ops;
}

function tableRows(cols: number[], rows: { cells: Cell[]; size: number; fill?: string; min?: number }[]): TRow[] {
  return rows.map((r) => ({
    ...r, h: Math.max(r.min ?? 0, ...r.cells.map((c, i) => lineUp(c.runs, r.size, cols[i] - 6).length * r.size * LEAD + 6)),
  }));
}

/** Every block as draw operations, in painting order. */
export function toOps(blocks: Block[]): Op[] {
  return blocks.flatMap((b): Op[] => {
    if (b.k === 'rect') return [{ o: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, fill: b.fill, stroke: b.stroke, sw: b.sw }];
    if (b.k === 'image') return [{ o: 'img', x: b.x, y: b.y, w: b.w, h: b.h, pic: b.pic }];
    if (b.k === 'table') return tableOps(b);
    return textOps(b);
  });
}

// ---- the page ---------------------------------------------------------------------------------------------------------

/** The colours of the template's header band, its title, the title bar and the sign-off header rows. */
export interface TemplateStyle { band: string | null; title: string; bar: string; foot: string; body?: { top: number; bottom: number } }
export interface PageInput {
  style?: TemplateStyle | null;
  kind: LessonKind; company: LessonCompany; country: string; title: string; content: LessonContent; colour: string;
  docNo: string | null; revision: string | null;
  signoff: { date: string; changes: string; prepared: string; reviewed: string; approver: string; position: string };
}

/** "Equipment failure: the gap had closed" → the category in bold. */
const leadRuns = (s: string, colour = INK): Run[] => {
  const m = /^([^:]{2,60}):\s*(.*)$/.exec(s);
  return m ? [{ t: `${m[1]}:`, b: true, c: colour }, { t: ` ${m[2]}` }] : [{ t: s }];
};
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

interface Ctx { blocks: Block[]; s: number; colour: string; figNo: Map<string, number>; picScale: number }

function heading(ctx: Ctx, text: string, x: number, y: number, w: number): number {
  const hs = ctx.s + 2;
  ctx.blocks.push({ k: 'rect', x, y: y + 2.5, w: 3, h: hs - 1, fill: ctx.colour });
  ctx.blocks.push({ k: 'text', x: x + 6, y, w: w - 6, h: hs * LEAD, pad: 0, paras: [{ runs: [{ t: text, b: true, c: ctx.colour }], size: hs }] });
  return y + hs * LEAD + 3;
}
function text(ctx: Ctx, paras: Para[], x: number, y: number, w: number): number {
  if (!paras.length) return y;
  const h = textHeight(paras, w, 0);
  ctx.blocks.push({ k: 'text', x, y, w, h, pad: 0, paras });
  return y + h;
}
const captionSize = (s: number) => Math.max(6.5, s - 3);
function figure(ctx: Ctx, p: LessonPicture, x: number, y: number, w: number, maxH: number): number {
  let pw = w, ph = (w * p.h) / p.w;
  if (ph > maxH) { ph = Math.max(10, maxH); pw = (ph * p.w) / p.h; }
  ctx.blocks.push({ k: 'image', x: x + (w - pw) / 2, y, w: pw, h: ph, pic: p.id });
  y += ph + 2;
  const n = ctx.figNo.get(p.id) ?? ctx.figNo.size + 1;
  ctx.figNo.set(p.id, n);
  return text(ctx, [{ runs: [{ t: `Fig ${n}.${p.caption ? ` ${p.caption}` : ''}`, c: GREY }], size: captionSize(ctx.s), align: 'c' }], x, y, w) + 5;
}

// ---- the parts of the page ---------------------------------------------------------------------------------------------

/** A part of the page: the event strip, the key lesson, each section and each picture. */
export type PartId = 'meta' | 'key' | 'description' | 'facts' | 'damage' | 'analysis' | 'actions' | `pic:${string}`;
export const partLabel = (id: string, kind: LessonKind, pictures: LessonPicture[] = []) => {
  const hd = headings(kind);
  if (id.startsWith('pic:')) { const i = pictures.findIndex((p) => `pic:${p.id}` === id); return `Fig ${i + 1}${pictures[i]?.caption ? ` · ${pictures[i].caption}` : ''}`; }
  return ({ meta: 'Event facts', key: hd.key, description: hd.description, facts: hd.facts, damage: 'Potential damage', analysis: hd.analysis, actions: hd.actions } as Record<string, string>)[id] ?? id;
};

const metaOf = (c: LessonContent) => ([['Event date', printDate(c.event_date)], ['Field', c.field], ['Well', c.well], ['Job', c.job], ['Unit', c.unit], ['Category', c.category]] as const).filter(([, v]) => v);

/** The parts that have something to show, in reading order. */
export function partsOf(inp: PageInput): PartId[] {
  const c = inp.content;
  const out: PartId[] = [];
  const hide = new Set(c.hidden ?? []);
  if (metaOf(c).length) out.push('meta');
  if (c.key_lesson) out.push('key');
  if (lines(c.description).length) out.push('description');
  if (lines(c.facts).length) out.push('facts');
  if (inp.kind === 'lesson_learnt' && c.damage.length) out.push('damage');
  if (lines(c.immediate_cause).length || lines(c.root_cause).length) out.push('analysis');
  for (const p of c.pictures) out.push(`pic:${p.id}`);
  if (c.actions.length) out.push('actions');
  return out.filter((id) => !hide.has(id));
}
/** The pictures shown on the page. */
const shownPictures = (c: LessonContent) => c.pictures.filter((p) => !(c.hidden ?? []).includes(`pic:${p.id}`));

/** The height of a picture's box at a width: the picture at its own shape, and its caption under it. */
export function pictureHeight(p: LessonPicture, w: number, s = 9.5): number {
  const cap = textHeight([{ runs: [{ t: `Fig 0.${p.caption ? ` ${p.caption}` : ''}` }], size: captionSize(s), align: 'c' }], w, 0);
  return Math.round(((w * p.h) / p.w + 2 + cap) * 10) / 10;
}
const captionHeight = (p: LessonPicture, w: number, s = 9.5) => pictureHeight(p, w, s) - (w * p.h) / p.w;

/** Draws one text part at (x, y), w wide; returns where it ends. */
function drawPart(ctx: Ctx, inp: PageInput, id: PartId, x: number, y: number, w: number): number {
  const c = inp.content, s = ctx.s, hd = headings(inp.kind);
  if (id === 'meta') {
    const meta = metaOf(c);
    const cols = meta.map(() => w / meta.length);
    const rows = tableRows(cols, [
      { cells: meta.map(([k]) => ({ runs: [{ t: k.toUpperCase(), c: GREY }] })), size: 6, min: 10 },
      { cells: meta.map(([, v]) => ({ runs: [{ t: v, b: true }] })), size: Math.max(7, s - 1.5) },
    ]);
    rows[0].h = 10;
    const h = rows.reduce((a, r) => a + r.h, 0);
    ctx.blocks.push({ k: 'table', x, y, w, h, cols, rows, grid: 'D1D5DB' });
    return y + h;
  }
  if (id === 'key') {
    const paras: Para[] = [{ runs: [{ t: hd.key.toUpperCase(), b: true, c: inp.colour }], size: 6.5 }, { runs: [{ t: c.key_lesson, b: true }], size: s + 0.5, gap: 1 }];
    const h = textHeight(paras, w - 10, 5);
    ctx.blocks.push({ k: 'rect', x, y, w, h, fill: tint(inp.colour, 0.9) }, { k: 'rect', x, y, w: 3.5, h, fill: inp.colour });
    ctx.blocks.push({ k: 'text', x: x + 8, y, w: w - 10, h, pad: 5, paras });
    return y + h;
  }
  if (id === 'description') {
    const desc = lines(c.description);
    y = heading(ctx, hd.description, x, y, w);
    const paras: Para[] = c.description_as === 'paragraph'
      ? desc.map((t, i) => ({ runs: [{ t }], size: s, gap: i ? 3 : 0 }))
      : c.description_as === 'timeline'
        ? desc.map((t, i) => { const m = /^(.{1,24}?)\s+[-–—:|]\s+(.+)$/.exec(t); return { runs: m ? [{ t: m[1], b: true, c: inp.colour }, { t: ` ${m[2]}` }] : [{ t }], size: s, gap: i ? 2.5 : 0 }; })
        : desc.map((t, i) => ({ runs: [{ t: t.replace(/^[-•*▪]\s*/, '') }], size: s, bullet: '•', gap: i ? 2 : 0 }));
    return text(ctx, paras, x, y, w);
  }
  if (id === 'facts') {
    y = heading(ctx, hd.facts, x, y, w);
    return text(ctx, lines(c.facts).map((t, i) => ({ runs: leadRuns(t.replace(/^[-•*▪]\s*/, '')), size: s, bullet: c.facts_as === 'numbered' ? `${i + 1}.` : '•', gap: i ? 2 : 0 })), x, y, w);
  }
  if (id === 'damage') {
    y = heading(ctx, 'Potential damage', x, y, w);
    if (c.damage_as === 'list') return text(ctx, c.damage.map((t) => ({ runs: [{ t }], size: s, bullet: '•' })), x, y, w);
    const ts = Math.max(7, s - 1), th = ts + 7;
    let tx = x;
    for (const t of c.damage) {
      const tw = Math.min(w, textWidth(t, ts, true) + 14);
      if (tx > x && tx + tw > x + w) { tx = x; y += th + 4; }
      ctx.blocks.push({ k: 'rect', x: tx, y, w: tw, h: th, stroke: inp.colour, sw: 0.8 });
      ctx.blocks.push({ k: 'text', x: tx, y, w: tw, h: th, pad: 0, valign: 'middle', paras: [{ runs: [{ t, b: true, c: inp.colour }], size: ts, align: 'c' }] });
      tx += tw + 5;
    }
    return y + th + 2;
  }
  if (id === 'analysis') {
    const imm = lines(c.immediate_cause), root = lines(c.root_cause);
    y = heading(ctx, hd.analysis, x, y, w);
    const sub = (t: string): Para => ({ runs: [{ t, b: true, u: true }], size: s });
    const causes = (ls: string[]): Para[] => ls.map((t) => ({ runs: leadRuns(t), size: s, gap: 2 }));
    // a best practice with one part needs no sub-heading under its heading
    const subs = inp.kind === 'lesson_learnt' || (imm.length > 0 && root.length > 0);
    const immParas = imm.length ? [...(subs ? [sub(hd.immediate)] : []), ...causes(imm)] : [];
    const rootParas = root.length ? [...(subs ? [sub(hd.root)] : []), ...causes(root)] : [];
    if (c.analysis_as === 'side' && immParas.length && rootParas.length && w >= 300) {
      const cw = (w - 12) / 2;
      y = Math.max(text(ctx, immParas, x, y, cw), text(ctx, rootParas, x + cw + 12, y, cw));
    } else {
      y = text(ctx, [...immParas, ...rootParas.map((p, i) => (i === 0 ? { ...p, gap: 5 } : p))], x, y, w);
    }
    if (c.analysis_as === 'whys' && c.whys.length) {
      y = text(ctx, [{ ...sub('5 whys'), gap: 4 }, ...c.whys.map((t, i) => ({ runs: [{ t: `Why ${i + 1}`, b: true, c: inp.colour }, { t: `  ${t}` }], size: s, gap: 2 }))], x, y, w);
    }
    return y;
  }
  if (id === 'actions') {
    y = heading(ctx, hd.actions, x, y, w);
    if (c.actions_as === 'list' || w < 300) {
      return text(ctx, c.actions.map((a, i) => {
        const tail = [a.due ? `Deadline ${printDate(a.due)}.` : '', a.responsible ? `Responsible: ${a.responsible}` : ''].filter(Boolean).join(' ');
        return { runs: [{ t: a.action }, ...(tail ? [{ t: ` ${tail}`, b: true, c: RED }] : [])], size: s, bullet: `${i + 1}.`, gap: i ? 3 : 0 };
      }), x, y, w);
    }
    const resp = Math.min(100, w * 0.2), due = Math.min(72, w * 0.16);
    const cols = [20, w - 20 - resp - due, resp, due];
    const hs = Math.max(6.5, s - 2), rs = Math.max(7, s - 1);
    const rows = tableRows(cols, [
      { cells: [{ runs: [{ t: '#', b: true, c: WHITE }], align: 'c' }, { runs: [{ t: 'Action', b: true, c: WHITE }] }, { runs: [{ t: 'Responsible', b: true, c: WHITE }] }, { runs: [{ t: 'Target date', b: true, c: WHITE }] }], size: hs, fill: inp.colour },
      ...c.actions.map((a, i) => ({ cells: [{ runs: [{ t: String(i + 1) }], align: 'c' as const }, { runs: [{ t: a.action }] }, { runs: [{ t: a.responsible }] }, { runs: [{ t: printDate(a.due), b: true, c: RED }] }], size: rs })),
    ]);
    const h = rows.reduce((a, r) => a + r.h, 0);
    ctx.blocks.push({ k: 'table', x, y, w, h, cols, rows, grid: 'D1D5DB' });
    return y + h;
  }
  return y;
}

/** The body area the template leaves free between its header and its sign-off tables. */
export const bodyOf = (inp: PageInput) => ({ top: Math.max(TOP, inp.style?.body?.top ?? TOP), bottom: Math.min(BOTTOM, inp.style?.body?.bottom ?? BOTTOM), left: L, right: R });

// ---- in order down the page ---------------------------------------------------------------------------------------------

function flow(inp: PageInput, s: number, picScale: number): { blocks: Block[]; bottom: number; regions: Record<string, Rect> } {
  const c = inp.content;
  const ctx: Ctx = { blocks: [], s, colour: inp.colour, figNo: new Map(), picScale };
  const regions: Record<string, Rect> = {};
  const body = bodyOf(inp);
  let y = body.top;
  const part = (id: PartId, x: number, w: number, gap: number) => { const y0 = y; y = drawPart(ctx, inp, id, x, y, w); regions[id] = { x, y: y0, w, h: y - y0 }; y += gap; };
  const fig = (p: LessonPicture, x: number, yy: number, w: number, maxH: number) => { const end = figure(ctx, p, x, yy, w, maxH); regions[`pic:${p.id}`] = { x, y: yy, w, h: end - 5 - yy }; return end; };
  // pictures side by side at the same height, each at its own shape, the row centred
  const row = (list: LessonPicture[], yy: number, maxH: number) => {
    for (let i = 0; i < list.length; i += 3) {
      const r = list.slice(i, i + 3), gap = 8, sumA = r.reduce((a, p) => a + p.w / p.h, 0);
      const ih = Math.min(maxH * picScale, (W - gap * (r.length - 1)) / sumA);
      let x = L + (W - (ih * sumA + gap * (r.length - 1))) / 2;
      yy = Math.max(...r.map((p) => { const w = (ih * p.w) / p.h; const e = fig(p, x, yy, w, ih); x += w + gap; return e; }));
    }
    return yy;
  };
  const parts = partsOf(inp);
  const has = (id: PartId) => parts.includes(id);
  if (has('meta')) part('meta', L, W, 7);
  if (has('key')) part('key', L, W, 8);
  const pics = shownPictures(c);
  const right = c.pictures_as === 'right' && pics.length > 0;
  const tw = right ? W - 168 - 14 : W;
  const colTop = y;
  const after = (section: 'description' | 'analysis') => {
    if (right) return;
    const list = pics.filter((p) => p.section === section);
    if (!list.length) return;
    if (c.pictures_as === 'large') { y = fig(list[0], L, y + 2, W, 250 * picScale); if (list.length > 1) y = row(list.slice(1), y, 120); return; }
    y = row(list, y + 2, 140);
  };
  if (has('description')) part('description', L, tw, 6);
  after('description');
  if (has('facts')) part('facts', L, tw, 6);
  if (has('damage')) part('damage', L, tw, 6);
  if (has('analysis')) part('analysis', L, tw, 6);
  after('analysis');
  if (right) { let py = colTop; for (const p of pics) py = fig(p, L + tw + 14, py, 168, 175 * picScale); y = Math.max(y, py); }
  if (has('actions')) part('actions', L, W, 4);
  return { blocks: ctx.blocks, bottom: y, regions };
}

// ---- boxes placed by hand or by AI ------------------------------------------------------------------------------------

export interface LayoutIssue { id: string; also?: string; kind: 'overflow' | 'overlap' | 'outside' | 'unplaced'; text: string }
const SIZES = [10.5, 10, 9.5, 9, 8.5, 8, 7.5, 7];
const overlaps = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1.5;

/** Each part drawn in its box at the largest size that fits; boxes that overflow, overlap or leave the page are named. */
function boxed(inp: PageInput): { blocks: Block[]; issues: LayoutIssue[]; size: number; boxes: Record<string, Rect> } {
  const c = inp.content;
  const body = bodyOf(inp);
  const parts = partsOf(inp);
  const issues: LayoutIssue[] = [];
  const boxes: Record<string, Rect> = { ...c.layout.boxes };
  // a part added after the boxes were placed gets a small box at the bottom of the page, to be moved
  let spare = 0;
  for (const id of parts) {
    if (boxes[id]) continue;
    boxes[id] = { x: L + (spare % 3) * 170, y: body.bottom - 60, w: 164, h: 56 };
    spare++;
    issues.push({ id, kind: 'unplaced', text: `${partLabel(id, inp.kind, c.pictures)} is new: move it to its place` });
  }
  const blocks: Block[] = [];
  const figNo = new Map(c.pictures.map((p, i) => [p.id, i + 1]));
  let smallest = 10.5;
  for (const id of parts) {
    const r = boxes[id];
    let out: Ctx | null = null;
    if (id.startsWith('pic:')) {
      const p = c.pictures.find((x) => `pic:${x.id}` === id)!;
      const ctx: Ctx = { blocks: [], s: 9.5, colour: inp.colour, figNo, picScale: 1 };
      figure(ctx, p, r.x, r.y, r.w, r.h - captionHeight(p, r.w));
      out = ctx;
    } else {
      for (const s of SIZES) {
        const ctx: Ctx = { blocks: [], s, colour: inp.colour, figNo, picScale: 1 };
        const end = drawPart(ctx, inp, id, r.x, r.y, r.w);
        out = ctx;
        if (end <= r.y + r.h + 0.5) { smallest = Math.min(smallest, s); break; }
        if (s === SIZES[SIZES.length - 1]) { smallest = Math.min(smallest, s); issues.push({ id, kind: 'overflow', text: `${partLabel(id, inp.kind, c.pictures)}: the text does not fit its box. Make the box bigger or the text shorter` }); }
      }
    }
    blocks.push(...out!.blocks);
    if (r.x < body.left - 1 || r.x + r.w > body.right + 1 || r.y < body.top - 1 || r.y + r.h > body.bottom + 1) {
      issues.push({ id, kind: 'outside', text: `${partLabel(id, inp.kind, c.pictures)} runs outside the page area` });
    }
  }
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    if (overlaps(boxes[parts[i]], boxes[parts[j]])) issues.push({ id: parts[j], also: parts[i], kind: 'overlap', text: `${partLabel(parts[i], inp.kind, c.pictures)} and ${partLabel(parts[j], inp.kind, c.pictures)} overlap` });
  }
  return { blocks, issues, size: smallest, boxes };
}

export interface Laid { blocks: Block[]; fits: boolean; size: number; bottom: number; regions: Record<string, Rect>; issues: LayoutIssue[] }

/**
 * The body of the page. In order (auto): the largest text size that fits on the page, 10.5 pt down to 8, then smaller
 * pictures. With boxes (free): every part in its own box, shrinking its text to fit.
 */
export function layoutLesson(inp: PageInput): Laid {
  const body = bodyOf(inp);
  if (inp.content.layout.mode === 'free') {
    const b = boxed(inp);
    return { blocks: b.blocks, fits: b.issues.length === 0, size: b.size, bottom: Math.max(body.top, ...Object.values(b.boxes).map((r) => r.y + r.h)), regions: b.boxes, issues: b.issues };
  }
  let last = flow(inp, 8, 0.62);
  for (const scale of [1, 0.8, 0.62]) {
    for (const s of [10.5, 10, 9.5, 9, 8.5, 8]) {
      const r = flow(inp, s, scale);
      if (r.bottom <= body.bottom) return { ...r, fits: true, size: s, issues: [] };
      last = r;
    }
  }
  return { ...last, fits: false, size: 8, issues: [{ id: 'page', kind: 'overflow', text: 'The page runs past one page: shorten the text, use fewer pictures, or place the boxes yourself' }] };
}

/** One sentence for what stops the page, or null when it is fine. */
export const layoutProblem = (l: Laid) => (l.fits ? null : l.issues.map((i) => i.text).join('. '));

/** How tall each part needs to be at a few widths, for arranging the boxes (by AI or by hand). */
export function measureParts(inp: PageInput, widths = [504, 330, 248, 168], s = 9.5) {
  return partsOf(inp).map((id) => {
    if (id.startsWith('pic:')) {
      const p = inp.content.pictures.find((x) => `pic:${x.id}` === id)!;
      return { id, label: partLabel(id, inp.kind, inp.content.pictures), picture: true, aspect: Math.round((p.w / p.h) * 100) / 100 };
    }
    const heights = Object.fromEntries(widths.map((w) => {
      const ctx: Ctx = { blocks: [], s, colour: inp.colour, figNo: new Map(), picScale: 1 };
      return [w, Math.ceil(drawPart(ctx, inp, id as PartId, 0, 0, w))];
    }));
    return { id, label: partLabel(id, inp.kind, inp.content.pictures), picture: false, heights };
  });
}

/** Boxes snapped to a 3 pt grid and kept on the page. */
export function tidyBoxes(boxes: Record<string, Rect>, inp: PageInput): Record<string, Rect> {
  const body = bodyOf(inp);
  const snap = (v: number) => Math.round(v / 3) * 3;
  return Object.fromEntries(Object.entries(boxes).map(([id, r]) => {
    const w = Math.max(24, Math.min(body.right - body.left, snap(r.w))), h = Math.max(15, Math.min(body.bottom - body.top, snap(r.h)));
    // a picture box keeps the picture's own shape
    const p = id.startsWith('pic:') ? inp.content.pictures.find((q) => `pic:${q.id}` === id) : null;
    const ph = p ? pictureHeight(p, w) : h;
    const x = Math.min(body.right - w, Math.max(body.left, snap(r.x))), y = Math.min(body.bottom - ph, Math.max(body.top, snap(r.y)));
    return [id, { x, y, w, h: ph }];
  }));
}

// ---- the template's header and footer ------------------------------------------------------------------------------

const FOOT_COLS = [9, 55, 117, 259, 400, 531];
const APPROVAL_COLS = [9, 117, 259, 400, 531];

/**
 * The header and footer: `master` is what the template's slide master already shows (drawn here for the preview and
 * the PDF), `slide` is what is written on the slide itself (title, page, sign-off values), also in the PowerPoint.
 */
export function chrome(inp: PageInput, logo: { w: number; h: number } | null): { master: Block[]; slide: Block[] } {
  const hd = headings(inp.kind);
  const col = inp.colour;
  const st: TemplateStyle = inp.style ?? { band: null, title: col, bar: col, foot: col };
  const master: Block[] = [];
  if (st.band) master.push({ k: 'rect', x: 9, y: 10, w: 522, h: 43, fill: st.band });
  master.push({ k: 'rect', x: 9, y: 10, w: 522, h: 760, stroke: '1F2937', sw: 0.8 });
  const tsz = 22;
  const tW = textWidth(hd.title, tsz, true);
  master.push({ k: 'text', x: 16, y: 18, w: tW + 6, h: tsz * LEAD, pad: 0, paras: [{ runs: [{ t: hd.title, b: true, c: st.title }], size: tsz }] });
  master.push({ k: 'text', x: 16 + tW + 18, y: 27, w: 200, h: 14, pad: 0, paras: [{ runs: [{ t: `Slickline · ${inp.country}`, b: true, c: st.title }], size: 11 }] });
  if (logo) {
    const bw = 140, bh = 36;
    let w = bw, h = (bw * logo.h) / logo.w;
    if (h > bh) { h = bh; w = (bh * logo.w) / logo.h; }
    master.push({ k: 'image', x: 524 - w, y: 13 + (bh - h) / 2, w, h, pic: '__logo__' });
  } else {
    master.push({ k: 'text', x: 360, y: 20, w: 164, h: 24, pad: 0, paras: [{ runs: [{ t: inp.company.toUpperCase(), b: true, c: st.title }], size: 18, align: 'r' }] });
  }
  master.push({ k: 'rect', x: 9, y: 53, w: 522, h: 25, fill: st.bar });
  // footer tables
  const labels = ['Revision #', 'Effective Date', 'Changes', 'Prepared By (Name)', 'Reviewed By (Name)'];
  master.push({ k: 'rect', x: 9, y: 685, w: 522, h: 11, fill: st.foot });
  labels.forEach((t, i) => master.push(cellText(FOOT_COLS[i], 685, FOOT_COLS[i + 1] - FOOT_COLS[i], 11, t, 6.5, true, WHITE)));
  master.push(grid(FOOT_COLS, [685, 696, 708, 719, 730]));
  master.push({ k: 'rect', x: 9, y: 730, w: 522, h: 11, fill: st.foot });
  ['Approval', 'Name', 'Position', 'Document #'].forEach((t, i) => master.push(cellText(APPROVAL_COLS[i], 730, APPROVAL_COLS[i + 1] - APPROVAL_COLS[i], 11, t, 6.5, true, WHITE)));
  master.push(grid(APPROVAL_COLS, [730, 741, 759]));
  master.push(cellText(9, 741, 108, 18, 'Latest revision approved by:', 6.5, false, INK));
  master.push({ k: 'rect', x: 9, y: 759, w: 522, h: 11, fill: st.foot });
  master.push({ k: 'text', x: 12, y: 759, w: 380, h: 11, pad: 0, valign: 'middle', paras: [{ runs: [{ t: `The controlled source document is stored on the ${COMPANY_DB[inp.company]} KNOWLEDGE DATABASE`, c: WHITE }], size: 6 }] });
  master.push({ k: 'text', x: 380, y: 759, w: 148, h: 11, pad: 0, valign: 'middle', paras: [{ runs: [{ t: 'Printed copies are uncontrolled', c: WHITE }], size: 6, align: 'r' }] });

  // on the slide: title, page, sign-off
  let ts = 13;
  while (ts > 9 && textWidth(inp.title, ts, true) > 330) ts -= 0.5;
  const slide: Block[] = [
    { k: 'text', x: 15, y: 55, w: 340, h: 21, pad: 0, valign: 'middle', paras: [{ runs: [{ t: inp.title, b: true, c: WHITE }], size: ts }] },
    { k: 'text', x: 340, y: 55, w: 184, h: 21, pad: 0, valign: 'middle', paras: [{ runs: [{ t: [inp.docNo, inp.revision ? `Rev ${inp.revision}` : '', 'Page 1 of 1'].filter(Boolean).join(' · '), b: true, c: WHITE }], size: 9, align: 'r' }] },
  ];
  const so = inp.signoff;
  [inp.revision ?? '', printDate(so.date), so.changes, so.prepared, so.reviewed].forEach((t, i) => slide.push(cellText(FOOT_COLS[i], 696, FOOT_COLS[i + 1] - FOOT_COLS[i], 12, t, 7, false, INK)));
  [so.approver, so.position, inp.docNo ?? ''].forEach((t, i) => slide.push(cellText(APPROVAL_COLS[i + 1], 741, APPROVAL_COLS[i + 2] - APPROVAL_COLS[i + 1], 18, t, 7, false, INK)));
  return { master, slide };
}

function cellText(x: number, y: number, w: number, h: number, t: string, size: number, b: boolean, c: string): Block {
  return { k: 'text', x, y, w, h, pad: 0, valign: 'middle', paras: [{ runs: [{ t, b, c }], size, align: 'c' }] };
}
function grid(cols: number[], rows: number[]): Block {
  const tr: TRow[] = rows.slice(1).map((y, i) => ({ cells: cols.slice(1).map(() => ({ runs: [] })), h: y - rows[i], size: 6 }));
  return { k: 'table', x: cols[0], y: rows[0], w: cols[cols.length - 1] - cols[0], h: rows[rows.length - 1] - rows[0], cols: cols.slice(1).map((x, i) => x - cols[i]), rows: tr, grid: '6B7280' };
}

/** Everything to draw for the preview and the PDF. */
export function pageOps(inp: PageInput, logo: { w: number; h: number } | null) {
  const lay = layoutLesson(inp);
  const ch = chrome(inp, logo);
  return { ops: toOps([...ch.master, ...ch.slide, ...lay.blocks]), fits: lay.fits, size: lay.size };
}

// ---- picture boxes and ready-made layouts (6z.59) -------------------------------------------------------------------------

/** Every picture box made exactly the picture's size at its width (no empty space around the picture). */
export function fitPictureBoxes(inp: PageInput, boxes: Record<string, Rect>): Record<string, Rect> {
  const out = { ...boxes };
  for (const p of inp.content.pictures) { const r = out[`pic:${p.id}`]; if (r) out[`pic:${p.id}`] = { ...r, h: pictureHeight(p, r.w) }; }
  return out;
}

/** Pictures in rows across the page, side by side at the same height, each box exactly its picture. */
function pictureRows(list: LessonPicture[], x: number, y: number, w: number, maxH: number, gap = 8): { boxes: Record<string, Rect>; bottom: number } {
  const boxes: Record<string, Rect> = {};
  for (let i = 0; i < list.length; i += 3) {
    const r = list.slice(i, i + 3), sumA = r.reduce((a, p) => a + p.w / p.h, 0);
    const ih = Math.min(maxH, (w - gap * (r.length - 1)) / sumA);
    let px = x + (w - (ih * sumA + gap * (r.length - 1))) / 2;
    let bottom = y;
    for (const p of r) { const pw = (ih * p.w) / p.h; const h = pictureHeight(p, pw); boxes[`pic:${p.id}`] = { x: px, y, w: pw, h }; bottom = Math.max(bottom, y + h); px += pw + gap; }
    y = bottom + gap;
  }
  return { boxes, bottom: y - gap };
}

/** The shown pictures put side by side where the first one is, across the page. */
export function picturesSideBySide(inp: PageInput, boxes: Record<string, Rect>): Record<string, Rect> {
  const pics = shownPictures(inp.content);
  if (!pics.length) return boxes;
  const body = bodyOf(inp);
  const top = Math.min(...pics.map((p) => boxes[`pic:${p.id}`]?.y ?? body.bottom - 120));
  return { ...boxes, ...pictureRows(pics, body.left, top, body.right - body.left, 170).boxes };
}

export const DESIGNS = {
  classic: { label: 'Pictures at the side', blurb: 'Text on the left, pictures in a column on the right' },
  top: { label: 'Pictures on top', blurb: 'Pictures side by side under the key lesson, text below' },
  columns: { label: 'Two columns', blurb: 'What happened on the left, why and the pictures on the right' },
  bottom: { label: 'Pictures above the actions', blurb: 'All the text first, then the pictures side by side' },
} as const;
export type Design = keyof typeof DESIGNS;

/**
 * A ready-made arrangement of the same parts: each text box as tall as its text needs, each picture box exactly its
 * picture, at the largest text size and picture size that fit the page, with the spare height shared out.
 */
export function designBoxes(inp: PageInput, design: Design): Record<string, Rect> {
  const body = bodyOf(inp);
  const parts = partsOf(inp);
  const pics = shownPictures(inp.content).filter((p) => parts.includes(`pic:${p.id}`));
  const has = (id: PartId) => parts.includes(id);
  const GAP = 8, BW = body.right - body.left;
  let best: { boxes: Record<string, Rect>; bottom: number } | null = null;
  for (const s of [10, 9.5, 9, 8.5, 8, 7.5]) {
    for (const picMax of [210, 170, 130, 95, 70]) {
      const boxes: Record<string, Rect> = {};
      const measure = (id: PartId, w: number) => { const ctx: Ctx = { blocks: [], s, colour: inp.colour, figNo: new Map(), picScale: 1 }; return Math.ceil(drawPart(ctx, inp, id, 0, 0, w)) + 1; };
      const stack = (ids: PartId[], x: number, y: number, w: number) => { for (const id of ids.filter(has)) { const h = measure(id, w); boxes[id] = { x, y, w, h }; y += h + GAP; } return y - GAP; };
      const column = (x: number, y: number, w: number) => {
        for (const p of pics) { let pw = w, ih = (w * p.h) / p.w; if (ih > picMax) { ih = picMax; pw = (ih * p.w) / p.h; } const h = pictureHeight(p, pw); boxes[`pic:${p.id}`] = { x: x + (w - pw) / 2, y, w: pw, h }; y += h + GAP; }
        return y - GAP;
      };
      const rows = (y: number) => { if (!pics.length) return y - GAP; const r = pictureRows(pics, body.left, y, BW, picMax, GAP); Object.assign(boxes, r.boxes); return r.bottom; };
      let y = stack(['meta', 'key'], body.left, body.top, BW) + GAP;
      if (!has('meta') && !has('key')) y = body.top;
      const text: PartId[] = ['description', 'facts', 'damage', 'analysis'];
      if (design === 'classic' && pics.length) {
        const cw = 170, tw = BW - cw - 14;
        y = Math.max(stack(text, body.left, y, tw), column(body.left + tw + 14, y, cw)) + GAP;
      } else if (design === 'columns') {
        const cw = (BW - 14) / 2;
        const left = stack(['description', 'facts', 'damage'], body.left, y, cw);
        let right = stack(['analysis'], body.left + cw + 14, y, cw);
        if (pics.length) right = column(body.left + cw + 14, has('analysis') ? right + GAP : y, cw);
        y = Math.max(left, right) + GAP;
      } else if (design === 'top') {
        y = rows(y) + GAP;
        y = stack(text, body.left, y, BW) + GAP;
      } else {
        y = stack(text, body.left, y, BW) + GAP;
        y = rows(y) + GAP;
      }
      y = stack(['actions'], body.left, y, BW);
      if (!best || y < best.bottom) best = { boxes, bottom: y };
      if (y <= body.bottom) {
        // share the spare height out between the boxes, at most 1.2 times the gaps
        const used = y - body.top, room = body.bottom - body.top;
        const k = Math.min(1.12, room / Math.max(1, used));
        const spread = Object.fromEntries(Object.entries(boxes).map(([id, r]) => [id, { ...r, y: body.top + (r.y - body.top) * k }]));
        return tidyBoxes(spread, inp);
      }
    }
  }
  return tidyBoxes(best!.boxes, inp);
}
