import { Hono } from 'hono';
import { ROLE_LABEL } from '../shared/roles';
import type { Role } from '../shared/types';
import type { AppBindings, AuthedUser, Env } from './env';
import { exportPackage, importApply, importDryRun } from './dataPackage';
import { MENU_KEYS, effectiveMenus } from './permissions';

// Users & Roles (S34). Accounts live in WIREGUARD; here an admin sets each person's SLK Ops role,
// sets their countries, switches access off, adds or removes tabs per person and edits the role × menu matrix.

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

async function knownCountries(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT DISTINCT country FROM wg_units WHERE wg_active = 1 ORDER BY country').all<{ country: string }>();
  return results.map((r) => r.country);
}

/** Validates a countries list against the countries WIREGUARD has. Returns an error or null. */
async function checkCountries(env: Env, countries: unknown, role: Role): Promise<string | null> {
  if (!Array.isArray(countries)) return 'Countries must be a list';
  const known = await knownCountries(env);
  const unknown = countries.filter((c) => !known.includes(String(c)));
  if (unknown.length) return `Not a country in WIREGUARD: ${unknown.join(', ')}`;
  if (!countries.length && role !== 'admin') return 'Pick at least one country, or the person sees no data';
  return null;
}

admin.get('/countries', async (c) => c.json(await knownCountries(c.env)));

admin.get('/users', async (c) => {
  const [users, grants, perms, contacts] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT username, full_name, role, wg_role, countries, active, last_login_at, updated_by, updated_at,
              email, employee_eid, wg_active, wg_country, wg_field, wg_synced_at, passkey_allowed,
              (SELECT count(*) FROM passkeys p WHERE p.username = user_roles.username) AS passkeys
       FROM user_roles ORDER BY active DESC, full_name COLLATE NOCASE`,
    ),
    c.env.DB.prepare('SELECT username, menu_key, effect, can_edit FROM tab_grants ORDER BY menu_key'),
    c.env.DB.prepare('SELECT role, menu_key, can_view, can_edit, can_delete FROM role_permissions'),
    c.env.DB.prepare('SELECT DISTINCT wg_username FROM employees WHERE is_slk_contact = 1 AND active = 1 AND wg_username IS NOT NULL'),
  ]);
  type G = { username: string; menu_key: string; effect: 'grant' | 'deny'; can_edit: number };
  type P = { role: string; menu_key: string; can_view: number; can_edit: number; can_delete: number };
  const byUser = new Map<string, G[]>();
  for (const g of grants.results as G[]) byUser.set(g.username.toLowerCase(), [...(byUser.get(g.username.toLowerCase()) ?? []), g]);
  const contactSet = new Set((contacts.results as { wg_username: string }[]).map((r) => r.wg_username.toLowerCase()));
  return c.json((users.results as Record<string, unknown>[]).map((u) => {
    const key = String(u.username).toLowerCase();
    const g = byUser.get(key) ?? [];
    const menus = u.role === 'admin'
      ? Object.fromEntries(MENU_KEYS.map((k) => [k, { view: true, edit: true, delete: true }]))
      : effectiveMenus((perms.results as P[]).filter((p) => p.role === u.role), g, contactSet.has(key));
    return {
      ...u,
      countries: JSON.parse((u.countries as string) || '[]'),
      grants: g.map(({ menu_key, effect, can_edit }) => ({ menu_key, effect, can_edit })),
      is_contact: contactSet.has(key),
      effective: Object.entries(menus).filter(([, r]) => r.view).map(([k, r]) => ({ menu_key: k, edit: r.edit })),
    };
  }));
});

// Pre-register someone before their first sign-in, so they arrive with the right role and countries.
admin.post('/users', async (c) => {
  const me = c.get('user');
  const body = await c.req.json<{ username?: string; full_name?: string; role?: Role; countries?: string[] }>().catch(() => ({} as { username?: string; full_name?: string; role?: Role; countries?: string[] }));
  const username = (body.username ?? '').trim().toUpperCase();
  const name = (body.full_name ?? '').trim();
  if (!USERNAME.test(username)) return c.json({ error: 'Usernames are NESR- followed by digits, as in WIREGUARD' }, 400);
  if (!name) return c.json({ error: 'Enter the person’s name' }, 400);
  if (!body.role || !ROLES.includes(body.role)) return c.json({ error: 'Pick a role' }, 400);
  const cErr = await checkCountries(c.env, body.countries ?? [], body.role);
  if (cErr) return c.json({ error: cErr }, 400);
  const exists = await c.env.DB.prepare('SELECT 1 FROM user_roles WHERE username = ?').bind(username).first();
  if (exists) return c.json({ error: `${username} is already in the list` }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO user_roles (username, full_name, role, countries, updated_by) VALUES (?, ?, ?, ?, ?)')
      .bind(username, name.slice(0, 120), body.role, JSON.stringify(body.countries ?? []), me.username),
    audit(c.env, me, 'create', 'user_role', username, `Added ${username} as ${body.role}, countries ${(body.countries ?? []).join(', ') || '(all, admin)'}`),
  ]);
  return c.json({ ok: true }, 201);
});

admin.patch('/users/:username', async (c) => {
  const me = c.get('user');
  const username = c.req.param('username');
  const body = await c.req.json<{ role?: Role; active?: boolean; countries?: string[] }>().catch(() => ({} as { role?: Role; active?: boolean; countries?: string[] }));
  const cur = await c.env.DB.prepare('SELECT username, role, active, countries FROM user_roles WHERE username = ?').bind(username)
    .first<{ username: string; role: Role; active: number; countries: string }>();
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
  const before = JSON.parse(cur.countries || '[]') as string[];
  const countries = body.countries ?? before;
  if (body.countries !== undefined) {
    const cErr = await checkCountries(c.env, body.countries, role);
    if (cErr) return c.json({ error: cErr }, 400);
  }
  const at = new Date().toISOString();
  const changes = [
    role !== cur.role ? `role ${cur.role} → ${role}` : null,
    active !== cur.active ? (active ? 'access switched on' : 'access switched off') : null,
    JSON.stringify([...countries].sort()) !== JSON.stringify([...before].sort()) ? `countries ${before.join(', ') || '—'} → ${countries.join(', ') || '—'}` : null,
  ].filter(Boolean).join('; ');
  if (!changes) return c.json({ ok: true });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE user_roles SET role = ?, active = ?, countries = ?, updated_by = ?, updated_at = ? WHERE username = ?')
      .bind(role, active, JSON.stringify(countries), me.username, at, cur.username),
    audit(c.env, me, 'edit', 'user_role', cur.username, changes),
  ]);
  return c.json({ ok: true });
});

// Takes the person out of SLK Ops (their WIREGUARD account is untouched). Signing in again
// starts over with the default role and the countries WIREGUARD shows.
admin.delete('/users/:username', async (c) => {
  const me = c.get('user');
  const cur = await c.env.DB.prepare('SELECT username, role, active FROM user_roles WHERE username = ?').bind(c.req.param('username'))
    .first<{ username: string; role: Role; active: number }>();
  if (!cur) return c.json({ error: 'No such user' }, 404);
  if (cur.username.toLowerCase() === me.username.toLowerCase()) return c.json({ error: 'You cannot remove yourself' }, 400);
  if (cur.role === 'admin' && cur.active && (await activeAdmins(c.env)) <= 1) return c.json({ error: 'This is the last active admin' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM user_roles WHERE username = ?').bind(cur.username),
    audit(c.env, me, 'delete', 'user_role', cur.username, `Removed from SLK Ops (was ${cur.role})`),
  ]);
  return c.json({ ok: true });
});

admin.put('/users/:username/grants', async (c) => {
  const me = c.get('user');
  const cur = await c.env.DB.prepare('SELECT username FROM user_roles WHERE username = ?').bind(c.req.param('username')).first<{ username: string }>();
  if (!cur) return c.json({ error: 'No such user' }, 404);
  type In = { menu_key: string; effect?: 'grant' | 'deny'; can_edit?: boolean };
  const { grants } = await c.req.json<{ grants: In[] }>().catch(() => ({ grants: [] as In[] }));
  const list = grants ?? [];
  if (list.some((g) => !(MENU_KEYS as readonly string[]).includes(g.menu_key))) return c.json({ error: 'Unknown tab in the list' }, 400);
  if (list.some((g) => g.menu_key === 'users')) return c.json({ error: 'Users & Roles comes with the admin role only' }, 400);
  if (list.some((g) => g.effect && !['grant', 'deny'].includes(g.effect))) return c.json({ error: 'Each tab is granted or removed' }, 400);
  if (new Set(list.map((g) => g.menu_key)).size !== list.length) return c.json({ error: 'A tab appears twice' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM tab_grants WHERE username = ?').bind(cur.username),
    ...list.map((g) => c.env.DB.prepare('INSERT INTO tab_grants (id, username, menu_key, effect, can_edit, granted_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), cur.username, g.menu_key, g.effect ?? 'grant', g.effect === 'deny' ? 0 : g.can_edit ? 1 : 0, me.username)),
    audit(c.env, me, 'edit', 'tab_grants', cur.username,
      list.map((g) => `${g.effect === 'deny' ? '−' : '+'}${g.menu_key}${g.effect !== 'deny' && g.can_edit ? ' (edit)' : ''}`).join(', ') || '(role defaults only)'),
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

// ---- whole-board export and import (Administrator Manual 7), admin role only ----
admin.get('/export', exportPackage);
admin.post('/import/dry-run', importDryRun);
admin.post('/import/apply', importApply);
