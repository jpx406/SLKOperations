import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPETENCY_ROLES, checkProfile, rolesFromDataset } from '../src/shared/competencyUsers';
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
    expect(NAV.map((g) => g.label)).toEqual(['Operation', 'Service Quality', 'Knowledge Hub', 'Competency', 'Bonus', 'SLK Activity Dashboard', 'Equipment', 'Administration']);
    expect(NAV.find((g) => g.label === 'Bonus')!.pages.map((p) => p.label)).toEqual(['Bonus Report', 'Bonus Analysis', 'Bonus Rules', 'Attendance']);
    expect(NAV.find((g) => g.label === 'Equipment')!.pages.map((p) => p.label)).toEqual(['Explosive', 'Hardware', 'MCR', 'Wires', 'Reconciliation']);
    expect(NAV.find((g) => g.label === 'Competency')!.pages[0].path).toBe('/competency');
    expect(NAV.find((g) => g.label === 'Service Quality')!.pages.some((p) => p.key === 'competency')).toBe(false);
  });
});
