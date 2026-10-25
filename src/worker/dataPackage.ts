import type { Context } from 'hono';
import { EXPORT_ONLY, IMMUTABLE, IMPORT_ORDER, PACKAGE_FORMAT, PACKAGE_VERSION, checkPackage, diffTable, keyOf, type Row, type TableDiff } from '../shared/dataPackage';
import type { AppBindings, Env } from './env';

// Admin data export and import (Administrator Manual 7). Admin role only. Import requires a backup export made by
// the same admin in the last 15 minutes, a dry run, and a typed confirmation; it never deletes.

const BACKUP_WINDOW_MS = 15 * 60_000;
const CHUNK = 80;

async function columnsOf(env: Env, table: string) {
  // table_xinfo flags generated columns (hidden 2 or 3); those are computed, never written
  const { results } = await env.DB.prepare(`SELECT name, pk, hidden FROM pragma_table_xinfo(?)`).bind(table).all<{ name: string; pk: number; hidden: number }>();
  const cols = results.filter((c) => c.hidden === 0);
  return { columns: cols.map((c) => c.name), pk: cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name) };
}

export async function exportPackage(c: Context<AppBindings>) {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Only admins export the whole board' }, 403);
  const tables: Record<string, Row[]> = {};
  for (const t of [...IMPORT_ORDER, ...EXPORT_ONLY]) tables[t] = (await c.env.DB.prepare(`SELECT * FROM ${t}`).all<Row>()).results;
  const id = crypto.randomUUID();
  const counts = Object.entries(tables).map(([k, v]) => `${k} ${v.length}`).join(', ');
  // the export id doubles as the backup receipt an import has to show
  await c.env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, 'export', 'data', id, `Whole-board export: ${counts}`.slice(0, 1000)).run();
  return c.json({ format: PACKAGE_FORMAT, version: PACKAGE_VERSION, exported_at: new Date().toISOString(), by: user.username, backup_id: id, tables });
}

async function diffAll(env: Env, tables: Record<string, Row[]>) {
  const diffs: TableDiff[] = [];
  const meta: Record<string, { columns: string[]; pk: string[]; existing: Map<string, Row> }> = {};
  for (const t of IMPORT_ORDER) {
    const rows = tables[t];
    if (!rows?.length) continue;
    const m = await columnsOf(env, t);
    meta[t] = { ...m, existing: new Map() };
    if (!m.pk.length) { diffs.push({ table: t, incoming: rows.length, added: 0, changed: 0, unchanged: 0, refused: rows.length, samples: [{ key: '', kind: 'refused', fields: ['table has no primary key'] }] }); continue; }
    const unknown = Object.keys(rows[0]).filter((k) => !m.columns.includes(k) && !k.startsWith('_'));
    const keys = rows.map((r) => keyOf(r, m.pk));
    const existing: Row[] = [];
    for (let i = 0; i < keys.length; i += 500) {
      const part = keys.slice(i, i + 500);
      const expr = m.pk.length === 1 ? `CAST(${m.pk[0]} AS TEXT)` : m.pk.map((k) => `coalesce(CAST(${k} AS TEXT), '')`).join(` || '|' || `);
      existing.push(...(await env.DB.prepare(`SELECT * FROM ${t} WHERE ${expr} IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(part)).all<Row>()).results);
    }
    meta[t].existing = new Map(existing.map((x) => [keyOf(x, m.pk), x]));
    const d = diffTable(t, rows, existing, m.pk, m.columns);
    if (unknown.length) d.samples.unshift({ key: '', kind: 'refused', fields: [`columns not in this database, ignored: ${unknown.join(', ')}`] });
    diffs.push(d);
  }
  return { diffs, meta };
}

export async function importDryRun(c: Context<AppBindings>) {
  if (c.get('user').role !== 'admin') return c.json({ error: 'Only admins import data' }, 403);
  const r = checkPackage(await c.req.json().catch(() => null));
  if ('error' in r) return c.json({ error: r.error }, 400);
  const { diffs } = await diffAll(c.env, r.tables);
  return c.json({ diffs, totals: diffs.reduce((a, d) => ({ added: a.added + d.added, changed: a.changed + d.changed, unchanged: a.unchanged + d.unchanged, refused: a.refused + d.refused }), { added: 0, changed: 0, unchanged: 0, refused: 0 }) });
}

export async function importApply(c: Context<AppBindings>) {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Only admins import data' }, 403);
  const body = await c.req.json<{ package?: unknown; backup_id?: string; confirm?: string }>().catch(() => ({} as { package?: unknown; backup_id?: string; confirm?: string }));
  if (body.confirm !== 'IMPORT') return c.json({ error: 'Type IMPORT to confirm' }, 400);
  const backup = await c.env.DB.prepare(`SELECT occurred_at FROM audit_log WHERE action = 'export' AND entity_type = 'data' AND entity_id = ? AND username = ?`)
    .bind(body.backup_id ?? '', user.username).first<{ occurred_at: string }>();
  if (!backup || Date.now() - Date.parse(backup.occurred_at) > BACKUP_WINDOW_MS) return c.json({ error: 'Export a fresh backup first (within the last 15 minutes), then import' }, 409);
  const r = checkPackage(body.package);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const { diffs, meta } = await diffAll(c.env, r.tables);
  let written = 0;
  for (const t of IMPORT_ORDER) {
    const rows = r.tables[t];
    const m = meta[t];
    if (!rows?.length || !m?.pk.length) continue;
    // new rows are inserted and changed rows updated in place; unchanged rows are not touched, so table triggers
    // (overlap checks, immutable history) only see real changes
    const stmts = rows.flatMap((row) => {
      const cur = m.existing.get(keyOf(row, m.pk));
      const cols = m.columns.filter((k) => k in row);
      const val = (k: string) => (row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]);
      if (!cur) return [c.env.DB.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(', ')})`).bind(...cols.map(val))];
      const changed = cols.filter((k) => !m.pk.includes(k) && String(row[k] ?? '') !== String(cur[k] ?? ''));
      if (!changed.length || IMMUTABLE.includes(t)) return [];
      return [c.env.DB.prepare(`UPDATE ${t} SET ${changed.map((k, i) => `${k} = ?${i + 1}`).join(', ')} WHERE ${m.pk.map((k, i) => `${k} = ?${changed.length + i + 1}`).join(' AND ')}`)
        .bind(...changed.map(val), ...m.pk.map((k) => row[k]))];
    });
    // each chunk is all-or-nothing; tables go in dependency order so a failure stops before any child of it
    for (let i = 0; i < stmts.length; i += CHUNK) {
      try { await c.env.DB.batch(stmts.slice(i, i + CHUNK)); written += Math.min(CHUNK, stmts.length - i); }
      catch (e) {
        await c.env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), user.username, 'import', 'data', body.backup_id, `Import stopped in ${t} after ${written} rows: ${(e as Error).message}`.slice(0, 1000)).run();
        return c.json({ error: `Stopped in ${t} after ${written} rows: ${(e as Error).message}. Restore from backup ${body.backup_id} if needed.`, written }, 500);
      }
    }
  }
  await c.env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, 'import', 'data', body.backup_id, `Import applied: ${diffs.map((d) => `${d.table} +${d.added} ~${d.changed}`).join(', ')}`.slice(0, 1000)).run();
  return c.json({ ok: true, written, diffs });
}
