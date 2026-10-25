// Knowledge Hub (S21, S43): a library of lessons learnt, best practices and learnings from incidents.
// The documents themselves stay with their owner (QHSE, SharePoint); each entry here keeps the summary, the key
// action, the failure types it covers and a link to the source.

export const DOC_TYPES = { lesson_learnt: 'Lesson learnt', best_practice: 'Best practice', learning_from_incident: 'Learning from incident' } as const;
export type DocType = keyof typeof DOC_TYPES;

export interface KnowledgeDoc {
  id: string; country: string; doc_type: DocType; category: string; title: string; summary: string | null; key_action: string | null;
  failure_types: string[]; published_on: string | null; rilr_ref: string | null; source_ref: string | null; duplicate_of: string | null; lesson_of_week_from: string | null;
}

export interface DocInput { country?: unknown; doc_type?: unknown; category?: unknown; title?: unknown; summary?: unknown; key_action?: unknown; failure_types?: unknown; published_on?: unknown; rilr_ref?: unknown; source_ref?: unknown; duplicate_of?: unknown }

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Cleans a document entry. The link must be a web address (http or https), so nothing else can be opened from it. */
export function checkDoc(b: DocInput): { error: string } | { doc: Omit<KnowledgeDoc, 'id' | 'country' | 'lesson_of_week_from'> } {
  if (!(typeof b.doc_type === 'string' && b.doc_type in DOC_TYPES)) return { error: 'Pick the document type' };
  const title = text(b.title, 200);
  if (!title) return { error: 'Give the document a title' };
  const category = text(b.category, 80);
  if (!category) return { error: 'Pick or type a category' };
  const published = text(b.published_on, 10);
  if (published && !/^\d{4}-\d{2}-\d{2}$/.test(published)) return { error: 'The publication date must be a date' };
  const link = text(b.source_ref, 1000);
  if (link && !/^https?:\/\/[^\s]+$/i.test(link)) return { error: 'The link must start with https://' };
  const types = Array.isArray(b.failure_types) ? [...new Set(b.failure_types.map((x) => text(x, 60)).filter(Boolean))].slice(0, 20) : [];
  return {
    doc: {
      doc_type: b.doc_type as DocType, category, title, summary: text(b.summary, 4000) || null, key_action: text(b.key_action, 1000) || null,
      failure_types: types, published_on: published || null, rilr_ref: text(b.rilr_ref, 120) || null, source_ref: link || null,
      duplicate_of: text(b.duplicate_of, 64) || null,
    },
  };
}

/** The lesson of the week: the most recent pick on or before today; without a pick, the newest lesson. */
export function lessonOfWeek(docs: KnowledgeDoc[], today: string): KnowledgeDoc | null {
  const live = docs.filter((d) => !d.duplicate_of);
  const picked = live.filter((d) => d.lesson_of_week_from && d.lesson_of_week_from <= today).sort((a, b) => b.lesson_of_week_from!.localeCompare(a.lesson_of_week_from!));
  if (picked[0]) return picked[0];
  return [...live].sort((a, b) => (b.published_on ?? '').localeCompare(a.published_on ?? ''))[0] ?? null;
}

export interface LibraryFilter { q?: string; type?: string; category?: string; failure?: string; sort?: 'newest' | 'az'; duplicates?: boolean }

/** Filters and sorts the library, with chip counts computed on everything else that is filtered. */
export function filterLibrary(docs: KnowledgeDoc[], f: LibraryFilter) {
  const q = (f.q ?? '').trim().toLowerCase();
  const base = docs.filter((d) => (f.duplicates || !d.duplicate_of)
    && (!q || [d.title, d.summary, d.key_action, d.category, d.rilr_ref, ...d.failure_types].some((x) => x?.toLowerCase().includes(q))));
  const count = (list: KnowledgeDoc[], key: (d: KnowledgeDoc) => string[]) => {
    const m = new Map<string, number>();
    for (const d of list) for (const k of key(d)) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, n]) => ({ value, n }));
  };
  const byType = (d: KnowledgeDoc) => !f.type || d.doc_type === f.type;
  const byCat = (d: KnowledgeDoc) => !f.category || d.category === f.category;
  const byFailure = (d: KnowledgeDoc) => !f.failure || d.failure_types.includes(f.failure);
  const docsOut = base.filter((d) => byType(d) && byCat(d) && byFailure(d))
    .sort(f.sort === 'az' ? (a, b) => a.title.localeCompare(b.title) : (a, b) => (b.published_on ?? '').localeCompare(a.published_on ?? '') || a.title.localeCompare(b.title));
  return {
    docs: docsOut,
    types: count(base.filter((d) => byCat(d) && byFailure(d)), (d) => [d.doc_type]),
    categories: count(base.filter((d) => byType(d) && byFailure(d)), (d) => [d.category]),
    failures: count(base.filter((d) => byType(d) && byCat(d)), (d) => d.failure_types),
  };
}
