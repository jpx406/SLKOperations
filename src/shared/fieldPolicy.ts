import { allowed, type Rules } from './approvalRules';
import { canEditStage, type Stage } from './stages';
import type { Role } from './types';

// Who may edit each job field, on top of the jobs:edit menu right. Admin may edit everything.
// Each field belongs to a rule (shared/approvalRules.ts) whose roles the admin sets in Users & Roles → Approvals.
// One map for both sides: the editor greys out fields, the API drops fields the caller may not set.

/** Execution fields: on a job that needs a JRA they stay closed until the JRA is approved. */
export const EXECUTION_FIELDS = ['arrived_at', 'rig_up_at', 'rig_down_at', 'runs_ok', 'runs_failed', 'max_depth_ft', 'tag_depth_ft', 'max_pull_lb', 'max_overpull_lb',
  'jarring_minutes', 'wire_cut_ft', 'npt_hours', 'failure', 'plug_type', 'op_time_details', 'survey_details', 'fishing_details', 'perforation_details'];
const PLAIN_EXECUTION = EXECUTION_FIELDS.filter((f) => !f.endsWith('_details') || f === 'op_time_details');

type Policy = { rule: string; badge: string; kind?: 'json' | 'money' };

const fields = (names: string[], rule: string, badge: string, kind?: Policy['kind']) =>
  Object.fromEntries(names.map((n) => [n, { rule, badge, kind } as Policy]));

export const FIELD_POLICY: Record<string, Policy> = {
  // 01 Design
  ...fields(['ticket_no', 'drss_no', 'dmr_no', 'run_details', 'start_date', 'location', 'field', 'rig', 'well', 'conveyance', 'third_party_required'], 'job.design', 'SALES'),
  status: { rule: 'job.design', badge: 'SALES / SDM' },
  ...fields(['sdm_username', 'unit_number', 'end_date', 'program_in_place'], 'job.design_sdm', 'SDM'),
  // 02 Preparation
  ...fields([
    'account_assignment', 'well_type', 'h2s_ppm', 'co2_pct', 'bht_f', 'bhp_psi', 'siwhp_psi', 'fluid_type', 'fluid_weight_pcf', 'solids_pct',
    'target_depth_ft', 'top_interval_ft', 'completion_details', 'nipple_profile', 'sssv_depth_ft', 'min_restriction_in', 'max_inclination_deg',
    'target_casing_type', 'target_casing_od', 'target_casing_weight_lbft', 'target_casing_grade', 'wellhead_connection',
    'wire_serial_number', 'drum_no', 'pce_id', 'pressure_rating_psi', 'lubricator_length_ft', 'stuffing_box_type', 'grease_panel_id',
    'jar_type', 'special_setup', 'special_setup_notes',
  ], 'job.prep', 'PREP'),
  toolstring: { rule: 'job.prep', badge: 'PREP', kind: 'json' },
  // 03 Execution
  ...fields(PLAIN_EXECUTION, 'job.exec', 'CREW'),
  ...fields(['survey_details', 'fishing_details', 'perforation_details'], 'job.exec', 'CREW', 'json'),
  op_hours_override: { rule: 'job.op_hours', badge: 'SDM / OPS' },
  // 04 Closure
  ...fields(['job_log_signed', 'ticket_signed', 'job_package_url', 'wellsite_audit', 'wg_runs_logged'], 'closure.signoff', 'CREW'),
  ...fields(['eight_min_facts_done', 'prelim_report', 'final_report', 'report_closure_status', 'report_closure_date', 'gears_no', 'failure_description'], 'closure.failure', 'SQM / SDM'),
  ...fields(['service_order', 'service_order_no', 'bonus_remarks'], 'closure.service', 'SDM'),
  revenue_cents: { rule: 'closure.revenue', badge: 'SDM / SALES', kind: 'money' },
};

export const EDITABLE_FIELDS = Object.keys(FIELD_POLICY);
export const JSON_FIELDS = EDITABLE_FIELDS.filter((f) => FIELD_POLICY[f].kind === 'json');

export const canEditField = (role: Role, field: string, rules?: Rules | null) =>
  role === 'admin' || (!!FIELD_POLICY[field] && allowed(rules, FIELD_POLICY[field].rule, role));

const RULE_STAGE: Record<string, Stage> = { 'job.design': 'design', 'job.design_sdm': 'design', 'job.prep': 'preparation', 'job.exec': 'execution', 'job.op_hours': 'execution' };
/** The job stage a field is on, for the per-stage rights. */
export const stageOfField = (field: string): Stage | null => {
  const rule = FIELD_POLICY[field]?.rule;
  return !rule ? null : rule.startsWith('closure.') ? 'closure' : RULE_STAGE[rule] ?? null;
};

/** Splits a patch into what this role may write and what it may not. With the caller's rights, the field's stage must be editable too. */
export function filterPatch(role: Role, patch: Record<string, unknown>, rules?: Rules | null, menus?: Parameters<typeof canEditStage>[0]) {
  const allowedPatch: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const stage = stageOfField(k);
    if (EDITABLE_FIELDS.includes(k) && canEditField(role, k, rules) && (!menus || !stage || canEditStage(menus, stage))) allowedPatch[k] = v;
    else dropped.push(k);
  }
  return { allowed: allowedPatch, dropped };
}

/** Service sections: a detail field opens only when the job has that service. */
export const SERVICE_GATED: Record<string, 'is_plug' | 'is_fishing' | 'is_memory' | 'is_perforation'> = {
  plug_type: 'is_plug',
  fishing_details: 'is_fishing',
  survey_details: 'is_memory',
  perforation_details: 'is_perforation',
};

/** Closure fields that stay locked on a clean job (no NPT, no failure) — also a database check. */
export const FAILURE_GATED = ['eight_min_facts_done', 'prelim_report', 'final_report', 'report_closure_status', 'report_closure_date', 'gears_no', 'failure_description'];
