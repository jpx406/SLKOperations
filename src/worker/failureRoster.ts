import { Hono } from 'hono';
import { SEVERITIES } from '../shared/emf';
import { filterSql, parseFilters } from '../shared/filters';
import type { AppBindings, AuthedUser, Env } from './env';

// Failure Roster (S10): one row per 8 Min. Facts incident (kept in step by the 8MF save), plus rows added by hand.
// Filters are the standard bar applied to the linked job; rows without a job only match when no job filter is set.

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'failure_roster', id, summary.slice(0, 1000));

const ACTION = ['open', 'in_progress', 'closed'] as const;

function scope(c: { req: { url: string; query: (k: string) => string | undefined }; get: (k: 'user') => AuthedUser }) {
  const f = parseFilters(new URL(c.req.url).searchParams);
  const { where, binds } = filterSql(f);
  const all = ['f.country IN (SELECT value FROM json_each(?))'];
  const allBinds: unknown[] = [JSON.stringify(c.get('user').countries)];
  if (where.length) { all.push(`f.job_id IS NOT NULL AND ${where.join(' AND ')}`); allBinds.push(...binds); }
  const sev = c.req.query('severity');
  if (sev === 'none') all.push('f.incident_id IS NULL');
  else if (sev && (SEVERITIES as readonly string[]).includes(sev)) { all.push('f.severity = ?'); allBinds.push(sev); }
  const act = c.req.query('action');
  if (act && (ACTION as readonly string[]).includes(act)) { all.push('f.action_status = ?'); allBinds.push(act); }
  const month = c.req.query('occurred');
  if (month && /^\d{4}-\d{2}$/.test(month)) { all.push(`strftime('%Y-%m', f.occurred_on) = ?`); allBinds.push(month); }
  return { where: all.join(' AND '), binds: allBinds };
}

export const failureRoster = new Hono<AppBindings>();

failureRoster.get('/', async (c) => {
  const s = scope(c);
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.occurred_on, f.well, f.rilr_refs, f.category, f.severity, f.action_status, f.notes, f.incident_id, f.created_by,
            j.id AS job_id, j.ticket_no, j.unit_number, r.id AS report_id, r.log_no, i.npt_hours, i.what_happened
     FROM failure_roster_entries f LEFT JOIN jobs j ON j.id = f.job_id
       LEFT JOIN incidents i ON i.id = f.incident_id LEFT JOIN eight_min_facts r ON r.id = i.report_id
     WHERE ${s.where} ORDER BY f.occurred_on DESC, f.created_at DESC LIMIT 2000`,
  ).bind(...s.binds).all();
  return c.json(results.map((r) => ({ ...r, rilr_refs: JSON.parse(String((r as { rilr_refs?: string }).rilr_refs ?? '[]')) })));
});

/** Failures by month (last 12 months with data, within the filters) and jobs not fully tracked. */
failureRoster.get('/summary', async (c) => {
  const s = scope(c);
  const countries = JSON.stringify(c.get('user').countries);
  const [byMonth, nptNo8mf, failNoRoster] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT strftime('%Y-%m', f.occurred_on) AS month, count(*) AS n,
              sum(CASE WHEN f.severity IN ('major','catastrophic') THEN 1 ELSE 0 END) AS severe
       FROM failure_roster_entries f LEFT JOIN jobs j ON j.id = f.job_id WHERE ${s.where} GROUP BY month ORDER BY month DESC LIMIT 12`,
    ).bind(...s.binds),
    c.env.DB.prepare(
      `SELECT j.id, j.ticket_no, j.well, j.npt_hours FROM jobs j WHERE j.deleted_at IS NULL AND j.country IN (SELECT value FROM json_each(?))
         AND j.npt_hours > 0 AND NOT EXISTS (SELECT 1 FROM eight_min_facts r WHERE r.job_id = j.id) ORDER BY j.start_date DESC LIMIT 200`,
    ).bind(countries),
    c.env.DB.prepare(
      `SELECT j.id, j.ticket_no, j.well, j.npt_hours FROM jobs j WHERE j.deleted_at IS NULL AND j.country IN (SELECT value FROM json_each(?))
         AND j.failure = 'yes' AND NOT EXISTS (SELECT 1 FROM failure_roster_entries f WHERE f.job_id = j.id) ORDER BY j.start_date DESC LIMIT 200`,
    ).bind(countries),
  ]);
  return c.json({ byMonth: [...byMonth.results].reverse(), nptWithout8mf: nptNo8mf.results, failureNotInRoster: failNoRoster.results });
});

failureRoster.post('/', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<Record<string, string | null>>().catch(() => ({} as Record<string, string | null>));
  const on = String(b.occurred_on ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return c.json({ error: 'Pick the date of the failure' }, 400);
  if (b.severity && !(SEVERITIES as readonly string[]).includes(b.severity)) return c.json({ error: 'Unknown severity' }, 400);
  let country = b.country ?? null;
  let well = String(b.well ?? '').trim().slice(0, 120) || null;
  if (b.job_id) {
    const j = await c.env.DB.prepare('SELECT country, well FROM jobs WHERE id = ? AND deleted_at IS NULL').bind(b.job_id).first<{ country: string; well: string | null }>();
    if (!j) return c.json({ error: 'Job not found' }, 400);
    country = j.country;
    well ??= j.well;
  } else if (!country && user.countries.length === 1) country = user.countries[0];
  if (!country || !user.countries.includes(country)) return c.json({ error: 'Pick the job or one of your countries' }, 400);
  const rilr = String(b.rilr ?? '').split(/[,;]/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO failure_roster_entries (id, country, job_id, occurred_on, well, rilr_refs, category, severity, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, country, b.job_id || null, on, well, JSON.stringify(rilr), String(b.category ?? '').trim().slice(0, 80) || null, b.severity || null,
      String(b.notes ?? '').trim().slice(0, 4000) || null, user.username),
    audit(c.env, user, 'create', id, `Added by hand: ${on}${well ? ` ${well}` : ''}`),
  ]);
  return c.json({ ok: true, id }, 201);
});

failureRoster.patch('/:id', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT id, country, incident_id FROM failure_roster_entries WHERE id = ?').bind(c.req.param('id')).first<{ id: string; country: string; incident_id: string | null }>();
  if (!row || !user.countries.includes(row.country)) return c.json({ error: 'Not found' }, 404);
  const b = await c.req.json<Record<string, string | null>>().catch(() => ({} as Record<string, string | null>));
  const v: Record<string, unknown> = {};
  if ('action_status' in b) { if (!(ACTION as readonly string[]).includes(String(b.action_status))) return c.json({ error: 'Unknown action status' }, 400); v.action_status = b.action_status; }
  if ('notes' in b) v.notes = String(b.notes ?? '').trim().slice(0, 4000) || null;
  // category and severity of an 8MF row come from its incident; change them in the report
  if (!row.incident_id) {
    if ('category' in b) v.category = String(b.category ?? '').trim().slice(0, 80) || null;
    if ('severity' in b) { if (b.severity && !(SEVERITIES as readonly string[]).includes(b.severity)) return c.json({ error: 'Unknown severity' }, 400); v.severity = b.severity || null; }
  } else if ('category' in b || 'severity' in b) return c.json({ error: 'Category and severity come from the 8 Min. Facts report. Change them there.' }, 400);
  const cols = Object.keys(v);
  if (!cols.length) return c.json({ error: 'Nothing to change' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE failure_roster_entries SET ${cols.map((k, i) => `${k} = ?${i + 1}`).join(', ')} WHERE id = ?${cols.length + 1}`).bind(...cols.map((k) => v[k]), row.id),
    audit(c.env, user, 'edit', row.id, cols.map((k) => `${k} = ${v[k]}`).join(', ')),
  ]);
  return c.json({ ok: true });
});

failureRoster.delete('/:id', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT id, country, incident_id FROM failure_roster_entries WHERE id = ?').bind(c.req.param('id')).first<{ id: string; country: string; incident_id: string | null }>();
  if (!row || !user.countries.includes(row.country)) return c.json({ error: 'Not found' }, 404);
  if (row.incident_id) return c.json({ error: 'This row belongs to an 8 Min. Facts incident. Remove the incident from the report instead.' }, 409);
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM failure_roster_entries WHERE id = ?').bind(row.id), audit(c.env, user, 'delete', row.id, 'Removed a hand-added row')]);
  return c.json({ ok: true });
});
