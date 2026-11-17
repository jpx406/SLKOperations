// Slides and mind map of a document (6z.16): made once per published revision by AI from the document file and
// kept in knowledge_digests. The slides are the "Present to the crew" deck; the mind map is the one-screen summary
// consulted during the job. Pure rules (shape, prompt, cleaning), used by the Worker and the page.

export const SLIDE_KINDS = ['title', 'points', 'steps', 'warning', 'question'] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];
export interface Slide { kind: SlideKind; title: string; points: string[]; note: string }

export interface MindNode { label: string; children: MindNode[] }
export interface MindMap { center: string; branches: MindNode[] }

export interface Digest { slides: Slide[]; mindmap: MindMap }

const str = { type: 'string' } as const;
// branch → topic → detail: three levels, the last one a plain label
const leaf = { type: 'object', additionalProperties: false, required: ['label'], properties: { label: str } };
const node = (depth: number): Record<string, unknown> => ({
  type: 'object', additionalProperties: false, required: ['label', 'children'],
  properties: { label: str, children: { type: 'array', items: depth > 0 ? node(depth - 1) : leaf } },
});

/** The answer's fixed shape: up to 12 slides, and a mind map three levels deep. */
export function digestSchema() {
  return {
    type: 'object', additionalProperties: false, required: ['slides', 'mindmap'],
    properties: {
      slides: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['kind', 'title', 'points', 'note'], properties: { kind: { type: 'string', enum: [...SLIDE_KINDS] }, title: str, points: { type: 'array', items: str }, note: str } },
      },
      mindmap: { type: 'object', additionalProperties: false, required: ['center', 'branches'], properties: { center: str, branches: { type: 'array', items: node(1) } } },
    },
  };
}

export function digestPrompt(p: { title: string; docNo: string | null; kind: string; summary: string | null; keyAction: string | null }) {
  return `You prepare field material for NESR slickline crews from the attached document: "${p.title}"${p.docNo ? ` (${p.docNo})` : ''}, a ${p.kind}.
Use only what the document says. Keep its numbers, limits, pressures, sizes and names exactly. Never add steps, values or advice it doesn't contain. Plain, short English that a crew reads on a screen at the wellsite.

1. slides: a toolbox-talk deck of 5 to 12 slides that covers the whole document in detail, in its order.
   - First slide kind "title": title = the document's title, points = 1 to 3 lines (what it covers, where it applies), note = "".
   - Then kind "points" for facts and context, "steps" for an ordered procedure (one step per point, in order), "warning" for hazards, limits, stop-work conditions and must-do actions.
   - For a lesson or incident: what happened, why it happened, what it caused, what we do now, then the key action as a "warning" slide.
   - Last slide kind "question": 2 to 4 questions for the crew to check understanding.
   - Each slide: a title of up to 8 words, 2 to 6 points of up to 20 words each, and note = one sentence the presenter can add ("" if none).
2. mindmap: the whole document on one screen, to consult during the job instead of reading it again.
   - center: the subject in up to 6 words.
   - branches: 4 to 8 main topics (for a procedure: preparation, equipment, steps by phase, checks and limits, hazards, responsibilities, as the document has them).
   - each branch: up to 6 children of up to 10 words; a child may have up to 4 children of its own with exact values (e.g. "Pull test 50% of wire breaking strength").
${p.summary ? `\nThe record's summary: ${p.summary}` : ''}${p.keyAction ? `\nThe record's key action: ${p.keyAction}` : ''}`;
}

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function cleanNode(v: unknown, depth: number): MindNode | null {
  const n = (v ?? {}) as Record<string, unknown>;
  const label = s(n.label, 120);
  if (!label) return null;
  const kids = depth > 0 && Array.isArray(n.children) ? n.children.map((c) => cleanNode(c, depth - 1)).filter((c): c is MindNode => !!c).slice(0, 8) : [];
  return { label, children: kids };
}

/** Makes the answer safe to show: known slide kinds, sizes capped, empty slides and branches dropped. */
export function cleanDigest(raw: unknown, title: string): Digest {
  const r = (raw ?? {}) as Record<string, unknown>;
  const slides = (Array.isArray(r.slides) ? r.slides : []).map((x): Slide | null => {
    const o = (x ?? {}) as Record<string, unknown>;
    const kind = (SLIDE_KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as SlideKind) : 'points';
    const points = (Array.isArray(o.points) ? o.points : []).map((p) => s(p, 240)).filter(Boolean).slice(0, 8);
    const t = s(o.title, 120);
    return t || points.length ? { kind, title: t || title, points, note: s(o.note, 300) } : null;
  }).filter((x): x is Slide => !!x).slice(0, 14);
  const m = (r.mindmap ?? {}) as Record<string, unknown>;
  const branches = (Array.isArray(m.branches) ? m.branches : []).map((b) => cleanNode(b, 2)).filter((b): b is MindNode => !!b).slice(0, 10);
  return { slides, mindmap: { center: s(m.center, 80) || title, branches } };
}

/** A deck from the record alone (no file, or AI unavailable): the title, the summary, the key action. */
export function fallbackSlides(d: { title: string; doc_no: string | null; summary: string | null; key_action: string | null; failure_types: string[] }): Slide[] {
  const out: Slide[] = [{ kind: 'title', title: d.title, points: [d.doc_no ?? ''].filter(Boolean), note: '' }];
  if (d.summary) out.push({ kind: 'points', title: 'What it is about', points: d.summary.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 6), note: '' });
  if (d.key_action) out.push({ kind: 'warning', title: 'Key action', points: [d.key_action], note: '' });
  if (d.failure_types.length) out.push({ kind: 'points', title: 'Failure types', points: d.failure_types, note: '' });
  return out;
}

/** Counts the nodes of a mind map (for the page's summary line). */
export const mindSize = (m: MindMap) => m.branches.reduce((a, b) => a + 1 + b.children.reduce((x, c) => x + 1 + c.children.length, 0), 0);
