import { Hono } from 'hono';
import { STATIC_RULES, jraLevelKey, jraLevelRule, resolveRules, type Rules } from '../shared/approvalRules';
import type { AppBindings, AuthedUser, Env } from './env';

// Roles and approval rules as data (Users & Roles → Roles and → Approvals). See shared/approvalRules.ts.

const audit = (env: Env, user: AuthedUser, action: string, entity: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, entity, id, summary.slice(0, 1000));

export async function roleKeys(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT key FROM roles').all<{ key: string }>();
  return results.map((r) => r.key);
}

/** Every approval level and MOC / exemption approver named on the JRA forms in use. */
export async function jraLevels(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT approval_levels, questions FROM jra_templates WHERE active = 1').all<{ approval_levels: string; questions: string }>();
  const out = new Set<string>(['SDM', 'Operations Manager', 'Country Manager']);
  for (const r of results) {
    try { for (const l of JSON.parse(r.approval_levels) as { label?: string }[]) if (l.label?.trim()) out.add(l.label.trim()); } catch { /* skip */ }
    try { for (const q of JSON.parse(r.questions) as { approver?: { text?: string } }[]) if (q.approver?.text?.trim()) out.add(q.approver.text.trim()); } catch { /* skip */ }
  }
  return [...out].sort();
}

/** The rules in force (stored overrides on top of the defaults). */
export async function loadRules(env: Env): Promise<Rules> {
  const [stored, levels] = await Promise.all([
    env.DB.prepare('SELECT key, roles FROM approval_rules').all<{ key: string; roles: string }>(),
    jraLevels(env),
  ]);
  return resolveRules(stored.results, levels);
}

/** Usernames holding any of the roles a rule allows (admins included), active, optionally in a country. */
export async function usersFor(env: Env, rules: Rules, key: string, country?: string | null) {
  const roles = [...new Set(['admin', ...(rules[key] ?? [])])];
  const { results } = await env.DB.prepare(
    `SELECT username, full_name, role FROM user_roles WHERE active = 1 AND role IN (SELECT value FROM json_each(?1))
       AND (?2 IS NULL OR role = 'admin' OR EXISTS (SELECT 1 FROM json_each(user_roles.countries) WHERE value = ?2)) ORDER BY full_name`,
  ).bind(JSON.stringify(roles), country ?? null).all<{ username: string; full_name: string; role: string }>();
  return results;
}

export const rulesApi = new Hono<AppBindings>();

rulesApi.get('/roles', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.key, r.label, r.description, r.from_wireguard, r.builtin, r.created_by, r.updated_at,
            (SELECT count(*) FROM user_roles u WHERE u.role = r.key) AS users,
            (SELECT count(*) FROM user_roles u WHERE u.role = r.key AND u.active = 1) AS active_users
     FROM roles r ORDER BY r.builtin DESC, r.label`,
  ).all();
  return c.json(results);
});

rulesApi.get('/rules', async (c) => {
  const [stored, levels] = await Promise.all([
    c.env.DB.prepare('SELECT key, roles, updated_by, updated_at FROM approval_rules').all<{ key: string; roles: string; updated_by: string; updated_at: string }>(),
    jraLevels(c.env),
  ]);
  const defs = [...STATIC_RULES, ...levels.map(jraLevelRule)];
  const changed = new Map(stored.results.map((s) => [s.key, s]));
  return c.json({
    rules: resolveRules(stored.results, levels),
    defs: defs.map((d) => ({ ...d, changed: changed.has(d.key), updated_by: changed.get(d.key)?.updated_by ?? null, updated_at: changed.get(d.key)?.updated_at ?? null })),
  });
});

// ---- admin --------------------------------------------------------------------------------------------------

const slug = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

rulesApi.post('/admin/roles', async (c) => {
  const me = c.get('user');
  const b = await c.req.json<{ label?: string; description?: string; copy_from?: string }>().catch(() => ({} as { label?: string; description?: string; copy_from?: string }));
  const label = String(b.label ?? '').trim().slice(0, 40);
  if (!label) return c.json({ error: 'Name the role' }, 400);
  const key = slug(label);
  if (!key) return c.json({ error: 'Use letters or digits in the name' }, 400);
  if (await c.env.DB.prepare('SELECT 1 FROM roles WHERE key = ? OR lower(label) = lower(?)').bind(key, label).first()) return c.json({ error: `There is already a role called ${label}` }, 409);
  const copy = b.copy_from && (await roleKeys(c.env)).includes(b.copy_from) ? b.copy_from : null;
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO roles (key, label, description, from_wireguard, builtin, created_by) VALUES (?, ?, ?, 0, 0, ?)').bind(key, label, String(b.description ?? '').trim().slice(0, 200) || null, me.username),
    // starting tabs: a copy of another role's, or none (set them in Role permissions)
    ...(copy ? [c.env.DB.prepare(`INSERT OR IGNORE INTO role_permissions (id, role, menu_key, can_view, can_edit, can_delete)
      SELECT lower(hex(randomblob(16))), ?1, menu_key, can_view, can_edit, can_delete FROM role_permissions WHERE role = ?2`).bind(key, copy)] : []),
    c.env.DB.prepare(`INSERT OR IGNORE INTO attendance_role_sheets (role, sheet, updated_by)
      SELECT ?1, coalesce((SELECT sheet FROM attendance_role_sheets WHERE role = ?2), 'none'), ?3`).bind(key, copy, me.username),
    audit(c.env, me, 'create', 'role', key, `Added role ${label}${copy ? ` (tabs copied from ${copy})` : ''}`),
  ]);
  return c.json({ ok: true, key }, 201);
});

rulesApi.patch('/admin/roles/:key', async (c) => {
  const me = c.get('user');
  const key = c.req.param('key');
  const cur = await c.env.DB.prepare('SELECT key, label FROM roles WHERE key = ?').bind(key).first<{ key: string; label: string }>();
  if (!cur) return c.json({ error: 'No such role' }, 404);
  const b = await c.req.json<{ label?: string; description?: string }>().catch(() => ({} as { label?: string; description?: string }));
  const label = b.label === undefined ? cur.label : String(b.label).trim().slice(0, 40);
  if (!label) return c.json({ error: 'Name the role' }, 400);
  if (await c.env.DB.prepare('SELECT 1 FROM roles WHERE lower(label) = lower(?) AND key <> ?').bind(label, key).first()) return c.json({ error: `There is already a role called ${label}` }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE roles SET label = ?, description = coalesce(?, description), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = ?`)
      .bind(label, b.description === undefined ? null : String(b.description).trim().slice(0, 200), key),
    audit(c.env, me, 'edit', 'role', key, `Renamed ${cur.label} → ${label}`),
  ]);
  return c.json({ ok: true });
});

rulesApi.delete('/admin/roles/:key', async (c) => {
  const me = c.get('user');
  const key = c.req.param('key');
  const cur = await c.env.DB.prepare('SELECT key, label, from_wireguard FROM roles WHERE key = ?').bind(key).first<{ key: string; label: string; from_wireguard: number }>();
  if (!cur) return c.json({ error: 'No such role' }, 404);
  if (cur.from_wireguard) return c.json({ error: `${cur.label} comes from WIREGUARD (people signing in get it from their WIREGUARD role), so it can’t be deleted` }, 400);
  const held = await c.env.DB.prepare('SELECT count(*) AS n FROM user_roles WHERE role = ?').bind(key).first<{ n: number }>();
  if (held?.n) return c.json({ error: `${held.n} ${held.n === 1 ? 'person has' : 'people have'} the ${cur.label} role. Give them another role first.` }, 409);
  const rules = await c.env.DB.prepare('SELECT key, roles FROM approval_rules').all<{ key: string; roles: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM roles WHERE key = ?').bind(key),
    c.env.DB.prepare('DELETE FROM role_permissions WHERE role = ?').bind(key),
    c.env.DB.prepare('DELETE FROM attendance_role_sheets WHERE role = ?').bind(key),
    // take the role out of every rule that lists it
    ...rules.results.filter((r) => (JSON.parse(r.roles) as string[]).includes(key))
      .map((r) => c.env.DB.prepare('UPDATE approval_rules SET roles = ? WHERE key = ?').bind(JSON.stringify((JSON.parse(r.roles) as string[]).filter((x) => x !== key)), r.key)),
    audit(c.env, me, 'delete', 'role', key, `Deleted role ${cur.label}`),
  ]);
  return c.json({ ok: true });
});

rulesApi.put('/admin/rules', async (c) => {
  const me = c.get('user');
  const b = await c.req.json<{ key?: string; roles?: string[] }>().catch(() => ({} as { key?: string; roles?: string[] }));
  const key = String(b.key ?? '');
  const known = STATIC_RULES.some((r) => r.key === key) || (key.startsWith('jra.level:') && (await jraLevels(c.env)).some((l) => jraLevelKey(l) === key));
  if (!known) return c.json({ error: 'Unknown rule' }, 400);
  const all = await roleKeys(c.env);
  const roles = [...new Set((b.roles ?? []).filter((r) => typeof r === 'string' && r !== 'admin'))];
  const bad = roles.filter((r) => !all.includes(r));
  if (bad.length) return c.json({ error: `Unknown role ${bad.join(', ')}` }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO approval_rules (key, roles, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT (key) DO UPDATE SET roles = ?2, updated_by = ?3, updated_at = ?4`).bind(key, JSON.stringify(roles), me.username, new Date().toISOString()),
    audit(c.env, me, 'edit', 'approval_rule', key, `${key}: ${roles.join(', ') || 'Admin only'}`),
  ]);
  return c.json({ ok: true });
});

rulesApi.delete('/admin/rules/:key', async (c) => {
  const me = c.get('user');
  const key = decodeURIComponent(c.req.param('key'));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM approval_rules WHERE key = ?').bind(key),
    audit(c.env, me, 'reset', 'approval_rule', key, `${key}: back to the default`),
  ]);
  return c.json({ ok: true });
});
