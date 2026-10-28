import { Hono } from 'hono';
import { filterSql, parseFilters } from '../shared/filters';
import {
  ACTIVITY_FIELDS, DAILY_FIELDS, FORMAT_KEYS, cleanValue, clientFor, dailyStatus, formatOf, snapshotOf,
  type FormatKey, type SheetField, type SheetLine, type Values,
} from '../shared/salesSheets';
import type { AppBindings, AuthedUser, Env } from './env';

// Sales Dashboard (Administrator Manual 2), decided 2026-10-24: an aggregate of the revenue entered on each job.
// There is no separate revenue dataset, so no "Add jobs" or "Upload clean revenue"; Find/Edit opens the job.
// 2026-10-28: the Activity sheet (a billing line per job) and the Daily report (a line per unit per day) that
// replace the two Excel workbooks. See shared/salesSheets.ts for the fields and where each value comes from.

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

// ---------------------------------------------------------------------------------------------------------------
// shared pieces

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
const isDay = (d: string | undefined | null): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const isMonth = (m: string | undefined | null): m is string => !!m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const STATUS_WORD: Record<string, string> = { planned: 'Upcoming', ongoing: 'Ongoing', completed: 'Completed', canceled: 'Cancelled' };
const YES: Record<string, string> = { yes: 'Yes', no: 'No', na: 'N/A', other: 'Other' };
const parse = (s: unknown): Values => { try { return s ? JSON.parse(String(s)) : {}; } catch { return {}; } };
const isAdmin = (u: AuthedUser) => u.role === 'admin';

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'sales', id, summary.slice(0, 1000));

async function pickedFormats(env: Env, countries: string[]) {
  const { results } = await env.DB.prepare('SELECT account, format FROM sales_account_formats WHERE country IN (SELECT value FROM json_each(?))').bind(JSON.stringify(countries)).all<{ account: string; format: string }>();
  return Object.fromEntries(results.map((r) => [r.account, r.format]));
}

interface CrewRow { job_id: string; crew_role: string; slot: number; start_date: string | null; end_date: string | null; full_name: string }

/** The crew of each job: supervisors in slot order, then the operators; people taken off the job before `day` are left out. */
async function crewOf(env: Env, jobIds: string[], day?: string) {
  const out = new Map<string, { supervisors: string[]; operators: string[] }>();
  for (let i = 0; i < jobIds.length; i += 400) {
    const { results } = await env.DB.prepare(
      `SELECT c.job_id, c.crew_role, c.slot, c.start_date, c.end_date, e.full_name FROM job_crew c JOIN employees e ON e.id = c.employee_id
       WHERE c.job_id IN (SELECT value FROM json_each(?)) ORDER BY c.job_id, c.slot`,
    ).bind(JSON.stringify(jobIds.slice(i, i + 400))).all<CrewRow>();
    for (const r of results) {
      if (day && ((r.start_date && r.start_date > day) || (r.end_date && r.end_date < day))) continue;
      const e = out.get(r.job_id) ?? { supervisors: [], operators: [] };
      (r.crew_role === 'slickline_supervisor' ? e.supervisors : e.operators).push(r.full_name);
      out.set(r.job_id, e);
    }
  }
  return out;
}

const JOB_COLS = `j.id, j.country, j.ticket_no, j.drss_no, j.dmr_no, j.service_order_no, j.status, j.location, j.field, j.rig, j.well, j.unit_number,
  j.well_type, j.start_date, j.end_date, j.arrived_at, j.rig_up_at, j.rig_down_at, j.npt_hours, coalesce(j.op_hours_override, j.op_hours_auto) AS op_hours,
  j.ticket_signed, j.revenue_cents, j.revenue_currency, j.max_inclination_deg, j.conveyance, p.label AS pce_label,
  (SELECT group_concat(job_type_name, ', ') FROM (SELECT job_type_name FROM job_services s WHERE s.job_id = j.id ORDER BY s.position)) AS services`;
type JobRow = Record<string, string | number | null>;

const rigWell = (j: JobRow) => [j.rig, j.field].filter(Boolean).join(' / ') || null;
const autoMonth = (j: JobRow) => (String(j.end_date ?? j.start_date ?? '').slice(0, 7) || null);

/** The values the Activity sheet reads from a job. */
function activityApp(j: JobRow, crew: { supervisors: string[]; operators: string[] } | undefined): Values {
  const sup = crew?.supervisors ?? [];
  return {
    revenue_month: autoMonth(j), account: j.location, field_rig: rigWell(j), well: j.well, job_type: j.services, job_status: STATUS_WORD[String(j.status)] ?? j.status,
    unit: j.unit_number, well_type: j.well_type,
    supervisor: sup[0] ?? null, supervisor_2: sup.slice(1).join(', ') || null, operators: crew?.operators.join(', ') || null,
    crew_count: sup.length + (crew?.operators.length ?? 0) || null,
    planned_mob_on: j.start_date, arrived_at: j.arrived_at, started_at: j.rig_up_at ?? j.start_date, finished_at: j.rig_down_at ?? j.end_date,
    op_hours: j.op_hours, npt_hours: j.npt_hours,
    fst_no: j.ticket_no, drss_no: j.drss_no, dmr_no: j.dmr_no, service_order_no: j.service_order_no, ticket_signed: j.ticket_signed ? YES[String(j.ticket_signed)] ?? j.ticket_signed : null,
    gross: j.revenue_cents == null ? null : Number(j.revenue_cents) / 100, currency: j.revenue_currency,
    pce: j.pce_label, max_deviation: j.max_inclination_deg,
  };
}

const lockInfo = (r: { locked_by: string | null; locked_name?: string | null; locked_at: string | null }) =>
  r.locked_by && r.locked_at ? { by: r.locked_by, name: r.locked_name ?? null, at: r.locked_at } : null;

// ---------------------------------------------------------------------------------------------------------------
// Activity sheet

async function activityLines(env: Env, user: AuthedUser, opts: { month?: string; jobIds?: string[]; filters?: URLSearchParams }): Promise<SheetLine[]> {
  const where = ['j.deleted_at IS NULL', 'j.country IN (SELECT value FROM json_each(?1))'];
  const binds: unknown[] = [JSON.stringify(user.countries)];
  if (opts.month) {
    binds.push(opts.month);
    where.push(`coalesce(nullif(json_extract(s.data, '$.revenue_month'), ''), substr(coalesce(j.end_date, j.start_date), 1, 7)) = ?${binds.length}`);
  }
  if (opts.jobIds) { binds.push(JSON.stringify(opts.jobIds)); where.push(`j.id IN (SELECT value FROM json_each(?${binds.length}))`); }
  if (opts.filters) {
    const f = parseFilters(opts.filters);
    delete f.status; delete f.month; delete f.year;
    const fs = filterSql(f);
    for (const [i, w] of fs.where.entries()) { binds.push(fs.binds[i]); where.push(w.replace('?', `?${binds.length}`)); }
  }
  const { results } = await env.DB.prepare(
    `SELECT ${JOB_COLS}, s.data, s.locked_by, s.locked_at, s.snapshot, coalesce(u.full_name, s.locked_by) AS locked_name
     FROM jobs j LEFT JOIN sales_activity s ON s.job_id = j.id LEFT JOIN pce p ON p.id = j.pce_id LEFT JOIN user_roles u ON u.username = s.locked_by
     WHERE ${where.join(' AND ')} ORDER BY j.location, coalesce(j.end_date, j.start_date), j.ticket_no LIMIT 5000`,
  ).bind(...binds).all<JobRow>();
  const crew = await crewOf(env, results.map((r) => String(r.id)));
  const formats = await pickedFormats(env, user.countries);
  return results.map((j) => ({
    id: String(j.id), job_id: String(j.id), account: (j.location as string | null) ?? null,
    format: formatOf(j.location as string | null, formats),
    app: { ...activityApp(j, crew.get(String(j.id))), ticket: j.ticket_no, country: j.country },
    data: parse(j.data), locked: lockInfo(j as never), snapshot: j.snapshot ? parse(j.snapshot) : null,
  }));
}

sales.get('/activity', async (c) => {
  const q = new URL(c.req.url).searchParams;
  const month = isMonth(q.get('month')) ? q.get('month')! : today().slice(0, 7);
  const user = c.get('user');
  const [lines, formats] = await Promise.all([activityLines(c.env, user, { month, filters: q }), pickedFormats(c.env, user.countries)]);
  return c.json({ month, formats, lines, canUnlock: isAdmin(user) });
});

const fieldMap = (all: SheetField[]) => new Map(all.map((f) => [f.key, f]));
const ACT = fieldMap(ACTIVITY_FIELDS);

/** PUT /api/sales/activity/:jobId { values: { field: value } } — the typed fields of one line. */
sales.put('/activity/:jobId', async (c) => {
  const user = c.get('user');
  const jobId = c.req.param('jobId');
  const body = await c.req.json<{ values?: Record<string, unknown> }>().catch(() => ({} as { values?: Record<string, unknown> }));
  const job = await c.env.DB.prepare('SELECT id, country, ticket_no FROM jobs WHERE id = ? AND deleted_at IS NULL').bind(jobId).first<{ id: string; country: string; ticket_no: string | null }>();
  if (!job || !user.countries.includes(job.country)) return c.json({ error: 'Job not found' }, 404);
  const cur = await c.env.DB.prepare('SELECT data, locked_at FROM sales_activity WHERE job_id = ?').bind(jobId).first<{ data: string; locked_at: string | null }>();
  if (cur?.locked_at) return c.json({ error: 'This line is checked and locked. An Admin can unlock it.' }, 409);
  const data = parse(cur?.data);
  const changes: string[] = [];
  for (const [k, raw] of Object.entries(body.values ?? {})) {
    const f = ACT.get(k);
    if (!f) return c.json({ error: `Unknown field ${k}` }, 400);
    const v = cleanValue(f, raw);
    if ('error' in v) return c.json({ error: v.error }, 400);
    if ((data[k] ?? null) === v.value) continue;
    changes.push(`${f.label}: ${data[k] ?? '—'} → ${v.value ?? '—'}`);
    if (v.value === null) delete data[k]; else data[k] = v.value;
  }
  if (!changes.length) return c.json({ ok: true, data });
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO sales_activity (job_id, country, data, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (job_id) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(jobId, job.country, JSON.stringify(data), user.username, new Date().toISOString()),
    audit(c.env, user, 'edit', jobId, `Activity sheet ${job.ticket_no ?? jobId}: ${changes.join('; ')}`),
  ]);
  return c.json({ ok: true, data });
});

/** POST /api/sales/activity/lock|unlock { job_ids } — check and lock lines (unlocking is for an Admin). */
sales.post('/activity/:action{lock|unlock}', async (c) => {
  const user = c.get('user');
  const lock = c.req.param('action') === 'lock';
  if (!lock && !isAdmin(user)) return c.json({ error: 'Only an Admin can unlock a checked line' }, 403);
  const body = await c.req.json<{ job_ids?: string[]; reason?: string }>().catch(() => ({} as { job_ids?: string[]; reason?: string }));
  const ids = [...new Set((body.job_ids ?? []).map(String))].slice(0, 2000);
  if (!ids.length) return c.json({ error: 'No lines picked' }, 400);
  const lines = await activityLines(c.env, user, { jobIds: ids });
  const at = new Date().toISOString();
  const todo = lines.filter((l) => (lock ? !l.locked : !!l.locked));
  const stmts = todo.flatMap((l) => [
    lock
      ? c.env.DB.prepare(
        `INSERT INTO sales_activity (job_id, country, data, locked_by, locked_at, snapshot, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?4, ?5)
         ON CONFLICT (job_id) DO UPDATE SET locked_by = ?4, locked_at = ?5, snapshot = ?6`,
      ).bind(l.job_id, l.app.country, JSON.stringify(l.data), user.username, at, JSON.stringify(snapshotOf(l, ACTIVITY_FIELDS)))
      : c.env.DB.prepare('UPDATE sales_activity SET locked_by = NULL, locked_at = NULL, snapshot = NULL, updated_by = ?, updated_at = ? WHERE job_id = ?').bind(user.username, at, l.job_id),
    audit(c.env, user, lock ? 'review' : 'reopen', l.id,
      lock ? `Activity sheet ${l.app.ticket ?? l.job_id} checked and locked` : `Activity sheet ${l.app.ticket ?? l.job_id} unlocked${body.reason ? `: ${String(body.reason).slice(0, 300)}` : ''}`),
  ]);
  for (let i = 0; i < stmts.length; i += 90) await c.env.DB.batch(stmts.slice(i, i + 90));
  return c.json({ ok: true, changed: todo.length });
});

/** PUT /api/sales/formats { account, format } — the sheet format an account uses. */
sales.put('/formats', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<{ account?: string; format?: string }>().catch(() => ({} as { account?: string; format?: string }));
  const account = String(b.account ?? '').trim().slice(0, 120);
  if (!account) return c.json({ error: 'Pick an account' }, 400);
  if (!FORMAT_KEYS.includes(b.format as FormatKey)) return c.json({ error: 'Unknown format' }, 400);
  const at = new Date().toISOString();
  await c.env.DB.batch([
    ...user.countries.map((country) => c.env.DB.prepare(
      `INSERT INTO sales_account_formats (country, account, format, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (country, account) DO UPDATE SET format = excluded.format, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(country, account, b.format, user.username, at)),
    audit(c.env, user, 'edit', account, `Sales sheets: ${account} uses the ${b.format} format`),
  ]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------------------------------------------
// Daily report

interface DayRec { upcoming?: { rig_well: string; date: string; remarks?: string; entity?: string }[]; pob?: Record<string, number | null>; notes?: string }

async function dailyLines(env: Env, user: AuthedUser, day: string, onlyUnits?: string[]) {
  const countries = JSON.stringify(user.countries);
  const now = today();
  const [units, jobs, events, saved, before] = await env.DB.batch([
    env.DB.prepare(
      `SELECT unit_number, country FROM wg_units WHERE country IN (SELECT value FROM json_each(?1)) AND wg_active = 1
       UNION SELECT unit_number, country FROM sales_daily WHERE day = ?2 AND country IN (SELECT value FROM json_each(?1)) ORDER BY unit_number`,
    ).bind(countries, day),
    // a job covers its start to end date, an ongoing one runs to today even past its planned end
    env.DB.prepare(
      `SELECT ${JOB_COLS} FROM jobs j LEFT JOIN pce p ON p.id = j.pce_id
       WHERE j.deleted_at IS NULL AND j.status <> 'canceled' AND j.unit_number IS NOT NULL AND j.start_date IS NOT NULL
         AND j.country IN (SELECT value FROM json_each(?1)) AND j.start_date <= ?2
         AND (CASE WHEN j.status = 'ongoing' THEN max(coalesce(j.end_date, j.start_date), ?3) ELSE coalesce(j.end_date, j.start_date) END) >= ?2
       ORDER BY CASE j.status WHEN 'ongoing' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END, j.start_date DESC`,
    ).bind(countries, day, now),
    env.DB.prepare(`SELECT unit_number, kind, starts_on, ends_on, note FROM unit_events WHERE country IN (SELECT value FROM json_each(?1)) AND starts_on <= ?2 AND ends_on >= ?2`).bind(countries, day),
    env.DB.prepare(
      `SELECT d.*, coalesce(u.full_name, d.locked_by) AS locked_name FROM sales_daily d LEFT JOIN user_roles u ON u.username = d.locked_by
       WHERE d.day = ?2 AND d.country IN (SELECT value FROM json_each(?1))`,
    ).bind(countries, day),
    // the last line typed for each unit in the 90 days before, for the values that carry over
    env.DB.prepare(`SELECT unit_number, day, data FROM sales_daily WHERE country IN (SELECT value FROM json_each(?1)) AND day < ?2 AND day >= ?3 ORDER BY day DESC`).bind(countries, day, addDays(day, -90)),
  ]);
  const jobOf = new Map<string, JobRow>();
  for (const j of jobs.results as JobRow[]) if (!jobOf.has(String(j.unit_number))) jobOf.set(String(j.unit_number), j);
  const crew = await crewOf(env, [...jobOf.values()].map((j) => String(j.id)), day);
  const eventOf = new Map((events.results as { unit_number: string; kind: string; starts_on: string; ends_on: string; note: string | null }[]).map((e) => [e.unit_number, e]));
  const savedOf = new Map((saved.results as Record<string, string | null>[]).map((r) => [String(r.unit_number), r]));
  const carryOf = new Map<string, { day: string; data: Values }>();
  for (const r of before.results as { unit_number: string; day: string; data: string }[]) if (!carryOf.has(r.unit_number)) carryOf.set(r.unit_number, { day: r.day, data: parse(r.data) });
  const carryKeys = DAILY_FIELDS.filter((f) => f.carry).map((f) => f.key);

  const lines: (SheetLine & { carried: { from: string; keys: string[] } | null })[] = [];
  for (const u of units.results as { unit_number: string; country: string }[]) {
    if (onlyUnits && !onlyUnits.includes(u.unit_number)) continue;
    const j = jobOf.get(u.unit_number) ?? null;
    const ev = eventOf.get(u.unit_number) ?? null;
    const cr = j ? crew.get(String(j.id)) : undefined;
    const s = savedOf.get(u.unit_number);
    const data = parse(s?.data);
    // values typed on an earlier day carry over until changed
    const prev = carryOf.get(u.unit_number);
    const carried = prev ? carryKeys.filter((k) => data[k] === undefined && prev.data[k] != null) : [];
    for (const k of carried) data[k] = prev!.data[k];
    const offshore = /off/i.test(String(j?.conveyance ?? '')) || /offshore/i.test(String(data.location_type ?? ''));
    lines.push({
      id: u.unit_number, job_id: j ? String(j.id) : null, account: (j?.location as string | null) ?? null, format: formatOf(j?.location as string | null),
      app: {
        unit: u.unit_number, country: u.country, ticket: j?.ticket_no ?? null, job_status: j ? STATUS_WORD[String(j.status)] ?? null : null,
        status: dailyStatus(day, j ? { status: String(j.status), start_date: j.start_date as string | null } : null, ev),
        event: ev ? `${ev.kind === 'maintenance' ? 'Maintenance' : ev.kind} ${ev.starts_on} – ${ev.ends_on === '9999-12-31' ? 'open' : ev.ends_on}${ev.note ? `: ${ev.note}` : ''}` : null,
        client: j ? clientFor(j.location as string | null, offshore) : null, account: j?.location ?? null,
        rig_site: j ? rigWell(j) : null, well: j?.well ?? null, activity: j?.services ?? null,
        supervisor: cr?.supervisors.join(' / ') || null, operators: cr?.operators.join(', ') || null,
        pce: j?.pce_label ?? null, well_type: j?.well_type ? String(j.well_type).replace(/^./, (x) => x.toUpperCase()) : null,
      },
      data, locked: s ? lockInfo(s as never) : null, snapshot: s?.snapshot ? parse(s.snapshot) : null,
      carried: carried.length ? { from: prev!.day, keys: carried } : null,
    });
  }
  return lines;
}

sales.get('/daily', async (c) => {
  const user = c.get('user');
  const q = new URL(c.req.url).searchParams;
  const day = isDay(q.get('day')) ? q.get('day')! : today();
  const countries = JSON.stringify(user.countries);
  const month = day.slice(0, 7);
  const [lines, extra] = await Promise.all([
    dailyLines(c.env, user, day),
    c.env.DB.batch([
      c.env.DB.prepare('SELECT country, data FROM sales_daily_days WHERE day = ?2 AND country IN (SELECT value FROM json_each(?1))').bind(countries, day),
      // upcoming: planned jobs starting in the next three weeks
      c.env.DB.prepare(
        `SELECT j.id, j.ticket_no, j.location, j.rig, j.field, j.well, j.unit_number, j.start_date, j.status, j.conveyance,
                (SELECT group_concat(job_type_name, ', ') FROM job_services s WHERE s.job_id = j.id) AS services
         FROM jobs j WHERE j.deleted_at IS NULL AND j.status = 'planned' AND j.country IN (SELECT value FROM json_each(?1))
           AND j.start_date > ?2 AND j.start_date <= ?3 ORDER BY j.start_date`,
      ).bind(countries, day, addDays(day, 21)),
      c.env.DB.prepare(
        `SELECT day, count(*) AS lines, sum(CASE WHEN locked_at IS NOT NULL THEN 1 ELSE 0 END) AS locked FROM sales_daily
         WHERE country IN (SELECT value FROM json_each(?1)) AND day LIKE ?2 GROUP BY day`,
      ).bind(countries, `${month}-%`),
    ]),
  ]);
  const [days, upcoming, monthRows] = extra;
  const rec: DayRec = {};
  for (const r of days.results as { data: string }[]) {
    const d = parse(r.data) as DayRec;
    rec.upcoming = [...(rec.upcoming ?? []), ...(d.upcoming ?? [])];
    rec.pob = { ...(rec.pob ?? {}), ...(d.pob ?? {}) };
    if (d.notes) rec.notes = d.notes;
  }
  return c.json({ day, lines, record: rec, upcoming: upcoming.results, month: monthRows.results, canUnlock: isAdmin(user) });
});

const DAY = fieldMap(DAILY_FIELDS);

async function unitCountry(env: Env, user: AuthedUser, unit: string) {
  const r = await env.DB.prepare(
    `SELECT country FROM wg_units WHERE unit_number = ?1 UNION SELECT country FROM sales_daily WHERE unit_number = ?1 LIMIT 1`,
  ).bind(unit).first<{ country: string }>();
  return r && user.countries.includes(r.country) ? r.country : null;
}

/** PUT /api/sales/daily/:day/:unit { values } — the typed fields of one unit's line for the day. */
sales.put('/daily/:day/:unit', async (c) => {
  const user = c.get('user');
  const day = c.req.param('day'), unit = c.req.param('unit');
  if (!isDay(day)) return c.json({ error: 'Pick a day' }, 400);
  const country = await unitCountry(c.env, user, unit);
  if (!country) return c.json({ error: 'Unit not found' }, 404);
  const body = await c.req.json<{ values?: Record<string, unknown> }>().catch(() => ({} as { values?: Record<string, unknown> }));
  const cur = await c.env.DB.prepare('SELECT data, locked_at FROM sales_daily WHERE country = ? AND day = ? AND unit_number = ?').bind(country, day, unit).first<{ data: string; locked_at: string | null }>();
  if (cur?.locked_at) return c.json({ error: 'This line is checked and locked. An Admin can unlock it.' }, 409);
  const data = parse(cur?.data);
  const changes: string[] = [];
  for (const [k, raw] of Object.entries(body.values ?? {})) {
    const f = DAY.get(k);
    if (!f) return c.json({ error: `Unknown field ${k}` }, 400);
    const v = cleanValue(f, raw);
    if ('error' in v) return c.json({ error: v.error }, 400);
    if ((data[k] ?? null) === v.value && k in data) continue;
    changes.push(`${f.label}: ${data[k] ?? '—'} → ${v.value ?? '—'}`);
    // an emptied carried field is stored as empty, so the old value stops carrying over
    data[k] = v.value;
  }
  if (!changes.length) return c.json({ ok: true, data });
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO sales_daily (country, day, unit_number, data, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (country, day, unit_number) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(country, day, unit, JSON.stringify(data), user.username, new Date().toISOString()),
    audit(c.env, user, 'edit', `${day} ${unit}`, `Daily report ${day} ${unit}: ${changes.join('; ')}`),
  ]);
  return c.json({ ok: true, data });
});

/** POST /api/sales/daily/:day/lock|unlock { units } — check and lock a unit's line for the day (unlock: Admin). */
sales.post('/daily/:day/:action{lock|unlock}', async (c) => {
  const user = c.get('user');
  const day = c.req.param('day');
  const lock = c.req.param('action') === 'lock';
  if (!isDay(day)) return c.json({ error: 'Pick a day' }, 400);
  if (!lock && !isAdmin(user)) return c.json({ error: 'Only an Admin can unlock a checked line' }, 403);
  const body = await c.req.json<{ units?: string[]; reason?: string }>().catch(() => ({} as { units?: string[]; reason?: string }));
  const units = [...new Set((body.units ?? []).map(String))].slice(0, 500);
  if (!units.length) return c.json({ error: 'No lines picked' }, 400);
  const lines = (await dailyLines(c.env, user, day, units)).filter((l) => (lock ? !l.locked : !!l.locked));
  const at = new Date().toISOString();
  const stmts = lines.flatMap((l) => [
    lock
      // the carried values are written into the line, so it no longer depends on the days before
      ? c.env.DB.prepare(
        `INSERT INTO sales_daily (country, day, unit_number, data, locked_by, locked_at, snapshot, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?5, ?6)
         ON CONFLICT (country, day, unit_number) DO UPDATE SET data = ?4, locked_by = ?5, locked_at = ?6, snapshot = ?7`,
      ).bind(l.app.country, day, l.id, JSON.stringify(l.data), user.username, at, JSON.stringify(snapshotOf(l, DAILY_FIELDS)))
      : c.env.DB.prepare('UPDATE sales_daily SET locked_by = NULL, locked_at = NULL, snapshot = NULL, updated_by = ?, updated_at = ? WHERE country = ? AND day = ? AND unit_number = ?')
        .bind(user.username, at, l.app.country, day, l.id),
    audit(c.env, user, lock ? 'review' : 'reopen', `${day} ${l.id}`,
      lock ? `Daily report ${day} ${l.id} checked and locked` : `Daily report ${day} ${l.id} unlocked${body.reason ? `: ${String(body.reason).slice(0, 300)}` : ''}`),
  ]);
  for (let i = 0; i < stmts.length; i += 90) await c.env.DB.batch(stmts.slice(i, i + 90));
  return c.json({ ok: true, changed: lines.length });
});

/** PUT /api/sales/daily/:day { upcoming, pob, notes } — the hand-typed parts of the day. */
sales.put('/daily/:day', async (c) => {
  const user = c.get('user');
  const day = c.req.param('day');
  if (!isDay(day)) return c.json({ error: 'Pick a day' }, 400);
  const b = await c.req.json<DayRec>().catch(() => ({} as DayRec));
  const str = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n);
  const upcoming = (Array.isArray(b.upcoming) ? b.upcoming : []).slice(0, 60)
    .map((u) => ({ rig_well: str(u.rig_well, 120), date: isDay(u.date) ? u.date : '', remarks: str(u.remarks), entity: ['NESR', 'SAPESCO'].includes(String(u.entity)) ? String(u.entity) : 'NESR' }))
    .filter((u) => u.rig_well);
  const pob: Record<string, number | null> = {};
  for (const k of ['operators', 'operators_of', 'supervisors', 'supervisors_of']) {
    const n = b.pob?.[k];
    pob[k] = n === null || n === undefined || (n as unknown) === '' ? null : Math.max(0, Math.min(9999, Math.round(Number(n)) || 0));
  }
  const data: DayRec = { upcoming, pob, notes: str(b.notes, 2000) };
  const country = user.countries[0];
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO sales_daily_days (country, day, data, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (country, day) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(country, day, JSON.stringify(data), user.username, new Date().toISOString()),
    audit(c.env, user, 'edit', day, `Daily report ${day}: ${upcoming.length} upcoming operation(s) typed, people on board updated`),
  ]);
  return c.json({ ok: true });
});

