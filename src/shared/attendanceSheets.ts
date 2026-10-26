import { allowed, type RuleDef, type Rules } from './approvalRules';
import type { Role } from './types';

// Attendance categories (owner request, 2026-10-26), managed in Users & Roles → Attendance categories. Each says:
//   fill_scope      who fills a row: 'crew' (a fill role, for the people who report to them, like a Foreman),
//                   'any' (a fill role, for everyone in the category), or 'self' (each person their own row)
//   two_step        a review (first approval) before the approval that locks the month
//   auto_from_jobs  days on assigned jobs fill in by themselves with job_code (see worker/jobDays.ts)
// Who fills, reviews and approves are rules (Users & Roles → Approvals → Attendance), one set per category.
// Admins and the Attendance Admin may fill any row; Admins may review and approve any row. Anyone marked "fills own
// attendance" (SELF) may fill their own row in any category.

export type SheetKey = string;
export type FillScope = 'crew' | 'any' | 'self';
export interface Category { key: string; label: string; sort: number; fill_scope: FillScope; two_step: number; auto_from_jobs: number; job_code: string; builtin: number }

/** What the app shipped with; the table is the truth once migrated. Used as a fallback and in tests. */
export const DEFAULT_CATEGORIES: Category[] = [
  { key: 'field', label: 'Operators & Helpers', sort: 1, fill_scope: 'crew', two_step: 0, auto_from_jobs: 1, job_code: 'JBFS', builtin: 1 },
  { key: 'field_staff', label: 'Field Supervisors / Engineers', sort: 2, fill_scope: 'any', two_step: 1, auto_from_jobs: 1, job_code: 'JBFS', builtin: 1 },
  { key: 'shop', label: 'Support Staff (Shop)', sort: 3, fill_scope: 'any', two_step: 0, auto_from_jobs: 0, job_code: 'JBFS', builtin: 1 },
  { key: 'management', label: 'Management', sort: 4, fill_scope: 'self', two_step: 0, auto_from_jobs: 0, job_code: 'JBFS', builtin: 1 },
];

export const FILL_SCOPE_LABEL: Record<FillScope, string> = {
  crew: 'their foreman (a fill role, for the crew who report to them)',
  any: 'a fill role, for everyone in the category',
  self: 'each person, their own row',
};

const ROLE_DEFAULTS: Record<string, { fill: Role[]; review: Role[]; approve: Role[] }> = {
  field: { fill: ['foreman'], review: ['sdm'], approve: ['sdm'] },
  field_staff: { fill: ['sdm'], review: ['sdm'], approve: ['operations_manager'] },
  shop: { fill: ['maintenance_supervisor'], review: ['maintenance_supervisor'], approve: ['maintenance_manager'] },
  management: { fill: [], review: ['operations_manager'], approve: ['operations_manager'] },
};

export const fillKey = (k: string) => `attendance.${k}.fill`;
export const reviewKey = (k: string) => `attendance.${k}.review`;
export const approveKey = (k: string) => `attendance.${k}.approve`;

/** The rules each category brings to Users & Roles → Approvals. */
export function categoryRules(cats: Category[]): RuleDef[] {
  return [...cats].sort((a, b) => a.sort - b.sort).flatMap((c) => {
    const d = ROLE_DEFAULTS[c.key] ?? { fill: [], review: [], approve: ['operations_manager'] };
    return [
      ...(c.fill_scope === 'self' ? [] : [{ key: fillKey(c.key), group: 'Attendance' as const, label: `${c.label}: fill${c.fill_scope === 'crew' ? ' (their own crew)' : ''}`, help: c.auto_from_jobs ? 'Days on assigned jobs fill in by themselves; these roles fill the rest' : undefined, defaults: d.fill }]),
      ...(c.two_step ? [{ key: reviewKey(c.key), group: 'Attendance' as const, label: `${c.label}: review (first approval)`, defaults: d.review }] : []),
      { key: approveKey(c.key), group: 'Attendance' as const, label: `${c.label}: ${c.two_step ? 'final approval' : 'approve'}`, help: c.fill_scope === 'self' ? 'Rows are filled by the person themselves' : undefined, defaults: d.approve },
    ];
  });
}

/** People who may fill or approve any row also see the whole sheet. */
const SEE_ALL: Role[] = ['admin', 'attendance_admin', 'operations_manager', 'director', 'sqm'];

export interface Viewer { username: string; role: Role }
export interface SheetRow {
  attendance_sheet: SheetKey | null;
  /** WIREGUARD username of the person on the row, when linked */
  wg_username: string | null;
  /** WIREGUARD username of the person they report to (their foreman), when linked */
  reports_to_username: string | null;
  self_updated: number;
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const catOf = (r: SheetRow, cats: Category[]) => cats.find((c) => c.key === r.attendance_sheet) ?? null;

export function canFill(v: Viewer, r: SheetRow, rules: Rules | null | undefined, cats: Category[] = DEFAULT_CATEGORIES): boolean {
  if (v.role === 'admin' || v.role === 'attendance_admin') return true;
  const cat = catOf(r, cats);
  if (!cat) return false;
  const own = same(v.username, r.wg_username);
  if (own && (cat.fill_scope === 'self' || r.self_updated)) return true;
  if (cat.fill_scope === 'crew') return allowed(rules, fillKey(cat.key), v.role) && (same(v.username, r.reports_to_username) || own);
  if (cat.fill_scope === 'any') return allowed(rules, fillKey(cat.key), v.role);
  return false;
}

/** The first of two approvals; categories with one step have none. */
export function canReview(v: Viewer, r: SheetRow, rules: Rules | null | undefined, cats: Category[] = DEFAULT_CATEGORIES): boolean {
  const cat = catOf(r, cats);
  return !!cat?.two_step && (v.role === 'admin' || allowed(rules, reviewKey(cat.key), v.role));
}

export function canApprove(v: Viewer, r: SheetRow, rules: Rules | null | undefined, cats: Category[] = DEFAULT_CATEGORIES): boolean {
  const cat = catOf(r, cats);
  if (!cat) return false;
  return v.role === 'admin' || allowed(rules, approveKey(cat.key), v.role);
}

/** Rows a person sees: everything for managers, otherwise the rows they fill, review or approve, and their own. */
export function canSee(v: Viewer, r: SheetRow, rules: Rules | null | undefined, cats: Category[] = DEFAULT_CATEGORIES): boolean {
  return SEE_ALL.includes(v.role) || canFill(v, r, rules, cats) || canReview(v, r, rules, cats) || canApprove(v, r, rules, cats) || same(v.username, r.wg_username);
}

/** The roles of a rule as words, for the sheet's headings ("Foreman", "SDM, Ops Manager"). */
export const rolesText = (rules: Rules | null | undefined, key: string, label: (r: Role) => string) => {
  const list = rules?.[key] ?? [];
  return list.length ? list.map(label).join(', ') : 'Admin';
};
