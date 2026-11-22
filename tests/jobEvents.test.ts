import { describe, expect, it } from 'vitest';
import { fromEvents } from '../src/shared/jobEvents';
import { STAGE_FIELDS, needsFollowUp } from '../src/shared/stages';

// 6z.49: Execution's times, runs and depths read from the Job Log, and the failure follow-up

const e = (at: string, text: string, run: number | null = null, depth: number | null = null) => ({ occurred_at: `2026-11-22T${at}:00Z`, run_no: run, depth_ft: depth, text });

describe('times, runs and depths from the job log', () => {
  it('reads arrival, rig-up, rig-down, runs, the deepest point and the tag', () => {
    const r = fromEvents([
      e('05:00', 'Arrived on location, toolbox talk'),
      e('05:40', 'Rig up started'),
      e('07:10', 'RIH', 1, 0), e('07:55', 'Tagged bottom', 1, 9450), e('08:30', 'POOH, run successful', 1, 0),
      e('09:00', 'RIH with GR', 2, 0), e('09:40', 'Run failed, tool did not set', 2, 7020),
      e('11:00', 'Rigged down, left location'),
    ]);
    expect(r).toEqual({
      arrived_at: '2026-11-22T05:00:00Z', rig_up_at: '2026-11-22T05:40:00Z', rig_down_at: '2026-11-22T11:00:00Z',
      runs: 2, runs_failed: 1, runs_ok: 1, max_depth_ft: 9450, tag_depth_ft: 9450,
    });
  });
  it('leaves out what the log does not say', () => {
    expect(fromEvents([])).toEqual({});
    expect(fromEvents([e('07:10', 'RIH', 3, 0)])).toEqual({ runs: 3, runs_failed: 0, runs_ok: 3, max_depth_ft: 0 });
  });
});

describe('failure follow-up', () => {
  it('opens with Failure = Yes or failed runs, not NPT alone', () => {
    expect(needsFollowUp({ failure: 'yes' })).toBe(true);
    expect(needsFollowUp({ runs_failed: 1 })).toBe(true);
    expect(needsFollowUp({ npt_hours: 3, failure: 'no' })).toBe(false);
  });
  it('makes the minimum restriction, its depth and the SSSV depth part of Preparation', () => {
    expect(STAGE_FIELDS.preparation).toEqual(expect.arrayContaining(['min_restriction_in', 'min_restriction_depth_ft', 'sssv_depth_ft']));
  });
});
