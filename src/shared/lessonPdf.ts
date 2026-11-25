// The PDF of a lesson learnt or best practice (6z.57): the page layout drawn with pdf-lib in Helvetica, pictures and
// the company logo embedded as they are (JPEG or PNG). Server only (the page draws the same layout as SVG).

import { PDFDocument, StandardFonts, rgb, type PDFImage } from 'pdf-lib';
import { PAGE, pageOps, type PageInput } from './lessonLayout';

export interface PdfImage { bytes: Uint8Array; type: 'image/jpeg' | 'image/png' }

const CP1252 = new Set('€‚„…•–—‘’“”™'.split(''));
const SUBST: Record<string, string> = { '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '✓': 'v', '″': '"', '′': "'", '₂': '2', '₃': '3', '\t': ' ' };
/** Text Helvetica can show (Windows-1252); anything else becomes a close stand-in or a question mark. */
export function pdfSafe(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    if (SUBST[ch]) { out += SUBST[ch]; continue; }
    const c = ch.codePointAt(0)!;
    out += CP1252.has(ch) || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) ? ch : c < 32 ? '' : '?';
  }
  return out;
}

const colour = (hex: string) => {
  const n = parseInt(hex.slice(0, 6), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

export async function lessonPdf(inp: PageInput, images: Map<string, PdfImage>, logo: (PdfImage & { w: number; h: number }) | null, title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title); doc.setCreator('SLK Operations Hub'); doc.setProducer('SLK Operations Hub');
  const page = doc.addPage([PAGE.w, PAGE.h]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const embedded = new Map<string, PDFImage | null>();
  const embed = async (id: string) => {
    if (embedded.has(id)) return embedded.get(id)!;
    const src = id === '__logo__' ? logo : images.get(id);
    let img: PDFImage | null = null;
    // a copy: pdf-lib reads from the start of the underlying buffer, and pictures out of a zip are slices of a bigger one
    if (src) { const bytes = src.bytes.slice(); try { img = src.type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes); } catch { img = null; } }
    embedded.set(id, img);
    return img;
  };
  const { ops } = pageOps(inp, logo ? { w: logo.w, h: logo.h } : null);
  const Y = (y: number) => PAGE.h - y;
  for (const op of ops) {
    if (op.o === 'rect') {
      page.drawRectangle({ x: op.x, y: Y(op.y + op.h), width: op.w, height: op.h, color: op.fill ? colour(op.fill) : undefined, borderColor: op.stroke ? colour(op.stroke) : undefined, borderWidth: op.stroke ? op.sw ?? 0.6 : 0 });
    } else if (op.o === 'line') {
      page.drawLine({ start: { x: op.x1, y: Y(op.y1) }, end: { x: op.x2, y: Y(op.y2) }, thickness: op.sw, color: colour(op.c) });
    } else if (op.o === 'img') {
      const img = await embed(op.pic);
      if (img) page.drawImage(img, { x: op.x, y: Y(op.y + op.h), width: op.w, height: op.h });
      else page.drawRectangle({ x: op.x, y: Y(op.y + op.h), width: op.w, height: op.h, color: rgb(0.9, 0.91, 0.93) });
    } else {
      const t = pdfSafe(op.t);
      if (t) page.drawText(t, { x: op.x, y: Y(op.y), size: op.size, font: op.b ? bold : font, color: colour(op.c) });
    }
  }
  return doc.save();
}
