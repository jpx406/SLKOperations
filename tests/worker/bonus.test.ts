import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COUNTRY, addEmployee, addJob, call, rows, run, signIn, startApp, type TestApp } from './helpers';

// Bonus on Closure (src/worker/bonus.ts): the split is saved on a completed job and approved by a second person.
let t: TestApp;
let sdm1: string, sdm2: string, sdm3: string, admin: string, viewer: string;
let e1: string, e2: string;

async function completedJob(ticket: string) {
  const id = await addJob(t, { status: 'completed', ticket_no: ticket, start_date: '2026-11-01', end_date: '2026-11-02' });
  await run(t, `INSERT INTO job_services (id, job_id, position, job_type_name) VALUES (?, ?, 1, 'Gauge Run')`, crypto.randomUUID(), id);
  await run(t, `INSERT INTO job_crew (id, job_id, employee_id, crew_role, slot) VALUES (?, ?, ?, 'slickline_supervisor', 1)`, crypto.randomUUID(), id, e1);
  await run(t, `INSERT INTO job_crew (id, job_id, employee_id, crew_role, slot) VALUES (?, ?, ?, 'slickline_operator', 2)`, crypto.randomUUID(), id, e2);
  return id;
}

/** Saves the proposed default split as `cookie`. */
async function saveSplit(cookie: string, jobId: string) {
  const g = await call(t, 'GET', `/bonus/jobs/${jobId}`, { cookie });
  expect(g.status).toBe(200);
  expect(g.json.pool.cents).toBe(100_000);
  const lines = g.json.lines.map((l: Record<string, unknown>) => ({ employee_id: l.employee_id, crew_role: l.crew_role, share_pct: l.share_pct, amount_cents: l.amount_cents }));
  const r = await call(t, 'PUT', `/bonus/jobs/${jobId}`, { cookie, body: { lines } });
  expect(r.status).toBe(200);
  expect(r.json.bonus.status).toBe('draft');
  return r;
}

beforeAll(async () => {
  t = await startApp();
  sdm1 = await signIn(t, 'sdm1', { role: 'sdm', fullName: 'Sam One' });
  sdm2 = await signIn(t, 'sdm2', { role: 'sdm', fullName: 'Sam Two' });
  sdm3 = await signIn(t, 'sdm3', { role: 'sdm', fullName: 'Sam Three' });
  admin = await signIn(t, 'admin1', { role: 'admin' });
  viewer = await signIn(t, 'viewer1', { role: 'viewer' });
  // sdm3 is also the supervisor on the crew
  e1 = await addEmployee(t, { full_name: 'Sam Three', wg_username: 'sdm3', crew_role: 'slickline_supervisor' });
  e2 = await addEmployee(t, { full_name: 'Omar Operator', crew_role: 'slickline_operator' });
  await run(t, `INSERT INTO bonus_rules (id, country, job_type_name, basis, amount_cents) VALUES (?, ?, 'Gauge Run', 'per_job', 100000)`, crypto.randomUUID(), COUNTRY);
  await run(t, `INSERT INTO bonus_role_splits (country, crew_role, share_pct) VALUES (?, 'slickline_supervisor', 60), (?, 'slickline_operator', 40)`, COUNTRY, COUNTRY);
});
afterAll(async () => {
  expect(t.wgCalls).toEqual([]);
  await t.dispose();
});

describe('bonus distribution', () => {
  it('is only saved on a completed job', async () => {
    const id = await addJob(t, { status: 'ongoing', ticket_no: 'B-ONGOING' });
    const r = await call(t, 'PUT', `/bonus/jobs/${id}`, { cookie: sdm1, body: { lines: [] } });
    expect(r.status).toBe(409);
  });

  it('refuses roles that do not distribute bonus', async () => {
    const id = await completedJob('B-VIEW');
    const r = await call(t, 'GET', `/bonus/jobs/${id}`, { cookie: viewer });
    expect(r.status).toBe(403);
  });

  it('saves a split, and only a second person who is not in it approves', async () => {
    const id = await completedJob('B-100');
    await saveSplit(sdm1, id);
    const saved = await rows<{ employee_id: string; amount_cents: number; status: string; updated_by: string }>(t, 'SELECT employee_id, amount_cents, status, updated_by FROM job_bonus_lines WHERE job_id = ? ORDER BY amount_cents DESC', id);
    expect(saved).toEqual([
      { employee_id: e1, amount_cents: 60_000, status: 'draft', updated_by: 'sdm1' },
      { employee_id: e2, amount_cents: 40_000, status: 'draft', updated_by: 'sdm1' },
    ]);

    // the person who saved it
    const own = await call(t, 'POST', `/bonus/jobs/${id}/approve`, { cookie: sdm1, body: {} });
    expect(own.status).toBe(403);
    expect(own.json.error).toMatch(/You saved this distribution/);

    // someone in the distribution
    const mine = await call(t, 'POST', `/bonus/jobs/${id}/approve`, { cookie: sdm3, body: {} });
    expect(mine.status).toBe(403);
    expect(mine.json.error).toMatch(/You are in this distribution/);

    expect((await rows(t, `SELECT 1 FROM job_bonus_lines WHERE job_id = ? AND status = 'approved'`, id))).toHaveLength(0);

    const ok = await call(t, 'POST', `/bonus/jobs/${id}/approve`, { cookie: sdm2, body: {} });
    expect(ok.status).toBe(200);
    expect(ok.json.bonus.status).toBe('approved');
    const after = await rows<{ status: string; approved_by: string }>(t, 'SELECT DISTINCT status, approved_by FROM job_bonus_lines WHERE job_id = ?', id);
    expect(after).toEqual([{ status: 'approved', approved_by: 'sdm2' }]);
    const sig = await rows<{ username: string; revoked_at: string | null }>(t, `SELECT username, revoked_at FROM signatures WHERE entity_type = 'bonus' AND entity_id = ?`, id);
    expect(sig).toEqual([{ username: 'sdm2', revoked_at: null }]);
    const log = await rows<{ username: string; summary: string }>(t, `SELECT username, summary FROM audit_log WHERE entity_type = 'bonus' AND entity_id = ? AND action = 'approve'`, id);
    expect(log).toHaveLength(1);
    expect(log[0].username).toBe('sdm2');
    expect(log[0].summary).not.toMatch(/override/);

    // approved: locked for changes and for a second approval
    expect((await call(t, 'POST', `/bonus/jobs/${id}/approve`, { cookie: sdm2, body: {} })).status).toBe(409);
    expect((await call(t, 'PUT', `/bonus/jobs/${id}`, { cookie: sdm2, body: { lines: [] } })).status).toBe(409);
  });

  it('lets an admin approve a split they saved, logged as an admin override', async () => {
    const id = await completedJob('B-200');
    await saveSplit(admin, id);
    const r = await call(t, 'POST', `/bonus/jobs/${id}/approve`, { cookie: admin, body: {} });
    expect(r.status).toBe(200);
    const log = await rows<{ summary: string }>(t, `SELECT summary FROM audit_log WHERE entity_type = 'bonus' AND entity_id = ? AND action = 'approve'`, id);
    expect(log).toHaveLength(1);
    expect(log[0].summary).toMatch(/admin override: approver saved it/);
  });

  it('refuses lines that add up to more than the pool', async () => {
    const id = await completedJob('B-300');
    const r = await call(t, 'PUT', `/bonus/jobs/${id}`, { cookie: sdm1, body: { lines: [{ employee_id: e1, amount_cents: 100_000 }, { employee_id: e2, amount_cents: 1 }] } });
    expect(r.status).toBe(400);
    expect(await rows(t, 'SELECT 1 FROM job_bonus_lines WHERE job_id = ?', id)).toHaveLength(0);
  });
});
