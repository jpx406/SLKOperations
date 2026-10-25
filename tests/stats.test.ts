import { describe, expect, it } from 'vitest';
import { auditCompliance, byMonth, groupBy, kpis, missingData, periodRange, ratioByMonth, fleetEff, unitUtilization, utilBand, type StatJob } from '../src/shared/stats';
import { readAllowed } from '../src/worker/permissions';

const job = (o: Partial<StatJob>): StatJob => ({
  id: Math.random().toString(36).slice(2), ticket_no: null, well: null, status: 'completed', start_date: '2026-10-01', end_date: null, arrived_at: null,
  unit_number: 'SL-40', sdm: 'A', location: null, field: null, conveyance: null, op_hours: null, npt_hours: 0, failure: null,
  runs_ok: null, runs_failed: null, wellsite_audit: null, services: [], domains: [], crew: [], ...o,
});

describe('periods', () => {
  it('works out the preset ranges', () => {
    expect(periodRange('month', '2026-10-25')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('3m', '2026-02-10')).toEqual({ from: '2025-12-01', to: '2026-02-28' });
    expect(periodRange('ytd', '2026-10-25')).toEqual({ from: '2026-01-01', to: '2026-10-25' });
    expect(periodRange('all', '2026-10-25')).toEqual({ from: null, to: null });
  });
});

describe('KPIs', () => {
  it('uses op ÷ (op + NPT) for fleet efficiency and averages run efficiency per job', () => {
    const k = kpis([job({ op_hours: 90, npt_hours: 10, runs_ok: 3, runs_failed: 1, failure: 'yes' }), job({ op_hours: 10, runs_ok: 2, runs_failed: 0 })]);
    expect(k).toMatchObject({ jobs: 2, opHours: 100, npt: 10, fleetEff: 90.9, avgRunEff: 87.5, jobsWithNpt: 1, failures: 1, failureRate: 50 });
    expect(kpis([])).toMatchObject({ jobs: 0, fleetEff: null, avgRunEff: null, failureRate: null });
  });
});

describe('grouping', () => {
  const rows = [job({ services: ['Gauge Cutter', 'Drift'], npt_hours: 2 }), job({ services: ['Drift'], npt_hours: 3 }), job({ services: [] })];
  it('counts a job in each of its buckets and keeps the job ids', () => {
    const g = groupBy(rows, (j) => j.services, (j) => j.npt_hours);
    expect(g.map((b) => [b.label, b.value, b.ids.length])).toEqual([['Drift', 5, 2], ['Gauge Cutter', 2, 1], ['Not set', 0, 1]]);
  });
  it('fills empty months between the bounds', () => {
    const m = byMonth([job({ start_date: '2026-08-03' }), job({ start_date: '2026-10-20' })], () => 1);
    expect(m.map((b) => [b.key, b.value])).toEqual([['2026-08', 1], ['2026-09', 0], ['2026-10', 1]]);
    expect(byMonth([], () => 1, { from: '2026-01-01', to: '2026-02-28' }).map((b) => b.label)).toEqual(['Jan 26', 'Feb 26']);
  });
  it('gives null ratios for empty months', () => {
    const r = ratioByMonth([job({ start_date: '2026-08-03', op_hours: 9, npt_hours: 1 })], fleetEff, { from: '2026-08-01', to: '2026-09-30' });
    expect(r.map((b) => b.value)).toEqual([90, null]);
  });
});

describe('unit utilization', () => {
  it('counts mob −1 and demob +2 once, inside the period, minus blocked days', () => {
    const rows = [job({ start_date: '2026-10-05', end_date: '2026-10-06' }), job({ start_date: '2026-10-07', end_date: '2026-10-07' })];
    const [u] = unitUtilization(['SL-40'], rows, [{ unit_number: 'SL-40', kind: 'maintenance', starts_on: '2026-10-20', ends_on: '2026-10-29' }], '2026-10-01', '2026-10-31');
    // active 4th→9th = 6 days (overlap counted once); available 31 − 10 blocked = 21
    expect(u).toEqual({ unit: 'SL-40', jobs: 2, activeDays: 6, availableDays: 21, pct: 28.6 });
    expect(unitUtilization(['SL-41'], rows, [], '2026-10-01', '2026-10-31')[0].pct).toBe(0);
  });
  it('bands the result', () => {
    expect([80, 60, 30, 10, null].map(utilBand)).toEqual(['high', 'mid', 'low', 'idle', 'none']);
  });
});

describe('quality checks', () => {
  it('lists completed jobs missing hours or runs', () => {
    const m = missingData([job({ ticket_no: 'T1' }), job({ op_hours: 5, runs_ok: 1 }), job({ status: 'planned' })]);
    expect(m).toEqual([{ id: expect.any(String), ticket_no: 'T1', missing: ['operating hours', 'runs'] }]);
  });
  it('measures audit compliance against 25 %', () => {
    const a = auditCompliance([job({ sdm: 'A', wellsite_audit: 'yes' }), job({ sdm: 'A' }), job({ sdm: 'A' }), job({ sdm: 'A' }), job({ sdm: 'B' })]);
    expect(a.map((x) => [x.sdm, x.pct, x.met])).toEqual([['A', 25, true], ['B', 0, false]]);
  });
  it('opens the rows to any of the analytics tabs', () => {
    expect(readAllowed('/api/stats', { npt_analysis: { view: true, edit: false, delete: false } })).toBe(true);
    expect(readAllowed('/api/stats', { jobs: { view: true, edit: true, delete: true } })).toBe(false);
  });
});
