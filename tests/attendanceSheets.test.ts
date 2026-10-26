import { describe, expect, it } from 'vitest';
import { canApprove, canFill, canSee, defaultSheet, type SheetRow } from '../src/shared/attendanceSheets';
import type { Role } from '../src/shared/types';

const row = (r: Partial<SheetRow>): SheetRow => ({ attendance_sheet: 'field', wg_username: null, reports_to_username: null, self_updated: 0, ...r });
const as = (role: Role, username = 'NESR-1') => ({ role, username });

describe('attendance sheets by role', () => {
  it('operators and helpers: the Foreman fills their own crew, the SDM approves', () => {
    const crew = row({ attendance_sheet: 'field', reports_to_username: 'NESR-1' });
    const other = row({ attendance_sheet: 'field', reports_to_username: 'NESR-9' });
    expect(canFill(as('foreman'), crew)).toBe(true);
    expect(canFill(as('foreman'), other)).toBe(false);
    expect(canFill(as('sdm'), crew)).toBe(false);
    expect(canApprove(as('sdm'), crew)).toBe(true);
    expect(canApprove(as('foreman'), crew)).toBe(false);
    expect(canApprove(as('maintenance_manager'), crew)).toBe(false);
  });
  it('shop support staff: the Maintenance Supervisor fills, the Maintenance Manager approves', () => {
    const shop = row({ attendance_sheet: 'shop' });
    expect(canFill(as('maintenance_supervisor'), shop)).toBe(true);
    expect(canFill(as('foreman'), shop)).toBe(false);
    expect(canApprove(as('maintenance_manager'), shop)).toBe(true);
    expect(canApprove(as('sdm'), shop)).toBe(false);
  });
  it('management: the person or an Admin fills, the Operations Manager approves', () => {
    const mine = row({ attendance_sheet: 'management', wg_username: 'NESR-1' });
    const someone = row({ attendance_sheet: 'management', wg_username: 'NESR-2' });
    expect(canFill(as('director'), mine)).toBe(true);
    expect(canFill(as('director'), someone)).toBe(false);
    expect(canFill(as('admin'), someone)).toBe(true);
    expect(canApprove(as('operations_manager'), someone)).toBe(true);
    expect(canApprove(as('sdm'), someone)).toBe(false);
  });
  it('the attendance admin fills anything and approves nothing; SELF rows are filled by the person', () => {
    expect(canFill(as('attendance_admin'), row({ attendance_sheet: 'shop' }))).toBe(true);
    expect(canApprove(as('attendance_admin'), row({ attendance_sheet: 'shop' }))).toBe(false);
    expect(canFill(as('viewer'), row({ attendance_sheet: 'shop', wg_username: 'nesr-1', self_updated: 1 }))).toBe(true);
    expect(canFill(as('viewer'), row({ attendance_sheet: 'shop', wg_username: 'NESR-1' }))).toBe(false);
  });
  it('shows each person the rows they fill or approve, and their own', () => {
    expect(canSee(as('viewer'), row({ wg_username: 'NESR-1' }))).toBe(true);
    expect(canSee(as('viewer'), row({ wg_username: 'NESR-2' }))).toBe(false);
    expect(canSee(as('operations_manager'), row({ attendance_sheet: 'shop' }))).toBe(true);
    expect(canSee(as('sdm'), row({ attendance_sheet: 'field' }))).toBe(true);
    expect(canSee(as('sdm'), row({ attendance_sheet: 'shop' }))).toBe(false);
  });
  it('puts crews on the field sheet and everyone else in the shop by default', () => {
    expect(defaultSheet('helper')).toBe('field');
    expect(defaultSheet('other')).toBe('shop');
    expect(defaultSheet(null)).toBe('shop');
  });
});
