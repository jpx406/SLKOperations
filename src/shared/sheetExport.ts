// The columns the Activity sheet and the Daily report show, how each value is written, and their Excel and PDF
// files. The screen and the PDF use the same columns: an open group shows its fields, a closed group one summary
// column, so what is printed is what was on screen. The Excel file always has every column.

import { NESR_LOGO_JPEG } from './brandLogo';
import { PdfDoc, textWidth, wrap } from './pdf';
import { shownValue, usesField, type SheetField, type SheetLine, type Value } from './salesSheets';
import type { Cell, SheetSpec } from './xlsx';

export interface Group { key: string; label: string; hint?: string }
export interface Col { key: string; label: string; group: string; field?: SheetField; summary?: boolean; highlight: boolean }

/** The fields any of these lines use, by group. */
export function usedFields(fields: SheetField[], lines: Pick<SheetLine, 'format'>[]) {
  const formats = new Set(lines.map((l) => l.format));
  return fields.filter((f) => !f.formats || f.formats.some((k) => formats.has(k)));
}

export function visibleColumns(fields: SheetField[], groups: readonly Group[], lines: Pick<SheetLine, 'format'>[], open: ReadonlySet<string>): Col[] {
  const used = usedFields(fields, lines);
  return groups.flatMap((g): Col[] => {
    const fs = used.filter((f) => f.group === g.key);
    if (!fs.length) return [];
    if (!open.has(g.key)) return [{ key: `group:${g.key}`, label: g.label, group: g.key, summary: true, highlight: false }];
    return fs.map((f) => ({ key: f.key, label: f.label, group: g.key, field: f, highlight: !!f.formats }));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Writing values

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const riyadh = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { y: g('year'), m: g('month'), d: g('day'), hm: `${g('hour')}:${g('minute')}` };
};

/** A value as the screen and the PDF show it. */
export function display(f: SheetField | undefined, v: Value): string {
  if (v === null || v === undefined || v === '') return '';
  if (!f) return String(v);
  const s = String(v);
  switch (f.type) {
    case 'date': return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)} ${MON[Number(s.slice(5, 7)) - 1]} ${s.slice(2, 4)}` : s;
    case 'datetime': {
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return display({ ...f, type: 'date' }, s);
      const r = riyadh(s);
      return r ? `${r.d} ${MON[Number(r.m) - 1]} ${r.hm}` : s;
    }
    case 'month': return /^\d{4}-\d{2}$/.test(s) ? `${MON[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : s;
    case 'money': return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'number': return Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
    default: return s;
  }
}

/** A value for Excel: numbers stay numbers, dates and times are written YYYY-MM-DD (HH:MM in Riyadh). */
export function excelValue(f: SheetField, v: Value): Cell {
  if (v === null || v === undefined || v === '') return null;
  if (f.type === 'number' || f.type === 'money') return Number(v);
  if (f.type === 'datetime' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) { const r = riyadh(String(v)); return r ? `${r.y}-${r.m}-${r.d} ${r.hm}` : String(v); }
  return String(v);
}

// What a closed group shows: the few values that say the most
const SUMMARY: Record<string, string[]> = {
  job: ['field_rig', 'well', 'job_type'], crew: ['supervisor', 'operators'], docs: ['ticket_status', 'dmr_status', 'fst_no'],
  follow: ['finance_submitted_on', 'client_submitted_on'], account: ['site_name', 'site_assign', 'client_unit', 'campaign_type', 'land_offshore', 'km'],
  notes: ['comments', 'remarks'], assignment: ['status', 'rig_site', 'well'], people: ['supervisor'], equipment: ['unit_type', 'pce'], well: ['well_type', 'location_type', 'entity'],
};

export function groupSummary(group: string, line: SheetLine, fields: SheetField[]): string {
  const f = (k: string) => fields.find((x) => x.key === k);
  const v = (k: string) => { const x = f(k); return x && usesField(x, line.format) ? display(x, shownValue(x, line, fields)) : ''; };
  if (group === 'dates') { const a = v('started_at') || v('mob_on') || v('planned_mob_on'), b = v('finished_at') || v('demob_on'); return a || b ? `${a || '…'} → ${b || '…'}` : ''; }
  if (group === 'hours') { const t = v('total_hours'); return t ? `${t} h${v('npt_hours') && v('npt_hours') !== '0' ? ` · NPT ${v('npt_hours')}` : ''}` : ''; }
  if (group === 'revenue') { const n = v('net'); return n ? `${n} ${v('currency') || ''}`.trim() : ''; }
  return (SUMMARY[group] ?? []).map(v).filter(Boolean).join(' · ');
}

export function cellText(c: Col, line: SheetLine, fields: SheetField[]): string {
  if (c.summary) return groupSummary(c.group, line, fields);
  if (c.field && !usesField(c.field, line.format)) return 'n/a';
  return display(c.field, shownValue(c.field!, line, fields));
}

// ---------------------------------------------------------------------------------------------------------------
// Excel

export interface Section { title: string; lines: SheetLine[] }

const lockCells = (l: SheetLine): Cell[] => [l.locked ? l.locked.name ?? l.locked.by : null, l.locked ? `${l.locked.at.slice(0, 10)} ${l.locked.at.slice(11, 16)} UTC` : null];
const widthOf = (f: SheetField) => (f.type === 'longtext' ? 36 : f.type === 'date' || f.type === 'month' ? 12 : f.type === 'datetime' ? 17 : f.type === 'number' || f.type === 'money' ? 12 : Math.max(12, Math.min(28, f.label.length + 4)));

/** One sheet: the lead columns, every field the lines use (in group order), and who checked each line. */
export function sheetSpec(name: string, lead: { label: string; value: (l: SheetLine) => Cell; width: number }[], fields: SheetField[], groups: readonly Group[], sections: Section[], highlightSpecific: boolean): SheetSpec {
  const lines = sections.flatMap((s) => s.lines);
  const used = usedFields(fields, lines);
  const ordered = groups.flatMap((g) => used.filter((f) => f.group === g.key));
  const header = [...lead.map((c) => c.label), ...ordered.map((f) => f.label), 'Checked by', 'Checked on (UTC)'];
  const spans = [{ label: '', span: lead.length }, ...groups.map((g) => ({ label: g.label, span: ordered.filter((f) => f.group === g.key).length })).filter((g) => g.span), { label: 'Review', span: 2 }];
  const rows: Cell[][] = [];
  const muted: number[] = [];
  for (const s of sections) {
    if (sections.length > 1) { muted.push(rows.length); rows.push([`${s.title} (${s.lines.length})`]); }
    for (const l of s.lines) rows.push([...lead.map((c) => c.value(l)), ...ordered.map((f) => (usesField(f, l.format) ? excelValue(f, shownValue(f, l, fields)) : null)), ...lockCells(l)]);
  }
  return {
    name, header, rows, muted, groups: spans,
    highlight: [...lead.map(() => false), ...ordered.map((f) => highlightSpecific && !!f.formats), false, false],
    widths: [...lead.map((c) => c.width), ...ordered.map(widthOf), 18, 18],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// PDF: a landscape table of the columns on screen, a band per section with its subtotal

const LOGO = { width: NESR_LOGO_JPEG.width, height: NESR_LOGO_JPEG.height, data: Uint8Array.from(atob(NESR_LOGO_JPEG.base64), (c) => c.charCodeAt(0)) };
const INK: [number, number, number] = [18 / 255, 23 / 255, 31 / 255];
const GREY: [number, number, number] = [0.42, 0.42, 0.42];
const BAND: [number, number, number] = [0.92, 0.93, 0.95];
const SHADE: [number, number, number] = [1, 0.95, 0.76];

function clip(s: string, width: number, size: number, bold = false) {
  if (textWidth(s, size, bold) <= width) return s;
  let n = s.length;
  while (n > 1 && textWidth(`${s.slice(0, n)}…`, size, bold) > width) n--;
  return `${s.slice(0, n)}…`;
}

export interface PdfTable {
  title: string;
  subtitle: string;
  lead: { label: string; value: (l: SheetLine) => string }[];
  cols: Col[];
  fields: SheetField[];
  sections: (Section & { total?: string; color?: string })[];
  /** Extra blocks under the table (counts, upcoming operations): a title and lines of text. */
  notes?: { title: string; lines: string[] }[];
  footer: string;
  /** A4 by default. A3 also fits every column on one page width, shrinking the type when it has to. */
  paper?: 'A4' | 'A3';
}

const hex = (c?: string): [number, number, number] | null => (c && /^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) as [number, number, number] : null);
const mix = (c: [number, number, number], pct: number): [number, number, number] => c.map((x) => 1 - (1 - x) * pct) as [number, number, number];

export function tablePdf(t: PdfTable): Uint8Array {
  const doc = new PdfDoc({ landscape: true, paper: t.paper });
  const m = doc.margin, full = doc.width - 2 * m;
  let size = 6.5;
  type PCol = { label: string; w: number; highlight: boolean; get: (l: SheetLine) => string; group: string };
  const lines = t.sections.flatMap((s) => s.lines);
  // each column as wide as its longest header word and its longest value, within limits
  const natural = (label: string, get: (l: SheetLine) => string, max: number, min = 24) => {
    const word = Math.max(...label.split(/\s+/).map((w) => textWidth(w, size, true)));
    // only the filled cells count: a column empty on most lines still needs room for the lines that have a value
    const vals = lines.map(get).filter((v) => v && v !== 'n/a').map((v) => textWidth(v, size)).sort((a, b) => a - b);
    const longest = vals.length ? vals[vals.length - 1] : 0;
    return Math.min(max, Math.max(min, word + 4, longest + 4));
  };
  const fixed: PCol[] = [
    ...t.lead.map((c) => ({ label: c.label, w: natural(c.label, c.value, 80), highlight: false, get: c.value, group: '' })),
    { label: '✓', w: 10, highlight: false, get: (l: SheetLine) => (l.locked ? 'v' : ''), group: '' },
  ];
  const rest: PCol[] = t.cols.map((c) => {
    const get = (l: SheetLine) => cellText(c, l, t.fields);
    return { label: c.label, w: natural(c.label, get, c.summary || c.field?.type === 'longtext' ? 170 : 110, c.field?.type === 'longtext' ? 80 : 24), highlight: c.highlight, get, group: c.group };
  });
  // on A3 every column goes on the page, and on A4 too when they are no more than a third wider than it:
  // columns and type shrink together. Wider tables on A4 continue on the next pages instead.
  const natTotal = [...fixed, ...rest].reduce((a, c) => a + c.w, 0);
  const fit = t.paper === 'A3' || natTotal <= full * 1.35;
  if (fit) {
    const k = Math.min(1, full / natTotal);
    size *= k;
    for (const c of [...fixed, ...rest]) c.w *= k;
  }
  // padding grows and shrinks with the type, so a word that fits its column still fits once A3 scales it down
  const pad = size * 0.3, rowH = size * 1.75, headH = size * 2.9;
  // columns that don't fit the page width continue on the next pages, with the line's name repeated
  const room = fit ? Infinity : full - fixed.reduce((a, c) => a + c.w, 0);
  const bands: PCol[][] = [];
  for (const c of rest) {
    const b = bands[bands.length - 1];
    if (b && b.reduce((a, x) => a + x.w, 0) + c.w <= room) b.push(c); else bands.push([c]);
  }
  if (!bands.length) bands.push([]);

  const groupLabel = (g: string) => t.cols.find((c) => c.group === g && c.summary)?.label;
  bands.forEach((band, bi) => {
    if (bi > 0) doc.addPage();
    const cols = [...fixed, ...band];
    const scale = full / cols.reduce((a, c) => a + c.w, 0);
    // the columns always share the whole page width, in proportion to what they hold
    const widths = cols.map((c) => c.w * scale);
    // header band
    doc.rect(m, doc.y - 40, full, 40, INK);
    const lh = 28, lw = lh * (LOGO.width / LOGO.height);
    doc.jpeg(LOGO, m + 8, doc.y - 34, lw, lh);
    doc.text(m + 16 + lw, doc.y - 18, `${t.title}${bands.length > 1 ? `  (columns ${bi + 1} of ${bands.length})` : ''}`, { size: 12, bold: true, color: [1, 1, 1] });
    doc.text(m + 16 + lw, doc.y - 31, t.subtitle, { size: 8, color: [0.8, 0.8, 0.8] });
    doc.y -= 50;
    const header = () => {
      let x = m;
      const runs: { g: string; x: number; w: number }[] = [];
      cols.forEach((c, i) => { const last = runs[runs.length - 1]; if (last && last.g === c.group) last.w += widths[i]; else runs.push({ g: c.group, x, w: widths[i] }); x += widths[i]; });
      doc.need(rowH * 4);
      for (const r of runs) if (r.g && !groupLabel(r.g)) {
        doc.rect(r.x + 0.5, doc.y - 9, r.w - 1, 9, BAND);
        doc.text(r.x + 2, doc.y - 6.8, clip((GROUP_NAMES[r.g] ?? r.g).toUpperCase(), r.w - 4, 5.5, true), { size: 5.5, bold: true, color: GREY });
      }
      doc.y -= 10;
      x = m;
      cols.forEach((c, i) => {
        if (c.highlight) doc.rect(x, doc.y - headH, widths[i], headH, SHADE);
        wrap(c.label, widths[i] - 2 * pad, size, true).slice(0, 2).forEach((ln, k, all) =>
          doc.text(x + pad, doc.y - size - 1 - k * size * 1.2, clip(k === 1 && all.length > 2 ? `${ln}…` : ln, widths[i] - 2 * pad, size, true), { size, bold: true }));
        x += widths[i];
      });
      doc.y -= headH;
      doc.line(m, doc.y, m + full, doc.y, 0.4);
    };
    header();
    for (const s of t.sections) {
      if (doc.y - rowH * 3 < doc.margin + 24) { doc.addPage(); header(); }
      const tone = hex(s.color);
      doc.rect(m, doc.y - rowH - 1, full, rowH + 1, tone ? mix(tone, 0.45) : BAND);
      doc.text(m + 3, doc.y - size - 1.5, `${s.title} · ${s.lines.length} line${s.lines.length === 1 ? '' : 's'} · ${s.lines.filter((l) => l.locked).length} checked`, { size, bold: true });
      if (s.total) doc.text(m + full - 3 - textWidth(s.total, size, true), doc.y - size - 1.5, s.total, { size, bold: true });
      doc.y -= rowH + 1;
      s.lines.forEach((l, li) => {
        if (doc.y - rowH < doc.margin + 24) { doc.addPage(); header(); }
        if (tone && li % 2 === 1) doc.rect(m, doc.y - rowH, full, rowH, mix(tone, 0.12));
        let x = m;
        cols.forEach((c, i) => {
          const v = c.get(l);
          doc.text(x + pad, doc.y - size - 1, clip(v, widths[i] - 2 * pad, size), { size, color: v === 'n/a' ? GREY : [0, 0, 0] });
          x += widths[i];
        });
        doc.y -= rowH;
        doc.line(m, doc.y, m + full, doc.y, 0.88);
      });
      doc.y -= 4;
    }
  });
  for (const n of t.notes ?? []) {
    doc.need(30);
    doc.y -= 6;
    doc.para(n.title, { size: 8.5, bold: true, gap: 2 });
    for (const line of n.lines) doc.para(line, { size: 7.5 });
  }
  return doc.bytes(t.footer);
}

// ---------------------------------------------------------------------------------------------------------------
// PDF, full detail: one block per line instead of one row. A title strip names the line (ticket, well, unit …)
// and says who checked it; under it every field the line's account keeps, in labelled group blocks (Job, Crew,
// Dates …) laid side by side, so nothing is squeezed into a narrow column.

export interface RecordPdf {
  title: string;
  subtitle: string;
  footer: string;
  paper?: 'A4' | 'A3';
  fields: SheetField[];
  groups: readonly Group[];
  sections: (Section & { total?: string; color?: string })[];
  /** The line's name and the few facts shown beside it in its title strip. */
  heading: (l: SheetLine) => { name: string; facts: string[]; amount?: string };
}

/** Splits items, in order, into at most n columns so the tallest column is as short as it can be. */
export function balance<T>(items: T[], n: number, height: (t: T) => number): T[][] {
  const h = items.map(height);
  const sum = (i: number, j: number) => h.slice(i, j).reduce((a, b) => a + b, 0);
  // best[k][i]: the shortest tallest column putting items i.. into k columns
  const memo = new Map<string, { cost: number; cut: number }>();
  const best = (k: number, i: number): { cost: number; cut: number } => {
    if (i >= items.length) return { cost: 0, cut: items.length };
    if (k === 1) return { cost: sum(i, items.length), cut: items.length };
    const key = `${k}|${i}`;
    const hit = memo.get(key);
    if (hit) return hit;
    let out = { cost: Infinity, cut: items.length };
    for (let j = i + 1; j <= items.length; j++) {
      const cost = Math.max(sum(i, j), best(k - 1, j).cost);
      if (cost < out.cost) out = { cost, cut: j };
    }
    memo.set(key, out);
    return out;
  };
  const cols: T[][] = [];
  for (let i = 0, k = Math.min(n, items.length); i < items.length; k--) { const { cut } = best(k, i); cols.push(items.slice(i, cut)); i = cut; }
  return cols;
}

function pageBand(doc: PdfDoc, title: string, subtitle: string) {
  const m = doc.margin, full = doc.width - 2 * m;
  doc.rect(m, doc.y - 40, full, 40, INK);
  const lh = 28, lw = lh * (LOGO.width / LOGO.height);
  doc.jpeg(LOGO, m + 8, doc.y - 34, lw, lh);
  doc.text(m + 16 + lw, doc.y - 18, title, { size: 12, bold: true, color: [1, 1, 1] });
  doc.text(m + 16 + lw, doc.y - 31, subtitle, { size: 8, color: [0.8, 0.8, 0.8] });
  doc.y -= 50;
}

export function recordPdf(t: RecordPdf): Uint8Array {
  const doc = new PdfDoc({ landscape: true, paper: t.paper });
  const m = doc.margin, full = doc.width - 2 * m;
  const a3 = t.paper === 'A3';
  const size = a3 ? 6.8 : 6.2, rowH = size * 1.6, titleH = size * 2.4, gap = 8;
  const ncol = a3 ? 5 : 4;
  const colW = (full - gap * (ncol - 1)) / ncol;
  pageBand(doc, t.title, t.subtitle);
  const bottom = () => doc.margin + 24;

  for (const s of t.sections) {
    const tone = hex(s.color);
    // the same block arrangement for every line of a section (an account), so the eye finds a field in one place
    const used = usedFields(t.fields, s.lines).filter((f) => f.key !== 'comments');
    const blocks = t.groups.map((g) => ({ g, fs: used.filter((f) => f.group === g.key) })).filter((b) => b.fs.length);
    const columns = balance(blocks, ncol, (b) => b.fs.length + 1.4);
    const colRows = columns.map((c) => c.reduce((a, b) => a + b.fs.length * rowH + titleH, 0));
    const bodyH = Math.max(...colRows);
    const hasComments = t.fields.some((f) => f.key === 'comments');
    const sectionBand = (cont: boolean) => {
      doc.rect(m, doc.y - 15, full, 15, tone ? mix(tone, 0.5) : BAND);
      doc.text(m + 6, doc.y - 10.5, `${s.title}${cont ? ' (continued)' : ''}  ·  ${s.lines.length} line${s.lines.length === 1 ? '' : 's'}  ·  ${s.lines.filter((l) => l.locked).length} checked`, { size: 8.5, bold: true });
      if (s.total) doc.text(m + full - 6 - textWidth(s.total, 8.5, true), doc.y - 10.5, s.total, { size: 8.5, bold: true });
      doc.y -= 21;
    };
    if (doc.y - 15 - 20 - bodyH < bottom()) { doc.addPage(); pageBand(doc, t.title, t.subtitle); }
    sectionBand(false);

    for (const l of s.lines) {
      const comment = hasComments ? display(t.fields.find((f) => f.key === 'comments'), shownValue(t.fields.find((f) => f.key === 'comments')!, l, t.fields)) : '';
      const recH = 16 + bodyH + (comment ? rowH + 2 : 0) + 10;
      if (doc.y - recH < bottom()) { doc.addPage(); pageBand(doc, t.title, t.subtitle); sectionBand(true); }
      // title strip: the line's name, its facts, who checked it and its amount
      const head = t.heading(l);
      doc.rect(m, doc.y - 15, full, 15, tone ? mix(tone, 0.22) : [0.96, 0.96, 0.97]);
      doc.rect(m, doc.y - 15, 3, 15, tone ?? GREY);
      doc.text(m + 8, doc.y - 10.5, head.name, { size: 9, bold: true });
      let x = m + 14 + textWidth(head.name, 9, true);
      const right = l.locked ? `Checked by ${l.locked.name ?? l.locked.by} · ${display({ key: '', label: '', group: '', source: 'app', type: 'date' }, l.locked.at.slice(0, 10))}` : 'Not checked yet';
      const rightW = textWidth(right, 7.5, !!l.locked) + (head.amount ? textWidth(head.amount, 9, true) + 18 : 0);
      doc.text(x, doc.y - 10.2, clip(head.facts.filter(Boolean).join('   ·   '), m + full - rightW - 20 - x, 7.5), { size: 7.5, color: [0.25, 0.25, 0.28] });
      let rx = m + full - 8;
      if (head.amount) { rx -= textWidth(head.amount, 9, true); doc.text(rx, doc.y - 10.5, head.amount, { size: 9, bold: true }); rx -= 18; }
      doc.text(rx - textWidth(right, 7.5, !!l.locked), doc.y - 10.2, right, { size: 7.5, bold: !!l.locked, color: l.locked ? [0.05, 0.45, 0.2] : GREY });
      doc.y -= 19;
      // the group blocks, side by side
      const top = doc.y;
      columns.forEach((col, ci) => {
        let y = top;
        const cx = m + ci * (colW + gap);
        for (const b of col) {
          doc.text(cx, y - size - 1, b.g.label.toUpperCase(), { size: size * 0.85, bold: true, color: GREY });
          doc.line(cx, y - titleH + 2, cx + colW, y - titleH + 2, 0.82);
          y -= titleH;
          const labW = colW * 0.46;
          for (const f of b.fs) {
            const on = usesField(f, l.format);
            const v = on ? display(f, shownValue(f, l, t.fields)) : '';
            if (f.formats) doc.rect(cx, y - rowH + 1, colW, rowH - 0.5, [1, 0.97, 0.86]);
            doc.text(cx + 2, y - size - 0.5, clip(f.label, labW - 4, size), { size, color: GREY });
            doc.text(cx + labW, y - size - 0.5, clip(on ? v || '—' : 'n/a', colW - labW - 2, size, f.source === 'calc'),
              { size, bold: f.source === 'calc', color: !on || !v ? [0.7, 0.7, 0.72] : [0.08, 0.08, 0.1] });
            y -= rowH;
          }
          y -= 3;
        }
      });
      doc.y = top - bodyH;
      if (comment) {
        doc.text(m + 2, doc.y - size - 1, 'Comments', { size, color: GREY });
        doc.text(m + 2 + colW * 0.46, doc.y - size - 1, clip(comment, full - colW * 0.46 - 4, size), { size });
        doc.y -= rowH + 2;
      }
      doc.y -= 4;
      doc.line(m, doc.y, m + full, doc.y, 0.7);
      doc.y -= 6;
    }
    doc.y -= 6;
  }
  return doc.bytes(t.footer);
}

const GROUP_NAMES: Record<string, string> = {
  job: 'Job', crew: 'Crew', dates: 'Dates', hours: 'Hours', docs: 'Ticket & documents', follow: 'Ticket follow-up', revenue: 'Revenue', account: 'Account details', notes: 'Comments',
  assignment: 'Assignment', people: 'People', equipment: 'Equipment', well: 'Well & location',
};
