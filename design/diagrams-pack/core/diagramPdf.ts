// The Rig Up Diagram (QAF14009) and Slickline String Diagram (QAF14010) as a one-page A4 PDF in the forms' layout:
// title block, job header, one row per part with its drawing, totals, and Prepared / Reviewed boxes.

import { NESR_LOGO_JPEG } from './brandLogo';
import { FAMILY_OF, FORM, layoutStack, rigTotals, stringTotals, type DiagramKind, type Row } from './diagram';
import { PICTURES } from './diagramPictures';
import type { PictureKey } from './partPictures';
import { stampText } from './stamp';
import { PdfDoc, textWidth, wrap } from './pdf';

const LOGO = { width: NESR_LOGO_JPEG.width, height: NESR_LOGO_JPEG.height, data: Uint8Array.from(atob(NESR_LOGO_JPEG.base64), (c) => c.charCodeAt(0)) };
type RGB = [number, number, number];
// decoded once per worker and reused, so the PDF stores each picture once
const pictures = new Map<PictureKey, { width: number; height: number; data: Uint8Array }>();
const picture = (k: PictureKey) => {
  let pic = pictures.get(k);
  if (!pic) { const j = PICTURES[k]; pic = { width: j.width, height: j.height, data: Uint8Array.from(atob(j.base64), (c) => c.charCodeAt(0)) }; pictures.set(k, pic); }
  return pic;
};
const INK: RGB = [0.07, 0.09, 0.12], GREY: RGB = [0.4, 0.42, 0.45], HEAD: RGB = [0.91, 0.94, 0.83];
const rgb = (hex: string): RGB => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const ft = (n: number | null) => (n == null ? '' : `${n.toFixed(2)} ft`);
const m = (n: number | null) => (n == null ? '' : `${(n * 0.3048).toFixed(2)} m`);

export interface DiagramPdfInput {
  kind: DiagramKind; run_no: number; rev: number; rows: Row[];
  job: { client: string; well: string | null; field: string | null; rig: string | null; unit_number: string | null; date: string | null; ticket_no: string | null; drss_no: string | null };
  prepared: { by: string; at: string } | null;
  reviewed: { by: string; at: string } | null;
  totalDepth?: { md: number | null; tvd: number | null };
}

export function diagramPdf(p: DiagramPdfInput): Uint8Array {
  const doc = new PdfDoc();
  const L = doc.margin, R = doc.width - L, W = R - L;
  const form = FORM[p.kind], family = FAMILY_OF[p.kind], rig = p.kind === 'rigup';
  let y = doc.height - L;

  // title block
  doc.box(L, y - 44, W, 44, 0.15, 1.2);
  const lh = 30, lw = lh * (LOGO.width / LOGO.height);
  doc.rect(L + 1, y - 43, lw + 16, 42, [18 / 255, 23 / 255, 31 / 255]);
  doc.jpeg(LOGO, L + 9, y - 37, lw, lh);
  const title = rig ? form.title : `${form.title} · Run ${p.run_no}`;
  doc.text(L + lw + 30, y - 27, title, { size: 15, bold: true, color: INK });
  doc.text(R - 92, y - 20, `${form.code}`, { size: 9, bold: true, color: INK });
  doc.text(R - 92, y - 33, `Rev ${p.rev}`, { size: 9, color: GREY });
  y -= 44;

  // job header
  const head: [string, string][] = rig
    ? [['Client', p.job.client], ['Well', p.job.well ?? ''], ['Field / Rig', [p.job.field, p.job.rig].filter(Boolean).join(' / ')], ['Unit', p.job.unit_number ?? ''], ['Date', p.job.date ?? ''], ['Ticket / DRSS', [p.job.ticket_no, p.job.drss_no].filter(Boolean).join(' / ')]]
    : [['Client', p.job.client], ['Well', p.job.well ?? ''], ['Field', p.job.field ?? ''], ['Rig / Site', p.job.rig ?? ''], ['Date', p.job.date ?? ''], ['Job ref.', p.job.ticket_no ?? ''], ['Run', String(p.run_no)]];
  const hw = W / head.length;
  head.forEach(([k, v], i) => {
    const x = L + i * hw;
    doc.rect(x, y - 13, hw, 13, HEAD); doc.box(x, y - 27, hw, 27, 0.15);
    doc.text(x + 4, y - 9.5, k, { size: 7, bold: true, color: INK });
    doc.text(x + 4, y - 23, (wrap(v, hw - 8, 7.5)[0] ?? ''), { size: 7.5, color: INK });
  });
  y -= 33;

  // table
  const cols = rig
    ? [['No.', 18], ['Description', 108], ['Rating', 44], ['OD / ID', 34], ['Top conn.', 62], ['Bottom conn.', 62], ['Length', 44]] as [string, number][]
    : [['No.', 18], ['Description', 136], ['OD / ID', 38], ['F/N in', 34], ['Top conn.', 66], ['Bottom conn.', 66], ['Length', 46]] as [string, number][];
  const drawW = W - cols.reduce((a, [, w]) => a + w, 0);
  const all = [...cols, ['Assembly', drawW] as [string, number]];
  const xs = all.reduce<number[]>((a, _, i) => [...a, i ? a[i - 1] + all[i - 1][1] : L], []);
  doc.rect(L, y - 18, W, 18, HEAD);
  all.forEach(([h], i) => doc.text(xs[i] + 3, y - 12, h, { size: 7, bold: true, color: INK }));
  doc.box(L, y - 18, W, 18, 0.15);
  y -= 18;

  const footer = 92, avail = y - L - 24 - footer;
  const rowH = Math.max(16, Math.min(60, avail / Math.max(p.rows.length, 1)));
  const cell = (i: number, top: number, lines: string[], o: { bold?: boolean; color?: RGB } = {}) => {
    const size = rowH < 22 ? 6.2 : 7, lead = size * 1.2, shown = lines.slice(0, Math.max(1, Math.floor((rowH - 4) / lead)));
    const start = top - rowH / 2 + (shown.length * lead) / 2 - size;
    shown.forEach((l, k) => doc.text(xs[i] + 3, start - k * lead, l, { size, bold: o.bold, color: o.color ?? INK }));
  };
  const conn = (c: string | null, w: number) => { if (!c) return ['']; const mm = /^(.*?)\s*(\(.+\).*)$/.exec(c); return mm ? [mm[1], mm[2]] : wrap(c, w - 6, 6.5); };
  const tableTop = y;
  p.rows.forEach((r, i) => {
    const top = y;
    doc.line(L, top - rowH, xs[7], top - rowH, 0.75);
    cell(0, top, [String(i + 1)]);
    cell(1, top, wrap(r.name, cols[1][1] - 6, 7, true), { bold: true });
    if (rig) { cell(2, top, [r.rating_psi ? `${r.rating_psi / 1000}K${r.service === 'h2s' ? ' H2S' : ''}` : '']); cell(3, top, [...(r.od_in != null ? [`OD ${r.od_in}`] : []), `ID ${r.id_in ?? 'N/A'}`]); }
    else { cell(2, top, [r.od_in != null ? r.od_in.toFixed(3) : '', ...(r.id_in != null ? [`ID ${r.id_in.toFixed(3)}`] : [])]); cell(3, top, [r.fn_in != null ? r.fn_in.toFixed(3) : '']); }
    cell(4, top, conn(r.top_conn, cols[4][1])); cell(5, top, conn(r.bottom_conn, cols[5][1]));
    cell(6, top, [ft(r.length_ft), m(r.length_ft), ...(r.stroke_ft ? [`stroke +${r.stroke_ft.toFixed(2)}`] : [])]);
    y -= rowH;
  });
  // the assembly: one drawing at one scale down the whole column, fitted inside it (same layout as the screen)
  if (p.rows.length) {
    const pad = 6, boxH = tableTop - y - 2 * pad;
    const st = layoutStack(p.rows, family, drawW - 4, boxH);
    const ox = xs[7] + 2, oy = tableTop - pad - (boxH - st.height) / 2;
    const X = (x: number) => ox + x, Y = (yy: number) => oy - yy;
    for (const g of st.prims) {
      if (g.t === 'rect') { if (g.fill) doc.rect(X(g.x), Y(g.y + g.h), g.w, g.h, rgb(g.fill)); if (g.outline) doc.box(X(g.x), Y(g.y + g.h), g.w, g.h, 0.23, 0.4); }
      else if (g.t === 'poly') doc.poly(g.pts.map(([px, py]) => [X(px), Y(py)]), rgb(g.fill));
      else if (g.t === 'circle') doc.circle(X(g.cx), Y(g.cy), g.r, g.fill ? rgb(g.fill) : null, rgb(g.stroke));
      else if (g.t === 'image') doc.jpeg(picture(g.key), X(g.x), Y(g.y + g.h), g.w, g.h);
      else if (g.t === 'text') doc.text(X(g.x) - textWidth(g.s, g.size, true) / 2, Y(g.y) - g.size * 0.35, g.s, { size: g.size, bold: true, color: INK });
      else doc.stroke(X(g.x1), Y(g.y1), X(g.x2), Y(g.y2), rgb(g.stroke), g.width);
    }
  }
  if (!p.rows.length) { doc.text(L + 8, y - 20, 'No parts', { size: 9, color: GREY }); y -= 40; }
  // column rules and frame
  xs.forEach((x, i) => i && doc.line(x, tableTop, x, y, i === 7 ? 0.15 : 0.75));
  doc.box(L, y, W, tableTop - y, 0.15, 1);

  // totals
  const t = rig ? rigTotals(p.rows) : null, s = rig ? null : stringTotals(p.rows);
  doc.rect(L, y - 30, W, 30, [0.96, 0.97, 0.94]);
  doc.box(L, y - 30, W, 30, 0.15, 1);
  const label = rig
    ? `Total length above the tree · lubricator ${ft(t!.lubricator_ft)} · smallest bore ${t!.min_id_in ?? '-'} in · system WP ${t!.system_wp?.toLocaleString('en-US') ?? '-'} psi`
    : `Total length (jars open) · closed ${ft(s!.length_ft)} · max OD ${s!.max_od_in?.toFixed(3) ?? '-'} in · weight ${s!.weight_lb ?? '-'} lb`
      + (p.totalDepth && (p.totalDepth.md != null || p.totalDepth.tvd != null) ? ` · total depth MD ${p.totalDepth.md ?? '-'} ft, TVD ${p.totalDepth.tvd ?? '-'} ft` : '');
  doc.text(L + 6, y - 18, wrap(label, xs[6] - L - 10, 7.5)[0], { size: 7.5, bold: true, color: INK });
  const total = rig ? t!.length_ft : s!.length_open_ft;
  doc.text(xs[6] + 3, y - 12, ft(total), { size: 8, bold: true, color: INK });
  doc.text(xs[6] + 3, y - 24, m(total), { size: 8, color: GREY });
  y -= 36;

  // sign-off
  const boxes: [string, string, string][] = [
    ['Prepared by', p.prepared?.by ?? '', p.prepared ? stampText(p.prepared.at) : ''],
    ['Reviewed by (SDM)', p.reviewed?.by ?? 'Not reviewed', p.reviewed ? stampText(p.reviewed.at) : ''],
    ['Form', `${form.code} Rev ${p.rev}`, rig ? 'One per job' : `Run ${p.run_no}`],
  ];
  const bw = W / boxes.length;
  boxes.forEach(([k, v, sub], i) => {
    const x = L + i * bw;
    doc.rect(x, y - 13, bw, 13, HEAD); doc.box(x, y - 42, bw, 42, 0.15);
    doc.text(x + 5, y - 9.5, k, { size: 7, bold: true, color: INK });
    doc.text(x + 5, y - 25, v, { size: 8.5, bold: !!p.reviewed || i !== 1, color: i === 1 && !p.reviewed ? GREY : INK });
    doc.text(x + 5, y - 36, sub, { size: 7, color: GREY });
  });
  doc.y = y - 50;
  return doc.bytes(`${form.code} Rev ${p.rev} · ${p.job.well ?? ''} · ticket ${p.job.ticket_no ?? '-'} · generated by SLK Operations Hub`);
}
