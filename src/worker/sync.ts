import type { Env } from './env';
import { WgError, wgGet, wgLogin } from './wg';
import { checkKpiSource, KPI_VERIFIED, PORTED_KPIS, sameBuild } from '../shared/kpiSource';

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

export async function fetchAsSync<T>(env: Env, path: string): Promise<T> {
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
  where: string; // columns that identify a row
  /** SQL for a row's key and the same key from a WIREGUARD row: rows not seen in a pull are marked inactive by key. */
  keySql: string;
  key: (row: any) => string | null;
  hourly?: boolean; // pulled on the hour only (plus on demand)
}

const listResource = (name: string, path: string, table: string): Resource => ({
  name, path, table, where: 'name, country', keySql: "name || char(31) || country", key: (r: ListRow) => (r.name && r.country ? `${r.name}\u001f${r.country}` : null),
  upsert: (env, r: ListRow, at) => (r.name && r.country)
    ? env.DB.prepare(
        `INSERT INTO ${table} (name, country, wg_active, wg_synced_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (name, country) DO UPDATE SET wg_active = ?3, wg_synced_at = ?4 WHERE ${table}.wg_active IS NOT excluded.wg_active`,
      ).bind(r.name, r.country, r.active === 0 || r.active === false ? 0 : 1, at)
    : null,
});

export const RESOURCES: Resource[] = [
  {
    name: 'units', path: '/units', table: 'wg_units', where: 'unit_number', keySql: 'unit_number', key: (r) => (r.unit_number && r.country ? String(r.unit_number) : null),
    upsert: (env, r: { unit_number: string; country: string | null; year: number | null }, at) => (r.unit_number && r.country)
      ? env.DB.prepare(
          `INSERT INTO wg_units (unit_number, country, year, wg_active, wg_synced_at) VALUES (?1, ?2, ?3, 1, ?4)
           ON CONFLICT (unit_number) DO UPDATE SET country = ?2, year = ?3, wg_active = 1, wg_synced_at = ?4
           WHERE wg_units.country IS NOT excluded.country OR wg_units.year IS NOT excluded.year OR wg_units.wg_active = 0`,
        ).bind(r.unit_number, r.country, r.year ?? null, at)
      : null,
  },
  listResource('job-types', '/job-types', 'wg_job_types'),
  listResource('job-locations', '/job-locations', 'wg_job_locations'),
  listResource('fields', '/fields', 'wg_fields'),
  listResource('rigs', '/rigs', 'wg_rigs'),
  {
    name: 'drums', path: '/drums', table: 'wg_drums', where: 'drum_no', keySql: 'drum_no', key: (r) => (r.drum_no ? String(r.drum_no) : null),
    upsert: (env, r: WgDrum, at) => r.drum_no
      ? env.DB.prepare(
          `INSERT INTO wg_drums (drum_no, drum_position, unit_number, country, field, wg_active, raw, wg_synced_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT (drum_no) DO UPDATE SET drum_position = ?2, unit_number = ?3, country = ?4, field = ?5, wg_active = ?6, raw = ?7, wg_synced_at = ?8
           WHERE wg_drums.raw IS NOT excluded.raw OR wg_drums.wg_active IS NOT excluded.wg_active`,
        ).bind(r.drum_no, r.drum_position ?? null, r.slickline_unit ?? null, r.country ?? null, r.field ?? null, r.active === 0 ? 0 : 1, JSON.stringify(r), at)
      : null,
  },
  {
    name: 'wires', path: '/wires', table: 'wg_wires', where: 'wire_serial_number', keySql: 'wire_serial_number', key: (r) => (r.wire_serial_number ? String(r.wire_serial_number) : null),
    upsert: (env, r: WgWire, at) => r.wire_serial_number
      ? env.DB.prepare(
          `INSERT INTO wg_wires (wire_serial_number, wire_grade, wire_size, manufacturer, drum_no, spooled_length_ft, status, rated_mbl_lb, country, raw, wg_active, wg_synced_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11)
           ON CONFLICT (wire_serial_number) DO UPDATE SET wire_grade = ?2, wire_size = ?3, manufacturer = ?4, drum_no = ?5, spooled_length_ft = ?6,
             status = ?7, rated_mbl_lb = ?8, country = ?9, raw = ?10, wg_active = 1, wg_synced_at = ?11
           WHERE wg_wires.raw IS NOT excluded.raw OR wg_wires.wg_active = 0`,
        ).bind(String(r.wire_serial_number), r.wire_grade ?? null, r.wire_size != null ? String(r.wire_size) : null, r.manufacturer ?? null,
          r.drum_no ?? null, toNum(r.spooled_length), r.status ?? null, toNum(r.rated_mbl), r.country ?? null, JSON.stringify(r), at)
      : null,
  },
  {
    // every status, so runs still awaiting approval are visible to reconciliation
    name: 'runs', path: '/jobs?status=all', table: 'wg_runs', where: 'wg_id', keySql: 'wg_id', key: (r) => (r.id && r.job_date ? String(r.id) : null),
    upsert: (env, r: WgRun, at) => r.id && r.job_date
      ? env.DB.prepare(
          `INSERT INTO wg_runs (wg_id, job_date, drss_number, field_ticket, run_number, wire_serial_number, drum_no, country, job_name, location, rig,
             field_name, well, well_type, max_depth_ft, max_tension_lb, jarring_minutes, jarring_impact_count, wire_cut_ft, hours_working,
             remaining_length_ft, h2s_percent, co2_percent, supervisor_name, approval_status, approved_at, entered_at, is_cut_only, raw, wg_active, wg_synced_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, 1, ?30)
           ON CONFLICT (wg_id) DO UPDATE SET job_date = ?2, drss_number = ?3, field_ticket = ?4, run_number = ?5, wire_serial_number = ?6, drum_no = ?7,
             country = ?8, job_name = ?9, location = ?10, rig = ?11, field_name = ?12, well = ?13, well_type = ?14, max_depth_ft = ?15, max_tension_lb = ?16,
             jarring_minutes = ?17, jarring_impact_count = ?18, wire_cut_ft = ?19, hours_working = ?20, remaining_length_ft = ?21, h2s_percent = ?22,
             co2_percent = ?23, supervisor_name = ?24, approval_status = ?25, approved_at = ?26, entered_at = ?27, is_cut_only = ?28, raw = ?29,
             wg_active = 1, wg_synced_at = ?30
           WHERE wg_runs.raw IS NOT excluded.raw OR wg_runs.wg_active = 0`,
        ).bind(r.id, String(r.job_date).slice(0, 10), r.drss_number ?? null, r.field_ticket ?? null, toNum(r.run_number), r.wire_serial_number != null ? String(r.wire_serial_number) : null,
          r.drum_no ?? null, r.country ?? null, r.job_name ?? null, r.location ?? null, r.rig ?? null, r.field_name ?? null, r.well_rig ?? null, r.well_type ?? null,
          toNum(r.max_depth), toNum(r.max_tension), toNum(r.jarring_minutes), toNum(r.jarring_impact_count), toNum(r.wire_cut_feet), toNum(r.hours_working),
          toNum(r.remaining_length_feet), toNum(r.h2s_percent), toNum(r.co2_percent), r.supervisor_name ?? null,
          (r.approval_status ?? 'pending').toLowerCase(), r.approved_at ?? null, r.input_date ?? r.created_at ?? null, isCutOnly(r) ? 1 : 0, JSON.stringify(r), at)
      : null,
  },
  {
    name: 'documents', path: '/documents?status=all', table: 'wg_documents', where: 'wg_id', keySql: 'wg_id', key: (r) => (r.id ? String(r.id) : null), hourly: true,
    upsert: (env, r: WgDocument, at) => r.id
      ? env.DB.prepare(
          `INSERT INTO wg_documents (wg_id, doc_type, wire_serial_number, drum_no, test_type, result, test_date, expiry_date, approval_status, raw, wg_synced_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
           ON CONFLICT (wg_id) DO UPDATE SET doc_type = ?2, wire_serial_number = ?3, drum_no = ?4, test_type = ?5, result = ?6, test_date = ?7,
             expiry_date = ?8, approval_status = ?9, raw = ?10, wg_synced_at = ?11, wg_active = 1
           WHERE wg_documents.raw IS NOT excluded.raw OR wg_documents.wg_active = 0`,
        ).bind(r.id, r.doc_type ?? null, r.wire_serial_number != null ? String(r.wire_serial_number) : null, r.drum_no ?? null, r.test_type ?? null,
          r.result ?? null, r.test_date ?? null, r.expiry_date ?? null, (r.approval_status ?? 'pending').toLowerCase(), JSON.stringify(r), at)
      : null,
  },
  {
    // WIREGUARD sends every country's alerts; the country is resolved here from the wire or drum
    name: 'notifications', path: '/notifications', table: 'wg_notifications', where: 'wg_id', keySql: 'wg_id', key: (r) => (r.id ? String(r.id) : null),
    upsert: (env, r: WgNotification, at) => r.id
      ? env.DB.prepare(
          `INSERT INTO wg_notifications (wg_id, occurred_at, severity, code, message, wire_serial_number, drum_no, country, is_read, resolved_at, raw, wg_synced_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7,
             coalesce((SELECT country FROM wg_wires WHERE wire_serial_number = ?6), (SELECT country FROM wg_drums WHERE drum_no = ?7)), ?8, ?10, ?11, ?9)
           ON CONFLICT (wg_id) DO UPDATE SET severity = ?3, code = ?4, message = ?5, wire_serial_number = ?6, drum_no = ?7,
             country = coalesce((SELECT country FROM wg_wires WHERE wire_serial_number = ?6), (SELECT country FROM wg_drums WHERE drum_no = ?7)),
             is_read = ?8, resolved_at = ?10, raw = ?11, wg_synced_at = ?9, wg_active = 1
           WHERE wg_notifications.raw IS NOT excluded.raw OR wg_notifications.wg_active = 0 OR wg_notifications.country IS NULL`,
        ).bind(r.id, r.occurred_at ?? new Date().toISOString(), r.severity ?? r.sev ?? null, r.code ?? null, r.message ?? null,
          r.wire_serial_number != null ? String(r.wire_serial_number) : null, r.drum_no ?? null, r.read ? 1 : 0, at, r.resolved_at ?? null, JSON.stringify(r))
      : null,
  },
];

// Parameters the ported wire KPIs need, stored as JSON under their endpoint name.
const SETTINGS = ['kpi-settings', 'sop-settings', 'sop-wire-size-thresholds', 'wire-alloy-database', 'wire-retirement-reasons'];

interface WgDrum { drum_no: string; drum_position?: string; slickline_unit?: string; country?: string; field?: string; active?: number }
interface WgWire { wire_serial_number: string | number; wire_grade?: string; wire_size?: string | number; manufacturer?: string; drum_no?: string; spooled_length?: string | number; status?: string; rated_mbl?: number; country?: string }
interface WgRun {
  id: string; job_date: string; drss_number?: string; field_ticket?: string; run_number?: number; wire_serial_number?: string | number; drum_no?: string;
  country?: string; job_name?: string; location?: string; rig?: string; field_name?: string; well_rig?: string; well_type?: string; max_depth?: number;
  max_tension?: number; jarring_minutes?: number; jarring_impact_count?: number; wire_cut_feet?: number; hours_working?: number; remaining_length_feet?: number;
  h2s_percent?: number; co2_percent?: number; supervisor_name?: string; approval_status?: string; approved_at?: string; input_date?: string; created_at?: string;
  source_document_id?: string;
}
interface WgDocument { id: string; doc_type?: string; wire_serial_number?: string | number; drum_no?: string; test_type?: string; result?: string; test_date?: string; expiry_date?: string; approval_status?: string }
interface WgNotification { id: string; occurred_at?: string; severity?: string; sev?: string; code?: string; message?: string; wire_serial_number?: string | number; drum_no?: string; read?: number; resolved_at?: string | null }

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** WIREGUARD's own rule: these rows record wire consumed, never a run. */
export const isCutOnly = (r: { job_name?: string | null; drss_number?: string | null; source_document_id?: string | null }) =>
  !!r.source_document_id || r.job_name === 'Maintenance Wire cut' || r.drss_number === 'SPOOL-AD';

export async function syncResource(env: Env, res: Resource) {
  const started = new Date().toISOString();
  const logId = crypto.randomUUID();
  try {
    const rows = await fetchAsSync<any[]>(env, res.path);
    const at = new Date().toISOString();
    const stmts = rows.map((r) => res.upsert(env, r, at)).filter((s): s is D1PreparedStatement => !!s);
    // rows without a country are Admin-only in WIREGUARD; they are skipped here and counted
    const skipped = rows.length - stmts.length;
    // unchanged rows are not rewritten (each upsert only writes when something differs)
    let written = 0;
    for (let i = 0; i < stmts.length; i += 100) {
      const done = await env.DB.batch(stmts.slice(i, i + 100));
      written += done.reduce((n, d) => n + (d.meta.changes ?? 0), 0);
    }
    const seen = new Set(rows.map((r) => res.key(r)).filter((k): k is string => !!k));
    const { results: active } = await env.DB.prepare(`SELECT ${res.keySql} AS k FROM ${res.table} WHERE wg_active = 1`).all<{ k: string }>();
    const missing = active.map((a) => a.k).filter((k) => !seen.has(k));
    // an empty pull, or one that drops more than a fifth of the list, is taken as a WIREGUARD problem, not real removals
    const suspicious = missing.length > 0 && (rows.length === 0 || (missing.length > 5 && missing.length > active.length * 0.2));
    let gone = 0;
    if (!suspicious) {
      for (let i = 0; i < missing.length; i += 400) {
        const r = await env.DB.prepare(`UPDATE ${res.table} SET wg_active = 0 WHERE wg_active = 1 AND ${res.keySql} IN (SELECT value FROM json_each(?))`)
          .bind(JSON.stringify(missing.slice(i, i + 400))).run();
        gone += r.meta.changes ?? 0;
      }
    }
    const notes = [skipped ? `${skipped} rows without a country skipped` : '', suspicious ? `${missing.length} of ${active.length} rows missing from WIREGUARD: kept active, check the WIREGUARD list` : ''].filter(Boolean).join('; ');
    if (suspicious) console.warn('sync: kept rows active', res.name, missing.length, active.length);
    await env.DB.prepare(
      `INSERT INTO wg_sync_log (id, resource, started_at, finished_at, rows_seen, rows_upserted, rows_deactivated, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(logId, res.name, started, new Date().toISOString(), rows.length, written, gone, notes || null).run();
    return { resource: res.name, rows: rows.length, upserted: written, deactivated: gone, ...(suspicious ? { warning: notes } : {}) };
  } catch (e) {
    await env.DB.prepare('INSERT INTO wg_sync_log (id, resource, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?)')
      .bind(logId, res.name, started, new Date().toISOString(), (e as Error).message).run();
    return { resource: res.name, error: (e as Error).message };
  }
}

/** WIREGUARD parameters, stored whole. */
async function syncSettings(env: Env) {
  const started = new Date().toISOString();
  try {
    const at = new Date().toISOString();
    const stmts: D1PreparedStatement[] = [];
    for (const key of SETTINGS) {
      const value = await fetchAsSync<unknown>(env, `/${key}`);
      stmts.push(env.DB.prepare('INSERT INTO wg_settings (key, value, wg_synced_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = ?2, wg_synced_at = ?3')
        .bind(key, JSON.stringify(value), at));
    }
    await env.DB.batch(stmts);
    await env.DB.prepare('INSERT INTO wg_sync_log (id, resource, started_at, finished_at, rows_seen, rows_upserted, error) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), 'settings', started, new Date().toISOString(), stmts.length, stmts.length, null).run();
    return { resource: 'settings', upserted: stmts.length };
  } catch (e) {
    await env.DB.prepare('INSERT INTO wg_sync_log (id, resource, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), 'settings', started, new Date().toISOString(), (e as Error).message).run();
    return { resource: 'settings', error: (e as Error).message };
  }
}

/**
 * KPI parity watch, every sync: reads WIREGUARD's build stamp and, the first time a build is seen, the KPI code in its
 * v2-patch.js. A build whose KPI code is unchanged is recorded as checked, so the warning clears by itself. A build that
 * changed it is recorded as not matching, and stays flagged until the parity test passes against it.
 */
export async function watchBuild(env: Env) {
  const started = new Date().toISOString();
  try {
    const shell = await env.WIREGUARD.fetch(new Request('https://wireguard/')).then((r) => r.text());
    const stamp = /<meta\s+name="app-build"\s+content="([^"]+)"/i.exec(shell)?.[1] ?? null;
    if (!stamp) throw new Error('build stamp not found');
    await env.DB.prepare(`INSERT INTO wg_settings (key, value, wg_synced_at) VALUES ('build_stamp', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?1, wg_synced_at = ?2`)
      .bind(JSON.stringify(stamp), started).run();
    const seen = await env.DB.prepare('SELECT id FROM kpi_parity_runs WHERE wg_build = ? LIMIT 1').bind(stamp).first();
    if (seen || sameBuild(stamp, KPI_VERIFIED.build)) return { resource: 'build', build: stamp };
    const res = await env.WIREGUARD.fetch(new Request(`https://wireguard/v2-patch.js?b=${encodeURIComponent(stamp)}`));
    if (!res.ok) throw new Error(`v2-patch.js answered ${res.status}`);
    const r = await checkKpiSource(await res.text());
    await env.DB.prepare('INSERT INTO kpi_parity_runs (id, wg_build, kpis_checked, kpis_failed, report, run_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), stamp, r.match ? PORTED_KPIS : 0, r.match ? 0 : PORTED_KPIS,
        JSON.stringify({ method: 'source fingerprint', match: r.match, reason: r.reason, hash: r.hash, verified_build: KPI_VERIFIED.build }), started).run();
    await env.DB.prepare('INSERT INTO wg_sync_log (id, resource, started_at, finished_at, rows_seen, rows_upserted, error) VALUES (?, ?, ?, ?, 1, 1, ?)')
      .bind(crypto.randomUUID(), 'kpi parity', started, new Date().toISOString(), r.match ? null : `${stamp}: ${r.reason}`).run();
    return { resource: 'build', build: stamp, kpiMatch: r.match };
  } catch (e) {
    await env.DB.prepare('INSERT INTO wg_sync_log (id, resource, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), 'build', started, new Date().toISOString(), (e as Error).message).run();
    return { resource: 'build', error: (e as Error).message };
  }
}

/** Remaining length on each wire = the latest approved run's figure in WIREGUARD's job log. */
async function deriveRemainingLength(env: Env) {
  const latest = `(SELECT r.remaining_length_ft FROM wg_runs r
       WHERE r.wire_serial_number = wg_wires.wire_serial_number AND r.wg_active = 1 AND r.approval_status = 'approved' AND r.remaining_length_ft IS NOT NULL
       ORDER BY r.job_date DESC, r.run_number DESC LIMIT 1)`;
  await env.DB.prepare(`UPDATE wg_wires SET remaining_length_ft = ${latest} WHERE remaining_length_ft IS NOT ${latest}`).run();
}

/** Full pull on demand; the 15-minute cron skips the hourly resources except on the hour. */
const LOCK_KEY = 'wg:sync-lock';

export async function syncAll(env: Env, opts: { hourly?: boolean } = { hourly: true }): Promise<{ resource: string; error?: string; [k: string]: unknown }[]> {
  if (await env.KV.get(LOCK_KEY)) return [{ resource: 'all', error: 'A WIREGUARD sync is already running. Try again in a few minutes.' }];
  await env.KV.put(LOCK_KEY, new Date().toISOString(), { expirationTtl: 600 });
  try {
    const out: { resource: string; error?: string; [k: string]: unknown }[] = [];
    for (const r of RESOURCES) {
      if (r.hourly && !opts.hourly) continue;
      out.push(await syncResource(env, r));
    }
    try { await deriveRemainingLength(env); } catch (e) { out.push({ resource: 'remaining length', error: (e as Error).message }); }
    if (opts.hourly) out.push(await syncSettings(env));
    out.push(await watchBuild(env));
    return out;
  } finally {
    await env.KV.delete(LOCK_KEY);
  }
}

export async function syncStatus(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT l.resource, l.finished_at, l.rows_seen, l.error FROM wg_sync_log l
     JOIN (SELECT resource, max(started_at) AS s FROM wg_sync_log GROUP BY resource) m
       ON m.resource = l.resource AND m.s = l.started_at
     ORDER BY l.resource`,
  ).all();
  const counts = await env.DB.prepare(
    `SELECT
       (SELECT count(*) FROM wg_units WHERE wg_active = 1) AS units,
       (SELECT count(*) FROM wg_wires WHERE wg_active = 1) AS wires,
       (SELECT count(*) FROM wg_drums WHERE wg_active = 1) AS drums,
       (SELECT count(*) FROM wg_runs WHERE wg_active = 1 AND is_cut_only = 0) AS runs,
       (SELECT count(*) FROM wg_runs WHERE wg_active = 1 AND is_cut_only = 0 AND approval_status <> 'approved') AS runs_pending,
       (SELECT count(*) FROM wg_runs WHERE wg_active = 1 AND is_cut_only = 1) AS cut_only_rows,
       (SELECT count(*) FROM wg_documents WHERE wg_active = 1) AS documents,
       (SELECT count(*) FROM wg_notifications WHERE wg_active = 1) AS alerts,
       (SELECT json_group_array(country) FROM (SELECT DISTINCT country FROM wg_units WHERE wg_active = 1 ORDER BY country)) AS countries_seen,
       (SELECT json_extract(value, '$') FROM wg_settings WHERE key = 'build_stamp') AS wg_build`,
  ).first<Record<string, unknown>>();
  return { resources: results, counts: { ...counts, countries_seen: JSON.parse(String(counts?.countries_seen ?? '[]')) } };
}
