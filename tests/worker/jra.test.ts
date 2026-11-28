import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addJob, call, rows, signIn, startApp, type TestApp } from './helpers';

// JRA (src/worker/jra.ts): answer, send to an eligible approver, and a second person decides.
let t: TestApp;
let sup: string, sdmA: string, om: string, sdmB: string;

/** Answers every question on the safe side, so the score is 0 and the level is "SDM". */
async function answerAll(cookie: string, jobId: string) {
  const g = await call(t, 'GET', `/jra/${jobId}`, { cookie });
  expect(g.status).toBe(200);
  const answers = Object.fromEntries((g.json.template.questions as { id: string; risk_if: 'yes' | 'no' }[]).map((q) => [q.id, q.risk_if === 'yes' ? 'no' : 'yes']));
  const r = await call(t, 'PUT', `/jra/${jobId}`, { cookie, body: { answers } });
  expect(r.status).toBe(200);
  expect(r.json.approval_level).toBe('SDM');
  expect(r.json.progress.missing).toEqual([]);
}

beforeAll(async () => {
  t = await startApp();
  sup = await signIn(t, 'sup1', { role: 'slickline_supervisor', fullName: 'Sue Supervisor' });
  sdmA = await signIn(t, 'sdmA', { role: 'sdm', fullName: 'Ada SDM' });
  sdmB = await signIn(t, 'sdmB', { role: 'sdm', fullName: 'Ben SDM' });
  om = await signIn(t, 'om1', { role: 'operations_manager', fullName: 'Olga Ops' });
  await signIn(t, 'admin1', { role: 'admin', fullName: 'Al Admin' });
  // eligible by role but in another country, and switched off: both left out
  await signIn(t, 'sdmUAE', { role: 'sdm', countries: ['UAE'] });
  await signIn(t, 'sdmOff', { role: 'sdm', active: false });
});
afterAll(async () => {
  expect(t.wgCalls).toEqual([]);
  await t.dispose();
});

describe('JRA approvals', () => {
  it('lists the eligible approvers in the job’s country and leaves out the caller', async () => {
    const job = await addJob(t, { ticket_no: 'J-1' });
    const r = await call(t, 'GET', `/jra/${job}/approvers`, { cookie: sdmA });
    expect(r.status).toBe(200);
    expect(r.json.level).toBe('SDM');
    const names = (r.json.people as { username: string }[]).map((p) => p.username).sort();
    expect(names).toEqual(['admin1', 'sdmB']);

    const asSup = await call(t, 'GET', `/jra/${job}/approvers`, { cookie: sup });
    expect((asSup.json.people as { username: string }[]).map((p) => p.username).sort()).toEqual(['admin1', 'sdmA', 'sdmB']);
  });

  it('refuses sending to yourself, or to someone who does not approve this level', async () => {
    const job = await addJob(t, { ticket_no: 'J-2' });
    await answerAll(sdmA, job);
    const self = await call(t, 'POST', `/jra/${job}/send`, { cookie: sdmA, body: { to: 'sdmA' } });
    expect(self.status).toBe(400);
    expect(self.json.error).toMatch(/someone else/);
    const notEligible = await call(t, 'POST', `/jra/${job}/send`, { cookie: sdmA, body: { to: 'sup1' } });
    expect(notEligible.status).toBe(400);
    const otherCountry = await call(t, 'POST', `/jra/${job}/send`, { cookie: sdmA, body: { to: 'sdmUAE' } });
    expect(otherCountry.status).toBe(400);
    const row = await rows<{ status: string; sent_to: string | null }>(t, 'SELECT status, sent_to FROM jras WHERE job_id = ?', job);
    expect(row).toEqual([{ status: 'draft', sent_to: null }]);
  });

  it('the sender cannot decide, even with a role that approves any JRA; the named approver can', async () => {
    const job = await addJob(t, { ticket_no: 'J-3' });
    await answerAll(om, job);
    const sent = await call(t, 'POST', `/jra/${job}/send`, { cookie: om, body: { to: 'sdmB' } });
    expect(sent.status).toBe(200);
    expect(await rows(t, 'SELECT status, sent_to, sent_by FROM jras WHERE job_id = ?', job)).toEqual([{ status: 'sent', sent_to: 'sdmB', sent_by: 'om1' }]);

    const bySender = await call(t, 'POST', `/jra/${job}/decide`, { cookie: om, body: { decision: 'approved' } });
    expect(bySender.status).toBe(403);
    expect(bySender.json.error).toMatch(/You sent this JRA/);

    // another SDM who was not named and has no "approve any JRA" right
    const byOther = await call(t, 'POST', `/jra/${job}/decide`, { cookie: sdmA, body: { decision: 'approved' } });
    expect(byOther.status).toBe(403);

    // answers are locked while it waits
    expect((await call(t, 'PUT', `/jra/${job}`, { cookie: om, body: { answers: {} } })).status).toBe(409);

    const ok = await call(t, 'POST', `/jra/${job}/decide`, { cookie: sdmB, body: { decision: 'approved', note: 'Fine' } });
    expect(ok.status).toBe(200);
    expect(await rows(t, 'SELECT status, decided_by FROM jras WHERE job_id = ?', job)).toEqual([{ status: 'approved', decided_by: 'sdmB' }]);
    expect(await rows(t, `SELECT username FROM signatures WHERE entity_type = 'jra' AND entity_id = ?`, job)).toEqual([{ username: 'sdmB' }]);
    const log = await rows<{ action: string; username: string }>(t, `SELECT action, username FROM audit_log WHERE entity_type = 'jra' ORDER BY rowid`);
    expect(log.map((l) => `${l.action}:${l.username}`)).toEqual(['send:om1', 'approve:sdmB']);
    // the approved PDF is filed with the job (R2 is available in tests)
    expect(ok.json.pdf).toMatch(/\.pdf$/);
  });

  it('a role allowed to approve any JRA can decide one sent to someone else', async () => {
    const job = await addJob(t, { ticket_no: 'J-4' });
    await answerAll(sup, job);
    expect((await call(t, 'POST', `/jra/${job}/send`, { cookie: sup, body: { to: 'sdmA' } })).status).toBe(200);
    const r = await call(t, 'POST', `/jra/${job}/decide`, { cookie: om, body: { decision: 'rejected', note: 'Redo the permits' } });
    expect(r.status).toBe(200);
    expect(await rows(t, 'SELECT status, sent_to, decided_by FROM jras WHERE job_id = ?', job)).toEqual([{ status: 'draft', sent_to: null, decided_by: 'om1' }]);
  });
});
