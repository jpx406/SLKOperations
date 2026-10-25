import { Hono } from 'hono';
import { cleanNote, pjnNo } from '../shared/pjn';
import type { AppBindings, AuthedUser, Env } from './env';
import { getJob } from './jobs';

// Pre-Job Notes (S09, S26, S27). One note per job; every save is a new immutable version.
// Only an admin deletes a note, with two confirmations, and the versions go with it (Administrator Manual 8.1).

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'pre_job_note', id, summary.slice(0, 1000));

const inC = 'n.country IN (SELECT value FROM json_each(?))';
type NoteRow = { id: string; country: string; job_id: string; ticket_no: string | null; log_no: string; status: string; current_version: number; content: string; prepared_by: string | null; saved_at: string; sent_at: string | null; sent_by: string | null };

async function load(env: Env, user: AuthedUser, id: string) {
  const n = await env.DB.prepare(`SELECT n.*, j.ticket_no, j.well, j.rig, j.unit_number, j.start_date, j.end_date FROM pre_job_notes n JOIN jobs j ON j.id = n.job_id WHERE n.id = ? AND ${inC}`)
    .bind(id, JSON.stringify(user.countries)).first<NoteRow & Record<string, unknown>>();
  if (!n) return null;
  const versions = await env.DB.prepare('SELECT version, saved_by, saved_at FROM pre_job_note_versions WHERE note_id = ? ORDER BY version DESC').bind(id).all();
  return { ...n, content: JSON.parse(n.content), versions: versions.results };
}

/** Contacts must be on this country's active SLK Contacts list. */
async function checkContacts(env: Env, country: string, ids: string[]) {
  if (!ids.length) return true;
  const r = await env.DB.prepare('SELECT count(*) AS n FROM employees WHERE id IN (SELECT value FROM json_each(?)) AND country = ? AND active = 1 AND is_slk_contact = 1')
    .bind(JSON.stringify(ids), country).first<{ n: number }>();
  return (r?.n ?? 0) === ids.length;
}

export const preJobNotes = new Hono<AppBindings>();

preJobNotes.get('/', async (c) => {
  const where = [inC];
  const binds: unknown[] = [JSON.stringify(c.get('user').countries)];
  const status = c.req.query('status');
  if (status === 'sent' || status === 'not_sent') { where.push('n.status = ?'); binds.push(status); }
  const q = (c.req.query('q') ?? '').trim().replace(/[%_]/g, '');
  if (q) { where.push('(n.log_no LIKE ? OR j.ticket_no LIKE ? OR j.rig LIKE ? OR j.well LIKE ?)'); binds.push(...Array(4).fill(`%${q}%`)); }
  const from = c.req.query('from'), to = c.req.query('to');
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('substr(coalesce(n.sent_at, n.saved_at), 1, 10) >= ?'); binds.push(from); }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push('substr(coalesce(n.sent_at, n.saved_at), 1, 10) <= ?'); binds.push(to); }
  const { results } = await c.env.DB.prepare(
    `SELECT n.id, n.log_no, n.status, n.current_version, n.saved_at, n.sent_at, n.prepared_by, n.job_id, j.ticket_no, j.rig, j.well,
            json_extract(n.content, '$.rig_type') AS rig_type, json_extract(n.content, '$.rdd_dept') AS rdd_dept, e.full_name AS main_contact
     FROM pre_job_notes n JOIN jobs j ON j.id = n.job_id LEFT JOIN employees e ON e.id = n.main_contact_id
     WHERE ${where.join(' AND ')} ORDER BY n.saved_at DESC LIMIT 1000`,
  ).bind(...binds).all();
  return c.json(results);
});

/** The SLK Contacts list for the note's pickers (Administrator Manual 8.2). */
preJobNotes.get('/contacts', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, country, full_name, title, contact_email, contact_mobile FROM employees WHERE active = 1 AND is_slk_contact = 1
       AND country IN (SELECT value FROM json_each(?)) ORDER BY full_name`,
  ).bind(JSON.stringify(c.get('user').countries)).all();
  return c.json(results);
});

preJobNotes.get('/by-job/:jobId', async (c) => {
  const n = await c.env.DB.prepare(`SELECT n.id, n.log_no, n.status, n.current_version, n.saved_at, n.sent_at FROM pre_job_notes n WHERE n.job_id = ? AND ${inC}`)
    .bind(c.req.param('jobId'), JSON.stringify(c.get('user').countries)).first();
  return c.json(n ?? null);
});

preJobNotes.get('/:id', async (c) => {
  const n = await load(c.env, c.get('user'), c.req.param('id'));
  return n ? c.json(n) : c.json({ error: 'Note not found' }, 404);
});

preJobNotes.get('/:id/versions/:v', async (c) => {
  const n = await load(c.env, c.get('user'), c.req.param('id'));
  if (!n) return c.json({ error: 'Note not found' }, 404);
  const v = await c.env.DB.prepare('SELECT version, content, saved_by, saved_at FROM pre_job_note_versions WHERE note_id = ? AND version = ?').bind(n.id, Number(c.req.param('v'))).first<{ content: string }>();
  return v ? c.json({ ...v, content: JSON.parse(v.content) }) : c.json({ error: 'Version not found' }, 404);
});

preJobNotes.post('/', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<{ job_id?: string; content?: unknown }>().catch(() => ({} as { job_id?: string; content?: unknown }));
  const job = b.job_id ? await getJob(c.env, user, b.job_id) : null;
  if (!job) return c.json({ error: 'Pick a job in your countries' }, 400);
  const r = cleanNote(b.content);
  if ('error' in r) return c.json({ error: r.error }, 400);
  if (!(await checkContacts(c.env, job.country, [r.content.main_contact_id, ...r.content.extra_contact_ids]))) return c.json({ error: 'Pick contacts from this country’s SLK Contacts list' }, 400);
  const exists = await c.env.DB.prepare('SELECT id FROM pre_job_notes WHERE job_id = ?').bind(job.id).first<{ id: string }>();
  if (exists) return c.json({ error: 'This job already has a Pre-Job Note. Open it instead.', id: exists.id }, 409);
  // next number: above both the counter and any number already used (notes imported or made before the counter)
  const [ctr, mx] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT last_no FROM doc_counters WHERE country = ? AND prefix = 'PJN'`).bind(job.country),
    c.env.DB.prepare(`SELECT max(CAST(substr(log_no, 5) AS INTEGER)) AS n FROM pre_job_notes WHERE country = ? AND log_no GLOB 'PJN-[0-9]*'`).bind(job.country),
  ]);
  const next = Math.max(Number((ctr.results[0] as { last_no?: number } | undefined)?.last_no ?? 0), Number((mx.results[0] as { n?: number } | undefined)?.n ?? 0)) + 1;
  const id = crypto.randomUUID();
  const at = new Date().toISOString();
  const logNo = pjnNo(next);
  const content = JSON.stringify(r.content);
  try {
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO doc_counters (country, prefix, last_no) VALUES (?1, 'PJN', ?2) ON CONFLICT (country, prefix) DO UPDATE SET last_no = ?2`).bind(job.country, next),
    c.env.DB.prepare('INSERT INTO pre_job_notes (id, country, job_id, log_no, content, main_contact_id, prepared_by, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, job.country, job.id, logNo, content, r.content.main_contact_id, user.username, at),
    c.env.DB.prepare('INSERT INTO pre_job_note_versions (id, note_id, version, content, saved_by, saved_at) VALUES (?, ?, 1, ?, ?, ?)').bind(crypto.randomUUID(), id, content, user.username, at),
    audit(c.env, user, 'create', id, `${logNo} on ticket ${job.ticket_no ?? '—'}`),
  ]);
  } catch (e) {
    if (/UNIQUE constraint failed: pre_job_notes.country/.test((e as Error).message)) return c.json({ error: 'Someone saved a note at the same moment. Save again.' }, 409);
    throw e;
  }
  return c.json({ ok: true, note: await load(c.env, user, id) }, 201);
});

preJobNotes.put('/:id', async (c) => {
  const user = c.get('user');
  const cur = await load(c.env, user, c.req.param('id'));
  if (!cur) return c.json({ error: 'Note not found' }, 404);
  const b = await c.req.json<{ expectedVersion?: number; content?: unknown }>().catch(() => ({} as { expectedVersion?: number; content?: unknown }));
  if (Number(b.expectedVersion) !== cur.current_version) return c.json({ error: `Saved as v${cur.current_version} since you opened it. Reload to see it.` }, 409);
  const r = cleanNote(b.content);
  if ('error' in r) return c.json({ error: r.error }, 400);
  if (!(await checkContacts(c.env, cur.country, [r.content.main_contact_id, ...r.content.extra_contact_ids]))) return c.json({ error: 'Pick contacts from this country’s SLK Contacts list' }, 400);
  const v = cur.current_version + 1;
  const at = new Date().toISOString();
  const content = JSON.stringify(r.content);
  // a saved change goes back to Not Sent: what was sent is no longer what is on file
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE pre_job_notes SET content = ?, main_contact_id = ?, current_version = ?, status = 'not_sent', prepared_by = ?, saved_at = ? WHERE id = ? AND current_version = ?`)
      .bind(content, r.content.main_contact_id, v, user.username, at, cur.id, cur.current_version),
    c.env.DB.prepare('INSERT INTO pre_job_note_versions (id, note_id, version, content, saved_by, saved_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), cur.id, v, content, user.username, at),
    audit(c.env, user, 'edit', cur.id, `${cur.log_no} saved as v${v}`),
  ]);
  return c.json({ ok: true, note: await load(c.env, user, cur.id) });
});

preJobNotes.post('/:id/sent', async (c) => {
  const user = c.get('user');
  const cur = await load(c.env, user, c.req.param('id'));
  if (!cur) return c.json({ error: 'Note not found' }, 404);
  const b = await c.req.json<{ to?: string; cc?: string; how?: string }>().catch(() => ({} as { to?: string; cc?: string; how?: string }));
  const at = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE pre_job_notes SET status = 'sent', sent_at = ?, sent_by = ? WHERE id = ?`).bind(at, user.username, cur.id),
    audit(c.env, user, 'send', cur.id, `${cur.log_no} v${cur.current_version} sent (${b.how === 'eml' ? '.eml' : 'mail app'})${b.to ? ` to ${String(b.to).slice(0, 200)}` : ''}${b.cc ? ` cc ${String(b.cc).slice(0, 300)}` : ''}`),
  ]);
  return c.json({ ok: true, note: await load(c.env, user, cur.id) });
});

/** Admin only, permanent. The body repeats the log number as the second confirmation. */
preJobNotes.delete('/:id', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Only an admin can delete a Pre-Job Note' }, 403);
  const cur = await load(c.env, user, c.req.param('id'));
  if (!cur) return c.json({ error: 'Note not found' }, 404);
  const { confirm } = await c.req.json<{ confirm?: string }>().catch(() => ({} as { confirm?: string }));
  if (String(confirm ?? '').trim().toUpperCase() !== cur.log_no) return c.json({ error: `Type ${cur.log_no} to confirm` }, 400);
  // versions go with the note through ON DELETE CASCADE; their trigger only guards a note that still exists
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM pre_job_notes WHERE id = ?').bind(cur.id),
    audit(c.env, user, 'delete', cur.id, `Deleted ${cur.log_no} with its ${cur.versions.length} version(s), ticket ${String(cur.ticket_no ?? '—')}`),
  ]);
  return c.json({ ok: true });
});
