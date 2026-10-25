import { Hono } from 'hono';
import { filterSql, parseFilters } from '../shared/filters';
import type { AppBindings } from './env';

// Sales Dashboard (Administrator Manual 2), decided 2026-10-24: an aggregate of the revenue entered on each job.
// There is no separate revenue dataset, so no "Add jobs" or "Upload clean revenue"; Find/Edit opens the job.

export const sales = new Hono<AppBindings>();

sales.get('/jobs', async (c) => {
  const f = parseFilters(new URL(c.req.url).searchParams);
  delete f.status;
  const { where, binds } = filterSql(f);
  const all = [`j.deleted_at IS NULL`, `j.status <> 'canceled'`, `j.country IN (SELECT value FROM json_each(?))`, ...where];
  const { results } = await c.env.DB.prepare(
    `SELECT j.id, j.ticket_no, j.status, j.start_date, j.location, j.field, j.unit_number, j.well, j.revenue_cents, j.revenue_currency,
            coalesce((SELECT full_name FROM user_roles u WHERE u.username = j.sdm_username), j.sdm_username) AS sdm,
            (SELECT group_concat(job_type_name, char(31)) FROM job_services s WHERE s.job_id = j.id) AS services,
            (SELECT group_concat(domain, char(31)) FROM (SELECT DISTINCT p.domain FROM job_services s JOIN service_profiles p ON p.job_type_name = s.job_type_name
               WHERE s.job_id = j.id AND p.domain IS NOT NULL)) AS domains,
            (SELECT coalesce(sum(b.amount_cents), 0) FROM job_bonus_lines b WHERE b.job_id = j.id AND b.status = 'approved') AS bonus_cents
     FROM jobs j WHERE ${all.join(' AND ')} ORDER BY coalesce(j.start_date, '9999') DESC LIMIT 20000`,
  ).bind(JSON.stringify(c.get('user').countries), ...binds).all();
  const split = (v: unknown) => (v ? String(v).split('\u001f') : []);
  return c.json((results as Record<string, unknown>[]).map((r) => ({ ...r, services: split(r.services), domains: split(r.domains) })));
});
