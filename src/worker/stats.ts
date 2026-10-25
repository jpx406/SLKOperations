import { Hono } from 'hono';
import { filterSql, parseFilters } from '../shared/filters';
import type { AppBindings } from './env';

// Rows behind the Service Quality screens: non-canceled jobs with a start date, in the caller's countries,
// filtered by the standard bar and an optional date range on the start date. Aggregation happens in src/shared/stats.ts.

const SEP = 'char(31)';

export const stats = new Hono<AppBindings>();

stats.get('/', async (c) => {
  const countries = JSON.stringify(c.get('user').countries);
  const f = parseFilters(new URL(c.req.url).searchParams);
  delete f.status;
  const { where, binds } = filterSql(f);
  const from = c.req.query('from');
  const to = c.req.query('to');
  const all = [`j.deleted_at IS NULL`, `j.status <> 'canceled'`, `j.start_date IS NOT NULL`, `j.country IN (SELECT value FROM json_each(?))`, ...where];
  const allBinds: unknown[] = [countries, ...binds];
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { all.push('j.start_date >= ?'); allBinds.push(from); }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { all.push('j.start_date <= ?'); allBinds.push(to); }
  const [rows, units, events] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT j.id, j.ticket_no, j.well, j.status, j.start_date, j.end_date, j.arrived_at, j.unit_number,
              coalesce((SELECT full_name FROM user_roles u WHERE u.username = j.sdm_username), j.sdm_username) AS sdm,
              j.location, j.field, j.conveyance, m.op_hours, j.npt_hours, j.failure, j.runs_ok, j.runs_failed, j.wellsite_audit,
              (SELECT group_concat(job_type_name, ${SEP}) FROM job_services s WHERE s.job_id = j.id) AS services,
              (SELECT group_concat(domain, ${SEP}) FROM (SELECT DISTINCT p.domain FROM job_services s JOIN service_profiles p ON p.job_type_name = s.job_type_name
                 WHERE s.job_id = j.id AND p.domain IS NOT NULL)) AS domains,
              (SELECT group_concat(e.full_name, ${SEP}) FROM job_crew cr JOIN employees e ON e.id = cr.employee_id
                 WHERE cr.job_id = j.id AND cr.crew_role IN ('slickline_supervisor','slickline_operator')) AS crew
       FROM jobs j JOIN job_metrics m ON m.job_id = j.id WHERE ${all.join(' AND ')} ORDER BY j.start_date LIMIT 20000`,
    ).bind(...allBinds),
    c.env.DB.prepare(`SELECT unit_number FROM wg_units WHERE wg_active = 1 AND country IN (SELECT value FROM json_each(?)) ORDER BY unit_number`).bind(countries),
    c.env.DB.prepare(
      `SELECT unit_number, kind, starts_on, ends_on FROM unit_events WHERE country IN (SELECT value FROM json_each(?1))
         AND (?2 IS NULL OR ends_on >= ?2) AND (?3 IS NULL OR starts_on <= ?3)`,
    ).bind(countries, from ?? null, to ?? null),
  ]);
  const split = (v: unknown) => (v ? String(v).split('\u001f') : []);
  return c.json({
    rows: (rows.results as Record<string, unknown>[]).map((r) => ({ ...r, services: split(r.services), domains: split(r.domains), crew: split(r.crew) })),
    units: (units.results as { unit_number: string }[]).map((u) => u.unit_number),
    events: events.results,
  });
});

/** People behind Utilization and Competency: the field roster and every crew assignment (any period, canceled left out). */
stats.get('/people', async (c) => {
  const countries = JSON.stringify(c.get('user').countries);
  const [people, rows] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT id, full_name, crew_role, rotation, title FROM employees WHERE active = 1 AND country IN (SELECT value FROM json_each(?)) ORDER BY full_name`,
    ).bind(countries),
    c.env.DB.prepare(
      `SELECT cr.employee_id, cr.crew_role, j.id AS job_id, j.ticket_no, j.start_date, j.end_date, j.arrived_at, j.status, j.failure, j.npt_hours,
              (SELECT group_concat(job_type_name, ${SEP}) FROM job_services s WHERE s.job_id = j.id) AS services,
              (SELECT group_concat(domain, ${SEP}) FROM (SELECT DISTINCT p.domain FROM job_services s JOIN service_profiles p ON p.job_type_name = s.job_type_name
                 WHERE s.job_id = j.id AND p.domain IS NOT NULL)) AS domains
       FROM job_crew cr JOIN jobs j ON j.id = cr.job_id
       WHERE j.deleted_at IS NULL AND j.status <> 'canceled' AND j.start_date IS NOT NULL AND j.country IN (SELECT value FROM json_each(?))`,
    ).bind(countries),
  ]);
  const split = (v: unknown) => (v ? String(v).split('\u001f') : []);
  return c.json({
    people: people.results,
    assignments: (rows.results as Record<string, unknown>[]).map((r) => ({ ...r, services: split(r.services), domains: split(r.domains) })),
  });
});
