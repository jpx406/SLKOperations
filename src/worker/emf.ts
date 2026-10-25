import { Hono } from 'hono';
import { cleanReport, nextLogNo, reportTotals, type ReportInput } from '../shared/emf';
import type { AppBindings, AuthedUser, Env } from './env';
import { getJob } from './jobs';

// 8 Min. Facts (S11, S12). Every save is a new immutable version. Saving also updates the job
// (NPT = sum of its reports' NPT, Failure = Yes, 8MF = Yes) and keeps one Failure Roster row per incident.

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'eight_min_facts', id, summary.slice(0, 1000));

const inC = 'r.country IN (SELECT value FROM json_each(?))';

type ReportRow = Record<string, unknown> & { id: string; job_id: string; log_no: string; current_version: number; status: string; last_saved_by: string | null };

async function loadReport(env: Env, user: AuthedUser, id: string) {
  const r = await env.DB.prepare(
    `SELECT r.*, j.ticket_no, j.unit_number, j.start_date FROM eight_min_facts r JOIN jobs j ON j.id = r.job_id WHERE r.id = ? AND ${inC}`,
  ).bind(id, JSON.stringify(user.countries)).first<ReportRow>();
  if (!r) return null;
  const [inc, versions] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM incidents WHERE report_id = ? ORDER BY position').bind(id),
    env.DB.prepare('SELECT version, saved_by, saved_at FROM eight_min_facts_versions WHERE report_id = ? ORDER BY version DESC').bind(id),
  ]);
  const incidents = (inc.results as (Record<string, unknown> & { id: string })[]).map((i) => ({ ...i, failed_items: JSON.parse(String(i.failed_items ?? '[]')) as string[] }));
  return { ...r, incidents, versions: versions.results };
}

/** Statements that write the incidents of a report: update kept ones in place (so roster action status survives), add new, drop removed. */
function incidentStatements(env: Env, reportId: string, existing: Set<string>, rep: ReportInput) {
  const kept = rep.incidents.map((i) => i.id).filter((id): id is string => !!id && existing.has(id));
  const stmts = [
    // move positions out of the way first, so reordering never trips the (report, position) uniqueness
    env.DB.prepare('UPDATE incidents SET position = -position - 1 WHERE report_id = ?').bind(reportId),
    env.DB.prepare('DELETE FROM incidents WHERE report_id = ? AND id NOT IN (SELECT value FROM json_each(?))').bind(reportId, JSON.stringify(kept)),
  ];
  rep.incidents.forEach((i, n) => {
    const vals = [n + 1, i.what_happened, i.occurred_on, i.occurred_time ?? null, i.npt_hours, JSON.stringify(i.failed_items),
      i.immediate_actions ?? null, i.current_situation ?? null, i.informed_client ?? null, i.informed_nesr ?? null, i.category ?? null];
    if (i.id && existing.has(i.id)) {
      stmts.push(env.DB.prepare(
        `UPDATE incidents SET position = ?, what_happened = ?, occurred_on = ?, occurred_time = ?, npt_hours = ?, failed_items = ?,
           immediate_actions = ?, current_situation = ?, informed_client = ?, informed_nesr = ?, category = ? WHERE id = ? AND report_id = ?`,
      ).bind(...vals, i.id, reportId));
    } else {
      i.id = crypto.randomUUID();
      stmts.push(env.DB.prepare(
        `INSERT INTO incidents (id, report_id, position, what_happened, occurred_on, occurred_time, npt_hours, failed_items,
           immediate_actions, current_situation, informed_client, informed_nesr, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(i.id, reportId, ...vals));
    }
  });
  return stmts;
}

/** The side effects on the job and the roster, run in the same batch after the incidents are written. */
function effectStatements(env: Env, user: AuthedUser, reportId: string, jobId: string, at: string) {
  return [
    env.DB.prepare(
      `UPDATE jobs SET npt_hours = (SELECT coalesce(sum(i.npt_hours), 0) FROM incidents i JOIN eight_min_facts r ON r.id = i.report_id WHERE r.job_id = ?1),
         failure = 'yes', eight_min_facts_done = 'yes', updated_by = ?2, updated_at = ?3 WHERE id = ?1`,
    ).bind(jobId, user.username, at),
    env.DB.prepare(
      `INSERT INTO failure_roster_entries (id, country, job_id, incident_id, occurred_on, well, rilr_refs, category, severity, created_by)
       SELECT lower(hex(randomblob(16))), r.country, r.job_id, i.id, i.occurred_on, r.well,
              CASE WHEN r.rilr_no IS NULL THEN '[]' ELSE json_array(r.rilr_no) END, i.category, i.severity, ?2
       FROM incidents i JOIN eight_min_facts r ON r.id = i.report_id WHERE r.id = ?1
       ON CONFLICT (incident_id) DO UPDATE SET occurred_on = excluded.occurred_on, well = excluded.well, rilr_refs = excluded.rilr_refs,
         category = excluded.category, severity = excluded.severity, job_id = excluded.job_id`,
    ).bind(reportId, user.username),
  ];
}

export const emf = new Hono<AppBindings>();

emf.get('/', async (c) => {
  const status = c.req.query('status');
  const q = (c.req.query('q') ?? '').trim().replace(/[%_]/g, '');
  const where = [inC];
  const binds: unknown[] = [JSON.stringify(c.get('user').countries)];
  if (status === 'saved' || status === 'sent') { where.push('r.status = ?'); binds.push(status); }
  if (q) { where.push('(r.log_no LIKE ? OR r.title LIKE ? OR r.well LIKE ? OR j.ticket_no LIKE ?)'); binds.push(...Array(4).fill(`%${q}%`)); }
  const jobId = c.req.query('job');
  if (jobId) { where.push('r.job_id = ?'); binds.push(jobId); }
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.log_no, r.title, r.well, r.status, r.current_version, r.total_npt, r.severity, r.created_by, r.last_saved_by, r.last_saved_at,
            r.sent_by, r.sent_at, j.id AS job_id, j.ticket_no, (SELECT count(*) FROM incidents i WHERE i.report_id = r.id) AS incidents
     FROM eight_min_facts r JOIN jobs j ON j.id = r.job_id WHERE ${where.join(' AND ')} ORDER BY r.last_saved_at DESC LIMIT 1000`,
  ).bind(...binds).all();
  return c.json(results);
});

emf.get('/:id', async (c) => {
  const r = await loadReport(c.env, c.get('user'), c.req.param('id'));
  return r ? c.json(r) : c.json({ error: 'Report not found' }, 404);
});

emf.get('/:id/versions/:v', async (c) => {
  const r = await loadReport(c.env, c.get('user'), c.req.param('id'));
  if (!r) return c.json({ error: 'Report not found' }, 404);
  const v = await c.env.DB.prepare('SELECT version, snapshot, saved_by, saved_at FROM eight_min_facts_versions WHERE report_id = ? AND version = ?')
    .bind(r.id, Number(c.req.param('v'))).first<{ snapshot: string }>();
  return v ? c.json({ ...v, snapshot: JSON.parse(v.snapshot) }) : c.json({ error: 'Version not found' }, 404);
});

/** Header values copied from the job when the report is saved. */
async function jobHeader(env: Env, user: AuthedUser, jobId: string) {
  const job = await getJob(env, user, jobId);
  if (!job) return null;
  return { job, rig: job.rig, well: job.well };
}

emf.post('/', async (c) => {
  const user = c.get('user');
  const r = cleanReport(await c.req.json().catch(() => null));
  if ('error' in r) return c.json({ error: r.error }, 400);
  const rep = r.report;
  const head = await jobHeader(c.env, user, rep.job_id);
  if (!head) return c.json({ error: 'That job is not in your countries' }, 400);
  const last = await c.env.DB.prepare(`SELECT log_no FROM eight_min_facts WHERE country = ? ORDER BY log_no DESC LIMIT 1`).bind(head.job.country).first<{ log_no: string }>();
  const id = crypto.randomUUID();
  const logNo = nextLogNo(last?.log_no ?? null);
  const at = new Date().toISOString();
  const t = reportTotals(rep.incidents);
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO eight_min_facts (id, country, job_id, log_no, title, rilr_no, rig, well, crew_text, total_npt, severity, created_by, last_saved_by, last_saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, head.job.country, rep.job_id, logNo, rep.title, rep.rilr_no ?? null, head.rig, head.well, rep.crew_text ?? null, t.npt, t.severity, user.username, user.username, at),
    ...incidentStatements(c.env, id, new Set(), rep),
  ];
  stmts.push(
    c.env.DB.prepare('INSERT INTO eight_min_facts_versions (id, report_id, version, snapshot, saved_by, saved_at) VALUES (?, ?, 1, ?, ?, ?)')
      .bind(crypto.randomUUID(), id, JSON.stringify({ ...rep, log_no: logNo, rig: head.rig, well: head.well, total_npt: t.npt, severity: t.severity }), user.username, at),
    ...effectStatements(c.env, user, id, rep.job_id, at),
    audit(c.env, user, 'create', id, `${logNo} on ticket ${head.job.ticket_no ?? '—'}: ${rep.incidents.length} incident(s), ${t.npt} h NPT`),
  );
  try {
    await c.env.DB.batch(stmts);
  } catch (e) {
    if (/UNIQUE constraint failed: eight_min_facts.country, eight_min_facts.log_no/.test((e as Error).message)) return c.json({ error: 'Someone saved a report at the same moment. Save again.' }, 409);
    throw e;
  }
  return c.json({ ok: true, report: await loadReport(c.env, user, id) }, 201);
});

emf.put('/:id', async (c) => {
  const user = c.get('user');
  const cur = await loadReport(c.env, user, c.req.param('id'));
  if (!cur) return c.json({ error: 'Report not found' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (Number(body.expectedVersion) !== cur.current_version) {
    return c.json({ error: `Saved as v${cur.current_version} by ${String(cur.last_saved_by ?? 'someone else')} since you opened it` }, 409);
  }
  const r = cleanReport({ ...body, job_id: cur.job_id });
  if ('error' in r) return c.json({ error: r.error }, 400);
  const rep = r.report;
  const head = await jobHeader(c.env, user, cur.job_id);
  if (!head) return c.json({ error: 'The job is no longer available' }, 400);
  const at = new Date().toISOString();
  const t = reportTotals(rep.incidents);
  const version = cur.current_version + 1;
  const existing = new Set(cur.incidents.map((i) => i.id));
  const wasSent = cur.status === 'sent';
  await c.env.DB.batch([
    // a changed report goes back to Saved: what was sent is no longer what is on file
    c.env.DB.prepare(
      `UPDATE eight_min_facts SET title = ?, rilr_no = ?, rig = ?, well = ?, crew_text = ?, total_npt = ?, severity = ?, status = 'saved',
         current_version = ?, last_saved_by = ?, last_saved_at = ? WHERE id = ? AND current_version = ?`,
    ).bind(rep.title, rep.rilr_no ?? null, head.rig, head.well, rep.crew_text ?? null, t.npt, t.severity, version, user.username, at, cur.id, cur.current_version),
    ...incidentStatements(c.env, cur.id, existing, rep),
    c.env.DB.prepare('INSERT INTO eight_min_facts_versions (id, report_id, version, snapshot, saved_by, saved_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), cur.id, version, JSON.stringify({ ...rep, log_no: cur.log_no, rig: head.rig, well: head.well, total_npt: t.npt, severity: t.severity }), user.username, at),
    ...effectStatements(c.env, user, cur.id, cur.job_id, at),
    audit(c.env, user, 'edit', cur.id, `${String(cur.log_no)} saved as v${version}${wasSent ? ' (after it was sent)' : ''}: ${rep.incidents.length} incident(s), ${t.npt} h NPT`),
  ]);
  return c.json({ ok: true, report: await loadReport(c.env, user, cur.id) });
});

/** Records that the report was sent (the screen opens the mail app with the summary). */
emf.post('/:id/sent', async (c) => {
  const user = c.get('user');
  const cur = await loadReport(c.env, user, c.req.param('id'));
  if (!cur) return c.json({ error: 'Report not found' }, 404);
  const { to } = await c.req.json<{ to?: string }>().catch(() => ({} as { to?: string }));
  const at = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE eight_min_facts SET status = 'sent', sent_by = ?, sent_at = ? WHERE id = ?`).bind(user.username, at, cur.id),
    audit(c.env, user, 'send', cur.id, `${String(cur.log_no)} v${cur.current_version} sent${to ? ` to ${String(to).slice(0, 300)}` : ''}`),
  ]);
  return c.json({ ok: true, report: await loadReport(c.env, user, cur.id) });
});
