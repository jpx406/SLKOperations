import type { Role } from './types';

// Who may edit each job field, on top of the jobs:edit menu right. Admin may edit everything.
// One map for both sides: the editor greys out fields, the API drops fields the caller may not set.

const PLANNERS: Role[] = ['sales', 'sdm', 'deputy_sdm', 'operations_manager', 'sqm'];
const MANAGERS: Role[] = ['sdm', 'deputy_sdm', 'operations_manager'];
const FIELD_CREW: Role[] = ['slickline_supervisor', 'slickline_operator', ...MANAGERS, 'sqm'];

export const FIELD_POLICY: Record<string, { roles: Role[]; badge: string }> = {
  ticket_no: { roles: PLANNERS, badge: 'SALES' },
  drss_no: { roles: PLANNERS, badge: 'SALES' },
  status: { roles: PLANNERS, badge: 'SALES / SDM' },
  run_details: { roles: PLANNERS, badge: 'SALES' },
  start_date: { roles: PLANNERS, badge: 'SALES' },
  location: { roles: PLANNERS, badge: 'SALES' },
  field: { roles: PLANNERS, badge: 'SALES' },
  rig: { roles: PLANNERS, badge: 'SALES' },
  well: { roles: PLANNERS, badge: 'SALES' },
  conveyance: { roles: PLANNERS, badge: 'SALES' },
  sdm_username: { roles: MANAGERS, badge: 'SDM' },
  unit_number: { roles: MANAGERS, badge: 'SDM' },
  end_date: { roles: MANAGERS, badge: 'SDM' },
  arrived_at: { roles: FIELD_CREW, badge: 'CREW' },
  rig_up_at: { roles: FIELD_CREW, badge: 'CREW' },
  rig_down_at: { roles: FIELD_CREW, badge: 'CREW' },
  runs_ok: { roles: FIELD_CREW, badge: 'CREW' },
  runs_failed: { roles: FIELD_CREW, badge: 'CREW' },
  max_depth_ft: { roles: FIELD_CREW, badge: 'CREW' },
  tag_depth_ft: { roles: FIELD_CREW, badge: 'CREW' },
  max_pull_lb: { roles: FIELD_CREW, badge: 'CREW' },
  jarring_minutes: { roles: FIELD_CREW, badge: 'CREW' },
  wire_cut_ft: { roles: FIELD_CREW, badge: 'CREW' },
  npt_hours: { roles: FIELD_CREW, badge: 'CREW' },
  failure: { roles: FIELD_CREW, badge: 'CREW' },
  op_hours_override: { roles: ['sdm', 'operations_manager'], badge: 'SDM / OPS' },
};

export const EDITABLE_FIELDS = Object.keys(FIELD_POLICY);

export const canEditField = (role: Role, field: string) =>
  role === 'admin' || !!FIELD_POLICY[field]?.roles.includes(role);

/** Splits a patch into what this role may write and what it may not. */
export function filterPatch(role: Role, patch: Record<string, unknown>) {
  const allowed: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (EDITABLE_FIELDS.includes(k) && canEditField(role, k)) allowed[k] = v;
    else dropped.push(k);
  }
  return { allowed, dropped };
}
