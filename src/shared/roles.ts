import type { BuiltinRole, Role } from './types';

// First sign-in default: the SLK Ops role a WIREGUARD role maps to. An SLK Ops admin adjusts it afterwards.
export const DEFAULT_ROLE_FROM_WG: Record<string, Role> = {
  Admin: 'admin',
  'Data Manager': 'viewer',
  Maintenance: 'maintenance_manager',
  Supervisor: 'slickline_supervisor',
  Viewer: 'viewer',
};

export const defaultRoleFor = (wgRole: string | null | undefined): Role => DEFAULT_ROLE_FROM_WG[wgRole ?? ''] ?? 'viewer';

export const ROLE_LABEL: Record<BuiltinRole, string> = {
  admin: 'Admin',
  operations_manager: 'Ops Manager',
  maintenance_manager: 'Maintenance Mgr',
  sdm: 'SDM',
  deputy_sdm: 'Deputy SDM',
  sales: 'Sales',
  director: 'Director',
  sqm: 'SQM',
  slickline_supervisor: 'SLK Supervisor',
  slickline_operator: 'SLK Operator',
  assistant_operator: 'Asst. Operator',
  crew: 'Crew',
  viewer: 'Viewer',
  explosive_manager: 'Explosive Mgr',
  explosive_admin: 'Explosive Admin',
  storekeeper: 'Storekeeper',
  attendance_admin: 'Attendance Admin',
  slk_contact: 'SLK Contact',
  foreman: 'Foreman',
  maintenance_supervisor: 'Maint. Supervisor',
};

// Labels of roles added in Users & Roles, filled from /api/roles on the client (and per request on the server).
const extraLabels = new Map<string, string>();
export function setRoleLabels(list: { key: string; label: string }[]) {
  extraLabels.clear();
  for (const r of list) extraLabels.set(r.key, r.label);
}
/** A role's name for people: an edited or added label first, then the built-in one, then the key. */
export const roleLabel = (role: Role | null | undefined): string =>
  !role ? '' : extraLabels.get(role) ?? (ROLE_LABEL as Record<string, string>)[role] ?? role.replace(/_/g, ' ');
