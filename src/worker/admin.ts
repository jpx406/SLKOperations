import { Hono } from 'hono';
import { ROLE_LABEL } from '../shared/roles';
import type { Role } from '../shared/types';
import type { AppBindings, AuthedUser, Env } from './env';
import { MENU_KEYS } from './permissions';

// Users & Roles (S34). Accounts live in WIREGUARD; here an admin sets each person's SLK Ops role,
// switches access off, adds per-user tab grants and edits the role × menu matrix.

const ROLES = Object.keys(ROLE_LABEL) as Role[];
const USERNAME = /^NESR-\d+$/i;

const audit = (env: Env, user: AuthedUser, action: string, entity: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, entity, id, summary.slice(0, 1000));

async function activeAdmins(env: Env): Promise<number> {
  const r = await env.DB.prepare(`SELECT count(*) AS n FROM user_roles WHERE role = 'admin' AND active = 1`).first<{ n: number }>();
  return r?.n ?? 0;
}

export const admin = new Hono<AppBindings>();

// Reading this area is admin-only too (WRITE_RULES only cover writes).
admin.use('*', async (c, next) => {
  if (!c.get('user').menus.users?.view) return c.json({ error: 'Only admins can open Users & Roles' }, 403);
  return next();
});

admin.get('/users', async (c) => {
  const [users, grants] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT username, full_name, role, wg_role, countries, active, last_login_at, updated_by, updated_at
       FROM user_roles ORDER BY active DESC, full_name COLLATE NOCASE`,
    ),
    c.env.DB.prepare('SELECT username, menu_key, can_edit FROM tab_grants ORDER BY menu_key'),
  ]);
  const byUser = new Map<string, { menu_key: string; can_edit: number }[]>();
  for (const g of grants.results as { username: string; menu_key: string; can_edit: number }[]) {
    const list = byUser.get(g.username.toLowerCase()) ?? [];
    list.push({ menu_key: g.menu_key, can_edit: g.can_edit });
    byUser.set(g.username.toLowerCase(), list);
  }
  return c.json((users.results as Record<string, unknown>[]).map((u) => ({
    ...u,
    countries: JSON.parse((u.countries as string) || '[]'),
    grants: byUser.get(String(u.username).toLowerCase()) ?? [],
  })));
});

// Pre-register someone before their first sign-in, so they arrive with the right role.
admin.post('/users', async (c) => {
  const me = c.get('user');
  const body = await c.req.json<{ username?: string; full_name?: string; role?: Role }>().catch(() => ({} as { username?: string; full_name?: string; role?: Role }));
  const username = (body.username ?? '').trim().toUpperCase();
  const name = (body.full_name ?? '').trim();
  if (!USERNAME.test(username)) return c.json({ error: 'Usernames are NESR- followed by digits, as in WIREGUARD' }, 400);
  if (!name) return c.json({ error: 'Enter the person’s name' }, 400);
  if (!body.role || !ROLES.includes(body.role)) return c.json({ error: 'Pick a role' }, 400);
  const exists = await c.env.DB.prepare('SELECT 1 FROM user_roles WHERE username = ?').bind(username).first();
  if (exists) return c.json({ error: `${username} is already in the list` }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO user_roles (username, full_name, role, updated_by) VALUES (?, ?, ?, ?)').bind(username, name.slice(0, 120), body.role, me.username),
    audit(c.env, me, 'create', 'user_role', username, `Added ${username} as ${body.role}`),
  ]);
  return c.json({ ok: true }, 201);
});

admin.patch('/users/:username', async (c) => {
  const me = c.get('user');
  const username = c.req.param('username');
  const body = await c.req.json<{ role?: Role; active?: boolean }>().catch(() => ({} as { role?: Role; active?: boolean }));
  const cur = await c.env.DB.prepare('SELECT username, role, active FROM user_roles WHERE username = ?').bind(username).first<{ username: string; role: Role; active: number }>();
  if (!cur) return c.json({ error: 'No such user' }, 404);
  if (body.role !== undefined && !ROLES.includes(body.role)) return c.json({ error: 'Unknown role' }, 400);

  const isSelf = cur.username.toLowerCase() === me.username.toLowerCase();
  if (isSelf && ((body.role && body.role !== cur.role) || body.active === false)) {
    return c.json({ error: 'You cannot change your own role or switch off your own access' }, 400);
  }
  const losesAdmin = cur.role === 'admin' && cur.active === 1 && ((body.role && body.role !== 'admin') || body.active === false);
  if (losesAdmin && (await activeAdmins(c.env)) <= 1) return c.json({ error: 'This is the last active admin' }, 400);

  const role = body.role ?? cur.role;
  const active = body.active === undefined ? cur.active : body.active ? 1 : 0;
  const at = new Date().toISOString();
  const changes = [
    role !== cur.role ? `role ${cur.role} → ${role}` : null,
    active !== cur.active ? (active ? 'access switched on' : 'access switched off') : null,
  ].filter(Boolean).join('; ');
  if (!changes) return c.json({ ok: true });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE user_roles SET role = ?, active = ?, updated_by = ?, updated_at = ? WHERE username = ?').bind(role, active, me.username, at, cur.username),
    audit(c.env, me, 'edit', 'user_role', cur.username, changes),
  ]);
  return c.json({ ok: true });
});

admin.put('/users/:username/grants', async (c) => {
  const me = c.get('user');
  const username = c.req.param('username');
  const cur = await c.env.DB.prepare('SELECT username FROM user_roles WHERE username = ?').bind(username).first<{ username: string }>();
  if (!cur) return c.json({ error: 'No such user' }, 404);
  const { grants } = await c.req.json<{ grants: { menu_key: string; can_edit: boolean }[] }>().catch(() => ({ grants: [] as { menu_key: string; can_edit: boolean }[] }));
  const clean = (grants ?? []).filter((g) => (MENU_KEYS as readonly string[]).includes(g.menu_key));
  if (clean.length !== (grants ?? []).length) return c.json({ error: 'Unknown menu in grants' }, 400);
  if (clean.some((g) => g.menu_key === 'users')) return c.json({ error: 'Users & Roles comes with the admin role only' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM tab_grants WHERE username = ?').bind(cur.username),
    ...clean.map((g) => c.env.DB.prepare('INSERT INTO tab_grants (id, username, menu_key, can_edit, granted_by) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), cur.username, g.menu_key, g.can_edit ? 1 : 0, me.username)),
    audit(c.env, me, 'edit', 'tab_grants', cur.username, clean.map((g) => `${g.menu_key}${g.can_edit ? ' (edit)' : ''}`).join(', ') || '(none)'),
  ]);
  return c.json({ ok: true });
});

admin.get('/role-permissions', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT role, menu_key, can_view, can_edit, can_delete FROM role_permissions').all();
  return c.json({ roles: ROLES.filter((r) => r !== 'admin'), menus: MENU_KEYS, rows: results });
});

admin.put('/role-permissions', async (c) => {
  const me = c.get('user');
  const b = await c.req.json<{ role: Role; menu_key: string; can_view: boolean; can_edit: boolean; can_delete: boolean }>().catch(() => null);
  if (!b || !ROLES.includes(b.role) || b.role === 'admin') return c.json({ error: 'Pick a role (admin always has every right)' }, 400);
  if (!(MENU_KEYS as readonly string[]).includes(b.menu_key)) return c.json({ error: 'Unknown menu' }, 400);
  if (b.menu_key === 'users') return c.json({ error: 'Users & Roles stays with admins' }, 400);
  // edit or delete without view makes no sense: view follows the others
  const view = b.can_view || b.can_edit || b.can_delete ? 1 : 0;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO role_permissions (id, role, menu_key, can_view, can_edit, can_delete) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (role, menu_key) DO UPDATE SET can_view = excluded.can_view, can_edit = excluded.can_edit, can_delete = excluded.can_delete`,
    ).bind(crypto.randomUUID(), b.role, b.menu_key, view, b.can_edit ? 1 : 0, b.can_delete ? 1 : 0),
    audit(c.env, me, 'edit', 'role_permissions', `${b.role}:${b.menu_key}`, `view ${view} edit ${b.can_edit ? 1 : 0} delete ${b.can_delete ? 1 : 0}`),
  ]);
  return c.json({ ok: true });
});

admin.get('/audit', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT occurred_at, username, action, entity_type, entity_id, summary FROM audit_log
     WHERE entity_type IN ('user_role','tab_grants','role_permissions','auth') ORDER BY occurred_at DESC LIMIT 100`,
  ).all();
  return c.json(results);
});
