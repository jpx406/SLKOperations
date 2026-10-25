import { describe, expect, it } from 'vitest';
import { cleanReport, nextLogNo, reportTotals, severityFromNpt, worstSeverity } from '../src/shared/emf';
import { readAllowed, ruleFor } from '../src/worker/permissions';

describe('severity from NPT (same bands as the incidents.severity column)', () => {
  it('maps the band edges', () => {
    expect([0, -1, 0.1, 3.99, 4, 24, 24.01, 48, 48.5].map(severityFromNpt))
      .toEqual(['negligible', 'negligible', 'light', 'light', 'serious', 'serious', 'major', 'major', 'catastrophic']);
  });
  it('takes the worst incident for the report and sums NPT', () => {
    expect(worstSeverity(['light', 'major', 'serious'])).toBe('major');
    expect(reportTotals([{ npt_hours: 6 }, { npt_hours: 30 }, { npt_hours: 0.25 }])).toEqual({ npt: 36.25, severity: 'major' });
    expect(reportTotals([])).toEqual({ npt: 0, severity: 'negligible' });
  });
});

describe('report checks', () => {
  const ok = { job_id: 'j1', title: ' Wire parted ', incidents: [{ what_happened: 'Parted', occurred_on: '2026-11-20', npt_hours: '6', failed_items: [' wire ', ''] }] };
  it('cleans a good report', () => {
    const r = cleanReport(ok);
    expect('report' in r && r.report.title).toBe('Wire parted');
    expect('report' in r && r.report.incidents[0]).toMatchObject({ npt_hours: 6, failed_items: ['wire'], occurred_time: null });
  });
  it('names the first problem', () => {
    expect(cleanReport({ ...ok, job_id: '' })).toEqual({ error: 'Pick the job (field ticket) first' });
    expect(cleanReport({ ...ok, incidents: [] })).toEqual({ error: 'Add at least one incident' });
    expect(cleanReport({ ...ok, incidents: [{ ...ok.incidents[0], what_happened: ' ' }] })).toEqual({ error: 'Incident 1: say what happened' });
    expect(cleanReport({ ...ok, incidents: [{ ...ok.incidents[0], occurred_time: '25:00' }] })).toEqual({ error: 'Incident 1: time must be HH:MM' });
    expect(cleanReport({ ...ok, incidents: [{ ...ok.incidents[0], npt_hours: -2 }] })).toEqual({ error: 'Incident 1: NPT must be 0 hours or more' });
  });
  it('numbers logs per country', () => {
    expect(nextLogNo(null)).toBe('EM-0001');
    expect(nextLogNo('EM-0041')).toBe('EM-0042');
  });
});

describe('8 Min. Facts and roster rights', () => {
  const emfView = { eight_min_facts: { view: true, edit: false, delete: false } };
  it('maps reads and writes to their tabs', () => {
    expect(readAllowed('/api/emf', emfView)).toBe(true);
    expect(readAllowed('/api/emf/abc/versions/2', emfView)).toBe(true);
    expect(readAllowed('/api/failure-roster', emfView)).toBe(false);
    expect(readAllowed('/api/filter-options', emfView)).toBe(true);
    expect(ruleFor('PUT', '/api/emf/abc')?.menu).toBe('eight_min_facts');
    expect(ruleFor('POST', '/api/emf/abc/sent')?.action).toBe('edit');
    expect(ruleFor('DELETE', '/api/emf/abc')).toBeUndefined();
    expect(ruleFor('DELETE', '/api/failure-roster/x')?.action).toBe('delete');
  });
});
