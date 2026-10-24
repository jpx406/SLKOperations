import { describe, expect, it } from 'vitest';
import { canEditField, filterPatch } from '../src/shared/fieldPolicy';
import { jobEfficiency, opHours, runEfficiency } from '../src/shared/metrics';
import { defaultRoleFor } from '../src/shared/roles';
import { stagePercent } from '../src/shared/stages';
import { isOpenWrite, ruleFor } from '../src/worker/permissions';

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
});

describe('write rules (deny by default)', () => {
  it('maps every job write to a menu right', () => {
    expect(ruleFor('POST', '/api/jobs')?.menu).toBe('jobs');
    expect(ruleFor('PATCH', '/api/jobs/abc')?.action).toBe('edit');
    expect(ruleFor('DELETE', '/api/jobs/abc')?.action).toBe('delete');
    expect(ruleFor('PUT', '/api/jobs/abc/services')?.menu).toBe('jobs');
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

describe('WIREGUARD role defaults', () => {
  it('maps known roles and falls back to viewer', () => {
    expect(defaultRoleFor('Supervisor')).toBe('slickline_supervisor');
    expect(defaultRoleFor('Admin')).toBe('admin');
    expect(defaultRoleFor('Something new')).toBe('viewer');
    expect(defaultRoleFor(null)).toBe('viewer');
  });
});
