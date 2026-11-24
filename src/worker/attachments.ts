import { Hono, type Context } from 'hono';
import { CATEGORIES, INLINE, checkUpload, isAttachEntity, isCategory, type AttachEntity, type Category } from '../shared/attachments';
import type { AppBindings, AuthedUser, Env } from './env';

// Attachments in R2. Access follows the record: a job's files need the jobs tab (to upload or remove, its edit right),
// a Knowledge Hub entry's need the knowledge_hub tab, and both stay inside the person's countries.

const MENU: Record<AttachEntity, string> = { job: 'jobs', knowledge: 'knowledge_hub', opportunity: 'quick_plan' };

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'attachments', id, summary.slice(0, 1000));

/** The record's country, or null when it doesn't exist or isn't in the person's countries. */
async function recordCountry(env: Env, user: AuthedUser, entity: AttachEntity, id: string): Promise<string | null> {
  const row = entity === 'job'
    ? await env.DB.prepare('SELECT country FROM jobs WHERE id = ? AND deleted_at IS NULL').bind(id).first<{ country: string }>()
    : entity === 'opportunity'
      ? await env.DB.prepare('SELECT country FROM quick_plan_cards WHERE id = ?').bind(id).first<{ country: string }>()
      : await env.DB.prepare('SELECT country FROM knowledge_docs WHERE id = ? AND retired_at IS NULL').bind(id).first<{ country: string }>();
  // the Knowledge Hub is one library for every country (and Global); job files stay inside the person's countries
  return row && (entity === 'knowledge' || user.countries.includes(row.country)) ? row.country : null;
}

const may = (user: AuthedUser, entity: AttachEntity, action: 'view' | 'edit') => !!user.menus[MENU[entity]]?.[action];

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Stores one file and its row. Used by the upload route, the approved-form PDFs and the job package, whose files go
 * in the package's own folder (`folder`) and record the template and item they belong to.
 */
export async function storeAttachment(env: Env, user: AuthedUser, a: {
  country: string; entity: AttachEntity; entityId: string; category: Category; name: string; bytes: Uint8Array; note?: string | null;
  folder?: string; templateId?: string; packageItem?: string;
}) {
  const ok = checkUpload(a.name, a.bytes.length);
  if ('error' in ok) return ok;
  if (!env.FILES) return { error: 'File storage isn’t set up on the server yet (R2 bucket slkops-files).' };
  const id = crypto.randomUUID();
  const sha = hex(await crypto.subtle.digest('SHA-256', a.bytes));
  const key = a.folder ? `${a.folder}/${a.packageItem ? `${a.packageItem} ` : ''}${id.slice(0, 8)} ${ok.name}` : `${a.entity}/${a.entityId}/${id}`;
  await env.FILES.put(key, a.bytes, { httpMetadata: { contentType: ok.type }, customMetadata: { name: ok.name, by: user.username, sha256: sha } });
  await env.DB.batch([
    env.DB.prepare('INSERT INTO attachments (id, country, entity_type, entity_id, category, file_name, content_type, size_bytes, sha256, r2_key, note, uploaded_by, template_id, package_item) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, a.country, a.entity, a.entityId, a.category, ok.name, ok.type, a.bytes.length, sha, key, a.note?.slice(0, 300) || null, user.username, a.templateId ?? null, a.packageItem ?? null),
    audit(env, user, 'upload', id, `${CATEGORIES[a.category]} “${ok.name}” on ${a.entity} ${a.entityId} (${a.bytes.length} bytes)`),
  ]);
  return { id, name: ok.name };
}

export const attachments = new Hono<AppBindings>();

// /api/attachments/:entity/:entityId            GET list, POST upload (raw body, X-File-Name, ?category=)
// /api/attachments/:entity/:entityId/:fileId    GET the file (?inline=1), DELETE removes it
async function scopeOf(c: Context<AppBindings>, action: 'view' | 'edit') {
  const user = c.get('user');
  const entity = c.req.param('entity');
  if (!isAttachEntity(entity) || !may(user, entity, action)) return { error: action === 'view' ? 'Your access does not include these files' : 'Your role cannot change files here', status: 403 as const };
  const entityId = c.req.param('entityId') ?? '';
  const country = await recordCountry(c.env, user, entity, entityId);
  return country ? { user, entity, entityId, country } : { error: 'Not found', status: 404 as const };
}

attachments.get('/:entity/:entityId', async (c) => {
  const s = await scopeOf(c, 'view');
  if ('error' in s) return c.json({ error: s.error }, s.status);
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.category, a.file_name, a.content_type, a.size_bytes, a.note, a.uploaded_by, coalesce(r.full_name, a.uploaded_by) AS uploaded_by_name, a.uploaded_at
     FROM attachments a LEFT JOIN user_roles r ON r.username = a.uploaded_by
     WHERE a.entity_type = ? AND a.entity_id = ? AND a.deleted_at IS NULL ORDER BY a.uploaded_at DESC`,
  ).bind(s.entity, s.entityId).all();
  return c.json({ files: results, canEdit: may(s.user, s.entity, 'edit'), storage: !!c.env.FILES });
});

attachments.post('/:entity/:entityId', async (c) => {
  const s = await scopeOf(c, 'edit');
  if ('error' in s) return c.json({ error: s.error }, s.status);
  const category = c.req.query('category') ?? 'document';
  if (!isCategory(category)) return c.json({ error: 'Unknown category' }, 400);
  const name = decodeURIComponent(c.req.header('x-file-name') ?? '');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const r = await storeAttachment(c.env, s.user, { country: s.country, entity: s.entity, entityId: s.entityId, category, name, bytes, note: c.req.query('note') });
  if ('error' in r) return c.json({ error: r.error }, r.error.includes('set up') ? 503 : 400);
  return c.json(r, 201);
});

async function fileRow(c: Context<AppBindings>, s: { entity: AttachEntity; entityId: string }) {
  return c.env.DB.prepare('SELECT id, file_name, content_type, r2_key, template_id FROM attachments WHERE id = ? AND entity_type = ? AND entity_id = ? AND deleted_at IS NULL')
    .bind(c.req.param('fileId'), s.entity, s.entityId).first<{ id: string; file_name: string; content_type: string; r2_key: string; template_id: string | null }>();
}

/** "bytes=a-b", "bytes=a-" or "bytes=-n" for a file of `size` bytes; null when absent or not satisfiable. */
export function parseRange(header: string | undefined, size: number): { offset: number; length: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!m || (!m[1] && !m[2])) return null;
  let start = m[1] ? Number(m[1]) : size - Number(m[2]);
  let end = m[1] && m[2] ? Number(m[2]) : size - 1;
  start = Math.max(0, start); end = Math.min(size - 1, end);
  return start <= end ? { offset: start, length: end - start + 1 } : null;
}

/** The file itself. Images, videos and PDFs can open in the page (?inline=1); videos answer byte ranges so they can be scrubbed. */
attachments.get('/:entity/:entityId/:fileId', async (c) => {
  const s = await scopeOf(c, 'view');
  if ('error' in s) return c.json({ error: s.error }, s.status);
  const row = await fileRow(c, s);
  if (!row) return c.json({ error: 'File not found' }, 404);
  if (!c.env.FILES) return c.json({ error: 'File storage isn’t set up on the server yet' }, 503);
  const inline = c.req.query('inline') === '1' && INLINE.has(row.content_type);
  const headers: Record<string, string> = {
    'Content-Type': row.content_type,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    'Cache-Control': 'private, max-age=300',
    'Accept-Ranges': 'bytes',
  };
  const wanted = c.req.header('range');
  if (wanted) {
    const head = await c.env.FILES.head(row.r2_key);
    if (!head) return c.json({ error: 'The file is missing from storage' }, 404);
    const r = parseRange(wanted, head.size);
    if (!r) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${head.size}` } });
    const part = await c.env.FILES.get(row.r2_key, { range: r });
    if (!part) return c.json({ error: 'The file is missing from storage' }, 404);
    return new Response(part.body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${r.offset}-${r.offset + r.length - 1}/${head.size}`, 'Content-Length': String(r.length) } });
  }
  const obj = await c.env.FILES.get(row.r2_key);
  if (!obj) return c.json({ error: 'The file is missing from storage' }, 404);
  return new Response(obj.body, { headers: { ...headers, 'Content-Length': String(obj.size) } });
});

/** Removing hides the file; the object stays in R2 and the audit log says who removed it. */
attachments.delete('/:entity/:entityId/:fileId', async (c) => {
  const s = await scopeOf(c, 'edit');
  if ('error' in s) return c.json({ error: s.error }, s.status);
  const row = await fileRow(c, s);
  if (!row) return c.json({ error: 'File not found' }, 404);
  // package files are removed from the Job package on Closure, which checks it is still open
  if (row.template_id) return c.json({ error: 'This file is part of the job package. Remove it from Closure → Job package.' }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE attachments SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(new Date().toISOString(), s.user.username, row.id),
    audit(c.env, s.user, 'remove', row.id, `Removed “${row.file_name}” from ${s.entity} ${s.entityId}`),
  ]);
  return c.json({ ok: true });
});
