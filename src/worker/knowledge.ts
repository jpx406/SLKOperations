import { Hono, type Context } from 'hono';
import { checkUpload } from '../shared/attachments';
import { GLOBAL, checkDoc, docPrefix, fileKey, mayDownload, type CleanDoc, type KbFile, type KnowledgeDoc } from '../shared/knowledge';
import type { AppBindings, AuthedUser, Env } from './env';

// Knowledge Hub (S21, 6z.13). Everyone with the tab reads the whole library (Global and every country) and downloads
// the current document file. People with its edit right add entries, correct them and upload the first file.
// Admins replace a file (the revision goes up and the old file is kept), keep the editable version, download old
// revisions, and retire an entry. Nothing is hard-deleted; every upload, replacement and download is in the audit log.

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'knowledge_docs', id, summary.slice(0, 1000));

const isAdmin = (u: AuthedUser) => u.role === 'admin';
const canEdit = (u: AuthedUser) => !!u.menus.knowledge_hub?.edit;

const COLS = `id, section, country, company, client, doc_type, category, title, summary, key_action, failure_types, published_on, rilr_ref, source_ref,
  duplicate_of, lesson_of_week_from, doc_no, revision, review_due, retired_at`;
const FILE_COLS = 'f.id, f.doc_id, f.kind, f.revision, f.file_name, f.content_type, f.size_bytes, f.uploaded_at, f.superseded_at, f.change_note, coalesce(r.full_name, f.uploaded_by) AS uploaded_by_name';
const toDoc = (r: Record<string, unknown>) => ({ ...r, failure_types: JSON.parse(String(r.failure_types ?? '[]')) }) as KnowledgeDoc;

/** Countries an entry may be filed under: every active country for admins, the person's own for everyone else. */
async function placesFor(env: Env, user: AuthedUser): Promise<string[]> {
  if (!isAdmin(user)) return [...new Set([...(user.allCountries ?? user.countries)])];
  const { results } = await env.DB.prepare('SELECT DISTINCT country FROM wg_units WHERE wg_active = 1 ORDER BY country').all<{ country: string }>();
  return [...new Set([...results.map((r) => r.country), ...(user.allCountries ?? user.countries)])].sort();
}

export const knowledge = new Hono<AppBindings>();

knowledge.get('/', async (c) => {
  const user = c.get('user');
  const admin = isAdmin(user);
  const [docs, files, places, clients] = await Promise.all([
    c.env.DB.prepare(`SELECT ${COLS} FROM knowledge_docs ${admin ? '' : 'WHERE retired_at IS NULL'} ORDER BY published_on DESC, title LIMIT 5000`).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT ${FILE_COLS} FROM knowledge_files f LEFT JOIN user_roles r ON r.username = f.uploaded_by WHERE f.superseded_at IS NULL ${admin ? '' : "AND f.kind = 'published'"}`).all<KbFile & { doc_id: string; kind: string }>(),
    placesFor(c.env, user),
    c.env.DB.prepare(`SELECT DISTINCT client FROM knowledge_docs WHERE client IS NOT NULL UNION SELECT DISTINCT location FROM jobs WHERE location IS NOT NULL AND deleted_at IS NULL ORDER BY 1 LIMIT 500`).all<{ client: string }>(),
  ]);
  const byDoc = new Map<string, { file?: KbFile; source?: KbFile }>();
  for (const f of files.results) {
    const e = byDoc.get(f.doc_id) ?? {};
    if (f.kind === 'published') e.file = f; else e.source = f;
    byDoc.set(f.doc_id, e);
  }
  return c.json({
    docs: docs.results.map((r) => ({ ...toDoc(r), file: byDoc.get(String(r.id))?.file ?? null, source: admin ? byDoc.get(String(r.id))?.source ?? null : undefined })),
    canEdit: canEdit(user), isAdmin: admin, places, clients: clients.results.map((r) => r.client),
  });
});

async function find(env: Env, id: string) {
  const r = await env.DB.prepare(`SELECT ${COLS} FROM knowledge_docs WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  return r ? toDoc(r) : null;
}

/** May this person file under that place? Global or one of their countries; admins anywhere. */
const mayFile = async (env: Env, user: AuthedUser, country: string) => country === GLOBAL || (await placesFor(env, user)).includes(country);

knowledge.get('/:id', async (c) => {
  const d = await find(c.env, c.req.param('id'));
  return d && (!d.retired_at || isAdmin(c.get('user'))) ? c.json(d) : c.json({ error: 'Document not found' }, 404);
});

const uniqueError = (e: unknown) => {
  const m = (e as Error).message;
  if (!/UNIQUE/.test(m)) throw e;
  return /doc_no/.test(m) ? 'Another document already has that number' : 'Another document already uses that link';
};

knowledge.post('/', async (c) => {
  const user = c.get('user');
  const r = checkDoc(await c.req.json().catch(() => ({})), [...(await placesFor(c.env, user))]);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const d = r.doc;
  if (d.duplicate_of && !(await find(c.env, d.duplicate_of))) return c.json({ error: 'The original document was not found' }, 400);
  const id = crypto.randomUUID();
  // a blank number is counted from the documents already filed under the same prefix, in the same statement
  const prefix = docPrefix(d);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO knowledge_docs (id, section, country, company, client, doc_type, category, title, summary, key_action, failure_types, published_on, rilr_ref, source_ref,
          duplicate_of, doc_no, review_due, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          coalesce(?, printf('%s-%03d', ?, 1 + (SELECT coalesce(max(CAST(substr(doc_no, length(?) + 2) AS INTEGER)), 0) FROM knowledge_docs WHERE doc_no LIKE ? || '-%' AND substr(doc_no, length(?) + 2) GLOB '[0-9][0-9][0-9]*'))), ?, ?)`)
        .bind(id, d.section, d.country, d.company, d.client, d.doc_type, d.category, d.title, d.summary, d.key_action, JSON.stringify(d.failure_types), d.published_on, d.rilr_ref, d.source_ref,
          d.duplicate_of, d.doc_no, prefix, prefix, prefix, prefix, d.review_due, user.username),
      audit(c.env, user, 'create', id, `${d.section} ${d.country}: ${d.title}`),
    ]);
  } catch (e) {
    return c.json({ error: uniqueError(e) }, 400);
  }
  const row = await c.env.DB.prepare('SELECT doc_no FROM knowledge_docs WHERE id = ?').bind(id).first<{ doc_no: string }>();
  return c.json({ id, doc_no: row?.doc_no }, 201);
});

knowledge.put('/:id', async (c) => {
  const user = c.get('user');
  const cur = await find(c.env, c.req.param('id'));
  if (!cur || (cur.retired_at && !isAdmin(user))) return c.json({ error: 'Document not found' }, 404);
  const places = await placesFor(c.env, user);
  // an entry already filed under a country the person doesn't cover may still be corrected, without moving it
  const r = checkDoc(await c.req.json().catch(() => ({})), [...places, cur.country]);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const d: CleanDoc = r.doc;
  if (d.country !== cur.country && !(await mayFile(c.env, user, d.country))) return c.json({ error: 'Pick one of your countries or Global' }, 400);
  if (d.duplicate_of === cur.id) return c.json({ error: 'A document can’t repeat itself' }, 400);
  if (d.duplicate_of && !(await find(c.env, d.duplicate_of))) return c.json({ error: 'The original document was not found' }, 400);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE knowledge_docs SET section = ?, country = ?, company = ?, client = ?, doc_type = ?, category = ?, title = ?, summary = ?, key_action = ?, failure_types = ?,
          published_on = ?, rilr_ref = ?, source_ref = ?, duplicate_of = ?, doc_no = coalesce(?, doc_no), review_due = ? WHERE id = ?`)
        .bind(d.section, d.country, d.company, d.client, d.doc_type, d.category, d.title, d.summary, d.key_action, JSON.stringify(d.failure_types),
          d.published_on, d.rilr_ref, d.source_ref, d.duplicate_of, d.doc_no, d.review_due, cur.id),
      audit(c.env, user, 'update', cur.id, d.title === cur.title ? d.title : `${cur.title} → ${d.title}`),
    ]);
  } catch (e) {
    return c.json({ error: uniqueError(e) }, 400);
  }
  return c.json({ ok: true });
});

/** Makes this the lesson of the week from today (Riyadh date). */
knowledge.post('/:id/lesson-of-week', async (c) => {
  const user = c.get('user');
  const cur = await find(c.env, c.req.param('id'));
  if (!cur || cur.retired_at) return c.json({ error: 'Document not found' }, 404);
  if (cur.section !== 'lesson') return c.json({ error: 'Only lessons can be the lesson of the week' }, 400);
  if (cur.duplicate_of) return c.json({ error: 'Pick the original, not a duplicate' }, 400);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE knowledge_docs SET lesson_of_week_from = ? WHERE id = ?').bind(today, cur.id),
    audit(c.env, user, 'lesson_of_week', cur.id, `${cur.title} from ${today}`),
  ]);
  return c.json({ ok: true, from: today });
});

/** Retire hides an entry from everyone but admins; restore brings it back. Admins only. */
knowledge.post('/:id/:action{retire|restore}', async (c) => {
  const user = c.get('user');
  if (!isAdmin(user)) return c.json({ error: 'Only an admin can retire a document' }, 403);
  const cur = await find(c.env, c.req.param('id'));
  if (!cur) return c.json({ error: 'Document not found' }, 404);
  const retire = c.req.param('action') === 'retire';
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE knowledge_docs SET retired_at = ?, retired_by = ? WHERE id = ?').bind(retire ? new Date().toISOString() : null, retire ? user.username : null, cur.id),
    audit(c.env, user, retire ? 'retire' : 'restore', cur.id, cur.title),
  ]);
  return c.json({ ok: true });
});

// ---- files ---------------------------------------------------------------------------------------------------

interface FileRow extends KbFile { doc_id: string; kind: 'published' | 'source'; superseded_at: string | null; change_note: string | null; r2_key?: string }

/** Every file of an entry: the current ones for everyone, the history and the editable version for admins. */
knowledge.get('/:id/files', async (c) => {
  const user = c.get('user');
  const cur = await find(c.env, c.req.param('id'));
  if (!cur || (cur.retired_at && !isAdmin(user))) return c.json({ error: 'Document not found' }, 404);
  const { results } = await c.env.DB.prepare(`SELECT ${FILE_COLS} FROM knowledge_files f LEFT JOIN user_roles r ON r.username = f.uploaded_by WHERE f.doc_id = ? ORDER BY f.revision DESC, f.uploaded_at DESC`)
    .bind(cur.id).all<FileRow>();
  const admin = isAdmin(user);
  return c.json({
    files: results.filter((f) => mayDownload({ kind: f.kind, superseded: !!f.superseded_at }, admin)),
    revision: cur.revision, isAdmin: admin, canUpload: canEdit(user) && !!c.env.FILES, storage: !!c.env.FILES,
  });
});

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Upload (raw body, X-File-Name, ?kind=published|source&note=). The first document file goes in at the current
 * revision and anyone with the edit right may add it. Replacing it is for admins, needs a note, and raises the
 * revision. The editable version is for admins and is filed at the current revision, replacing an older one.
 */
knowledge.post('/:id/files', async (c: Context<AppBindings>) => {
  const user = c.get('user');
  const cur = await find(c.env, c.req.param('id') ?? '');
  if (!cur || cur.retired_at) return c.json({ error: 'Document not found' }, 404);
  if (!c.env.FILES) return c.json({ error: 'File storage isn’t set up on the server yet (R2 bucket slkops-files).' }, 503);
  const kind = c.req.query('kind') === 'source' ? 'source' : 'published';
  const note = (c.req.query('note') ?? '').trim().slice(0, 300) || null;
  const current = await c.env.DB.prepare("SELECT id FROM knowledge_files WHERE doc_id = ? AND kind = 'published' AND superseded_at IS NULL").bind(cur.id).first<{ id: string }>();
  const replacing = kind === 'published' && !!current;
  if ((kind === 'source' || replacing) && !isAdmin(user)) {
    return c.json({ error: kind === 'source' ? 'Only an admin keeps the editable version' : 'Only an admin can replace the document file' }, 403);
  }
  if (replacing && !note) return c.json({ error: 'Say what changed in this revision' }, 400);
  const name = decodeURIComponent(c.req.header('x-file-name') ?? '');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const ok = checkUpload(name, bytes.length);
  if ('error' in ok) return c.json({ error: ok.error }, 400);
  const revision = replacing ? cur.revision + 1 : cur.revision;
  const id = crypto.randomUUID();
  const key = fileKey(cur, revision, kind, id, ok.name);
  const sha = hex(await crypto.subtle.digest('SHA-256', bytes));
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: ok.type }, customMetadata: { name: ok.name, by: user.username, sha256: sha, doc: cur.id, revision: String(revision) } });
  const now = new Date().toISOString();
  await c.env.DB.batch([
    // a new document file supersedes the old one; a new editable version supersedes the old editable version
    c.env.DB.prepare('UPDATE knowledge_files SET superseded_at = ? WHERE doc_id = ? AND kind = ? AND superseded_at IS NULL').bind(now, cur.id, kind),
    c.env.DB.prepare('INSERT INTO knowledge_files (id, doc_id, kind, revision, file_name, content_type, size_bytes, sha256, r2_key, change_note, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, cur.id, kind, revision, ok.name, ok.type, bytes.length, sha, key, note, user.username),
    c.env.DB.prepare('UPDATE knowledge_docs SET revision = ? WHERE id = ?').bind(revision, cur.id),
    audit(c.env, user, replacing ? 'replace' : 'upload', cur.id,
      `${kind === 'source' ? 'Editable version' : 'Document'} “${ok.name}” Rev ${revision} for ${cur.doc_no ?? cur.title}${note ? `: ${note}` : ''}`),
  ]);
  return c.json({ id, revision, name: ok.name }, 201);
});

/** Download. Opens in the page with ?inline=1 for PDFs and images. Each download is logged, as in Document Control. */
knowledge.get('/:id/files/:fileId', async (c) => {
  const user = c.get('user');
  const f = await c.env.DB.prepare('SELECT f.*, d.retired_at, d.title, d.doc_no FROM knowledge_files f JOIN knowledge_docs d ON d.id = f.doc_id WHERE f.id = ? AND f.doc_id = ?')
    .bind(c.req.param('fileId'), c.req.param('id'))
    .first<FileRow & { r2_key: string; retired_at: string | null; title: string; doc_no: string | null }>();
  const admin = isAdmin(user);
  if (!f || (f.retired_at && !admin)) return c.json({ error: 'File not found' }, 404);
  if (!mayDownload({ kind: f.kind, superseded: !!f.superseded_at }, admin)) return c.json({ error: 'Only an admin can open this version' }, 403);
  if (!c.env.FILES) return c.json({ error: 'File storage isn’t set up on the server yet' }, 503);
  const obj = await c.env.FILES.get(f.r2_key);
  if (!obj) return c.json({ error: 'The file is missing from storage' }, 404);
  await audit(c.env, user, 'download', f.doc_id, `${f.kind === 'source' ? 'Editable version' : 'Document'} “${f.file_name}” Rev ${f.revision} of ${f.doc_no ?? f.title}`).run();
  const inline = c.req.query('inline') === '1' && ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(f.content_type);
  return new Response(obj.body, {
    headers: {
      'Content-Type': f.content_type,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.file_name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      'Cache-Control': 'private, max-age=60',
    },
  });
});
