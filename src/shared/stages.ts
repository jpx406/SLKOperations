import type { Job } from './types';

// Completion per stage = share of the stage's tracked fields that hold a value.
// Closure also tracks the failure follow-up, but only on a job with NPT or a failure (otherwise it stays locked).

export const STAGES = ['design', 'preparation', 'execution', 'closure'] as const;
export type Stage = (typeof STAGES)[number];

/** Each stage has its own right in Users & Roles (view / edit), next to Jobs. */
export const stageMenu = (s: Stage) => `job_${s}`;
export const STAGE_MENUS = STAGES.map(stageMenu);
export const STAGE_LABEL: Record<Stage, string> = { design: '01 Design', preparation: '02 Preparation', execution: '03 Execution', closure: '04 Closure' };
type Rights = Record<string, { view: boolean; edit: boolean } | undefined>;
export const canSeeStage = (menus: Rights, s: Stage) => !!menus[stageMenu(s)]?.view;
export const canEditStage = (menus: Rights, s: Stage) => !!menus.jobs?.edit && !!menus[stageMenu(s)]?.edit;

export const STAGE_FIELDS: Record<Stage, (keyof Job)[]> = {
  design: ['ticket_no', 'sdm_username', 'status', 'unit_number', 'start_date', 'end_date', 'location', 'field', 'rig', 'well', 'conveyance'],
  preparation: ['well_type', 'fluid_type', 'target_depth_ft', 'min_restriction_in', 'siwhp_psi', 'wire_serial_number', 'drum_no', 'pce_id', 'pressure_rating_psi', 'toolstring'],
  execution: ['arrived_at', 'rig_up_at', 'rig_down_at', 'runs_ok', 'max_depth_ft', 'failure'],
  closure: ['job_log_signed', 'ticket_signed', 'job_package_url', 'wellsite_audit', 'wg_runs_logged', 'service_order', 'revenue_cents'],
};

export const FAILURE_FOLLOW_UP: (keyof Job)[] = ['eight_min_facts_done', 'prelim_report', 'final_report', 'report_closure_status', 'failure_description'];

export const hasFailure = (job: Partial<Job>) => (job.npt_hours ?? 0) > 0 || job.failure === 'yes';

const filled = (v: unknown) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);

export function stagePercent(job: Partial<Job>, stage: Stage): number {
  const fields = stage === 'closure' && hasFailure(job) ? [...STAGE_FIELDS.closure, ...FAILURE_FOLLOW_UP] : STAGE_FIELDS[stage];
  let done = fields.filter((f) => filled(job[f])).length;
  if (stage === 'design' && job.services?.length) done += 1;
  const total = fields.length + (stage === 'design' ? 1 : 0);
  return Math.round((done / total) * 100);
}
