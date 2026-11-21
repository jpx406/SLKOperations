import { describe, expect, it } from 'vitest';
import { COMPETENCY_SHEET_HEADER, DEFAULT_COMPETENCY_ROLES, checkProfile, planImport, profileRowsFromSheet, rolesFromDataset, sheetDate } from '../src/shared/competencyUsers';
import { workbook } from '../src/shared/xlsx';
import { sheetRows } from '../src/client/competency/sheet';
import { NAV } from '../src/shared/menus';
import { readAllowed, ruleFor } from '../src/worker/permissions';
import { _slk } from '../src/client/competency/App.jsx';

// 6z.35: Competency users set in SLK Ops Users & Roles, and the new menus

describe('Competency profiles', () => {
  const roles = rolesFromDataset(null);
  it('takes a Competency role from the roles in use, and says whether it changes data', () => {
    expect(checkProfile({ role: 'Manager', grade: 9, position: 'Slickline Supervisor' }, roles)).toMatchObject({ value: { role: 'Manager', can_edit: 1, grade: 9, segment: 'SLK', status: 'Active' } });
    expect(checkProfile({ role: 'Viewer' }, roles)).toMatchObject({ value: { can_edit: 0, employee_id: null, grade: null } });
    expect(checkProfile({ role: 'Boss' }, roles)).toHaveProperty('error');
    expect(checkProfile({ role: 'Admin', grade: 15 }, roles)).toEqual({ error: 'The grade is 6 to 12' });
    expect(checkProfile({ role: 'Admin', position: 'Engineer 1' }, roles)).toEqual({ error: 'Pick a position from the list' });
    expect(checkProfile({ role: 'Admin', hire_date: '1/2/2020' }, roles)).toEqual({ error: 'The hire date must be a date' });
  });

  it('reads the roles from the Competency dataset, with the defaults when there is none', () => {
    expect(rolesFromDataset(null).map((r) => r.name)).toEqual(DEFAULT_COMPETENCY_ROLES.map((r) => r.name));
    expect(rolesFromDataset(JSON.stringify({ roleDefs: [{ name: 'Auditor', edit: false }, { name: 'Lead', edit: true }] }))).toEqual([{ name: 'Auditor', edit: false }, { name: 'Lead', edit: true }]);
    expect(rolesFromDataset('not json')).toHaveLength(6);
  });

  it('Users & Roles writes them; Competency and Users & Roles read them; anyone reads their own', () => {
    expect(ruleFor('PUT', '/api/competency/users/NESR-1')).toMatchObject({ menu: 'users', action: 'edit' });
    expect(ruleFor('DELETE', '/api/competency/users/NESR-1')).toMatchObject({ menu: 'users', action: 'edit' });
    expect(readAllowed('/api/competency/users', { competency: { view: true, edit: false, delete: false } })).toBe(true);
    expect(readAllowed('/api/competency/users', { users: { view: true, edit: true, delete: false } })).toBe(true);
    expect(readAllowed('/api/competency/users', { jobs: { view: true, edit: true, delete: false } })).toBe(false);
    expect(readAllowed('/api/competency/me', {})).toBe(true);
  });

  it('the profiles from Users & Roles win over the Competency register, and add who is missing', () => {
    const state = { employees: [{ id: 'NESR-1', name: 'One', role: 'Operator', grade: '', position: 'Operator', status: 'Active' }] };
    const people = [
      { username: 'NESR-1', employee_id: null, role: 'Admin', grade: 9, position: 'Slickline Supervisor', segment: 'SLK', location: 'DMM', hire_date: '2019-09-01', mentor: null, status: 'Active', name: 'One', email: null, country: 'Saudi Arabia' },
      { username: 'NESR-2', employee_id: 'EMP-2', role: 'Operator', grade: 7, position: 'Assistant Operator', segment: 'SLK', location: null, hire_date: null, mentor: 'NESR-1', status: 'Active', name: 'Two', email: 'two@x', country: 'Bahrain' },
    ];
    const out = _slk.syncSlkPeople(state, people);
    expect(out.employees[0]).toMatchObject({ id: 'NESR-1', role: 'Admin', grade: 9, position: 'Slickline Supervisor', location: 'DMM', hire: '2019-09-01' });
    expect(out.employees[1]).toMatchObject({ id: 'EMP-2', name: 'Two', country: 'Bahrain', role: 'Operator', grade: 7, position: 'Assistant Operator', mentor: 'NESR-1', step: 'Step 2 (AO > OP)', email: 'two@x' });
    // nothing to change: the same object, so the module does not save again
    expect(_slk.syncSlkPeople(out, people)).toBe(out);
  });
});

describe('menus (6z.35)', () => {
  it('Knowledge Hub then Competency under Service Quality, Attendance in Bonus, the inventories and wires in Equipment', () => {
    // 6z.40: Career Development, its own menu below Competency
    // 6z.43: Q-Incidents and the Incidents Dashboard under Service Quality, the Assets Inventory in Maintenance
    expect(NAV.map((g) => g.label)).toEqual(['Operation', 'Service Quality', 'Knowledge Hub', 'Competency', 'Career Development', 'Bonus', 'SLK Activity Dashboard', 'Equipment', 'Maintenance', 'Administration']);
    expect(NAV.find((g) => g.label === 'Operation')!.pages.map((p) => p.label)).toEqual(['Schedule', 'Jobs', 'Job Log', 'Pre-Job Notes', 'Quick Plan']);
    expect(NAV.find((g) => g.label === 'Service Quality')!.pages.map((p) => p.label).slice(-2)).toEqual(['Q-Incidents', 'Incidents Dashboard']);
    expect(NAV.find((g) => g.label === 'Maintenance')!.pages).toEqual([expect.objectContaining({ key: 'database', label: 'Assets Inventory', path: '/operation/database' })]);
    expect(NAV.find((g) => g.label === 'Career Development')!.pages[0]).toMatchObject({ key: 'career_development', path: '/career' });
    expect(NAV.find((g) => g.label === 'Bonus')!.pages.map((p) => p.label)).toEqual(['Bonus Report', 'Bonus Analysis', 'Bonus Rules', 'Attendance']);
    expect(NAV.find((g) => g.label === 'Equipment')!.pages.map((p) => p.label)).toEqual(['Explosive', 'Hardware', 'MCR', 'Wires', 'Reconciliation']);
    expect(NAV.find((g) => g.label === 'Competency')!.pages[0].path).toBe('/competency');
    expect(NAV.find((g) => g.label === 'Service Quality')!.pages.some((p) => p.key === 'competency')).toBe(false);
  });
});

describe('Competency users from Excel (6z.36)', () => {
  const roles = rolesFromDataset(null);
  it('reads dates as Excel numbers or typed', () => {
    expect(sheetDate(43709)).toBe('2019-09-01');
    expect(sheetDate('2019-09-01')).toBe('2019-09-01');
    expect(sheetDate('1/9/2019')).toBe('2019-09-01');
    expect(sheetDate('')).toBe('');
  });

  it('reads a downloaded file back, columns by name, grade as G9 or 9', async () => {
    const bytes = workbook('Competency users', [...COMPETENCY_SHEET_HEADER], [
      ['NESR-1', 'One', 'Admin', '', 'Slickline Supervisor', 'G9', 'SLK', 'DMM', 43709, '', 'Active'],
      ['NESR-2', 'Two', 'Operator', 'EMP-2', 'Assistant Operator', 7, 'SLK', '', '', 'NESR-1', ''],
      [null, null, null, null, null, null, null, null, null, null, null],
    ]);
    const r = profileRowsFromSheet(await sheetRows(bytes));
    if ('error' in r) throw new Error(r.error);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ row: 2, id: 'NESR-1', values: { role: 'Admin', grade: 9, position: 'Slickline Supervisor', location: 'DMM', hire_date: '2019-09-01', status: 'Active' } });
    expect(r.rows[1]).toMatchObject({ row: 3, id: 'NESR-2', values: { employee_id: 'EMP-2', grade: 7, mentor: 'NESR-1', status: 'Active' } });
    expect(profileRowsFromSheet([['Name', 'Role']])).toHaveProperty('error');
  });

  it('updates who is set up, adds the rest, never twice for one Employee ID', () => {
    const row = (n: number, id: string, role = 'Operator', extra = {}) => ({ row: n, id, values: { role, status: 'Active', segment: 'SLK', ...extra } });
    const plan = planImport([
      row(2, 'NESR-1', 'Admin'),           // set up already: update
      row(3, 'nesr-2'),                    // a SLK Ops user, any case: add
      row(4, 'NESR-2', 'Manager'),         // the same Employee ID again: left out
      row(5, 'EMP-3'),                     // matches someone's employee record: update that person
      row(6, 'NESR-9'),                    // not a SLK Ops user
      row(7, 'NESR-4', 'Boss'),            // a role that does not exist
      row(8, ''),                          // no ID
    ], ['NESR-1', 'NESR-2', 'NESR-3', 'NESR-4'], [{ username: 'NESR-1', employee_id: null }, { username: 'NESR-3', employee_id: 'EMP-3' }], roles);
    expect(plan.update.map((u) => [u.row, u.username, u.value.role])).toEqual([[2, 'NESR-1', 'Admin'], [5, 'NESR-3', 'Operator']]);
    expect(plan.add.map((u) => [u.row, u.username])).toEqual([[3, 'NESR-2']]);
    expect(plan.skip.map((x) => [x.row, x.reason.split(':')[0]])).toEqual([
      [4, 'Same Employee ID as an earlier row'], [6, 'Not a SLK Ops user'], [7, 'Pick one of the Competency roles'], [8, 'No Employee ID'],
    ]);
  });
});
