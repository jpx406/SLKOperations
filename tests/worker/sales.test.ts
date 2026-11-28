import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addJob, call, rows, signIn, startApp, type TestApp } from './helpers';

// Sales Dashboard activity lines (src/worker/sales.ts): checking and locking writes the lock and one audit row per
// line; only an admin unlocks.
let t: TestApp;
let sales: string, admin: string, viewer: string;
let a: string, b: string;

beforeAll(async () => {
  t = await startApp();
  sales = await signIn(t, 'sales1', { role: 'sales', fullName: 'Sara Sales' });
  admin = await signIn(t, 'admin1', { role: 'admin' });
  viewer = await signIn(t, 'viewer1', { role: 'viewer' });
  a = await addJob(t, { status: 'completed', ticket_no: 'S-1', start_date: '2026-11-03', end_date: '2026-11-04', location: 'Aramco' });
  b = await addJob(t, { status: 'completed', ticket_no: 'S-2', start_date: '2026-11-05', end_date: '2026-11-06', location: 'Aramco' });
});
afterAll(async () => {
  expect(t.wgCalls).toEqual([]);
  await t.dispose();
});

const audits = (action: string) => rows<{ entity_id: string; username: string }>(t, `SELECT entity_id, username FROM audit_log WHERE entity_type = 'sales' AND action = ? ORDER BY entity_id`, action);

describe('sales activity lock and unlock', () => {
  it('types a value on a line', async () => {
    const r = await call(t, 'PUT', `/sales/activity/${a}`, { cookie: sales, body: { values: { callout_on: '2026-11-02' } } });
    expect(r.status).toBe(200);
    expect(r.json.data.callout_on).toBe('2026-11-02');
  });

  it('refuses locking without the Sales Dashboard edit right', async () => {
    const r = await call(t, 'POST', '/sales/activity/lock', { cookie: viewer, body: { job_ids: [a] } });
    expect(r.status).toBe(403);
  });

  it('locks each line with one audit row per line', async () => {
    const r = await call(t, 'POST', '/sales/activity/lock', { cookie: sales, body: { job_ids: [a, b] } });
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(2);
    const locked = await rows<{ job_id: string; locked_by: string; locked_at: string | null; snapshot: string | null; data: string }>(t, 'SELECT job_id, locked_by, locked_at, snapshot, data FROM sales_activity ORDER BY job_id');
    expect(locked.map((l) => l.job_id).sort()).toEqual([a, b].sort());
    for (const l of locked) {
      expect(l.locked_by).toBe('sales1');
      expect(l.locked_at).toBeTruthy();
      expect(JSON.parse(l.snapshot ?? 'null')).toBeTypeOf('object');
    }
    // the typed value survives the lock
    expect(JSON.parse(locked.find((l) => l.job_id === a)!.data).callout_on).toBe('2026-11-02');
    expect((await audits('review')).map((x) => x.entity_id)).toEqual([a, b].sort());
  });

  it('does nothing for lines already locked, and refuses typing on them', async () => {
    const r = await call(t, 'POST', '/sales/activity/lock', { cookie: sales, body: { job_ids: [a, b] } });
    expect(r.json.changed).toBe(0);
    expect(await audits('review')).toHaveLength(2);
    const put = await call(t, 'PUT', `/sales/activity/${a}`, { cookie: sales, body: { values: { callout_on: '2026-11-01' } } });
    expect(put.status).toBe(409);
  });

  it('only an admin unlocks', async () => {
    const no = await call(t, 'POST', '/sales/activity/unlock', { cookie: sales, body: { job_ids: [a, b], reason: 'typo' } });
    expect(no.status).toBe(403);
    expect(await rows(t, 'SELECT 1 FROM sales_activity WHERE locked_at IS NULL')).toHaveLength(0);
    expect(await audits('reopen')).toHaveLength(0);

    const ok = await call(t, 'POST', '/sales/activity/unlock', { cookie: admin, body: { job_ids: [a], reason: 'wrong PO' } });
    expect(ok.status).toBe(200);
    expect(ok.json.changed).toBe(1);
    expect(await rows(t, 'SELECT job_id, locked_by, locked_at, snapshot FROM sales_activity WHERE job_id = ?', a)).toEqual([{ job_id: a, locked_by: null, locked_at: null, snapshot: null }]);
    expect(await rows(t, 'SELECT locked_by FROM sales_activity WHERE job_id = ?', b)).toEqual([{ locked_by: 'sales1' }]);
    const reopen = await rows<{ entity_id: string; username: string; summary: string }>(t, `SELECT entity_id, username, summary FROM audit_log WHERE entity_type = 'sales' AND action = 'reopen'`);
    expect(reopen).toHaveLength(1);
    expect(reopen[0]).toMatchObject({ entity_id: a, username: 'admin1' });
    expect(reopen[0].summary).toMatch(/wrong PO/);
  });

  it('refuses an empty pick', async () => {
    expect((await call(t, 'POST', '/sales/activity/lock', { cookie: sales, body: { job_ids: [] } })).status).toBe(400);
  });
});
