import { describe, expect, it } from 'vitest';
import { EXTRA_COLUMNS, boardColumns } from '../src/worker/jobs';
import { STAGE_FIELDS } from '../src/shared/stages';

// 6z.50: the Job board failed on production once a Preparation field moved to job_extras; the board reads each
// field from the table that holds it

describe('job board columns', () => {
  it('reads job_extras fields from job_extras, the rest from jobs', () => {
    const cols = boardColumns().split(', ');
    for (const c of EXTRA_COLUMNS) expect(cols).not.toContain(`j.${c}`);
    expect(cols).toContain('x.min_restriction_depth_ft');
    expect(cols).toContain('j.runs_failed');
    for (const f of STAGE_FIELDS.preparation) expect(cols.some((c) => c.endsWith(`.${f}`))).toBe(true);
  });
});
