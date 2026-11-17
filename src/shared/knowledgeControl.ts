// Document control for the Knowledge Hub (6z.14), after the NESR Document Control app (nesr/DOC_control):
// review and approval, revision numbers, who may open which file, numbering settings, review and expiry dates,
// the document register and batch upload. Pure rules, used by the Worker and the page.

import { ADD_TYPES, COMPANY_CODE, hasCompany, placeCode, type AddType, type KnowledgeDoc, type Section } from './knowledge';

export const REV_STATUS = {
  draft: 'Draft', review: 'In review', approval: 'Awaiting approval', approved: 'Published', superseded: 'Superseded', discarded: 'Discarded',
} as const;
export type RevStatus = keyof typeof REV_STATUS;
export const OPEN_STATUSES: RevStatus[] = ['draft', 'review', 'approval'];

export interface Revision {
  id: string; doc_id: string; revision: number; status: RevStatus; change_note: string | null; author: string | null; revision_date: string | null; expires_on: string | null;
  created_by: string | null; created_at: string; submitted_by: string | null; submitted_at: string | null; reviewer: string | null; reviewed_at: string | null; review_comment: string | null;
  approver: string | null; approved_at: string | null; approve_comment: string | null; sent_back_by: string | null; sent_back_at: string | null; sent_back_reason: string | null;
  reviewer_name?: string | null; approver_name?: string | null; submitted_by_name?: string | null; created_by_name?: string | null;
}

/** What a person is in document control. Admins are everything; editors are people with the tab's edit right. */
export interface Controller { username: string; admin: boolean; editor: boolean; reviewer: boolean; approver: boolean }
export const isStaff = (p: Controller) => p.admin || p.editor || p.reviewer || p.approver;

export type FlowAction = 'submit' | 'review' | 'approve' | 'send_back' | 'discard' | 'edit_files';

/**
 * Who may move a revision. The person who submitted it may not review or approve it, unless an admin
 * (as with the diagram Verify step). Sending back is for the one holding it at that step.
 */
export function mayAct(p: Controller, rev: Pick<Revision, 'status' | 'reviewer' | 'approver' | 'submitted_by' | 'created_by'>, action: FlowAction): boolean {
  const own = (u: string | null) => !!u && u.toLowerCase() === p.username.toLowerCase();
  switch (action) {
    case 'submit': case 'edit_files': case 'discard':
      return rev.status === 'draft' && (p.admin || p.editor);
    case 'review':
      return rev.status === 'review' && (p.admin || (p.reviewer && own(rev.reviewer) && !own(rev.submitted_by)));
    case 'approve':
      return rev.status === 'approval' && (p.admin || (p.approver && own(rev.approver) && !own(rev.submitted_by)));
    case 'send_back':
      return (rev.status === 'review' && (p.admin || own(rev.reviewer))) || (rev.status === 'approval' && (p.admin || own(rev.approver)));
  }
}

/** Retiring (with a reason) and restoring are for admins and approvers, as in Document Control. */
export const mayRetire = (p: Controller) => p.admin || p.approver;

export interface FileInfo { kind: 'published' | 'source'; content_type: string; file_name: string }

/**
 * What a revision needs before it goes to review, after Document Control's required formats:
 * SOPs and client procedures a PDF and the editable version (Word or Excel); a form its fillable file;
 * a lesson a file or a written summary.
 */
export function submitProblems(doc: Pick<KnowledgeDoc, 'section' | 'summary'> & { is_form?: number | boolean }, files: FileInfo[]): string[] {
  const doc_ = files.find((f) => f.kind === 'published');
  const source = files.find((f) => f.kind === 'source');
  const out: string[] = [];
  if (doc.section === 'lesson') {
    if (!doc_ && !doc.summary) out.push('Add the document file or write the summary');
    return out;
  }
  if (doc.section === 'form') {
    if (!doc_) out.push('Add the form file (Excel, Word, PowerPoint or PDF)');
    return out;
  }
  if (!doc_) out.push('Add the document file (PDF)');
  else if (!doc.is_form && doc_.content_type !== 'application/pdf') out.push('The document file must be a PDF');
  if (!source) out.push(doc.is_form ? 'Add the fillable form (Word or Excel)' : 'Add the editable version (Word or Excel)');
  return out;
}

/**
 * Who may open a file. Everyone: the published revision's document file (and, for a form, its fillable file).
 * Staff (editors, reviewers, approvers, admins): the editable version, and the files of a revision being worked on.
 * Older revisions: reviewers, approvers and admins.
 */
export function mayOpen(p: Controller, f: { kind: 'published' | 'source'; revision: number }, doc: { revision: number; published_at: string | null; is_form?: number | boolean }, revStatus: RevStatus): boolean {
  const live = revStatus === 'approved' && !!doc.published_at && f.revision === doc.revision;
  if (live && (f.kind === 'published' || doc.is_form)) return true;
  if (!isStaff(p)) return false;
  if (live || OPEN_STATUSES.includes(revStatus)) return true;
  return p.admin || p.reviewer || p.approver;
}

// ---- numbering ---------------------------------------------------------------------------------------------

export interface Numbering { mode: 'auto' | 'manual'; prefix: Record<Section, string>; digits: number; place: boolean }
export const DEFAULT_NUMBERING: Numbering = { mode: 'auto', prefix: { lesson: 'LL', sop: 'SOP', swi: 'SWI', form: 'FRM', client: 'CP' }, digits: 3, place: true };
export interface Periods { reviewMonths: number; expiryMonths: number }
export const DEFAULT_PERIODS: Periods = { reviewMonths: 12, expiryMonths: 36 };

export function checkNumbering(v: unknown): { error: string } | { value: Numbering } {
  const b = (v ?? {}) as Partial<Numbering> & { prefix?: Partial<Record<Section, unknown>> };
  const mode = b.mode === 'manual' ? 'manual' : 'auto';
  const digits = Number(b.digits);
  if (!Number.isInteger(digits) || digits < 2 || digits > 6) return { error: 'Digits must be 2 to 6' };
  const prefix = {} as Record<Section, string>;
  for (const s of ['lesson', 'sop', 'swi', 'form', 'client'] as Section[]) {
    // a section saved before it existed keeps its default prefix
    const p = String(b.prefix?.[s] ?? DEFAULT_NUMBERING.prefix[s]).trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]{0,7}$/.test(p)) return { error: 'Each prefix is 1 to 8 letters or numbers, starting with a letter' };
    prefix[s] = p;
  }
  if (new Set(Object.values(prefix)).size < 5) return { error: 'Each section needs its own prefix' };
  return { value: { mode, prefix, digits, place: b.place !== false } };
}

export function checkPeriods(v: unknown): { error: string } | { value: Periods } {
  const b = (v ?? {}) as Partial<Periods>;
  const r = Number(b.reviewMonths), e = Number(b.expiryMonths);
  if (!Number.isInteger(r) || r < 1 || r > 60) return { error: 'The review period is 1 to 60 months' };
  if (!Number.isInteger(e) || e < 1 || e > 120) return { error: 'The expiry period is 1 to 120 months' };
  return { value: { reviewMonths: r, expiryMonths: e } };
}


/** The prefix a new number counts from: SOP-GL-NESR, LL-SA, CP-BAH (or just SOP when places are left out). */
export function numberPrefix(d: { section: Section; country: string; company: string | null }, n: Numbering = DEFAULT_NUMBERING): string {
  const parts = [n.prefix[d.section]];
  if (n.place) parts.push(placeCode(d.country));
  if (hasCompany(d.section) && d.company) parts.push(COMPANY_CODE[d.company] ?? 'X');
  return parts.join('-');
}
export const formatNumber = (prefix: string, next: number, digits: number) => `${prefix}-${String(next).padStart(digits, '0')}`;

// ---- dates ----------------------------------------------------------------------------------------------------

export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** Expiry: expired, or within 90 days, as Document Control flags it. */
export function expiryState(expires: string | null, today: string): 'expired' | 'soon' | null {
  if (!expires) return null;
  if (expires < today) return 'expired';
  return expires <= addMonths(today, 3) ? 'soon' : null;
}

/** A new revision's number: the one typed, which must be above the live one, or the next. */
export function nextRevision(current: number, published: boolean, typed?: unknown): { error: string } | { value: number } {
  const want = published ? current + 1 : current;
  if (typed === undefined || typed === null || typed === '') return { value: want };
  const n = Number(typed);
  if (!Number.isInteger(n) || n < 0 || n > 999) return { error: 'The revision is a whole number from 0 to 999' };
  if (published && n <= current) return { error: `The new revision must be above Rev ${current}` };
  return { value: n };
}

// ---- register ---------------------------------------------------------------------------------------------

export const REGISTER_FILTERS = {
  all: 'All', published: 'Published', in_work: 'In review or approval', draft: 'Draft', review_overdue: 'Review overdue', expiring: 'Expired or expiring', external: 'External', retired: 'Retired',
} as const;
export type RegisterFilter = keyof typeof REGISTER_FILTERS;

export interface RegisterRow {
  doc: KnowledgeDoc & { origin?: string; author?: string | null; expires_on?: string | null; published_at?: string | null; approved_by_name?: string | null; is_form?: number };
  open?: Pick<Revision, 'revision' | 'status'> | null;
  priorRevisions: number;
}

export function registerMatches(r: RegisterRow, f: RegisterFilter, today: string, reviewOverdue: (due: string | null) => boolean): boolean {
  const d = r.doc;
  if (f === 'retired') return !!d.retired_at;
  if (d.retired_at) return f === 'all';
  switch (f) {
    case 'all': return true;
    case 'published': return !!d.published_at;
    case 'in_work': return !!r.open && (r.open.status === 'review' || r.open.status === 'approval');
    case 'draft': return !!r.open && r.open.status === 'draft';
    case 'review_overdue': return !!d.published_at && reviewOverdue(d.review_due);
    case 'expiring': return !!expiryState(d.expires_on ?? null, today);
    case 'external': return d.origin === 'external';
  }
}

const SECTION_SHORT: Record<Section, string> = { lesson: 'Lessons', sop: 'SOPs', swi: 'SWIs', form: 'Forms', client: 'Client procedures' };
export const REGISTER_HEADER = ['Doc No', 'Title', 'Section', 'Type', 'Country', 'Company / client', 'Origin', 'Rev', 'Status', 'Approved by', 'Published', 'Next review', 'Expires', 'Flags', 'Prior revisions'];

export function registerCells(r: RegisterRow, flags: string[]): (string | number | null)[] {
  const d = r.doc;
  const status = d.retired_at ? 'Retired' : d.published_at ? (r.open ? `Published, Rev ${r.open.revision} ${REV_STATUS[r.open.status].toLowerCase()}` : 'Published') : r.open ? REV_STATUS[r.open.status] : 'Draft';
  const type = d.section === 'lesson' ? ADD_TYPES[(d.doc_type ?? 'lesson_learnt') as AddType].label : ADD_TYPES[d.section].label;
  return [d.doc_no, d.title, SECTION_SHORT[d.section], d.is_form && d.section !== 'form' ? `${type} (form)` : type, d.country,
    d.company ?? d.client ?? '', d.origin === 'external' ? 'External' : 'Internal', d.published_at ? d.revision : null, status, d.approved_by_name ?? null,
    d.published_at ? d.published_at.slice(0, 10) : null, d.review_due, d.expires_on ?? null, flags.join(', '), r.priorRevisions];
}

// ---- batch upload -----------------------------------------------------------------------------------------------

/** Files with the same base name belong together: SOP-012 Rig up.pdf and SOP-012 Rig up.docx make one document. */
export function groupFiles<T extends { name: string }>(files: T[]): { base: string; files: T[] }[] {
  const m = new Map<string, T[]>();
  for (const f of files) {
    const base = f.name.replace(/\.[a-z0-9]{1,6}$/i, '').trim();
    m.set(base.toLowerCase(), [...(m.get(base.toLowerCase()) ?? []), f]);
  }
  return [...m.values()].map((list) => ({ base: list[0].name.replace(/\.[a-z0-9]{1,6}$/i, '').trim(), files: list }));
}

/** Guesses the type from the start of the file name (SOP-, LL-, CP-, LFI-, BP-), else the section in view. */
export function guessType(base: string, fallback: AddType): AddType {
  const b = base.toUpperCase();
  if (/^SOP\b|^SOP[-_ ]/.test(b)) return 'sop';
  if (/^SWI[-_ ]/.test(b)) return 'swi';
  if (/^(FRM|FORM)[-_ ]/.test(b)) return 'form';
  if (/^CP[-_ ]/.test(b)) return 'client';
  if (/^LFI[-_ ]/.test(b)) return 'learning_from_incident';
  if (/^BP[-_ ]/.test(b)) return 'best_practice';
  if (/^LL[-_ ]/.test(b)) return 'lesson_learnt';
  return fallback;
}

/** A number at the start of the name (SOP-GL-NESR-012 Rig up → SOP-GL-NESR-012) and the title after it. */
export function splitBase(base: string): { doc_no: string | null; title: string } {
  const m = /^([A-Z]{1,8}(?:-[A-Z0-9]{1,8})*-\d{2,6})[\s_-]+(.+)$/i.exec(base.trim());
  if (m) return { doc_no: m[1].toUpperCase(), title: m[2].replace(/[_]+/g, ' ').trim() };
  // a type code without a number (BP-Spooling the drum) only says the type: drop it from the title
  return { doc_no: null, title: base.replace(/^(SOP|SWI|FRM|FORM|LL|CP|LFI|BP)[-_ ]+/i, '').replace(/[_]+/g, ' ').trim() };
}
