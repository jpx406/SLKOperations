import { existsSync, readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { EMPTY_CONTENT, cleanContent, cleanDraft, mayCreate, mayDo, nextLessonNumber, submitProblems, type LessonContent } from '../src/shared/lessons';
import { chrome, layoutLesson, layoutProblem, measureParts, pageOps, partsOf, tidyBoxes, tint, type PageInput } from '../src/shared/lessonLayout';
import { lessonPdf, pdfSafe } from '../src/shared/lessonPdf';
import { lessonPptx, templateLogo, templateStyle } from '../src/shared/lessonPptx';
import { unzip } from '../src/shared/xlsxRead';
import { imageSize } from '../src/worker/lessons';
import { ruleFor, readAllowed } from '../src/worker/permissions';

const full: LessonContent = cleanContent({
  ...EMPTY_CONTENT, key_lesson: 'Never pull the prong before the check-set run confirms the plug.', event_date: '2026-11-12', field: 'Abqaiq', well: 'ABQQ-538', job: 'Set PR plug', unit: 'SL-031', category: 'Well barrier',
  description: 'Plug set at 2,500 ft; 500 psi test passed.\nOn the prong run the plug was not found in the profile.\nPlug recovered from 2,740 ft.',
  damage: ['Lost well barrier', 'Client NPT', 'Reputation'],
  immediate_cause: 'Failure to follow instructions: the prong was pulled before the check-set run.', root_cause: 'Attempt to save time: no hold point in the program.',
  actions: [{ action: 'Inspect the plug at the workshop', responsible: 'SDM', due: '2026-11-30' }, { action: 'Stand-down with all crews', responsible: 'TSM', due: '2026-12-02' }],
  pictures: [{ id: 'pic-00000001', caption: 'Plug as recovered', section: 'description', w: 1600, h: 1200, type: 'image/jpeg' }],
});
const input = (content: LessonContent, over: Partial<PageInput> = {}): PageInput => ({
  kind: 'lesson_learnt', company: 'NESR', country: 'Saudi Arabia', title: 'PR plug not found in nipple profile', content, colour: '024800', docNo: 'LL-SA-015', revision: '00',
  signoff: { date: '2026-11-26', changes: 'First version', prepared: 'C. Preparer', reviewed: 'A. Reviewer', approver: 'B. Approver', position: 'Operations Manager' }, ...over,
});

describe('lessons and best practices', () => {
  it('cleans the page content and keeps choices in range', () => {
    const c = cleanContent({ description_as: 'nonsense', damage: ['A', 'A', ' B '], event_date: '12/11/2026', actions: [{ action: '' }, { action: 'Do', due: 'soon' }], ai: ['header', 'x'], pictures: [{ id: 'bad' }] });
    expect(c.description_as).toBe('bullets');
    expect(c.damage).toEqual(['A', 'B']);
    expect(c.event_date).toBe('');
    expect(c.actions).toEqual([{ action: 'Do', responsible: '', due: '' }]);
    expect(c.ai).toEqual(['header']);
    expect(c.pictures).toEqual([]);
  });
  it('lists what stops it going for review, AI parts included', () => {
    expect(submitProblems('', EMPTY_CONTENT, true)).toEqual(['Give it a title', 'Write the description', 'Write the analysis', 'Add at least one action']);
    expect(submitProblems('T', { ...full, ai: ['actions'] }, true)).toEqual(['Check the parts AI wrote: Actions']);
    expect(submitProblems('T', full, false)).toHaveLength(1);
    expect(submitProblems('T', full, true)).toEqual([]);
  });
  it('turns the AI answer into flagged content', () => {
    const d = cleanDraft({ title: 'Wire parted', description: ['One', 'Two'], damage: ['Client NPT'], immediate_cause: ['Equipment failure: x'], root_cause: [], whys: [], actions: [{ action: 'A', responsible: 'Ops Manager', due: '2026-12-01' }], event_date: 'n/a' }, 'best_practice');
    expect(d.title).toBe('Wire parted');
    expect(d.content.description).toBe('One\nTwo');
    expect(d.content.damage).toEqual([]);
    expect(d.content.event_date).toBe('');
    expect(d.content.ai).not.toContain('damage');
    expect(d.content.ai).toContain('actions');
    expect(d.content).not.toHaveProperty('pictures');
  });
  it('numbers the Knowledge Hub way, shared by the companies', () => {
    const taken = ['LL-SA-013', 'SAP-LL-SA-014', 'GES-LL-SA-002', 'LL-BAH-020', 'BP-SA-003', 'LL-SA-X'];
    expect(nextLessonNumber('LL-SA', null, taken)).toBe('LL-SA-015');
    expect(nextLessonNumber('LL-SA', 'SAP', taken)).toBe('SAP-LL-SA-015');
    expect(nextLessonNumber('BP-SA', 'GES', taken)).toBe('GES-BP-SA-004');
    expect(nextLessonNumber('LL-QA', null, taken)).toBe('LL-QA-001');
  });
  it('lets approvers and admins start, and the chosen people act', () => {
    const approver = { username: 'A', admin: false, approver: true, reviewer: false };
    const plain = { username: 'P', admin: false, approver: false, reviewer: true };
    expect(mayCreate(approver)).toBe(true);
    expect(mayCreate(plain)).toBe(false);
    const row = { status: 'review' as const, created_by: 'A', reviewer: 'P', approver: 'Z', submitted_by: 'A' };
    expect(mayDo(plain, row, 'edit')).toBe(true);
    expect(mayDo(plain, row, 'review')).toBe(true);
    expect(mayDo(approver, row, 'edit')).toBe(false);
    expect(mayDo(approver, { ...row, status: 'approval' }, 'approve')).toBe(false);
    expect(mayDo({ ...approver, username: 'Z' }, { ...row, status: 'approval' }, 'approve')).toBe(true);
    expect(mayDo(approver, { ...row, status: 'draft', doc_no: 'LL-SA-001' }, 'delete')).toBe(false);
    expect(mayDo(approver, { ...row, status: 'approved' }, 'revise')).toBe(true);
  });
  it('needs only the Utilities view to reach the routes; the route checks the rest', () => {
    expect(ruleFor('POST', '/api/lessons/abc/approve')).toMatchObject({ menu: 'utilities', action: 'view' });
    expect(ruleFor('PUT', '/api/lessons/abc')).toMatchObject({ menu: 'utilities' });
    expect(readAllowed('/api/lessons/abc/pdf', { utilities: { view: true, edit: false, delete: false } })).toBe(true);
    expect(readAllowed('/api/lessons/templates/NESR/lesson_learnt', { knowledge_hub: { view: true, edit: false, delete: false } })).toBe(true);
    expect(readAllowed('/api/lessons', { jobs: { view: true, edit: true, delete: false } })).toBe(false);
  });
});

describe('the page layout', () => {
  it('fits a full lesson on one page at a readable size', () => {
    const lay = layoutLesson(input(full));
    expect(lay.fits).toBe(true);
    expect(lay.size).toBeGreaterThanOrEqual(9);
    // nothing runs into the sign-off tables
    for (const b of lay.blocks) expect(b.y + b.h).toBeLessThanOrEqual(680);
  });
  it('shrinks the text, then says when it still does not fit', () => {
    const long = { ...full, description: Array.from({ length: 40 }, (_, i) => `Step ${i + 1}: a long line of description that goes on and on about what happened at the well site that day.`).join('\n') };
    expect(layoutLesson(input(long)).fits).toBe(false);
    const mid = { ...full, description: Array.from({ length: 13 }, () => 'A line of description long enough to wrap onto a second line on the page.').join('\n') };
    const r = layoutLesson(input(mid));
    expect(r.fits).toBe(true);
    expect(r.size).toBeLessThan(10.5);
  });
  it('draws every layout choice', () => {
    for (const pictures_as of ['right', 'row', 'large'] as const) for (const analysis_as of ['side', 'stacked', 'whys'] as const) {
      for (const description_as of ['bullets', 'paragraph', 'timeline'] as const) {
        const ops = pageOps(input({ ...full, pictures_as, analysis_as, description_as, whys: ['Why a', 'Why b'], actions_as: description_as === 'bullets' ? 'list' : 'table', damage_as: 'list' }), null).ops;
        expect(ops.some((o) => o.o === 'img')).toBe(true);
        expect(ops.filter((o) => o.o === 'text').map((o) => (o as { t: string }).t).join(' ')).toContain('Plug');
      }
    }
  });
  it('puts the template values on the slide and the labels on the master', () => {
    const ch = chrome(input(full), null);
    const words = (bs: typeof ch.slide) => bs.flatMap((b) => (b.k === 'text' ? b.paras.flatMap((p) => p.runs.map((r) => r.t)) : []));
    expect(words(ch.slide)).toEqual(expect.arrayContaining(['PR plug not found in nipple profile', 'LL-SA-015 · Rev 00 · Page 1 of 1', 'B. Approver', 'Operations Manager', '26 Nov 2026']));
    expect(words(ch.master)).toEqual(expect.arrayContaining(['Lesson Learnt', 'Prepared By (Name)', 'Document #']));
    expect(words(ch.master).join(' ')).toContain('NESR KNOWLEDGE DATABASE');
    expect(tint('024800', 1)).toBe('FFFFFF');
  });
  it('makes a one-page PDF with the pictures', async () => {
    const jpeg = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='), (c) => c.charCodeAt(0));
    expect(imageSize(jpeg)).toEqual({ w: 1, h: 1, type: 'image/jpeg' });
    const pdf = await lessonPdf(input({ ...full, description: `${full.description}\nPressure ≥ 3,000 psi → bleed off` }), new Map([['pic-00000001', { bytes: jpeg, type: 'image/jpeg' }]]), null, 'Test');
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF')).toBe(true);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    expect(pdfSafe('a ≥ b → c ✓ “ok” – 2″')).toBe('a >= b -> c v “ok” – 2"');
  });
});

describe('boxes placed by hand or by AI', () => {
  const withFacts = { ...full, facts: 'Load cell gap: closed to 0.2 mm\nAdjustment screws found loose', facts_as: 'numbered' as const };
  it('adds facts and findings as a part, in order and in the AI draft', () => {
    expect(partsOf(input(withFacts))).toEqual(['meta', 'key', 'description', 'facts', 'damage', 'analysis', 'pic:pic-00000001', 'actions']);
    expect(layoutLesson(input(withFacts)).fits).toBe(true);
    const ops = pageOps(input(withFacts), null).ops.filter((o) => o.o === 'text').map((o) => (o as { t: string }).t).join(' ');
    expect(ops).toContain('Facts and findings');
    expect(ops).toContain('Load cell gap:');
    expect(cleanDraft({ title: 'x', facts: ['A', 'B'] }, 'lesson_learnt').content.facts).toBe('A\nB');
    expect(cleanDraft({ title: 'x', facts: [] }, 'lesson_learnt').content.ai).not.toContain('facts');
  });
  it('starts the boxes where the parts sit in order, with nothing to fix', () => {
    const auto = layoutLesson(input(withFacts));
    const boxes = tidyBoxes(auto.regions, input(withFacts));
    const free = layoutLesson(input({ ...withFacts, layout: { mode: 'free', boxes } }));
    expect(free.issues).toEqual([]);
    expect(free.fits).toBe(true);
  });
  it('names boxes that overlap, overflow, leave the page or are new', () => {
    const boxes = { meta: { x: 18, y: 84, w: 504, h: 30 }, key: { x: 18, y: 100, w: 504, h: 40 }, description: { x: 18, y: 150, w: 200, h: 20 }, damage: { x: 18, y: 600, w: 504, h: 200 } };
    const r = layoutLesson(input({ ...full, layout: { mode: 'free', boxes } }));
    const kinds = r.issues.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['overlap', 'overflow', 'outside', 'unplaced']));
    expect(r.fits).toBe(false);
    expect(layoutProblem(r)).toMatch(/overlap/);
    expect(submitProblems('T', full, layoutProblem(r) ?? true).join(' ')).toMatch(/overlap/);
  });
  it('keeps boxes on the page and snapped, and measures each part for the AI', () => {
    expect(tidyBoxes({ key: { x: -40, y: 900, w: 700, h: 10 } }, input(full)).key).toEqual({ x: 18, y: 661, w: 504, h: 15 });
    const m = measureParts(input(full));
    const desc = m.find((p) => p.id === 'description')!;
    expect(desc.picture).toBe(false);
    expect((desc as { heights: Record<number, number> }).heights[168]).toBeGreaterThan((desc as { heights: Record<number, number> }).heights[504]);
    expect(m.find((p) => p.id.startsWith('pic:'))).toMatchObject({ picture: true, aspect: 1.33 });
  });
  it('keeps a cleaned layout to known parts on the page', () => {
    const c = cleanContent({ layout: { mode: 'free', boxes: { key: { x: 10, y: 20, w: 30, h: 40 }, evil: { x: 1, y: 1, w: 50, h: 50 }, 'pic:abc': { x: 1, y: 1, w: 50, h: 50 }, description: { x: 'a' } } } });
    expect(c.layout).toEqual({ mode: 'free', boxes: { key: { x: 10, y: 20, w: 30, h: 40 } } });
  });
});

const TPL = 'C:/Users/JuanCeron/OneDrive - National Energy Services Reunited Corp/Slickline_Library_Documents/Lesson Learnt/GES_NESR_Lesson_Learnt_TEMP.pptx';
describe.skipIf(!existsSync(TPL))('the PowerPoint on a company template (local template file)', () => {
  it('reads the colours of each template', async () => {
    const dir = TPL.replace(/[^/]+$/, '');
    expect(await templateStyle(new Uint8Array(readFileSync(TPL)))).toMatchObject({ band: null, title: '863A3A', body: { top: 82, bottom: 677 } });
    if (existsSync(dir + 'NESR_Lesson_Learnt_TEMP.pptx')) expect(await templateStyle(new Uint8Array(readFileSync(dir + 'NESR_Lesson_Learnt_TEMP.pptx')))).toMatchObject({ band: '006600', title: 'FFFFFF', bar: '92D050' });
    if (existsSync(dir + 'SAP_NESR_Lesson_Learnt_TEMP.pptx')) expect(await templateStyle(new Uint8Array(readFileSync(dir + 'SAP_NESR_Lesson_Learnt_TEMP.pptx')))).toMatchObject({ band: null, title: 'C00000', bar: 'C00000' });
  });
  it('puts the logo from a zip into the PDF (JPEG and PNG)', async () => {
    const dir = TPL.replace(/[^/]+$/, '');
    for (const f of ['SAP_NESR_Lesson_Learnt_TEMP.pptx', 'GES_NESR_Lesson_Learnt_TEMP.pptx'].filter((x) => existsSync(dir + x))) {
      const logo = (await templateLogo(new Uint8Array(readFileSync(dir + f))))!;
      const pdf = await lessonPdf(input(full), new Map(), logo, 'Logo');
      expect(pdf.length, f).toBeGreaterThan(logo.bytes.length * 0.5);
    }
  });
  it('replaces the template slide with the lesson, keeping the master and logo', async () => {
    const tpl = new Uint8Array(readFileSync(TPL));
    const logo = await templateLogo(tpl);
    expect(logo?.type).toBe('image/png');
    const lay = layoutLesson(input(full, { company: 'Gulf Energy', colour: '863A3A' }));
    const out = await lessonPptx(tpl, [...chrome(input(full), null).slide, ...lay.blocks], new Map([['pic-00000001', { bytes: logo!.bytes, type: 'image/png' }]]));
    const files = await unzip(out, true);
    const slides = [...files.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
    expect(slides).toEqual(['ppt/slides/slide1.xml']);
    const slide = new TextDecoder().decode(files.get('ppt/slides/slide1.xml'));
    expect(slide).toContain('PR plug not found in nipple profile');
    expect(slide).toContain('<a:tbl>');
    expect(slide).not.toContain('3.688');
    const rels = new TextDecoder().decode(files.get('ppt/slides/_rels/slide1.xml.rels'));
    expect(rels).toContain('slideLayout');
    expect(rels).toMatch(/media\/lesson\d+\.png/);
    expect(new TextDecoder().decode(files.get('ppt/presentation.xml'))).toMatch(/<p:sldIdLst><p:sldId id="256" r:id="rIdLesson1"\/><\/p:sldIdLst>/);
    const blank = await unzip(await lessonPptx(tpl, [], new Map()), true);
    expect(new TextDecoder().decode(blank.get('ppt/slides/slide1.xml'))).not.toContain('<a:t>');
  });
});
