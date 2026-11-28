import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addEmployee, call, rows, signIn, startApp, type TestApp } from './helpers';

// Attendance approvals (src/worker/attendance.ts): nobody but an admin reviews or approves their own row.
let t: TestApp;
let om1: string, om2: string, sdmR: string, sdm2: string, admin: string;
const emp: Record<string, string> = {};
const MONTH = '2026-11';

beforeAll(async () => {
  t = await startApp();
  om1 = await signIn(t, 'om1', { role: 'operations_manager', fullName: 'Olga One' });
  om2 = await signIn(t, 'om2', { role: 'operations_manager', fullName: 'Otto Two' });
  sdmR = await signIn(t, 'sdmR', { role: 'sdm', fullName: 'Rita SDM' });
  sdm2 = await signIn(t, 'sdm2', { role: 'sdm', fullName: 'Sid SDM' });
  admin = await signIn(t, 'admin1', { role: 'admin', fullName: 'Al Admin' });
  // operations managers sit on the Management sheet (approved by an operations manager, one step);
  // sdmR and the admin are moved by hand onto Field Supervisors (reviewed by an SDM, then approved)
  emp.om1 = await addEmployee(t, { full_name: 'Olga One', wg_username: 'om1' });
  emp.om2 = await addEmployee(t, { full_name: 'Otto Two', wg_username: 'om2' });
  emp.sdmR = await addEmployee(t, { full_name: 'Rita SDM', wg_username: 'sdmR', attendance_category: 'field_staff' });
  emp.sdm2 = await addEmployee(t, { full_name: 'Sid SDM', wg_username: 'sdm2' });
  emp.admin1 = await addEmployee(t, { full_name: 'Al Admin', wg_username: 'admin1', attendance_category: 'field_staff' });
});
afterAll(async () => {
  expect(t.wgCalls).toEqual([]);
  await t.dispose();
});

const approvals = (id: string) => rows<{ approved_by: string }>(t, 'SELECT approved_by FROM attendance_approvals WHERE employee_id = ? AND month = ?', id, MONTH);
const reviews = (id: string) => rows<{ reviewed_by: string }>(t, 'SELECT reviewed_by FROM attendance_reviews WHERE employee_id = ? AND month = ?', id, MONTH);

describe('attendance approvals', () => {
  it('nobody approves their own month', async () => {
    const r = await call(t, 'POST', '/attendance/approve', { cookie: om1, body: { employee_id: emp.om1, month: MONTH } });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('Someone else approves your own month');
    expect(await approvals(emp.om1)).toEqual([]);
  });

  it('another approver approves it, with a signature and an audit row', async () => {
    const r = await call(t, 'POST', '/attendance/approve', { cookie: om2, body: { employee_id: emp.om1, month: MONTH } });
    expect(r.status).toBe(200);
    expect(await approvals(emp.om1)).toEqual([{ approved_by: 'om2' }]);
    expect(await rows(t, `SELECT username FROM signatures WHERE entity_type = 'attendance' AND entity_id = ?`, `${emp.om1}|${MONTH}`)).toEqual([{ username: 'om2' }]);
    expect(await rows(t, `SELECT username, action FROM audit_log WHERE entity_type = 'attendance' AND entity_id = ?`, emp.om1)).toEqual([{ username: 'om2', action: 'approve' }]);
  });

  it('a role the sheet does not name cannot approve', async () => {
    const r = await call(t, 'POST', '/attendance/approve', { cookie: sdm2, body: { employee_id: emp.om2, month: MONTH } });
    expect(r.status).toBe(403);
    expect(await approvals(emp.om2)).toEqual([]);
  });

  it('nobody reviews their own month; another reviewer can', async () => {
    const own = await call(t, 'POST', '/attendance/review', { cookie: sdmR, body: { employee_id: emp.sdmR, month: MONTH } });
    expect(own.status).toBe(403);
    expect(own.json.error).toBe('Someone else reviews your own month');
    expect(await reviews(emp.sdmR)).toEqual([]);

    const ok = await call(t, 'POST', '/attendance/review', { cookie: sdm2, body: { employee_id: emp.sdmR, month: MONTH } });
    expect(ok.status).toBe(200);
    expect(await reviews(emp.sdmR)).toEqual([{ reviewed_by: 'sdm2' }]);
  });

  it('a two-step month needs the review before it is approved', async () => {
    const r = await call(t, 'POST', '/attendance/approve', { cookie: om1, body: { employee_id: emp.sdm2, month: MONTH } });
    // sdm2 is on Management (one step): approved directly
    expect(r.status).toBe(200);
    const early = await call(t, 'POST', '/attendance/approve', { cookie: om1, body: { employee_id: emp.admin1, month: MONTH } });
    expect(early.status).toBe(409);
    expect(await approvals(emp.admin1)).toEqual([]);
  });

  it('an admin may review and approve their own row', async () => {
    const rev = await call(t, 'POST', '/attendance/review', { cookie: admin, body: { employee_id: emp.admin1, month: MONTH } });
    expect(rev.status).toBe(200);
    const app = await call(t, 'POST', '/attendance/approve', { cookie: admin, body: { employee_id: emp.admin1, month: MONTH } });
    expect(app.status).toBe(200);
    expect(await reviews(emp.admin1)).toEqual([{ reviewed_by: 'admin1' }]);
    expect(await approvals(emp.admin1)).toEqual([{ approved_by: 'admin1' }]);
  });

  it('a write from another site is refused before anything is checked', async () => {
    const r = await call(t, 'POST', '/attendance/approve', { cookie: om1, origin: 'https://evil.test', body: { employee_id: emp.om2, month: MONTH } });
    expect(r.status).toBe(403);
    expect(await approvals(emp.om2)).toEqual([]);
  });
});
