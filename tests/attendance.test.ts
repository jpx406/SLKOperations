import { describe, expect, it } from 'vitest';
import { CODE_LIST, assignmentsOn, isCode, isWeekend, monthDays, rowSummary } from '../src/shared/attendance';
import { cleanEmployee } from '../src/worker/roster';
import { readAllowed, ruleFor } from '../src/worker/permissions';

describe('attendance codes and calendar', () => {
  it('has the 15 codes from the manual, including JO', () => {
    expect(CODE_LIST).toHaveLength(15);
    expect(isCode('JO')).toBe(true);
    expect(isCode('30')).toBe(false);
  });
  it('lists the days of a month and spots Friday and Saturday', () => {
    expect(monthDays('2026-02')).toHaveLength(28);
    expect(monthDays('2028-02').at(-1)).toBe('2028-02-29');
    expect(['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'].map(isWeekend)).toEqual([false, true, true, false]);
  });
  it('finds the jobs a person is crewed on for a day', () => {
    const a = [{ employee_id: 'e1', job_id: 'j1', ticket_no: 'T1', start_date: '2026-10-04', end_date: '2026-10-06' }, { employee_id: 'e1', job_id: 'j2', ticket_no: 'T2', start_date: '2026-10-10', end_date: null }];
    expect(assignmentsOn(a, 'e1', '2026-10-05').map((x) => x.ticket_no)).toEqual(['T1']);
    expect(assignmentsOn(a, 'e1', '2026-10-10').map((x) => x.ticket_no)).toEqual(['T2']);
    expect(assignmentsOn(a, 'e2', '2026-10-05')).toEqual([]);
  });
  it('summarises a row', () => {
    expect(rowSummary(['P', 'JBFS', 'TR', 'SL', 'A', undefined])).toEqual({ present: 3, field: 1, leave: 2, blank: 1 });
  });
});

describe('roster checks', () => {
  it('needs EID, name and title when adding', () => {
    expect(cleanEmployee({ full_name: 'A', title: 'B' }, true)).toEqual({ error: 'EID is needed' });
    expect(cleanEmployee({ eid: 'E 1', full_name: 'A', title: 'B' }, true)).toEqual({ error: 'EID takes letters, digits and dashes only' });
    expect(cleanEmployee({ eid: 'E1', full_name: ' A ', title: 'B', wg_username: 'nesr-90002', is_slk_contact: true }, true))
      .toEqual({ values: { eid: 'E1', full_name: 'A', title: 'B', wg_username: 'NESR-90002', is_slk_contact: 1 } });
  });
  it('checks usernames, email, mobile and rotation on edit', () => {
    expect(cleanEmployee({ wg_username: 'bob' }, false)).toHaveProperty('error');
    expect(cleanEmployee({ contact_email: 'no-at' }, false)).toHaveProperty('error');
    expect(cleanEmployee({ contact_mobile: 'call me' }, false)).toHaveProperty('error');
    expect(cleanEmployee({ rotation: '10/10' }, false)).toHaveProperty('error');
    expect(cleanEmployee({ active: false }, false)).toEqual({ values: { active: 0 } });
  });
});

describe('attendance and roster rights', () => {
  it('maps reads and writes', () => {
    expect(readAllowed('/api/attendance', { attendance: { view: true, edit: false, delete: false } })).toBe(true);
    expect(readAllowed('/api/roster', { attendance: { view: true, edit: true, delete: false } })).toBe(false);
    expect(ruleFor('PUT', '/api/attendance')?.action).toBe('edit');
    expect(ruleFor('POST', '/api/attendance/approve')?.menu).toBe('attendance');
    expect(ruleFor('DELETE', '/api/roster/x')?.action).toBe('delete');
  });
});
