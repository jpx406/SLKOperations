import { defaultRoleFor } from '../shared/roles';
import type { Env } from './env';
import { syncPeople } from './people';
import { fetchAsSync } from './sync';

// WIREGUARD's user list, read with the read-only sync account (GET /users). It feeds two things:
// the "Import from WIREGUARD" button in Users & Roles, and the check that keeps a Face ID session honest
// (a person switched off in WIREGUARD can't keep using SLK Ops through a passkey).

export interface WgListUser {
  id?: string | number; username: string; employee_id?: string | null; full_name?: string | null; fullName?: string | null;
  email?: string | null; role?: string | null; active?: number | boolean | null; country?: string | null; field?: string | null;
  countries?: string[] | string | null;
}

const CACHE_KEY = 'wg:users';
const CACHE_S = 300;

const isActive = (u: WgListUser) => u.active === undefined || u.active === null ? true : !!Number(u.active);
const countriesOf = (u: WgListUser): string[] => {
  const raw = Array.isArray(u.countries) ? u.countries : typeof u.countries === 'string' ? (() => { try { return JSON.parse(u.countries as string); } catch { return []; } })() : [];
  const list = (raw as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim());
  return [...new Set([...list, ...(u.country ? [u.country] : [])])];
};

/** The list, cached for five minutes so session checks don't hit WIREGUARD on every request. */
export async function wgUsers(env: Env, fresh = false): Promise<WgListUser[]> {
  if (!fresh) {
    const cached = await env.KV.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as WgListUser[];
  }
  const list = await fetchAsSync<WgListUser[]>(env, '/users');
  const clean = (Array.isArray(list) ? list : []).filter((u) => u && typeof u.username === 'string')
    // never keep anything password-like, whatever the upstream sends
    .map(({ username, employee_id, full_name, fullName, email, role, active, country, field, countries }) => ({ username, employee_id, full_name: full_name ?? fullName ?? null, email, role, active, country, field, countries }));
  await env.KV.put(CACHE_KEY, JSON.stringify(clean), { expirationTtl: CACHE_S });
  return clean;
}

/** Whether WIREGUARD still lists the person as active: 'yes', 'no' (missing or switched off), or 'unknown' (unreachable). */
export async function wgUserActive(env: Env, username: string): Promise<'yes' | 'no' | 'unknown'> {
  try {
    const u = (await wgUsers(env)).find((x) => x.username.toLowerCase() === username.toLowerCase());
    return u && isActive(u) ? 'yes' : 'no';
  } catch {
    return 'unknown';
  }
}

/**
 * Brings every WIREGUARD user into Users & Roles. New people get the role their WIREGUARD role maps to and their
 * WIREGUARD countries; people already here keep the role and countries the SLK Ops admin gave them, and only their
 * WIREGUARD details (name, email, employee ID, WIREGUARD role, country, field, active) are refreshed.
 */
export async function importWgUsers(env: Env, by: string) {
  const list = await wgUsers(env, true);
  const t = new Date().toISOString();
  const existing = new Set((await env.DB.prepare('SELECT username FROM user_roles').all<{ username: string }>()).results.map((r) => r.username.toLowerCase()));
  const stmts = list.map((u) => env.DB.prepare(
    `INSERT INTO user_roles (username, full_name, role, countries, wg_role, employee_eid, email, wg_active, wg_country, wg_field, wg_synced_at, updated_by, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?11)
     ON CONFLICT (username) DO UPDATE SET full_name = ?2, wg_role = ?5, employee_eid = coalesce(?6, employee_eid), email = coalesce(?7, email),
       wg_active = ?8, wg_country = ?9, wg_field = ?10, wg_synced_at = ?11`,
  ).bind(u.username, (u.full_name ?? u.username).trim() || u.username, defaultRoleFor(u.role), JSON.stringify(countriesOf(u)), u.role ?? null,
    u.employee_id ?? null, u.email ?? null, isActive(u) ? 1 : 0, u.country ?? null, u.field ?? null, t, by));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  await syncPeople(env); // everyone imported is on attendance (on the sheet their role is assigned to)
  const added = list.filter((u) => !existing.has(u.username.toLowerCase())).length;
  const inactive = list.filter((u) => !isActive(u)).length;
  await env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), by, 'import', 'user', 'wireguard', `Imported ${list.length} WIREGUARD users (${added} new, ${list.length - added} updated, ${inactive} inactive in WIREGUARD)`).run();
  return { total: list.length, added, updated: list.length - added, inactive };
}
