import { Hono, type Context } from 'hono';
import { DEFAULT_LOCATIONS, INVENTORIES, checkMovement, reconcile, type Inventory, type LedgerRow, type Location } from '../shared/inventory';
import type { AppBindings, AuthedUser, Env } from './env';

// Inventories (S18–S20, S29, S39), one country at a time. Each inventory has its own tab and rights
// (explosives apart from slickline hardware). Movements are append-only; undo writes the opposite movement.

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'inventory', id, summary.slice(0, 1000));

type C = Context<AppBindings>;

/** The inventory in the path and the country asked for (or the caller's only/first one). */
function scope(c: C): { inv: Inventory; country: string } | Response {
  const inv = c.req.param('inv') as Inventory;
  if (!INVENTORIES.includes(inv)) return c.json({ error: 'Unknown inventory' }, 404);
  const user = c.get('user');
  const country = c.req.query('country') ?? user.countries[0];
  if (!country || !user.countries.includes(country)) return c.json({ error: 'Pick one of your countries' }, 400);
  return { inv, country };
}

const locations = async (env: Env, inv: Inventory, country: string) =>
  (await env.DB.prepare('SELECT id, code, label, counts_as, sort FROM inventory_locations WHERE inventory = ? AND country = ? ORDER BY sort, label').bind(inv, country).all<Location>()).results;

export const inventory = new Hono<AppBindings>();

inventory.get('/:inv', async (c) => {
  const s = scope(c);
  if (s instanceof Response) return s;
  // a country opening this inventory for the first time gets the standard locations
  const has = await c.env.DB.prepare('SELECT 1 FROM inventory_locations WHERE inventory = ? AND country = ? LIMIT 1').bind(s.inv, s.country).first();
  if (!has) {
    await c.env.DB.batch(DEFAULT_LOCATIONS[s.inv].map(([code, label, counts], i) =>
      c.env.DB.prepare('INSERT OR IGNORE INTO inventory_locations (id, country, inventory, code, label, counts_as, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), s.country, s.inv, code, label, counts, (i + 1) * 10)));
  }
  const [locs, items, balances, received] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, code, label, counts_as, sort FROM inventory_locations WHERE inventory = ? AND country = ? ORDER BY sort, label').bind(s.inv, s.country),
    c.env.DB.prepare('SELECT * FROM inventory_items WHERE inventory = ? AND country = ? ORDER BY category, description').bind(s.inv, s.country),
    c.env.DB.prepare(
      `SELECT b.item_id, b.location_id, b.qty FROM inventory_balances b JOIN inventory_items i ON i.id = b.item_id
       WHERE i.inventory = ? AND i.country = ? AND b.qty <> 0`,
    ).bind(s.inv, s.country),
    c.env.DB.prepare(
      `SELECT m.item_id, sum(m.qty) AS qty FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id
       WHERE i.inventory = ? AND i.country = ? AND m.kind = 'receive' GROUP BY m.item_id`,
    ).bind(s.inv, s.country),
  ]);
  return c.json({ country: s.country, locations: locs.results, items: items.results, balances: balances.results, received: received.results });
});

inventory.post('/:inv/items', async (c) => {
  const s = scope(c);
  if (s instanceof Response) return s;
  const user = c.get('user');
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const description = String(b.description ?? '').trim().slice(0, 200);
  const category = String(b.category ?? '').trim().slice(0, 60);
  if (!description) return c.json({ error: 'Describe the item' }, 400);
  if (!category) return c.json({ error: 'Pick a category' }, 400);
  const uom = String(b.uom ?? 'ea');
  if (!['ea', 'm', 'ft', 'kg'].includes(uom)) return c.json({ error: 'Unknown unit' }, 400);
  const par = b.par_level === '' || b.par_level == null ? null : Number(b.par_level);
  if (par !== null && (!Number.isFinite(par) || par < 0)) return c.json({ error: 'Par level must be 0 or more' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO inventory_items (id, country, inventory, category, description, part_no, sap_no, uom, size, par_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, s.country, s.inv, category, description, String(b.part_no ?? '').trim().slice(0, 60) || null, String(b.sap_no ?? '').trim().slice(0, 60) || null,
        uom, String(b.size ?? '').trim().slice(0, 40) || null, par),
    audit(c.env, user, 'create', id, `${s.inv}: added ${description}`),
  ]);
  return c.json({ ok: true, id }, 201);
});

inventory.patch('/:inv/items/:id', async (c) => {
  const s = scope(c);
  if (s instanceof Response) return s;
  const user = c.get('user');
  const item = await c.env.DB.prepare('SELECT id, description FROM inventory_items WHERE id = ? AND inventory = ? AND country = ?').bind(c.req.param('id'), s.inv, s.country).first<{ id: string; description: string }>();
  if (!item) return c.json({ error: 'Item not found' }, 404);
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const v: Record<string, unknown> = {};
  for (const [k, max] of [['description', 200], ['category', 60], ['part_no', 60], ['sap_no', 60], ['size', 40]] as const) {
    if (k in b) { v[k] = String(b[k] ?? '').trim().slice(0, max) || null; if ((k === 'description' || k === 'category') && !v[k]) return c.json({ error: `${k} is needed` }, 400); }
  }
  if ('par_level' in b) { const p = b.par_level === '' || b.par_level == null ? null : Number(b.par_level); if (p !== null && (!Number.isFinite(p) || p < 0)) return c.json({ error: 'Par level must be 0 or more' }, 400); v.par_level = p; }
  if ('archived' in b) v.archived_at = b.archived ? new Date().toISOString() : null;
  const cols = Object.keys(v);
  if (!cols.length) return c.json({ error: 'Nothing to change' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE inventory_items SET ${cols.map((k, i) => `${k} = ?${i + 1}`).join(', ')} WHERE id = ?${cols.length + 1}`).bind(...cols.map((k) => v[k]), item.id),
    audit(c.env, user, 'edit', item.id, `${item.description}: ${cols.join(', ')}`),
  ]);
  return c.json({ ok: true });
});

inventory.post('/:inv/movements', async (c) => {
  const s = scope(c);
  if (s instanceof Response) return s;
  const user = c.get('user');
  const b = await c.req.json<{ client_id?: string; kind?: string; from_location_id?: string | null; to_location_id?: string | null; job_id?: string | null; well?: string | null; note?: string; lines?: { item_id: string; qty: number }[] }>()
    .catch(() => ({} as Record<string, never>));
  const clientId = String(b.client_id ?? '');
  if (!/^[\w-]{8,64}$/.test(clientId)) return c.json({ error: 'Missing request id' }, 400);
  const locs = await locations(c.env, s.inv, s.country);
  const byId = new Map(locs.map((l) => [l.id, l]));
  const from = b.from_location_id ? byId.get(b.from_location_id) ?? null : null;
  const to = b.to_location_id ? byId.get(b.to_location_id) ?? null : null;
  if ((b.from_location_id && !from) || (b.to_location_id && !to)) return c.json({ error: 'Unknown location' }, 400);
  const lines = (b.lines ?? []).map((l) => ({ item_id: String(l.item_id), qty: Number(l.qty) }));
  const err = checkMovement({ kind: String(b.kind), from, to, lines, job_id: b.job_id, well: b.well });
  if (err) return c.json({ error: err }, 400);
  const items = await c.env.DB.prepare('SELECT id, description, archived_at FROM inventory_items WHERE id IN (SELECT value FROM json_each(?)) AND inventory = ? AND country = ?')
    .bind(JSON.stringify(lines.map((l) => l.item_id)), s.inv, s.country).all<{ id: string; description: string; archived_at: string | null }>();
  if (items.results.length !== lines.length) return c.json({ error: 'Some items are not in this inventory' }, 400);
  if (items.results.some((i) => i.archived_at) && b.kind !== 'adjust') return c.json({ error: 'An archived item can only be adjusted' }, 400);
  let well = String(b.well ?? '').trim().slice(0, 120) || null;
  if (b.job_id) {
    const j = await c.env.DB.prepare('SELECT country, well FROM jobs WHERE id = ? AND deleted_at IS NULL').bind(b.job_id).first<{ country: string; well: string | null }>();
    if (!j || j.country !== s.country) return c.json({ error: 'That job is not in this country' }, 400);
    well ??= j.well;
  }
  const note = String(b.note ?? '').trim().slice(0, 500) || null;
  // one client id per line, derived from the request id, so a retried request is ignored line by line
  try {
    await c.env.DB.batch([
      ...lines.map((l, i) => c.env.DB.prepare(
        `INSERT INTO inventory_movements (id, country, item_id, kind, qty, from_location_id, to_location_id, job_id, well, note, client_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (country, client_id) DO NOTHING`,
      ).bind(crypto.randomUUID(), s.country, l.item_id, b.kind, l.qty, from?.id ?? null, to?.id ?? null, b.job_id ?? null, well, note, `${clientId}-${i}`, user.username)),
      audit(c.env, user, b.kind as string, clientId, `${s.inv}: ${b.kind} ${lines.length} item(s) ${from?.label ?? 'in'} → ${to?.label ?? 'out'}${well ? ` (${well})` : ''}`),
    ]);
  } catch (e) {
    if (/insufficient stock/.test((e as Error).message)) return c.json({ error: `Not enough stock at ${from?.label ?? 'the source'} for one of the items. Nothing was moved.` }, 409);
    throw e;
  }
  return c.json({ ok: true }, 201);
});

inventory.get('/:inv/movements', async (c) => {
  const s = scope(c);
  if (s instanceof Response) return s;
  const item = c.req.query('item');
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.kind, m.qty, m.job_id, m.well, m.note, m.created_by, m.created_at, m.reverses_id, i.description, i.uom,
            fl.label AS from_label, tl.label AS to_label, j.ticket_no,
            (SELECT u.id FROM inventory_movements u WHERE u.reverses_id = m.id) AS reversed_by
     FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id
       LEFT JOIN inventory_locations fl ON fl.id = m.from_location_id LEFT JOIN inventory_locations tl ON tl.id = m.to_location_id
       LEFT JOIN jobs j ON j.id = m.job_id
     WHERE i.inventory = ?1 AND m.country = ?2 AND (?3 IS NULL OR m.item_id = ?3) ORDER BY m.created_at DESC LIMIT 500`,
  ).bind(s.inv, s.country, item ?? null).all();
  return c.json(results);
});

/** Reverses a movement with its mirror image. Refused if the stock has already moved on (the trigger guards it). */
inventory.post('/:inv/movements/:id/undo', async (c) => {
  const s = scope(c);
  if (s instanceof Response) return s;
  const user = c.get('user');
  const m = await c.env.DB.prepare(
    `SELECT m.*, i.description FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id WHERE m.id = ? AND i.inventory = ? AND m.country = ?`,
  ).bind(c.req.param('id'), s.inv, s.country).first<{ id: string; kind: string; qty: number; item_id: string; from_location_id: string | null; to_location_id: string | null; job_id: string | null; well: string | null; description: string }>();
  if (!m) return c.json({ error: 'Movement not found' }, 404);
  if (m.kind === 'undo') return c.json({ error: 'An undo can’t be undone. Record a new movement instead.' }, 400);
  if (await c.env.DB.prepare('SELECT 1 FROM inventory_movements WHERE reverses_id = ?').bind(m.id).first()) return c.json({ error: 'This movement was already undone' }, 409);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO inventory_movements (id, country, item_id, kind, qty, from_location_id, to_location_id, job_id, well, reverses_id, note, client_id, created_by)
         VALUES (?, ?, ?, 'undo', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, s.country, m.item_id, m.qty, m.to_location_id, m.from_location_id, m.job_id, m.well, m.id, `Undo of ${m.kind}`, `undo-${m.id}`, user.username),
      audit(c.env, user, 'undo', m.id, `${s.inv}: undid ${m.kind} of ${m.qty} × ${m.description}`),
    ]);
  } catch (e) {
    const msg = (e as Error).message;
    if (/insufficient stock/.test(msg)) return c.json({ error: 'That stock has already moved on, so this can’t be undone. Record a correcting movement instead.' }, 409);
    if (/UNIQUE/.test(msg)) return c.json({ error: 'This movement was already undone' }, 409);
    throw e;
  }
  return c.json({ ok: true });
});

inventory.get('/:inv/reconciliation', async (c) => {
  const s = scope(c);
  if (s instanceof Response) return s;
  const { results } = await c.env.DB.prepare(
    `SELECT m.item_id, m.qty, m.kind, fl.counts_as AS from_counts, tl.counts_as AS to_counts, m.job_id, m.well
     FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id
       LEFT JOIN inventory_locations fl ON fl.id = m.from_location_id LEFT JOIN inventory_locations tl ON tl.id = m.to_location_id
     WHERE i.inventory = ? AND m.country = ? AND (fl.counts_as = 'at_well' OR tl.counts_as = 'at_well')`,
  ).bind(s.inv, s.country).all<LedgerRow>();
  const rows = reconcile(results);
  const jobIds = [...new Set(rows.map((r) => r.job_id).filter(Boolean))];
  const [jobs, items] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, ticket_no, status, start_date FROM jobs WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(jobIds)),
    c.env.DB.prepare('SELECT id, description, uom FROM inventory_items WHERE inventory = ? AND country = ?').bind(s.inv, s.country),
  ]);
  return c.json({ rows, jobs: jobs.results, items: items.results });
});
