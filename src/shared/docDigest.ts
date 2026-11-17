// Slides and mind map of a document (6z.16): made once per published revision by AI from the document file and
// kept in knowledge_digests. The slides are the "Present to the crew" deck; the mind map is the one-screen summary
// consulted during the job. Pure rules (shape, prompt, cleaning), used by the Worker and the page.

export const SLIDE_KINDS = ['title', 'points', 'steps', 'warning', 'question'] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];
export interface Slide { kind: SlideKind; title: string; points: string[]; note: string }

/**
 * What a point is (6z.18), so the map can colour it: a plain value (grey), a limit to respect (amber), a condition
 * that stops the job (red), or nothing special. A branch marked "stop" is the stop-work card.
 */
export const MIND_KINDS = ['', 'value', 'limit', 'stop'] as const;
export type MindKind = (typeof MIND_KINDS)[number];
export interface MindNode { label: string; kind?: MindKind; children: MindNode[] }
export interface MindMap { center: string; branches: MindNode[] }

export interface Digest { slides: Slide[]; mindmap: MindMap }

const str = { type: 'string' } as const;
const kindProp = { type: 'string', enum: [...MIND_KINDS] } as const;
// branch → topic → detail: three levels, the last one a short label (often a value or a limit)
const leaf = { type: 'object', additionalProperties: false, required: ['label', 'kind'], properties: { label: str, kind: kindProp } };
const node = (depth: number): Record<string, unknown> => ({
  type: 'object', additionalProperties: false, required: ['label', 'kind', 'children'],
  properties: { label: str, kind: kindProp, children: { type: 'array', items: depth > 0 ? node(depth - 1) : leaf } },
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

/** Lessons (lesson learnt, best practice, learning from incident) get a two-slide crew deck; other documents only the mind map. */
export const LESSON_SLIDES = 2;

export function digestPrompt(p: { title: string; docNo: string | null; kind: string; summary: string | null; keyAction: string | null; lesson: boolean }) {
  const slides = p.lesson
    ? `1. slides: exactly 2 slides for a 5-minute crew briefing, shown beside a photo of the event.
   - Slide 1, kind "points": title = a headline of what happened, up to 8 words. points = 3 to 5 lines: what happened, where and during which operation, why it happened, what it caused.
   - Slide 2, kind "warning": title = "What we do now" or a short equivalent. points = 3 to 5 lines: the key action first, then the other lessons and checks crews must apply.
   - Points up to 18 words each. note = one sentence the presenter can add ("" if none).`
    : '1. slides: [] (this document type has no crew slides).';
  return `You prepare field material for NESR slickline crews from the attached document: "${p.title}"${p.docNo ? ` (${p.docNo})` : ''}, a ${p.kind}.
Use only what the document says. Keep its numbers, limits, pressures, sizes and names exactly. Never add steps, values or advice it doesn't contain. Plain, short English that a crew reads on a screen at the wellsite.

${slides}
2. mindmap: the whole document on one screen. It is consulted during the job instead of reading the document again, and the AI Agent answers questions from it, so every limit, value, step and responsibility in the document must appear in it.
   - center: the subject in up to 6 words.
   - branches: 4 to 8 main topics in the document's order (for a procedure: preparation, equipment, steps by phase, checks and limits, stop-work conditions, after the job, responsibilities, as the document has them). Put every stop-work condition together in one branch and give that branch kind "stop".
   - each branch: up to 6 children of up to 10 words (what to do or check); a child may have up to 4 children of its own that are short exact values, at most 5 words each (e.g. "2.72 in OD", "max 150 ft/min", "> 200 lb over-pull").
   - kind on every node: "value" for a size, setting, quantity or name to use; "limit" for a maximum, minimum or test value that must be respected; "stop" for a condition that stops the job; "" for anything else (branches and most children).
${p.summary ? `\nThe record's summary: ${p.summary}` : ''}${p.keyAction ? `\nThe record's key action: ${p.keyAction}` : ''}`;
}

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function cleanNode(v: unknown, depth: number): MindNode | null {
  const n = (v ?? {}) as Record<string, unknown>;
  const label = s(n.label, 120);
  if (!label) return null;
  const kids = depth > 0 && Array.isArray(n.children) ? n.children.map((c) => cleanNode(c, depth - 1)).filter((c): c is MindNode => !!c).slice(0, 8) : [];
  const kind = (MIND_KINDS as readonly string[]).includes(n.kind as string) ? (n.kind as MindKind) : '';
  return kind ? { label, kind, children: kids } : { label, children: kids };
}

/** Makes the answer safe to show: known slide kinds, sizes capped, empty slides and branches dropped. */
export function cleanDigest(raw: unknown, title: string, maxSlides = 14): Digest {
  const r = (raw ?? {}) as Record<string, unknown>;
  const slides = (Array.isArray(r.slides) ? r.slides : []).map((x): Slide | null => {
    const o = (x ?? {}) as Record<string, unknown>;
    const kind = (SLIDE_KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as SlideKind) : 'points';
    const points = (Array.isArray(o.points) ? o.points : []).map((p) => s(p, 240)).filter(Boolean).slice(0, 8);
    const t = s(o.title, 120);
    return t || points.length ? { kind, title: t || title, points, note: s(o.note, 300) } : null;
  }).filter((x): x is Slide => !!x).slice(0, maxSlides);
  const m = (r.mindmap ?? {}) as Record<string, unknown>;
  const branches = (Array.isArray(m.branches) ? m.branches : []).map((b) => cleanNode(b, 2)).filter((b): b is MindNode => !!b).slice(0, 10);
  return { slides, mindmap: { center: s(m.center, 80) || title, branches } };
}

/** The two lesson slides from the record alone (no file, or AI unavailable): what happened, then the key action. */
export function fallbackSlides(d: { title: string; doc_no: string | null; summary: string | null; key_action: string | null; failure_types: string[] }): Slide[] {
  const what = d.summary ? d.summary.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 5) : [];
  const now = [d.key_action, d.failure_types.length ? `Failure types: ${d.failure_types.join(', ')}` : ''].filter((x): x is string => !!x);
  return [
    { kind: 'points', title: d.title, points: what.length ? what : [d.doc_no ?? 'See the document'].filter(Boolean), note: '' },
    { kind: 'warning', title: 'What we do now', points: now.length ? now : ['Read the document with the crew'], note: '' },
  ];
}

/** A lesson's two slides from a saved deck; an older, longer deck gives its first two content slides. */
export function lessonSlides(slides: Slide[]): Slide[] {
  const content = slides.filter((s) => s.kind !== 'title' && s.kind !== 'question');
  return (content.length >= LESSON_SLIDES ? content : slides).slice(0, LESSON_SLIDES);
}

/** Counts the nodes of a mind map (for the page's summary line). */
export const mindSize = (m: MindMap) => m.branches.reduce((a, b) => a + 1 + b.children.reduce((x, c) => x + 1 + c.children.length, 0), 0);
