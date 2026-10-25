import { describe, expect, it } from 'vitest';
import { busyDays, competency, crewUtilization, domainRollup, levelFor, monthsBetween, rotationShare, toNext, type Assignment, type Person } from '../src/shared/people';
import { readAllowed } from '../src/worker/permissions';

const person = (id: string, crew_role = 'slickline_operator', rotation = '60/30'): Person => ({ id, full_name: id.toUpperCase(), crew_role, rotation, title: 'Op' });
const job = (o: Partial<Assignment>): Assignment => ({
  employee_id: 'a', job_id: Math.random().toString(36).slice(2), ticket_no: null, start_date: '2026-10-05', end_date: '2026-10-06', arrived_at: null,
  status: 'completed', failure: 'no', npt_hours: 0, services: ['Drift'], domains: ['Well Access'], crew_role: 'slickline_operator', ...o,
});

describe('rotations and months', () => {
  it('turns a rotation into the on-duty share', () => {
    expect(rotationShare('60/30')).toBeCloseTo(2 / 3);
    expect(rotationShare('28/28')).toBe(0.5);
    expect(rotationShare('5/2')).toBeCloseTo(5 / 7);
  });
  it('lists months across a year end', () => {
    expect(monthsBetween('2026-11-15', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
  it('counts busy days once, with mob and demob, inside the window', () => {
    expect(busyDays([job({}), job({ start_date: '2026-10-06', end_date: '2026-10-07' })], '2026-10-01', '2026-10-31').size).toBe(6); // 4th to 9th
    expect(busyDays([job({ start_date: '2026-10-31', end_date: '2026-10-31' })], '2026-10-01', '2026-10-31').size).toBe(2); // 30th, 31st
    expect(busyDays([job({ status: 'canceled' })], '2026-10-01', '2026-10-31').size).toBe(0);
  });
});

describe('crew utilization', () => {
  it('counts idle field people as 0 % and leaves office roles out', () => {
    const r = crewUtilization([person('a'), person('b'), person('c', 'other')], [job({})], ['2026-10']);
    expect(r.headcount).toBe(2);
    // a: busy 4th to 8th = 5 of 31 × 2/3 = 20.67 on-duty days → 24.2 %; b: 0 %
    expect(r.perMonth[0].people.map((p) => p.pct)).toEqual([24.2, 0]);
    expect(r.perMonth[0].avg).toBe(12.1);
  });
});

describe('competency', () => {
  it('levels at 10, 20 and 30 successful jobs', () => {
    expect([0, 9, 10, 19, 20, 29, 30].map(levelFor)).toEqual(['Basic', 'Basic', 'Intermediate', 'Intermediate', 'Advance', 'Advance', 'Expert']);
    expect([8, 19, 30].map(toNext)).toEqual([2, 1, null]);
  });
  it('counts only completed jobs without a failure, and flags thin coverage', () => {
    const many = Array.from({ length: 21 }, () => job({ employee_id: 'a' }));
    const r = competency([person('a'), person('b')], [...many, job({ employee_id: 'b', failure: 'yes' }), job({ employee_id: 'b', status: 'planned' })]);
    const a = r.cards.find((c) => c.id === 'a')!;
    const b = r.cards.find((c) => c.id === 'b')!;
    expect(a.perService).toEqual([{ service: 'Drift', jobs: 21, level: 'Advance', toNext: 9 }]);
    expect(b.totalJobs).toBe(0);
    expect(b.failPct).toBe(100);
    expect(r.coverage).toEqual([{ service: 'Drift', advancePlus: 1, people: ['A'], gap: true }]);
  });
  it('rolls up by domain', () => {
    expect(domainRollup([job({ employee_id: 'a' }), job({ employee_id: 'b' }), job({ employee_id: 'b', failure: 'yes' })])).toEqual([{ domain: 'Well Access', people: 2, jobs: 2 }]);
  });
  it('opens to Utilization or Competency', () => {
    expect(readAllowed('/api/stats/people', { competency: { view: true, edit: false, delete: false } })).toBe(true);
    expect(readAllowed('/api/stats/people', { statistics: { view: true, edit: false, delete: false } })).toBe(false);
  });
});
