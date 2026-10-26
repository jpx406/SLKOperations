import { describe, expect, it } from 'vitest';
import { allowed, jraLevelDefaults, jraLevelKey, resolveRules } from '../src/shared/approvalRules';
import { canApprove, canFill } from '../src/shared/attendanceSheets';
import { canEditField, filterPatch } from '../src/shared/fieldPolicy';
import { ruleFor } from '../src/worker/permissions';

describe('approval rules', () => {
  it('start from the old behaviour and take stored changes on top', () => {
    const d = resolveRules([]);
    expect(d['bonus.approve']).toEqual(['sdm', 'deputy_sdm']);
    expect(allowed(d, 'bonus.reopen', 'sdm')).toBe(false);
    expect(allowed(d, 'bonus.reopen', 'admin')).toBe(true);
    const r = resolveRules([{ key: 'bonus.approve', roles: '["operations_manager"]' }]);
    expect(allowed(r, 'bonus.approve', 'sdm')).toBe(false);
    expect(allowed(r, 'bonus.approve', 'operations_manager')).toBe(true);
  });
  it('gives every JRA level on the forms its own rule, with a guess from its name', () => {
    const r = resolveRules([], ['Cell Leader', 'Ops or Technical Manager']);
    expect(r[jraLevelKey('Cell Leader')]).toContain('foreman');
    expect(r[jraLevelKey('Ops or Technical Manager')]).toEqual(expect.arrayContaining(['operations_manager', 'sqm']));
    expect(jraLevelDefaults('Something else')).toEqual(['sdm', 'deputy_sdm', 'operations_manager']);
  });
  it('job fields follow their rule, also when the admin changes it', () => {
    expect(canEditField('sales', 'revenue_cents')).toBe(true);
    const r = resolveRules([{ key: 'closure.revenue', roles: '["sdm"]' }]);
    expect(canEditField('sales', 'revenue_cents', r)).toBe(false);
    expect(filterPatch('sales', { revenue_cents: 5, ticket_no: 'T1' }, r)).toEqual({ allowed: { ticket_no: 'T1' }, dropped: ['revenue_cents'] });
  });
  it('attendance fillers and approvers follow the rules', () => {
    const shop = { attendance_sheet: 'shop' as const, wg_username: null, reports_to_username: null, self_updated: 0 };
    const r = resolveRules([{ key: 'attendance.shop.approve', roles: '["operations_manager"]' }, { key: 'attendance.shop.fill', roles: '["storekeeper"]' }]);
    expect(canApprove({ role: 'maintenance_manager', username: 'x' }, shop, r)).toBe(false);
    expect(canApprove({ role: 'operations_manager', username: 'x' }, shop, r)).toBe(true);
    expect(canFill({ role: 'storekeeper', username: 'x' }, shop, r)).toBe(true);
  });
  it('keeps roles and approvals in Users & Roles', () => {
    expect(ruleFor('POST', '/api/admin/roles')).toMatchObject({ menu: 'users', action: 'edit' });
    expect(ruleFor('DELETE', '/api/admin/roles/x')).toMatchObject({ menu: 'users', action: 'delete' });
    expect(ruleFor('PUT', '/api/admin/rules')).toMatchObject({ menu: 'users', action: 'edit' });
  });
});
