import { dateShort, exportRows, hasSig, hours, type LogForm, type Sig } from '../../shared/jobLogForm';
import { workbookSheets } from '../../shared/xlsx';

// The Job log's files (6z.51), made on the device so they also work with no signal: the PDF (pdf-lib, already in
// the app), Excel (the app's own writer), Word (HTML that Word opens as .doc, as Q-Incidents does) and an e-mail
// draft (.eml) with the three attached. Laid out like the package: title, header block, the events table with a
// green heading and pale rows, crew hours, and the two sign-off blocks.

const TITLE = 'JOB LOG · SEQUENCE OF EVENTS';
const COLS = ['#', 'Date', 'Time', 'Day', 'Run', 'Depth (ft)', 'Description of operations', 'Remarks'];
const safe = (s: string) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').trim();
export const fileBase = (f: LogForm) => `JobLog_${safe(f.ticket) || 'ticket'}_${safe(f.well) || 'well'}`;
const headerPairs = (f: LogForm): [string, string][] => [['WELL NO.', f.well], ['CLIENT', f.customer], ['SERVICES', f.jobType], ['RIG / SITE', f.rig], ['TICKET NO.', f.ticket], ['DATE', dateShort(f.date)]];
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
  doc.setTitle(clean(`Job log ${f.ticket} ${f.well}`)); doc.setCreator('SLK Operations Hub');
  const navy = rgb(0.07, 0.19, 0.48), green = rgb(0.18, 0.48, 0.29), pale = rgb(0.85, 0.95, 0.89), grey = rgb(0.906, 0.906, 0.906), line = rgb(0.6, 0.6, 0.6), ink = rgb(0, 0, 0), white = rgb(1, 1, 1);
  let logo: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  try { logo = await doc.embedPng(await (await fetch('/brand/nesr-dark-320.png')).arrayBuffer()); } catch { /* no logo: the title still prints */ }
  const W = 595.28, H = 841.89, M = 34;
  let page = doc.addPage([W, H]);
  const pages = [page];
  let y = 0;
  const wrap = (s: string, size: number, maxW: number, fnt = font) => {
    const out: string[] = [];
    for (const para of clean(s).split('\n')) {
      let cur = '';
      for (const w of para.split(/\s+/)) { const t = cur ? `${cur} ${w}` : w; if (fnt.widthOfTextAtSize(t, size) > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
      out.push(cur);
    }
    return out.length ? out : [''];
  };
  const head = () => {
    if (logo) page.drawImage(logo, { x: M, y: H - 52, width: 64, height: 64 * (logo.height / logo.width) });
    const t = clean(TITLE);
    page.drawText(t, { x: (W - bold.widthOfTextAtSize(t, 15)) / 2, y: H - 42, size: 15, font: bold, color: navy });
    y = H - 66;
  };
  head();
  // the header block: 3 pairs a row, 2 rows
  const hp = headerPairs(f), cw = (W - 2 * M) / 6;
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < 3; k++) {
      const [label, value] = hp[r * 3 + k], x = M + k * 2 * cw;
      page.drawRectangle({ x, y: y - 16, width: cw, height: 16, color: grey, borderColor: line, borderWidth: 0.4 });
      page.drawRectangle({ x: x + cw, y: y - 16, width: cw, height: 16, borderColor: line, borderWidth: 0.4 });
      page.drawText(clean(label), { x: x + 3, y: y - 11, size: 7.5, font: bold, color: ink });
      page.drawText(clean(value).slice(0, 34), { x: x + cw + 3, y: y - 11, size: 7.5, font, color: ink });
    }
    y -= 16;
  }
  y -= 10;
  // the events table
  const widths = [18, 46, 32, 46, 26, 44, 0, 104];
  widths[6] = W - 2 * M - widths.reduce((a, b) => a + b, 0);
  const tableHead = () => {
    let x = M;
    COLS.forEach((c, i) => {
      page.drawRectangle({ x, y: y - 16, width: widths[i], height: 16, color: green, borderColor: line, borderWidth: 0.4 });
      page.drawText(clean(c.toUpperCase()), { x: x + 2, y: y - 11, size: 6.5, font: bold, color: white });
      x += widths[i];
    });
    y -= 16;
  };
  const newPage = () => { page = doc.addPage([W, H]); pages.push(page); head(); };
  tableHead();
  exportRows(f).forEach((r, i) => {
    const cells = [String(r.n), r.date, r.time, r.day, r.run, r.depth, r.desc, r.remark];
    const lines = cells.map((c, k) => wrap(c, 7.5, widths[k] - 4));
    const h = Math.max(...lines.map((l) => l.length)) * 9 + 5;
    if (y - h < M + 120) { newPage(); tableHead(); }
    let x = M;
    lines.forEach((ls, k) => {
      page.drawRectangle({ x, y: y - h, width: widths[k], height: h, color: i % 2 ? pale : white, borderColor: line, borderWidth: 0.4 });
      ls.forEach((ln, j) => page.drawText(ln, { x: x + 2, y: y - 9 - j * 9, size: 7.5, font, color: ink }));
      x += widths[k];
    });
    y -= h;
  });
  if (y < M + 130) newPage();
  y -= 10;
  // crew hours
  const hrs = hours(f), third = (W - 2 * M) / 3;
  ([['DAY SHIFT CREW HOURS', hrs.day], ['NIGHT SHIFT CREW HOURS', hrs.night], ['TOTAL HOURS', hrs.total]] as const).forEach(([l, v], k) => {
    const x = M + k * third;
    page.drawRectangle({ x, y: y - 16, width: third * 0.68, height: 16, color: grey, borderColor: line, borderWidth: 0.4 });
    page.drawRectangle({ x: x + third * 0.68, y: y - 16, width: third * 0.32, height: 16, borderColor: line, borderWidth: 0.4 });
    page.drawText(l, { x: x + 3, y: y - 11, size: 7, font: bold, color: ink });
    page.drawText(v == null ? '' : String(v), { x: x + third * 0.68 + 4, y: y - 11, size: 8, font, color: ink });
  });
  y -= 30;
  // the two sign-off blocks
  const block = async (x: number, title: string, name: string, id: string, sig: Sig | null, date?: string) => {
    page.drawText(title, { x, y, size: 9, font: bold, color: navy });
    page.drawText(clean(`Name: ${name}`).slice(0, 60), { x, y: y - 14, size: 8.5, font, color: ink });
    page.drawText(clean(`I.D. No.: ${id}`), { x, y: y - 27, size: 8.5, font, color: ink });
    if (date) page.drawText(`Date: ${dateShort(date)}`, { x, y: y - 40, size: 8.5, font, color: ink });
    page.drawText('Signature:', { x, y: y - 62, size: 8.5, font, color: ink });
    if (sig?.img) { try { const im = await doc.embedPng(sig.img); const h = 34, w = Math.min(150, h * (im.width / im.height)); page.drawImage(im, { x: x + 52, y: y - 70, width: w, height: h }); } catch { /* a broken drawing prints the line only */ } }
    else if (sig?.text) page.drawText(clean(sig.text), { x: x + 54, y: y - 62, size: 15, font: serif, color: navy });
    page.drawLine({ start: { x: x + 50, y: y - 66 }, end: { x: x + 220, y: y - 66 }, thickness: 0.5, color: line });
  };
  await block(M, 'SLICKLINE SUPERVISOR / OPERATOR', f.engNames.join(' / '), f.engId, f.engSig);
  await block(W / 2 + 6, 'CLIENT REPRESENTATIVE', f.fmName, f.fmId, f.fmSig, f.fmDate);
  pages.forEach((pg, i) => pg.drawText(clean(`${TITLE} · ${f.ticket} · ${f.well}  |  Page ${i + 1} of ${pages.length}  |  SLK Operations Hub`), { x: M, y: 18, size: 6.5, font, color: line }));
  return doc.save();
}
export const pdfBlob = async (f: LogForm) => new Blob([(await pdfBytes(f)) as BlobPart], { type: 'application/pdf' });

// ---- Excel

export function xlsxBlob(f: LogForm): Blob {
  const h = hours(f);
  const rows = exportRows(f).map((r) => [r.n, r.date, r.time, r.day, r.run, r.depth, r.desc, r.remark]);
  const tail = [[], ['DAY SHIFT CREW HOURS', h.day, 'NIGHT SHIFT CREW HOURS', h.night, 'TOTAL HOURS', h.total], [],
    ['SLICKLINE SUPERVISOR / OPERATOR', f.engNames.join(' / '), 'I.D.', f.engId, 'Signature', sigWords(f.engSig)],
    ['CLIENT REPRESENTATIVE', f.fmName, 'I.D.', f.fmId, 'Signature', sigWords(f.fmSig), 'Date', dateShort(f.fmDate)]];
  const bytes = workbookSheets([
    { name: 'Job log', header: COLS, rows: [...rows, ...tail], widths: [5, 11, 8, 11, 6, 10, 60, 30] },
    { name: 'Header', header: ['Field', 'Value'], rows: headerPairs(f), widths: [14, 40] },
  ]);
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---- Word

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function docBlob(f: LogForm): Blob {
  const h = hours(f);
  const hp = headerPairs(f);
  const cell = (v: unknown, s = '') => `<td style="border:1px solid #999;padding:2pt 4pt;${s}">${esc(v)}</td>`;
  const sig = (s: Sig | null) => (s?.img ? `<img src="${s.img}" width="180" height="60">` : `<i style="font-family:'Times New Roman';font-size:16pt">${esc(s?.text ?? '—')}</i>`);
  const html = `<html><head><meta charset="utf-8"><title>${esc(TITLE)}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:10pt}table{border-collapse:collapse;width:100%}th{background:#2D7A4B;color:#fff;border:1px solid #999;padding:3pt}</style></head><body>
<h1 style="text-align:center;color:#12307A;font-size:16pt">${esc(TITLE)}</h1>
<table>${[0, 3].map((i) => `<tr>${[0, 1, 2].map((k) => cell(hp[i + k][0], 'background:#E7E7E7;font-weight:bold') + cell(hp[i + k][1])).join('')}</tr>`).join('')}</table><br>
<table><tr>${COLS.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${exportRows(f).map((r, i) => `<tr>${[r.n, r.date, r.time, r.day, r.run, r.depth, r.desc, r.remark].map((v) => cell(v, i % 2 ? 'background:#D9F2E4' : '')).join('')}</tr>`).join('')}</table><br>
<table><tr>${cell('DAY SHIFT CREW HOURS', 'background:#E7E7E7;font-weight:bold')}${cell(h.day ?? '')}${cell('NIGHT SHIFT CREW HOURS', 'background:#E7E7E7;font-weight:bold')}${cell(h.night ?? '')}${cell('TOTAL HOURS', 'background:#E7E7E7;font-weight:bold')}${cell(h.total ?? '')}</tr></table><br>
<table><tr><td style="width:50%;vertical-align:top"><b style="color:#12307A">SLICKLINE SUPERVISOR / OPERATOR</b><br>Name: ${esc(f.engNames.join(' / '))}<br>I.D. No.: ${esc(f.engId)}<br>Signature:<br>${sig(f.engSig)}</td>
<td style="width:50%;vertical-align:top"><b style="color:#12307A">CLIENT REPRESENTATIVE</b><br>Name: ${esc(f.fmName)}<br>I.D. No.: ${esc(f.fmId)}<br>Date: ${esc(dateShort(f.fmDate))}<br>Signature:<br>${sig(f.fmSig)}</td></tr></table>
</body></html>`;
  return new Blob(['﻿', html], { type: 'application/msword' });
}

// ---- e-mail

export const emailSubject = (f: LogForm) => `Job Log – ${f.ticket} – ${f.well} – ${dateShort(f.date)}`;
export const emailBody = (f: LogForm, user: string) =>
  `Dear all,\n\nPlease find attached the Job Log (Sequence of Events) for ticket ${f.ticket} – well ${f.well} (${f.jobType}), dated ${dateShort(f.date)}.\n\n`
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
