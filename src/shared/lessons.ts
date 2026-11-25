// Lessons and best practices written in the app (Utilities, 6z.57). One page on the company template: a header with
// the event facts and key lesson, Description, Potential damage, Analysis and findings, pictures, and Actions, each
// with a few ways to show it. Drafted by hand or by AI from a failure report, sent to a reviewer and an approver, and
// published to the Knowledge Hub when approved. Shared by the page, the Worker, the PDF and the PowerPoint maker.

export const LESSON_KINDS = { lesson_learnt: 'Lesson learnt', best_practice: 'Best practice' } as const;
export type LessonKind = keyof typeof LESSON_KINDS;
export const isLessonKind = (v: unknown): v is LessonKind => typeof v === 'string' && v in LESSON_KINDS;

export const LESSON_COMPANIES = ['NESR', 'SAPESCO', 'Gulf Energy'] as const;
export type LessonCompany = (typeof LESSON_COMPANIES)[number];
export const isLessonCompany = (v: unknown): v is LessonCompany => (LESSON_COMPANIES as readonly unknown[]).includes(v);
/** The name on the controlled-document line of each template. */
export const COMPANY_DB: Record<LessonCompany, string> = { NESR: 'NESR', SAPESCO: 'SAPESCO', 'Gulf Energy': 'GES' };

export const LESSON_STATUS = { draft: 'Draft', review: 'With reviewer', approval: 'With approver', approved: 'Approved' } as const;
export type LessonStatus = keyof typeof LESSON_STATUS;

// ---- the page content -----------------------------------------------------------------------------------------

export type DescriptionAs = 'bullets' | 'paragraph' | 'timeline';
export type FactsAs = 'bullets' | 'numbered';
export type DamageAs = 'tags' | 'list';
export type AnalysisAs = 'side' | 'stacked' | 'whys';
export type PicturesAs = 'right' | 'row' | 'large';
export type ActionsAs = 'table' | 'list';
export const SHOW_AS = {
  description: { bullets: 'Bullets', paragraph: 'Paragraph', timeline: 'Timeline' },
  facts: { bullets: 'Bullets', numbered: 'Numbered' },
  damage: { tags: 'Tags', list: 'List' },
  analysis: { side: 'Side by side', stacked: 'Stacked', whys: 'With 5 whys' },
  pictures: { right: 'Column at right', row: 'Row under section', large: 'One large' },
  actions: { table: 'Table', list: 'Numbered, deadline in red' },
} as const;

/** The parts AI can write; each stays flagged until someone edits it or ticks it as checked. */
export const PARTS = { header: 'Header', description: 'Description', facts: 'Facts and findings', damage: 'Potential damage', analysis: 'Analysis and findings', actions: 'Actions' } as const;
export type Part = keyof typeof PARTS;

export interface LessonPicture { id: string; caption: string; section: 'description' | 'analysis'; w: number; h: number; type: 'image/jpeg' | 'image/png' }
export interface LessonAction { action: string; responsible: string; due: string }
/** A box on the page, in points from the page's top left (540 × 780). */
export interface Rect { x: number; y: number; w: number; h: number }
/** How the page is laid out: in order down the page (auto), or every part as a box placed by hand or by AI (free). */
export interface LessonLayoutChoice { mode: 'auto' | 'free'; boxes: Record<string, Rect> }

export interface LessonContent {
  key_lesson: string;
  event_date: string; field: string; well: string; job: string; unit: string; category: string;
  description: string; description_as: DescriptionAs;
  /** Facts and findings, one per line (6z.58); left out of the page when empty. */
  facts: string; facts_as: FactsAs;
  damage: string[]; damage_as: DamageAs;
  immediate_cause: string; root_cause: string; whys: string[]; analysis_as: AnalysisAs;
  pictures: LessonPicture[]; pictures_as: PicturesAs;
  actions: LessonAction[]; actions_as: ActionsAs;
  layout: LessonLayoutChoice;
  /** Parts written by AI and not yet checked by a person. */
  ai: Part[];
}

export const EMPTY_CONTENT: LessonContent = {
  key_lesson: '', event_date: '', field: '', well: '', job: '', unit: '', category: '',
  description: '', description_as: 'bullets', facts: '', facts_as: 'bullets', damage: [], damage_as: 'tags',
  immediate_cause: '', root_cause: '', whys: [], analysis_as: 'side',
  pictures: [], pictures_as: 'right', actions: [], actions_as: 'table', layout: { mode: 'auto', boxes: {} }, ai: [],
};

export const LIMITS = { title: 160, line: 120, text: 3000, damage: 8, whys: 5, actions: 10, pictures: 8, caption: 120 } as const;
export const DAMAGE_SUGGESTIONS = ['People injury', 'Equipment damage', 'Lost well barrier', 'Fish left in hole', 'Non-productive time', 'Client NPT', 'Loss of containment', 'Environmental release', 'Reputation'];

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, n) : '');
const line = (v: unknown, n: number) => str(v, n).replace(/\s+/g, ' ');
const pick = <T extends string>(v: unknown, opts: Record<T, string>, d: T): T => (typeof v === 'string' && v in opts ? (v as T) : d);
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Content as stored: every field trimmed to its limit, unknown choices back to their default. */
export function cleanContent(v: unknown): LessonContent {
  const b = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  const date = line(b.event_date, 10);
  return {
    key_lesson: line(b.key_lesson, 300),
    event_date: isDate(date) ? date : '',
    field: line(b.field, 60), well: line(b.well, 60), job: line(b.job, 80), unit: line(b.unit, 40), category: line(b.category, 60),
    description: str(b.description, LIMITS.text), description_as: pick(b.description_as, SHOW_AS.description, 'bullets'),
    facts: str(b.facts, LIMITS.text), facts_as: pick(b.facts_as, SHOW_AS.facts, 'bullets'),
    damage: [...new Set(arr(b.damage).map((x) => line(x, 60)).filter(Boolean))].slice(0, LIMITS.damage), damage_as: pick(b.damage_as, SHOW_AS.damage, 'tags'),
    immediate_cause: str(b.immediate_cause, 1500), root_cause: str(b.root_cause, 1500),
    whys: arr(b.whys).map((x) => line(x, 200)).filter(Boolean).slice(0, LIMITS.whys), analysis_as: pick(b.analysis_as, SHOW_AS.analysis, 'side'),
    pictures: arr(b.pictures).flatMap((x) => {
      const p = (x ?? {}) as Record<string, unknown>;
      const id = typeof p.id === 'string' && /^[a-z0-9-]{8,40}$/i.test(p.id) ? p.id : '';
      const w = Number(p.w), h = Number(p.h);
      if (!id || !(w > 0) || !(h > 0)) return [];
      return [{ id, caption: line(p.caption, LIMITS.caption), section: p.section === 'analysis' ? 'analysis' as const : 'description' as const, w: Math.round(w), h: Math.round(h), type: p.type === 'image/png' ? 'image/png' as const : 'image/jpeg' as const }];
    }).slice(0, LIMITS.pictures),
    pictures_as: pick(b.pictures_as, SHOW_AS.pictures, 'right'),
    actions: arr(b.actions).map((x) => {
      const a = (x ?? {}) as Record<string, unknown>;
      const due = line(a.due, 10);
      return { action: line(a.action, 300), responsible: line(a.responsible, 60), due: isDate(due) ? due : '' };
    }).filter((a) => a.action).slice(0, LIMITS.actions),
    actions_as: pick(b.actions_as, SHOW_AS.actions, 'table'),
    layout: cleanLayout(b.layout),
    ai: [...new Set(arr(b.ai).filter((x): x is Part => typeof x === 'string' && x in PARTS))],
  };
}

const num = (v: unknown, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.round(Math.min(hi, Math.max(lo, n)) * 10) / 10 : null; };
/** Boxes kept on the page, at least 20 × 12 pt, ids that name a part or a picture. */
export function cleanLayout(v: unknown): LessonLayoutChoice {
  const b = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const boxes: Record<string, Rect> = {};
  const raw = (b.boxes && typeof b.boxes === 'object' ? b.boxes : {}) as Record<string, unknown>;
  for (const [id, r] of Object.entries(raw).slice(0, 40)) {
    if (!/^(meta|key|description|facts|damage|analysis|actions|pic:[a-z0-9-]{8,40})$/i.test(id)) continue;
    const o = (r ?? {}) as Record<string, unknown>;
    const x = num(o.x, 0, 520), y = num(o.y, 0, 770), w = num(o.w, 20, 540), h = num(o.h, 12, 780);
    if (x === null || y === null || w === null || h === null) continue;
    boxes[id] = { x, y, w, h };
  }
  return { mode: b.mode === 'free' ? 'free' : 'auto', boxes };
}

/** What still stops a page from going for review. */
export function submitProblems(title: string, c: LessonContent, fits: boolean | string): string[] {
  const out: string[] = [];
  if (!title.trim()) out.push('Give it a title');
  if (!c.description.trim()) out.push('Write the description');
  if (!c.immediate_cause.trim()) out.push('Write the analysis');
  if (!c.actions.length) out.push('Add at least one action');
  if (c.ai.length) out.push(`Check the parts AI wrote: ${c.ai.map((p) => PARTS[p]).join(', ')}`);
  if (fits === false) out.push('The page runs past one page: shorten the text or use fewer pictures');
  else if (typeof fits === 'string') out.push(fits);
  return out;
}

// ---- headings per kind ---------------------------------------------------------------------------------------------

export function headings(kind: LessonKind) {
  return kind === 'best_practice'
    ? { title: 'Best Practice', facts: 'Facts and findings', description: 'What we do', analysis: 'Why it works', actions: 'How to apply it', key: 'The practice', immediate: 'Why it works', root: 'What it prevents' }
    : { title: 'Lesson Learnt', facts: 'Facts and findings', description: 'Description', analysis: 'Analysis and findings', actions: 'Actions to be taken', key: 'Key lesson', immediate: 'Immediate cause', root: 'Root cause' };
}

// ---- who may do what ---------------------------------------------------------------------------------------------

export interface LessonPerson { username: string; admin: boolean; approver: boolean; reviewer: boolean }
export interface LessonRow { status: LessonStatus; created_by: string; reviewer: string | null; approver: string | null; submitted_by: string | null; doc_no?: string | null }
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Knowledge Hub approvers and admins start lessons and best practices (owner's choice, 6z.57). */
export const mayCreate = (p: LessonPerson) => p.admin || p.approver;

export function mayDo(p: LessonPerson, l: LessonRow, action: 'edit' | 'submit' | 'review' | 'approve' | 'send_back' | 'delete' | 'revise'): boolean {
  switch (action) {
    case 'edit':
      return l.status === 'draft' ? same(p.username, l.created_by) || p.admin || mayCreate(p)
        : l.status === 'review' ? same(p.username, l.reviewer) || p.admin
          : l.status === 'approval' ? same(p.username, l.approver) || p.admin : false;
    case 'submit': return l.status === 'draft' && (same(p.username, l.created_by) || p.admin || mayCreate(p));
    case 'review': return l.status === 'review' && (same(p.username, l.reviewer) || p.admin);
    case 'approve': return l.status === 'approval' && (same(p.username, l.approver) || p.admin);
    case 'send_back': return (l.status === 'review' && (same(p.username, l.reviewer) || p.admin)) || (l.status === 'approval' && (same(p.username, l.approver) || p.admin));
    case 'delete': return l.status === 'draft' && !l.doc_no && (same(p.username, l.created_by) || p.admin);
    case 'revise': return l.status === 'approved' && mayCreate(p);
  }
}

// ---- numbers ---------------------------------------------------------------------------------------------------------

/**
 * The next number, counted the Knowledge Hub way per type and place (LL-SA-015, BP-SA-004) and shared by the three
 * companies, with the company prefix in front for SAPESCO and Gulf Energy (SAP-LL-SA-015, GES-BP-SA-004).
 */
export function nextLessonNumber(base: string, companyPrefix: string | null, taken: (string | null)[], digits = 3): string {
  const re = new RegExp(`^(?:[A-Z]+-)?${base.replace(/[^A-Z0-9-]/gi, '')}-(\\d+)$`, 'i');
  const max = taken.reduce((m, n) => { const x = n ? re.exec(n) : null; return x ? Math.max(m, Number(x[1])) : m; }, 0);
  const no = `${base}-${String(max + 1).padStart(digits, '0')}`;
  return companyPrefix ? `${companyPrefix}-${no}` : no;
}

/** "26 Nov 2026" */
export const printDate = (iso: string | null | undefined) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
/** A file name without characters storage or Windows dislike. */
export const fileTitle = (s: string) => s.replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';

// ---- AI draft from a failure report ---------------------------------------------------------------------------------

export function lessonSchema() {
  const s = { type: 'string' };
  const list = { type: 'array', items: s };
  return {
    type: 'object', additionalProperties: false,
    required: ['title', 'key_lesson', 'event_date', 'field', 'well', 'job', 'unit', 'category', 'description', 'facts', 'damage', 'immediate_cause', 'root_cause', 'whys', 'actions'],
    properties: {
      title: s, key_lesson: s, event_date: s, field: s, well: s, job: s, unit: s, category: s,
      description: list, facts: list, damage: list, immediate_cause: list, root_cause: list, whys: list,
      actions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['action', 'responsible', 'due'], properties: { action: s, responsible: s, due: s } } },
    },
  };
}

export function lessonPrompt(p: { kind: LessonKind; fileName: string; today: string; categories: string[] }) {
  const bp = p.kind === 'best_practice';
  return `You are helping a slickline service quality team turn a failure or incident report ("${p.fileName}") into a one-page ${bp ? 'BEST PRACTICE' : 'LESSON LEARNT'} for crews.
Write plain, short English that a field supervisor reads in a minute. No filler, no blame on named people, no names of people at all. Keep units and depths as the report gives them. Today is ${p.today}.

Fill every field from the report. Leave a field "" (or an empty list) when the report does not say it; never invent facts, dates or numbers.
- title: what happened (or, for a best practice, the practice), at most 70 characters, no ending full stop.
- key_lesson: one sentence, the single thing crews must remember${bp ? ' (the practice itself)' : ''}.
- event_date: YYYY-MM-DD of the event, or "".
- field, well, job (the job being done, e.g. "Set PR plug"), unit (slickline unit number), category: short. ${p.categories.length ? `Prefer one of these categories when it fits: ${p.categories.join(', ')}.` : ''}
- description: 2 to 5 short bullet sentences, in order, ${bp ? 'what crews do and when' : 'what happened and what was done to make it safe'}.
- facts: up to 6 short facts and findings established by the report (readings, measurements, what was found on inspection), each a short sentence; [] if none.
${bp ? '- damage: [] (not used for a best practice).' : '- damage: 2 to 4 short potential consequences (e.g. "People injury", "Lost well barrier", "Client NPT").'}
- immediate_cause: ${bp ? 'why the practice works, 1 to 3 lines' : '1 to 3 lines, each "Category: explanation" (e.g. "Equipment failure: the load cell gap had closed")'}.
- root_cause: ${bp ? 'what it prevents, 1 to 3 lines' : '1 to 3 lines, each "Category: explanation"'}.
- whys: up to 5 short "why" steps from the event to the root cause, or [] if the report does not support them.
- actions: 1 to 6 actions ${bp ? 'to apply the practice' : 'to stop it happening again'}, each with responsible (a role, e.g. "Operations Manager", never a person's name) and due (YYYY-MM-DD or "").`;
}

/** The AI answer as page content, with every part it wrote flagged for checking. */
export function cleanDraft(raw: unknown, kind: LessonKind): { title: string; content: Partial<LessonContent> } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const lines = (v: unknown) => (Array.isArray(v) ? v.map((x) => line(x, 400)).filter(Boolean) : []);
  const c = cleanContent({
    key_lesson: r.key_lesson, event_date: r.event_date, field: r.field, well: r.well, job: r.job, unit: r.unit, category: r.category,
    description: lines(r.description).join('\n'), facts: lines(r.facts).join('\n'), damage: kind === 'best_practice' ? [] : lines(r.damage),
    immediate_cause: lines(r.immediate_cause).join('\n'), root_cause: lines(r.root_cause).join('\n'), whys: lines(r.whys),
    actions: Array.isArray(r.actions) ? r.actions : [],
  });
  const ai = (Object.keys(PARTS) as Part[]).filter((k) => kind === 'best_practice' ? k !== 'damage' : true);
  const { pictures: _p, pictures_as: _pa, description_as: _d, facts_as: _f, damage_as: _da, analysis_as: _a, actions_as: _ac, layout: _l, ...filled } = c;
  return { title: line(r.title, LIMITS.title), content: { ...filled, ai: ai.filter((k) => k !== 'facts' || !!c.facts) } };
}
