import type { Job } from './types';

// Completion per stage = share of the stage's tracked fields that hold a value.
// Preparation and Closure fields arrive with milestone 2d; until then those stages report 0.

export const STAGES = ['design', 'preparation', 'execution', 'closure'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_FIELDS: Record<Stage, (keyof Job)[]> = {
  design: ['ticket_no', 'sdm_username', 'status', 'unit_number', 'start_date', 'end_date', 'location', 'field', 'rig', 'well', 'conveyance'],
  preparation: [],
  execution: ['arrived_at', 'rig_up_at', 'rig_down_at', 'runs_ok', 'max_depth_ft', 'failure'],
  closure: [],
};

export function stagePercent(job: Partial<Job>, stage: Stage): number {
  const fields = STAGE_FIELDS[stage];
  if (!fields.length) return 0;
  let filled = fields.filter((f) => job[f] !== null && job[f] !== undefined && job[f] !== '').length;
  if (stage === 'design' && job.services?.length) filled += 1;
  const total = fields.length + (stage === 'design' ? 1 : 0);
  return Math.round((filled / total) * 100);
}
