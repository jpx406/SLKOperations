import { describe, expect, it } from 'vitest';
import { cleanDigest, digestPrompt, digestSchema, fallbackSlides, mindSize } from '../src/shared/docDigest';
import { readAllowed, ruleFor } from '../src/worker/permissions';

describe('slides and mind map (6z.16)', () => {
  it('asks for a fixed shape: slides of known kinds and a three-level mind map', () => {
    const s = digestSchema();
    expect(s.required).toEqual(['slides', 'mindmap']);
    expect(s.properties.slides.items.properties.kind.enum).toEqual(['title', 'points', 'steps', 'warning', 'question']);
    const branch = s.properties.mindmap.properties.branches.items as { properties: { children: { items: { properties: { children: { items: { required: string[] } } } } } } };
    expect(branch.properties.children.items.properties.children.items.required).toEqual(['label']);
    expect(JSON.stringify(s)).not.toContain('maxItems');
    const p = digestPrompt({ title: 'Rope socket', docNo: 'SWI-7', kind: 'Standard Work Instruction (SWI)', summary: 'Make up and test', keyAction: null, lesson: false });
    expect(p).toContain('Never add steps');
    expect(p).toContain('Make up and test');
    expect(p).toContain('slides: []');
    expect(digestPrompt({ title: 'Wire parted', docNo: null, kind: 'lesson learnt', summary: null, keyAction: null, lesson: true })).toContain('exactly 2 slides');
  });
  it('cleans the answer: unknown kinds become points, empty slides and branches go, sizes are capped', () => {
    const d = cleanDigest({
      slides: [{ kind: 'title', title: 'Rope socket', points: ['Saudi Arabia'], note: '' }, { kind: 'banner', title: 'Steps', points: ['Cut', ' ', 'Dress'], note: 'x' }, { kind: 'points', title: '', points: [] }, 'junk'],
      mindmap: { center: '', branches: [{ label: 'Steps', children: [{ label: 'Cut wire', children: [{ label: '50% pull test' }] }] }, { label: '' }, { label: 'Hazards' }] },
    }, 'Rope socket make-up');
    expect(d.slides).toEqual([{ kind: 'title', title: 'Rope socket', points: ['Saudi Arabia'], note: '' }, { kind: 'points', title: 'Steps', points: ['Cut', 'Dress'], note: 'x' }]);
    expect(d.mindmap.center).toBe('Rope socket make-up');
    expect(d.mindmap.branches).toEqual([{ label: 'Steps', children: [{ label: 'Cut wire', children: [{ label: '50% pull test', children: [] }] }] }, { label: 'Hazards', children: [] }]);
    expect(mindSize(d.mindmap)).toBe(4);
    expect(cleanDigest(null, 'T')).toEqual({ slides: [], mindmap: { center: 'T', branches: [] } });
  });
  it('falls back to the record when there are no saved slides', () => {
    const s = fallbackSlides({ title: 'Wire parted', doc_no: 'LL-GL-001', summary: 'It parted. Packing was worn.', key_action: 'Inspect packing', failure_types: ['Wire parted'] });
    expect(s.map((x) => x.kind)).toEqual(['points', 'warning']);
    expect(s[0].points).toEqual(['It parted.', 'Packing was worn.']);
    expect(s[1].points).toEqual(['Inspect packing', 'Failure types: Wire parted']);
    expect(fallbackSlides({ title: 'T', doc_no: null, summary: null, key_action: null, failure_types: [] })).toHaveLength(2);
  });
  it('lets any reader open and make the first slides and mind map', () => {
    const view = { knowledge_hub: { view: true, edit: false, delete: false } };
    expect(readAllowed('/api/knowledge/d1/digest', view)).toBe(true);
    expect(ruleFor('POST', '/api/knowledge/d1/digest')).toMatchObject({ menu: 'knowledge_hub', action: 'view' });
  });
});
