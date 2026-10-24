import { Hono } from 'hono';
import { CHECKS, reconcile, type CheckCode, type ReconJob, type ReconRun } from '../shared/recon';
import type { AppBindings, AuthedUser, Env } from './env';

// Reconciliation (S46): SLK Ops jobs vs WIREGUARD runs. Read-only towards WIREGUARD: every action here
// changes SLK Ops records only (manual links, explanations). Fixes to runs are made in WIREGUARD.

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

/** Runs older than this are never reported as unlinked (history from before SLK Ops existed). */
const startDate = (env: Env) => env.RECON_START_DATE || '2026-10-01';

export async function runReconciliation(env: Env, countries: string[], by: string) {
  const c = JSON.stringify(countries);
  const from = startDate(env);
  const [jobsR, servicesR, runsR, linksR, drumsR] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, country, status, ticket_no, drss_no, unit_number, start_date, end_date, well, field, rig, wire_serial_number,
              max_depth_ft, jarring_minutes, wire_cut_ft
       FROM jobs WHERE deleted_at IS NULL AND status <> 'canceled' AND country IN (SELECT value FROM json_each(?1))
         AND (start_date IS NULL OR coalesce(end_date, start_date) >= date(?2, '-1 day'))`,
    ).bind(c, from),
    env.DB.prepare(`SELECT s.job_id, s.job_type_name FROM job_services s JOIN jobs j ON j.id = s.job_id WHERE j.country IN (SELECT value FROM json_each(?)) ORDER BY s.position`).bind(c),
    // runs in the period, plus any run linked by hand whatever its date
    env.DB.prepare(
      `SELECT wg_id, country, job_date, field_ticket, drss_number, drum_no, wire_serial_number, well, field_name, rig, job_name,
              max_depth_ft, jarring_minutes, wire_cut_ft, approval_status
       FROM wg_runs WHERE wg_active = 1 AND is_cut_only = 0 AND country IN (SELECT value FROM json_each(?1))
         AND (job_date >= ?2 OR wg_id IN (SELECT wg_run_id FROM recon_links))`,
    ).bind(c, from),
    env.DB.prepare('SELECT wg_run_id, job_id FROM recon_links'),
    env.DB.prepare('SELECT drum_no, unit_number FROM wg_drums'),
  ]);
  const services = new Map<string, string[]>();
  for (const s of servicesR.results as { job_id: string; job_type_name: string }[]) services.set(s.job_id, [...(services.get(s.job_id) ?? []), s.job_type_name]);
  const jobs = (jobsR.results as Omit<ReconJob, 'services'>[]).map((j) => ({ ...j, services: services.get(j.id) ?? [] }));
  const drumUnit = Object.fromEntries((drumsR.results as { drum_no: string; unit_number: string | null }[]).map((d) => [d.drum_no, d.unit_number]));

  const findings = reconcile({ jobs, runs: runsR.results as unknown as ReconRun[], links: linksR.results as { wg_run_id: string; job_id: string }[], drumUnit, today: today() });
  const at = new Date().toISOString();

  const stmts = findings.map((f) => env.DB.prepare(
    `INSERT INTO recon_findings (id, country, check_code, severity, job_id, wg_run_ids, detail, fingerprint, status, first_seen_at, last_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'open', ?9, ?9)
     ON CONFLICT (fingerprint) DO UPDATE SET severity = ?4, job_id = ?5, wg_run_ids = ?6, detail = ?7, last_seen_at = ?9,
       status = CASE WHEN recon_findings.status = 'resolved' THEN 'open' ELSE recon_findings.status END, resolved_at = NULL`,
  ).bind(crypto.randomUUID(), f.country, f.check, f.severity, f.job_id, JSON.stringify(f.wg_run_ids), JSON.stringify(f.detail), f.fingerprint, at));
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));

  // anything in these countries not seen this time has been fixed
  const resolved = await env.DB.prepare(
    `UPDATE recon_findings SET status = 'resolved', resolved_at = ?1
     WHERE status <> 'resolved' AND country IN (SELECT value FROM json_each(?2))
       AND fingerprint NOT IN (SELECT value FROM json_each(?3))`,
  ).bind(at, c, JSON.stringify(findings.map((f) => f.fingerprint))).run();

  await env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), by, 'run', 'reconciliation', countries.join(','), `${findings.length} findings, ${resolved.meta.changes ?? 0} resolved since last run`).run();
  return { findings: findings.length, resolved: resolved.meta.changes ?? 0, jobs: jobs.length, runs: runsR.results.length, from };
}

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'reconciliation', id, summary.slice(0, 1000));

export const recon = new Hono<AppBindings>();

recon.use('*', async (c, next) => {
  if (!c.get('user').menus.reconciliation?.view) return c.json({ error: 'Your role cannot open Reconciliation' }, 403);
  return next();
});

recon.get('/findings', async (c) => {
  const user = c.get('user');
  const status = c.req.query('status') ?? 'open';
  const where = ['f.country IN (SELECT value FROM json_each(?))'];
  const binds: unknown[] = [JSON.stringify(user.countries)];
  if (status !== 'all') { where.push('f.status = ?'); binds.push(status); }
  for (const [param, col] of [['check', 'f.check_code'], ['severity', 'f.severity'], ['unit', 'j.unit_number'], ['sdm', 'j.sdm_username']] as const) {
    const v = c.req.query(param);
    if (v) { where.push(`${col} = ?`); binds.push(v); }
  }
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.check_code, f.severity, f.status, f.job_id, f.wg_run_ids, f.detail, f.explanation, f.explained_by, f.first_seen_at, f.last_seen_at, f.resolved_at,
            j.ticket_no, j.unit_number, j.start_date, j.end_date, j.well, j.status AS job_status, j.sdm_username
     FROM recon_findings f LEFT JOIN jobs j ON j.id = f.job_id
     WHERE ${where.join(' AND ')}
     ORDER BY CASE f.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END, f.last_seen_at DESC LIMIT 500`,
  ).bind(...binds).all();
  return c.json(results.map((r) => ({ ...r, wg_run_ids: JSON.parse(r.wg_run_ids as string), detail: JSON.parse(r.detail as string) })));
});

recon.get('/findings/:id', async (c) => {
  const user = c.get('user');
  const f = await c.env.DB.prepare('SELECT * FROM recon_findings WHERE id = ? AND country IN (SELECT value FROM json_each(?))')
    .bind(c.req.param('id'), JSON.stringify(user.countries)).first<Record<string, unknown>>();
  if (!f) return c.json({ error: 'Finding not found' }, 404);
  const runIds = JSON.parse(f.wg_run_ids as string) as string[];
  const detail = JSON.parse(f.detail as string) as { candidates?: string[] };
  const [runs, job, candidates] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT r.wg_id, r.job_date, r.field_ticket, r.drss_number, r.drum_no, d.unit_number, r.wire_serial_number, r.well, r.field_name, r.rig,
              r.job_name, r.max_depth_ft, r.jarring_minutes, r.wire_cut_ft, r.approval_status, l.job_id AS linked_job
       FROM wg_runs r LEFT JOIN wg_drums d ON d.drum_no = r.drum_no LEFT JOIN recon_links l ON l.wg_run_id = r.wg_id
       WHERE r.wg_id IN (SELECT value FROM json_each(?)) ORDER BY r.job_date, r.run_number`,
    ).bind(JSON.stringify(runIds)),
    c.env.DB.prepare(`SELECT id, ticket_no, drss_no, unit_number, start_date, end_date, well, field, rig, wire_serial_number, max_depth_ft,
                      jarring_minutes, wire_cut_ft, status FROM jobs WHERE id = ?`).bind(f.job_id ?? ''),
    c.env.DB.prepare(`SELECT id, ticket_no, unit_number, start_date, end_date, well, status FROM jobs WHERE id IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(detail.candidates ?? [])),
  ]);
  return c.json({
    ...f, wg_run_ids: runIds, detail, runs: runs.results, job: job.results[0] ?? null, candidates: candidates.results,
    label: CHECKS[f.check_code as CheckCode]?.label,
  });
});

/** Jobs a set of runs could belong to: same unit, around the same dates (for the link picker). */
recon.get('/candidates', async (c) => {
  const user = c.get('user');
  const runIds = (c.req.query('runs') ?? '').split(',').filter(Boolean);
  const runs = await c.env.DB.prepare(
    `SELECT r.job_date, d.unit_number FROM wg_runs r LEFT JOIN wg_drums d ON d.drum_no = r.drum_no WHERE r.wg_id IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(runIds)).all<{ job_date: string; unit_number: string | null }>();
  const dates = runs.results.map((r) => r.job_date).sort();
  if (!dates.length) return c.json([]);
  const { results } = await c.env.DB.prepare(
    `SELECT id, ticket_no, unit_number, start_date, end_date, well, status FROM jobs
     WHERE deleted_at IS NULL AND country IN (SELECT value FROM json_each(?1))
       AND start_date IS NOT NULL AND start_date <= date(?3, '+7 day') AND coalesce(end_date, start_date) >= date(?2, '-7 day')
     ORDER BY (unit_number IN (SELECT value FROM json_each(?4))) DESC, abs(julianday(start_date) - julianday(?2)) LIMIT 20`,
  ).bind(JSON.stringify(user.countries), dates[0], dates[dates.length - 1], JSON.stringify(runs.results.map((r) => r.unit_number))).all();
  return c.json(results);
});

recon.get('/summary', async (c) => {
  const user = c.get('user');
  const month = c.req.query('month') ?? today().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);
  const cs = JSON.stringify(user.countries);
  const [units, open, last] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT u.unit_number,
         (SELECT count(*) FROM jobs j WHERE j.unit_number = u.unit_number AND j.deleted_at IS NULL AND j.status <> 'canceled' AND substr(j.start_date, 1, 7) = ?1) AS jobs,
         (SELECT count(*) FROM wg_runs r JOIN wg_drums d ON d.drum_no = r.drum_no WHERE d.unit_number = u.unit_number AND r.wg_active = 1 AND r.is_cut_only = 0 AND substr(r.job_date, 1, 7) = ?1) AS runs,
         (SELECT count(*) FROM recon_findings f LEFT JOIN jobs j ON j.id = f.job_id
            WHERE f.status = 'open' AND (j.unit_number = u.unit_number OR (f.job_id IS NULL AND json_extract(f.detail, '$.unit') = u.unit_number))) AS open_findings
       FROM wg_units u WHERE u.wg_active = 1 AND u.country IN (SELECT value FROM json_each(?2)) ORDER BY u.unit_number`,
    ).bind(month, cs),
    c.env.DB.prepare(`SELECT severity, count(*) n FROM recon_findings WHERE status = 'open' AND country IN (SELECT value FROM json_each(?)) GROUP BY severity`).bind(cs),
    c.env.DB.prepare(`SELECT occurred_at, username, summary FROM audit_log WHERE entity_type = 'reconciliation' AND action = 'run' ORDER BY occurred_at DESC LIMIT 1`),
  ]);
  return c.json({
    month, from: startDate(c.env),
    units: (units.results as { jobs: number; runs: number; open_findings: number }[]).filter((u) => u.jobs || u.runs || u.open_findings),
    open: Object.fromEntries((open.results as { severity: string; n: number }[]).map((r) => [r.severity, r.n])),
    lastRun: last.results[0] ?? null,
  });
});

recon.post('/run', async (c) => {
  const user = c.get('user');
  return c.json(await runReconciliation(c.env, user.countries, user.username));
});

recon.patch('/findings/:id', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ status?: 'explained' | 'open'; explanation?: string }>().catch(() => ({} as { status?: 'explained' | 'open'; explanation?: string }));
  const f = await c.env.DB.prepare('SELECT id, status FROM recon_findings WHERE id = ? AND country IN (SELECT value FROM json_each(?))')
    .bind(c.req.param('id'), JSON.stringify(user.countries)).first<{ id: string; status: string }>();
  if (!f) return c.json({ error: 'Finding not found' }, 404);
  if (f.status === 'resolved') return c.json({ error: 'This finding is already resolved' }, 400);
  if (body.status === 'explained') {
    const note = (body.explanation ?? '').trim();
    if (note.length < 5) return c.json({ error: 'Write a short explanation (at least 5 characters)' }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE recon_findings SET status = 'explained', explanation = ?, explained_by = ? WHERE id = ?`).bind(note.slice(0, 1000), user.username, f.id),
      audit(c.env, user, 'explain', f.id, note),
    ]);
  } else if (body.status === 'open') {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE recon_findings SET status = 'open', explanation = NULL, explained_by = NULL WHERE id = ?`).bind(f.id),
      audit(c.env, user, 'reopen', f.id, 'Reopened'),
    ]);
  } else return c.json({ error: 'status must be explained or open' }, 400);
  return c.json({ ok: true });
});

recon.post('/links', async (c) => {
  const user = c.get('user');
  const { wg_run_ids, job_id } = await c.req.json<{ wg_run_ids: string[]; job_id: string }>().catch(() => ({ wg_run_ids: [] as string[], job_id: '' }));
  if (!job_id || !wg_run_ids?.length) return c.json({ error: 'Pick the runs and the job' }, 400);
  const job = await c.env.DB.prepare('SELECT id, country, start_date, end_date FROM jobs WHERE id = ? AND deleted_at IS NULL AND country IN (SELECT value FROM json_each(?))')
    .bind(job_id, JSON.stringify(user.countries)).first<{ id: string; country: string; start_date: string | null; end_date: string | null }>();
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const runs = await c.env.DB.prepare(`SELECT wg_id, country FROM wg_runs WHERE wg_id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(wg_run_ids)).all<{ wg_id: string; country: string | null }>();
  if (runs.results.length !== new Set(wg_run_ids).size) return c.json({ error: 'Some runs are not in the WIREGUARD copy' }, 400);
  if (runs.results.some((r) => r.country !== job.country)) return c.json({ error: 'Runs and job are in different countries' }, 400);
  const at = new Date().toISOString();
  await c.env.DB.batch([
    ...runs.results.map((r) => c.env.DB.prepare(
      `INSERT INTO recon_links (wg_run_id, job_id, linked_by, linked_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (wg_run_id) DO UPDATE SET job_id = ?2, linked_by = ?3, linked_at = ?4`,
    ).bind(r.wg_id, job.id, user.username, at)),
    audit(c.env, user, 'link', job.id, `Linked ${runs.results.length} WIREGUARD run(s): ${wg_run_ids.join(', ')}`),
  ]);
  return c.json({ ok: true, result: await runReconciliation(c.env, user.countries, user.username) });
});

recon.delete('/links/:runId', async (c) => {
  const user = c.get('user');
  const link = await c.env.DB.prepare('SELECT l.wg_run_id, l.job_id FROM recon_links l JOIN jobs j ON j.id = l.job_id WHERE l.wg_run_id = ? AND j.country IN (SELECT value FROM json_each(?))')
    .bind(c.req.param('runId'), JSON.stringify(user.countries)).first<{ wg_run_id: string; job_id: string }>();
  if (!link) return c.json({ error: 'No such link' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM recon_links WHERE wg_run_id = ?').bind(link.wg_run_id),
    audit(c.env, user, 'unlink', link.job_id, `Unlinked WIREGUARD run ${link.wg_run_id}`),
  ]);
  return c.json({ ok: true, result: await runReconciliation(c.env, user.countries, user.username) });
});
