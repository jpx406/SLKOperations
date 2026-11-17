import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

// Download stamping, after Document Control: every page of a downloaded PDF gets a footer naming the document,
// its revision, who downloaded it and when, and a copy number that is also written to the audit log, so a printed
// copy can be traced back to the download. A PDF that can't be opened (damaged, or locked with a password) is
// served as it is and the log says it was not stamped.

export function copyId(): string {
  return `COPY-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function stampText(p: { docNo: string; revision: number; by: string; date: string; copy: string; status: string }): string {
  const state = p.status === 'approved' ? 'Controlled copy' : `${p.status.toUpperCase()}, not approved`;
  return `${p.docNo} Rev ${p.revision}  ·  ${state}, uncontrolled when printed  ·  Downloaded ${p.date} by ${p.by}  ·  ${p.copy}`;
}

/** WinAnsi only: anything Helvetica can't draw becomes '?'. */
const ansi = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/·/g, '·').replace(/[^\x20-\x7e -ÿ]/g, '?');

export async function stampPdf(bytes: Uint8Array, text: string, draft: boolean): Promise<Uint8Array | null> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch {
    return null;
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const line = ansi(text);
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const { width, height } = page.getSize();
    const label = `${line}  ·  Page ${i + 1} of ${pages.length}`;
    let size = 7;
    while (size > 4.5 && font.widthOfTextAtSize(label, size) > width - 40) size -= 0.5;
    page.drawRectangle({ x: 0, y: 0, width, height: 16, color: rgb(1, 1, 1), opacity: 0.85 });
    page.drawLine({ start: { x: 20, y: 16 }, end: { x: width - 20, y: 16 }, thickness: 0.4, color: rgb(0.6, 0.6, 0.6) });
    page.drawText(label, { x: 20, y: 5.5, size, font, color: rgb(0.3, 0.3, 0.3) });
    if (draft) {
      // a document that is not approved yet carries a diagonal mark across each page
      const mark = 'NOT APPROVED';
      const s = Math.min(width, height) / 9;
      page.drawText(mark, { x: width / 2 - bold.widthOfTextAtSize(mark, s) / 2.8, y: height / 2 - s, size: s, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.18, rotate: degrees(35) });
    }
  });
  return doc.save({ useObjectStreams: false });
}
