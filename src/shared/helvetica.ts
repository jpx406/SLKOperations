// The one Helvetica measure (6z.72): the PDF writer (pdf.ts), the lesson page (lessonLayout.ts) and anything that wraps
// text for a PDF use these widths, so the same words wrap the same way everywhere.

// Helvetica and Helvetica-Bold widths (per 1000) for characters 32–126, from the standard font metrics; Arial, which
// the preview falls back to, has the same widths
export const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
export const HELVB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const WIDE: Record<string, [number, number]> = { '•': [350, 350], '–': [556, 556], '—': [1000, 1000], '‘': [222, 278], '’': [222, 278], '“': [333, 500], '”': [333, 500], '°': [400, 400], '…': [1000, 1000], '·': [278, 278] };
/** Width in points of text in Helvetica (bold or not). */
export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    w += c >= 32 && c <= 126 ? (bold ? HELVB : HELV)[c - 32] : WIDE[ch]?.[bold ? 1 : 0] ?? 556;
  }
  return (w * size) / 1000;
}
