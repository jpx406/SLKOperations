// Worker integration tests: the real Hono app (src/worker/index.ts) against a local, throw-away D1, KV and R2 from
// wrangler's getPlatformProxy (in memory, nothing persisted). Each test file starts its own copy with every migration
// in replica/migrations applied in order.
//
// Stubs: WIREGUARD is a fake fetcher that answers 404 and records every call (tests assert it is never called);
// e-mail and the sign-in rate limit are left out (both are optional in env.ts).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler';
import worker from '../../src/worker/index';
import type { Env, Session } from '../../src/worker/env';

export const ORIGIN = 'https://slkops.test';
export const COUNTRY = 'KSA';
const MIGRATIONS = join(process.cwd(), 'replica', 'migrations');

export interface TestApp {
  env: Env;
  /** URLs the app tried to reach on WIREGUARD. Must stay empty. */
  wgCalls: string[];
  dispose(): Promise<void>;
}

type Bindings = { DB: D1Database; KV: KVNamespace; FILES: R2Bucket };

export async function startApp(): Promise<TestApp> {
  const proxy = await getPlatformProxy<Bindings>({
    configPath: join(process.cwd(), 'tests', 'worker', 'wrangler.test.jsonc'),
    persist: false, remoteBindings: false, envFiles: [],
  });
  const DB = proxy.env.DB;
  for (const f of readdirSync(MIGRATIONS).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
    const stmts = unstable_splitSqlQuery(readFileSync(join(MIGRATIONS, f), 'utf8'));
    try { await DB.batch(stmts.map((s) => DB.prepare(s))); } catch (e) { throw new Error(`migration ${f} failed: ${(e as Error).message}`); }
  }
  const wgCalls: string[] = [];
  const wireguard = {
    fetch: async (input: RequestInfo | URL) => {
      wgCalls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return new Response(JSON.stringify({ error: 'not here in tests' }), { status: 404, headers: { 'content-type': 'application/json' } });
    },
    connect: () => { throw new Error('WIREGUARD is not reachable in tests'); },
  } as unknown as Fetcher;
  const env: Env = {
    DB, KV: proxy.env.KV, FILES: proxy.env.FILES,
    WIREGUARD: wireguard,
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) } as unknown as Fetcher,
    APP_URL: ORIGIN, IDLE_MINUTES: '60', RECON_START_DATE: '2020-01-01', WG_APP_URL: 'https://wireguard.test',
  };
  return { env, wgCalls, dispose: () => proxy.dispose() };
}

const ctx = (): ExecutionContext => ({ waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext);

export interface UserOpts { role: string; countries?: string[]; fullName?: string; passkeyAllowed?: boolean; active?: boolean }

/** A user_roles row plus a fresh Face ID session, so no WIREGUARD check happens. Returns the Cookie header. */
export async function signIn(t: TestApp, username: string, o: UserOpts): Promise<string> {
  const countries = o.countries ?? [COUNTRY];
  await t.env.DB.prepare(
    `INSERT INTO user_roles (username, full_name, role, countries, active, passkey_allowed) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (username) DO UPDATE SET full_name = ?2, role = ?3, countries = ?4, active = ?5, passkey_allowed = ?6`,
  ).bind(username, o.fullName ?? username, o.role, JSON.stringify(countries), o.active === false ? 0 : 1, o.passkeyAllowed === false ? 0 : 1).run();
  const id = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const now = Date.now();
  const s: Session = { username, fullName: o.fullName ?? username, wgRole: null, countries, method: 'passkey', createdAt: now, lastSeen: now, validatedAt: now };
  await t.env.KV.put(`session:${id}`, JSON.stringify(s));
  return `__Host-slk_session=${id}`;
}

export interface CallOpts { cookie?: string; body?: unknown; origin?: string | null; headers?: Record<string, string>; raw?: BodyInit }

/** Calls the app as the browser would. Writes carry this app's Origin unless another (or null) is given. */
export async function call(t: TestApp, method: string, path: string, o: CallOpts = {}) {
  const headers = new Headers(o.headers);
  if (o.cookie) headers.set('cookie', o.cookie);
  if (method !== 'GET' && method !== 'HEAD') {
    if (o.origin !== null) headers.set('origin', o.origin ?? ORIGIN);
  }
  let body: BodyInit | undefined = o.raw;
  if (o.body !== undefined) { body = JSON.stringify(o.body); headers.set('content-type', 'application/json'); }
  const res = await worker.fetch(new Request(`${ORIGIN}/api${path}`, { method, headers, body }), t.env, ctx());
  const text = await res.text();
  let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

/** Rows from the test database. */
export async function rows<T = Record<string, unknown>>(t: TestApp, sql: string, ...binds: unknown[]): Promise<T[]> {
  return (await t.env.DB.prepare(sql).bind(...binds).all<T>()).results;
}

export async function run(t: TestApp, sql: string, ...binds: unknown[]) {
  await t.env.DB.prepare(sql).bind(...binds).run();
}

const SYNCED = '2026-10-01T00:00:00Z';

/** A job row with only what the test needs; other columns take their defaults. */
export async function addJob(t: TestApp, j: { id?: string; country?: string; status?: string; ticket_no?: string; unit_number?: string | null; start_date?: string | null; end_date?: string | null; sdm_username?: string | null; well?: string; location?: string }) {
  const id = j.id ?? crypto.randomUUID();
  await run(t, `INSERT INTO jobs (id, country, status, ticket_no, unit_number, start_date, end_date, sdm_username, well, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, j.country ?? COUNTRY, j.status ?? 'planned', j.ticket_no ?? null, j.unit_number ?? null, j.start_date ?? null, j.end_date ?? null, j.sdm_username ?? null, j.well ?? null, j.location ?? null);
  return id;
}

export async function addEmployee(t: TestApp, e: { id?: string; full_name: string; wg_username?: string | null; crew_role?: string | null; country?: string; attendance_category?: string | null }) {
  const id = e.id ?? crypto.randomUUID();
  await run(t, `INSERT INTO employees (id, country, eid, full_name, title, wg_username, crew_role, attendance_category) VALUES (?, ?, ?, ?, 'Staff', ?, ?, ?)`,
    id, e.country ?? COUNTRY, `E-${id.slice(0, 8)}`, e.full_name, e.wg_username ?? null, e.crew_role ?? null, e.attendance_category ?? null);
  return id;
}

export const wgUnit = (t: TestApp, unit: string, country = COUNTRY) =>
  run(t, 'INSERT INTO wg_units (unit_number, country, wg_active, wg_synced_at) VALUES (?, ?, 1, ?)', unit, country, SYNCED);
export const wgDrum = (t: TestApp, drum: string, unit: string, country = COUNTRY) =>
  run(t, 'INSERT INTO wg_drums (drum_no, unit_number, country, wg_active, wg_synced_at) VALUES (?, ?, ?, 1, ?)', drum, unit, country, SYNCED);
export const wgRun = (t: TestApp, r: { wg_id: string; job_date: string; drum_no: string; country?: string; field_ticket?: string | null; is_cut_only?: number }) =>
  run(t, 'INSERT INTO wg_runs (wg_id, job_date, drum_no, country, field_ticket, is_cut_only, wg_active, wg_synced_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
    r.wg_id, r.job_date, r.drum_no, r.country ?? COUNTRY, r.field_ticket ?? null, r.is_cut_only ?? 0, SYNCED);

/** YYYY-MM-DD, n days from today (UTC). */
export const daysFromNow = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
