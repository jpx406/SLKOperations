import { Hono } from 'hono';
import { MAINTENANCE_TYPES, OPEN_END } from '../shared/unitEvents';
import type { AppBindings, AuthedUser, Env } from './env';

// Unit blocks on the schedule (S37 maintenance, S38 loan / transferred / junk / backup on location).
// They stop bookings (see blockConflict in jobs.ts) and count as unavailable days in utilization.

const KINDS = ['maintenance', 'loan', 'transferred', 'junk', 'backup_on_location'] as const;
type Kind = (typeof KINDS)[number];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Body { unit_number?: string; kind?: Kind; detail?: string | null; starts_on?: string; ends_on?: string | null; note?: string; confirmOverlap?: boolean }

/** Maintenance needs a type and an end; a status event may be open (no end yet). */
function shape(kind: Kind, detail: string | null | undefined, ends_on: string | null | undefined) {
  if (kind === 'maintenance') {
    const d = (detail ?? '').trim();
    if (!(MAINTENANCE_TYPES as readonly string[]).includes(d)) return { error: 'Pick the maintenance type' };
    if (!ends_on) return { error: 'Enter the end date' };
    return { detail: d, ends_on };
  }
  return { detail: null, ends_on: ends_on || OPEN_END };
}

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'unit_event', id, summary.slice(0, 1000));

/** Open jobs a block would sit on top of; the person must confirm before the block is saved. */
async function bookedJobs(env: Env, unit: string, from: string, to: string) {
  const { results } = await env.DB.prepare(
    `SELECT id, ticket_no, well, start_date, coalesce(end_date, start_date) AS end_date FROM jobs
     WHERE deleted_at IS NULL AND status IN ('planned','ongoing') AND unit_number = ?1
       AND start_date IS NOT NULL AND start_date <= ?3 AND coalesce(end_date, start_date) >= ?2`,
  ).bind(unit, from, to).all();
  return results;
}

function overlapMessage(e: unknown) {
  return ((e as Error).message ?? '').includes('unit_events overlap') ? 'This unit already has an event on some of those days' : null;
}

export const unitEvents = new Hono<AppBindings>();

unitEvents.post('/', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<Body>().catch(() => ({} as Body));
  if (!b.unit_number) return c.json({ error: 'Pick the unit' }, 400);
  if (!b.kind || !KINDS.includes(b.kind)) return c.json({ error: 'Pick the event type' }, 400);
  const sh = shape(b.kind, b.detail, b.ends_on);
  if ('error' in sh) return c.json({ error: sh.error }, 400);
  b.ends_on = sh.ends_on;
  if (!b.starts_on || !DATE.test(b.starts_on) || !DATE.test(b.ends_on)) return c.json({ error: 'Enter the start date' }, 400);
  if (b.ends_on < b.starts_on) return c.json({ error: 'The end date is before the start date' }, 400);
  const unit = await c.env.DB.prepare('SELECT country FROM wg_units WHERE unit_number = ? AND wg_active = 1').bind(b.unit_number).first<{ country: string }>();
  if (!unit) return c.json({ error: 'That unit is not in WIREGUARD' }, 400);
  if (!user.countries.includes(unit.country)) return c.json({ error: 'That unit is outside your countries' }, 403);
  if (b.kind !== 'backup_on_location') {
    const jobs = await bookedJobs(c.env, b.unit_number, b.starts_on, b.ends_on);
    if (jobs.length && !b.confirmOverlap) return c.json({ error: 'Jobs are booked on this unit in that period', jobs, needsConfirmation: true }, 409);
  }
  const id = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO unit_events (id, country, unit_number, kind, detail, starts_on, ends_on, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, unit.country, b.unit_number, b.kind, sh.detail, b.starts_on, b.ends_on, (b.note ?? '').trim().slice(0, 500) || null, user.username),
      audit(c.env, user, 'create', id, `${b.unit_number} ${b.kind}${sh.detail ? ` (${sh.detail})` : ''} ${b.starts_on} → ${b.ends_on === OPEN_END ? 'ongoing' : b.ends_on}${b.confirmOverlap ? ' (over booked jobs, confirmed)' : ''}`),
    ]);
  } catch (e) {
    return c.json({ error: overlapMessage(e) ?? 'Could not save the event' }, 400);
  }
  return c.json({ id }, 201);
});

unitEvents.patch('/:id', async (c) => {
  const user = c.get('user');
  const cur = await c.env.DB.prepare('SELECT * FROM unit_events WHERE id = ? AND country IN (SELECT value FROM json_each(?))')
    .bind(c.req.param('id'), JSON.stringify(user.countries)).first<{ id: string; unit_number: string; kind: Kind; detail: string | null; starts_on: string; ends_on: string; note: string | null }>();
  if (!cur) return c.json({ error: 'Event not found' }, 404);
  const b = await c.req.json<Body>().catch(() => ({} as Body));
  const kind = b.kind ?? cur.kind;
  if (!KINDS.includes(kind)) return c.json({ error: 'Unknown kind' }, 400);
  const sh = shape(kind, b.detail !== undefined ? b.detail : cur.detail, b.ends_on !== undefined ? b.ends_on : cur.ends_on);
  if ('error' in sh) return c.json({ error: sh.error }, 400);
  const next = { kind, detail: sh.detail, starts_on: b.starts_on ?? cur.starts_on, ends_on: sh.ends_on, note: b.note ?? cur.note };
  if (!DATE.test(next.starts_on) || !DATE.test(next.ends_on) || next.ends_on < next.starts_on) return c.json({ error: 'Check the first and last day' }, 400);
  if (next.kind !== 'backup_on_location') {
    const jobs = await bookedJobs(c.env, cur.unit_number, next.starts_on, next.ends_on);
    if (jobs.length && !b.confirmOverlap) return c.json({ error: 'Jobs are booked on this unit in that period', jobs, needsConfirmation: true }, 409);
  }
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE unit_events SET kind = ?, detail = ?, starts_on = ?, ends_on = ?, note = ?, updated_at = ? WHERE id = ?')
        .bind(next.kind, next.detail, next.starts_on, next.ends_on, next.note, new Date().toISOString(), cur.id),
      audit(c.env, user, 'edit', cur.id, `${cur.unit_number} ${cur.kind} ${cur.starts_on}–${cur.ends_on} → ${next.kind} ${next.starts_on}–${next.ends_on}`),
    ]);
  } catch (e) {
    return c.json({ error: overlapMessage(e) ?? 'Could not save the event' }, 400);
  }
  return c.json({ ok: true });
});

unitEvents.delete('/:id', async (c) => {
  const user = c.get('user');
  const cur = await c.env.DB.prepare('SELECT id, unit_number, kind, starts_on, ends_on FROM unit_events WHERE id = ? AND country IN (SELECT value FROM json_each(?))')
    .bind(c.req.param('id'), JSON.stringify(user.countries)).first<{ id: string; unit_number: string; kind: string; starts_on: string; ends_on: string }>();
  if (!cur) return c.json({ error: 'Event not found' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM unit_events WHERE id = ?').bind(cur.id),
    audit(c.env, user, 'delete', cur.id, `${cur.unit_number} ${cur.kind} ${cur.starts_on} → ${cur.ends_on}`),
  ]);
  return c.json({ ok: true });
});
