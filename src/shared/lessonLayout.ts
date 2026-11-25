// The one-page layout of a lesson learnt or best practice (6z.57), in points on the template's page (540 × 780, the
// size of the company PowerPoint templates). The layout is a list of blocks (text boxes, tables, rectangles,
// pictures) used three ways: drawn as the live preview on the page, drawn into the PDF, and written as PowerPoint
// shapes on the company template. The header band and the footer tables belong to the template ("master"): the
// PowerPoint keeps the template's own, the preview and the PDF draw the same ones here.

import { COMPANY_DB, headings, printDate, type LessonCompany, type LessonContent, type LessonKind, type LessonPicture } from './lessons';

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
export interface TemplateStyle { band: string | null; title: string; bar: string; foot: string }
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

interface Ctx { blocks: Block[]; s: number; colour: string; pics: Map<string, LessonPicture>; figNo: Map<string, number>; picScale: number }

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
function figure(ctx: Ctx, p: LessonPicture, x: number, y: number, w: number, maxH: number): number {
  let pw = w, ph = (w * p.h) / p.w;
  if (ph > maxH) { ph = maxH; pw = (maxH * p.w) / p.h; }
  ctx.blocks.push({ k: 'image', x: x + (w - pw) / 2, y, w: pw, h: ph, pic: p.id });
  y += ph + 2;
  const n = ctx.figNo.get(p.id) ?? ctx.figNo.size + 1;
  ctx.figNo.set(p.id, n);
  return text(ctx, [{ runs: [{ t: `Fig ${n}.${p.caption ? ` ${p.caption}` : ''}`, c: GREY }], size: Math.max(6.5, ctx.s - 3), align: 'c' }], x, y, w) + 5;
}
function pictureRow(ctx: Ctx, list: LessonPicture[], x: number, y: number, w: number, maxH: number): number {
  for (let i = 0; i < list.length; i += 3) {
    const row = list.slice(i, i + 3);
    const gap = 8, cw = (w - gap * (row.length - 1)) / row.length;
    const ends = row.map((p, j) => figure(ctx, p, x + j * (cw + gap), y, cw, maxH * ctx.picScale));
    y = Math.max(...ends);
  }
  return y;
}

function body(inp: PageInput, s: number, picScale: number): { blocks: Block[]; bottom: number } {
  const c = inp.content;
  const hd = headings(inp.kind);
  const ctx: Ctx = { blocks: [], s, colour: inp.colour, pics: new Map(c.pictures.map((p) => [p.id, p])), figNo: new Map(), picScale };
  let y = TOP;

  // event facts
  const meta = ([['Event date', printDate(c.event_date)], ['Field', c.field], ['Well', c.well], ['Job', c.job], ['Unit', c.unit], ['Category', c.category]] as const).filter(([, v]) => v);
  if (meta.length) {
    const cols = meta.map(() => W / meta.length);
    const rows = tableRows(cols, [
      { cells: meta.map(([k]) => ({ runs: [{ t: k.toUpperCase(), c: GREY }] })), size: 6, min: 10 },
      { cells: meta.map(([, v]) => ({ runs: [{ t: v, b: true }] })), size: Math.max(7.5, s - 1.5) },
    ]);
    rows[0].h = 10;
    const h = rows.reduce((a, r) => a + r.h, 0);
    ctx.blocks.push({ k: 'table', x: L, y, w: W, h, cols, rows, grid: 'D1D5DB' });
    y += h + 7;
  }
  // key lesson
  if (c.key_lesson) {
    const paras: Para[] = [{ runs: [{ t: hd.key.toUpperCase(), b: true, c: inp.colour }], size: 6.5 }, { runs: [{ t: c.key_lesson, b: true }], size: s + 0.5, gap: 1 }];
    const h = textHeight(paras, W - 10, 5);
    ctx.blocks.push({ k: 'rect', x: L, y, w: W, h, fill: tint(inp.colour, 0.9) }, { k: 'rect', x: L, y, w: 3.5, h, fill: inp.colour });
    ctx.blocks.push({ k: 'text', x: L + 8, y, w: W - 10, h, pad: 5, paras });
    y += h + 8;
  }

  const pics = c.pictures;
  const right = c.pictures_as === 'right' && pics.length > 0;
  const tw = right ? W - 168 - 14 : W;
  const colTop = y;
  const after = (section: 'description' | 'analysis', yy: number) => {
    if (right) return yy;
    const list = pics.filter((p) => p.section === section);
    if (!list.length) return yy;
    if (c.pictures_as === 'large') {
      yy = figure(ctx, list[0], L, yy + 4, W, 250 * picScale);
      return list.length > 1 ? pictureRow(ctx, list.slice(1), L, yy, W, 120) : yy;
    }
    return pictureRow(ctx, list, L, yy + 4, W, 140);
  };

  // description
  const desc = lines(c.description);
  if (desc.length) {
    y = heading(ctx, hd.description, L, y, tw);
    const paras: Para[] = c.description_as === 'paragraph'
      ? desc.map((t, i) => ({ runs: [{ t }], size: s, gap: i ? 3 : 0 }))
      : c.description_as === 'timeline'
        ? desc.map((t, i) => { const m = /^(.{1,24}?)\s+[-–—:|]\s+(.+)$/.exec(t); return { runs: m ? [{ t: m[1], b: true, c: inp.colour }, { t: ` ${m[2]}` }] : [{ t }], size: s, gap: i ? 2.5 : 0 }; })
        : desc.map((t, i) => ({ runs: [{ t: t.replace(/^[-•*▪]\s*/, '') }], size: s, bullet: '•', gap: i ? 2 : 0 }));
    y = text(ctx, paras, L, y, tw) + 4;
  }
  y = after('description', y);

  // potential damage
  if (inp.kind === 'lesson_learnt' && c.damage.length) {
    y = heading(ctx, 'Potential damage', L, y + 2, tw);
    if (c.damage_as === 'list') y = text(ctx, c.damage.map((t) => ({ runs: [{ t }], size: s, bullet: '•' })), L, y, tw) + 4;
    else {
      const ts = Math.max(7.5, s - 1), th = ts + 7;
      let x = L;
      for (const t of c.damage) {
        const w = Math.min(tw, textWidth(t, ts, true) + 14);
        if (x > L && x + w > L + tw) { x = L; y += th + 4; }
        ctx.blocks.push({ k: 'rect', x, y, w, h: th, stroke: inp.colour, sw: 0.8 });
        ctx.blocks.push({ k: 'text', x, y, w, h: th, pad: 0, valign: 'middle', paras: [{ runs: [{ t, b: true, c: inp.colour }], size: ts, align: 'c' }] });
        x += w + 5;
      }
      y += th + 6;
    }
  }

  // analysis
  const imm = lines(c.immediate_cause), root = lines(c.root_cause);
  if (imm.length || root.length) {
    y = heading(ctx, hd.analysis, L, y + 2, tw);
    const sub = (t: string): Para => ({ runs: [{ t, b: true, u: true }], size: s });
    const causes = (ls: string[]): Para[] => ls.map((t) => ({ runs: leadRuns(t), size: s, gap: 2 }));
    // a best practice with one part needs no sub-heading under its heading
    const subs = inp.kind === 'lesson_learnt' || (imm.length > 0 && root.length > 0);
    const immParas = imm.length ? [...(subs ? [sub(hd.immediate)] : []), ...causes(imm)] : [];
    const rootParas = root.length ? [...(subs ? [sub(hd.root)] : []), ...causes(root)] : [];
    if (c.analysis_as === 'side' && immParas.length && rootParas.length && tw >= 300) {
      const cw = (tw - 12) / 2;
      y = Math.max(text(ctx, immParas, L, y, cw), text(ctx, rootParas, L + cw + 12, y, cw)) + 4;
    } else {
      y = text(ctx, [...immParas, ...rootParas.map((p, i) => (i === 0 ? { ...p, gap: 5 } : p))], L, y, tw) + 4;
    }
    if (c.analysis_as === 'whys' && c.whys.length) {
      y = text(ctx, [{ ...sub('5 whys'), gap: 2 }, ...c.whys.map((t, i) => ({ runs: [{ t: `Why ${i + 1}`, b: true, c: inp.colour }, { t: `  ${t}` }], size: s, gap: 2 }))], L, y, tw) + 4;
    }
  }
  y = after('analysis', y);

  // the picture column
  if (right) {
    let py = colTop;
    for (const p of pics) py = figure(ctx, p, L + tw + 14, py, 168, 175 * picScale);
    y = Math.max(y, py);
  }

  // actions
  if (c.actions.length) {
    y = heading(ctx, hd.actions, L, y + 2, W);
    if (c.actions_as === 'list') {
      y = text(ctx, c.actions.map((a, i) => {
        const tail = [a.due ? `Deadline ${printDate(a.due)}.` : '', a.responsible ? `Responsible: ${a.responsible}` : ''].filter(Boolean).join(' ');
        return { runs: [{ t: a.action }, ...(tail ? [{ t: ` ${tail}`, b: true, c: RED }] : [])], size: s, bullet: `${i + 1}.`, gap: i ? 3 : 0 };
      }), L, y, W) + 4;
    } else {
      const cols = [20, W - 20 - 100 - 72, 100, 72];
      const hs = Math.max(7, s - 2), rs = Math.max(7.5, s - 1);
      const rows = tableRows(cols, [
        { cells: [{ runs: [{ t: '#', b: true, c: WHITE }], align: 'c' }, { runs: [{ t: 'Action', b: true, c: WHITE }] }, { runs: [{ t: 'Responsible', b: true, c: WHITE }] }, { runs: [{ t: 'Target date', b: true, c: WHITE }] }], size: hs, fill: inp.colour },
        ...c.actions.map((a, i) => ({ cells: [{ runs: [{ t: String(i + 1) }], align: 'c' as const }, { runs: [{ t: a.action }] }, { runs: [{ t: a.responsible }] }, { runs: [{ t: printDate(a.due), b: true, c: RED }] }], size: rs })),
      ]);
      const h = rows.reduce((a, r) => a + r.h, 0);
      ctx.blocks.push({ k: 'table', x: L, y, w: W, h, cols, rows, grid: 'D1D5DB' });
      y += h + 4;
    }
  }
  return { blocks: ctx.blocks, bottom: y };
}

/** The body at the largest text size that fits on the page (10.5 pt down to 8, then smaller pictures). */
export function layoutLesson(inp: PageInput): { blocks: Block[]; fits: boolean; size: number; bottom: number } {
  let last = { blocks: [] as Block[], bottom: 0 };
  for (const scale of [1, 0.8, 0.62]) {
    for (const s of [10.5, 10, 9.5, 9, 8.5, 8]) {
      last = body(inp, s, scale);
      if (last.bottom <= BOTTOM) return { ...last, fits: true, size: s };
    }
  }
  return { ...last, fits: false, size: 8 };
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
