import type { Env } from './env';
import { WgError, wgGet, wgLogin } from './wg';

// Pulls WIREGUARD reference lists into the wg_* mirror with the read-only service account.
// Upsert by natural key, never delete: rows missing upstream are marked wg_active = 0.

const TOKEN_KEY = 'wg:sync-token';

async function syncToken(env: Env, fresh = false): Promise<string> {
  if (!fresh) {
    const cached = await env.KV.get(TOKEN_KEY);
    if (cached) return cached;
  }
  if (!env.WG_SYNC_USERNAME || !env.WG_SYNC_PASSWORD) throw new WgError(500, 'WG_SYNC_USERNAME / WG_SYNC_PASSWORD are not set');
  const { token } = await wgLogin(env, env.WG_SYNC_USERNAME, env.WG_SYNC_PASSWORD);
  await env.KV.put(TOKEN_KEY, token, { expirationTtl: 11 * 3600 });
  return token;
}

async function fetchAsSync<T>(env: Env, path: string): Promise<T> {
  try {
    return await wgGet<T>(env, await syncToken(env), path);
  } catch (e) {
    if (e instanceof WgError && e.status === 401) return wgGet<T>(env, await syncToken(env, true), path);
    throw e;
  }
}

type ListRow = { name: string; country: string | null; active?: number | boolean | null };

interface Resource {
  name: string;
  path: string;
  table: string;
  upsert: (env: Env, row: any, at: string) => D1PreparedStatement | null;
  where: string; // columns that identify a row, for the deactivate step
}

const listResource = (name: string, path: string, table: string): Resource => ({
  name, path, table, where: 'name, country',
  upsert: (env, r: ListRow, at) => (r.name && r.country)
    ? env.DB.prepare(
        `INSERT INTO ${table} (name, country, wg_active, wg_synced_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (name, country) DO UPDATE SET wg_active = ?3, wg_synced_at = ?4`,
      ).bind(r.name, r.country, r.active === 0 || r.active === false ? 0 : 1, at)
    : null,
});

export const RESOURCES: Resource[] = [
  {
    name: 'units', path: '/units', table: 'wg_units', where: 'unit_number',
    upsert: (env, r: { unit_number: string; country: string | null; year: number | null }, at) => (r.unit_number && r.country)
      ? env.DB.prepare(
          `INSERT INTO wg_units (unit_number, country, year, wg_active, wg_synced_at) VALUES (?1, ?2, ?3, 1, ?4)
           ON CONFLICT (unit_number) DO UPDATE SET country = ?2, year = ?3, wg_active = 1, wg_synced_at = ?4`,
        ).bind(r.unit_number, r.country, r.year ?? null, at)
      : null,
  },
  listResource('job-types', '/job-types', 'wg_job_types'),
  listResource('job-locations', '/job-locations', 'wg_job_locations'),
  listResource('fields', '/fields', 'wg_fields'),
  listResource('rigs', '/rigs', 'wg_rigs'),
];

export async function syncResource(env: Env, res: Resource) {
  const started = new Date().toISOString();
  const logId = crypto.randomUUID();
  try {
    const rows = await fetchAsSync<any[]>(env, res.path);
    const at = new Date().toISOString();
    const stmts = rows.map((r) => res.upsert(env, r, at)).filter((s): s is D1PreparedStatement => !!s);
    // rows without a country are Admin-only in WIREGUARD; they are skipped here and counted
    const skipped = rows.length - stmts.length;
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    const gone = await env.DB.prepare(`UPDATE ${res.table} SET wg_active = 0 WHERE wg_synced_at < ? AND wg_active = 1`).bind(at).run();
    await env.DB.prepare(
      `INSERT INTO wg_sync_log (id, resource, started_at, finished_at, rows_seen, rows_upserted, rows_deactivated, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(logId, res.name, started, new Date().toISOString(), rows.length, stmts.length, gone.meta.changes ?? 0,
      skipped ? `${skipped} rows without a country skipped` : null).run();
    return { resource: res.name, rows: rows.length, upserted: stmts.length, deactivated: gone.meta.changes ?? 0 };
  } catch (e) {
    await env.DB.prepare('INSERT INTO wg_sync_log (id, resource, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?)')
      .bind(logId, res.name, started, new Date().toISOString(), (e as Error).message).run();
    return { resource: res.name, error: (e as Error).message };
  }
}

export async function syncAll(env: Env) {
  const out = [];
  for (const r of RESOURCES) out.push(await syncResource(env, r));
  return out;
}

export async function syncStatus(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT l.resource, l.finished_at, l.rows_seen, l.error FROM wg_sync_log l
     JOIN (SELECT resource, max(started_at) AS s FROM wg_sync_log GROUP BY resource) m
       ON m.resource = l.resource AND m.s = l.started_at
     ORDER BY l.resource`,
  ).all();
  return { resources: results };
}
