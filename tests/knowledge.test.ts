import { describe, expect, it } from 'vitest';
import {
  checkDoc, docPrefix, fileKey, filterLibrary, groupByPlace, lessonOfWeek, placeCode, proceduresForJob, reviewState, type KnowledgeDoc,
} from '../src/shared/knowledge';
import { readAllowed, ruleFor } from '../src/worker/permissions';

const doc = (o: Partial<KnowledgeDoc>): KnowledgeDoc => ({
  id: 'd', section: 'lesson', country: 'Saudi Arabia', company: null, client: null, doc_type: 'lesson_learnt', category: 'Wireline', title: 'T', summary: null, key_action: null,
  failure_types: [], published_on: '2026-01-01', rilr_ref: null, source_ref: null, duplicate_of: null, lesson_of_week_from: null, doc_no: null, revision: 0, review_due: null,
  retired_at: null, ...o,
});
const MINE = ['Saudi Arabia', 'Bahrain'];

describe('knowledge hub', () => {
  it('cleans a lesson and only accepts web links', () => {
    expect(checkDoc({ type: 'memo', title: 'x', category: 'c', country: 'Global' }, MINE)).toEqual({ error: 'Pick the document type' });
    expect(checkDoc({ type: 'best_practice', title: ' ', category: 'c', country: 'Global' }, MINE)).toHaveProperty('error');
    expect(checkDoc({ type: 'best_practice', title: 'x', category: 'c', country: 'Global', source_ref: 'javascript:alert(1)' }, MINE)).toEqual({ error: 'The link must start with https://' });
    const ok = checkDoc({ doc_type: 'best_practice', title: ' Jar check ', category: 'Tools', country: 'Bahrain', failure_types: ['Stuck tool', 'Stuck tool', ''], source_ref: 'https://example.sharepoint.com/a' }, MINE);
    expect(ok).toMatchObject({ doc: { section: 'lesson', doc_type: 'best_practice', title: 'Jar check', failure_types: ['Stuck tool'], summary: null, company: null } });
  });
  it('files each type in its section, under a country or Global', () => {
    expect(checkDoc({ type: 'lesson_learnt', title: 'x', category: 'c', country: 'Oman' }, MINE)).toEqual({ error: 'Pick a country or Global' });
    expect(checkDoc({ type: 'sop', title: 'Rig up', country: 'Global' }, MINE)).toEqual({ error: 'Pick the company: NESR, SAPESCO or Gulf Energy' });
    const sop = checkDoc({ type: 'sop', title: 'Rig up', country: 'Global', company: 'Gulf Energy', category: '', key_action: 'ignored', review_due: '2027-01-01', doc_no: ' nesr-slk-sop-012 ' }, MINE);
    expect(sop).toMatchObject({ doc: { section: 'sop', company: 'Gulf Energy', doc_type: null, category: null, key_action: null, review_due: '2027-01-01', doc_no: 'NESR-SLK-SOP-012' } });
    expect(checkDoc({ type: 'client', title: 'Permit to work', country: 'Global', client: 'Aramco' }, MINE)).toEqual({ error: 'Pick the country of the client' });
    expect(checkDoc({ type: 'client', title: 'Permit to work', country: 'Bahrain' }, MINE)).toEqual({ error: 'Name the client' });
    expect(checkDoc({ type: 'client', title: 'Permit to work', country: 'Bahrain', client: 'Bapco', company: 'NESR' }, MINE)).toMatchObject({ doc: { section: 'client', client: 'Bapco', company: null } });
    expect(checkDoc({ type: 'sop', title: 'x', country: 'Global', company: 'NESR', doc_no: 'A;B' }, MINE)).toHaveProperty('error');
  });
  it('numbers documents by section, place and company', () => {
    expect(placeCode('Global')).toBe('GL');
    expect(placeCode('Saudi Arabia')).toBe('SA');
    expect(placeCode('Bahrain')).toBe('BAH');
    expect(docPrefix({ section: 'sop', country: 'Global', company: 'NESR' })).toBe('SOP-GL-NESR');
    expect(docPrefix({ section: 'sop', country: 'Saudi Arabia', company: 'Gulf Energy' })).toBe('SOP-SA-GE');
    expect(docPrefix({ section: 'client', country: 'Bahrain', company: null })).toBe('CP-BAH');
    expect(docPrefix({ section: 'lesson', country: 'Saudi Arabia', company: null })).toBe('LL-SA');
  });
  it('files objects in R2 like a filing cabinet, one folder per revision', () => {
    const d = { section: 'sop' as const, country: 'Global', company: 'NESR', client: null, doc_no: 'SOP-GL-NESR-001', title: 'Rig up / rig down' };
    expect(fileKey(d, 2, 'source', 'abcdef123456', 'SOP.docx')).toBe('knowledge/SOPs/Global/NESR/SOP-GL-NESR-001 Rig up rig down/Rev 2/editable/abcdef12 SOP.docx');
    expect(fileKey({ ...d, section: 'client', company: null, client: 'Saudi Aramco', country: 'Saudi Arabia', doc_no: null }, 0, 'published', 'x1234567', 'a.pdf'))
      .toBe('knowledge/Client procedures/Saudi Arabia/Saudi Aramco/Rig up rig down/Rev 0/document/x1234567 a.pdf');
  });
  it('lists Global first, then each country A to Z', () => {
    const g = groupByPlace([doc({ id: '1', country: 'Saudi Arabia' }), doc({ id: '2', country: 'Global' }), doc({ id: '3', country: 'Bahrain' }), doc({ id: '4', country: 'Global' })]);
    expect(g.map((x) => [x.place, x.docs.map((d) => d.id)])).toEqual([['Global', ['2', '4']], ['Bahrain', ['3']], ['Saudi Arabia', ['1']]]);
  });
  it('shows a job the client procedures of its country, its own client first', () => {
    const docs = [doc({ id: 'a', section: 'client', client: 'Bapco', country: 'Bahrain', title: 'B' }), doc({ id: 'b', section: 'client', client: 'Aramco', country: 'Saudi Arabia' }),
      doc({ id: 'c', section: 'client', client: 'Tatweer', country: 'Bahrain', title: 'A' }), doc({ id: 'd', section: 'client', client: 'Bapco', country: 'Bahrain', retired_at: '2026-01-01' }),
      doc({ id: 'e', section: 'sop', country: 'Bahrain' })];
    expect(proceduresForJob(docs, 'Bahrain', 'tatweer').map((d) => d.id)).toEqual(['c', 'a']);
    expect(proceduresForJob(docs, 'Bahrain').map((d) => d.id)).toEqual(['a', 'c']);
  });
  it('flags reviews that are overdue or due within 30 days', () => {
    expect(reviewState(null, '2026-11-17')).toBeNull();
    expect(reviewState('2026-11-16', '2026-11-17')).toBe('overdue');
    expect(reviewState('2026-12-10', '2026-11-17')).toBe('soon');
    expect(reviewState('2027-03-01', '2026-11-17')).toBeNull();
  });
  it('picks the latest lesson of the week on or before today, else the newest lesson', () => {
    const a = doc({ id: 'a', published_on: '2026-09-01' }), b = doc({ id: 'b', published_on: '2026-03-01', lesson_of_week_from: '2026-10-20' });
    const c = doc({ id: 'c', lesson_of_week_from: '2026-11-01' }), dup = doc({ id: 'x', published_on: '2026-10-01', duplicate_of: 'a' });
    const sop = doc({ id: 's', section: 'sop', published_on: '2026-12-01' });
    expect(lessonOfWeek([a, b, c, dup], '2026-10-25')?.id).toBe('b');
    expect(lessonOfWeek([a, dup, sop], '2026-10-25')?.id).toBe('a');
    expect(lessonOfWeek([], '2026-10-25')).toBeNull();
  });
  it('filters, hides duplicates, and counts each chip row under the other filters', () => {
    const docs = [doc({ id: '1', title: 'B', category: 'Wireline', failure_types: ['Wire parted'] }), doc({ id: '2', title: 'A', category: 'PCE', doc_type: 'best_practice', published_on: '2026-05-01', country: 'Global' }),
      doc({ id: '3', title: 'C', category: 'Wireline', duplicate_of: '1' })];
    const r = filterLibrary(docs, { category: 'Wireline' });
    expect(r.docs.map((d) => d.id)).toEqual(['1']);
    expect(r.categories).toEqual([{ value: 'PCE', n: 1 }, { value: 'Wireline', n: 1 }]);
    expect(r.types).toEqual([{ value: 'lesson_learnt', n: 1 }]);
    expect(filterLibrary(docs, { duplicates: true, sort: 'az' }).docs.map((d) => d.id)).toEqual(['2', '1', '3']);
    expect(filterLibrary(docs, { q: 'parted' }).docs.map((d) => d.id)).toEqual(['1']);
    expect(filterLibrary(docs, { place: 'Global' }).docs.map((d) => d.id)).toEqual(['2']);
  });
  it('lets the tab read and download, and only its edit right write', () => {
    const view = { knowledge_hub: { view: true, edit: false, delete: false } };
    expect(readAllowed('/api/knowledge', view)).toBe(true);
    expect(readAllowed('/api/knowledge/abc/files', view)).toBe(true);
    expect(readAllowed('/api/knowledge/abc/files/f1', view)).toBe(true);
    expect(readAllowed('/api/knowledge/abc/files/f1', {})).toBe(false);
    expect(ruleFor('POST', '/api/knowledge')).toMatchObject({ menu: 'knowledge_hub', action: 'edit' });
    expect(ruleFor('PUT', '/api/knowledge/abc')).toMatchObject({ menu: 'knowledge_hub', action: 'edit' });
    expect(ruleFor('POST', '/api/knowledge/abc/lesson-of-week')).toMatchObject({ menu: 'knowledge_hub', action: 'edit' });
    expect(ruleFor('POST', '/api/knowledge/abc/files')).toMatchObject({ menu: 'knowledge_hub', action: 'edit' });
    expect(ruleFor('POST', '/api/knowledge/abc/retire')).toMatchObject({ menu: 'knowledge_hub', action: 'view' });
    // drafts that were never published can be deleted (6z.29); the route checks the role and the draft
    expect(ruleFor('DELETE', '/api/knowledge/abc')).toMatchObject({ menu: 'knowledge_hub', action: 'view' });
  });
});
