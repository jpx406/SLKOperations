import { Hono } from 'hono';
import { canEditField, filterPatch } from '../shared/fieldPolicy';
import type { Job } from '../shared/types';
import type { AppBindings, AuthedUser, Env } from './env';

// Jobs: board, editor, create-on-first-save, autosave patches with per-field rights and a conflict check.

const JOB_SELECT = `
  SELECT j.id, j.country, j.ticket_no, j.drss_no, j.sdm_username, j.status, j.run_details, j.unit_number,
         j.start_date, j.end_date, j.location, j.field, j.rig, j.well, j.conveyance,
         j.arrived_at, j.rig_up_at, j.rig_down_at, j.runs_ok, j.runs_failed, j.max_depth_ft, j.tag_depth_ft,
         j.max_pull_lb, j.jarring_minutes, j.wire_cut_ft, j.npt_hours, j.failure, j.op_hours_override, j.op_hours_auto,
         m.op_hours, m.job_efficiency_pct, m.run_efficiency_pct,
         (SELECT json_group_array(job_type_name) FROM (SELECT job_type_name FROM job_services s WHERE s.job_id = j.id ORDER BY position)) AS services,
         j.created_by, j.updated_by, j.created_at, j.updated_at
  FROM jobs j JOIN job_metrics m ON m.job_id = j.id`;

const inCountries = (alias = 'j') => `${alias}.country IN (SELECT value FROM json_each(?))`;

function toJob(row: Record<string, unknown>): Job {
  return { ...(row as unknown as Job), services: JSON.parse((row.services as string) || '[]') };
}

export async function getJob(env: Env, user: AuthedUser, id: string): Promise<Job | null> {
  const row = await env.DB.prepare(`${JOB_SELECT} WHERE j.id = ? AND j.deleted_at IS NULL AND ${inCountries()}`)
    .bind(id, JSON.stringify(user.countries)).first();
  return row ? toJob(row) : null;
}

const NUMERIC = new Set(['runs_ok', 'runs_failed', 'max_depth_ft', 'tag_depth_ft', 'max_pull_lb', 'jarring_minutes', 'wire_cut_ft', 'npt_hours', 'op_hours_override']);
const DATE = new Set(['start_date', 'end_date']);
const DATETIME = new Set(['arrived_at', 'rig_up_at', 'rig_down_at']);

/** Normalises values and checks references. Returns an error message or null. */
async function clean(env: Env, patch: Record<string, unknown>, country: string): Promise<string | null> {
  for (const [k, v] of Object.entries(patch)) {
    if (v === '' || v === undefined) { patch[k] = k === 'npt_hours' ? 0 : null; continue; }
    if (v === null) { if (k === 'npt_hours') patch[k] = 0; continue; }
    if (NUMERIC.has(k)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return `${k} must be a number of 0 or more`;
      patch[k] = n;
    } else if (DATE.has(k)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return `${k} must be a date (YYYY-MM-DD)`;
    } else if (DATETIME.has(k)) {
      const t = Date.parse(String(v));
      if (!Number.isFinite(t)) return `${k} must be a date and time`;
      patch[k] = new Date(t).toISOString();
    } else if (k === 'status' && !['planned', 'ongoing', 'completed', 'canceled'].includes(String(v))) {
      return 'Unknown status';
    } else if (k === 'failure' && !['yes', 'no', 'na', 'other'].includes(String(v))) {
      return 'Unknown failure value';
    } else if (typeof v === 'string') {
      patch[k] = v.trim().slice(0, 500);
    }
  }
  if (typeof patch.unit_number === 'string') {
    const unit = await env.DB.prepare('SELECT country FROM wg_units WHERE unit_number = ? AND wg_active = 1').bind(patch.unit_number).first<{ country: string }>();
    if (!unit) return 'That unit is not in WIREGUARD';
    if (unit.country !== country) return `Unit ${patch.unit_number} belongs to ${unit.country}, this job to ${country}`;
  }
  if (typeof patch.sdm_username === 'string') {
    const sdm = await env.DB.prepare(`SELECT 1 FROM user_roles WHERE username = ? AND role IN ('sdm','deputy_sdm','operations_manager','admin')`).bind(patch.sdm_username).first();
    if (!sdm) return 'Pick an SDM from the list';
  }
  return null;
}

function updateStatement(env: Env, id: string, patch: Record<string, unknown>, username: string, at: string) {
  const cols = Object.keys(patch);
  const set = cols.map((c, i) => `${c} = ?${i + 1}`).join(', ');
  const n = cols.length;
  return env.DB.prepare(`UPDATE jobs SET ${set}, updated_by = ?${n + 1}, updated_at = ?${n + 2} WHERE id = ?${n + 3}`)
    .bind(...cols.map((c) => patch[c]), username, at, id);
}

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'job', id, summary.slice(0, 1000));

/** Turns a D1 constraint error into a sentence a person can act on. */
function constraintMessage(e: unknown): string | null {
  const m = (e as Error).message ?? '';
  if (m.includes('jobs_ticket_unique') || m.includes('jobs.country, jobs.ticket_no')) return 'Another job already uses this ticket number';
  if (m.includes('end_date >= start_date')) return 'The end date is before the start date';
  if (m.includes('julianday(rig_down_at) > julianday(rig_up_at)')) return 'Rig-down must be after rig-up';
  if (m.includes('failure_description IS NULL')) return 'Failure details need NPT hours or Failure = Yes first';
  if (m.includes('CHECK constraint failed')) return 'One of the values is not allowed';
  return null;
}

export const jobs = new Hono<AppBindings>();

jobs.get('/', async (c) => {
  const user = c.get('user');
  const q = (c.req.query('q') ?? '').trim();
  const status = c.req.query('status');
  const where = [`j.deleted_at IS NULL`, inCountries()];
  const binds: unknown[] = [JSON.stringify(user.countries)];
  if (status && status !== 'all') { where.push('j.status = ?'); binds.push(status); }
  if (q) {
    where.push('(j.ticket_no LIKE ? OR j.well LIKE ? OR j.rig LIKE ? OR j.sdm_username LIKE ? OR j.unit_number LIKE ?)');
    const like = `%${q.replace(/[%_]/g, '')}%`;
    binds.push(like, like, like, like, like);
  }
  const { results } = await c.env.DB.prepare(`${JOB_SELECT} WHERE ${where.join(' AND ')} ORDER BY coalesce(j.start_date, '9999') DESC, j.created_at DESC LIMIT 500`)
    .bind(...binds).all();
  return c.json(results.map(toJob));
});

jobs.get('/:id', async (c) => {
  const job = await getJob(c.env, c.get('user'), c.req.param('id'));
  return job ? c.json(job) : c.json({ error: 'Job not found' }, 404);
});

// Create on first save: the client calls this with the first real value typed, never on a bare click.
jobs.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ patch?: Record<string, unknown>; country?: string }>().catch(() => ({} as { patch?: Record<string, unknown>; country?: string }));
  const { allowed, dropped } = filterPatch(user.role, body.patch ?? {});
  if (!Object.keys(allowed).length) return c.json({ error: 'Nothing to save yet', ignored: dropped }, 400);

  let country = body.country ?? null;
  if (!country && typeof allowed.unit_number === 'string') {
    country = (await c.env.DB.prepare('SELECT country FROM wg_units WHERE unit_number = ?').bind(allowed.unit_number).first<{ country: string }>())?.country ?? null;
  }
  if (!country && user.countries.length === 1) country = user.countries[0];
  if (!country) return c.json({ error: 'Choose the unit or the country first' }, 400);
  if (!user.countries.includes(country)) return c.json({ error: 'You cannot create jobs for that country' }, 403);

  const err = await clean(c.env, allowed, country);
  if (err) return c.json({ error: err }, 400);

  const id = crypto.randomUUID();
  const at = new Date().toISOString();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO jobs (id, country, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, country, user.username, user.username, at, at),
      updateStatement(c.env, id, allowed, user.username, at),
      audit(c.env, user, 'create', id, `Created job: ${JSON.stringify(allowed)}`),
    ]);
  } catch (e) {
    return c.json({ error: constraintMessage(e) ?? 'Could not save the job' }, 400);
  }
  return c.json({ job: await getJob(c.env, user, id), ignored: dropped }, 201);
});

jobs.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json<{ patch?: Record<string, unknown>; expectedUpdatedAt?: string }>().catch(() => ({} as { patch?: Record<string, unknown>; expectedUpdatedAt?: string }));
  const current = await getJob(c.env, user, id);
  if (!current) return c.json({ error: 'Job not found' }, 404);
  if (body.expectedUpdatedAt && body.expectedUpdatedAt !== current.updated_at) {
    return c.json({ error: `Changed by ${current.updated_by ?? 'someone else'} since you opened it`, job: current }, 409);
  }
  const { allowed, dropped } = filterPatch(user.role, body.patch ?? {});
  if (!Object.keys(allowed).length) return c.json({ job: current, ignored: dropped });
  const err = await clean(c.env, allowed, current.country);
  if (err) return c.json({ error: err }, 400);

  const at = new Date().toISOString();
  const changes = Object.keys(allowed).filter((k) => (current as unknown as Record<string, unknown>)[k] !== allowed[k]);
  try {
    await c.env.DB.batch([
      updateStatement(c.env, id, allowed, user.username, at),
      audit(c.env, user, 'edit', id, changes.map((k) => `${k}: ${String((current as unknown as Record<string, unknown>)[k])} → ${String(allowed[k])}`).join('; ')),
    ]);
  } catch (e) {
    return c.json({ error: constraintMessage(e) ?? 'Could not save the change' }, 400);
  }
  return c.json({ job: await getJob(c.env, user, id), ignored: dropped });
});

jobs.put('/:id/services', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!canEditField(user.role, 'run_details')) return c.json({ error: 'Your role cannot change services' }, 403);
  const job = await getJob(c.env, user, id);
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const { services } = await c.req.json<{ services: string[] }>().catch(() => ({ services: [] as string[] }));
  const list = [...new Set((services ?? []).map((s) => String(s)))].slice(0, 15);
  if (list.length) {
    const { results } = await c.env.DB.prepare(
      `SELECT name FROM wg_job_types WHERE country = ? AND wg_active = 1 AND name IN (SELECT value FROM json_each(?))`,
    ).bind(job.country, JSON.stringify(list)).all<{ name: string }>();
    const known = new Set(results.map((r) => r.name));
    const unknown = list.filter((s) => !known.has(s));
    if (unknown.length) return c.json({ error: `Not a WIREGUARD job type: ${unknown.join(', ')}` }, 400);
  }
  const at = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM job_services WHERE job_id = ?').bind(id),
    ...list.map((s, i) => c.env.DB.prepare('INSERT INTO job_services (id, job_id, position, job_type_name) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), id, i + 1, s)),
    c.env.DB.prepare('UPDATE jobs SET updated_by = ?, updated_at = ? WHERE id = ?').bind(user.username, at, id),
    audit(c.env, user, 'edit', id, `services: ${list.join(', ') || '(none)'}`),
  ]);
  return c.json({ job: await getJob(c.env, user, id) });
});

jobs.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const job = await getJob(c.env, user, id);
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const at = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE jobs SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(at, user.username, at, id),
    audit(c.env, user, 'delete', id, `Deleted job ${job.ticket_no ?? '(no ticket)'}`),
  ]);
  return c.json({ ok: true });
});
