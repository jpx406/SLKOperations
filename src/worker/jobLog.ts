import { Hono } from 'hono';
import { filterSql, parseFilters } from '../shared/filters';
import type { AppBindings } from './env';

// Job Log (S08): every job in the caller's countries, filtered by the standard filter bar.
// Lists inside a cell (services, crew, third parties) are joined with the unit separator (char 31) and split on screen.

const SEP = 'char(31)';
const crew = (role: string) =>
  `(SELECT group_concat(full_name, ${SEP}) FROM (SELECT e.full_name FROM job_crew c JOIN employees e ON e.id = c.employee_id WHERE c.job_id = j.id AND c.crew_role = '${role}' ORDER BY c.slot))`;

const ROW = `
  j.id, j.country, j.ticket_no, j.drss_no, j.dmr_no, j.status, j.start_date, j.end_date, j.unit_number,
  coalesce((SELECT full_name FROM user_roles u WHERE u.username = j.sdm_username), j.sdm_username, j.sdm_other) AS sdm,
  j.location, j.field, j.rig, j.well, j.conveyance, j.run_details, j.wire_serial_number, j.drum_no, j.max_depth_ft, j.wire_cut_ft,
  j.runs_ok, j.runs_failed, m.op_hours, j.npt_hours, j.failure, m.job_efficiency_pct, m.run_efficiency_pct, j.report_closure_status, j.updated_at,
  (SELECT group_concat(job_type_name, ${SEP}) FROM (SELECT job_type_name FROM job_services s WHERE s.job_id = j.id ORDER BY position)) AS services,
  (SELECT group_concat(domain, ${SEP}) FROM (SELECT DISTINCT p.domain FROM job_services s JOIN service_profiles p ON p.job_type_name = s.job_type_name
     WHERE s.job_id = j.id AND p.domain IS NOT NULL)) AS domains,
  ${crew('slickline_supervisor')} AS supervisors, ${crew('slickline_operator')} AS operators,
  ${crew('assistant_operator')} AS assistants, ${crew('helper')} AS helpers,
  (SELECT group_concat(v, ${SEP}) FROM (SELECT t.vendor || coalesce(' PO ' || t.po_no, '') AS v FROM job_third_parties t WHERE t.job_id = j.id ORDER BY t.slot)) AS third_parties,
  (SELECT r.status FROM jras r WHERE r.job_id = j.id) AS jra_status`;

const LIMIT = 5000;

export const jobLog = new Hono<AppBindings>();

jobLog.get('/', async (c) => {
  const countries = JSON.stringify(c.get('user').countries);
  const f = parseFilters(new URL(c.req.url).searchParams);
  const { where, binds } = filterSql(f);
  const q = (c.req.query('q') ?? '').trim().replace(/[%_]/g, '');
  const all = ['j.deleted_at IS NULL', 'j.country IN (SELECT value FROM json_each(?))', ...where];
  const allBinds: unknown[] = [countries, ...binds];
  if (q) {
    all.push('(j.ticket_no LIKE ? OR j.well LIKE ? OR j.rig LIKE ? OR j.drss_no LIKE ?)');
    allBinds.push(...Array(4).fill(`%${q}%`));
  }
  const { results } = await c.env.DB.prepare(
    `SELECT ${ROW} FROM jobs j JOIN job_metrics m ON m.job_id = j.id WHERE ${all.join(' AND ')}
     ORDER BY coalesce(j.start_date, '9999-12-31') DESC, j.created_at DESC LIMIT ${LIMIT + 1}`,
  ).bind(...allBinds).all();
  return c.json({ rows: results.slice(0, LIMIT), truncated: results.length > LIMIT, limit: LIMIT });
});

/** Choices for the filter bar: values that occur in the caller's jobs, so no option leads to an empty list by itself. */
jobLog.get('/options', async (c) => {
  const countries = JSON.stringify(c.get('user').countries);
  const scope = `j.deleted_at IS NULL AND j.country IN (SELECT value FROM json_each(?))`;
  const distinct = (col: string) => c.env.DB.prepare(`SELECT DISTINCT ${col} AS v FROM jobs j WHERE ${scope} AND ${col} IS NOT NULL AND ${col} <> '' ORDER BY v`).bind(countries);
  const [years, accounts, areas, units, conveyances, sdms, services, domains] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT DISTINCT strftime('%Y', j.start_date) AS v FROM jobs j WHERE ${scope} AND j.start_date IS NOT NULL ORDER BY v DESC`).bind(countries),
    distinct('j.location'), distinct('j.field'), distinct('j.unit_number'), distinct('j.conveyance'),
    c.env.DB.prepare(
      `SELECT DISTINCT j.sdm_username AS v, coalesce(u.full_name, j.sdm_username) AS label FROM jobs j LEFT JOIN user_roles u ON u.username = j.sdm_username
       WHERE ${scope} AND j.sdm_username IS NOT NULL ORDER BY label`,
    ).bind(countries),
    c.env.DB.prepare(`SELECT DISTINCT s.job_type_name AS v FROM job_services s JOIN jobs j ON j.id = s.job_id WHERE ${scope} ORDER BY v`).bind(countries),
    c.env.DB.prepare(
      `SELECT DISTINCT p.domain AS v FROM job_services s JOIN jobs j ON j.id = s.job_id JOIN service_profiles p ON p.job_type_name = s.job_type_name
       WHERE ${scope} AND p.domain IS NOT NULL ORDER BY v`,
    ).bind(countries),
  ]);
  const vals = (r: D1Result) => (r.results as { v: string; label?: string }[]).map((x) => ({ value: x.v, label: x.label ?? x.v }));
  return c.json({
    year: vals(years), account: vals(accounts), area: vals(areas), unit: vals(units), conveyance: vals(conveyances),
    sdm: vals(sdms), service: vals(services), domain: vals(domains),
  });
});
