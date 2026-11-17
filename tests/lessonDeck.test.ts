import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NESR_LOGO_JPEG } from '../src/shared/brandLogo';
import { fallbackSlides, lessonSlides } from '../src/shared/docDigest';
import { deckPdf, deckPptx, layout, pictureCells, splitPictures, type LessonDeck } from '../src/shared/lessonDeck';
import { unzip } from '../src/shared/xlsxRead';

const jpeg = { width: NESR_LOGO_JPEG.width, height: NESR_LOGO_JPEG.height, data: Uint8Array.from(atob(NESR_LOGO_JPEG.base64), (ch) => ch.charCodeAt(0)) };
const deck: LessonDeck = {
  title: 'Wire parted at the stuffing box', docNo: 'LL-GL-001', revision: 0, kind: 'Learning from incident', country: 'Global', date: '17 Nov 2026',
  slides: [
    { kind: 'points', title: 'Wire parted while pulling out of hole', points: ['The 0.125 in wire parted at the stuffing box during POOH at 3,200 ft.', 'Packing was worn and not inspected before rig up.', 'The tool string fell; a fishing job cost 14 hours.'], note: 'Ask who checked the packing on the last job.' },
    { kind: 'warning', title: 'What we do now', points: ['Inspect and replace stuffing box packing before every job.', 'Record the check on the pre-job checklist.', 'Stop and check if the line shows wear marks.'], note: '' },
  ],
  pictures: [[jpeg, jpeg, jpeg], []],
};

describe('lesson slides as PowerPoint and PDF (6z.17)', () => {
  it('keeps a lesson to two slides', () => {
    const long = [{ kind: 'title' as const, title: 'T', points: [], note: '' }, ...deck.slides, { kind: 'question' as const, title: 'Q', points: ['?'], note: '' }];
    expect(lessonSlides(long).map((s) => s.kind)).toEqual(['points', 'warning']);
    expect(fallbackSlides({ title: 'T', doc_no: null, summary: 'A. B.', key_action: 'K', failure_types: [] }).map((s) => s.kind)).toEqual(['points', 'warning']);
  });
  it('lays the picture beside the text without cropping it, and the key action in its own box', () => {
    const one = layout(deck, 0);
    const pic = one.find((i) => i.t === 'pic')!;
    expect(pic.t === 'pic' && Math.abs(pic.w / pic.h - jpeg.width / jpeg.height)).toBeLessThan(0.01);
    expect(layout(deck, 1).some((i) => i.t === 'pic')).toBe(false);
    expect(layout(deck, 1).filter((i) => i.t === 'rect' && i.fill === 'FFF4D6')).toHaveLength(1);
  });
  it('writes a PowerPoint package with two slides and one picture', async () => {
    const bytes = deckPptx(deck, new Date('2026-11-17T10:00:00Z'));
    const parts = await unzip(bytes);
    expect([...parts.keys()].filter((k) => /^ppt\/slides\/slide\d\.xml$/.test(k)).sort()).toEqual(['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']);
    const slide1 = new TextDecoder().decode(parts.get('ppt/slides/slide1.xml'));
    expect(slide1).toContain('r:embed="rId2"');
    expect(slide1).toContain('Wire parted while pulling out of hole');
    expect(new TextDecoder().decode(parts.get('ppt/presentation.xml'))).toContain('<p:sldSz cx="12192000" cy="6858000"/>');
    if (process.env.DECK_OUT) writeFileSync(`${process.env.DECK_OUT}/lesson.pptx`, bytes);
  });
  it('writes a two-page widescreen PDF', () => {
    const bytes = deckPdf(deck);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(text).toContain('/MediaBox [0 0 960 540]');
    if (process.env.DECK_OUT) writeFileSync(`${process.env.DECK_OUT}/lesson.pdf`, bytes);
  });
});

describe('all of a lesson’s pictures on its slides (6z.19)', () => {
  it('spreads every picture over the slides in order', () => {
    expect(splitPictures(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b', 'c'], ['d', 'e']]);
    expect(splitPictures(['a'], 2)).toEqual([['a'], []]);
    expect(splitPictures([], 2)).toEqual([[], []]);
  });
  it('lays one, two, or up to six pictures out in a grid that fits the panel', () => {
    expect(pictureCells(1, 0, 0, 100, 100)).toEqual([{ x: 0, y: 0, w: 100, h: 100 }]);
    const two = pictureCells(2, 0, 0, 100, 106);
    expect(two.map((c) => [c.x, c.y, c.h])).toEqual([[0, 0, 50], [0, 56, 50]]);
    const four = pictureCells(4, 0, 0, 106, 106);
    expect(four.map((c) => [c.x, c.y])).toEqual([[0, 0], [56, 0], [0, 56], [56, 56]]);
    expect(pictureCells(9, 0, 0, 100, 100)).toHaveLength(6);
    expect(layout(deck, 0).filter((i) => i.t === 'pic')).toHaveLength(3);
  });
});
