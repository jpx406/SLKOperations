import { describe, expect, it } from 'vitest';
import { checkDoc, filterLibrary, lessonOfWeek, type KnowledgeDoc } from '../src/shared/knowledge';
import { readAllowed, ruleFor } from '../src/worker/permissions';

const doc = (o: Partial<KnowledgeDoc>): KnowledgeDoc => ({
  id: 'd', country: 'Saudi Arabia', doc_type: 'lesson_learnt', category: 'Wireline', title: 'T', summary: null, key_action: null, failure_types: [],
  published_on: '2026-01-01', rilr_ref: null, source_ref: null, duplicate_of: null, lesson_of_week_from: null, ...o,
});

describe('knowledge hub', () => {
  it('cleans an entry and only accepts web links', () => {
    expect(checkDoc({ doc_type: 'memo', title: 'x', category: 'c' })).toEqual({ error: 'Pick the document type' });
    expect(checkDoc({ doc_type: 'best_practice', title: ' ', category: 'c' })).toHaveProperty('error');
    expect(checkDoc({ doc_type: 'best_practice', title: 'x', category: 'c', source_ref: 'javascript:alert(1)' })).toEqual({ error: 'The link must start with https://' });
    const ok = checkDoc({ doc_type: 'best_practice', title: ' Jar check ', category: 'Tools', failure_types: ['Stuck tool', 'Stuck tool', ''], source_ref: 'https://example.sharepoint.com/a' });
    expect(ok).toMatchObject({ doc: { title: 'Jar check', failure_types: ['Stuck tool'], summary: null } });
  });
  it('picks the latest lesson of the week on or before today, else the newest lesson', () => {
    const a = doc({ id: 'a', published_on: '2026-09-01' }), b = doc({ id: 'b', published_on: '2026-03-01', lesson_of_week_from: '2026-10-20' });
    const c = doc({ id: 'c', lesson_of_week_from: '2026-11-01' }), dup = doc({ id: 'x', published_on: '2026-10-01', duplicate_of: 'a' });
    expect(lessonOfWeek([a, b, c, dup], '2026-10-25')?.id).toBe('b');
    expect(lessonOfWeek([a, dup], '2026-10-25')?.id).toBe('a');
    expect(lessonOfWeek([], '2026-10-25')).toBeNull();
  });
  it('filters, hides duplicates, and counts each chip row under the other filters', () => {
    const docs = [doc({ id: '1', title: 'B', category: 'Wireline', failure_types: ['Wire parted'] }), doc({ id: '2', title: 'A', category: 'PCE', doc_type: 'best_practice', published_on: '2026-05-01' }),
      doc({ id: '3', title: 'C', category: 'Wireline', duplicate_of: '1' })];
    const r = filterLibrary(docs, { category: 'Wireline' });
    expect(r.docs.map((d) => d.id)).toEqual(['1']);
    expect(r.categories).toEqual([{ value: 'PCE', n: 1 }, { value: 'Wireline', n: 1 }]);
    expect(r.types).toEqual([{ value: 'lesson_learnt', n: 1 }]);
    expect(filterLibrary(docs, { duplicates: true, sort: 'az' }).docs.map((d) => d.id)).toEqual(['2', '1', '3']);
    expect(filterLibrary(docs, { q: 'parted' }).docs.map((d) => d.id)).toEqual(['1']);
  });
  it('lets the tab read and only its edit right write', () => {
    expect(readAllowed('/api/knowledge', { knowledge_hub: { view: true, edit: false, delete: false } })).toBe(true);
    expect(ruleFor('POST', '/api/knowledge')).toMatchObject({ menu: 'knowledge_hub', action: 'edit' });
    expect(ruleFor('PUT', '/api/knowledge/abc')).toMatchObject({ menu: 'knowledge_hub', action: 'edit' });
    expect(ruleFor('POST', '/api/knowledge/abc/lesson-of-week')).toMatchObject({ menu: 'knowledge_hub', action: 'edit' });
    expect(ruleFor('DELETE', '/api/knowledge/abc')).toBeUndefined();
  });
});
