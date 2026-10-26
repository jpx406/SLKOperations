import { Hono } from 'hono';
import { defaultSheet, isSheet } from '../shared/attendanceSheets';
import type { AppBindings, AuthedUser, Env } from './env';

// Headcount Roster (S44): the one people list behind Attendance, job crews and the SLK Contacts list
// (Administrator Manual 6 and 8.2). Someone who was ever on a job is switched off rather than removed.

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'employee', id, summary.slice(0, 1000));

const CREW_ROLES = ['slickline_supervisor', 'slickline_operator', 'assistant_operator', 'helper', 'trainee', 'other'];
const ROTATIONS = ['60/30', '28/28', '42/21', '35/35', '5/2'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USERNAME = /^NESR-\d+$/i;

type Body = Record<string, unknown>;
const t = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

/** Cleans the fields that were sent. Returns the values or an error. */
export function cleanEmployee(b: Body, creating: boolean): { values: Record<string, unknown> } | { error: string } {
  const v: Record<string, unknown> = {};
  const need = (k: string, label: string, max: number) => {
    if (creating || k in b) { v[k] = t(b[k], max); if (!v[k]) return `${label} is needed`; }
    return null;
  };
  const err = need('eid', 'EID', 20) ?? need('full_name', 'Name', 120) ?? need('title', 'Job title', 80);
  if (err) return { error: err };
  if ('eid' in v && !/^[A-Za-z0-9-]+$/.test(String(v.eid))) return { error: 'EID takes letters, digits and dashes only' };
  if ('account' in b) v.account = t(b.account, 20) || 'SLK';
  if ('crew_role' in b) { const r = t(b.crew_role, 40); if (r && !CREW_ROLES.includes(r)) return { error: 'Unknown crew role' }; v.crew_role = r || null; }
  if ('rotation' in b) { const r = t(b.rotation, 10) || '60/30'; if (!ROTATIONS.includes(r)) return { error: 'Unknown rotation' }; v.rotation = r; }
  if ('reports_to_id' in b) v.reports_to_id = t(b.reports_to_id, 64) || null;
  if ('wg_username' in b) { const u = t(b.wg_username, 40).toUpperCase(); if (u && !USERNAME.test(u)) return { error: 'WIREGUARD username looks like NESR-12345' }; v.wg_username = u || null; }
  if ('contact_email' in b) { const e = t(b.contact_email, 120); if (e && !EMAIL.test(e)) return { error: 'That email address looks wrong' }; v.contact_email = e || null; }
  if ('contact_mobile' in b) { const m = t(b.contact_mobile, 30); if (m && !/^[+0-9 ()-]{6,30}$/.test(m)) return { error: 'Mobile takes digits, spaces and + only' }; v.contact_mobile = m || null; }
  // which attendance sheet the person is on (field / shop / management); a new entry follows the crew role
  if ('attendance_sheet' in b && b.attendance_sheet) { if (!isSheet(b.attendance_sheet)) return { error: 'Unknown attendance sheet' }; v.attendance_sheet = b.attendance_sheet; }
  else if (creating) v.attendance_sheet = defaultSheet(typeof v.crew_role === 'string' ? v.crew_role : null);
  for (const k of ['is_slk_contact', 'active', 'self_updated'] as const) if (k in b) v[k] = b[k] === true || b[k] === 1 ? 1 : 0;
  return { values: v };
}

export const roster = new Hono<AppBindings>();

roster.get('/', async (c) => {
  const countries = JSON.stringify(c.get('user').countries);
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, m.full_name AS reports_to_name, (SELECT count(*) FROM job_crew cr WHERE cr.employee_id = e.id) AS jobs
     FROM employees e LEFT JOIN employees m ON m.id = e.reports_to_id WHERE e.country IN (SELECT value FROM json_each(?)) ORDER BY e.active DESC, e.full_name`,
  ).bind(countries).all();
  return c.json(results);
});

roster.post('/', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<Body>().catch(() => ({} as Body));
  if (typeof b.country !== 'string' || !user.countries.includes(b.country)) return c.json({ error: 'Pick one of your countries' }, 400);
  const r = cleanEmployee(b, true);
  if ('error' in r) return c.json({ error: r.error }, 400);
  if (r.values.is_slk_contact && !r.values.wg_username) return c.json({ error: 'An SLK contact needs their WIREGUARD username, so the access follows them' }, 400);
  const id = crypto.randomUUID();
  const cols = ['id', 'country', ...Object.keys(r.values)];
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO employees (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(id, b.country, ...Object.values(r.values)),
      audit(c.env, user, 'create', id, `Added ${String(r.values.full_name)} (${String(r.values.eid)}, ${b.country})`),
    ]);
  } catch (e) {
    return c.json({ error: /UNIQUE/.test((e as Error).message) ? `${b.country} already has someone with EID ${String(r.values.eid)}` : 'Could not save' }, 400);
  }
  return c.json({ ok: true, id }, 201);
});

roster.patch('/:id', async (c) => {
  const user = c.get('user');
  const cur = await c.env.DB.prepare('SELECT id, country, full_name, wg_username, is_slk_contact FROM employees WHERE id = ?').bind(c.req.param('id'))
    .first<{ id: string; country: string; full_name: string; wg_username: string | null; is_slk_contact: number }>();
  if (!cur || !user.countries.includes(cur.country)) return c.json({ error: 'Person not found' }, 404);
  const r = cleanEmployee(await c.req.json<Body>().catch(() => ({} as Body)), false);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const v = r.values;
  if (v.reports_to_id === cur.id) return c.json({ error: 'Someone can’t report to themselves' }, 400);
  const contact = 'is_slk_contact' in v ? v.is_slk_contact : cur.is_slk_contact;
  const username = 'wg_username' in v ? v.wg_username : cur.wg_username;
  if (contact && !username) return c.json({ error: 'An SLK contact needs their WIREGUARD username, so the access follows them' }, 400);
  const cols = Object.keys(v);
  if (!cols.length) return c.json({ error: 'Nothing to change' }, 400);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE employees SET ${cols.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?${cols.length + 1}`)
        .bind(...cols.map((k) => v[k]), cur.id),
      audit(c.env, user, 'edit', cur.id, `${cur.full_name}: ${cols.map((k) => `${k} = ${v[k]}`).join(', ')}`),
    ]);
  } catch (e) {
    return c.json({ error: /UNIQUE/.test((e as Error).message) ? 'Another person already has that EID' : 'Could not save' }, 400);
  }
  return c.json({ ok: true });
});

roster.delete('/:id', async (c) => {
  const user = c.get('user');
  const cur = await c.env.DB.prepare(`SELECT id, country, full_name, (SELECT count(*) FROM job_crew WHERE employee_id = employees.id) AS jobs FROM employees WHERE id = ?`)
    .bind(c.req.param('id')).first<{ id: string; country: string; full_name: string; jobs: number }>();
  if (!cur || !user.countries.includes(cur.country)) return c.json({ error: 'Person not found' }, 404);
  if (cur.jobs) return c.json({ error: `${cur.full_name} is on ${cur.jobs} job crew${cur.jobs === 1 ? '' : 's'}, so they can only be switched off` }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE employees SET reports_to_id = NULL WHERE reports_to_id = ?').bind(cur.id),
    c.env.DB.prepare('DELETE FROM employees WHERE id = ?').bind(cur.id),
    audit(c.env, user, 'delete', cur.id, `Removed ${cur.full_name}`),
  ]);
  return c.json({ ok: true });
});
