import { Hono, type Context } from 'hono';
import { FAILURE_GATED, SERVICE_GATED, canEditField, filterPatch } from '../shared/fieldPolicy';
import { FAILURE_FOLLOW_UP, STAGE_FIELDS } from '../shared/stages';
import { parseToolstring, toolTotals } from '../shared/toolstring';
import type { Job } from '../shared/types';
import type { AppBindings, AuthedUser, Env } from './env';

// Jobs: board, editor, create-on-first-save, autosave patches with per-field rights and a conflict check.

// D1 returns at most 100 columns per row and jobs has close to that, so a full job is read in two statements
// (the row, then metrics and services) and the board selects only the columns it shows.
// New job fields beyond ~100 columns must go in a side table.
const METRICS = `m.op_hours, m.job_efficiency_pct, m.run_efficiency_pct,
  (SELECT json_group_array(job_type_name) FROM (SELECT job_type_name FROM job_services s WHERE s.job_id = m.job_id ORDER BY position)) AS services`;
const BOARD_COLUMNS = [...new Set(['id', 'country', 'npt_hours', 'updated_at', ...Object.values(STAGE_FIELDS).flat(), ...FAILURE_FOLLOW_UP])]
  .map((c) => `j.${c}`).join(', ');

const inCountries = (alias = 'j') => `${alias}.country IN (SELECT value FROM json_each(?))`;
const JSON_COLUMNS = ['toolstring', 'survey_details', 'fishing_details', 'perforation_details'];

function toJob(row: Record<string, unknown>): Job {
  const out: Record<string, unknown> = { ...row, services: JSON.parse((row.services as string) || '[]') };
  for (const k of JSON_COLUMNS) if (k in row) out[k] = JSON.parse((row[k] as string) || (k === 'toolstring' ? '[]' : '{}'));
  return out as unknown as Job;
}

export async function getJob(env: Env, user: AuthedUser, id: string): Promise<Job | null> {
  const [row, extra] = await env.DB.batch([
    env.DB.prepare(`SELECT j.* FROM jobs j WHERE j.id = ? AND j.deleted_at IS NULL AND ${inCountries()}`).bind(id, JSON.stringify(user.countries)),
    env.DB.prepare(`SELECT ${METRICS} FROM job_metrics m WHERE m.job_id = ?`).bind(id),
  ]);
  const r = row.results[0] as Record<string, unknown> | undefined;
  return r ? toJob({ ...r, ...(extra.results[0] as Record<string, unknown>) }) : null;
}

const NUMERIC = new Set([
  'runs_ok', 'runs_failed', 'max_depth_ft', 'tag_depth_ft', 'max_pull_lb', 'max_overpull_lb', 'jarring_minutes', 'wire_cut_ft', 'npt_hours',
  'op_hours_override', 'h2s_ppm', 'co2_pct', 'bht_f', 'bhp_psi', 'siwhp_psi', 'fluid_weight_pcf', 'solids_pct', 'target_depth_ft',
  'top_interval_ft', 'sssv_depth_ft', 'min_restriction_in', 'max_inclination_deg', 'target_casing_weight_lbft', 'pressure_rating_psi',
  'lubricator_length_ft',
]);
const INTEGER = new Set(['runs_ok', 'runs_failed', 'pressure_rating_psi', 'revenue_cents']);
const DATE = new Set(['start_date', 'end_date', 'report_closure_date']);
const DATETIME = new Set(['arrived_at', 'rig_up_at', 'rig_down_at']);
const YESNO = new Set(['failure', 'third_party_required', 'special_setup', 'job_log_signed', 'ticket_signed', 'eight_min_facts_done',
  'prelim_report', 'final_report', 'wellsite_audit', 'wg_runs_logged', 'service_order']);
const LABEL: Record<string, string> = { revenue_cents: 'Revenue', max_inclination_deg: 'Max inclination', pressure_rating_psi: 'Pressure rating' };
const label = (k: string) => LABEL[k] ?? k.replace(/_/g, ' ');

/** Normalises values and checks references. Returns an error message or null. */
async function clean(env: Env, patch: Record<string, unknown>, country: string): Promise<string | null> {
  for (const [k, v] of Object.entries(patch)) {
    if (JSON_COLUMNS.includes(k)) {
      if (k === 'toolstring') {
        const parsed = parseToolstring(v ?? []);
        if ('error' in parsed) return parsed.error;
        const t = toolTotals(parsed.parts);
        patch.toolstring = JSON.stringify(parsed.parts);
        // derived, so the board, checks and reports read one number
        patch.toolstring_length_ft = t.length_ft;
        patch.stem_weight_lb = t.stem_weight_lb;
        patch.max_tool_od_in = t.max_od_in;
      } else {
        if (v !== null && (typeof v !== 'object' || Array.isArray(v))) return `${label(k)} must be a set of values`;
        const s = JSON.stringify(v ?? {});
        if (s.length > 4000) return `${label(k)} is too long`;
        patch[k] = s;
      }
      continue;
    }
    if (v === '' || v === undefined) { patch[k] = k === 'npt_hours' ? 0 : null; continue; }
    if (v === null) { if (k === 'npt_hours') patch[k] = 0; continue; }
    if (k === 'program_in_place') {
      patch[k] = v === true || v === 'yes' || v === 1 || v === '1' ? 1 : 0;
    } else if (k === 'revenue_cents') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) return 'Revenue must be an amount of 0 or more';
      patch[k] = n;
    } else if (NUMERIC.has(k)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return `${label(k)} must be a number of 0 or more`;
      if (INTEGER.has(k) && !Number.isInteger(n)) return `${label(k)} must be a whole number`;
      patch[k] = n;
    } else if (YESNO.has(k)) {
      if (!['yes', 'no', 'na', 'other'].includes(String(v))) return `Choose yes, no or N/A for ${label(k)}`;
    } else if (k === 'report_closure_status' && !['open', 'pending_review', 'closed', 'na'].includes(String(v))) {
      return 'Unknown report status';
    } else if (DATE.has(k)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return `${k} must be a date (YYYY-MM-DD)`;
    } else if (DATETIME.has(k)) {
      const t = Date.parse(String(v));
      if (!Number.isFinite(t)) return `${k} must be a date and time`;
      patch[k] = new Date(t).toISOString();
    } else if (k === 'status' && !['planned', 'ongoing', 'completed', 'canceled'].includes(String(v))) {
      return 'Unknown status';
    } else if (k === 'job_package_url' && !/^(https?:\/\/|\\\\|[a-z]:\\)/i.test(String(v).trim())) {
      return 'The job package link must be a web address or a network path';
    } else if (typeof v === 'string') {
      patch[k] = v.trim().slice(0, k === 'completion_details' || k === 'run_details' || k === 'failure_description' ? 4000 : 500);
    }
  }
  if (typeof patch.wire_serial_number === 'string') {
    const w = await env.DB.prepare('SELECT country, status FROM wg_wires WHERE wire_serial_number = ? AND wg_active = 1').bind(patch.wire_serial_number).first<{ country: string | null; status: string | null }>();
    if (!w) return 'That wire is not in WIREGUARD';
    if (w.country && w.country !== country) return `Wire ${patch.wire_serial_number} belongs to ${w.country}`;
    if (w.status && !/active/i.test(w.status)) return `Wire ${patch.wire_serial_number} is ${w.status.toLowerCase()} in WIREGUARD`;
  }
  if (typeof patch.drum_no === 'string') {
    const d = await env.DB.prepare('SELECT 1 FROM wg_drums WHERE drum_no = ? AND wg_active = 1').bind(patch.drum_no).first();
    if (!d) return 'That drum is not in WIREGUARD';
  }
  for (const [k, table] of [['pce_id', 'pce'], ['grease_panel_id', 'grease_panels']] as const) {
    if (typeof patch[k] === 'string') {
      const r = await env.DB.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND country = ? AND active = 1`).bind(patch[k], country).first();
      if (!r) return `Pick ${k === 'pce_id' ? 'pressure control' : 'a grease panel'} from the list`;
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

/** Unit blocks that stop a booking (User Manual 3.1: a unit under maintenance can't be booked over). */
const BLOCKING = ['maintenance', 'loan', 'transferred', 'junk'] as const;
const BLOCK_WORD: Record<string, string> = { maintenance: 'in maintenance', loan: 'on loan', transferred: 'transferred', junk: 'junked' };

export async function blockConflict(env: Env, unit: string | null, start: string | null, end: string | null): Promise<string | null> {
  if (!unit || !start) return null;
  const hit = await env.DB.prepare(
    `SELECT kind, starts_on, ends_on FROM unit_events
     WHERE unit_number = ?1 AND starts_on <= ?3 AND ends_on >= ?2 AND kind IN (SELECT value FROM json_each(?4)) ORDER BY starts_on LIMIT 1`,
  ).bind(unit, start, end ?? start, JSON.stringify(BLOCKING)).first<{ kind: string; starts_on: string; ends_on: string }>();
  return hit ? `Unit ${unit} is ${BLOCK_WORD[hit.kind]} from ${hit.starts_on} to ${hit.ends_on}` : null;
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
  const { results } = await c.env.DB.prepare(`SELECT ${BOARD_COLUMNS}, ${METRICS} FROM jobs j JOIN job_metrics m ON m.job_id = j.id WHERE ${where.join(' AND ')} ORDER BY coalesce(j.start_date, '9999') DESC, j.created_at DESC LIMIT 500`)
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

  // a new job has no services and no NPT yet, so the gated sections can't be filled on creation
  const early = [...Object.keys(SERVICE_GATED), ...FAILURE_GATED].find((k) => k in allowed && allowed[k] !== null && allowed[k] !== '');
  if (early) return c.json({ error: 'Save the job and add its services first' }, 400);
  const err = await clean(c.env, allowed, country)
    ?? await blockConflict(c.env, (allowed.unit_number as string) ?? null, (allowed.start_date as string) ?? null, (allowed.end_date as string) ?? null);
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

/**
 * Fields that only open in some situations, enforced here as well as greyed out on screen:
 * service sections need a matching service, failure follow-up needs NPT or Failure = Yes.
 */
async function gateCheck(env: Env, current: Job, patch: Record<string, unknown>): Promise<string | null> {
  const setting = (k: string) => k in patch && patch[k] !== null && patch[k] !== '' &&
    !(JSON_COLUMNS.includes(k) && (patch[k] === undefined || (typeof patch[k] === 'object' && !Object.keys(patch[k] as object).length)));
  const gated = Object.keys(SERVICE_GATED).filter(setting);
  if (gated.length) {
    const { results } = await env.DB.prepare(
      `SELECT p.is_plug, p.is_fishing, p.is_memory, p.is_perforation FROM job_services s JOIN service_profiles p ON p.job_type_name = s.job_type_name WHERE s.job_id = ?`,
    ).bind(current.id).all<Record<string, number>>();
    for (const k of gated) {
      const flag = SERVICE_GATED[k];
      if (!results.some((r) => r[flag])) return `${k.replace(/_/g, ' ')} opens when the job has a service that needs it`;
    }
  }
  const failureOpen = (('failure' in patch ? patch.failure : current.failure) === 'yes') || Number('npt_hours' in patch ? patch.npt_hours : current.npt_hours) > 0;
  const fail = FAILURE_GATED.filter(setting);
  if (fail.length && !failureOpen) return 'Failure follow-up opens when the job has NPT hours or Failure = Yes';
  return null;
}

/** One path for every change to a job: field rights, conflict check, value checks, blocked days, audit. */
async function applyPatch(c: Context<AppBindings>, id: string, raw: Record<string, unknown>, expectedUpdatedAt: string | undefined, strict: boolean) {
  const user = c.get('user');
  const current = await getJob(c.env, user, id);
  if (!current) return c.json({ error: 'Job not found' }, 404);
  if (expectedUpdatedAt && expectedUpdatedAt !== current.updated_at) {
    return c.json({ error: `Changed by ${current.updated_by ?? 'someone else'} since you opened it`, job: current }, 409);
  }
  const { allowed, dropped } = filterPatch(user.role, raw);
  // a schedule move is all-or-nothing: moving the dates but not the unit would put the job somewhere nobody chose
  if (strict && dropped.length) return c.json({ error: `Your role cannot change ${dropped.join(', ')}`, job: current }, 403);
  if (!Object.keys(allowed).length) return c.json({ job: current, ignored: dropped });
  const gate = await gateCheck(c.env, current, allowed);
  if (gate) return c.json({ error: gate, job: current }, 400);
  const err = await clean(c.env, allowed, current.country);
  if (err) return c.json({ error: err, job: current }, 400);
  if ('unit_number' in allowed || 'start_date' in allowed || 'end_date' in allowed) {
    const unit = ('unit_number' in allowed ? allowed.unit_number : current.unit_number) as string | null;
    const start = ('start_date' in allowed ? allowed.start_date : current.start_date) as string | null;
    const end = ('end_date' in allowed ? allowed.end_date : current.end_date) as string | null;
    const blocked = await blockConflict(c.env, unit, start, end);
    if (blocked) return c.json({ error: blocked, job: current }, 400);
  }

  const at = new Date().toISOString();
  const changes = Object.keys(allowed).filter((k) => (current as unknown as Record<string, unknown>)[k] !== allowed[k]);
  try {
    await c.env.DB.batch([
      updateStatement(c.env, id, allowed, user.username, at),
      audit(c.env, user, strict ? 'move' : 'edit', id, changes.map((k) => `${k}: ${String((current as unknown as Record<string, unknown>)[k])} → ${String(allowed[k])}`).join('; ')),
    ]);
  } catch (e) {
    return c.json({ error: constraintMessage(e) ?? 'Could not save the change', job: current }, 400);
  }
  return c.json({ job: await getJob(c.env, user, id), ignored: dropped });
}

jobs.patch('/:id', async (c) => {
  const body = await c.req.json<{ patch?: Record<string, unknown>; expectedUpdatedAt?: string }>().catch(() => ({} as { patch?: Record<string, unknown>; expectedUpdatedAt?: string }));
  return applyPatch(c, c.req.param('id'), body.patch ?? {}, body.expectedUpdatedAt, false);
});

// Drag on the schedule: new unit and/or dates, duration kept by the client.
jobs.post('/:id/move', async (c) => {
  const body = await c.req.json<{ unit_number?: string; start_date?: string; end_date?: string | null; expectedUpdatedAt?: string }>()
    .catch(() => ({} as { unit_number?: string; start_date?: string; end_date?: string | null; expectedUpdatedAt?: string }));
  const patch: Record<string, unknown> = {};
  for (const k of ['unit_number', 'start_date', 'end_date'] as const) if (body[k] !== undefined) patch[k] = body[k];
  if (!Object.keys(patch).length) return c.json({ error: 'Nothing to move' }, 400);
  return applyPatch(c, c.req.param('id'), patch, body.expectedUpdatedAt, true);
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

const CREW_ROLES = ['slickline_supervisor', 'slickline_operator', 'assistant_operator', 'helper'] as const;
const HEAD_CAP = { supervisors: 3, operators: 6, assistant_operators: 6, helpers: 6 } as const;

jobs.get('/:id/crew', async (c) => {
  const job = await getJob(c.env, c.get('user'), c.req.param('id'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const [head, crew] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT supervisors, operators, assistant_operators, helpers FROM job_headcount WHERE job_id = ?').bind(job.id),
    c.env.DB.prepare(
      `SELECT c.employee_id, c.crew_role, c.slot, e.full_name, e.eid FROM job_crew c JOIN employees e ON e.id = c.employee_id
       WHERE c.job_id = ? ORDER BY c.crew_role, c.slot`,
    ).bind(job.id),
  ]);
  return c.json({ headcount: head.results[0] ?? { supervisors: 0, operators: 0, assistant_operators: 0, helpers: 0 }, crew: crew.results, caps: HEAD_CAP });
});

jobs.put('/:id/headcount', async (c) => {
  const user = c.get('user');
  if (!canEditField(user.role, 'well_type')) return c.json({ error: 'Your role cannot plan the crew' }, 403);
  const job = await getJob(c.env, user, c.req.param('id'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const b = await c.req.json<Record<keyof typeof HEAD_CAP, number>>().catch(() => ({} as Record<keyof typeof HEAD_CAP, number>));
  const v: Record<string, number> = {};
  for (const [k, cap] of Object.entries(HEAD_CAP)) {
    const n = Number(b[k as keyof typeof HEAD_CAP] ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > cap) return c.json({ error: `${k.replace('_', ' ')}: 0 to ${cap} per job` }, 400);
    v[k] = n;
  }
  const at = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO job_headcount (job_id, supervisors, operators, assistant_operators, helpers) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (job_id) DO UPDATE SET supervisors = ?2, operators = ?3, assistant_operators = ?4, helpers = ?5`,
    ).bind(job.id, v.supervisors, v.operators, v.assistant_operators, v.helpers),
    c.env.DB.prepare('UPDATE jobs SET updated_by = ?, updated_at = ? WHERE id = ?').bind(user.username, at, job.id),
    audit(c.env, user, 'edit', job.id, `head count: ${Object.entries(v).map(([k, n]) => `${k} ${n}`).join(', ')}`),
  ]);
  return c.json({ ok: true, job: await getJob(c.env, user, job.id) });
});

jobs.put('/:id/crew', async (c) => {
  const user = c.get('user');
  if (!canEditField(user.role, 'well_type')) return c.json({ error: 'Your role cannot assign the crew' }, 403);
  const job = await getJob(c.env, user, c.req.param('id'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const { crew } = await c.req.json<{ crew: { employee_id: string; crew_role: (typeof CREW_ROLES)[number] }[] }>().catch(() => ({ crew: [] as { employee_id: string; crew_role: (typeof CREW_ROLES)[number] }[] }));
  const list = crew ?? [];
  if (list.some((m) => !CREW_ROLES.includes(m.crew_role))) return c.json({ error: 'Unknown crew role' }, 400);
  if (new Set(list.map((m) => m.employee_id)).size !== list.length) return c.json({ error: 'A person is listed twice' }, 400);
  const caps: Record<string, number> = { slickline_supervisor: 3, slickline_operator: 6, assistant_operator: 6, helper: 6 };
  for (const r of CREW_ROLES) if (list.filter((m) => m.crew_role === r).length > caps[r]) return c.json({ error: `At most ${caps[r]} ${r.replace('_', ' ')}s per job` }, 400);
  if (list.length) {
    const { results } = await c.env.DB.prepare('SELECT id FROM employees WHERE id IN (SELECT value FROM json_each(?)) AND country = ? AND active = 1')
      .bind(JSON.stringify(list.map((m) => m.employee_id)), job.country).all<{ id: string }>();
    if (results.length !== list.length) return c.json({ error: 'Pick people from this country’s active roster' }, 400);
  }
  const slots: Record<string, number> = {};
  const at = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM job_crew WHERE job_id = ?').bind(job.id),
    ...list.map((m) => {
      slots[m.crew_role] = (slots[m.crew_role] ?? 0) + 1;
      return c.env.DB.prepare('INSERT INTO job_crew (id, job_id, employee_id, crew_role, slot) VALUES (?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), job.id, m.employee_id, m.crew_role, slots[m.crew_role]);
    }),
    c.env.DB.prepare('UPDATE jobs SET updated_by = ?, updated_at = ? WHERE id = ?').bind(user.username, at, job.id),
    audit(c.env, user, 'edit', job.id, `crew: ${list.length} people`),
  ]);
  return c.json({ ok: true, job: await getJob(c.env, user, job.id) });
});

/** Drums on the job's unit with the wire spooled on each, its limits and its latest tests (all from WIREGUARD). */
jobs.get('/:id/wire-options', async (c) => {
  const job = await getJob(c.env, c.get('user'), c.req.param('id'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const [drums, tests, settings] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT d.drum_no, d.drum_position, w.wire_serial_number, w.wire_grade, w.wire_size, w.status, w.rated_mbl_lb, w.remaining_length_ft, w.spooled_length_ft
       FROM wg_drums d LEFT JOIN wg_wires w ON w.drum_no = d.drum_no AND w.wg_active = 1
       WHERE d.wg_active = 1 AND d.unit_number = ? ORDER BY d.drum_position, d.drum_no`,
    ).bind(job.unit_number ?? ''),
    c.env.DB.prepare(
      `SELECT wire_serial_number, test_type, result, test_date, approval_status FROM wg_documents
       WHERE wg_active = 1 AND test_type IS NOT NULL AND wire_serial_number IN
         (SELECT w.wire_serial_number FROM wg_wires w JOIN wg_drums d ON d.drum_no = w.drum_no WHERE d.unit_number = ?)
       ORDER BY test_date DESC`,
    ).bind(job.unit_number ?? ''),
    c.env.DB.prepare(`SELECT value FROM wg_settings WHERE key = 'sop-settings'`),
  ]);
  // WIREGUARD's tension-test window, 30 days unless its SOP settings say otherwise
  let tensionDays = 30;
  try {
    const sop = JSON.parse(String((settings.results[0] as { value?: string } | undefined)?.value ?? '[]')) as { key: string; value: number }[];
    tensionDays = Number(sop.find((s) => s.key === 'pre_job_test_days')?.value ?? 30) || 30;
  } catch { /* keep the default */ }
  return c.json({ unit: job.unit_number, drums: drums.results, tests: tests.results, tensionDays });
});

jobs.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const job = await getJob(c.env, user, id);
  if (!job) return c.json({ error: 'Job not found' }, 404);
  // Admin Manual 8.1: a job keeps its Pre-Job Note's audit trail, so it can't go while a note exists
  const note = await c.env.DB.prepare('SELECT log_no FROM pre_job_notes WHERE job_id = ?').bind(id).first<{ log_no: string }>();
  if (note) {
    return c.json({
      error: user.role === 'admin'
        ? `This job has Pre-Job Note ${note.log_no}. Delete the note first (Pre-Job Notes), then the job.`
        : `This job has Pre-Job Note ${note.log_no}. Only an admin can delete the note, and with it the job.`,
      blockedBy: { preJobNote: note.log_no },
    }, 409);
  }
  const at = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE jobs SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(at, user.username, at, id),
    audit(c.env, user, 'delete', id, `Deleted job ${job.ticket_no ?? '(no ticket)'}`),
  ]);
  return c.json({ ok: true });
});
