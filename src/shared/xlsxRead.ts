// A small reader for .xlsx files (the JRA form): the first worksheet's cell values and formulas, its list
// validations, and its cell comments. Unzips with DecompressionStream, which browsers and Workers both have.

export interface SheetCell { v?: string; f?: string }
export interface Sheet { cells: Record<string, SheetCell>; validations: { ranges: string[]; list: string[] }[]; comments: Record<string, string> }

const dec = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#10;/g, '\n').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

/** Limits for an uploaded zip (xlsx, pptx, docx): a small file that expands to gigabytes is refused, not unpacked. */
export const UNZIP_LIMITS = { totalBytes: 150 * 1024 * 1024, entries: 5000 };
const TOO_BIG = 'This file expands to more than the app can open. Save it again from Office, or make it smaller.';

/** Inflates one entry, stopping as soon as the running total would pass the budget. */
async function inflate(data: Uint8Array, budget: { left: number }): Promise<Uint8Array> {
  const reader = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > budget.left) { await reader.cancel().catch(() => {}); throw new Error(TOO_BIG); }
    parts.push(value);
  }
  budget.left -= n;
  const out = new Uint8Array(n);
  let o = 0;
  for (const part of parts) { out.set(part, o); o += part.byteLength; }
  return out;
}

/** The files inside a zip, read through its central directory: the XML parts only, or with `all` every file. */
export async function unzip(bytes: Uint8Array, all = false): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This file is not an Excel workbook (.xlsx)');
  const count = dv.getUint16(eocd + 10, true);
  if (count > UNZIP_LIMITS.entries) throw new Error(TOO_BIG);
  const budget = { left: UNZIP_LIMITS.totalBytes };
  let off = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const td = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (off + 46 > bytes.length || dv.getUint32(off, true) !== 0x02014b50) throw new Error('The workbook is damaged');
    const method = dv.getUint16(off + 10, true), size = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true), extra = dv.getUint16(off + 30, true), comment = dv.getUint16(off + 32, true), local = dv.getUint32(off + 42, true);
    const name = td.decode(bytes.subarray(off + 46, off + 46 + nameLen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    if (local + 30 > bytes.length || start + size > bytes.length) throw new Error('The workbook is damaged');
    const raw = bytes.subarray(start, start + size);
    if (all ? !name.endsWith('/') : /\.(xml|rels)$/.test(name)) {
      if (method === 0) { budget.left -= size; if (budget.left < 0) throw new Error(TOO_BIG); }
      out.set(name, method === 8 ? await inflate(raw, budget) : method === 0 ? raw : new Uint8Array());
    }
    off += 46 + nameLen + extra + comment;
  }
  return out;
}

const text = (files: Map<string, Uint8Array>, name: string) => { const b = files.get(name); return b ? new TextDecoder().decode(b) : ''; };
const runs = (xml: string) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('');

/** Expands "R9:S10 R12" into the individual cell refs (only the first column of each range is kept). */
export function expandRanges(sqref: string): string[] {
  const out: string[] = [];
  for (const part of sqref.trim().split(/\s+/)) {
    const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(part);
    if (!m) continue;
    const [r1, r2] = [Number(m[2]), Number(m[4] ?? m[2])];
    for (let r = r1; r <= r2; r++) out.push(`${m[1]}${r}`);
  }
  return out;
}

export async function readXlsx(bytes: Uint8Array): Promise<Sheet> {
  const files = await unzip(bytes);
  const wb = text(files, 'xl/workbook.xml');
  if (!wb) throw new Error('This file is not an Excel workbook (.xlsx)');
  // the first sheet listed in the workbook, through its relationship id
  const rid = /<sheet [^>]*r:id="([^"]+)"/.exec(wb)?.[1];
  const rels = text(files, 'xl/_rels/workbook.xml.rels');
  const target = rid ? new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1] : undefined;
  const sheetPath = target ? `xl/${target.replace(/^\/?xl\//, '').replace(/^\.\//, '')}` : 'xl/worksheets/sheet1.xml';
  const sheetXml = text(files, sheetPath);
  if (!sheetXml) throw new Error('The workbook has no worksheet');
  const shared = [...text(files, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => dec(runs(m[1])));

  const cells: Record<string, SheetCell> = {};
  for (const c of sheetXml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const type = /\bt="(\w+)"/.exec(c[2])?.[1];
    const inner = c[3] ?? '';
    const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
    const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1];
    const value = type === 's' ? shared[Number(v)] : type === 'inlineStr' ? dec(runs(inner)) : v === undefined ? undefined : dec(v);
    if (value !== undefined || f !== undefined) cells[c[1]] = { ...(value !== undefined ? { v: value } : {}), ...(f !== undefined ? { f: dec(f) } : {}) };
  }

  const validations = [...sheetXml.matchAll(/<dataValidation\b([^>]*)>([\s\S]*?)<\/dataValidation>/g)]
    .filter((m) => /type="list"/.test(m[1]))
    .map((m) => ({
      ranges: expandRanges(/sqref="([^"]+)"/.exec(m[1])?.[1] ?? ''),
      list: dec(/<formula1>([\s\S]*?)<\/formula1>/.exec(m[2])?.[1] ?? '').replace(/^"|"$/g, '').split(',').map((x) => x.trim()).filter(Boolean),
    }));

  // comments live in a part the sheet's relationships point at
  const sheetRels = text(files, sheetPath.replace(/worksheets\/([^/]+)$/, 'worksheets/_rels/$1.rels'));
  const commentTarget = /Target="([^"]*comments[^"]*)"/.exec(sheetRels)?.[1];
  const commentXml = commentTarget ? text(files, `xl/${commentTarget.replace(/^(\.\.\/)+/, '')}`) : '';
  const comments: Record<string, string> = {};
  for (const m of commentXml.matchAll(/<comment ref="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/comment>/g)) {
    // Excel puts the author as a first bold run ending in ":"
    const parts = [...m[2].matchAll(/<r>([\s\S]*?)<\/r>/g)].map((r) => dec(runs(r[1])));
    const body = (parts.length ? parts : [dec(runs(m[2]))]).join('');
    comments[m[1]] = body.replace(/^[^:\n]{1,80}:\s*/, '').trim();
  }
  return { cells, validations, comments };
}
