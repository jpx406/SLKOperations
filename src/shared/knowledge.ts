// Knowledge Hub (S21, S43, 6z.13, 6z.15): five sections (SWI and Forms added in 6z.15).
//   1. Lessons learnt, best practices and learnings from incidents, for one country or Global.
//   2. SLK Standard Operating Procedures, for one country or Global, and for one company (NESR, SAPESCO, Gulf Energy).
//   3. Client procedures, for one country and one client, shown on jobs in that country.
// Each entry can carry its document file (everyone downloads the current one) and an editable version (Word, Excel)
// that only admins see. Replacing the file raises the revision and keeps the old files, as in Document Control.

export const DOC_TYPES = { lesson_learnt: 'Lesson learnt', best_practice: 'Best practice', learning_from_incident: 'Learning from incident' } as const;
export type DocType = keyof typeof DOC_TYPES;

export const SECTIONS = { lesson: 'Lessons & best practices', sop: 'SLK SOPs', swi: 'Work instructions (SWI)', form: 'Forms', client: 'Client procedures' } as const;
/** Sections filed under Global or a country and a company (NESR, SAPESCO, Gulf Energy). */
export const COMPANY_SECTIONS: Section[] = ['sop', 'swi', 'form'];
export const hasCompany = (s: Section) => COMPANY_SECTIONS.includes(s);
export type Section = keyof typeof SECTIONS;
export const isSection = (v: unknown): v is Section => typeof v === 'string' && v in SECTIONS;

/** What "Add document" asks first: the type decides the section the document is filed in. */
export const ADD_TYPES = {
  lesson_learnt: { label: 'Lesson learnt', section: 'lesson' },
  best_practice: { label: 'Best practice', section: 'lesson' },
  learning_from_incident: { label: 'Learning from incident', section: 'lesson' },
  sop: { label: 'SLK Standard Operating Procedure', section: 'sop' },
  swi: { label: 'Standard Work Instruction (SWI)', section: 'swi' },
  form: { label: 'Form', section: 'form' },
  client: { label: 'Client procedure', section: 'client' },
} as const satisfies Record<string, { label: string; section: Section }>;
export type AddType = keyof typeof ADD_TYPES;
export const addTypeOf = (d: { section: Section; doc_type: DocType | null }): AddType => (d.section === 'lesson' ? d.doc_type ?? 'lesson_learnt' : d.section);

export const GLOBAL = 'Global';
export const SOP_COMPANIES = ['NESR', 'SAPESCO', 'Gulf Energy'] as const;

export interface KbFile { id: string; file_name: string; content_type: string; size_bytes: number; revision: number; uploaded_at: string; uploaded_by_name?: string }

export interface KnowledgeDoc {
  id: string; section: Section; country: string; company: string | null; client: string | null;
  doc_type: DocType | null; category: string | null; title: string; summary: string | null; key_action: string | null;
  failure_types: string[]; published_on: string | null; rilr_ref: string | null; source_ref: string | null; duplicate_of: string | null; lesson_of_week_from: string | null;
  doc_no: string | null; revision: number; review_due: string | null; retired_at: string | null;
  /** Document control (6z.14): internal or external origin, author, expiry, a fillable form, when the live revision was published. */
  origin?: 'internal' | 'external'; author?: string | null; expires_on?: string | null; is_form?: number; published_at?: string | null; approved_by?: string | null;
  approved_by_name?: string | null; retire_reason?: string | null;
  /** A SAPESCO or Gulf Energy copy (6z.21): the NESR document it was made from and the NESR revision it follows. */
  copy_of?: string | null; copy_of_revision?: number | null;
  /** The revision being worked on, if any (staff only). */
  open?: { id: string; revision: number; status: 'draft' | 'review' | 'approval'; reviewer: string | null; approver: string | null; sent_back_reason: string | null } | null;
  /** The current document file, if one was uploaded. */
  file?: KbFile | null;
  /** The current editable version (admins only). */
  source?: KbFile | null;
  /** Support files (pictures, videos, documents) kept with the entry, listed under it (6z.19). */
  support?: { id: string; file_name: string; content_type: string; size_bytes: number }[];
}

export interface DocInput {
  type?: unknown; country?: unknown; company?: unknown; client?: unknown; doc_type?: unknown; category?: unknown; title?: unknown; summary?: unknown; key_action?: unknown;
  failure_types?: unknown; published_on?: unknown; rilr_ref?: unknown; source_ref?: unknown; duplicate_of?: unknown; doc_no?: unknown; review_due?: unknown;
  origin?: unknown; author?: unknown; is_form?: unknown;
}

export type CleanDoc = Pick<KnowledgeDoc, 'section' | 'country' | 'company' | 'client' | 'doc_type' | 'category' | 'title' | 'summary' | 'key_action' | 'failure_types'
  | 'published_on' | 'rilr_ref' | 'source_ref' | 'duplicate_of' | 'doc_no' | 'review_due'> & { origin: 'internal' | 'external'; author: string | null; is_form: number };

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Cleans an entry. `countries` are the places it may be filed under (Global is added for lessons and SOPs).
 * The old lesson form sent `doc_type` without `type`; that still works. The link must be a web address.
 */
export function checkDoc(b: DocInput, countries: string[], currentNo?: string | null): { error: string } | { doc: CleanDoc } {
  const type = typeof b.type === 'string' ? b.type : b.doc_type;
  if (!(typeof type === 'string' && type in ADD_TYPES)) return { error: 'Pick the document type' };
  const t = type as AddType;
  const section = ADD_TYPES[t].section;
  const country = text(b.country, 80);
  if (country === GLOBAL ? section === 'client' : !countries.includes(country)) {
    return { error: section === 'client' ? 'Pick the country of the client' : 'Pick a country or Global' };
  }
  // a lesson may say whose it is (6z.28): NESR, SAPESCO or Gulf Energy; none given means NESR
  const given = text(b.company, 40);
  const company = hasCompany(section) || (section === 'lesson' && (SOP_COMPANIES as readonly string[]).includes(given)) ? given : '';
  if (hasCompany(section) && !(SOP_COMPANIES as readonly string[]).includes(company)) return { error: 'Pick the company: NESR, SAPESCO or Gulf Energy' };
  const client = section === 'client' ? text(b.client, 120) : '';
  if (section === 'client' && !client) return { error: 'Name the client' };
  const title = text(b.title, 200);
  if (!title) return { error: 'Give the document a title' };
  const category = text(b.category, 80);
  if (section === 'lesson' && !category) return { error: 'Pick or type a category' };
  const published = text(b.published_on, 10);
  if (published && !isDate(published)) return { error: 'The publication date must be a date' };
  const review = section === 'lesson' ? '' : text(b.review_due, 10);
  if (review && !isDate(review)) return { error: 'The review date must be a date' };
  const link = text(b.source_ref, 1000);
  if (link && !/^https?:\/\/[^\s]+$/i.test(link)) return { error: 'The link must start with https://' };
  let docNo = text(b.doc_no, 40).toUpperCase();
  if (docNo && !/^[A-Z0-9][A-Z0-9 ._/-]*$/.test(docNo)) return { error: 'The document number may use letters, numbers, - . / and spaces' };
  // forms carry their QAF number (6z.27): the one already assigned, written QAF14009, or blank for the next one
  // a number a form already has (an older FRM- number, say) is kept as it is when its details are edited (6z.30)
  if (section === 'form' && docNo && docNo !== (currentNo ?? '').toUpperCase()) {
    const q = qafNumber(docNo);
    if (!q || q.length !== docNo.replace(/[-_ ]/g, '').length) return { error: 'Form numbers are QAF numbers, like QAF14009. Leave it blank to get the next one.' };
    docNo = q;
  }
  const lesson = section === 'lesson';
  const types = lesson && Array.isArray(b.failure_types) ? [...new Set(b.failure_types.map((x) => text(x, 60)).filter(Boolean))].slice(0, 20) : [];
  return {
    doc: {
      section, country, company: company || null, client: client || null, doc_type: lesson ? (t as DocType) : null, category: category || null, title,
      summary: text(b.summary, 4000) || null, key_action: lesson ? text(b.key_action, 1000) || null : null, failure_types: types, published_on: published || null,
      rilr_ref: lesson ? text(b.rilr_ref, 120) || null : null, source_ref: link || null, duplicate_of: lesson ? text(b.duplicate_of, 64) || null : null,
      doc_no: docNo || null, review_due: review || null,
      origin: b.origin === 'external' ? 'external' : 'internal', author: text(b.author, 120) || null, is_form: section === 'form' ? 1 : section !== 'lesson' && (b.is_form === true || b.is_form === 1 || b.is_form === '1') ? 1 : 0,
    },
  };
}

// ---- QAF numbers for forms (6z.27) ------------------------------------------------------------------------------

/** QAF14009, QAF-14009 or "QAF 14009 Pre-job checklist" → QAF14009; null when it does not start with a QAF number. */
export function qafNumber(s: string | null | undefined): string | null {
  const m = /^\s*QAF[-_ ]?(\d{3,7})(?![0-9])/i.exec(s ?? '');
  return m ? `QAF${m[1]}` : null;
}

/** The next free QAF number after the highest in use, as wide as it (QAF14009 → QAF14010); QAF00001 when none is used yet. */
export function nextQaf(numbers: (string | null | undefined)[]): string {
  let max = 0, width = 5;
  for (const n of numbers) {
    const m = /^QAF(\d{3,7})$/.exec(n ?? '');
    if (m && Number(m[1]) >= max) { max = Number(m[1]); width = Math.max(width, m[1].length); }
  }
  return `QAF${String(max + 1).padStart(width, '0')}`;
}

/** Short code for a place in a document number: Global GL, Saudi Arabia SA, Bahrain BAH. */
export function placeCode(country: string): string {
  if (country === GLOBAL) return 'GL';
  const words = country.toUpperCase().replace(/[^A-Z ]/g, '').split(/\s+/).filter(Boolean);
  return words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? 'XX').slice(0, 3);
}
export const COMPANY_CODE: Record<string, string> = { NESR: 'NESR', SAPESCO: 'SAP', 'Gulf Energy': 'GE' };

/** The prefix a new document number counts from: LL-SA, SOP-GL-NESR, CP-BAH. */
export function docPrefix(d: Pick<CleanDoc, 'section' | 'country' | 'company'>): string {
  const head = { lesson: 'LL', sop: 'SOP', swi: 'SWI', form: 'FRM', client: 'CP' }[d.section];
  return [head, placeCode(d.country), hasCompany(d.section) && d.company ? COMPANY_CODE[d.company] ?? 'X' : ''].filter(Boolean).join('-');
}

/** One folder name: no slashes or characters R2 tools dislike, at most 80 characters. */
export const folderName = (s: string) => s.replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';

const SECTION_FOLDER: Record<Section, string> = { lesson: 'Lessons learnt', sop: 'SOPs', swi: 'Work instructions', form: 'Forms', client: 'Client procedures' };

/**
 * Where a file goes in R2, so the bucket reads like a filing cabinet:
 * knowledge/SOPs/Global/NESR/SOP-GL-NESR-001 Slickline rig up/Rev 2/editable/<id8> SOP.docx
 */
export function fileKey(d: Pick<KnowledgeDoc, 'section' | 'country' | 'company' | 'client' | 'doc_no' | 'title'>, revision: number, kind: 'published' | 'source', id: string, name: string): string {
  const parts = ['knowledge', SECTION_FOLDER[d.section], folderName(d.country)];
  if (hasCompany(d.section) && d.company) parts.push(folderName(d.company));
  if (d.section === 'client' && d.client) parts.push(folderName(d.client));
  parts.push(folderName([d.doc_no, d.title].filter(Boolean).join(' ')), `Rev ${revision}`, kind === 'source' ? 'editable' : 'document', `${id.slice(0, 8)} ${name}`);
  return parts.join('/');
}

/** Everyone downloads the current document file; old revisions and the editable version are for admins. */
export function mayDownload(f: { kind: 'published' | 'source'; superseded: boolean }, isAdmin: boolean): boolean {
  return isAdmin || (f.kind === 'published' && !f.superseded);
}

/** Groups for the SOP and client lists: Global first, then each country A to Z. */
export function groupByPlace<T extends { country: string }>(docs: T[]): { place: string; docs: T[] }[] {
  const m = new Map<string, T[]>();
  for (const d of docs) m.set(d.country, [...(m.get(d.country) ?? []), d]);
  return [...m.entries()].sort(([a], [b]) => (a === GLOBAL ? -1 : b === GLOBAL ? 1 : a.localeCompare(b))).map(([place, list]) => ({ place, docs: list }));
}

/** Client procedures for a job: its country only, the job's own client first, then the rest A to Z. */
export function proceduresForJob<T extends Pick<KnowledgeDoc, 'section' | 'country' | 'client' | 'title' | 'retired_at'>>(docs: T[], country: string, client?: string | null): T[] {
  const mine = (d: T) => (client && d.client?.toLowerCase() === client.toLowerCase() ? 0 : 1);
  return docs.filter((d) => d.section === 'client' && !d.retired_at && d.country === country)
    .sort((a, b) => mine(a) - mine(b) || (a.client ?? '').localeCompare(b.client ?? '') || a.title.localeCompare(b.title));
}

/** Review state of a controlled document: overdue, due within 30 days, or fine. */
export function reviewState(due: string | null, today: string): 'overdue' | 'soon' | null {
  if (!due) return null;
  if (due < today) return 'overdue';
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 30);
  return due <= soon.toISOString().slice(0, 10) ? 'soon' : null;
}

/** The lesson of the week: the most recent pick on or before today; without a pick, the newest lesson. */
export function lessonOfWeek(docs: KnowledgeDoc[], today: string): KnowledgeDoc | null {
  const live = docs.filter((d) => !d.duplicate_of && !d.retired_at && (d.section ?? 'lesson') === 'lesson');
  const picked = live.filter((d) => d.lesson_of_week_from && d.lesson_of_week_from <= today).sort((a, b) => b.lesson_of_week_from!.localeCompare(a.lesson_of_week_from!));
  if (picked[0]) return picked[0];
  return [...live].sort((a, b) => (b.published_on ?? '').localeCompare(a.published_on ?? ''))[0] ?? null;
}

export interface LibraryFilter { q?: string; type?: string; category?: string; failure?: string; place?: string; sort?: 'newest' | 'az'; duplicates?: boolean }

/** Text search over everything a person might type: title, number, summary, client, company, category … */
export function matches(d: KnowledgeDoc, q: string): boolean {
  const s = q.trim().toLowerCase();
  return !s || [d.title, d.doc_no, d.summary, d.key_action, d.category, d.rilr_ref, d.client, d.company, d.country, ...d.failure_types].some((x) => x?.toLowerCase().includes(s));
}

/** Filters and sorts the lessons library, with chip counts computed on everything else that is filtered. */
export function filterLibrary(docs: KnowledgeDoc[], f: LibraryFilter) {
  const base = docs.filter((d) => (f.duplicates || !d.duplicate_of) && matches(d, f.q ?? ''));
  const count = (list: KnowledgeDoc[], key: (d: KnowledgeDoc) => string[]) => {
    const m = new Map<string, number>();
    for (const d of list) for (const k of key(d)) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, n]) => ({ value, n }));
  };
  const byType = (d: KnowledgeDoc) => !f.type || d.doc_type === f.type;
  const byCat = (d: KnowledgeDoc) => !f.category || d.category === f.category;
  const byFailure = (d: KnowledgeDoc) => !f.failure || d.failure_types.includes(f.failure);
  const byPlace = (d: KnowledgeDoc) => !f.place || d.country === f.place;
  const docsOut = base.filter((d) => byType(d) && byCat(d) && byFailure(d) && byPlace(d))
    .sort(f.sort === 'az' ? (a, b) => a.title.localeCompare(b.title) : (a, b) => (b.published_on ?? '').localeCompare(a.published_on ?? '') || a.title.localeCompare(b.title));
  return {
    docs: docsOut,
    types: count(base.filter((d) => byCat(d) && byFailure(d) && byPlace(d)), (d) => (d.doc_type ? [d.doc_type] : [])),
    categories: count(base.filter((d) => byType(d) && byFailure(d) && byPlace(d)), (d) => (d.category ? [d.category] : [])),
    failures: count(base.filter((d) => byType(d) && byCat(d) && byPlace(d)), (d) => d.failure_types),
    places: count(base.filter((d) => byType(d) && byCat(d) && byFailure(d)), (d) => [d.country]),
  };
}
