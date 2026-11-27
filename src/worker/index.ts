import { filterSql, parseFilters } from '../shared/filters';
import { Hono } from 'hono';
import type { Lookups } from '../shared/types';
import type { AppBindings, Env } from './env';
import { admin } from './admin';
import { passkeyAdmin, passkeyAuth, passkeys } from './passkeys';
import { loadRules, rulesApi, usersFor } from './rules';
import { importWgUsers, wgUserActive } from './wgUsers';
import { syncPeople } from './people';
import { aiAdminGet, aiAdminPut, aiChat, aiStatus, assistantChat, examImport } from './ai';
import { database } from './database';
import { logOptions } from './logOptions';
import { diagrams } from './diagrams';
import { emf } from './emf';
import { failureRoster } from './failureRoster';
import { filterOptions, jobLog } from './jobLog';
import { stats } from './stats';
import { attendance, nightlyJobDays } from './attendance';
import { inventory } from './inventory';
import { preJobNotes } from './preJobNotes';
import { jra } from './jra';
import { knowledge } from './knowledge';
import { competency } from './competency';
import { quickPlan } from './quickPlan';
import { signatures } from './signatures';
import { attachments } from './attachments';
import { wires } from './wires';
import { winch } from './winch';
import { utilities } from './utilities';
import { lessons } from './lessons';
import { jobLogs } from './jobLogs';
import { sendDigests } from './digest';
import { bonus } from './bonus';
import { sales } from './sales';
import { companies } from './companies';
import { jobs } from './jobs';
import { recon, runReconciliation } from './recon';
import { unitEvents } from './unitEvents';
import { audit, authEvent } from './audit';
import { accounts, colorMissingAccounts } from './accounts';
import { riyadhMonth } from '../shared/dates';
import { forms, jobForms } from './forms';
import { isOpenWrite, readAllowed, ruleFor } from './permissions';
import { login, logout, requireSession, resolveSession } from './session';
import { syncAll, syncStatus } from './sync';
import { WgError } from './wg';

const app = new Hono<AppBindings>().basePath('/api');

app.onError((err, c) => {
  if (err instanceof WgError) {
    // WIREGUARD's own details (addresses, paths, library messages) stay in the log
    if (err.status >= 500) { console.error('wireguard', err.message); return c.json({ error: 'WIREGUARD can’t be reached right now. Try again in a few minutes.' }, 503); }
    return c.json({ error: err.message }, err.status === 401 ? 401 : 400);
  }
  console.error(err);
  return c.json({ error: 'Something went wrong on the server' }, 500);
});

// ---- requests that change something must come from this app itself -----------------------------------
// The session cookie is SameSite=Lax, but other nesrapp.com sites count as the same site; the browser's Origin
// header says where a request was made, so a change started from any other page is refused.
app.use('*', async (c, next) => {
  const m = c.req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
  const origin = c.req.header('origin');
  const ours = new Set([new URL(c.req.url).origin, ...(c.env.APP_URL ? [new URL(c.env.APP_URL).origin] : [])]);
  const site = c.req.header('sec-fetch-site');
  if (origin ? !ours.has(origin) : site === 'cross-site' || site === 'same-site') {
    console.warn(`refused: ${m} ${c.req.path} from ${origin ?? site}`);
    return c.json({ error: 'This request came from another site, so it was refused' }, 403);
  }
  return next();
});

// ---- sign-in attempts are limited per address (Cloudflare rate limiting, wrangler.jsonc) ---------------------
app.use('/auth/*', async (c, next) => {
  if (c.req.method !== 'POST' || !c.env.AUTH_LIMIT) return next();
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const { success } = await c.env.AUTH_LIMIT.limit({ key: `auth:${ip}` });
  if (!success) return c.json({ error: 'Too many sign-in attempts. Wait a minute and try again.' }, 429);
  return next();
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
      const msg = e.status === 401 ? 'Wrong username or password' : e.status >= 500 ? 'WIREGUARD can’t be reached right now. Try again in a few minutes.' : e.message;
      if (e.status >= 500) console.error('sign-in', e.message);
      await authEvent(c, username.trim(), 'login_failed', `Password sign-in failed: ${msg}`).run();
      return c.json({ error: msg }, e.status === 401 || e.status === 403 || e.status === 429 ? e.status : 503);
    }
    throw e;
  }
});

// Face ID / fingerprint and QR sign-in (see passkeys.ts)
app.route('/auth', passkeyAuth);

// the sign-in page needs WIREGUARD's address for the forgot-password link, before anyone is signed in
app.get('/public-config', (c) => c.json({ wireguardUrl: c.env.WG_APP_URL ?? 'https://slkwireguard.nesrapp.com' }));

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
  if (method === 'GET' || method === 'HEAD') {
    if (readAllowed(c.req.path, c.get('user').menus)) return next();
    console.warn(`read refused: ${c.req.path}`);
    return c.json({ error: 'Your access does not include this page' }, 403);
  }
  if (isOpenWrite(method, c.req.path)) return next();
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
// The person's own WIREGUARD account (6z.39): 'yes' on, 'no' switched off or missing, 'unknown' unreachable
app.get('/wg/account', async (c) => c.json({ status: await wgUserActive(c.env, c.get('user').username, true) }));
app.post('/wg/sync', async (c) => {
  const results = await syncAll(c.env);
  await c.env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), c.get('user').username, 'run', 'sync', 'wireguard', 'Synced WIREGUARD lists by hand').run();
  return c.json({ results });
});

app.get('/lookups', async (c) => {
  const countries = JSON.stringify(c.get('user').countries);
  const inC = 'country IN (SELECT value FROM json_each(?))';
  const [units, jt, loc, fld, rig, conv, lists, pce, gp, sp, cos] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT unit_number, country, year, wg_active FROM wg_units WHERE wg_active = 1 AND ${inC} ORDER BY unit_number`).bind(countries),
    c.env.DB.prepare(`SELECT DISTINCT name FROM wg_job_types WHERE wg_active = 1 AND ${inC} ORDER BY name`).bind(countries),
    c.env.DB.prepare(`SELECT DISTINCT name FROM wg_job_locations WHERE wg_active = 1 AND ${inC} ORDER BY name`).bind(countries),
    c.env.DB.prepare(`SELECT DISTINCT name FROM wg_fields WHERE wg_active = 1 AND ${inC} ORDER BY name`).bind(countries),
    c.env.DB.prepare(`SELECT DISTINCT name FROM wg_rigs WHERE wg_active = 1 AND ${inC} ORDER BY name`).bind(countries),
    c.env.DB.prepare(`SELECT DISTINCT value FROM lookup_values WHERE kind = 'conveyance' AND active = 1 AND ${inC} ORDER BY sort`).bind(countries),
    c.env.DB.prepare(`SELECT kind, value FROM lookup_values WHERE active = 1 AND kind <> 'conveyance' AND ${inC} GROUP BY kind, value ORDER BY kind, min(sort), value`).bind(countries),
    c.env.DB.prepare(`SELECT id, country, label, kind, bore_in, rating_psi, length_ft, active FROM pce WHERE ${inC} ORDER BY label`).bind(countries),
    c.env.DB.prepare(`SELECT id, country, label, panel_type, active FROM grease_panels WHERE ${inC} ORDER BY label`).bind(countries),
    c.env.DB.prepare('SELECT job_type_name, domain, is_plug, is_fishing, is_memory, is_perforation, is_explosive FROM service_profiles'),
    c.env.DB.prepare('SELECT name FROM companies WHERE active = 1 ORDER BY sort, name'),
  ]);
  const names = (r: D1Result) => (r.results as { name?: string; value?: string }[]).map((x) => (x.name ?? x.value) as string);
  const byKind: Record<string, string[]> = {};
  for (const { kind, value } of lists.results as { kind: string; value: string }[]) (byKind[kind] ??= []).push(value);
  const out: Lookups = {
    units: units.results as unknown as Lookups['units'],
    jobTypes: names(jt), locations: names(loc), fields: names(fld), rigs: names(rig), conveyances: names(conv),
    lists: byKind,
    pce: pce.results as unknown as Lookups['pce'],
    greasePanels: gp.results as unknown as Lookups['greasePanels'],
    serviceProfiles: sp.results as unknown as Lookups['serviceProfiles'],
    companies: names(cos),
  };
  return c.json(out);
});

app.get('/employees', async (c) => {
  await syncPeople(c.env);
  const country = c.req.query('country');
  const countries = c.get('user').countries.filter((x) => !country || x === country);
  const { results } = await c.env.DB.prepare(
    `SELECT id, country, eid, full_name, title, crew_role FROM employees
     WHERE active = 1 AND country IN (SELECT value FROM json_each(?)) ORDER BY full_name`,
  ).bind(JSON.stringify(countries)).all();
  return c.json(results);
});

// people who may be a job's SDM (Users & Roles → Approvals → "Can be the job's SDM")
app.get('/sdms', async (c) => {
  const rules = await loadRules(c.env);
  // SDMs of the caller's countries only (admins see every country anyway)
  const lists = await Promise.all(c.get('user').countries.map((country) => usersFor(c.env, rules, 'job.sdm', country)));
  const people = [...new Map(lists.flat().map((p) => [p.username, p])).values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
  return c.json(people.filter((p) => p.role !== 'admin' || (rules['job.sdm'] ?? []).includes('admin')).map(({ username, full_name }) => ({ username, full_name })));
});

app.get('/schedule', async (c) => {
  const month = c.req.query('month') ?? riyadhMonth(); // the month in Riyadh, like attendance and reconciliation
  if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);
  const first = `${month}-01`;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const countries = JSON.stringify(c.get('user').countries);
  const showCanceled = c.req.query('canceled') === '1';
  // the standard filters apply to the jobs drawn; Unit # also narrows the rows. Year and month don't apply: the
  // schedule shows one month.
  const f = parseFilters(new URL(c.req.url).searchParams);
  const unitFilter = f.unit;
  delete f.year; delete f.month;
  const jf = filterSql(f);
  const unitWhere = unitFilter?.length ? 'AND unit_number IN (SELECT value FROM json_each(?2))' : '';
  const [units, jobsInMonth, events, undated, retired, wires] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT unit_number, country, year, wg_active FROM wg_units WHERE wg_active = 1 AND country IN (SELECT value FROM json_each(?1)) ${unitWhere} ORDER BY unit_number`)
      .bind(...(unitFilter?.length ? [countries, JSON.stringify(unitFilter)] : [countries])),
    c.env.DB.prepare(
      `SELECT j.id, j.ticket_no, j.well, j.rig, j.unit_number, j.status, j.start_date, coalesce(j.end_date, j.start_date) AS end_date, j.sdm_username,
              coalesce((SELECT full_name FROM user_roles u WHERE u.username = j.sdm_username), j.sdm_username) AS sdm_name, j.location, j.field, j.updated_at
       FROM jobs j WHERE j.deleted_at IS NULL AND j.unit_number IS NOT NULL AND j.start_date IS NOT NULL
         AND j.start_date <= ? AND coalesce(j.end_date, j.start_date) >= ?
         AND j.country IN (SELECT value FROM json_each(?)) ${showCanceled ? '' : "AND j.status <> 'canceled'"}
         ${jf.where.map((w) => `AND ${w}`).join(' ')}
       ORDER BY j.start_date`,
    ).bind(last, first, countries, ...jf.binds),
    c.env.DB.prepare(
      `SELECT id, unit_number, kind, detail, starts_on, ends_on, note FROM unit_events
       WHERE starts_on <= ?2 AND ends_on >= ?1 AND country IN (SELECT value FROM json_each(?3))`,
    ).bind(first, last, countries),
    c.env.DB.prepare(
      `SELECT id, ticket_no, well FROM jobs WHERE deleted_at IS NULL AND status <> 'canceled'
         AND (start_date IS NULL OR unit_number IS NULL) AND country IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC LIMIT 50`,
    ).bind(countries),
    // Admin Manual 4: a unit WIREGUARD has deactivated keeps its bookings, so they are listed instead of vanishing
    c.env.DB.prepare(
      `SELECT j.id, j.ticket_no, j.well, j.unit_number, j.start_date FROM jobs j JOIN wg_units u ON u.unit_number = j.unit_number
       WHERE u.wg_active = 0 AND j.deleted_at IS NULL AND j.status IN ('planned','ongoing') AND j.country IN (SELECT value FROM json_each(?))`,
    ).bind(countries),
    // the wire on each drum of the unit, as the WL Hub shows under the unit number ("Alloy, 9/32", 13,400'")
    c.env.DB.prepare(
      `SELECT d.unit_number, d.drum_position, w.wire_grade, w.wire_size, w.remaining_length_ft FROM wg_drums d JOIN wg_wires w ON w.drum_no = d.drum_no
       WHERE d.wg_active = 1 AND w.wg_active = 1 AND lower(coalesce(w.status, 'active')) = 'active' AND d.country IN (SELECT value FROM json_each(?))
       ORDER BY d.unit_number, d.drum_position DESC`,
    ).bind(countries),
  ]);
  return c.json({ month, first, last, units: units.results, jobs: jobsInMonth.results, events: events.results, unscheduled: undated.results, retiredUnitJobs: retired.results, wires: wires.results });
});

app.route('/jobs', jobs);
app.route('/account-colors', accounts);
app.route('/audit', audit);
app.route('/form-templates', forms);
app.route('/job-forms', jobForms);
app.get('/admin/ai', aiAdminGet);
app.put('/admin/ai', aiAdminPut);
app.route('/admin', admin);
app.route('/admin/access', passkeyAdmin);
app.route('/passkeys', passkeys);
app.route('/', rulesApi);
app.route('/database', database);
app.route('/diagrams', diagrams);
app.route('/job-log', jobLog);
app.get('/filter-options', filterOptions);
app.route('/emf', emf);
app.route('/failure-roster', failureRoster);
app.route('/stats', stats);
app.route('/attendance', attendance);
app.route('/inventory', inventory);
app.route('/pre-job-notes', preJobNotes);
app.route('/jra', jra);
app.route('/wires', wires);
app.route('/winch', winch);
app.route('/utilities', utilities);
app.route('/lessons', lessons);
app.route('/joblog', jobLogs);
app.route('/log-options', logOptions);
app.route('/knowledge', knowledge);
// the Competency module's storage (6z.34)
app.route('/competency', competency);
app.route('/quick-plan', quickPlan);
app.route('/signatures', signatures);
app.route('/attachments', attachments);

app.route('/bonus', bonus);
app.route('/sales', sales);
app.route('/companies', companies);
app.route('/recon', recon);

// AI Agent: each tool reads through this same app with the asker's cookie and country switch
app.get('/ai/status', aiStatus);
app.post('/ai/assistant', assistantChat);
app.post('/ai/exam-import', examImport);
app.post('/ai/chat', (c) => aiChat(c, (path) => {
  const headers = new Headers();
  for (const h of ['cookie', 'x-slk-country']) { const v = c.req.header(h); if (v) headers.set(h, v); }
  return Promise.resolve(app.fetch(new Request(new URL(`/api${path}`, c.req.url), { headers }), c.env, c.executionCtx));
}));
app.route('/unit-events', unitEvents);

app.get('/config', (c) => c.json({ wireguardUrl: c.env.WG_APP_URL ?? 'https://slkwireguard.nesrapp.com', reconStartDate: c.env.RECON_START_DATE ?? '2026-10-01' }));

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === '0 1 * * *') {
      // 04:00 Riyadh: fresh pull, then reconcile every country WIREGUARD shares with the sync account.
      // Each step runs on its own: one failing is logged and the rest still run.
      ctx.waitUntil((async () => {
        const step = async (name: string, run: () => Promise<unknown>) => {
          try { await run(); } catch (e) {
            console.error(`nightly: ${name} failed`, e);
            await env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
              .bind(crypto.randomUUID(), 'nightly', 'failed', 'nightly', name, `Nightly ${name} failed: ${(e as Error).message}`.slice(0, 500)).run().catch(() => {});
          }
        };
        await step('WIREGUARD sync', () => syncAll(env, { hourly: true }));
        await step('reconciliation', async () => {
          const { results } = await env.DB.prepare('SELECT DISTINCT country FROM wg_units WHERE wg_active = 1').all<{ country: string }>();
          await runReconciliation(env, results.map((r) => r.country), 'nightly');
        });
        // the digest goes out once a day, even if the nightly job is run again
        await step('digest email', async () => {
          const key = `digest:${new Date(event.scheduledTime).toISOString().slice(0, 10)}`;
          if (await env.KV.get(key)) return;
          await sendDigests(env);
          await env.KV.put(key, '1', { expirationTtl: 3 * 86400 });
        });
        // WIREGUARD's people: names, emails, employee IDs and who is still active (Users & Roles)
        await step('WIREGUARD user import', () => importWgUsers(env, 'nightly sync'));
        // the month's attendance days from the jobs, ready before anyone opens the sheet
        await step('attendance from jobs', () => nightlyJobDays(env));
        // the people list follows the users (moved here from page views)
        await step('people sync', () => syncPeople(env));
        await step('account colours', () => colorMissingAccounts(env));
        // housekeeping: sync log and resolved reconciliation findings older than 90 days (explained ones stay, so
        // they are not raised again)
        await step('clean-up', async () => {
          const cut = new Date(event.scheduledTime - 90 * 86400_000).toISOString();
          await env.DB.batch([
            env.DB.prepare('DELETE FROM wg_sync_log WHERE started_at < ?').bind(cut),
            env.DB.prepare("DELETE FROM recon_findings WHERE status = 'resolved' AND coalesce(resolved_at, last_seen_at) < ?").bind(cut),
          ]);
        });
      })());
      return;
    }
    // runs every 15 minutes; documents, settings and the build stamp only on the hour. The nightly job does its own
    // full pull at 01:00 UTC, so the quarter-hour run then is skipped.
    const at = new Date(event.scheduledTime);
    if (at.getUTCHours() === 1 && at.getUTCMinutes() < 15) return;
    ctx.waitUntil(syncAll(env, { hourly: at.getUTCMinutes() < 15 }));
  },
} satisfies ExportedHandler<Env>;
