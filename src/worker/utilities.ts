import { Hono, type Context } from 'hono';
import { checkUpload } from '../shared/attachments';
import { FAMILY_OF, FORM, cleanRows, diagramChecks, type Row, type SheetStyle } from '../shared/diagram';
import { diagramPdf } from '../shared/diagramPdf';
import { UTIL_LABEL, cleanFacts, copyName, isUtilKind, type DiagramData, type UtilKind } from '../shared/utilities';
import type { AppBindings, AuthedUser, Env } from './env';

// Utilities (6z.47): projects for the Rig Up Diagram, the Tool String Diagram and the Winch Report, not tied to a job.
// Anyone with the Utilities right sees the projects of their countries; editing needs the edit right; deleting is for
// whoever made the project, the delete right or an admin. A project's files answer the same shapes as a job's
// attachments, and its winch check the same shape as a job's, so the winch page works on either.

export const utilities = new Hono<AppBindings>();

interface ProjectRow { id: string; country: string; kind: UtilKind; name: string; data: string; created_by: string; created_at: string; updated_by: string | null; updated_at: string }

const now = () => new Date().toISOString();
const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'utility_project', id, summary.slice(0, 1000));
const parse = (s: string): Record<string, unknown> => { try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
const cleanName = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 120) : '');

/** The project, if it is in one of the person's countries. */
async function project(c: Context<AppBindings>): Promise<ProjectRow | null> {
  return c.env.DB.prepare('SELECT * FROM utility_projects WHERE id = ? AND country IN (SELECT value FROM json_each(?))')
    .bind(c.req.param('id'), JSON.stringify(c.get('user').countries)).first<ProjectRow>();
}
const mayEdit = (u: AuthedUser) => !!u.menus.utilities?.edit;
const mayDelete = (u: AuthedUser, p: ProjectRow) => u.role === 'admin' || !!u.menus.utilities?.delete || p.created_by === u.username;

/** The list for one kind, newest first, with who made and last changed each. */
utilities.get('/', async (c) => {
  const kind = c.req.query('kind');
  if (!isUtilKind(kind)) return c.json({ error: 'Say which kind: rigup, toolstring or winch' }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.kind, p.name, p.country, p.created_at, p.updated_at, p.created_by, coalesce(a.full_name, p.created_by) AS created_by_name, coalesce(b.full_name, p.updated_by) AS updated_by_name,
            json_extract(p.data, '$.facts.well') AS well, json_extract(p.data, '$.meta.well') AS winch_well,
            (SELECT count(*) FROM utility_files f WHERE f.project_id = p.id) AS files
     FROM utility_projects p LEFT JOIN user_roles a ON a.username = p.created_by LEFT JOIN user_roles b ON b.username = p.updated_by
     WHERE p.kind = ? AND p.country IN (SELECT value FROM json_each(?)) ORDER BY p.updated_at DESC`,
  ).bind(kind, JSON.stringify(c.get('user').countries)).all<{ created_by: string }>();
  const user = c.get('user');
  return c.json({ projects: results.map((r) => ({ ...r, canDelete: user.role === 'admin' || !!user.menus.utilities?.delete || r.created_by === user.username })), canEdit: mayEdit(user) });
});

utilities.post('/', async (c) => {
  const user = c.get('user');
  const b = (await c.req.json().catch(() => ({}))) as { kind?: unknown; name?: unknown; data?: unknown };
  if (!isUtilKind(b.kind)) return c.json({ error: 'Say which kind: rigup, toolstring or winch' }, 400);
  const name = cleanName(b.name) || `${UTIL_LABEL[b.kind]} ${now().slice(0, 10)}`;
  const country = c.req.header('X-SLK-Country') && user.countries.includes(c.req.header('X-SLK-Country')!) ? c.req.header('X-SLK-Country')! : user.countries[0];
  if (!country) return c.json({ error: 'Your account has no country' }, 403);
  const id = crypto.randomUUID();
  const data = JSON.stringify(b.data && typeof b.data === 'object' ? b.data : {});
  if (data.length > 400_000) return c.json({ error: 'The project is too large' }, 413);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO utility_projects (id, country, kind, name, data, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, country, b.kind, name, data, user.username, user.username),
    audit(c.env, user, 'create', id, `${UTIL_LABEL[b.kind]} project “${name}”`),
  ]);
  return c.json({ id, name }, 201);
});

utilities.get('/:id', async (c) => {
  const p = await project(c);
  if (!p) return c.json({ error: 'Project not found' }, 404);
  const user = c.get('user');
  const who = await c.env.DB.prepare('SELECT coalesce(full_name, username) AS name FROM user_roles WHERE username = ?').bind(p.updated_by ?? p.created_by).first<{ name: string }>();
  return c.json({ ...p, data: parse(p.data), updated_by_name: who?.name ?? p.updated_by, canEdit: mayEdit(user), canDelete: mayDelete(user, p) });
});

/** Saves the name and the data; ?only checks nothing else, the newest save wins. */
utilities.put('/:id', async (c) => {
  const user = c.get('user');
  const p = await project(c);
  if (!p) return c.json({ error: 'Project not found' }, 404);
  const b = (await c.req.json().catch(() => ({}))) as { name?: unknown; data?: unknown };
  const name = b.name === undefined ? p.name : cleanName(b.name);
  if (!name) return c.json({ error: 'Give the project a name' }, 400);
  let data = p.data;
  if (b.data !== undefined) {
    if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) return c.json({ error: 'Send the data as an object' }, 400);
    // the winch check is saved by its own route: keep it
    const keep = parse(p.data);
    const next = { ...(b.data as Record<string, unknown>), ...(keep.winch !== undefined && (b.data as Record<string, unknown>).winch === undefined ? { winch: keep.winch } : {}) };
    data = JSON.stringify(next);
    if (data.length > 400_000) return c.json({ error: 'The project is too large' }, 413);
  }
  const at = now();
  await c.env.DB.prepare('UPDATE utility_projects SET name = ?, data = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(name, data, user.username, at, p.id).run();
  return c.json({ ok: true, name, updated_at: at });
});

utilities.post('/:id/duplicate', async (c) => {
  const user = c.get('user');
  const p = await project(c);
  if (!p) return c.json({ error: 'Project not found' }, 404);
  const { results } = await c.env.DB.prepare('SELECT name FROM utility_projects WHERE kind = ? AND country = ?').bind(p.kind, p.country).all<{ name: string }>();
  const id = crypto.randomUUID();
  const name = copyName(p.name, results.map((r) => r.name));
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO utility_projects (id, country, kind, name, data, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, p.country, p.kind, name, p.data, user.username, user.username),
    // the copy points at the same stored files, under the same ids so its saved winch check still finds them
    c.env.DB.prepare(`INSERT INTO utility_files (id, project_id, category, file_name, content_type, size_bytes, r2_key, note, uploaded_by, uploaded_at)
      SELECT id || '-' || ?, ?, category, file_name, content_type, size_bytes, r2_key, note, uploaded_by, uploaded_at FROM utility_files WHERE project_id = ?`).bind(id.slice(0, 8), id, p.id),
    audit(c.env, user, 'duplicate', id, `${UTIL_LABEL[p.kind]} project “${name}” from “${p.name}”`),
  ]);
  // the copied winch check refers to the copied files' new ids
  const data = parse(p.data) as { winch?: { files?: { attId: string }[] } };
  if (data.winch?.files?.length) {
    for (const f of data.winch.files) f.attId = `${f.attId}-${id.slice(0, 8)}`;
    await c.env.DB.prepare('UPDATE utility_projects SET data = ? WHERE id = ?').bind(JSON.stringify(data), id).run();
  }
  return c.json({ id, name }, 201);
});

utilities.delete('/:id', async (c) => {
  const user = c.get('user');
  const p = await project(c);
  if (!p) return c.json({ error: 'Project not found' }, 404);
  if (!mayDelete(user, p)) return c.json({ error: 'Only whoever made the project, or an admin, can delete it' }, 403);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM utility_files WHERE project_id = ?').bind(p.id),
    c.env.DB.prepare('DELETE FROM utility_projects WHERE id = ?').bind(p.id),
    audit(c.env, user, 'delete', p.id, `${UTIL_LABEL[p.kind]} project “${p.name}”`),
  ]);
  return c.json({ ok: true });
});

// ---- the winch check of a winch project, in the same shape as a job's

utilities.get('/:id/state', async (c) => {
  const p = await project(c);
  if (!p) return c.json({ error: 'Project not found' }, 404);
  const d = parse(p.data);
  return c.json({ state: d.winch ?? null, updatedAt: p.updated_at, updatedBy: null, canEdit: mayEdit(c.get('user')) });
});
utilities.put('/:id/state', async (c) => {
  const user = c.get('user');
  const p = await project(c);
  if (!p) return c.json({ error: 'Project not found' }, 404);
  const text = await c.req.text();
  if (text.length > 400_000) return c.json({ error: 'The winch check is too large to save' }, 413);
  let state: unknown;
  try { state = JSON.parse(text); } catch { return c.json({ error: 'Send the winch check as JSON' }, 400); }
  const d = parse(p.data);
  d.winch = state;
  const at = now();
  await c.env.DB.prepare('UPDATE utility_projects SET data = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(d), user.username, at, p.id).run();
  return c.json({ ok: true, updatedAt: at, updatedBy: user.fullName });
});

// ---- files, in the same shapes as a job's attachments

utilities.get('/:id/files', async (c) => {
  const p = await project(c);
  if (!p) return c.json({ error: 'Project not found' }, 404);
  const { results } = await c.env.DB.prepare(`SELECT f.id, f.category, f.file_name, f.content_type, f.size_bytes, f.note, f.uploaded_at, coalesce(u.full_name, f.uploaded_by) AS uploaded_by_name
    FROM utility_files f LEFT JOIN user_roles u ON u.username = f.uploaded_by WHERE f.project_id = ? ORDER BY f.uploaded_at DESC`).bind(p.id).all();
  return c.json({ files: results, canEdit: mayEdit(c.get('user')) });
});

utilities.post('/:id/files', async (c) => {
  const user = c.get('user');
  const p = await project(c);
  if (!p) return c.json({ error: 'Project not found' }, 404);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const r = await storeFile(c.env, user, p, decodeURIComponent(c.req.header('x-file-name') ?? ''), bytes, c.req.query('category') === 'report' ? 'report' : 'document', c.req.query('note') ?? null);
  if ('error' in r) return c.json({ error: r.error }, 400);
  return c.json(r, 201);
});

async function storeFile(env: Env, user: AuthedUser, p: ProjectRow, name: string, bytes: Uint8Array, category: string, note: string | null) {
  const ok = checkUpload(name, bytes.length);
  if ('error' in ok) return ok;
  if (!env.FILES) return { error: 'File storage isn’t set up on the server yet' };
  const id = crypto.randomUUID();
  const key = `utility/${p.id}/${id}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: ok.type }, customMetadata: { name: ok.name, by: user.username } });
  await env.DB.prepare('INSERT INTO utility_files (id, project_id, category, file_name, content_type, size_bytes, r2_key, note, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, p.id, category, ok.name, ok.type, bytes.length, key, note?.slice(0, 300) || null, user.username).run();
  return { id, name: ok.name };
}

utilities.get('/:id/files/:fileId', async (c) => {
  const p = await project(c);
  if (!p) return c.json({ error: 'Project not found' }, 404);
  const f = await c.env.DB.prepare('SELECT file_name, content_type, r2_key FROM utility_files WHERE id = ? AND project_id = ?').bind(c.req.param('fileId'), p.id).first<{ file_name: string; content_type: string; r2_key: string }>();
  if (!f) return c.json({ error: 'File not found' }, 404);
  const obj = c.env.FILES ? await c.env.FILES.get(f.r2_key) : null;
  if (!obj) return c.json({ error: 'The file is missing from storage' }, 404);
  const inline = c.req.query('inline') === '1' && f.content_type === 'application/pdf';
  return new Response(obj.body, { headers: {
    'Content-Type': f.content_type, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.file_name)}`,
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300',
  } });
});

utilities.delete('/:id/files/:fileId', async (c) => {
  const p = await project(c);
  if (!p) return c.json({ error: 'Project not found' }, 404);
  await c.env.DB.prepare('DELETE FROM utility_files WHERE id = ? AND project_id = ?').bind(c.req.param('fileId'), p.id).run();
  return c.json({ ok: true });
});

// ---- the PDF of a diagram project, from its typed details

utilities.post('/:id/pdf', async (c) => {
  const user = c.get('user');
  const p = await project(c);
  if (!p) return c.json({ error: 'Project not found' }, 404);
  if (p.kind === 'winch') return c.json({ error: 'The winch report is made in the page' }, 400);
  const d = parse(p.data) as Partial<DiagramData>;
  const clean = cleanRows(d.rows ?? [], FAMILY_OF[p.kind]);
  if ('error' in clean) return c.json({ error: clean.error }, 400);
  const rows: Row[] = clean.rows;
  if (!rows.length) return c.json({ error: 'Add the parts first' }, 409);
  const f = cleanFacts(d.facts);
  const style: SheetStyle = c.req.query('style') === 'data' ? 'data' : 'sheet';
  const run = Math.max(1, Math.round(Number(d.run) || 1));
  const rev = Math.max(0, Math.round(Number(d.rev) || 0));
  const checks = diagramChecks(p.kind, p.kind === 'rigup' ? rows : null, p.kind === 'toolstring' ? [rows] : [], { mpwhp_psi: f.siwhp_psi, h2s_ppm: f.h2s_ppm, min_id_in: f.min_restriction_in, wire_in: f.wire_in });
  const at = now();
  const bytes = diagramPdf({
    style, kind: p.kind, run_no: run, rev, status: 'draft', rows, checks,
    job: { client: f.client, well: f.well || null, field: f.field || null, rig: f.rig || null, unit_number: f.unit_number || null, date: f.date || null, ticket_no: f.ticket_no || null, drss_no: f.drss_no || null },
    facts: { siwhp_psi: f.siwhp_psi, h2s_ppm: f.h2s_ppm, min_restriction_in: f.min_restriction_in, wire_in: f.wire_in, md_ft: f.md_ft, tvd_ft: null },
    prepared: { by: user.fullName, at }, verified: null, reviewed: null,
  });
  const form = FORM[p.kind];
  const name = `${form.code} ${p.kind === 'rigup' ? 'Rig Up' : `Run ${run} String`} ${(p.name || f.well || 'project').replace(/[\\/:*?"<>|]/g, '-')} Rev ${rev} ${new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace('T', ' ').replace(':', '')}.pdf`;
  // every PDF is kept with the project, and the next one gets the next revision
  const stored = await storeFile(c.env, user, p, name, bytes, 'report', `${form.title} ${form.code} Rev ${rev}`);
  await c.env.DB.prepare('UPDATE utility_projects SET data = json_set(data, \'$.rev\', ?), updated_by = ?, updated_at = ? WHERE id = ?').bind(rev + 1, user.username, at, p.id).run();
  return new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'X-Filed': 'error' in stored ? 'no' : 'yes', 'X-Rev': String(rev + 1) } });
});
