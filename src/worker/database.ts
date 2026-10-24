import { Hono, type Context } from 'hono';
import { LIST_KINDS, SERVICE_FLAGS, cleanListValue, cleanPce } from '../shared/database';
import type { AppBindings, AuthedUser, Env } from './env';

// Equipment Database (S24). WIREGUARD units are shown read-only; PCE, grease panels, local lists and
// service profiles are kept here. Nothing is hard-deleted while a job still points at it.

const audit = (env: Env, user: AuthedUser, action: string, entity: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, entity, id, summary.slice(0, 1000));

const OPEN = `j.deleted_at IS NULL AND j.status IN ('planned','ongoing')`;
const inC = 'country IN (SELECT value FROM json_each(?))';

const duplicate = (e: unknown) => /UNIQUE constraint failed/.test((e as Error).message ?? '');

export const database = new Hono<AppBindings>();

database.get('/', async (c) => {
  const countries = JSON.stringify(c.get('user').countries);
  const [units, pce, panels, lists, profiles, domains] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT u.unit_number, u.country, u.year, u.wg_active,
              (SELECT count(*) FROM jobs j WHERE j.unit_number = u.unit_number AND ${OPEN}) AS open_jobs,
              (SELECT group_concat(d.drum_no, ', ') FROM wg_drums d WHERE d.unit_number = u.unit_number AND d.wg_active = 1) AS drums
       FROM wg_units u WHERE u.${inC} ORDER BY u.wg_active DESC, u.unit_number`,
    ).bind(countries),
    c.env.DB.prepare(
      `SELECT p.*, (SELECT count(*) FROM jobs j WHERE j.pce_id = p.id AND ${OPEN}) AS open_jobs,
              (SELECT count(*) FROM jobs j WHERE j.pce_id = p.id) AS all_jobs
       FROM pce p WHERE p.${inC} ORDER BY p.active DESC, p.label`,
    ).bind(countries),
    c.env.DB.prepare(
      `SELECT g.*, (SELECT count(*) FROM jobs j WHERE j.grease_panel_id = g.id AND ${OPEN}) AS open_jobs,
              (SELECT count(*) FROM jobs j WHERE j.grease_panel_id = g.id) AS all_jobs
       FROM grease_panels g WHERE g.${inC} ORDER BY g.active DESC, g.label`,
    ).bind(countries),
    c.env.DB.prepare(`SELECT id, country, kind, value, sort, active FROM lookup_values WHERE ${inC} ORDER BY kind, sort, value`).bind(countries),
    // every WIREGUARD job type in the user's countries, with its profile when one exists
    c.env.DB.prepare(
      `SELECT t.name AS job_type_name, p.domain, coalesce(p.is_plug, 0) AS is_plug, coalesce(p.is_fishing, 0) AS is_fishing,
              coalesce(p.is_memory, 0) AS is_memory, coalesce(p.is_perforation, 0) AS is_perforation, coalesce(p.is_explosive, 0) AS is_explosive,
              p.updated_at
       FROM (SELECT DISTINCT name FROM wg_job_types WHERE wg_active = 1 AND ${inC}) t
       LEFT JOIN service_profiles p ON p.job_type_name = t.name ORDER BY t.name`,
    ).bind(countries),
    c.env.DB.prepare('SELECT name FROM service_domains ORDER BY sort, name'),
  ]);
  return c.json({
    units: units.results, pce: pce.results, greasePanels: panels.results, lists: lists.results,
    serviceProfiles: profiles.results, domains: (domains.results as { name: string }[]).map((d) => d.name),
  });
});

const ownCountry = (user: AuthedUser, country: unknown) => typeof country === 'string' && user.countries.includes(country);

// ---- pressure control equipment ----

database.post('/pce', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (!ownCountry(user, b.country)) return c.json({ error: 'Pick one of your countries' }, 400);
  const r = cleanPce(b, true);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const id = crypto.randomUUID();
  const v: Record<string, unknown> = { rating_psi: null, length_ft: null, last_pressure_test_on: null, is_rental: 0, ...r.values };
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO pce (id, country, label, kind, bore_in, rating_psi, length_ft, last_pressure_test_on, is_rental) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, b.country, v.label, v.kind, v.bore_in, v.rating_psi, v.length_ft, v.last_pressure_test_on, v.is_rental),
      audit(c.env, user, 'create', 'pce', id, `Added ${v.label} (${b.country})`),
    ]);
  } catch (e) {
    return c.json({ error: duplicate(e) ? `${b.country} already has equipment called ${v.label}` : 'Could not save' }, 400);
  }
  return c.json({ ok: true, id }, 201);
});

/** Edits shared by PCE and grease panels: deactivating something open jobs still use asks first (Administrator Manual §4). */
async function editEquipment(c: Context<AppBindings>, table: 'pce' | 'grease_panels', column: 'pce_id' | 'grease_panel_id', values: Record<string, unknown>, confirm: boolean) {
  const user = c.get('user');
  const id = c.req.param('id') ?? '';
  const row = await c.env.DB.prepare(`SELECT id, country, label, active FROM ${table} WHERE id = ?`).bind(id).first<{ country: string; label: string; active: number }>();
  if (!row || !user.countries.includes(row.country)) return c.json({ error: 'Not found' }, 404);
  if (!Object.keys(values).length) return c.json({ error: 'Nothing to change' }, 400);
  if (values.active === 0 && row.active === 1 && !confirm) {
    const n = (await c.env.DB.prepare(`SELECT count(*) AS n FROM jobs j WHERE j.${column} = ? AND ${OPEN}`).bind(id).first<{ n: number }>())?.n ?? 0;
    if (n) return c.json({ error: `${n} open job${n === 1 ? ' still uses' : 's still use'} ${row.label}. They keep it; new jobs can no longer pick it.`, openJobs: n, needsConfirm: true }, 409);
  }
  const cols = Object.keys(values);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE ${table} SET ${cols.map((k, i) => `${k} = ?${i + 1}`).join(', ')} WHERE id = ?${cols.length + 1}`).bind(...cols.map((k) => values[k]), id),
      audit(c.env, user, 'edit', table, id, `${row.label}: ${cols.map((k) => `${k} = ${values[k]}`).join(', ')}`),
    ]);
  } catch (e) {
    return c.json({ error: duplicate(e) ? `${row.country} already has equipment with that label` : 'Could not save' }, 400);
  }
  return c.json({ ok: true });
}

async function removeEquipment(c: Context<AppBindings>, table: 'pce' | 'grease_panels', column: 'pce_id' | 'grease_panel_id') {
  const user = c.get('user');
  const id = c.req.param('id') ?? '';
  const row = await c.env.DB.prepare(`SELECT country, label FROM ${table} WHERE id = ?`).bind(id).first<{ country: string; label: string }>();
  if (!row || !user.countries.includes(row.country)) return c.json({ error: 'Not found' }, 404);
  const n = (await c.env.DB.prepare(`SELECT count(*) AS n FROM jobs WHERE ${column} = ?`).bind(id).first<{ n: number }>())?.n ?? 0;
  if (n) return c.json({ error: `${row.label} is on ${n} job${n === 1 ? '' : 's'}, so it can only be switched off, not removed` }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id),
    audit(c.env, user, 'delete', table, id, `Removed ${row.label} (${row.country})`),
  ]);
  return c.json({ ok: true });
}

database.patch('/pce/:id', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const r = cleanPce(b, false);
  if ('error' in r) return c.json({ error: r.error }, 400);
  return editEquipment(c, 'pce', 'pce_id', r.values, b.confirm === true);
});
database.delete('/pce/:id', (c) => removeEquipment(c, 'pce', 'pce_id'));

// ---- grease panels ----

database.post('/grease-panels', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<{ country?: string; label?: string; panel_type?: string }>().catch(() => ({} as { country?: string; label?: string; panel_type?: string }));
  if (!ownCountry(user, b.country)) return c.json({ error: 'Pick one of your countries' }, 400);
  const label = String(b.label ?? '').trim().slice(0, 60);
  if (!label) return c.json({ error: 'Give the panel a label' }, 400);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO grease_panels (id, country, label, panel_type) VALUES (?, ?, ?, ?)').bind(id, b.country, label, String(b.panel_type ?? '').trim().slice(0, 60) || null),
      audit(c.env, user, 'create', 'grease_panels', id, `Added ${label} (${b.country})`),
    ]);
  } catch (e) {
    return c.json({ error: duplicate(e) ? `${b.country} already has a panel called ${label}` : 'Could not save' }, 400);
  }
  return c.json({ ok: true, id }, 201);
});

database.patch('/grease-panels/:id', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const v: Record<string, unknown> = {};
  if ('label' in b) { v.label = String(b.label ?? '').trim().slice(0, 60); if (!v.label) return c.json({ error: 'Give the panel a label' }, 400); }
  if ('panel_type' in b) v.panel_type = String(b.panel_type ?? '').trim().slice(0, 60) || null;
  if ('active' in b) v.active = b.active === true || b.active === 1 ? 1 : 0;
  return editEquipment(c, 'grease_panels', 'grease_panel_id', v, b.confirm === true);
});
database.delete('/grease-panels/:id', (c) => removeEquipment(c, 'grease_panels', 'grease_panel_id'));

// ---- local lists ----

database.post('/lists', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<{ country?: string; kind?: string; value?: string }>().catch(() => ({} as { country?: string; kind?: string; value?: string }));
  if (!ownCountry(user, b.country)) return c.json({ error: 'Pick one of your countries' }, 400);
  const r = cleanListValue(b.kind, b.value);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const id = crypto.randomUUID();
  const next = await c.env.DB.prepare('SELECT coalesce(max(sort), 0) + 10 AS s FROM lookup_values WHERE country = ? AND kind = ?').bind(b.country, r.kind).first<{ s: number }>();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO lookup_values (id, country, kind, value, sort) VALUES (?, ?, ?, ?, ?)').bind(id, b.country, r.kind, r.value, next?.s ?? 10),
      audit(c.env, user, 'create', 'lookup_values', id, `${LIST_KINDS[r.kind]}: added ${r.value} (${b.country})`),
    ]);
  } catch (e) {
    return c.json({ error: duplicate(e) ? `${r.value} is already on the list` : 'Could not save' }, 400);
  }
  return c.json({ ok: true, id }, 201);
});

// Renaming a value doesn't rewrite jobs that saved the old text; the editor keeps showing a saved value that left the list.
database.patch('/lists/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT country, kind, value, sort FROM lookup_values WHERE id = ?').bind(id).first<{ country: string; kind: string; value: string; sort: number }>();
  if (!row || !user.countries.includes(row.country)) return c.json({ error: 'Not found' }, 404);
  const b = await c.req.json<{ value?: string; active?: boolean; move?: 'up' | 'down' }>().catch(() => ({} as { value?: string; active?: boolean; move?: 'up' | 'down' }));
  const stmts = [];
  if (b.move) {
    // swap with the neighbour so the order stays a clean sequence
    const nb = await c.env.DB.prepare(
      `SELECT id, sort FROM lookup_values WHERE country = ? AND kind = ? AND id <> ? AND sort ${b.move === 'up' ? '<=' : '>='} ? ORDER BY sort ${b.move === 'up' ? 'DESC' : 'ASC'}, value LIMIT 1`,
    ).bind(row.country, row.kind, id, row.sort).first<{ id: string; sort: number }>();
    if (!nb) return c.json({ ok: true });
    const [a, z] = nb.sort === row.sort ? [row.sort + (b.move === 'up' ? 1 : -1), row.sort] : [nb.sort, row.sort];
    stmts.push(c.env.DB.prepare('UPDATE lookup_values SET sort = ? WHERE id = ?').bind(a, id), c.env.DB.prepare('UPDATE lookup_values SET sort = ? WHERE id = ?').bind(z, nb.id));
  }
  if (b.value !== undefined) {
    const r = cleanListValue(row.kind, b.value);
    if ('error' in r) return c.json({ error: r.error }, 400);
    stmts.push(c.env.DB.prepare('UPDATE lookup_values SET value = ? WHERE id = ?').bind(r.value, id));
  }
  if (b.active !== undefined) stmts.push(c.env.DB.prepare('UPDATE lookup_values SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, id));
  if (!stmts.length) return c.json({ error: 'Nothing to change' }, 400);
  try {
    await c.env.DB.batch([...stmts, audit(c.env, user, 'edit', 'lookup_values', id, `${row.kind} ${row.value}: ${JSON.stringify(b)}`)]);
  } catch (e) {
    return c.json({ error: duplicate(e) ? `${b.value} is already on the list` : 'Could not save' }, 400);
  }
  return c.json({ ok: true });
});

// ---- service profiles (which job-editor sections a WIREGUARD job type opens) ----

database.put('/service-profiles', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const name = String(b.job_type_name ?? '');
  const known = await c.env.DB.prepare(`SELECT 1 FROM wg_job_types WHERE name = ? AND wg_active = 1 AND ${inC} LIMIT 1`).bind(name, JSON.stringify(user.countries)).first();
  if (!known) return c.json({ error: 'That job type is not in WIREGUARD for your countries' }, 400);
  const domain = b.domain ? String(b.domain) : null;
  if (domain && !(await c.env.DB.prepare('SELECT 1 FROM service_domains WHERE name = ?').bind(domain).first())) return c.json({ error: 'Unknown service domain' }, 400);
  const flags = SERVICE_FLAGS.map((f) => (b[f] === true || b[f] === 1 ? 1 : 0));
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO service_profiles (job_type_name, domain, is_plug, is_fishing, is_memory, is_perforation, is_explosive, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT (job_type_name) DO UPDATE SET domain = ?2, is_plug = ?3, is_fishing = ?4, is_memory = ?5, is_perforation = ?6, is_explosive = ?7,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).bind(name, domain, ...flags),
    audit(c.env, user, 'edit', 'service_profiles', name, `${name}: domain ${domain ?? '—'}, ${SERVICE_FLAGS.filter((_, i) => flags[i]).join(', ') || 'no sections'}`),
  ]);
  return c.json({ ok: true });
});
