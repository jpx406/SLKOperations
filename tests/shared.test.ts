import { describe, expect, it } from 'vitest';
import { canEditField, filterPatch } from '../src/shared/fieldPolicy';
import { jobEfficiency, opHours, runEfficiency } from '../src/shared/metrics';
import { defaultRoleFor } from '../src/shared/roles';
import { stagePercent } from '../src/shared/stages';
import { menuClusters } from '../src/shared/menus';
import { effectiveMenus, isOpenWrite, readAllowed, ruleFor } from '../src/worker/permissions';
import { isCutOnly } from '../src/worker/sync';

describe('job metrics (same rules as the job_metrics view)', () => {
  it('derives operating hours from rig-up and rig-down', () => {
    expect(opHours('2026-10-20T03:00:00Z', '2026-10-20T15:00:00Z', null)).toBe(12);
  });
  it('lets the override win', () => {
    expect(opHours('2026-10-20T03:00:00Z', '2026-10-20T15:00:00Z', 10)).toBe(10);
  });
  it('gives nothing without both times, or with rig-down first', () => {
    expect(opHours(null, '2026-10-20T15:00:00Z', null)).toBeNull();
    expect(opHours('2026-10-20T15:00:00Z', '2026-10-20T03:00:00Z', null)).toBeNull();
  });
  it('computes efficiency and floors it at 0', () => {
    expect(jobEfficiency(12, 0)).toBe(100);
    expect(jobEfficiency(12, 5)).toBe(58.3);
    expect(jobEfficiency(12, 29)).toBe(0);
    expect(jobEfficiency(null, 5)).toBeNull();
  });
  it('computes run efficiency', () => {
    expect(runEfficiency(3, 1)).toBe(75);
    expect(runEfficiency(null, null)).toBeNull();
  });
});

describe('field policy', () => {
  it('lets sales plan but not assign the unit', () => {
    expect(canEditField('sales', 'ticket_no')).toBe(true);
    expect(canEditField('sales', 'unit_number')).toBe(false);
  });
  it('lets the crew log execution but not the ticket', () => {
    expect(canEditField('slickline_supervisor', 'rig_up_at')).toBe(true);
    expect(canEditField('slickline_supervisor', 'ticket_no')).toBe(false);
  });
  it('keeps the operating-hours override to SDM and Ops Manager', () => {
    expect(canEditField('slickline_supervisor', 'op_hours_override')).toBe(false);
    expect(canEditField('sdm', 'op_hours_override')).toBe(true);
  });
  it('drops fields a role may not write and unknown fields', () => {
    const { allowed, dropped } = filterPatch('sales', { ticket_no: '1', unit_number: 'SL-50', deleted_at: 'x' });
    expect(allowed).toEqual({ ticket_no: '1' });
    expect(dropped.sort()).toEqual(['deleted_at', 'unit_number']);
  });
  it('lets admin write every policy field but still not unknown columns', () => {
    const { allowed, dropped } = filterPatch('admin', { unit_number: 'SL-50', created_by: 'me' });
    expect(allowed).toEqual({ unit_number: 'SL-50' });
    expect(dropped).toEqual(['created_by']);
  });
});

describe('stage completion', () => {
  it('counts filled design fields and services', () => {
    expect(stagePercent({}, 'design')).toBe(0);
    expect(stagePercent({ ticket_no: '1', status: 'planned', services: ['Gauge Cutter'] }, 'design')).toBe(25);
  });
  it('treats an empty toolstring as not filled', () => {
    expect(stagePercent({ well_type: 'Oil producer', toolstring: [] }, 'preparation')).toBe(10);
    expect(stagePercent({ well_type: 'Oil producer', toolstring: [{ component: 'Stem' }] }, 'preparation')).toBe(20);
  });
  it('adds the failure follow-up to closure only when the job has NPT or a failure', () => {
    const signed = { job_log_signed: 'yes', ticket_signed: 'yes' } as const;
    expect(stagePercent({ ...signed, npt_hours: 0 }, 'closure')).toBe(29);
    expect(stagePercent({ ...signed, npt_hours: 2 }, 'closure')).toBe(17);
  });
});

describe('write rules (deny by default)', () => {
  it('maps every job write to a menu right', () => {
    expect(ruleFor('POST', '/api/jobs')?.menu).toBe('jobs');
    expect(ruleFor('PATCH', '/api/jobs/abc')?.action).toBe('edit');
    expect(ruleFor('DELETE', '/api/jobs/abc')?.action).toBe('delete');
    expect(ruleFor('PUT', '/api/jobs/abc/services')?.menu).toBe('jobs');
    expect(ruleFor('PUT', '/api/jobs/abc/crew')?.menu).toBe('jobs');
    expect(ruleFor('PUT', '/api/jobs/abc/headcount')?.action).toBe('edit');
    expect(ruleFor('POST', '/api/jobs/abc/crew')).toBeUndefined();
  });
  it('opens crew, wire options and the roster only with the right tabs', () => {
    const jobsOnly = { jobs: { view: true, edit: false, delete: false } };
    const scheduleOnly = { schedule: { view: true, edit: false, delete: false } };
    expect(readAllowed('/api/jobs/abc/wire-options', jobsOnly)).toBe(true);
    expect(readAllowed('/api/jobs/abc/crew', scheduleOnly)).toBe(false);
    expect(readAllowed('/api/employees', scheduleOnly)).toBe(false);
    expect(readAllowed('/api/employees', jobsOnly)).toBe(true);
  });
  it('puts schedule moves and unit blocks behind schedule:edit', () => {
    expect(ruleFor('POST', '/api/jobs/abc/move')).toMatchObject({ menu: 'schedule', action: 'edit' });
    expect(ruleFor('POST', '/api/unit-events')).toMatchObject({ menu: 'schedule', action: 'edit' });
    expect(ruleFor('PATCH', '/api/unit-events/x')).toMatchObject({ menu: 'schedule', action: 'edit' });
    expect(ruleFor('DELETE', '/api/unit-events/x')).toMatchObject({ menu: 'schedule', action: 'edit' });
  });
  it('has no rule for unknown writes, so they are refused', () => {
    expect(ruleFor('POST', '/api/anything')).toBeUndefined();
    expect(ruleFor('DELETE', '/api/jobs')).toBeUndefined();
  });
  it('leaves sign-in and sign-out open', () => {
    expect(isOpenWrite('POST', '/api/auth/login')).toBe(true);
    expect(isOpenWrite('POST', '/api/jobs')).toBe(false);
  });
});

describe('WIREGUARD cut-only rows (never a run, per WIREGUARD)', () => {
  it('flags maintenance wire cuts, SPOOL-AD adjustments and document-sourced rows', () => {
    expect(isCutOnly({ job_name: 'Maintenance Wire cut' })).toBe(true);
    expect(isCutOnly({ drss_number: 'SPOOL-AD' })).toBe(true);
    expect(isCutOnly({ source_document_id: 'doc-1' })).toBe(true);
    expect(isCutOnly({ job_name: 'Gauge Cutter', drss_number: 'DRSS-1' })).toBe(false);
  });
});

describe('admin write rules', () => {
  it('puts every admin write behind the users menu', () => {
    expect(ruleFor('POST', '/api/admin/users')?.menu).toBe('users');
    expect(ruleFor('PATCH', '/api/admin/users/NESR-1')?.menu).toBe('users');
    expect(ruleFor('PUT', '/api/admin/users/NESR-1/grants')?.menu).toBe('users');
    expect(ruleFor('PUT', '/api/admin/role-permissions')?.menu).toBe('users');
    expect(ruleFor('DELETE', '/api/admin/users/NESR-1')).toMatchObject({ menu: 'users', action: 'delete' });
    expect(ruleFor('DELETE', '/api/admin/role-permissions')).toBeUndefined();
  });
});

describe('effective tabs = role + grants − removals (Admin Manual 5.1, 8.2)', () => {
  const perms = [
    { menu_key: 'jobs', can_view: 1, can_edit: 0, can_delete: 0 },
    { menu_key: 'schedule', can_view: 1, can_edit: 1, can_delete: 0 },
  ];
  it('adds a granted tab and upgrades view to edit', () => {
    const m = effectiveMenus(perms, [{ menu_key: 'jobs', effect: 'grant', can_edit: 1 }, { menu_key: 'bonus', effect: 'grant', can_edit: 0 }], false);
    expect(m.jobs).toEqual({ view: true, edit: true, delete: false });
    expect(m.bonus).toEqual({ view: true, edit: false, delete: false });
  });
  it('removes a role tab', () => {
    const m = effectiveMenus(perms, [{ menu_key: 'schedule', effect: 'deny', can_edit: 0 }], false);
    expect(m.schedule).toBeUndefined();
    expect(m.jobs?.view).toBe(true);
  });
  it('opens Pre-Job Notes for people on the SLK Contacts list, unless removed', () => {
    expect(effectiveMenus(perms, [], true).pre_job_notes).toEqual({ view: true, edit: true, delete: false });
    expect(effectiveMenus(perms, [{ menu_key: 'pre_job_notes', effect: 'deny', can_edit: 0 }], true).pre_job_notes).toBeUndefined();
    expect(effectiveMenus(perms, [], false).pre_job_notes).toBeUndefined();
  });
});

describe('read rules (deny by default)', () => {
  const v = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, { view: true, edit: false, delete: false }]));
  it('closes a page whose tab was removed', () => {
    expect(readAllowed('/api/schedule', v(['jobs']))).toBe(false);
    expect(readAllowed('/api/schedule', v(['schedule']))).toBe(true);
  });
  it('opens jobs from either Jobs or Schedule', () => {
    expect(readAllowed('/api/jobs/abc', v(['schedule']))).toBe(true);
    expect(readAllowed('/api/jobs', v([]))).toBe(false);
  });
  it('keeps the shell endpoints open and refuses unknown reads', () => {
    expect(readAllowed('/api/session', {})).toBe(true);
    expect(readAllowed('/api/lookups', {})).toBe(true);
    expect(readAllowed('/api/secret', v(['schedule', 'jobs']))).toBe(false);
  });
});

describe('menu clusters (grant checklist grouped like the navigation)', () => {
  it('puts keys under their nav group and the rest under Other', () => {
    const cl = menuClusters(['schedule', 'jobs', 'bonus', 'audit', 'ai_assistant']);
    // the audit trail has its own page under Administration now
    expect(cl.map((c) => c.label)).toEqual(['Operation', 'Bonus', 'Administration', 'Other']);
    expect(cl.find((c) => c.label === 'Other')!.keys).toEqual(['ai_assistant']);
  });
});

describe('WIREGUARD role defaults', () => {
  it('maps known roles and falls back to viewer', () => {
    expect(defaultRoleFor('Supervisor')).toBe('slickline_supervisor');
    expect(defaultRoleFor('Admin')).toBe('admin');
    expect(defaultRoleFor('Something new')).toBe('viewer');
    expect(defaultRoleFor(null)).toBe('viewer');
  });
});

describe('audit trail areas', () => {
  it('files each entry under an area, unknown ones under Other', async () => {
    const { areaOf, actionLabel } = await import('../src/shared/audit');
    expect([areaOf('auth'), areaOf('job'), areaOf('form_template'), areaOf('something_new')]).toEqual(['auth', 'jobs', 'forms', 'other']);
    expect([actionLabel('login_failed'), actionLabel('made_up_action')]).toEqual(['Sign-in failed', 'made up action']);
  });
});
