import { describe, expect, it } from 'vitest';
import { cleanDigest, digestPrompt, digestSchema, mindSize } from '../src/shared/docDigest';
import { readAllowed, ruleFor } from '../src/worker/permissions';

describe('mind map (6z.16, slides removed in 6z.20)', () => {
  it('asks for a fixed shape: slides of known kinds and a three-level mind map', () => {
    const s = digestSchema();
    expect(s.required).toEqual(['slides', 'mindmap']);
    expect(s.properties.slides.items.properties.kind.enum).toEqual(['title', 'points', 'steps', 'warning', 'question']);
    const branch = s.properties.mindmap.properties.branches.items as { properties: { children: { items: { properties: { children: { items: { required: string[] } } } } } } };
    expect(branch.properties.children.items.properties.children.items.required).toEqual(['label', 'kind']);
    const tagged = cleanDigest({ slides: [], mindmap: { center: 'Gauge run', branches: [{ label: 'Stop the job', kind: 'stop', children: [{ label: 'Over-pull', kind: '', children: [{ label: '> 200 lb', kind: 'stop' }, { label: 'x', kind: 'bogus' }] }] }] } }, 'T');
    expect(tagged.mindmap.branches[0]).toEqual({ label: 'Stop the job', kind: 'stop', children: [{ label: 'Over-pull', children: [{ label: '> 200 lb', kind: 'stop', children: [] }, { label: 'x', children: [] }] }] });
    expect(JSON.stringify(s)).not.toContain('maxItems');
    const p = digestPrompt({ title: 'Rope socket', docNo: 'SWI-7', kind: 'Standard Work Instruction (SWI)', summary: 'Make up and test', keyAction: null });
    expect(p).toContain('Never add steps');
    expect(p).toContain('Make up and test');
    expect(p).toContain('slides: []');
  });
  it('cleans the answer: slides dropped, empty branches go, sizes are capped', () => {
    const d = cleanDigest({
      slides: [{ kind: 'title', title: 'Rope socket', points: ['Saudi Arabia'], note: '' }, { kind: 'banner', title: 'Steps', points: ['Cut', ' ', 'Dress'], note: 'x' }, { kind: 'points', title: '', points: [] }, 'junk'],
      mindmap: { center: '', branches: [{ label: 'Steps', children: [{ label: 'Cut wire', children: [{ label: '50% pull test' }] }] }, { label: '' }, { label: 'Hazards' }] },
    }, 'Rope socket make-up');
    // crew slides were removed in 6z.20: any the model still returns are dropped
    expect(d.slides).toEqual([]);
    expect(d.mindmap.center).toBe('Rope socket make-up');
    expect(d.mindmap.branches).toEqual([{ label: 'Steps', children: [{ label: 'Cut wire', children: [{ label: '50% pull test', children: [] }] }] }, { label: 'Hazards', children: [] }]);
    expect(mindSize(d.mindmap)).toBe(4);
    expect(cleanDigest(null, 'T')).toEqual({ slides: [], mindmap: { center: 'T', branches: [] } });
  });
  it('lets any reader open and make the first mind map', () => {
    const view = { knowledge_hub: { view: true, edit: false, delete: false } };
    expect(readAllowed('/api/knowledge/d1/digest', view)).toBe(true);
    expect(ruleFor('POST', '/api/knowledge/d1/digest')).toMatchObject({ menu: 'knowledge_hub', action: 'view' });
  });
});
