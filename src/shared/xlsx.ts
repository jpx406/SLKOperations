// A small XLSX writer: one or more sheets, bold frozen header (with an optional row naming column groups), autofilter,
// column widths, shaded headers. Strings and numbers only. Files are zipped without compression ("stored"), which every
// spreadsheet app opens. No dependencies.

export type Cell = string | number | null | undefined;

const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip with stored entries. */
export function zip(files: { name: string; data: Uint8Array }[], when = new Date()): Uint8Array<ArrayBuffer> {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); head.setUint16(8, 0, true);
    head.setUint16(10, time, true); head.setUint16(12, date, true); head.setUint32(14, crc, true);
    head.setUint32(18, f.data.length, true); head.setUint32(22, f.data.length, true); head.setUint16(26, name.length, true); head.setUint16(28, 0, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true); cd.setUint16(14, date, true); cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true); cd.setUint32(24, f.data.length, true); cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    locals.push(new Uint8Array(head.buffer), name, f.data);
    centrals.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

// eslint-disable-next-line no-control-regex
const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function columnLetter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const NS = 'http://schemas.openxmlformats.org';

/** One sheet of a workbook. `groups` adds a row above the header naming each run of columns (Job, Dates …);
 *  `highlight` marks header cells to shade (the columns only some accounts keep). */
export interface SheetSpec {
  name: string;
  header: string[];
  rows: Cell[][];
  widths?: number[];
  groups?: { label: string; span: number }[];
  highlight?: boolean[];
  /** Rows (0-based, in `rows`) written in grey italics: a section title or a total line. */
  muted?: number[];
}

// cell styles: 0 plain, 1 bold header, 2 bold shaded header, 3 bold group band, 4 grey italic
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}/spreadsheetml/2006/main">` +
  `<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="11"/><color rgb="FF6B7280"/><name val="Calibri"/></font></fonts>` +
  `<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFFFF1C2"/><bgColor indexed="64"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
  `</styleSheet>`;

const sheetName = (n: string) => n.slice(0, 31).replace(/[\\/?*[\]:]/g, ' ').trim() || 'Sheet';

function sheetXml(s: SheetSpec): string {
  const cell = (v: Cell, ref: string, style = 0) => {
    const st = style ? ` s="${style}"` : '';
    if (v === null || v === undefined || v === '') return style >= 2 && style <= 3 ? `<c r="${ref}"${st}/>` : '';
    return typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
  };
  const top = s.groups?.length ? 1 : 0;
  const last = columnLetter(Math.max(0, s.header.length - 1));
  const out: string[] = [];
  const merges: string[] = [];
  if (top) {
    let c = 0;
    const cells: string[] = [];
    for (const g of s.groups!) {
      for (let i = 0; i < g.span; i++) cells.push(cell(i === 0 ? g.label : null, `${columnLetter(c + i)}1`, 3));
      if (g.span > 1) merges.push(`${columnLetter(c)}1:${columnLetter(c + g.span - 1)}1`);
      c += g.span;
    }
    out.push(`<row r="1">${cells.join('')}</row>`);
  }
  out.push(`<row r="${top + 1}">${s.header.map((h, ci) => cell(h, `${columnLetter(ci)}${top + 1}`, s.highlight?.[ci] ? 2 : 1)).join('')}</row>`);
  const muted = new Set(s.muted ?? []);
  s.rows.forEach((r, ri) => {
    const n = ri + top + 2;
    out.push(`<row r="${n}">${r.map((v, ci) => cell(v, `${columnLetter(ci)}${n}`, muted.has(ri) ? 4 : 0)).join('')}</row>`);
  });
  const cols = s.widths?.length ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const head = top + 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${head}" topLeftCell="A${head + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `${cols}<sheetData>${out.join('')}</sheetData><autoFilter ref="A${head}:${last}${s.rows.length + head}"/>` +
    `${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}</worksheet>`;
}

/** Builds a workbook with one or more sheets. Strings stay text (never formulas), so a value starting with "=" is harmless. */
export function workbookSheets(specs: SheetSpec[]): Uint8Array<ArrayBuffer> {
  // sheet names must be unique in a workbook
  const used = new Set<string>();
  const names = specs.map((s) => {
    const base = sheetName(s.name);
    let n = base;
    for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base.slice(0, 27)} (${i})`;
    used.add(n.toLowerCase());
    return n;
  });
  const files: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${NS}/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      specs.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships">` +
      `<sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
      `<definedNames>${specs.map((s, i) => {
        const head = s.groups?.length ? 2 : 1;
        return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(names[i].replace(/'/g, "''"))}'!$A$${head}:$${columnLetter(Math.max(0, s.header.length - 1))}$${s.rows.length + head}</definedName>`;
      }).join('')}</definedNames></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}/package/2006/relationships">` +
      specs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${specs.length + 1}" Type="${NS}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': STYLES,
  };
  specs.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s); });
  return zip(Object.entries(files).map(([name, s]) => ({ name, data: enc.encode(s) })));
}

/** Builds a one-sheet workbook. */
export function workbook(sheetName: string, header: string[], rows: Cell[][], widths?: number[]): Uint8Array<ArrayBuffer> {
  return workbookSheets([{ name: sheetName, header, rows, widths }]);
}

/** CSV for the plain download. Cells that a spreadsheet would read as a formula get a leading apostrophe. */
export function csv(header: string[], rows: Cell[][]): string {
  const q = (v: Cell) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
}
