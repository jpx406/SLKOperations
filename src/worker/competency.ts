import { Hono } from 'hono';
import type { AppBindings, AuthedUser, Env } from './env';
import { logRow } from './lib';
import { confirmOwnPassword } from './confirmPassword';
import { checkProfile, planImport, rolesFromDataset, type CompetencyProfile, type SheetProfileRow } from '../shared/competencyUsers';

// Storage for the Competency module (6z.34): the NESR Competency Framework System keeps its data through a
// four-call key/value contract (get, set, delete, list by prefix), here on D1 with large values in the R2 bucket.
// Shared keys (the team dataset, its audit log, backups, the roster) are one copy for everyone: anyone with the
// Competency tab reads them, the edit right writes them. Personal keys (theme, notifications read) belong to the
// person signed in and are kept apart per username, so nobody overwrites anyone else's.

export const competency = new Hono<AppBindings>();

const now = () => new Date().toISOString();
const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  logRow(env, user.username, action, 'competency_kv', id, summary);
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

/** Changing the team's Competency data: the Competency edit right in SLK Ops, or a Competency role that edits (6z.35). */
export async function mayEdit(env: Env, user: AuthedUser): Promise<boolean> {
  // Career Development (6z.40) works on the same data: its edit right changes it too
  if (user.menus.competency?.edit || user.menus.career_development?.edit) return true;
  const row = await env.DB.prepare('SELECT can_edit FROM competency_users WHERE username = ?').bind(user.username).first<{ can_edit: number }>();
  return !!row?.can_edit;
}

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
/** Competency or Career Development (6z.40): either opens the Competency data; personal keys need one of them too. */
const opensData = (user: AuthedUser) => !!(user.menus.competency?.view || user.menus.career_development?.view);

competency.put('/kv', async (c) => {
  const user = c.get('user');
  if (!opensData(user)) return c.json({ error: 'Your role cannot open Competency or Career Development' }, 403);
  const b = await c.req.json().catch(() => ({})) as { key?: unknown; value?: unknown; shared?: unknown };
  if (!isKey(b.key)) return c.json({ error: 'Bad key' }, 400);
  if (typeof b.value !== 'string') return c.json({ error: 'The value must be text' }, 400);
  const shared = sharedFlag(b.shared);
  if (shared && !(await mayEdit(c.env, user))) return c.json({ error: 'Your role can read Competency but not change it' }, 403);
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
  // team data saves are logged at most once an hour per person and key (the module saves on every change)
  if (shared && !(await c.env.KV.get(`audit:comp:${user.username}:${b.key}`))) {
    await audit(c.env, user, 'edit', b.key, `Competency data saved (${Math.round(bytes / 1024)} KB)`).run();
    await c.env.KV.put(`audit:comp:${user.username}:${b.key}`, '1', { expirationTtl: 3600 });
  }
  // a value that shrank back into the row leaves no copy behind in R2
  if (prev?.r2_key && !stored && c.env.FILES) await c.env.FILES.delete(prev.r2_key).catch(() => undefined);
  return c.json({ key: b.key, value: b.value, shared });
});

/** DELETE ?key=&shared=1 → { key, deleted: true, shared }. The module deletes old backups this way. */
competency.delete('/kv', async (c) => {
  const user = c.get('user');
  if (!opensData(user)) return c.json({ error: 'Your role cannot open Competency or Career Development' }, 403);
  const key = c.req.query('key');
  if (!isKey(key)) return c.json({ error: 'Bad key' }, 400);
  const shared = sharedFlag(c.req.query('shared'));
  if (shared && !(await mayEdit(c.env, user))) return c.json({ error: 'Your role can read Competency but not change it' }, 403);
  const who = owner(shared, user.username);
  const row = await c.env.DB.prepare('SELECT r2_key FROM competency_kv WHERE key = ? AND owner = ?').bind(key, who).first<{ r2_key: string | null }>();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM competency_kv WHERE key = ? AND owner = ?').bind(key, who),
    ...(shared ? [audit(c.env, user, 'delete', key, 'Competency data key deleted')] : []),
  ]);
  if (row?.r2_key && c.env.FILES) await c.env.FILES.delete(row.r2_key).catch(() => undefined);
  return c.json({ key, deleted: true, shared });
});

/** The team's Competency data, read only, for Operations → Job Risk Profile (6z.54): null when nobody saved any yet. */
competency.get('/risk-data', async (c) => {
  const row = await c.env.DB.prepare('SELECT value, r2_key FROM competency_kv WHERE key = ? AND owner = ?').bind('nesr_wl_competency_team_v1', '').first<Row>();
  return c.json({ value: await readValue(c.env, row) });
});

/**
 * What a new Competency dataset starts from: SLK's own active people (their WIREGUARD username as the ID, so
 * the person signed in finds their own record), the slickline services and their domains, and the countries.
 */
competency.get('/slk-seed', async (c) => {
  // the people of the caller's countries (an admin has them all)
  const mine = JSON.stringify(c.get('user').allCountries ?? c.get('user').countries);
  const [people, services, countries] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT coalesce(wg_username, eid) AS id, full_name AS name, country, crew_role, title, contact_email AS email
      FROM employees WHERE active = 1 AND country IN (SELECT value FROM json_each(?)) ORDER BY country, full_name`).bind(mine),
    c.env.DB.prepare(`SELECT job_type_name AS name, domain FROM service_profiles WHERE job_type_name <> 'Other' ORDER BY domain, job_type_name`),
    c.env.DB.prepare('SELECT DISTINCT country FROM employees WHERE active = 1 AND country IN (SELECT value FROM json_each(?)) ORDER BY country').bind(mine),
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

// ---- Competency users (6z.35): set in SLK Ops Users & Roles -------------------------------------------------------

const STORE_KEY = 'nesr_wl_competency_team_v1';
/** The Competency roles in use: the saved dataset's role definitions, else the defaults. */
export async function competencyRoles(env: Env) {
  const row = await env.DB.prepare(`SELECT value, r2_key FROM competency_kv WHERE key = ? AND owner = ''`).bind(STORE_KEY).first<Row>();
  return rolesFromDataset(await readValue(env, row));
}
/** The team's Competency dataset (employee register and records), or null when there is none yet. */
export async function competencyDataset(env: Env): Promise<Record<string, unknown> | null> {
  const row = await env.DB.prepare(`SELECT value, r2_key FROM competency_kv WHERE key = ? AND owner = ''`).bind(STORE_KEY).first<Row>();
  try { const v = await readValue(env, row); return v ? (JSON.parse(v) as Record<string, unknown>) : null; } catch { return null; }
}
const PROFILE_COLS = 'c.username, c.role, c.can_edit, c.employee_id, c.position, c.grade, c.segment, c.location, c.hire_date, c.mentor, c.status, c.updated_by, c.updated_at';

/** Every Competency user with their SLK Ops name, email and countries, and the Competency roles to pick from. */
competency.get('/users', async (c) => {
  const [rows, roles] = await Promise.all([
    c.env.DB.prepare(`SELECT ${PROFILE_COLS}, u.full_name AS name, u.email, u.countries, u.active FROM competency_users c
      JOIN user_roles u ON u.username = c.username ORDER BY u.full_name`).all<CompetencyProfile & { name: string; email: string | null; countries: string; active: number }>(),
    competencyRoles(c.env),
  ]);
  return c.json({
    roles,
    profiles: rows.results.map(({ countries, ...r }) => ({ ...r, country: (JSON.parse(countries || '[]') as string[])[0] ?? '' })),
  });
});

/** The person's own Competency profile (for the Knowledge Hub and Competency headers), or null. */
competency.get('/me', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare(`SELECT ${PROFILE_COLS} FROM competency_users c WHERE c.username = ?`).bind(user.username).first<CompetencyProfile>();
  return c.json({ profile: row ?? null });
});

/** Set a person's Competency profile. Users & Roles (the Users tab's edit right). */
competency.put('/users/:username', async (c) => {
  const me = c.get('user');
  const username = c.req.param('username');
  const person = await c.env.DB.prepare('SELECT username, full_name FROM user_roles WHERE username = ?').bind(username).first<{ username: string; full_name: string }>();
  if (!person) return c.json({ error: 'No such user in SLK Ops' }, 404);
  const r = checkProfile(await c.req.json().catch(() => ({})), await competencyRoles(c.env));
  if ('error' in r) return c.json({ error: r.error }, 400);
  const v = r.value;
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO competency_users (username, role, can_edit, employee_id, position, grade, segment, location, hire_date, mentor, status, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (username) DO UPDATE SET role = excluded.role, can_edit = excluded.can_edit, employee_id = excluded.employee_id, position = excluded.position,
        grade = excluded.grade, segment = excluded.segment, location = excluded.location, hire_date = excluded.hire_date, mentor = excluded.mentor,
        status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(person.username, v.role, v.can_edit, v.employee_id, v.position, v.grade, v.segment, v.location, v.hire_date, v.mentor, v.status, me.username, now()),
    audit(c.env, me, 'edit', person.username, `Competency: ${person.full_name} as ${v.role}${v.position ? `, ${v.position}` : ''}${v.grade ? `, G${v.grade}` : ''}, ${v.status}`),
  ]);
  return c.json({ ok: true });
});

/**
 * Delete a Competency user (their employee record in Competency stays). Admins only, after typing their own
 * WIREGUARD password: { password }.
 */
competency.delete('/users/:username', async (c) => {
  const me = c.get('user');
  if (me.role !== 'admin') return c.json({ error: 'Only an admin can delete a Competency user' }, 403);
  const row = await c.env.DB.prepare(`SELECT c.username, u.full_name FROM competency_users c JOIN user_roles u ON u.username = c.username WHERE c.username = ?`)
    .bind(c.req.param('username')).first<{ username: string; full_name: string }>();
  if (!row) return c.json({ error: 'No such Competency user' }, 404);
  const { password } = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
  const refused = await confirmOwnPassword(c.env, me, password, { entity: 'competency_kv', id: row.username });
  if (refused) return c.json({ error: refused.error }, refused.status);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM competency_users WHERE username = ?').bind(row.username),
    audit(c.env, me, 'delete', row.username, `Competency user ${row.full_name} deleted; confirmed with the admin password`),
  ]);
  return c.json({ ok: true });
});

/**
 * Upload from Excel (6z.36): { rows, apply }. Without apply it only says what would happen; with it, the people
 * already set up are updated and the new ones added, in one go. Employee ID (the SLK Ops username) is the key, so
 * nobody gets a second profile. Users & Roles (the Users tab's edit right).
 */
competency.post('/users/import', async (c) => {
  const me = c.get('user');
  const b = await c.req.json().catch(() => ({})) as { rows?: unknown; apply?: unknown };
  if (!Array.isArray(b.rows)) return c.json({ error: 'Nothing to read in the file' }, 400);
  if (b.rows.length > 2000) return c.json({ error: 'At most 2,000 rows at a time' }, 400);
  const rows = (b.rows as SheetProfileRow[]).filter((r) => r && typeof r.id === 'string' && typeof r.row === 'number' && r.values && typeof r.values === 'object');
  const [users, existing, roles] = await Promise.all([
    c.env.DB.prepare('SELECT username FROM user_roles').all<{ username: string }>(),
    c.env.DB.prepare('SELECT username, employee_id FROM competency_users').all<{ username: string; employee_id: string | null }>(),
    competencyRoles(c.env),
  ]);
  const plan = planImport(rows, users.results.map((u) => u.username), existing.results, roles);
  if (b.apply === true && plan.add.length + plan.update.length) {
    const upsert = c.env.DB.prepare(`INSERT INTO competency_users (username, role, can_edit, employee_id, position, grade, segment, location, hire_date, mentor, status, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (username) DO UPDATE SET role = excluded.role, can_edit = excluded.can_edit, employee_id = excluded.employee_id, position = excluded.position,
        grade = excluded.grade, segment = excluded.segment, location = excluded.location, hire_date = excluded.hire_date, mentor = excluded.mentor,
        status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at`);
    const at = now();
    await c.env.DB.batch([
      ...[...plan.add, ...plan.update].map(({ username, value: v }) => upsert.bind(username, v.role, v.can_edit, v.employee_id, v.position, v.grade, v.segment, v.location, v.hire_date, v.mentor, v.status, me.username, at)),
      audit(c.env, me, 'import', 'competency_users', `Competency users from Excel: ${plan.add.length} added, ${plan.update.length} updated, ${plan.skip.length} left out`),
    ]);
  }
  return c.json({ ...plan, applied: b.apply === true });
});
