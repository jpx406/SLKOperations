// A small PDF writer for text documents (the approved JRA): A4 pages, Helvetica and Helvetica-Bold, word-wrapped
// lines, rules and filled boxes. No dependencies, so it runs in the Worker. Text is encoded as WinAnsi (Windows-1252).

const A4 = [595.28, 841.89]; // in points

// Helvetica glyph widths (per 1000) for characters 32–126, from the standard font metrics
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

// Windows-1252 codes for the typographic characters people type; anything else outside Latin-1 is replaced
const CP1252: Record<string, number> = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '•': 0x95, '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '™': 0x99 };
const SUBST: Record<string, string> = { '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '₂': '2', '₃': '3', '✓': 'v', '×': 'x', '·': '·' };

export function toWinAnsi(s: string): number[] {
  const out: number[] = [];
  for (const ch of s.normalize('NFC')) {
    const sub = SUBST[ch];
    if (sub && sub !== ch) { out.push(...toWinAnsi(sub)); continue; }
    const c = ch.codePointAt(0)!;
    if (CP1252[ch]) out.push(CP1252[ch]);
    else if (c === 9) out.push(32);
    else if (c >= 32 && c <= 255 && !(c >= 127 && c < 160)) out.push(c);
    else if (c >= 32) out.push(63); // ?
  }
  return out;
}

export function textWidth(s: string, size: number, bold = false): number {
  const w = toWinAnsi(s).reduce((a, c) => a + (c >= 32 && c <= 126 ? HELV[c - 32] : 556), 0);
  return (w * size * (bold ? 1.07 : 1)) / 1000;
}

/** Splits text into lines no wider than `width`, keeping the author's line breaks. */
export function wrap(s: string, width: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  for (const para of s.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (textWidth(tryLine, size, bold) <= width) { line = tryLine; continue; }
      if (line) lines.push(line);
      // a single word wider than the line is cut
      let w = word;
      while (textWidth(w, size, bold) > width && w.length > 1) {
        let n = w.length - 1;
        while (n > 1 && textWidth(w.slice(0, n), size, bold) > width) n--;
        lines.push(w.slice(0, n)); w = w.slice(n);
      }
      line = w;
    }
    lines.push(line);
  }
  return lines;
}

const esc = (codes: number[]) => codes.map((c) => (c === 40 || c === 41 || c === 92 ? `\\${String.fromCharCode(c)}` : c < 32 || c > 126 ? `\\${c.toString(8).padStart(3, '0')}` : String.fromCharCode(c))).join('');

export interface TextOpts { size?: number; bold?: boolean; color?: [number, number, number] }

export class PdfDoc {
  readonly width: number;
  readonly height: number;
  readonly margin = 42;
  private pages: string[][] = [];
  private images: { width: number; height: number; data: Uint8Array }[] = [];
  y = 0;

  /** A4 portrait, or landscape for wide tables. */
  constructor(opts: { landscape?: boolean } = {}) {
    [this.width, this.height] = opts.landscape ? [A4[1], A4[0]] : [A4[0], A4[1]];
    this.addPage();
  }
  get page() { return this.pages[this.pages.length - 1]; }
  addPage() { this.pages.push([]); this.y = this.height - this.margin; }
  /** Starts a new page when fewer than `h` points are left. */
  need(h: number) { if (this.y - h < this.margin + 24) this.addPage(); }

  text(x: number, y: number, s: string, o: TextOpts = {}) {
    const [r, g, b] = o.color ?? [0, 0, 0];
    this.page.push(`BT ${r} ${g} ${b} rg /${o.bold ? 'F2' : 'F1'} ${o.size ?? 10} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(toWinAnsi(s))}) Tj ET`);
  }
  rect(x: number, y: number, w: number, h: number, fill: [number, number, number]) {
    this.page.push(`${fill.join(' ')} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }
  /** Draws a baseline JPEG (RGB) into the box; the same image drawn twice is stored once per call site. */
  jpeg(img: { width: number; height: number; data: Uint8Array }, x: number, y: number, w: number, h: number) {
    let i = this.images.indexOf(img);
    if (i < 0) i = this.images.push(img) - 1;
    this.page.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${i + 1} Do Q`);
  }
  line(x1: number, y1: number, x2: number, y2: number, gray = 0.75) {
    this.page.push(`${gray} G 0.6 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }
  /** Writes wrapped text at the cursor and moves it down; returns the height used. */
  para(s: string, o: TextOpts & { x?: number; width?: number; gap?: number } = {}) {
    const size = o.size ?? 10, x = o.x ?? this.margin, width = o.width ?? this.width - this.margin - x;
    const lead = size * 1.3;
    const lines = wrap(s, width, size, o.bold);
    for (const l of lines) { this.need(lead); this.y -= lead; this.text(x, this.y + size * 0.25, l, o); }
    this.y -= o.gap ?? 0;
    return lines.length * lead;
  }

  /** The finished file. Page numbers and a footer line are added to every page. */
  bytes(footer = ''): Uint8Array {
    const n = this.pages.length;
    this.pages.forEach((p, i) => {
      p.push(`0.6 G 0.4 w ${this.margin} 34 m ${this.width - this.margin} 34 l S`);
      p.push(`BT 0.4 0.4 0.4 rg /F1 7.5 Tf ${this.margin} 24 Td (${esc(toWinAnsi(footer))}) Tj ET`);
      const label = `Page ${i + 1} of ${n}`;
      p.push(`BT 0.4 0.4 0.4 rg /F1 7.5 Tf ${(this.width - this.margin - textWidth(label, 7.5)).toFixed(2)} 24 Td (${label}) Tj ET`);
    });
    const objs: string[] = [];
    const add = (body: string) => { objs.push(body); return objs.length; };
    const catalog = add(''), pagesId = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const ims = this.images.map((im) => add(`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>
stream
${String.fromCharCode(...im.data)}
endstream`));
    const xobj = ims.length ? ` /XObject << ${ims.map((id, i) => `/Im${i + 1} ${id} 0 R`).join(' ')} >>` : '';
    const kids: number[] = [];
    for (const p of this.pages) {
      const content = p.join('\n');
      const c = add(`<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xobj} >> /Contents ${c} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    // every content string is ASCII (non-ASCII is escaped as octal) and image bytes are one char each, so string length = byte length
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets: number[] = [];
    objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}
