import { Hono } from 'hono';
import type { AppBindings } from './env';

// Wires (D3): read-only views of WIREGUARD's wires, drums, runs, tests and alerts, and the data the ported KPIs need.
// Rows are WIREGUARD's own (raw JSON kept by the sync), limited to the caller's countries. A document takes the
// country of its wire or drum; alerts without a country are for admins only, as in WIREGUARD.

/** The WIREGUARD build the KPI port was last checked against (tests/wireKpiParity.test.ts). */
export const KPI_VERIFIED_BUILD = '2026-10-22T03-00';

export const wires = new Hono<AppBindings>();

wires.get('/data', async (c) => {
  const user = c.get('user');
  const countries = JSON.stringify(user.countries);
  const inC = 'country IN (SELECT value FROM json_each(?1))';
  const [w, d, r, docs, n, s] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT raw FROM wg_wires WHERE wg_active = 1 AND ${inC}`).bind(countries),
    c.env.DB.prepare(`SELECT raw, drum_no, drum_position, unit_number, country, wg_active FROM wg_drums WHERE ${inC}`).bind(countries),
    c.env.DB.prepare(`SELECT raw FROM wg_runs WHERE wg_active = 1 AND ${inC}`).bind(countries),
    c.env.DB.prepare(
      `SELECT x.raw FROM wg_documents x WHERE x.wg_active = 1 AND coalesce(
         (SELECT country FROM wg_wires WHERE wire_serial_number = x.wire_serial_number),
         (SELECT country FROM wg_drums WHERE drum_no = x.drum_no)) IN (SELECT value FROM json_each(?1))`,
    ).bind(countries),
    c.env.DB.prepare(`SELECT raw, wg_id, occurred_at, severity, code, message, wire_serial_number, drum_no, resolved_at FROM wg_notifications
      WHERE wg_active = 1 AND (${inC} OR (country IS NULL AND ?2 = 1)) ORDER BY occurred_at DESC`).bind(countries, user.role === 'admin' ? 1 : 0),
    c.env.DB.prepare(`SELECT key, value FROM wg_settings WHERE key IN ('kpi-settings','sop-settings','build_stamp')`),
  ]);
  const parse = (v: unknown) => { try { return JSON.parse(String(v)); } catch { return null; } };
  const settings = Object.fromEntries((s.results as { key: string; value: string }[]).map((x) => [x.key, parse(x.value)]));
  const build = settings.build_stamp as string | null;
  // drums and alerts synced before migration 0004 have no raw row yet: rebuild the fields the KPIs read
  const drums = (d.results as Record<string, unknown>[]).map((x) => parse(x.raw) ?? { drum_no: x.drum_no, drum_position: x.drum_position, slickline_unit: x.unit_number, country: x.country, active: x.wg_active });
  const notes = (n.results as Record<string, unknown>[]).map((x) => ({ ...(parse(x.raw) ?? { id: x.wg_id, occurred_at: x.occurred_at, severity: x.severity, code: x.code, message: x.message, wire_serial_number: x.wire_serial_number, drum_no: x.drum_no }), resolved_at: x.resolved_at ?? null }));
  return c.json({
    wires: w.results.map((x) => parse((x as { raw: string }).raw)).filter(Boolean),
    drums,
    jobs: r.results.map((x) => parse((x as { raw: string }).raw)).filter(Boolean),
    documents: docs.results.map((x) => parse((x as { raw: string }).raw)).filter(Boolean),
    notifications: notes,
    settings: { kpi: settings['kpi-settings'] ?? [], sop: settings['sop-settings'] ?? [] },
    build, verifiedBuild: KPI_VERIFIED_BUILD, parityCurrent: !build || build.replace(/^mock-/, '') === KPI_VERIFIED_BUILD,
  });
});
