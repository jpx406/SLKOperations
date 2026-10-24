import { describe, expect, it } from 'vitest';
import { parseToolstring, preJobWireStatus, toolChecks, toolTotals } from '../src/shared/toolstring';

const ts = [
  { component: 'Rope socket', od_in: 1.5, length_ft: 0.8, weight_lb: 6 },
  { component: 'Stem', od_in: 1.5, length_ft: 10, weight_lb: 60 },
  { component: 'Stem', od_in: 1.5, length_ft: 5, weight_lb: 30 },
  { component: 'Spang jar', od_in: 1.5, length_ft: 4.5, weight_lb: 18 },
  { component: 'Pulling tool', od_in: 1.875, length_ft: 2.2, weight_lb: 9 },
];

describe('toolstring', () => {
  it('totals length, max OD, weight and stem weight', () => {
    expect(toolTotals(ts)).toEqual({ length_ft: 22.5, max_od_in: 1.875, weight_lb: 123, stem_weight_lb: 90 });
  });
  it('gives nulls for an empty string or missing numbers', () => {
    expect(toolTotals([])).toEqual({ length_ft: null, max_od_in: null, weight_lb: null, stem_weight_lb: null });
    expect(toolTotals([{ component: 'Stem' }]).stem_weight_lb).toBeNull();
  });
  it('rejects bad input', () => {
    expect(parseToolstring('x')).toEqual({ error: 'The toolstring must be a list' });
    expect(parseToolstring([{ component: '' }])).toEqual({ error: 'Part 1 needs a component' });
    expect(parseToolstring([{ component: 'Stem', od_in: -1 }])).toHaveProperty('error');
    expect(parseToolstring([{ component: 'Stem', od_in: 14 }])).toHaveProperty('error');
    expect(parseToolstring(Array.from({ length: 21 }, () => ({ component: 'Stem' })))).toHaveProperty('error');
  });
  it('normalises numbers from form strings', () => {
    expect(parseToolstring([{ component: ' Stem ', od_in: '1.5', length_ft: '', weight_lb: '60' }]))
      .toEqual({ parts: [{ component: 'Stem', od_in: 1.5, length_ft: null, weight_lb: 60 }] });
  });
  it('warns about restriction, bore and lubricator length', () => {
    const t = toolTotals(ts);
    expect(toolChecks(t, { minRestrictionIn: 2.313, pceBoreIn: 2.5, lubricatorFt: 25 })).toEqual([]);
    const all = toolChecks(t, { minRestrictionIn: 1.875, pceBoreIn: 1.8, lubricatorFt: 16 });
    expect(all.map((c) => c.level)).toEqual(['danger', 'danger', 'warning']);
    expect(all[2].text).toContain('22.5 ft is longer than the 16 ft lubricator');
  });
});

describe('pre-job wire test', () => {
  const tests = [
    { test_type: 'Torsion', result: 'Pass', test_date: '2026-10-20', approval_status: 'approved' },
    { test_type: 'Tension', result: 'Pass', test_date: '2026-10-01', approval_status: 'Approved' },
    { test_type: 'Wrap', result: 'Fail', test_date: '2026-10-22', approval_status: 'approved' },
  ];
  it('passes with a torsion test before the job and a tension test inside 30 days', () => {
    const s = preJobWireStatus(tests, '2026-10-25');
    expect(s.ok).toBe(true);
    expect(s.wrapOrTorsion?.test_date).toBe('2026-10-20');
  });
  it('flags an old tension test', () => {
    expect(preJobWireStatus(tests, '2026-11-15').reasons).toEqual(['Tension test is 45 days old (limit 30)']);
  });
  it('ignores failed, pending and later tests', () => {
    const s = preJobWireStatus([
      { test_type: 'Wrap', result: 'Fail', test_date: '2026-10-20' },
      { test_type: 'Torsion', result: 'Pass', test_date: '2026-10-21', approval_status: 'pending' },
      { test_type: 'Torsion', result: 'Pass', test_date: '2026-10-30' },
    ], '2026-10-25');
    expect(s.ok).toBe(false);
    expect(s.reasons).toContain('No passing wrap or torsion test before the job');
  });
});
