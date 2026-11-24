import { Hono } from 'hono';
import { LOG_OPTION_DEFAULTS, PHRASE_GROUPS, cleanLogOption, type LogOption, type LogOptionKind } from '../shared/jobLogForm';
import { canEditStage } from '../shared/stages';
import type { AppBindings, AuthedUser, Env } from './env';

// The job log's pick lists (6z.53), one set per country: the work description wording (seeded from the owner's
// job log the first time a country opens a log) and the header values a job may not have. Whoever edits the job
// log adds, changes and removes them; removing switches an entry off, logs that used it keep their text.

export const logOptions = new Hono<AppBindings>();

const mayEdit = (u: AuthedUser) => !!u.menus.jobs?.edit && canEditStage(u.menus, 'execution');
const duplicate = (e: unknown) => /UNIQUE constraint failed/.test((e as Error).message ?? '');
const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'job_log_options', id, summary.slice(0, 1000));

/** The types a country starts with in the equipment list; the job log reads memory gauges and pick ups. */
export async function ensureEquipmentTypes(env: Env, country: string) {
  const has = await env.DB.prepare('SELECT 1 FROM equipment_types WHERE country = ? LIMIT 1').bind(country).first();
  if (has) return;
  await env.DB.batch([['Memory gauge', 'memory_gauge', 10], ['Pick up', 'pickup', 20]].map(([name, role, sort]) =>
    env.DB.prepare('INSERT OR IGNORE INTO equipment_types (id, country, name, role, sort) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), country, name, role, sort)));
}

/** A country's lists for the job log: what people added (the wording included) and the usual values beside them. */
export async function logOptionsFor(env: Env, country: string) {
  const seeded = await env.DB.prepare(`SELECT 1 FROM job_log_options WHERE country = ? AND kind = 'phrase' LIMIT 1`).bind(country).first();
  if (!seeded) {
    let sort = 0;
    await env.DB.batch(PHRASE_GROUPS.flatMap((g) => g.phrases.map((p) =>
      env.DB.prepare('INSERT OR IGNORE INTO job_log_options (id, country, kind, grp, value, sort) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), country, 'phrase', g.group, p, (sort += 10)))));
  }
  await ensureEquipmentTypes(env, country);
  const [custom, fields, rigs, jobTypes, locations, units, wellTypes, equipment] = await env.DB.batch([
    env.DB.prepare('SELECT id, kind, grp, value FROM job_log_options WHERE country = ? AND active = 1 ORDER BY kind, sort, value').bind(country),
    env.DB.prepare('SELECT DISTINCT name FROM wg_fields WHERE wg_active = 1 AND country = ? ORDER BY name').bind(country),
    env.DB.prepare('SELECT DISTINCT name FROM wg_rigs WHERE wg_active = 1 AND country = ? ORDER BY name').bind(country),
    env.DB.prepare('SELECT DISTINCT name FROM wg_job_types WHERE wg_active = 1 AND country = ? ORDER BY name').bind(country),
    env.DB.prepare('SELECT DISTINCT name FROM wg_job_locations WHERE wg_active = 1 AND country = ? ORDER BY name').bind(country),
    env.DB.prepare('SELECT unit_number AS name FROM wg_units WHERE wg_active = 1 AND country = ? ORDER BY unit_number').bind(country),
    env.DB.prepare(`SELECT value AS name FROM lookup_values WHERE kind = 'well_type' AND active = 1 AND country = ? ORDER BY sort, value`).bind(country),
    env.DB.prepare(`SELECT t.role, e.serial_no, e.description FROM equipment e JOIN equipment_types t ON t.id = e.type_id
      WHERE e.country = ? AND e.active = 1 AND t.active = 1 AND t.role IS NOT NULL ORDER BY e.serial_no`).bind(country),
  ]);
  const names = (r: D1Result) => (r.results as { name: string }[]).map((x) => x.name);
  const base: Partial<Record<LogOptionKind, string[]>> = {
    ...LOG_OPTION_DEFAULTS, field: names(fields), rig: names(rigs), jobType: names(jobTypes), customer: names(locations), unit: names(units),
    wellType: [...new Set([...names(wellTypes), ...(LOG_OPTION_DEFAULTS.wellType ?? [])])],
  };
  const eq = equipment.results as { role: string; serial_no: string; description: string | null }[];
  const label = (e: { serial_no: string; description: string | null }) => (e.description ? `${e.serial_no} · ${e.description}` : e.serial_no);
  return {
    country, custom: custom.results as unknown as LogOption[], base,
    equipment: { gauges: eq.filter((e) => e.role === 'memory_gauge').map((e) => ({ value: e.serial_no, label: label(e) })), pickups: eq.filter((e) => e.role === 'pickup').map((e) => ({ value: e.serial_no, label: label(e) })) },
  };
}

logOptions.post('/', async (c) => {
  const user = c.get('user');
  if (!mayEdit(user)) return c.json({ error: 'Your role does not edit the job log' }, 403);
  const b = (await c.req.json().catch(() => ({}))) as { country?: unknown; kind?: unknown; grp?: unknown; value?: unknown };
  if (typeof b.country !== 'string' || !user.countries.includes(b.country)) return c.json({ error: 'Pick one of your countries' }, 400);
  const r = cleanLogOption(b.kind, b.grp, b.value);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const old = await c.env.DB.prepare('SELECT id, active FROM job_log_options WHERE country = ? AND kind = ? AND grp = ? AND value = ?').bind(b.country, r.kind, r.grp, r.value).first<{ id: string; active: number }>();
  if (old?.active) return c.json({ error: `${r.value} is already on the list` }, 400);
  const id = old?.id ?? crypto.randomUUID();
  const next = await c.env.DB.prepare('SELECT coalesce(max(sort), 0) + 10 AS s FROM job_log_options WHERE country = ? AND kind = ?').bind(b.country, r.kind).first<{ s: number }>();
  await c.env.DB.batch([
    old ? c.env.DB.prepare('UPDATE job_log_options SET active = 1, sort = ? WHERE id = ?').bind(next?.s ?? 10, id)
      : c.env.DB.prepare('INSERT INTO job_log_options (id, country, kind, grp, value, sort) VALUES (?, ?, ?, ?, ?, ?)').bind(id, b.country, r.kind, r.grp, r.value, next?.s ?? 10),
    audit(c.env, user, 'create', id, `Job log list ${r.kind}: added ${r.value} (${b.country})`),
  ]);
  return c.json({ ok: true, id }, 201);
});

/** Change the text or group, or remove (switch off) an entry. */
logOptions.patch('/:id', async (c) => {
  const user = c.get('user');
  if (!mayEdit(user)) return c.json({ error: 'Your role does not edit the job log' }, 403);
  const row = await c.env.DB.prepare('SELECT id, country, kind, grp, value FROM job_log_options WHERE id = ?').bind(c.req.param('id')).first<{ id: string; country: string; kind: string; grp: string; value: string }>();
  if (!row || !user.countries.includes(row.country)) return c.json({ error: 'Not found' }, 404);
  const b = (await c.req.json().catch(() => ({}))) as { grp?: unknown; value?: unknown; active?: unknown };
  if (b.active === false) {
    await c.env.DB.batch([c.env.DB.prepare('UPDATE job_log_options SET active = 0 WHERE id = ?').bind(row.id), audit(c.env, user, 'delete', row.id, `Job log list ${row.kind}: removed ${row.value}`)]);
    return c.json({ ok: true });
  }
  const r = cleanLogOption(row.kind, b.grp ?? row.grp, b.value ?? row.value);
  if ('error' in r) return c.json({ error: r.error }, 400);
  try {
    await c.env.DB.batch([c.env.DB.prepare('UPDATE job_log_options SET grp = ?, value = ? WHERE id = ?').bind(r.grp, r.value, row.id), audit(c.env, user, 'update', row.id, `Job log list ${row.kind}: ${row.value} → ${r.value}`)]);
  } catch (e) {
    return c.json({ error: duplicate(e) ? `${r.value} is already on the list` : 'Could not save' }, 400);
  }
  return c.json({ ok: true });
});
