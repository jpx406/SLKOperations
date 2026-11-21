import { describe, expect, it } from 'vitest';
import { applyModules, moduleAccess, parseUserModules, wireguardAccess } from '../src/shared/modules';
import { competencyRecords, deleteBlockers, reconcileUsers, type PersonRecords } from '../src/shared/userAdmin';
import { effectiveMenus, readAllowed, ruleFor } from '../src/worker/permissions';

// 6z.38: modules per person, delete only without records, and the People / Competency / WIREGUARD reconciliation

const R = (view = true, edit = false) => ({ view, edit, delete: false });
const row = (menu_key: string, can_edit = 0) => ({ menu_key, can_view: 1, can_edit, can_delete: 0 });

describe('modules per person', () => {
  it('reads only true or false for the known modules', () => {
    expect(parseUserModules('{"slk":true,"wireguard":false,"competency":"yes","x":true}')).toEqual({ slk: true, wireguard: false });
    expect(parseUserModules(null)).toEqual({});
    expect(parseUserModules('not json')).toEqual({});
  });

  it('everyone reads the Knowledge Hub, and an edit right from the role stays', () => {
    const none = applyModules(effectiveMenus([row('jobs', 1)], [], false));
    expect(none.knowledge_hub).toEqual(R());
    expect(moduleAccess(none)).toEqual({ slk: false, knowledge: true, competency: false, career: false });
    expect(applyModules(effectiveMenus([row('knowledge_hub', 1)], [], false)).knowledge_hub.edit).toBe(true);
  });

  it('WIREGUARD comes with the SLK Operations Hub unless set on the person', () => {
    expect(wireguardAccess(applyModules({ slk_ops: R() }))).toBe(true);
    expect(wireguardAccess(applyModules({ competency: R() }))).toBe(false);
    expect(wireguardAccess(applyModules({ competency: R() }, { wireguard: true }))).toBe(true);
    expect(wireguardAccess(applyModules({ slk_ops: R() }, { wireguard: false }))).toBe(false);
  });

  it('the person’s modules win over the role, both ways', () => {
    // role without the hub, person allowed it: the whole app opens
    const up = applyModules(effectiveMenus([row('jobs', 1)], [], false), { slk: true });
    expect(moduleAccess(up)).toEqual({ slk: true, knowledge: true, competency: true, career: true });
    expect(up.jobs).toEqual(R(true, true));
    // role with the hub, person not allowed it: only the Knowledge Hub (and Competency if the role gives it)
    const down = applyModules(effectiveMenus([row('slk_ops'), row('jobs')], [], false), { slk: false });
    expect(moduleAccess(down)).toEqual({ slk: false, knowledge: true, competency: false, career: false });
    expect(down.jobs).toBeUndefined();
    // Competency off stays off even with the hub
    expect(moduleAccess(applyModules({ slk_ops: R() }, { competency: false })).competency).toBe(false);
    expect(moduleAccess(applyModules({}, { competency: true })).competency).toBe(true);
  });

  it('setting modules and fixing the reconciliation need the Users edit right; deleting needs delete', () => {
    expect(ruleFor('PUT', '/api/admin/users/NESR-1/modules')).toMatchObject({ menu: 'users', action: 'edit' });
    expect(ruleFor('POST', '/api/admin/reconcile/fix')).toMatchObject({ menu: 'users', action: 'edit' });
    expect(ruleFor('POST', '/api/admin/users/NESR-1/delete')).toMatchObject({ menu: 'users', action: 'delete' });
    expect(readAllowed('/api/knowledge', applyModules({}))).toBe(true);
  });

  it('Career Development is its own module: with the hub unless set on the person, or by its own right (6z.40)', () => {
    expect(moduleAccess(applyModules({ slk_ops: R() })).career).toBe(true);
    expect(moduleAccess(applyModules({ slk_ops: R() }, { career: false })).career).toBe(false);
    expect(moduleAccess(applyModules({ career_development: R() })).career).toBe(true);
    expect(moduleAccess(applyModules({ competency: R() })).career).toBe(false);
    expect(moduleAccess(applyModules({}, { career: true })).career).toBe(true);
    expect(parseUserModules('{"career":true}')).toEqual({ career: true });
  });

  it('only people allowed WIREGUARD can ask whether their WIREGUARD account is on (6z.39)', () => {
    expect(readAllowed('/api/wg/account', applyModules({ slk_ops: R() }))).toBe(true);
    expect(readAllowed('/api/wg/account', applyModules({}, { wireguard: true }))).toBe(true);
    expect(readAllowed('/api/wg/account', applyModules({ slk_ops: R() }, { wireguard: false }))).toBe(false);
  });
});

describe('deleting a person', () => {
  const clean: PersonRecords = { wireguard: false, competency: { profile: false, records: 0, inRegister: false }, slk: { crew: 0, attendance: 0, signatures: 0, bonus: 0 } };
  it('is allowed only with no records in WIREGUARD, Competency or SLK Ops', () => {
    expect(deleteBlockers(clean)).toEqual([]);
    expect(deleteBlockers({ ...clean, wireguard: true })).toEqual(['They have an account in WIREGUARD']);
    expect(deleteBlockers({ ...clean, wireguard: null })[0]).toMatch(/could not be reached/);
    expect(deleteBlockers({ ...clean, competency: { profile: true, records: 3, inRegister: true } })).toEqual(['They are set up as a Competency user', 'They have 3 Competency records']);
    expect(deleteBlockers({ ...clean, competency: { profile: false, records: 0, inRegister: true } })).toEqual(['They are in the Competency employee register']);
    expect(deleteBlockers({ ...clean, slk: { crew: 1, attendance: 2, signatures: 0, bonus: 1 } })).toEqual(['They are on the crew of 1 job', 'They have 2 attendance days', 'They have 1 bonus line']);
  });

  it('counts Competency records by any of the person’s IDs', () => {
    const data = {
      employees: [{ id: 'EMP-1' }, { id: 'NESR-2' }],
      experience: [{ empId: 'EMP-1' }, { empId: 'emp-1' }, { empId: 'X' }],
      training: [{ empId: 'NESR-2' }],
      certs: 'not a list',
    };
    expect(competencyRecords(data, ['NESR-1', 'EMP-1'])).toEqual({ records: 2, inRegister: true });
    expect(competencyRecords(data, ['NESR-2'])).toEqual({ records: 1, inRegister: true });
    expect(competencyRecords(null, ['NESR-1'])).toEqual({ records: 0, inRegister: false });
  });
});

describe('reconciliation', () => {
  const person = (username: string, extra = {}) => ({ username, full_name: `Person ${username}`, email: null, employee_eid: null, active: 1, wg_active: 1, ...extra });
  const kinds = (xs: { kind: string; username: string; fix: string | null }[]) => xs.map((x) => [x.kind, x.username, x.fix]);

  it('finds who is missing or switched off on one side, and different details', () => {
    const issues = reconcileUsers(
      [person('NESR-1'), person('NESR-2'), person('NESR-3', { email: 'old@x' }), person('NESR-9', { active: 0 })],
      [
        { username: 'NESR-1', full_name: 'Person NESR-1' },
        { username: 'nesr-2', full_name: 'Person NESR-2', active: 0 },
        { username: 'NESR-3', full_name: 'Someone Else', email: 'new@x' },
        { username: 'NESR-4', full_name: 'New One' },
        { username: 'NESR-5', full_name: 'Gone', active: false },
      ],
      [{ username: 'NESR-1', employee_id: null, status: 'Active' }, { username: 'NESR-2', employee_id: null, status: 'Active' }, { username: 'NESR-3', employee_id: null, status: 'Active' }],
      [],
    );
    expect(kinds(issues.filter((i) => i.level === 'problem'))).toEqual([
      ['wg_missing', 'NESR-4', 'add_from_wg'],
      ['wg_inactive', 'NESR-2', 'deactivate'],
      ['competency_status', 'NESR-2', 'competency_inactive'],
      ['details', 'NESR-3', 'use_wg_details'],
    ]);
    expect(issues.find((i) => i.kind === 'details')!.detail).toContain('Someone Else');
    // switched off in WIREGUARD and not here: only a note, nothing to add
    expect(kinds(issues.filter((i) => i.level === 'note'))).toEqual([['wg_missing', 'NESR-5', null]]);
    // NESR-9 is inactive here and missing in WIREGUARD: nothing to do
    expect(issues.some((i) => i.username === 'NESR-9')).toBe(false);
  });

  it('checks Competency users and the register against People, and skips WIREGUARD when it cannot be read', () => {
    const issues = reconcileUsers(
      [person('NESR-1'), person('NESR-2'), person('NESR-3', { wg_active: 0 })],
      null,
      [{ username: 'NESR-1', employee_id: 'EMP-1', status: 'Active' }, { username: 'NESR-7', employee_id: null, status: 'Active' }, { username: 'NESR-3', employee_id: null, status: 'Active' }],
      [{ id: 'EMP-1', name: 'One' }, { id: 'NESR-7' }, { id: 'X-1', name: 'Demo Person' }],
    );
    expect(kinds(issues)).toEqual([
      ['competency_orphan', 'NESR-7', 'remove_profile'],
      ['competency_status', 'NESR-3', 'competency_inactive'],
      ['register_extra', 'X-1', null],
      ['no_competency', 'NESR-2', 'add_profile'],
    ]);
    expect(issues.some((i) => i.kind === 'not_in_wg')).toBe(false);
  });

  it('an active person with no WIREGUARD account can be deactivated', () => {
    expect(kinds(reconcileUsers([person('NESR-1')], [], [{ username: 'NESR-1', employee_id: null, status: 'Active' }], []))).toEqual([['not_in_wg', 'NESR-1', 'deactivate']]);
  });
});
