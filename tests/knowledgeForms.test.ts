import { describe, expect, it } from 'vitest';
import { analysisPrompt, answerSchema, cleanSuggestion, extractText } from '../src/shared/docAnalysis';
import { checkDoc, docPrefix, fileKey, hasCompany } from '../src/shared/knowledge';
import { DEFAULT_NUMBERING, checkNumbering, guessType, mayOpen, numberPrefix, splitBase, submitProblems } from '../src/shared/knowledgeControl';
import { zip } from '../src/shared/xlsx';
import { ruleFor } from '../src/worker/permissions';

const enc = (s: string) => new TextEncoder().encode(s);
const MINE = ['Saudi Arabia', 'Bahrain'];

describe('Forms and work instructions (6z.15)', () => {
  it('files SWIs and forms under Global or a country and a company, numbered SWI- and FRM-', () => {
    expect(hasCompany('swi') && hasCompany('form') && !hasCompany('client')).toBe(true);
    expect(checkDoc({ type: 'form', title: 'Pre-job checklist', country: 'Global' }, MINE)).toEqual({ error: 'Pick the company: NESR, SAPESCO or Gulf Energy' });
    expect(checkDoc({ type: 'form', title: 'Pre-job checklist', country: 'Global', company: 'NESR' }, MINE)).toMatchObject({ doc: { section: 'form', is_form: 1, company: 'NESR' } });
    expect(checkDoc({ type: 'swi', title: 'Rope socket', country: 'Bahrain', company: 'SAPESCO' }, MINE)).toMatchObject({ doc: { section: 'swi', is_form: 0 } });
    expect(docPrefix({ section: 'swi', country: 'Global', company: 'NESR' })).toBe('SWI-GL-NESR');
    expect(numberPrefix({ section: 'form', country: 'Saudi Arabia', company: 'Gulf Energy' })).toBe('FRM-SA-GE');
    expect(fileKey({ section: 'form', country: 'Global', company: 'NESR', client: null, doc_no: 'FRM-GL-NESR-001', title: 'Checklist' }, 0, 'published', 'abcdefgh1', 'c.xlsx'))
      .toBe('knowledge/Forms/Global/NESR/FRM-GL-NESR-001 Checklist/Rev 0/document/abcdefgh c.xlsx');
  });
  it('lets a form go to review with its original file only, and everyone download it as it is', () => {
    const xlsx = { kind: 'published' as const, content_type: 'application/vnd.ms-excel', file_name: 'a.xlsx' };
    expect(submitProblems({ section: 'form', summary: null }, [])).toEqual(['Add the form file (Excel, Word, PowerPoint or PDF)']);
    expect(submitProblems({ section: 'form', summary: null }, [xlsx])).toEqual([]);
    expect(submitProblems({ section: 'swi', summary: null }, [xlsx])).toEqual(['The document file must be a PDF', 'Add the editable version (Word or Excel)']);
    const reader = { username: 'r', admin: false, editor: false, reviewer: false, approver: false };
    expect(mayOpen(reader, { kind: 'published', revision: 0 }, { revision: 0, published_at: 'x', is_form: 1 }, 'approved')).toBe(true);
    expect(mayOpen(reader, { kind: 'source', revision: 0 }, { revision: 0, published_at: 'x', is_form: 1 }, 'approved')).toBe(true);
  });
  it('keeps numbering saved before the new sections working', () => {
    const old = { mode: 'auto', digits: 3, place: true, prefix: { lesson: 'LL', sop: 'SOP', client: 'CP' } };
    expect(checkNumbering(old)).toEqual({ value: DEFAULT_NUMBERING });
    expect(checkNumbering({ ...old, prefix: { ...old.prefix, swi: 'SOP' } })).toEqual({ error: 'Each section needs its own prefix' });
  });
  it('reads the type and number from batch file names', () => {
    expect(guessType('SWI-GL-NESR-004 Rope socket', 'sop')).toBe('swi');
    expect(guessType('FRM-SA-NESR-010 Pre-job checklist', 'sop')).toBe('form');
    expect(splitBase('Form Daily unit check')).toEqual({ doc_no: null, title: 'Daily unit check' });
  });
  it('reads the text of Word, PowerPoint and Excel files for the AI', async () => {
    const docx = zip([{ name: 'word/document.xml', data: enc('<w:document><w:body><w:p><w:r><w:t>NESR-SLK-SWI-004</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Rope socket </w:t></w:r><w:r><w:t>make-up &amp; test</w:t></w:r></w:p></w:body></w:document>') }]);
    expect(await extractText('swi.docx', docx)).toBe('NESR-SLK-SWI-004\nRope socket make-up & test');
    const pptx = zip([{ name: 'ppt/slides/slide2.xml', data: enc('<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>') }, { name: 'ppt/slides/slide1.xml', data: enc('<p:sld><a:p><a:r><a:t>Lesson: wire parted</a:t></a:r></a:p></p:sld>') }]);
    expect(await extractText('ll.pptx', pptx)).toBe('Slide 1\nLesson: wire parted\n\nSlide 2\nSecond');
    const xlsx = zip([{ name: 'xl/sharedStrings.xml', data: enc('<sst><si><t>Daily unit checklist</t></si><si><t>FRM-001</t></si></sst>') }]);
    expect(await extractText('f.xlsx', xlsx)).toBe('Daily unit checklist\nFRM-001');
    expect(await extractText('a.pdf', enc('%PDF'))).toBeNull();
    expect(await extractText('notes.txt', enc('hello'))).toBe('hello');
  });
  it('asks for every field with a fixed shape, and cleans the answer before it reaches the form', () => {
    const schema = answerSchema(MINE);
    expect(schema.required).toContain('doc_no');
    expect(schema.properties.country.enum).toEqual(['Global', ...MINE]);
    expect(analysisPrompt({ fileName: 'x.pdf', places: MINE, clients: [], categories: [], today: '2026-11-17', sectionHint: 'sop' })).toContain('Never invent');
    const s = cleanSuggestion({ type: 'swi', country: 'Oman', company: 'ACME', title: ' Rope socket ', doc_no: 'nesr-swi-004!', revision: '03', revision_date: '2026-02-30x', published_on: '2026-03-01',
      failure_types: ['a', 3], origin: 'external', notes: 'Check the author' }, MINE, 'sop');
    expect(s).toMatchObject({ type: 'swi', country: 'Global', company: '', title: 'Rope socket', doc_no: 'NESR-SWI-004', revision: '3', revision_date: '', published_on: '2026-03-01', failure_types: ['a'], origin: 'external' });
    expect(cleanSuggestion({ type: 'nonsense' }, MINE, 'form').type).toBe('form');
    expect(cleanSuggestion({ type: 'client', country: 'Global' }, MINE, 'sop').country).toBe('Saudi Arabia');
  });
  it('lets editors run the analysis', () => {
    expect(ruleFor('POST', '/api/knowledge/analyse')).toMatchObject({ menu: 'knowledge_hub', action: 'edit' });
  });
});
