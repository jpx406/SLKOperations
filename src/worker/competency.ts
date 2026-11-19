import { Hono } from 'hono';
import type { AppBindings, AuthedUser, Env } from './env';

// Storage for the Competency module (6z.34): the NESR Competency Framework System keeps its data through a
// four-call key/value contract (get, set, delete, list by prefix), here on D1 with large values in the R2 bucket.
// Shared keys (the team dataset, its audit log, backups, the roster) are one copy for everyone: anyone with the
// Competency tab reads them, the edit right writes them. Personal keys (theme, notifications read) belong to the
// person signed in and are kept apart per username, so nobody overwrites anyone else's.

export const competency = new Hono<AppBindings>();

const now = () => new Date().toISOString();
const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'competency_kv', id, summary);
/** Values up to this many bytes stay in the D1 row; larger ones go to R2. */
export const INLINE_MAX = 256 * 1024;
/** One value at most: the dataset grows with the team, but a runaway write is refused. */
export const VALUE_MAX = 25 * 1024 * 1024;
/** Keys are the module's own constants and backup timestamps: letters, digits and _ - . : only. */
export const isKey = (k: unknown): k is string => typeof k === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(k);
const r2Key = (owner: string, key: string) => `competency/kv/${owner ? `personal/${encodeURIComponent(owner)}` : 'shared'}/${key}.json`;
const owner = (shared: boolean, username: string) => (shared ? '' : username);
const sharedFlag = (v: unknown) => v === true || v === '1' || v === 'true' || v === 1;

type Row = { value: string | null; r2_key: string | null };

async function readValue(env: Env, row: Row | null): Promise<string | null> {
  if (!row) return null;
  if (row.value !== null) return row.value;
  if (!row.r2_key || !env.FILES) return null;
  const obj = await env.FILES.get(row.r2_key);
  return obj ? obj.text() : null;
}

/** GET ?key=&shared=1 → { key, value, shared } or { value: null } when there is none. */
competency.get('/kv', async (c) => {
  const user = c.get('user');
  const key = c.req.query('key');
  if (!isKey(key)) return c.json({ error: 'Bad key' }, 400);
  const shared = sharedFlag(c.req.query('shared'));
  const row = await c.env.DB.prepare('SELECT value, r2_key FROM competency_kv WHERE key = ? AND owner = ?').bind(key, owner(shared, user.username)).first<Row>();
  const value = await readValue(c.env, row);
  return c.json(value === null ? { key, value: null, shared } : { key, value, shared });
});

/** GET ?prefix=&shared=1 → { keys, prefix, shared }: a literal prefix, so _ and % in it are plain characters. */
competency.get('/kv-list', async (c) => {
  const user = c.get('user');
  const prefix = c.req.query('prefix') ?? '';
  if (prefix && !isKey(prefix)) return c.json({ error: 'Bad prefix' }, 400);
  const shared = sharedFlag(c.req.query('shared'));
  const { results } = await c.env.DB.prepare('SELECT key FROM competency_kv WHERE owner = ? AND substr(key, 1, length(?)) = ? ORDER BY key')
    .bind(owner(shared, user.username), prefix, prefix).all<{ key: string }>();
  return c.json({ keys: results.map((r) => r.key), prefix, shared });
});

/** PUT { key, value, shared } → { key, value, shared }. Shared keys need the Competency edit right. */
competency.put('/kv', async (c) => {
  const user = c.get('user');
  const b = await c.req.json().catch(() => ({})) as { key?: unknown; value?: unknown; shared?: unknown };
  if (!isKey(b.key)) return c.json({ error: 'Bad key' }, 400);
  if (typeof b.value !== 'string') return c.json({ error: 'The value must be text' }, 400);
  const shared = sharedFlag(b.shared);
  if (shared && !user.menus.competency?.edit) return c.json({ error: 'Your role can read Competency but not change it' }, 403);
  const bytes = new TextEncoder().encode(b.value).length;
  if (bytes > VALUE_MAX) return c.json({ error: `Too large to save (${Math.round(bytes / 1024 / 1024)} MB)` }, 413);
  const who = owner(shared, user.username);
  const prev = await c.env.DB.prepare('SELECT r2_key FROM competency_kv WHERE key = ? AND owner = ?').bind(b.key, who).first<{ r2_key: string | null }>();
  let inline: string | null = b.value, stored: string | null = null;
  if (bytes > INLINE_MAX) {
    if (!c.env.FILES) return c.json({ error: 'File storage isn’t set up on the server yet (R2 bucket slkops-files).' }, 503);
    stored = r2Key(who, b.key);
    await c.env.FILES.put(stored, b.value, { httpMetadata: { contentType: 'application/json' }, customMetadata: { by: user.username } });
    inline = null;
  }
  await c.env.DB.prepare(`INSERT INTO competency_kv (key, owner, value, r2_key, size_bytes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (key, owner) DO UPDATE SET value = excluded.value, r2_key = excluded.r2_key, size_bytes = excluded.size_bytes, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(b.key, who, inline, stored, bytes, user.username, now()).run();
  // a value that shrank back into the row leaves no copy behind in R2
  if (prev?.r2_key && !stored && c.env.FILES) await c.env.FILES.delete(prev.r2_key).catch(() => undefined);
  return c.json({ key: b.key, value: b.value, shared });
});

/** DELETE ?key=&shared=1 → { key, deleted: true, shared }. The module deletes old backups this way. */
competency.delete('/kv', async (c) => {
  const user = c.get('user');
  const key = c.req.query('key');
  if (!isKey(key)) return c.json({ error: 'Bad key' }, 400);
  const shared = sharedFlag(c.req.query('shared'));
  if (shared && !user.menus.competency?.edit) return c.json({ error: 'Your role can read Competency but not change it' }, 403);
  const who = owner(shared, user.username);
  const row = await c.env.DB.prepare('SELECT r2_key FROM competency_kv WHERE key = ? AND owner = ?').bind(key, who).first<{ r2_key: string | null }>();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM competency_kv WHERE key = ? AND owner = ?').bind(key, who),
    ...(shared ? [audit(c.env, user, 'delete', key, 'Competency data key deleted')] : []),
  ]);
  if (row?.r2_key && c.env.FILES) await c.env.FILES.delete(row.r2_key).catch(() => undefined);
  return c.json({ key, deleted: true, shared });
});

/**
 * What a new Competency dataset starts from: SLK's own active people (their WIREGUARD username as the ID, so
 * the person signed in finds their own record), the slickline services and their domains, and the countries.
 */
competency.get('/slk-seed', async (c) => {
  const [people, services, countries] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT coalesce(wg_username, eid) AS id, full_name AS name, country, crew_role, title, contact_email AS email
      FROM employees WHERE active = 1 ORDER BY country, full_name`),
    c.env.DB.prepare(`SELECT job_type_name AS name, domain FROM service_profiles WHERE job_type_name <> 'Other' ORDER BY domain, job_type_name`),
    c.env.DB.prepare('SELECT DISTINCT country FROM employees WHERE active = 1 ORDER BY country'),
  ]);
  // one record per ID: the same person listed in two countries keeps the first
  const seen = new Set<string>();
  const employees = (people.results as { id: string; name: string; country: string; crew_role: string | null; title: string; email: string | null }[])
    .filter((p) => p.id && !seen.has(p.id) && seen.add(p.id));
  return c.json({
    employees,
    services: (services.results as { name: string; domain: string | null }[]).map((s) => [s.name.replace(/\s+/g, ' ').trim(), s.domain ?? '']),
    countries: (countries.results as { country: string }[]).map((r) => r.country),
  });
});
