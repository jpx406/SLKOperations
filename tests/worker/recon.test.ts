import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addJob, call, daysFromNow, rows, run, signIn, startApp, wgDrum, wgRun, wgUnit, type TestApp } from './helpers';

// Reconciliation (src/worker/recon.ts): the month summary per unit, and running and explaining findings.
// Read-only towards WIREGUARD: the fake WIREGUARD must never be called.
let t: TestApp;
let sdm: string, omn: string, viewer: string;

const finding = (f: { country?: string; check?: string; status?: string; job_id?: string | null; detail?: unknown }) =>
  run(t, `INSERT INTO recon_findings (id, country, check_code, severity, job_id, wg_run_ids, detail, fingerprint, status, first_seen_at, last_seen_at)
          VALUES (?, ?, ?, 'medium', ?, '[]', ?, ?, ?, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
    crypto.randomUUID(), f.country ?? 'KSA', f.check ?? 'date_mismatch', f.job_id ?? null, JSON.stringify(f.detail ?? {}), crypto.randomUUID(), f.status ?? 'open');

beforeAll(async () => {
  t = await startApp();
  sdm = await signIn(t, 'sdm1', { role: 'sdm', fullName: 'Sam SDM' });
  omn = await signIn(t, 'sdmOmn', { role: 'sdm', countries: ['OMN'] });
  viewer = await signIn(t, 'viewer1', { role: 'viewer' });
});
afterAll(async () => {
  expect(t.wgCalls).toEqual([]);
  await t.dispose();
});

describe('reconciliation summary', () => {
  beforeAll(async () => {
    for (const u of ['U1', 'U2', 'U3']) await wgUnit(t, u);
    await wgUnit(t, 'U4', 'UAE');
    await wgDrum(t, 'D1', 'U1');
    await wgDrum(t, 'D2', 'U2');
    await wgDrum(t, 'D4', 'U4', 'UAE');
    const j1 = await addJob(t, { unit_number: 'U1', start_date: '2026-11-05', end_date: '2026-11-06', sdm_username: 'sdm1', status: 'completed' });
    await addJob(t, { unit_number: 'U1', start_date: '2026-11-10', status: 'canceled' });         // canceled: not counted
    await addJob(t, { unit_number: 'U1', start_date: '2026-10-30', end_date: '2026-11-02' });    // started in October
    const gone = await addJob(t, { unit_number: 'U2', start_date: '2026-11-07' });
    await run(t, `UPDATE jobs SET deleted_at = '2026-11-08T00:00:00Z' WHERE id = ?`, gone);    // deleted: not counted
    await addJob(t, { unit_number: 'U4', start_date: '2026-11-07', country: 'UAE' });           // another country
    for (const [id, d] of [['r1', '2026-11-05'], ['r2', '2026-11-05'], ['r3', '2026-11-30']] as const) await wgRun(t, { wg_id: id, job_date: d, drum_no: 'D1' });
    await wgRun(t, { wg_id: 'r4', job_date: '2026-11-06', drum_no: 'D1', is_cut_only: 1 });     // a wire cut, never a run
    await wgRun(t, { wg_id: 'r5', job_date: '2026-12-01', drum_no: 'D1' });                     // next month
    await wgRun(t, { wg_id: 'r6', job_date: '2026-11-12', drum_no: 'D2' });
    await wgRun(t, { wg_id: 'r7', job_date: '2026-11-12', drum_no: 'D4', country: 'UAE' });
    await finding({ job_id: j1 });
    await finding({ job_id: null, check: 'unlinked_runs', detail: { unit: 'U2' } });
    await finding({ job_id: j1, status: 'resolved' });
    await finding({ job_id: j1, status: 'explained' });
  });

  it('counts jobs, runs and open findings per unit for the month', async () => {
    const r = await call(t, 'GET', '/recon/summary?month=2026-11', { cookie: sdm });
    expect(r.status).toBe(200);
    expect(r.json.month).toBe('2026-11');
    expect(r.json.units).toEqual([
      { unit_number: 'U1', jobs: 1, runs: 3, open_findings: 1 },
      { unit_number: 'U2', jobs: 0, runs: 1, open_findings: 1 },
    ]);
    expect(r.json.open).toEqual({ medium: 2 });
    expect(r.json.sdms).toEqual([expect.objectContaining({ sdm: 'sdm1', name: 'Sam SDM', jobs: 1, open_findings: 1 })]);
  });

  it('refuses a bad month and a user without Reconciliation', async () => {
    expect((await call(t, 'GET', '/recon/summary?month=2026-1', { cookie: sdm })).status).toBe(400);
    expect((await call(t, 'GET', '/recon/summary?month=2026-11', { cookie: viewer })).status).toBe(403);
  });
});

describe('running and explaining findings', () => {
  let jobId: string;
  beforeAll(async () => {
    await wgUnit(t, 'U9', 'OMN');
    await wgDrum(t, 'D9', 'U9', 'OMN');
    // a completed job with no runs, and a run no job claims
    jobId = await addJob(t, { country: 'OMN', ticket_no: 'R-1', unit_number: 'U9', status: 'completed', start_date: daysFromNow(-10), end_date: daysFromNow(-9) });
    await wgRun(t, { wg_id: 'w9', job_date: daysFromNow(-30), drum_no: 'D9', country: 'OMN', field_ticket: 'NOPE-9' });
  });

  it('runs the checks and stores the findings', async () => {
    const r = await call(t, 'POST', '/recon/run', { cookie: omn, body: {} });
    expect(r.status).toBe(200);
    expect(r.json.jobs).toBe(1);
    expect(r.json.runs).toBe(1);
    const stored = await rows<{ check_code: string; job_id: string | null; status: string; country: string }>(t, `SELECT check_code, job_id, status, country FROM recon_findings WHERE country = 'OMN' ORDER BY check_code`);
    expect(r.json.findings).toBe(stored.length);
    expect(stored).toContainEqual({ check_code: 'no_runs', job_id: jobId, status: 'open', country: 'OMN' });
    expect(stored).toContainEqual(expect.objectContaining({ check_code: 'unlinked_runs', status: 'open' }));
    // the KSA findings are another country's and were left alone
    expect(await rows(t, `SELECT 1 FROM recon_findings WHERE country = 'KSA' AND status = 'open'`)).toHaveLength(2);
    expect(await rows(t, `SELECT username FROM audit_log WHERE entity_type = 'reconciliation' AND action = 'run'`)).toEqual([{ username: 'sdmOmn' }]);
  });

  it('explains a finding, and a re-run keeps the explanation', async () => {
    const [f] = await rows<{ id: string }>(t, `SELECT id FROM recon_findings WHERE country = 'OMN' AND check_code = 'no_runs'`);
    expect((await call(t, 'PATCH', `/recon/findings/${f.id}`, { cookie: omn, body: { status: 'explained', explanation: 'ok' } })).status).toBe(400);
    // a finding in another country is not found
    expect((await call(t, 'PATCH', `/recon/findings/${f.id}`, { cookie: sdm, body: { status: 'explained', explanation: 'Not mine to explain' } })).status).toBe(404);

    const r = await call(t, 'PATCH', `/recon/findings/${f.id}`, { cookie: omn, body: { status: 'explained', explanation: 'Runs logged on the backup unit' } });
    expect(r.status).toBe(200);
    expect(await rows(t, 'SELECT status, explanation, explained_by FROM recon_findings WHERE id = ?', f.id)).toEqual([{ status: 'explained', explanation: 'Runs logged on the backup unit', explained_by: 'sdmOmn' }]);
    expect(await rows(t, `SELECT username, summary FROM audit_log WHERE entity_type = 'reconciliation' AND action = 'explain' AND entity_id = ?`, f.id)).toEqual([{ username: 'sdmOmn', summary: 'Runs logged on the backup unit' }]);

    await call(t, 'POST', '/recon/run', { cookie: omn, body: {} });
    expect(await rows(t, 'SELECT status FROM recon_findings WHERE id = ?', f.id)).toEqual([{ status: 'explained' }]);

    const one = await call(t, 'GET', `/recon/findings/${f.id}`, { cookie: omn });
    expect(one.status).toBe(200);
    expect(one.json.job.ticket_no).toBe('R-1');
    expect(one.json.label).toMatch(/No WIREGUARD runs/);
  });
});
