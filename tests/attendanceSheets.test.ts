import { describe, expect, it } from 'vitest';
import { resolveRules } from '../src/shared/approvalRules';
import { DEFAULT_CATEGORIES, canApprove, canFill, canReview, canSee, categoryRules, type SheetRow } from '../src/shared/attendanceSheets';
import type { Role } from '../src/shared/types';

const rules = resolveRules([], [], categoryRules(DEFAULT_CATEGORIES));
const row = (r: Partial<SheetRow>): SheetRow => ({ attendance_sheet: 'field', wg_username: null, reports_to_username: null, self_updated: 0, ...r });
const as = (role: Role, username = 'NESR-1') => ({ role, username });

describe('attendance categories and their rules', () => {
  it('operators and helpers: the Foreman fills their own crew, the SDM approves in one step', () => {
    const crew = row({ attendance_sheet: 'field', reports_to_username: 'NESR-1' });
    const other = row({ attendance_sheet: 'field', reports_to_username: 'NESR-9' });
    expect(canFill(as('foreman'), crew, rules)).toBe(true);
    expect(canFill(as('foreman'), other, rules)).toBe(false);
    expect(canFill(as('sdm'), crew, rules)).toBe(false);
    expect(canReview(as('sdm'), crew, rules)).toBe(false); // one step
    expect(canApprove(as('sdm'), crew, rules)).toBe(true);
  });
  it('field supervisors / engineers: reviewed by the SDM, finally approved by the Operations Manager', () => {
    const r = row({ attendance_sheet: 'field_staff' });
    expect(canReview(as('sdm'), r, rules)).toBe(true);
    expect(canApprove(as('sdm'), r, rules)).toBe(false);
    expect(canApprove(as('operations_manager'), r, rules)).toBe(true);
    expect(canReview(as('operations_manager'), r, rules)).toBe(false);
    expect(canFill(as('sdm'), r, rules)).toBe(true);
  });
  it('shop and management keep their fillers and approvers', () => {
    expect(canFill(as('maintenance_supervisor'), row({ attendance_sheet: 'shop' }), rules)).toBe(true);
    expect(canApprove(as('maintenance_manager'), row({ attendance_sheet: 'shop' }), rules)).toBe(true);
    expect(canFill(as('director'), row({ attendance_sheet: 'management', wg_username: 'NESR-1' }), rules)).toBe(true);
    expect(canFill(as('director'), row({ attendance_sheet: 'management', wg_username: 'NESR-2' }), rules)).toBe(false);
    expect(canApprove(as('operations_manager'), row({ attendance_sheet: 'management' }), rules)).toBe(true);
  });
  it('a category added by the admin uses the rules set for it', () => {
    const cats = [...DEFAULT_CATEGORIES, { key: 'drivers', label: 'Drivers', sort: 9, fill_scope: 'any' as const, two_step: 0, auto_from_jobs: 0, job_code: 'P', builtin: 0 }];
    const r = resolveRules([{ key: 'attendance.drivers.fill', roles: '["storekeeper"]' }], [], categoryRules(cats));
    expect(canFill(as('storekeeper'), row({ attendance_sheet: 'drivers' }), r, cats)).toBe(true);
    expect(canApprove(as('operations_manager'), row({ attendance_sheet: 'drivers' }), r, cats)).toBe(true);
    expect(canFill(as('storekeeper'), row({ attendance_sheet: 'gone' }), r, cats)).toBe(false);
  });
  it('makes the review rule only for two-step categories', () => {
    const keys = categoryRules(DEFAULT_CATEGORIES).map((d) => d.key);
    expect(keys).toContain('attendance.field_staff.review');
    expect(keys).not.toContain('attendance.field.review');
    expect(keys).not.toContain('attendance.management.fill');
  });
  it('the attendance admin fills anything and approves nothing; each person sees their own row', () => {
    expect(canFill(as('attendance_admin'), row({ attendance_sheet: 'shop' }), rules)).toBe(true);
    expect(canApprove(as('attendance_admin'), row({ attendance_sheet: 'shop' }), rules)).toBe(false);
    expect(canSee(as('viewer'), row({ wg_username: 'NESR-1' }), rules)).toBe(true);
    expect(canSee(as('viewer'), row({ wg_username: 'NESR-2' }), rules)).toBe(false);
  });
});
