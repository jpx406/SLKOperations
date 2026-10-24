import { describe, expect, it } from 'vitest';
import { matchRuns, realKey, reconcile, type ReconInput, type ReconJob, type ReconRun } from '../src/shared/recon';

const SA = 'Saudi Arabia';
const job = (o: Partial<ReconJob>): ReconJob => ({
  id: 'j', country: SA, status: 'completed', ticket_no: null, drss_no: null, unit_number: 'SL-40', start_date: '2026-09-15', end_date: '2026-09-16',
  well: '538', field: 'ABQQ', rig: 'SINO21', wire_serial_number: null, max_depth_ft: null, jarring_minutes: null, wire_cut_ft: null, services: [], ...o,
});
const run = (o: Partial<ReconRun>): ReconRun => ({
  wg_id: 'r', country: SA, job_date: '2026-09-16', field_ticket: null, drss_number: null, drum_no: 'MOL-37', wire_serial_number: '3052',
  well: '538', field_name: 'ABQQ', rig: 'SINO21', job_name: 'Gauge Cutter', max_depth_ft: 7000, jarring_minutes: 0, wire_cut_ft: 0, approval_status: 'approved', ...o,
});
const input = (o: Partial<ReconInput>): ReconInput => ({ jobs: [], runs: [], links: [], drumUnit: { 'MOL-37': 'SL-40', 'MOL-107': 'MSL-032', 'X-1': 'SL-33' }, today: '2026-10-24', ...o });
const checks = (i: ReconInput) => reconcile(i).map((f) => f.check).sort();

describe('placeholder keys', () => {
  it('ignores WIREGUARD legacy placeholders and blanks', () => {
    expect(realKey('LEG-BATCH-12')).toBe('');
    expect(realKey('leg-batch-1')).toBe('');
    expect(realKey(null)).toBe('');
    expect(realKey(' DRSS-2026 5543 ')).toBe('drss20265543');
  });
});

describe('matching', () => {
  it('matches on unit + date + well when nothing else is available', () => {
    const { byJob, unmatched } = matchRuns(input({ jobs: [job({ id: 'A' })], runs: [run({ wg_id: 'r1' })] }));
    expect([...byJob.get('A')!.by]).toEqual(['unit + date + well']);
    expect(unmatched).toHaveLength(0);
  });
  it('accepts a run one day either side of the job dates, not two', () => {
    const near = matchRuns(input({ jobs: [job({ id: 'A' })], runs: [run({ job_date: '2026-09-17' })] }));
    const far = matchRuns(input({ jobs: [job({ id: 'A' })], runs: [run({ job_date: '2026-09-18' })] }));
    expect(near.byJob.has('A')).toBe(true);
    expect(far.byJob.has('A')).toBe(false);
  });
  it('prefers a real DRSS match over unit and date', () => {
    const { byJob } = matchRuns(input({
      jobs: [job({ id: 'A' }), job({ id: 'B', unit_number: 'SL-30', drss_no: '3000489755', start_date: '2026-09-20', end_date: '2026-09-21' })],
      runs: [run({ drss_number: '3000489755' })],
    }));
    expect(byJob.has('B')).toBe(true);
    expect(byJob.has('A')).toBe(false);
  });
  it('never matches on a placeholder ticket', () => {
    const { byJob, unmatched } = matchRuns(input({
      jobs: [job({ id: 'A', ticket_no: 'LEG-BATCH-1', unit_number: 'SL-30' })],
      runs: [run({ field_ticket: 'LEG-BATCH-1' })],
    }));
    expect(byJob.size).toBe(0);
    expect(unmatched).toHaveLength(1);
  });
  it('leaves a run unmatched when two jobs on the unit fit, and lists both as candidates', () => {
    const { unmatched } = matchRuns(input({ jobs: [job({ id: 'A' }), job({ id: 'B' })], runs: [run({})] }));
    expect(unmatched[0].candidates.sort()).toEqual(['A', 'B']);
  });
  it('does not auto-match when the wells disagree, but offers the job', () => {
    const { byJob, unmatched } = matchRuns(input({ jobs: [job({ id: 'A', well: '999' })], runs: [run({})] }));
    expect(byJob.size).toBe(0);
    expect(unmatched[0].candidates).toEqual(['A']);
  });
  it('a manual link wins over everything', () => {
    const { byJob } = matchRuns(input({ jobs: [job({ id: 'A' }), job({ id: 'Z', unit_number: 'SL-30' })], runs: [run({ wg_id: 'r1' })], links: [{ wg_run_id: 'r1', job_id: 'Z' }] }));
    expect([...byJob.get('Z')!.by]).toEqual(['manual link']);
  });
  it('does not match across countries', () => {
    const { byJob } = matchRuns(input({ jobs: [job({ id: 'A', country: 'Bahrain' })], runs: [run({})] }));
    expect(byJob.size).toBe(0);
  });
});

describe('checks', () => {
  it('reports nothing for a clean job', () => {
    expect(checks(input({ jobs: [job({ id: 'A', max_depth_ft: 7000, services: ['Gauge Cutter'], drss_no: 'D1' })], runs: [run({ drss_number: 'D1' })] }))).toEqual([]);
  });
  it('flags a completed, finished job without runs, but not a planned or future one', () => {
    expect(checks(input({ jobs: [job({ id: 'A' })] }))).toEqual(['no_runs']);
    expect(checks(input({ jobs: [job({ id: 'A', status: 'planned' })] }))).toEqual([]);
    expect(checks(input({ jobs: [job({ id: 'A', start_date: '2026-11-01', end_date: '2026-11-02' })] }))).toEqual([]);
  });
  it('flags unit, date and well when a DRSS ties a run to the wrong job', () => {
    const f = checks(input({
      jobs: [job({ id: 'C', unit_number: 'SL-30', drss_no: 'DRSS-20265543', start_date: '2026-09-20', end_date: '2026-09-21', well: '112', field: null, rig: null })],
      runs: [run({ drss_number: 'DRSS-20265543', drum_no: 'MOL-107', job_date: '2026-09-17', well: '111' })],
    }));
    expect(f).toEqual(['date_mismatch', 'location_mismatch', 'unit_drum_mismatch']);
  });
  it('flags wire, service and values beyond tolerance only', () => {
    const base = { id: 'D', wire_serial_number: 'CWR-9999', services: ['Gauge Cutter'], max_depth_ft: 6000, wire_cut_ft: 50, jarring_minutes: 3 };
    const r = run({ wire_serial_number: 'CWR-1970', job_name: 'R&P ACDC', max_depth_ft: 6685, wire_cut_ft: 50, jarring_minutes: 3 });
    const all = reconcile(input({ jobs: [job(base)], runs: [r] }));
    expect(all.map((f) => f.check).sort()).toEqual(['service_mismatch', 'value_mismatch', 'wire_mismatch']);
    expect(all.find((f) => f.check === 'value_mismatch')!.detail.fields!.map((x) => x.field)).toEqual(['max depth (ft)']);
    // within tolerance: 50 ft or 2 %
    expect(checks(input({ jobs: [job({ id: 'E', max_depth_ft: 6650 })], runs: [run({ max_depth_ft: 6685 })] }))).toEqual([]);
  });
  it('flags runs still awaiting approval on a completed job', () => {
    expect(checks(input({ jobs: [job({ id: 'A' })], runs: [run({ approval_status: 'pending' })] }))).toEqual(['runs_pending_approval']);
    expect(checks(input({ jobs: [job({ id: 'A' })], runs: [run({ approval_status: 'Approved' })] }))).toEqual([]);
  });
  it('groups unlinked runs per unit, day and well, with a stable fingerprint', () => {
    const runs = [run({ wg_id: 'a', drum_no: 'X-1', well: 'H-89' }), run({ wg_id: 'b', drum_no: 'X-1', well: 'H-89' }), run({ wg_id: 'c', drum_no: 'X-1', well: 'H-90' })];
    const f = reconcile(input({ runs }));
    expect(f.map((x) => x.check)).toEqual(['unlinked_runs', 'unlinked_runs']);
    expect(f[0].wg_run_ids).toEqual(['a', 'b']);
    expect(f[0].detail.unit).toBe('SL-33');
    expect(reconcile(input({ runs: [...runs].reverse() })).map((x) => x.fingerprint).sort()).toEqual(f.map((x) => x.fingerprint).sort());
  });
});
