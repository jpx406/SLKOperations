import { JOB_STATUSES, dateShort, exportRows, hasSig, hours, wireFinalOf, type LogForm, type Sig } from '../../shared/jobLogForm';
import { escHtml } from '../../shared/html';
import { workbookSheets } from '../../shared/xlsx';

// The Job log's files (6z.51), made on the device so they also work with no signal: the PDF (pdf-lib, already in
// the app), Excel (the app's own writer), Word (HTML that Word opens as .doc, as Q-Incidents does) and an e-mail
// draft (.eml) with the three attached. 6z.52: laid out like the owner's NESR Slickline Service Report: the well and
// crew header, the operations record with From and To, the job status, wire details, the BHA of each run, the note,
// crew hours and the client and NESR representatives.

const TITLE = 'JOB LOG · SEQUENCE OF EVENTS';
const COLS = ['#', 'Date', 'From', 'To', 'Day', 'Run', 'Depth (ft)', 'Work description', 'Remarks'];
const WIRE_COLS = ['Type', 'Size', 'Initial length (ft)', 'Max. pull (lb)', 'Hrs in hole', 'Wire cut (ft)', 'Final length (ft)'];
const safe = (s: string) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').trim();
export const fileBase = (f: LogForm) => `JobLog_${safe(f.ticket) || 'ticket'}_${safe(f.well) || 'well'}`;
const pressure = (fl: string, si: string) => [fl && `FL: ${fl} psi`, si && `SI: ${si} psi`].filter(Boolean).join('   ');
/** The header as the report has it: the well on the left, the crew and equipment on the right. */
const headerLeft = (f: LogForm): [string, string][] => [
  ['WELL NUMBER', f.well], ['DATE', dateShort(f.date)], ['JOB TYPE', f.jobType], ['RIG / RIGLESS / SITE', f.rig], ['FIELD', f.field], ['CLIENT', f.customer],
  ['TICKET NO.', f.ticket], ['TUBING SIZE', f.tubingSize], ['TUBING PRESSURE', pressure(f.tubingFl, f.tubingSi)], ['CASING PRESSURE', pressure(f.casingFl, f.casingSi)],
  ['W/H CONNECTION', f.whConnection], ['WELL TYPE', f.wellType],
];
const headerRight = (f: LogForm): [string, string][] => [
  ['SLK SUPERVISOR', f.supervisor], ['SLK OPERATOR', f.operator1], ['SLK OPERATOR', f.operator2], ['SLK UNIT NUMBER', f.unit], ['PICK UP NUMBER', f.pickup],
  ['M. GAUGE S/N', f.gauge1], ['M. GAUGE S/N', f.gauge2], ['WELL STATUS ARRIVAL', pressure(f.arrFl, f.arrSi)], ['WELL STATUS DEPARTURE', pressure(f.depFl, f.depSi)],
  ['LOCATION CONDITION', f.locationCond], ['', ''], ['', ''],
];
const wireValues = (f: LogForm) => [f.wireType, f.wireSize, f.wireInitial, f.wireMaxPull, f.wireHrs, f.wireCut, wireFinalOf(f)];
const bhaRows = (f: LogForm) => f.bha.filter((b) => b.text.trim());
const statusWord = (f: LogForm) => (f.status ? JOB_STATUSES[f.status] : '');
const sigWords = (s: Sig | null) => (hasSig(s) ? (s!.text ?? `signed by ${s!.by}`) : '—');

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---- PDF

const WIN = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const clean = (s: unknown) => String(s ?? '').replace(/−/g, '-').split('').filter((c) => c.charCodeAt(0) < 256 || WIN.has(c)).join('');

export async function pdfBytes(f: LogForm): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), serif = await doc.embedFont(StandardFonts.TimesRomanItalic);
  type Font = typeof font;
  doc.setTitle(clean(`Job log ${f.ticket} ${f.well}`)); doc.setCreator('SLK Operations Hub');
  const navy = rgb(0.07, 0.19, 0.48), green = rgb(0.18, 0.48, 0.29), pale = rgb(0.85, 0.95, 0.89), grey = rgb(0.906, 0.906, 0.906), line = rgb(0.6, 0.6, 0.6), ink = rgb(0, 0, 0), white = rgb(1, 1, 1);
  let logo: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  try { logo = await doc.embedPng(await (await fetch('/brand/nesr-dark-320.png')).arrayBuffer()); } catch { /* no logo: the title still prints */ }
  const W = 595.28, H = 841.89, M = 34, IW = W - 2 * M;
  let page = doc.addPage([W, H]);
  const pages = [page];
  let y = 0;
  const wrap = (s: string, size: number, maxW: number, fnt: Font = font) => {
    const out: string[] = [];
    for (const para of clean(s).split('\n')) {
      let cur = '';
      for (const w of para.split(/\s+/)) { const t = cur ? `${cur} ${w}` : w; if (fnt.widthOfTextAtSize(t, size) > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
      out.push(cur);
    }
    return out.length ? out : [''];
  };
  /** Text that has to stay on one line: smaller type first, then cut. */
  const fit = (s: string, maxW: number, size: number, fnt: Font = font) => {
    let t = clean(s), z = size;
    while (z > 5.5 && fnt.widthOfTextAtSize(t, z) > maxW) z -= 0.5;
    while (t && fnt.widthOfTextAtSize(t, z) > maxW) t = t.slice(0, -1);
    return { t, z };
  };
  const box = (x: number, top: number, w: number, h: number, fill?: ReturnType<typeof rgb>) => page.drawRectangle({ x, y: top - h, width: w, height: h, color: fill, borderColor: line, borderWidth: 0.4 });
  const label = (s: string, x: number, top: number, w: number, h: number, fnt: Font = bold, color = ink, size = 7) => { const { t, z } = fit(s, w - 5, size, fnt); page.drawText(t, { x: x + 3, y: top - h / 2 - z / 3, size: z, font: fnt, color }); };
  const head = () => {
    if (logo) page.drawImage(logo, { x: M, y: H - 52, width: 64, height: 64 * (logo.height / logo.width) });
    const t = clean(TITLE);
    page.drawText(t, { x: (W - bold.widthOfTextAtSize(t, 15)) / 2, y: H - 38, size: 15, font: bold, color: navy });
    const sub = 'NESR SLICKLINE SERVICE REPORT';
    page.drawText(sub, { x: (W - font.widthOfTextAtSize(sub, 8)) / 2, y: H - 50, size: 8, font, color: line });
    y = H - 64;
  };
  const newPage = () => { page = doc.addPage([W, H]); pages.push(page); head(); };
  const room = (h: number) => { if (y - h < M + 24) newPage(); };
  const section = (title: string) => { room(30); y -= 8; box(M, y, IW, 14, green); label(title, M, y, IW, 14, bold, white, 7.5); y -= 14; };
  head();

  // the header: label and value, the well on the left and the crew on the right
  const L = headerLeft(f), R = headerRight(f), lw = IW * 0.17, vw = IW * 0.33, RH = 13;
  for (let i = 0; i < L.length; i++) {
    const row: [string, string][] = [L[i], R[i]];
    row.forEach(([l, v], k) => {
      const x = M + k * (lw + vw);
      if (!l && !v) { box(x, y, lw + vw, RH); return; }
      box(x, y, lw, RH, grey); box(x + lw, y, vw, RH);
      label(l, x, y, lw, RH, bold, ink, 6.5); label(v, x + lw, y, vw, RH, font, ink, 7.5);
    });
    y -= RH;
  }

  // the operations record
  section('OPERATIONS RECORD');
  const widths = [16, 42, 28, 28, 40, 22, 38, 0, 88];
  widths[7] = IW - widths.reduce((a, b) => a + b, 0);
  const tableHead = () => {
    let x = M;
    COLS.forEach((c, i) => { box(x, y, widths[i], 14, grey); label(c.toUpperCase(), x, y, widths[i], 14, bold, ink, 6.5); x += widths[i]; });
    y -= 14;
  };
  tableHead();
  exportRows(f).forEach((r, i) => {
    const cells = [String(r.n), r.date, r.time, r.to, r.day, r.run, r.depth, r.desc, r.remark];
    const lines = cells.map((c, k) => wrap(c, 7.5, widths[k] - 4));
    const h = Math.max(...lines.map((l) => l.length)) * 9 + 5;
    if (y - h < M + 24) { newPage(); tableHead(); }
    let x = M;
    lines.forEach((ls, k) => {
      box(x, y, widths[k], h, i % 2 ? pale : white);
      ls.forEach((ln, j) => page.drawText(ln, { x: x + 2, y: y - 9 - j * 9, size: 7.5, font, color: ink }));
      x += widths[k];
    });
    y -= h;
  });

  // job status: the four boxes, the one chosen marked
  room(40); y -= 8;
  const sw = IW / 5;
  box(M, y, sw, 16, grey); label('JOB STATUS', M, y, sw, 16, bold, ink, 7);
  (Object.entries(JOB_STATUSES) as [keyof typeof JOB_STATUSES, string][]).forEach(([k, l], i) => {
    const x = M + sw * (i + 1);
    box(x, y, sw, 16, f.status === k ? pale : undefined);
    page.drawRectangle({ x: x + 5, y: y - 12, width: 8, height: 8, borderColor: ink, borderWidth: 0.6 });
    if (f.status === k) page.drawText('X', { x: x + 6.4, y: y - 11, size: 7.5, font: bold, color: ink });
    page.drawText(clean(l.toUpperCase()), { x: x + 18, y: y - 11, size: 7, font: f.status === k ? bold : font, color: ink });
  });
  y -= 16;

  // wire details
  section('WIRE DETAILS');
  const ww = IW / WIRE_COLS.length;
  WIRE_COLS.forEach((c, i) => { box(M + i * ww, y, ww, 13, grey); label(c.toUpperCase(), M + i * ww, y, ww, 13, bold, ink, 6.5); });
  y -= 13;
  wireValues(f).forEach((v, i) => { box(M + i * ww, y, ww, 14); label(v, M + i * ww, y, ww, 14, font, ink, 7.5); });
  y -= 14;

  // the BHA of each run
  const bha = bhaRows(f);
  if (bha.length) {
    section('BHA');
    const rw = 56;
    bha.forEach((b) => {
      const ls = wrap(b.text, 7.5, IW - rw - 6);
      const h = ls.length * 9 + 5;
      room(h);
      box(M, y, rw, h, grey); page.drawText(clean(`Run No. ${b.run}`), { x: M + 3, y: y - 9, size: 7, font: bold, color: ink });
      box(M + rw, y, IW - rw, h);
      ls.forEach((ln, j) => page.drawText(ln, { x: M + rw + 3, y: y - 9 - j * 9, size: 7.5, font, color: ink }));
      y -= h;
    });
  }

  // the note
  if (f.notes.trim()) {
    const ls = wrap(`Note: ${f.notes}`, 7.5, IW - 6);
    const h = ls.length * 9 + 6;
    room(h + 8); y -= 8;
    box(M, y, IW, h);
    ls.forEach((ln, j) => page.drawText(ln, { x: M + 3, y: y - 9 - j * 9, size: 7.5, font: j === 0 ? font : font, color: ink }));
    y -= h;
  }

  // crew hours
  room(126); y -= 8;
  const hrs = hours(f), third = IW / 3;
  ([['DAY SHIFT CREW HOURS', hrs.day], ['NIGHT SHIFT CREW HOURS', hrs.night], ['TOTAL HOURS', hrs.total]] as const).forEach(([l, v], k) => {
    const x = M + k * third;
    box(x, y, third * 0.68, 16, grey); box(x + third * 0.68, y, third * 0.32, 16);
    label(l, x, y, third * 0.68, 16, bold, ink, 7);
    page.drawText(v == null ? '' : String(v), { x: x + third * 0.68 + 4, y: y - 11, size: 8, font, color: ink });
  });
  y -= 30;

  // the client and NESR representatives, as the report has them
  const block = async (x: number, title: string, name: string, id: string, sig: Sig | null, date?: string) => {
    page.drawText(title, { x, y, size: 9, font: bold, color: navy });
    const n = fit(`Name: ${name}`, IW / 2 - 12, 8.5);
    page.drawText(n.t, { x, y: y - 14, size: n.z, font, color: ink });
    page.drawText(clean(`I.D. No.: ${id}`), { x, y: y - 27, size: 8.5, font, color: ink });
    if (date) page.drawText(`Date: ${dateShort(date)}`, { x, y: y - 40, size: 8.5, font, color: ink });
    page.drawText('Signature:', { x, y: y - 62, size: 8.5, font, color: ink });
    if (sig?.img) { try { const im = await doc.embedPng(sig.img); const h = 34, w = Math.min(150, h * (im.width / im.height)); page.drawImage(im, { x: x + 52, y: y - 70, width: w, height: h }); } catch { /* a broken drawing prints the line only */ } }
    else if (sig?.text) page.drawText(clean(sig.text), { x: x + 54, y: y - 62, size: 15, font: serif, color: navy });
    page.drawLine({ start: { x: x + 50, y: y - 66 }, end: { x: x + 220, y: y - 66 }, thickness: 0.5, color: line });
  };
  await block(M, `${clean(f.customer || 'CLIENT').toUpperCase().slice(0, 30)} REPRESENTATIVE`, f.fmName, f.fmId, f.fmSig, f.fmDate);
  await block(W / 2 + 6, 'NESR REPRESENTATIVE', f.engNames.join(' / '), f.engId, f.engSig);
  pages.forEach((pg, i) => pg.drawText(clean(`${TITLE} · ${f.ticket} · ${f.well}  |  Page ${i + 1} of ${pages.length}  |  SLK Operations Hub`), { x: M, y: 18, size: 6.5, font, color: line }));
  return doc.save();
}
export const pdfBlob = async (f: LogForm) => new Blob([(await pdfBytes(f)) as BlobPart], { type: 'application/pdf' });

// ---- Excel

export function xlsxBlob(f: LogForm): Blob {
  const h = hours(f);
  const rows = exportRows(f).map((r) => [r.n, r.date, r.time, r.to, r.day, r.run, r.depth, r.desc, r.remark]);
  const tail = [[], ['JOB STATUS', statusWord(f)], [], ['DAY SHIFT CREW HOURS', h.day, 'NIGHT SHIFT CREW HOURS', h.night, 'TOTAL HOURS', h.total], [],
    [`${(f.customer || 'Client').toUpperCase()} REPRESENTATIVE`, f.fmName, 'I.D.', f.fmId, 'Signature', sigWords(f.fmSig), 'Date', dateShort(f.fmDate)],
    ['NESR REPRESENTATIVE', f.engNames.join(' / '), 'I.D.', f.engId, 'Signature', sigWords(f.engSig)]];
  const wire = WIRE_COLS.map((c, i) => [c, wireValues(f)[i]]);
  const bytes = workbookSheets([
    { name: 'Job log', header: COLS, rows: [...rows, ...tail], widths: [5, 11, 8, 8, 11, 6, 10, 60, 30] },
    { name: 'Header', header: ['Field', 'Value', 'Field', 'Value'], rows: headerLeft(f).map((l, i) => [...l, ...headerRight(f)[i]]), widths: [22, 34, 22, 34] },
    { name: 'Wire and BHA', header: ['Item', 'Value'], rows: [['Job status', statusWord(f)], ...wire, [], ...bhaRows(f).map((b) => [`Run No. ${b.run}`, b.text]), [], ['Note', f.notes]], widths: [20, 110] },
  ]);
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---- Word

const esc = escHtml;
export function docBlob(f: LogForm): Blob {
  const h = hours(f);
  const cell = (v: unknown, s = '') => `<td style="border:1px solid #999;padding:2pt 4pt;${s}">${esc(v)}</td>`;
  const lab = (v: unknown) => cell(v, 'background:#E7E7E7;font-weight:bold;font-size:8pt');
  const band = (t: string) => `<p style="background:#2D7A4B;color:#fff;font-weight:bold;padding:2pt 4pt;margin:8pt 0 0">${esc(t)}</p>`;
  const sig = (s: Sig | null) => (s?.img ? `<img src="${s.img}" width="180" height="60">` : `<i style="font-family:'Times New Roman';font-size:16pt">${esc(s?.text ?? '—')}</i>`);
  const L = headerLeft(f), R = headerRight(f);
  const html = `<html><head><meta charset="utf-8"><title>${esc(TITLE)}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:10pt}table{border-collapse:collapse;width:100%}th{background:#E7E7E7;border:1px solid #999;padding:3pt;font-size:8pt}</style></head><body>
<h1 style="text-align:center;color:#12307A;font-size:16pt;margin-bottom:0">${esc(TITLE)}</h1><p style="text-align:center;color:#888;margin-top:0">NESR SLICKLINE SERVICE REPORT</p>
<table>${L.map((l, i) => `<tr>${lab(l[0])}${cell(l[1])}${lab(R[i][0])}${cell(R[i][1])}</tr>`).join('')}</table>
${band('OPERATIONS RECORD')}<table><tr>${COLS.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${exportRows(f).map((r, i) => `<tr>${[r.n, r.date, r.time, r.to, r.day, r.run, r.depth, r.desc, r.remark].map((v) => cell(v, i % 2 ? 'background:#D9F2E4' : '')).join('')}</tr>`).join('')}</table>
<table style="margin-top:8pt"><tr>${lab('JOB STATUS')}${(Object.entries(JOB_STATUSES) as [string, string][]).map(([k, l]) => cell(`${f.status === k ? '☒' : '☐'} ${l}`, f.status === k ? 'font-weight:bold' : '')).join('')}</tr></table>
${band('WIRE DETAILS')}<table><tr>${WIRE_COLS.map((c) => `<th>${esc(c)}</th>`).join('')}</tr><tr>${wireValues(f).map((v) => cell(v)).join('')}</tr></table>
${bhaRows(f).length ? `${band('BHA')}<table>${bhaRows(f).map((b) => `<tr>${lab(`Run No. ${b.run}`)}${cell(b.text)}</tr>`).join('')}</table>` : ''}
${f.notes.trim() ? `<p style="border:1px solid #999;padding:4pt;margin-top:8pt"><b>Note:</b> ${esc(f.notes)}</p>` : ''}
<table style="margin-top:8pt"><tr>${lab('DAY SHIFT CREW HOURS')}${cell(h.day ?? '')}${lab('NIGHT SHIFT CREW HOURS')}${cell(h.night ?? '')}${lab('TOTAL HOURS')}${cell(h.total ?? '')}</tr></table><br>
<table><tr><td style="width:50%;vertical-align:top"><b style="color:#12307A">${esc((f.customer || 'Client').toUpperCase())} REPRESENTATIVE</b><br>Name: ${esc(f.fmName)}<br>I.D. No.: ${esc(f.fmId)}<br>Date: ${esc(dateShort(f.fmDate))}<br>Signature:<br>${sig(f.fmSig)}</td>
<td style="width:50%;vertical-align:top"><b style="color:#12307A">NESR REPRESENTATIVE</b><br>Name: ${esc(f.engNames.join(' / '))}<br>I.D. No.: ${esc(f.engId)}<br>Signature:<br>${sig(f.engSig)}</td></tr></table>
</body></html>`;
  return new Blob(['﻿', html], { type: 'application/msword' });
}

// ---- e-mail

export const emailSubject = (f: LogForm) => `Job Log – ${f.ticket} – ${f.well} – ${dateShort(f.date)}`;
export const emailBody = (f: LogForm, user: string) =>
  `Dear all,\n\nPlease find attached the Job Log (Sequence of Events) for ticket ${f.ticket} – well ${f.well} (${f.jobType}), dated ${dateShort(f.date)}.${f.status ? ` Job status: ${statusWord(f)}.` : ''}\n\n`
  + `Slickline crew: ${f.engNames.join(' / ') || '—'}\nClient representative: ${f.fmName || '—'}\n\nBest regards,\n${user}`;

const toB64 = (b: Blob) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b); });

/** An unsent e-mail (.eml) with the files attached: Outlook and Mail open it ready to send. */
export async function emlBlob(o: { to: string[]; cc: string[]; subject: string; body: string; files: { name: string; blob: Blob }[] }): Promise<Blob> {
  const boundary = `----SLK_${Date.now().toString(36)}`;
  const parts = [`To: ${o.to.join(', ')}`, ...(o.cc.length ? [`Cc: ${o.cc.join(', ')}`] : []), `Subject: ${o.subject}`, 'X-Unsent: 1', 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', o.body, ''];
  for (const a of o.files) {
    parts.push(`--${boundary}`, `Content-Type: ${a.blob.type || 'application/octet-stream'}; name="${a.name}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${a.name}"`, '', (await toB64(a.blob)).replace(/(.{76})/g, '$1\r\n'), '');
  }
  parts.push(`--${boundary}--`, '');
  return new Blob([parts.join('\r\n')], { type: 'message/rfc822' });
}
