import { dur, fmt, hms, type Sample } from '../../../shared/winchData';
import { LINE_LABEL } from '../../../shared/winchGuide';
import { scorecard } from '../../../shared/winchScore';
import { api } from '../../api';
import type { RunReport, WinchPayload } from './Report';
import { mainIssue, ruleRows } from './ruleRows';

// The winch report as a PDF. 6z.43: the scorecard, then each run with its plot, flags and jarring; Print and Save both
// make one and keep it, named with the time it was made, so every version stays. 6z.47: laid out like the owner's
// Winch Benchmark template: a green heading band with the logo on every page, the summary (prepared by, crew, a row
// per run with its main issue, the scorecard), then each run with its plot, the result by rule, the jarring cycles
// and every violation, and the same footer on every page. pdf-lib is loaded only when a report is made.

type Rgb = ReturnType<typeof import('pdf-lib').rgb>;

/** Standard PDF fonts only know WinAnsi: anything else is swapped or dropped. */
const WIN = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const clean = (s: unknown) => String(s ?? '').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/→/g, '->').replace(/✓/g, 'ok').replace(/−/g, '-').replace(/×/g, 'x')
  .split('').filter((c) => c.charCodeAt(0) < 256 || WIN.has(c)).join('');
const pad = (n: number) => String(n).padStart(2, '0');
/** Recording time with its date (recordings carry wall-clock time as UTC seconds). */
const when = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
const stampOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
const clock = (d: Date) => stampOf(d).replace(/(\d\d)(\d\d)$/, '$1:$2');

/** The file a run came from: the one whose time span holds its start. */
const fileOf = (p: WinchPayload, r: RunReport) => p.files?.find((f) => r.run.t0 >= f.t0 - 60 && r.run.t0 <= f.t1 + 60)?.name ?? p.fileName;

export async function buildReportPdf(p: WinchPayload, made: Date, by: string, mode: 'print' | 'save'): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const m = p.meta;
  const title = 'Winch Report';
  const ident = [m.drss && `DRSS ${m.drss}`, m.well, m.unit && `Unit ${m.unit}`, m.cable && `Line ${m.cable}`].filter(Boolean).join('  |  ') || 'Winch data';
  doc.setTitle(clean(`${title} ${m.well || ''} ${m.drss || ''}`.trim()));
  doc.setAuthor(clean(by)); doc.setCreator('SLK Operations Hub');
  // the template's colours: dark green band, light green rule, pale green rows
  const band = rgb(0.22, 0.34, 0.14), rule = rgb(0.66, 0.82, 0.55), zebra = rgb(0.95, 0.97, 0.94), border = rgb(0.8, 0.84, 0.78);
  const ink = rgb(0, 0, 0), grey = rgb(0.314, 0.353, 0.412), muted = rgb(0.431, 0.463, 0.51), red = rgb(0.784, 0.157, 0.157), green = rgb(0.2, 0.5, 0.2), white = rgb(1, 1, 1);
  const C = { depth: rgb(0.53, 0.56, 0.62), speed: rgb(0.24, 0.45, 0.8), ten: rgb(0.16, 0.6, 0.36), flag: rgb(0.86, 0.2, 0.2), jar: rgb(0.5, 0.3, 0.75), grid: rgb(0.9, 0.91, 0.92) };
  let logo: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  try { logo = await doc.embedPng(await (await fetch('/brand/nesr-white-320.png')).arrayBuffer()); } catch { /* no logo: the band still prints */ }

  const W = 841.89, H = 595.28, M = 34;
  let page = doc.addPage([W, H]);
  const pages: typeof page[] = [];
  let y = 0;
  const text = (s: unknown, x: number, yy: number, o: { size?: number; f?: typeof font; color?: Rgb; maxW?: number; right?: boolean } = {}) => {
    const size = o.size ?? 8, f = o.f ?? font;
    let t = clean(s);
    if (o.maxW) while (t.length > 1 && f.widthOfTextAtSize(t, size) > o.maxW) t = t.slice(0, -2) + '…';
    page.drawText(t, { x: o.right ? x - f.widthOfTextAtSize(t, size) : x, y: yy, size, font: f, color: o.color ?? ink });
  };
  /** Words wrapped to a width, for long requirements and details. */
  const wrapText = (s: unknown, size: number, maxW: number, f = font) => {
    const words = clean(s).split(/\s+/), out: string[] = [];
    let cur = '';
    for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (f.widthOfTextAtSize(t, size) > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  };
  /** A new page with the green band: the heading on the right, the line under it. */
  const newPage = (head: string, sub: string) => {
    page = pages.length ? doc.addPage([W, H]) : page;
    pages.push(page);
    page.drawRectangle({ x: 0, y: H - 62.4, width: W, height: 62.4, color: band });
    page.drawRectangle({ x: 0, y: H - 65.8, width: W, height: 3.4, color: rule });
    // the logo fits the band, centred in its height
    if (logo) { const lh = 46, lw = lh * (logo.width / logo.height); page.drawImage(logo, { x: M, y: H - 31.2 - lh / 2, width: lw, height: lh }); }
    text(head, W - M, H - 28, { size: 14, f: bold, color: white, right: true, maxW: W - 200 });
    text(sub, W - M, H - 45, { size: 8.5, color: white, right: true, maxW: W - 200 });
    y = H - 85;
  };
  const need = (h: number, head: () => void) => { if (y - h < M + 18) head(); };
  /** A table with a green heading row, pale rows in turn, wrapped cells; the heading repeats on a new page. */
  const table = (cols: { w: number; label: string; right?: boolean }[], rows: { cells: unknown[]; color?: (Rgb | undefined)[]; bold?: boolean }[], cont: () => void) => {
    const size = 7.5, lh = 9;
    const tw = cols.reduce((t, c) => t + c.w, 0);
    const head = () => {
      let x = M;
      for (const c of cols) {
        page.drawRectangle({ x, y: y - 16, width: c.w, height: 16, color: band, borderColor: border, borderWidth: 0.28 });
        const lines = wrapText(c.label, size, c.w - 8, bold);
        text(lines[0], c.right ? x + c.w - 4 : x + 4, y - 11, { size, f: bold, color: white, right: c.right, maxW: c.w - 8 });
        x += c.w;
      }
      y -= 16;
    };
    need(36, cont); head();
    rows.forEach((r, i) => {
      const cellLines = r.cells.map((cell, k) => wrapText(cell, size, cols[k].w - 8, r.bold ? bold : font));
      const h = Math.max(...cellLines.map((l) => l.length)) * lh + 6;
      if (y - h < M + 18) { cont(); head(); }
      let x = M;
      page.drawRectangle({ x: M, y: y - h, width: tw, height: h, color: i % 2 ? zebra : white, borderColor: border, borderWidth: 0.28 });
      cellLines.forEach((lines, k) => {
        const c = cols[k];
        lines.forEach((ln, j) => text(ln, c.right ? x + c.w - 4 : x + 4, y - 9 - j * lh, { size, f: r.bold ? bold : font, color: r.color?.[k], right: c.right }));
        x += c.w;
      });
      y -= h;
    });
    y -= 8;
  };
  const section = (s: string, cont: () => void) => { need(30, cont); text(s, M, y - 10, { size: 10, f: bold }); y -= 18; };

  // ---- page 1: the summary
  const sc = scorecard(p.reports);
  const rules = p.reports.map((r) => ruleRows(r, p.kind, p.restrictions));
  const summaryHead = () => newPage(`${title} - Analysis Summary`, ident);
  summaryHead();
  text(`${mode === 'print' ? 'Printed' : 'Prepared'} ${clock(made)} by ${by}  |  ${p.reports.length} run${p.reports.length === 1 ? '' : 's'}  |  ${LINE_LABEL[p.kind]}${p.kind === 'braided' ? (p.seasoned ? ', seasoned line' : ', new line (seasoning)') : ''}${m.date ? `  |  Job date ${m.date}` : ''}${m.field ? `  |  ${m.field}` : ''}`, M, y, { size: 9, color: grey, maxW: W - 2 * M });
  y -= 17;
  if (m.crew) {
    text('Crew', M, y, { size: 9, f: bold });
    wrapText(m.crew, 9, W - 2 * M - 40).forEach((ln, i) => text(ln, M + 40, y - i * 10.35, { size: 9 }));
    y -= 10.35 * wrapText(m.crew, 9, W - 2 * M - 40).length + 8;
  }
  y -= 4;
  const sumCols = [{ w: 44, label: 'Run' }, { w: 150, label: 'File' }, { w: 112, label: p.kind === 'wire' ? 'Service' : 'Line' }, { w: 62, label: 'Max depth (ft)', right: true }, { w: 66, label: 'Max tension (lbs)', right: true },
    { w: 70, label: 'RIH / POOH avg (fpm)', right: true }, { w: 50, label: 'Violations', right: true }, { w: 44, label: 'Jarring', right: true }, { w: 38, label: 'Kept', right: true }, { w: W - 2 * M - 636, label: 'Main issue' }];
  table(sumCols, [
    ...sc.rows.map((r, i) => {
      const x = p.reports[i];
      const viol = r.speedFlags + r.tensionFlags + r.jarFlags;
      return {
        cells: [`Run ${x.run.n}`, fileOf(p, x), p.kind === 'wire' ? `${x.service || 'not set'}${x.isDefault ? ' (default speeds)' : ''}` : (p.seasoned ? 'Seasoned' : 'New line'), fmt(r.maxD), fmt(r.maxT), `${fmt(x.a.kpi.avgRih)} / ${fmt(x.a.kpi.avgPooh)}`, viol, r.jarCycles ? `${r.jarCycles} cycles` : '-', `${fmt(r.keptPct, 0)}%`, mainIssue(rules[i]) ?? 'None'],
        color: [undefined, undefined, x.isDefault ? red : undefined, undefined, undefined, undefined, viol ? red : green, undefined, undefined, viol ? red : green],
      };
    }),
    { cells: ['Total', '', '', fmt(sc.total.maxD), fmt(sc.total.maxT), `${fmt(sc.total.avgRih)} / ${fmt(sc.total.avgPooh)}`, sc.total.total, sc.total.jarCycles ? `${sc.total.jarCycles} cycles` : '-', `${fmt(sc.total.keptPct, 0)}%`, ''], bold: true },
  ], summaryHead);
  // the scorecard, in the template's colours
  section('Scorecard', summaryHead);
  const tiles: [string, string, boolean][] = [
    [String(sc.total.total), 'Flags in all', sc.total.total > 0], [String(sc.total.speedFlags), 'Speed flags', sc.total.speedFlags > 0], [String(sc.total.tensionFlags), 'Tension flags', sc.total.tensionFlags > 0],
    [String(sc.total.jarFlags), 'Jarring flags', sc.total.jarFlags > 0], [String(sc.total.jarCycles), 'Jarring cycles', false], [`${fmt(sc.total.keptPct, 1)}%`, 'Moving time inside the limits', sc.total.keptPct < 100],
    [`${fmt(sc.total.maxRih)} / ${fmt(sc.total.maxPooh)}`, 'Top RIH / POOH, ft/min', false], [fmt(sc.total.maxT), 'Top tension, lbs', false],
  ];
  need(48, summaryHead);
  const tw = (W - 2 * M - 7 * 6) / 8;
  tiles.forEach(([v, l, bad], i) => {
    const x = M + i * (tw + 6);
    page.drawRectangle({ x, y: y - 40, width: tw, height: 40, color: zebra, borderColor: border, borderWidth: 0.5 });
    text(v, x + 6, y - 18, { size: 13, f: bold, color: bad ? red : green, maxW: tw - 10 });
    text(l, x + 6, y - 32, { size: 6.5, color: muted, maxW: tw - 10 });
  });
  y -= 52;
  if (sc.byRule.length) {
    section('Flags by rule', summaryHead);
    table([{ w: 300, label: 'Rule' }, { w: 200, label: 'From' }, { w: 60, label: 'Count', right: true }], sc.byRule.map((r) => ({ cells: [r.label, r.source, r.count] })), summaryHead);
  }
  need(24, summaryHead);
  const detect = p.reports[0]?.sop.detect;
  if (detect) {
    wrapText(`A speed flag counts when it lasts ${detect.minSec} s or more, a tension flag ${detect.tensionSec} s or more; flags less than ${detect.mergeSec} s apart are one. Jarring is found from the tension while the tools are held in one place. Kept: the share of moving time with no speed or tension flag open.${sc.total.defaultSpeeds ? ' Default speeds were used on a run whose service is not in the Speed Guidelines: confirm its plan and speeds with the Service Manager in the JRA.' : ''}`, 7.5, W - 2 * M, italic)
      .forEach((ln, i) => text(ln, M, y - 8 - i * 9, { size: 7.5, f: italic, color: grey }));
  }

  // ---- each run
  p.reports.forEach((r, i) => runPages(r, i));

  function runPages(r: RunReport, idx: number) {
    const k = r.a.kpi;
    const head = () => newPage(`Run ${r.run.n} - ${fileOf(p, r)}`, `${ident}  |  max depth ${fmt(r.run.maxD)} ft  |  RIH ${dur(k.rihSec)}  bottom ${dur(k.bottomSec)}  POOH ${dur(k.poohSec)}`);
    head();
    text(`${when(r.run.t0)} to ${when(r.run.t1)}${r.run.partial ? ' (partial run)' : ''}  |  ${p.kind === 'wire' ? `Service: ${r.service || 'not set'}, ${r.isDefault ? 'default speeds (not in the Speed Guidelines)' : `speeds: ${r.group}`}, RIH ${fmt(r.sop.maxRih)} / POOH ${fmt(r.sop.maxPooh)} ft/min` : `${p.seasoned ? 'Seasoned line' : 'New line (seasoning)'}`}  |  avg RIH ${fmt(k.avgRih)}, POOH ${fmt(k.avgPooh)} ft/min  |  top tension ${fmt(k.maxT)} lbs`,
      M, y, { size: 8.5, color: r.isDefault ? red : grey, maxW: W - 2 * M });
    y -= 14;
    // the plot: depth, speed and tension against time, each with its own scale, flags and jarring shaded
    const s = r.a.S;
    const ch = { x: M + 42, w: W - 2 * M - 130, h: 200 };
    text(`${m.well || 'Well'} · Run ${r.run.n}${m.unit ? ` · ${m.unit}` : ''}`, M, y - 10, { size: 10, f: bold });
    const keys: [string, Rgb, boolean][] = [['Depth', C.depth, false], ['Speed', C.speed, false], ['Tension', C.ten, false], ['Speed or tension flag', C.flag, true], ['Jarring', C.jar, true]];
    let kx = M + 170;
    for (const [l, c, isBand] of keys) {
      if (isBand) page.drawRectangle({ x: kx, y: y - 11, width: 12, height: 7, color: c, opacity: 0.25 });
      else page.drawLine({ start: { x: kx, y: y - 7.5 }, end: { x: kx + 14, y: y - 7.5 }, thickness: 1.6, color: c });
      text(l, kx + 18, y - 10, { size: 7.5 }); kx += 26 + font.widthOfTextAtSize(l, 7.5) + 10;
    }
    const top = y - 30;
    const t0 = s[0].t, t1 = s[s.length - 1].t, span = t1 - t0 || 1;
    const X = (t: number) => ((t - t0) / span) * ch.w;
    const dMax = Math.max(1, ...s.map((q) => q.depth)) * 1.05, sMax = Math.max(50, ...s.map((q) => q.sp)) * 1.1, tMax = Math.max(1, ...s.map((q) => q.ten)) * 1.1;
    for (let g = 0; g <= 4; g++) page.drawLine({ start: { x: ch.x, y: top - ch.h + (g / 4) * ch.h }, end: { x: ch.x + ch.w, y: top - ch.h + (g / 4) * ch.h }, thickness: 0.4, color: C.grid });
    const shade = (a: number, b: number, color: Rgb) => page.drawRectangle({ x: ch.x + X(a), y: top - ch.h, width: Math.max(0.8, X(b) - X(a)), height: ch.h, color, opacity: 0.2 });
    for (const f of [...r.speed, ...r.a.viol]) shade(f.t0, f.t1, C.flag);
    for (const c of r.jar.cycles) shade(c.t0, c.t1, C.jar);
    const path = (val: (q: Sample) => number, vmax: number) => {
      const per = Math.max(1, Math.floor(s.length / (ch.w * 1.5)));
      let d = '';
      for (let b = 0; b < s.length; b += per) {
        let lo = b, hi = b;
        for (let j = b; j < Math.min(s.length, b + per); j++) { if (val(s[j]) < val(s[lo])) lo = j; if (val(s[j]) > val(s[hi])) hi = j; }
        for (const j of lo < hi ? [lo, hi] : [hi, lo]) d += `${d ? 'L' : 'M'}${X(s[j].t).toFixed(1)},${(ch.h - (val(s[j]) / vmax) * ch.h).toFixed(1)}`;
      }
      return d;
    };
    for (const [v, vmax, color, wdt] of [[(q: Sample) => q.depth, dMax, C.depth, 1.4], [(q: Sample) => q.sp, sMax, C.speed, 0.7], [(q: Sample) => q.ten, tMax, C.ten, 0.7]] as const) {
      page.drawSvgPath(path(v, vmax), { x: ch.x, y: top, borderColor: color, borderWidth: wdt });
    }
    page.drawLine({ start: { x: ch.x, y: top - ch.h }, end: { x: ch.x, y: top }, thickness: 0.6, color: C.depth });
    page.drawLine({ start: { x: ch.x + ch.w, y: top - ch.h }, end: { x: ch.x + ch.w, y: top }, thickness: 0.6, color: C.speed });
    page.drawLine({ start: { x: ch.x + ch.w + 44, y: top - ch.h }, end: { x: ch.x + ch.w + 44, y: top }, thickness: 0.6, color: C.ten });
    for (let g = 0; g <= 4; g++) {
      const yy = top - ch.h + (g / 4) * ch.h - 3;
      text(fmt(dMax * (g / 4)), ch.x - 4, yy, { size: 6.5, color: C.depth, right: true });
      text(fmt(sMax * (g / 4)), ch.x + ch.w + 4, yy, { size: 6.5, color: C.speed });
      text(fmt(tMax * (g / 4)), ch.x + ch.w + 48, yy, { size: 6.5, color: C.ten });
    }
    text('Depth (ft)', M - 2, top + 4, { size: 6.5, color: C.depth });
    text('Speed (fpm)', ch.x + ch.w + 2, top + 4, { size: 6.5, color: C.speed });
    text('Tension (lbs)', ch.x + ch.w + 44, top + 4, { size: 6.5, color: C.ten });
    for (let g = 0; g <= 6; g++) text(hms(t0 + (span * g) / 6).slice(0, 5), ch.x + (ch.w * g) / 6 - 9, top - ch.h - 10, { size: 6.5, color: muted });
    y = top - ch.h - 22;

    // the result by rule
    section('Result by rule', head);
    table([{ w: 90, label: 'Result' }, { w: 230, label: 'Rule' }, { w: 120, label: 'From' }, { w: W - 2 * M - 440, label: 'Requirement' }],
      rules[idx].map((x) => ({ cells: [x.count ? `${x.count} violation${x.count > 1 ? 's' : ''}` : x.off ? 'Not checked' : 'Pass', x.label, x.source, x.requirement], color: [x.count ? red : x.off ? muted : green] })), head);

    // jarring cycles
    if (r.jar.cycles.length) {
      section(`Jarring cycles (${r.jar.cycles.length})`, head);
      table([{ w: 48, label: 'Cycle' }, { w: 70, label: 'From' }, { w: 70, label: 'To' }, { w: 60, label: 'Lasted' }, { w: 70, label: 'Depth (ft)', right: true }, { w: 80, label: 'Jars up / down', right: true },
        { w: 90, label: 'Normal tension', right: true }, { w: 80, label: 'Peak', right: true }, { w: 80, label: 'Lowest', right: true }, { w: W - 2 * M - 648, label: 'Rest before', right: true }],
      r.jar.cycles.map((c) => ({ cells: [c.n, hms(c.t0), hms(c.t1), dur(c.t1 - c.t0), fmt(c.depth), `${c.up} / ${c.down}`, `${fmt(c.normal)} lbs`, `${fmt(c.peak)} lbs`, `${fmt(c.low)} lbs`, c.restBefore === null ? '-' : dur(c.restBefore)] })), head);
    }

    // every violation, with the tension at its start
    const tenAt = (t: number) => { let lo = 0, hi = s.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (s[mid].t < t) lo = mid + 1; else hi = mid; } return s[lo]?.ten ?? NaN; };
    const flags = [
      ...r.speed.map((f) => ({ t0: f.t0, sec: f.sec, d0: f.d0, d1: f.d1, dir: f.dir, label: f.label, detail: f.note, worst: `${fmt(f.worst)} ${f.unit} vs limit ${fmt(f.limit)}` })),
      ...r.jar.findings.map((f) => ({ t0: f.t0, sec: f.sec, d0: f.d0, d1: f.d1, dir: f.dir, label: f.label, detail: f.note, worst: `${fmt(f.worst, f.unit === 'min' ? 1 : 0)} ${f.unit} vs limit ${fmt(f.limit, f.unit === 'min' ? 1 : 0)}` })),
      ...r.a.viol.map((v) => ({ t0: v.t0, sec: v.sec, d0: v.d0, d1: v.d1, dir: v.dir, label: v.label, detail: '', worst: `${fmt(v.worst)} ${v.unit} vs limit ${fmt(v.limit)}` })),
    ].sort((a, b) => a.t0 - b.t0);
    section(`Violations (${flags.length})`, head);
    if (flags.length) {
      table([{ w: 52, label: 'Time' }, { w: 48, label: 'Lasted' }, { w: 76, label: 'Depth (ft)' }, { w: 58, label: 'Tension (lbs)', right: true }, { w: 64, label: 'Where' }, { w: 170, label: 'Rule' }, { w: W - 2 * M - 588, label: 'Detail' }, { w: 120, label: 'Worst vs limit' }],
        flags.map((f) => ({ cells: [hms(f.t0), f.sec ? dur(f.sec) : '-', f.d0 === f.d1 ? fmt(f.d0) : `${fmt(f.d0)} - ${fmt(f.d1)}`, fmt(tenAt(f.t0)), `Run | ${f.dir === 'STOP' ? 'held' : f.dir}`, f.label, f.detail, f.worst] })), head);
    } else { need(16, head); text('Nothing broken on this run.', M, y - 8, { size: 8.5, color: green }); y -= 18; }
  }

  // the template's footer on every page
  const foot = clean(`NESR Slickline - SLK Operations Hub  |  ${title} - ${m.well || '-'}${m.drss ? ` - DRSS ${m.drss}` : ''}  |  Generated ${clock(made)}`);
  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: M, y: 26 }, end: { x: W - M, y: 26 }, thickness: 0.4, color: border });
    pg.drawText(foot, { x: M, y: 15, size: 7, font, color: muted });
    const pn = `Page ${i + 1} of ${pages.length}`;
    pg.drawText(pn, { x: W - M - font.widthOfTextAtSize(pn, 7), y: 15, size: 7, font, color: muted });
  });
  return doc.save();
}

export interface SavedReport { id: string; name: string }

/** Makes the PDF and keeps it where the payload says (the job's attachments or a Utilities project), named with the time. */
export async function saveReport(p: WinchPayload, by: string, mode: 'print' | 'save'): Promise<{ saved: SavedReport; bytes: Uint8Array }> {
  const target = p.reportUpload ?? (p.jobId ? `/attachments/job/${encodeURIComponent(p.jobId)}` : null);
  if (!target) throw new Error('Save the project first to keep the report.');
  const made = new Date();
  const bytes = await buildReportPdf(p, made, by, mode);
  const name = `Winch report ${(p.meta.drss || p.meta.well || 'job').replace(/[\\/:*?"<>|]+/g, '-')} ${stampOf(made)} ${mode === 'print' ? 'printed' : 'saved'}.pdf`;
  const saved = await api<SavedReport>(`${target}?category=report&note=${encodeURIComponent(`Winch data analysis, ${mode === 'print' ? 'printed' : 'saved'}`)}`, {
    method: 'POST', headers: { 'X-File-Name': encodeURIComponent(name) }, body: bytes as unknown as BodyInit,
  });
  return { saved, bytes };
}
