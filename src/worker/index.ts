import { Hono } from 'hono';
import type { Lookups } from '../shared/types';
import type { AppBindings, Env } from './env';
import { admin } from './admin';
import { jobs } from './jobs';
import { isOpenWrite, ruleFor } from './permissions';
import { login, logout, requireSession, resolveSession } from './session';
import { syncAll, syncStatus } from './sync';
import { WgError } from './wg';

const app = new Hono<AppBindings>().basePath('/api');

app.onError((err, c) => {
  if (err instanceof WgError) return c.json({ error: err.message }, err.status === 401 ? 401 : err.status >= 500 ? 503 : 400);
  console.error(err);
  return c.json({ error: 'Something went wrong on the server' }, 500);
});

// ---- sign-in (WIREGUARD accounts) ----------------------------------------------------------------

app.post('/auth/login', async (c) => {
  const { username, password } = await c.req.json<{ username?: string; password?: string }>().catch(() => ({} as { username?: string; password?: string }));
  if (!username || !password) return c.json({ error: 'Enter your WIREGUARD username and password' }, 400);
  try {
    const result = await login(c, username, password);
    // first sign-in on an empty database: fetch WIREGUARD's lists so the screens have units to show
    const hasUnits = await c.env.DB.prepare('SELECT 1 FROM wg_units LIMIT 1').first();
    if (!hasUnits) c.executionCtx.waitUntil(syncAll(c.env));
    return c.json(result);
  } catch (e) {
    if (e instanceof WgError) {
      const msg = e.status === 401 ? 'Wrong username or password' : e.message;
      return c.json({ error: msg }, e.status === 401 || e.status === 403 || e.status === 429 ? e.status : 503);
    }
    throw e;
  }
});

app.post('/auth/logout', async (c) => {
  await logout(c);
  return c.json({ ok: true });
});

// Answers 200 either way, so a signed-out page load is not an error. 503 only when WIREGUARD can't confirm.
app.get('/session', async (c) => {
  const r = await resolveSession(c);
  if ('error' in r) return r.status === 503 ? c.json({ error: r.error }, 503) : c.json({ user: null, reason: r.error });
  const { sessionId: _s, ...me } = r.user;
  return c.json({ user: me });
});

// ---- everything below needs a session; writes also need their WRITE_RULE ------------------------

app.use('*', requireSession);
app.use('*', async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || isOpenWrite(method, c.req.path)) return next();
  const rule = ruleFor(method, c.req.path);
  if (!rule) {
    console.warn(`write refused, no WRITE_RULE: ${method} ${c.req.path}`);
    return c.json({ error: 'This action is not allowed' }, 403);
  }
  if (!c.get('user').menus[rule.menu]?.[rule.action]) return c.json({ error: 'Your role cannot do this here' }, 403);
  return next();
});

app.get('/me', (c) => {
  const { sessionId: _s, ...me } = c.get('user');
  return c.json(me);
});

app.get('/wg/status', async (c) => c.json(await syncStatus(c.env)));
app.post('/wg/sync', async (c) => c.json({ results: await syncAll(c.env) }));

app.get('/lookups', async (c) => {
  const countries = JSON.stringify(c.get('user').countries);
  const inC = 'country IN (SELECT value FROM json_each(?))';
  const [units, jt, loc, fld, rig, conv] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT unit_number, country, year, wg_active FROM wg_units WHERE wg_active = 1 AND ${inC} ORDER BY unit_number`).bind(countries),
    c.env.DB.prepare(`SELECT DISTINCT name FROM wg_job_types WHERE wg_active = 1 AND ${inC} ORDER BY name`).bind(countries),
    c.env.DB.prepare(`SELECT DISTINCT name FROM wg_job_locations WHERE wg_active = 1 AND ${inC} ORDER BY name`).bind(countries),
    c.env.DB.prepare(`SELECT DISTINCT name FROM wg_fields WHERE wg_active = 1 AND ${inC} ORDER BY name`).bind(countries),
    c.env.DB.prepare(`SELECT DISTINCT name FROM wg_rigs WHERE wg_active = 1 AND ${inC} ORDER BY name`).bind(countries),
    c.env.DB.prepare(`SELECT DISTINCT value FROM lookup_values WHERE kind = 'conveyance' AND active = 1 AND ${inC} ORDER BY sort`).bind(countries),
  ]);
  const names = (r: D1Result) => (r.results as { name?: string; value?: string }[]).map((x) => (x.name ?? x.value) as string);
  const out: Lookups = {
    units: units.results as unknown as Lookups['units'],
    jobTypes: names(jt), locations: names(loc), fields: names(fld), rigs: names(rig), conveyances: names(conv),
  };
  return c.json(out);
});

app.get('/sdms', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT username, full_name FROM user_roles WHERE active = 1 AND role IN ('sdm','deputy_sdm','operations_manager') ORDER BY full_name`,
  ).all();
  return c.json(results);
});

app.get('/schedule', async (c) => {
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);
  const first = `${month}-01`;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const countries = JSON.stringify(c.get('user').countries);
  const showCanceled = c.req.query('canceled') === '1';
  const [units, jobsInMonth, events, undated] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT unit_number, country, year, wg_active FROM wg_units WHERE wg_active = 1 AND country IN (SELECT value FROM json_each(?)) ORDER BY unit_number`).bind(countries),
    c.env.DB.prepare(
      `SELECT j.id, j.ticket_no, j.well, j.rig, j.unit_number, j.status, j.start_date, coalesce(j.end_date, j.start_date) AS end_date, j.sdm_username
       FROM jobs j WHERE j.deleted_at IS NULL AND j.unit_number IS NOT NULL AND j.start_date IS NOT NULL
         AND j.start_date <= ?2 AND coalesce(j.end_date, j.start_date) >= ?1
         AND j.country IN (SELECT value FROM json_each(?3)) ${showCanceled ? '' : "AND j.status <> 'canceled'"}
       ORDER BY j.start_date`,
    ).bind(first, last, countries),
    c.env.DB.prepare(
      `SELECT id, unit_number, kind, starts_on, ends_on, note FROM unit_events
       WHERE starts_on <= ?2 AND ends_on >= ?1 AND country IN (SELECT value FROM json_each(?3))`,
    ).bind(first, last, countries),
    c.env.DB.prepare(
      `SELECT id, ticket_no, well FROM jobs WHERE deleted_at IS NULL AND status <> 'canceled'
         AND (start_date IS NULL OR unit_number IS NULL) AND country IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC LIMIT 50`,
    ).bind(countries),
  ]);
  return c.json({ month, first, last, units: units.results, jobs: jobsInMonth.results, events: events.results, unscheduled: undated.results });
});

app.route('/jobs', jobs);
app.route('/admin', admin);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // runs every 15 minutes; documents, settings and the build stamp only on the hour
    ctx.waitUntil(syncAll(env, { hourly: new Date(event.scheduledTime).getUTCMinutes() < 15 }));
  },
} satisfies ExportedHandler<Env>;
