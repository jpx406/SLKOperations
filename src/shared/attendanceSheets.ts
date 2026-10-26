import type { Role } from './types';

// Who fills and who approves each attendance sheet (owner request, 2026-10-26). The server enforces these on
// every save and approval; the sheet uses the same rules to show what each person may do.
//
//   field       Operators & Helpers      filled by the Foreman (their own crew)        approved by the SDM
//   shop        Support Staff (Shop)     filled by the Maintenance Supervisor          approved by the Maintenance Manager
//   management  Management               filled by the person themselves or an Admin   approved by the Operations Manager
//
// Admins and the Attendance Admin may fill any row; Admins may approve any row. Anyone marked "fills own
// attendance" (SELF) in the Headcount Roster may fill their own row.

export type SheetKey = 'field' | 'shop' | 'management';

export const SHEETS: Record<SheetKey, { label: string; filledBy: string; approvedBy: string; fillRoles: Role[]; approveRoles: Role[] }> = {
  field: { label: 'Operators & Helpers', filledBy: 'Foreman', approvedBy: 'SDM', fillRoles: ['foreman'], approveRoles: ['sdm'] },
  shop: { label: 'Support Staff (Shop)', filledBy: 'Maintenance Supervisor', approvedBy: 'Maintenance Manager', fillRoles: ['maintenance_supervisor'], approveRoles: ['maintenance_manager'] },
  management: { label: 'Management', filledBy: 'Self or Admin', approvedBy: 'Operations Manager', fillRoles: [], approveRoles: ['operations_manager'] },
};
export const SHEET_KEYS = Object.keys(SHEETS) as SheetKey[];

export const isSheet = (v: unknown): v is SheetKey => typeof v === 'string' && v in SHEETS;

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
const sheetOf = (r: SheetRow): SheetKey => r.attendance_sheet ?? 'shop';

export function canFill(v: Viewer, r: SheetRow): boolean {
  if (v.role === 'admin' || v.role === 'attendance_admin') return true;
  const own = same(v.username, r.wg_username);
  const sheet = sheetOf(r);
  if (own && (sheet === 'management' || r.self_updated)) return true;
  if (sheet === 'field') return v.role === 'foreman' && (same(v.username, r.reports_to_username) || own);
  if (sheet === 'shop') return v.role === 'maintenance_supervisor';
  return false;
}

export function canApprove(v: Viewer, r: SheetRow): boolean {
  if (v.role === 'admin') return true;
  return SHEETS[sheetOf(r)].approveRoles.includes(v.role);
}

/** Rows a person sees: everything for managers of the sheet, otherwise the rows they fill or approve, and their own. */
export function canSee(v: Viewer, r: SheetRow): boolean {
  return SEE_ALL.includes(v.role) || canFill(v, r) || canApprove(v, r) || same(v.username, r.wg_username);
}

/** A new roster entry's sheet, from the crew role: crews are field, everyone else starts in the shop. */
export const defaultSheet = (crewRole: string | null | undefined): SheetKey =>
  ['slickline_supervisor', 'slickline_operator', 'assistant_operator', 'helper', 'trainee'].includes(crewRole ?? '') ? 'field' : 'shop';
