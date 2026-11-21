import { dur, fmt, hms, type Sample } from '../../../shared/winchData';
import { LINE_LABEL } from '../../../shared/winchGuide';
import { scorecard } from '../../../shared/winchScore';
import { api } from '../../api';
import type { RunReport, WinchPayload } from './Report';

// The winch analysis as a PDF (6z.43): the scorecard, then each run with its plot, flags and jarring. Print and Save
// both make one and keep it with the job's attachments, named with the time it was made, so every version stays.
// pdf-lib is loaded only when a report is made.

type Rgb = ReturnType<typeof import('pdf-lib').rgb>;

/** Standard PDF fonts only know WinAnsi: anything else is swapped or dropped. */
const WIN = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const clean = (s: unknown) => String(s ?? '').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/→/g, '->').replace(/✓/g, 'ok').replace(/−/g, '-').replace(/×/g, 'x')
  .split('').filter((c) => c.charCodeAt(0) < 256 || WIN.has(c)).join('');
const pad = (n: number) => String(n).padStart(2, '0');
/** Recording time with its date (recordings carry wall-clock time as UTC seconds). */
const when = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
const stampOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;

export async function buildReportPdf(p: WinchPayload, made: Date, by: string, mode: 'print' | 'save'): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(clean(`Winch data analysis ${p.meta.job || ''}`.trim()));
  doc.setAuthor(clean(by)); doc.setCreator('SLK Operations Hub');
  const W = 842, H = 595, M = 32;
  const ink = rgb(0.1, 0.12, 0.14), muted = rgb(0.42, 0.45, 0.5), line = rgb(0.82, 0.84, 0.87), red = rgb(0.8, 0.15, 0.15), green = rgb(0.1, 0.55, 0.3);
  const C = { depth: rgb(0.45, 0.47, 0.5), speed: rgb(0.15, 0.45, 0.85), ten: rgb(0.12, 0.6, 0.35), band: rgb(0.85, 0.2, 0.2), jar: rgb(0.5, 0.3, 0.75) };
  let page = doc.addPage([W, H]);
  let y = H - M;
  const pages: typeof page[] = [page];
  const text = (s: unknown, x: number, yy: number, o: { size?: number; b?: boolean; color?: Rgb; maxW?: number } = {}) => {
    const size = o.size ?? 8, f = o.b ? bold : font;
    let t = clean(s);
    if (o.maxW) while (t.length > 1 && f.widthOfTextAtSize(t, size) > o.maxW) t = t.slice(0, -2) + '…';
    page.drawText(t, { x, y: yy, size, font: f, color: o.color ?? ink });
  };
  const newPage = () => { page = doc.addPage([W, H]); pages.push(page); y = H - M; };
  const need = (h: number) => { if (y - h < M + 14) newPage(); };
  const heading = (s: string, size = 12) => { need(size + 10); text(s, M, y - size, { size, b: true }); y -= size + 8; };
  /** A table: column widths and labels, rows of cells; the header repeats on a new page. */
  const table = (cols: { w: number; label: string; right?: boolean }[], rows: { cells: unknown[]; bold?: boolean; color?: Rgb }[]) => {
    const rh = 12;
    const head = () => {
      let x = M;
      for (const c of cols) { text(c.label.toUpperCase(), c.right ? x + c.w - 4 - font.widthOfTextAtSize(clean(c.label.toUpperCase()), 6.5) : x, y - 8, { size: 6.5, color: muted }); x += c.w; }
      page.drawLine({ start: { x: M, y: y - 11 }, end: { x: W - M, y: y - 11 }, thickness: 0.5, color: line });
      y -= rh + 2;
    };
    need(rh * 2 + 4); head();
    for (const r of rows) {
      if (y - rh < M + 14) { newPage(); head(); }
      let x = M;
      r.cells.forEach((cell, i) => {
        const c = cols[i];
        const s = clean(cell), f = r.bold ? bold : font;
        const tx = c.right ? x + c.w - 4 - Math.min(c.w - 4, f.widthOfTextAtSize(s, 7.5)) : x;
        text(s, tx, y - 8, { size: 7.5, b: r.bold, color: r.color, maxW: c.w - 4 });
        x += c.w;
      });
      page.drawLine({ start: { x: M, y: y - 11 }, end: { x: W - M, y: y - 11 }, thickness: 0.25, color: line });
      y -= rh;
    }
    y -= 6;
  };

  // ---- page 1: heading and the scorecard
  const sc = scorecard(p.reports);
  text('NESR · SLK Operations Hub', M, y - 8, { size: 8, color: muted });
  text(mode === 'print' ? `Printed ${stampOf(made).replace(/(\d\d)(\d\d)$/, '$1:$2')} by ${by}` : `Saved ${stampOf(made).replace(/(\d\d)(\d\d)$/, '$1:$2')} by ${by}`, W - M - 200, y - 8, { size: 8, color: muted, maxW: 200 });
  y -= 26;
  text('Winch data analysis', M, y - 6, { size: 18, b: true }); y -= 24;
  const m = p.meta;
  text(`Well ${m.well || '-'} · Stage ${m.stage || '-'} · Unit ${m.unit || '-'} · ${m.job || ''}${m.date ? ` · ${m.date}` : ''}`, M, y - 10, { size: 10, b: true }); y -= 16;
  text(`${LINE_LABEL[p.kind]}${p.kind === 'braided' ? (p.seasoned ? ', seasoned line' : ', new line (seasoning)') : ''}${m.cable ? ` · line ${m.cable}` : ''} · ${p.fileName} · ${p.source}${m.by ? ` · checked by ${m.by}` : ''}`, M, y - 8, { size: 8, color: muted, maxW: W - 2 * M });
  y -= 22;
  heading('Scorecard');
  const tiles: [string, string, boolean][] = [
    [String(sc.total.total), 'Flags in all', sc.total.total > 0], [String(sc.total.speedFlags), 'Speed flags', sc.total.speedFlags > 0],
    [String(sc.total.tensionFlags), 'Tension flags', sc.total.tensionFlags > 0], [String(sc.total.jarFlags), 'Jarring flags', sc.total.jarFlags > 0],
    [String(sc.total.jarCycles), 'Jarring cycles', false], [`${fmt(sc.total.keptPct, 1)}%`, 'Moving time inside the limits', sc.total.keptPct < 100],
    [`${fmt(sc.total.maxRih)} / ${fmt(sc.total.maxPooh)}`, 'Top RIH / POOH, ft/min', false], [`${fmt(sc.total.maxT)}`, 'Top tension, lbs', false],
  ];
  const tw = (W - 2 * M - 7 * 6) / 8;
  tiles.forEach(([v, l, bad], i) => {
    const x = M + i * (tw + 6);
    page.drawRectangle({ x, y: y - 40, width: tw, height: 40, borderColor: line, borderWidth: 0.6 });
    text(v, x + 6, y - 18, { size: 13, b: true, color: bad ? red : green, maxW: tw - 10 });
    text(l, x + 6, y - 32, { size: 6.5, color: muted, maxW: tw - 10 });
  });
  y -= 52;
  const scoreCols = [{ w: 46, label: 'Run' }, { w: 150, label: p.kind === 'wire' ? 'Service' : 'Line' }, { w: 58, label: 'Max depth', right: true }, { w: 48, label: 'Hours', right: true },
    { w: 62, label: 'Top RIH', right: true }, { w: 62, label: 'Top POOH', right: true }, { w: 62, label: 'Top tension', right: true }, { w: 44, label: 'Speed', right: true },
    { w: 48, label: 'Tension', right: true }, { w: 52, label: 'Jar cycles', right: true }, { w: 50, label: 'Jar flags', right: true }, { w: 40, label: 'Total', right: true }, { w: 56, label: 'Kept', right: true }];
  const cells = (r: typeof sc.total, svc: string) => [r.label, svc, `${fmt(r.maxD)} ft`, fmt(r.hours, 1), fmt(r.maxRih), fmt(r.maxPooh), fmt(r.maxT), r.speedFlags, r.tensionFlags, r.jarCycles, r.jarFlags, r.total, `${fmt(r.keptPct, 1)}%`];
  table(scoreCols, [
    ...sc.rows.map((r) => ({ cells: cells(r, p.kind === 'wire' ? `${r.service || 'not set'}${r.defaultSpeeds ? ' (default speeds)' : ''}` : (p.seasoned ? 'Seasoned' : 'New line')), color: r.total ? red : undefined })),
    { cells: cells(sc.total, ''), bold: true },
  ]);
  if (sc.byRule.length) {
    heading('Flags by rule', 10);
    table([{ w: 260, label: 'Rule' }, { w: 200, label: 'From' }, { w: 60, label: 'Count', right: true }], sc.byRule.map((r) => ({ cells: [r.label, r.source, r.count] })));
  }
  if (sc.total.defaultSpeeds) { need(14); text('Default speeds were used on a run whose service is not in the Speed Guidelines: confirm its plan and speeds with the Service Manager in the JRA.', M, y - 8, { size: 8, color: red }); y -= 16; }

  // ---- each run
  for (const r of p.reports) runPages(r);

  function runPages(r: RunReport) {
    newPage();
    const s = r.a.S;
    heading(`Run ${r.run.n}${r.run.partial ? ' (partial)' : ''} · ${fmt(r.run.maxD)} ft · ${when(r.run.t0)} to ${when(r.run.t1)}`, 12);
    text(p.kind === 'wire' ? `Service: ${r.service || 'not set'} · ${r.isDefault ? 'default speeds (not in the Speed Guidelines)' : `speeds: ${r.group}`} · RIH ${fmt(r.sop.maxRih)} / POOH ${fmt(r.sop.maxPooh)} ft/min`
      : `${p.seasoned ? 'Seasoned line' : 'New line (seasoning)'} · ${r.a.R.name}`, M, y - 8, { size: 8, color: r.isDefault ? red : muted }); y -= 16;
    // the plot: depth, speed and tension against time, each on its own scale, with the flags shaded
    const ch = { x: M + 40, w: W - 2 * M - 110, h: 210 };
    const top = y - 6;
    const t0 = s[0].t, t1 = s[s.length - 1].t, span = t1 - t0 || 1;
    const X = (t: number) => ((t - t0) / span) * ch.w;
    const dMax = Math.max(1, ...s.map((q) => q.depth)) * 1.05, sMax = Math.max(50, ...s.map((q) => q.sp)) * 1.1, tMax = Math.max(1, ...s.map((q) => q.ten)) * 1.1;
    page.drawRectangle({ x: ch.x, y: top - ch.h, width: ch.w, height: ch.h, borderColor: line, borderWidth: 0.6 });
    const band = (a: number, b: number, color: Rgb) => page.drawRectangle({ x: ch.x + X(a), y: top - ch.h, width: Math.max(0.8, X(b) - X(a)), height: ch.h, color, opacity: 0.18 });
    for (const f of [...r.speed, ...r.a.viol]) band(f.t0, f.t1, C.band);
    for (const c of r.jar.cycles) band(c.t0, c.t1, C.jar);
    const path = (val: (q: Sample) => number, vmax: number) => {
      const per = Math.max(1, Math.floor(s.length / (ch.w * 1.5)));
      let d = '';
      for (let b = 0; b < s.length; b += per) {
        let lo = b, hi = b;
        for (let i = b; i < Math.min(s.length, b + per); i++) { if (val(s[i]) < val(s[lo])) lo = i; if (val(s[i]) > val(s[hi])) hi = i; }
        for (const i of lo < hi ? [lo, hi] : [hi, lo]) d += `${d ? 'L' : 'M'}${X(s[i].t).toFixed(1)},${(ch.h - (val(s[i]) / vmax) * ch.h).toFixed(1)}`;
      }
      return d;
    };
    for (const [v, vmax, color, w] of [[(q: Sample) => q.depth, dMax, C.depth, 1.1], [(q: Sample) => q.sp, sMax, C.speed, 0.6], [(q: Sample) => q.ten, tMax, C.ten, 0.6]] as const) {
      page.drawSvgPath(path(v, vmax), { x: ch.x, y: top, borderColor: color, borderWidth: w });
    }
    for (let k = 0; k <= 4; k++) {
      const yy = top - ch.h + (k / 4) * ch.h;
      text(fmt(dMax * (k / 4)), M, yy - 3, { size: 6, color: C.depth });
      text(fmt(sMax * (k / 4)), ch.x + ch.w + 4, yy - 3, { size: 6, color: C.speed });
      text(fmt(tMax * (k / 4)), ch.x + ch.w + 36, yy - 3, { size: 6, color: C.ten });
    }
    for (let k = 0; k <= 6; k++) text(hms(t0 + (span * k) / 6).slice(0, 5), ch.x + (ch.w * k) / 6 - 8, top - ch.h - 10, { size: 6, color: muted });
    y = top - ch.h - 16;
    text('Grey: depth (ft) · blue: speed (ft/min) · green: tension (lbs) · red bands: a guideline broken · purple: jarring', M, y - 6, { size: 7, color: muted }); y -= 16;
    const k = r.a.kpi;
    text(`RIH ${dur(k.rihSec)} · at bottom ${dur(k.bottomSec)} · POOH ${dur(k.poohSec)} · avg RIH ${fmt(k.avgRih)} ft/min · avg POOH ${fmt(k.avgPooh)} ft/min · top tension ${fmt(k.maxT)} lbs`, M, y - 6, { size: 8 }); y -= 16;
    const flags = [
      ...r.speed.map((f) => ({ t0: f.t0, sec: f.sec, d0: f.d0, d1: f.d1, label: f.label, source: f.source, worst: `${fmt(f.worst)} ${f.unit} vs ${f.side} ${fmt(f.limit)}`, note: f.note })),
      ...r.jar.findings.map((f) => ({ t0: f.t0, sec: f.sec, d0: f.d0, d1: f.d1, label: f.label, source: f.source, worst: `${fmt(f.worst, f.unit === 'min' ? 1 : 0)} ${f.unit} vs ${f.side} ${fmt(f.limit, f.unit === 'min' ? 1 : 0)}`, note: f.note })),
      ...r.a.viol.map((v) => ({ t0: v.t0, sec: v.sec, d0: v.d0, d1: v.d1, label: v.label, source: 'Seasoning rules', worst: `${fmt(v.worst)} ${v.unit} vs ${v.side} ${fmt(v.limit)}`, note: v.dir })),
    ].sort((a, b) => a.t0 - b.t0);
    heading(`Flags (${flags.length})`, 10);
    if (flags.length) {
      table([{ w: 52, label: 'Time' }, { w: 44, label: 'Lasted' }, { w: 80, label: 'Depth (ft)' }, { w: 170, label: 'Rule' }, { w: 100, label: 'From' }, { w: 130, label: 'Worst' }, { w: 202, label: 'Note' }],
        flags.map((f) => ({ cells: [hms(f.t0), dur(f.sec), f.d0 === f.d1 ? fmt(f.d0) : `${fmt(f.d0)} - ${fmt(f.d1)}`, f.label, f.source, f.worst, f.note] })));
    } else { text('Nothing broken on this run.', M, y - 8, { size: 8, color: green }); y -= 16; }
    heading(`Jarring cycles (${r.jar.cycles.length})`, 10);
    if (r.jar.cycles.length) {
      table([{ w: 40, label: 'Cycle' }, { w: 56, label: 'From' }, { w: 56, label: 'To' }, { w: 50, label: 'Lasted' }, { w: 60, label: 'Depth', right: true }, { w: 70, label: 'Up / down', right: true },
        { w: 80, label: 'Normal', right: true }, { w: 70, label: 'Peak', right: true }, { w: 70, label: 'Lowest', right: true }, { w: 70, label: 'Rest before', right: true }],
      r.jar.cycles.map((c) => ({ cells: [c.n, hms(c.t0), hms(c.t1), dur(c.t1 - c.t0), fmt(c.depth), `${c.up} / ${c.down}`, `${fmt(c.normal)} lbs`, `${fmt(c.peak)} lbs`, `${fmt(c.low)} lbs`, c.restBefore === null ? '-' : dur(c.restBefore)] })));
    } else { text('No jarring found on this run.', M, y - 8, { size: 8, color: muted }); y -= 16; }
  }

  pages.forEach((pg, i) => pg.drawText(clean(`Page ${i + 1} of ${pages.length} · Winch data analysis · ${m.job || ''}`), { x: M, y: 16, size: 7, font, color: muted }));
  return doc.save();
}

export interface SavedReport { id: string; name: string }

/** Makes the PDF and keeps it with the job's attachments, named with the time it was made. */
export async function saveReport(p: WinchPayload, by: string, mode: 'print' | 'save'): Promise<{ saved: SavedReport; bytes: Uint8Array }> {
  if (!p.jobId) throw new Error('Open this from a job to save the report.');
  const made = new Date();
  const bytes = await buildReportPdf(p, made, by, mode);
  const name = `Winch analysis ${(p.meta.job || p.meta.well || 'job').replace(/[\\/:*?"<>|]+/g, '-')} ${stampOf(made)} ${mode === 'print' ? 'printed' : 'saved'}.pdf`;
  const saved = await api<SavedReport>(`/attachments/job/${encodeURIComponent(p.jobId)}?category=report&note=${encodeURIComponent(`Winch data analysis, ${mode === 'print' ? 'printed' : 'saved'}`)}`, {
    method: 'POST', headers: { 'X-File-Name': encodeURIComponent(name) }, body: bytes as unknown as BodyInit,
  });
  return { saved, bytes };
}
