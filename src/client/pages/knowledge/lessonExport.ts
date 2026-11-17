import type { Slide } from '../../../shared/docDigest';
import { ADD_TYPES, type AddType, type KnowledgeDoc } from '../../../shared/knowledge';
import { deckPdf, deckPptx, type Jpeg, type LessonDeck } from '../../../shared/lessonDeck';
import { formatDate } from '../../api';

// Downloads a lesson's two slides as PowerPoint or PDF (6z.17), built in the browser from the saved slides and the
// lesson's support pictures (converted to JPEG here, at most 1600 px on the long side).

export async function toJpeg(url: string, max = 1600): Promise<Jpeg | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
    return blob ? { width: c.width, height: c.height, data: new Uint8Array(await blob.arrayBuffer()) } : null;
  } catch { return null; }
}

export async function downloadLesson(doc: KnowledgeDoc, slides: Slide[], pictureUrls: string[][], as: 'pptx' | 'pdf') {
  // every picture of every slide, converted to JPEG; one that can't be read is left out
  const pictures = await Promise.all(slides.map(async (_, i) => (await Promise.all((pictureUrls[i] ?? []).map((u) => toJpeg(u)))).filter((j): j is Jpeg => !!j)));
  const deck: LessonDeck = {
    title: doc.title, docNo: doc.doc_no, revision: doc.revision, kind: ADD_TYPES[(doc.doc_type ?? 'lesson_learnt') as AddType].label, country: doc.country,
    date: formatDate(new Date().toISOString().slice(0, 10)), slides, pictures,
  };
  const bytes = as === 'pptx' ? deckPptx(deck) : deckPdf(deck);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: as === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'application/pdf' }));
  a.download = `${[doc.doc_no, doc.title].filter(Boolean).join(' ').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 100)}.${as}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
