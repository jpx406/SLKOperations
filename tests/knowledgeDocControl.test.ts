import { describe, expect, it } from 'vitest';
import { DEFAULT_COPY_SETTINGS, copyKind, copyTargets, makeCompanySlides, mayHaveCopies, nesrNumber } from '../src/shared/companyCopy';
import { checkDoc, nextQaf, qafNumber } from '../src/shared/knowledge';
import { deletableDraft, editableAccept, editableProblem, guessType, mayDeleteDraft, splitBase, submitProblems } from '../src/shared/knowledgeControl';
import { zip } from '../src/shared/xlsx';
import { unzip } from '../src/shared/xlsxRead';
import { readAllowed, ruleFor } from '../src/worker/permissions';

// 6z.27: client procedures without an editable version, QAF numbers for forms, lessons as slides and their company copies

const pdf = { kind: 'published' as const, content_type: 'application/pdf', file_name: 'CP.pdf' };

describe('client procedures: editable version optional (6z.27)', () => {
  it('a client procedure goes to review with its PDF alone', () => {
    expect(submitProblems({ section: 'client', summary: null }, [pdf])).toEqual([]);
    // when one is added it must still be a .docx; SOPs and SWIs still need theirs
    expect(submitProblems({ section: 'client', summary: null }, [pdf, { kind: 'source', content_type: 'x', file_name: 'CP.doc' }])[0]).toMatch(/Word file \(\.docx\)/);
    expect(submitProblems({ section: 'sop', summary: null }, [pdf])).toEqual(['Add the editable version (Word .docx)']);
    expect(submitProblems({ section: 'swi', summary: null }, [pdf])).toEqual(['Add the editable version (Word .docx)']);
  });
});

describe('forms: QAF numbers (6z.27)', () => {
  it('reads a QAF number however it is written', () => {
    expect(qafNumber('QAF14009')).toBe('QAF14009');
    expect(qafNumber('qaf-14009 Pre-job checklist')).toBe('QAF14009');
    expect(qafNumber('QAF 1400')).toBe('QAF1400');
    expect(qafNumber('FRM-GL-NESR-001')).toBeNull();
    expect(qafNumber('QAF140091234')).toBeNull();
  });

  it('gives the next free number after the highest, as wide as it', () => {
    expect(nextQaf([])).toBe('QAF00001');
    expect(nextQaf(['QAF14009', 'QAF14010', 'SOP-GL-NESR-001', null, 'QAF00999'])).toBe('QAF14011');
  });

  it('a form takes its QAF number or none, never another kind of number', () => {
    const base = { type: 'form', country: 'Global', company: 'NESR', title: 'Pre-job checklist' };
    expect(checkDoc({ ...base, doc_no: 'qaf-14009' }, [])).toMatchObject({ doc: { doc_no: 'QAF14009' } });
    expect(checkDoc({ ...base, doc_no: '' }, [])).toMatchObject({ doc: { doc_no: null } });
    expect(checkDoc({ ...base, doc_no: 'FRM-001' }, [])).toEqual({ error: 'Form numbers are QAF numbers, like QAF14009. Leave it blank to get the next one.' });
    expect(checkDoc({ ...base, doc_no: 'QAF14009X' }, [])).toHaveProperty('error');
    // a form keeps the number it already has when its details are edited (6z.30)
    expect(checkDoc({ ...base, doc_no: 'QAF-14110-GL-NESR-001' }, [], 'QAF-14110-GL-NESR-001')).toMatchObject({ doc: { doc_no: 'QAF-14110-GL-NESR-001' } });
    expect(checkDoc({ ...base, doc_no: 'FRM-GL-NESR-005' }, [], 'FRM-GL-NESR-005')).toMatchObject({ doc: { doc_no: 'FRM-GL-NESR-005' } });
    expect(checkDoc({ ...base, doc_no: 'FRM-GL-NESR-006' }, [], 'FRM-GL-NESR-005')).toHaveProperty('error');
  });

  it('Add several reads the QAF number from the file name and files it as a form', () => {
    expect(splitBase('QAF14009 Pre-job checklist')).toEqual({ doc_no: 'QAF14009', title: 'Pre-job checklist' });
    expect(splitBase('QAF-14010_Toolbox_talk')).toEqual({ doc_no: 'QAF14010', title: 'Toolbox talk' });
    expect(guessType('QAF14009 Pre-job checklist', 'sop')).toBe('form');
  });

  it('the record is open to anyone with the Knowledge Hub', () => {
    expect(readAllowed('/api/knowledge/forms-record', { knowledge_hub: { view: true, edit: false, delete: false } })).toBe(true);
  });
});

describe('lessons: slides and company copies (6z.27)', () => {
  it('a lesson’s editable version is PowerPoint or Word', () => {
    expect(editableAccept({ section: 'lesson' })).toBe('.pptx,.docx');
    expect(editableProblem({ section: 'lesson' }, 'LL-SA-004 Wire parted.pptx')).toBeNull();
    expect(editableProblem({ section: 'lesson' }, 'LL.ppt')).toMatch(/PowerPoint \(\.pptx\)/);
    expect(editableProblem({ section: 'sop' }, 'SOP.pptx')).toMatch(/Word file/);
  });

  it('lessons from any country have copies: NESR lessons for SAPESCO and Gulf Energy, theirs a NESR version (6z.28); a copy has none', () => {
    expect(mayHaveCopies({ section: 'lesson', country: 'Saudi Arabia', company: null })).toBe(true);
    expect(mayHaveCopies({ section: 'lesson', country: 'Oman', company: 'Gulf Energy' })).toBe(true);
    expect(mayHaveCopies({ section: 'lesson', country: 'Global', company: 'SAPESCO', copy_of: 'x' })).toBe(false);
    expect(copyTargets({ section: 'lesson', company: 'NESR' })).toEqual(['SAPESCO', 'Gulf Energy']);
    expect(copyTargets({ section: 'lesson', company: null })).toEqual(['SAPESCO', 'Gulf Energy']);
    expect(copyTargets({ section: 'lesson', company: 'SAPESCO' })).toEqual(['NESR']);
    expect(copyTargets({ section: 'sop', company: 'NESR' })).toEqual(['SAPESCO', 'Gulf Energy']);
    expect(nesrNumber('SAP-LL-GL-004', 'SAP')).toBe('NESR-LL-GL-004');
    expect(nesrNumber('LL-OM-002', 'GES')).toBe('NESR-LL-OM-002');
    expect(mayHaveCopies({ section: 'sop', country: 'Saudi Arabia', company: 'NESR' })).toBe(false);
    expect(copyKind({ section: 'lesson' })).toBe('slides');
    expect(copyKind({ section: 'swi' })).toBe('word');
  });

  it('a lesson says whose it is: NESR, SAPESCO or Gulf Energy, none meaning NESR (6z.28)', () => {
    const l = { type: 'lesson_learnt', country: 'Global', title: 'Wire parted', category: 'Wireline' };
    expect(checkDoc({ ...l, company: 'SAPESCO' }, [])).toMatchObject({ doc: { company: 'SAPESCO' } });
    expect(checkDoc({ ...l, company: 'NESR' }, [])).toMatchObject({ doc: { company: 'NESR' } });
    expect(checkDoc({ ...l, company: 'Someone' }, [])).toMatchObject({ doc: { company: null } });
  });
});

// ---- a small PowerPoint package, built in memory --------------------------------------------------------------

const te = new TextEncoder(), td = new TextDecoder();
const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (...r: string[]) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r.join('')}</Relationships>`;
const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`;
const text = (...runs: string[]) => `<p:sp><p:txBody><a:p>${runs.map((t) => `<a:r><a:t>${t}</a:t></a:r>`).join('')}</a:p></p:txBody></p:sp>`;
const layout = (type: string, name: string) => `<p:sldLayout ${P} type="${type}"><p:cSld name="${name}"/></p:sldLayout>`;
const types = (extra: string) => `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/>${extra}</Types>`;
const override = (part: string, t: string) => `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${t}+xml"/>`;
const pkg = (parts: Record<string, string | Uint8Array>) => zip(Object.entries(parts).map(([name, v]) => ({ name, data: typeof v === 'string' ? te.encode(v) : v })));
const png = new Uint8Array([137, 80, 78, 71, 9, 9]);

/** The NESR lesson: a title slide and a content slide with a picture, speaker notes and the NESR green. */
const nesrDeck = () => pkg({
  '[Content_Types].xml': types(`<Default Extension="png" ContentType="image/png"/>${override('ppt/slides/slide1.xml', 'slide')}${override('ppt/slides/slide2.xml', 'slide')}`),
  'ppt/presentation.xml': `<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  'ppt/_rels/presentation.xml.rels': rels(rel('rId2', 'slide', 'slides/slide1.xml'), rel('rId3', 'slide', 'slides/slide2.xml')),
  'ppt/slideLayouts/slideLayout1.xml': layout('title', 'Title Slide'),
  'ppt/slideLayouts/slideLayout2.xml': layout('obj', 'Title and Content'),
  'ppt/slides/slide1.xml': `<p:sld ${P}>${text('NE', 'SR lesson learnt')}${text('National Energy Services Reunited Corp.')}</p:sld>`,
  'ppt/slides/_rels/slide1.xml.rels': rels(rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml')),
  'ppt/slides/slide2.xml': `<p:sld ${P}>${text('See NESR-8000-SOP-11')}<a:solidFill><a:srgbClr val="024800"/></a:solidFill><p:pic><a:blip r:embed="rId2"/></p:pic></p:sld>`,
  'ppt/slides/_rels/slide2.xml.rels': rels(rel('rId1', 'slideLayout', '../slideLayouts/slideLayout2.xml'), rel('rId2', 'image', '../media/image1.png'), rel('rId3', 'notesSlide', '../notesSlides/notesSlide1.xml')),
  'ppt/notesSlides/notesSlide1.xml': `<p:notes ${P}>${text('Speaker note about NESR')}</p:notes>`,
  'ppt/media/image1.png': png,
});

/** The SAPESCO template: its own layouts (in another order) and one sample slide of its own, which is taken out. */
const sapDeck = () => pkg({
  '[Content_Types].xml': types(override('ppt/slides/slide1.xml', 'slide')),
  'ppt/presentation.xml': `<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId9"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst/></p:ext></p:extLst></p:presentation>`,
  'ppt/_rels/presentation.xml.rels': rels(rel('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'), rel('rId9', 'slide', 'slides/slide1.xml')),
  'ppt/slideMasters/slideMaster1.xml': `<p:sldMaster ${P}>${text('SAPESCO')}</p:sldMaster>`,
  'ppt/slideLayouts/slideLayout1.xml': layout('obj', 'Title and Content'),
  'ppt/slideLayouts/slideLayout2.xml': layout('title', 'Title Slide'),
  'ppt/slides/slide1.xml': `<p:sld ${P}>${text('SAPESCO sample slide')}</p:sld>`,
  'ppt/slides/_rels/slide1.xml.rels': rels(rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml')),
});

describe('lesson copies in PowerPoint (6z.27)', () => {
  it('puts the NESR slides into the company presentation, each on the same kind of layout', async () => {
    const r = await makeCompanySlides(nesrDeck(), sapDeck(), { t: DEFAULT_COPY_SETTINGS.companies.SAPESCO, nesrColours: ['024800'] });
    const out = await unzip(r.bytes, true);
    const s = (k: string) => td.decode(out.get(k)!);
    // the template's own slide is gone; the two NESR slides take its place, in order
    expect(s('ppt/presentation.xml')).toMatch(/<p:sldIdLst><p:sldId id="256" r:id="rIdCopy1"\/><p:sldId id="257" r:id="rIdCopy2"\/><\/p:sldIdLst><p:sldSz/);
    expect(s('ppt/presentation.xml')).not.toContain('sectionLst');
    expect(s('ppt/_rels/presentation.xml.rels')).not.toContain('rId9');
    expect(s('ppt/slides/slide1.xml')).not.toContain('sample');
    // title slide on the template's title layout (number 2 there), content on its content layout
    expect(s('ppt/slides/_rels/slide1.xml.rels')).toContain('Target="../slideLayouts/slideLayout2.xml"');
    expect(s('ppt/slides/_rels/slide2.xml.rels')).toContain('Target="../slideLayouts/slideLayout1.xml"');
    // the picture comes along, the speaker notes don't
    expect(s('ppt/slides/_rels/slide2.xml.rels')).toContain('Target="../media/image1.png"');
    expect(out.get('ppt/media/image1.png')).toEqual(png);
    expect(s('ppt/slides/_rels/slide2.xml.rels')).not.toContain('notesSlide');
    expect(s('[Content_Types].xml')).toContain('Extension="png"');
    expect(s('[Content_Types].xml').match(/PartName="\/ppt\/slides\/slide1\.xml"/g)).toHaveLength(1);
    // text, numbers and colour
    // "NESR" split across two runs: the change goes in the first, the second keeps the rest
    expect(s('ppt/slides/slide1.xml')).toContain('<a:t>SAPESCO</a:t></a:r><a:r><a:t> lesson learnt</a:t>');
    expect(s('ppt/slides/slide1.xml')).toContain('Sahara Petroleum Services');
    expect(s('ppt/slides/slide2.xml')).toContain('SAP-8000-SOP-11');
    expect(s('ppt/slides/slide2.xml')).toContain('val="EE0000"');
    expect(s('ppt/slideMasters/slideMaster1.xml')).toContain('SAPESCO');
    expect(r.leftovers).toEqual([]);
    expect(r.changes.map((c) => c.label)).toContain('Slide masters, layouts, theme and logo from the template');
  });

  it('turns a SAPESCO lesson back into a NESR one, in the NESR presentation (6z.28)', async () => {
    const t = DEFAULT_COPY_SETTINGS.companies.SAPESCO;
    const sap = await makeCompanySlides(nesrDeck(), sapDeck(), { t, nesrColours: ['024800'] });
    const r = await makeCompanySlides(sap.bytes, nesrDeck(), { t, nesrColours: ['024800'], toNesr: true });
    const out = await unzip(r.bytes, true);
    const s = (k: string) => td.decode(out.get(k)!);
    const all = s('ppt/slides/slide1.xml') + s('ppt/slides/slide2.xml');
    expect(all).toContain('NESR');
    expect(all).toContain('National Energy Services Reunited');
    expect(all).toContain('NESR-8000-SOP-11');
    expect(all).toContain('val="024800"');
    expect(all).not.toMatch(/SAPESCO|Sahara|SAP-|EE0000/);
    // the NESR deck's own two slides were taken out, the two lesson slides put in
    expect(s('ppt/presentation.xml').match(/<p:sldId /g)).toHaveLength(2);
    expect(r.leftovers).toEqual([]);
    expect(r.changes.map((c) => c.label)).toEqual(expect.arrayContaining(['SAPESCO → NESR', 'SAP numbers → NESR', 'Sahara Petroleum Services → National Energy Services Reunited']));
  });

  it('refuses files that are not presentations', async () => {
    await expect(makeCompanySlides(new Uint8Array([1, 2, 3]), sapDeck(), { t: DEFAULT_COPY_SETTINGS.companies.SAPESCO, nesrColours: [] })).rejects.toThrow('not a PowerPoint file');
    await expect(makeCompanySlides(nesrDeck(), pkg({ 'word/document.xml': '<w:document/>' }), { t: DEFAULT_COPY_SETTINGS.companies.SAPESCO, nesrColours: [] })).rejects.toThrow('company template');
  });
});

describe('deleting drafts (6z.29)', () => {
  it('only a document never published, with drafts alone, is deleted; others are retired', () => {
    expect(deletableDraft({ published_at: null }, ['draft'])).toBe(true);
    expect(deletableDraft({ published_at: null }, ['discarded', 'draft'])).toBe(true);
    expect(deletableDraft({ published_at: null }, ['review'])).toBe(false);
    expect(deletableDraft({ published_at: null }, ['approval'])).toBe(false);
    expect(deletableDraft({ published_at: '2026-11-01T00:00:00Z' }, ['approved', 'draft'])).toBe(false);
  });
  it('admins, approvers, editors or the delete right may delete; a reviewer alone may not', () => {
    const base = { username: 'x', admin: false, editor: false, reviewer: false, approver: false };
    expect(mayDeleteDraft({ ...base, admin: true })).toBe(true);
    expect(mayDeleteDraft({ ...base, approver: true })).toBe(true);
    expect(mayDeleteDraft({ ...base, editor: true })).toBe(true);
    expect(mayDeleteDraft({ ...base, reviewer: true })).toBe(false);
    expect(mayDeleteDraft({ ...base, reviewer: true }, true)).toBe(true);
    expect(ruleFor('DELETE', '/api/knowledge/abc')).toMatchObject({ menu: 'knowledge_hub', action: 'view' });
  });
});
