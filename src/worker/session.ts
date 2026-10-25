import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { defaultRoleFor } from '../shared/roles';
import type { Role } from '../shared/types';
import type { AppBindings, AuthedUser, Env, Session } from './env';
import { loadMenus } from './permissions';
import { WgError, wgCountriesFor, wgGet, wgLogin } from './wg';

const COOKIE = 'slk_session';
const REVALIDATE_MS = 60_000;          // re-check with WIREGUARD at most once a minute
const OUTAGE_GRACE_MS = 15 * 60_000;   // keep working this long if WIREGUARD is unreachable
const SESSION_TTL_S = 12 * 3600;       // never outlive WIREGUARD's 12-hour token

const key = (id: string) => `session:${id}`;
const now = () => new Date().toISOString();

export async function login(c: Context<AppBindings>, username: string, password: string) {
  const env = c.env;
  const { token, user } = await wgLogin(env, username.trim(), password);
  const countries = await wgCountriesFor(env, token);

  const existing = await env.DB.prepare('SELECT role FROM user_roles WHERE username = ?').bind(user.username).first<{ role: Role }>();
  const role: Role = existing?.role ?? defaultRoleFor(user.role);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user_roles (username, full_name, role, countries, wg_role, last_login_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
       ON CONFLICT (username) DO UPDATE SET full_name = ?2, wg_role = ?5, last_login_at = ?6`,
    ).bind(user.username, user.fullName, role, JSON.stringify(countries), user.role, now()),
    env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), user.username, 'login', 'auth', user.username, `Signed in through WIREGUARD (${user.role})`),
  ]);

  const sessionId = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  const t = Date.now();
  const session: Session = { username: user.username, fullName: user.fullName, wgRole: user.role, wgToken: token, countries, createdAt: t, lastSeen: t, validatedAt: t };
  await env.KV.put(key(sessionId), JSON.stringify(session), { expirationTtl: SESSION_TTL_S });
  setCookie(c, COOKIE, sessionId, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_TTL_S });
  return { username: user.username, mustChangePassword: !!user.mustChangePassword };
}

export async function logout(c: Context<AppBindings>) {
  const id = getCookie(c, COOKIE);
  if (id) await c.env.KV.delete(key(id));
  deleteCookie(c, COOKIE, { path: '/' });
}

async function revalidate(env: Env, s: Session): Promise<'ok' | 'revoked' | 'outage'> {
  try {
    await wgGet(env, s.wgToken, '/auth/me');
    return 'ok';
  } catch (e) {
    if (e instanceof WgError && (e.status === 401 || e.status === 403)) return 'revoked';
    return 'outage';
  }
}

type Resolved = { user: AuthedUser } | { error: string; status: 401 | 403 | 503 };

/** Checks the session cookie, idle time and WIREGUARD's verdict; loads role and menus. */
export async function resolveSession(c: Context<AppBindings>): Promise<Resolved> {
  const env = c.env;
  const id = getCookie(c, COOKIE);
  const raw = id ? await env.KV.get(key(id)) : null;
  if (!id || !raw) return { error: 'Not signed in', status: 401 };
  const s = JSON.parse(raw) as Session;
  const t = Date.now();

  if (t - s.lastSeen > Number(env.IDLE_MINUTES || 60) * 60_000) {
    await env.KV.delete(key(id));
    return { error: 'Signed out after inactivity', status: 401 };
  }
  if (t - s.validatedAt > REVALIDATE_MS) {
    const v = await revalidate(env, s);
    if (v === 'revoked') {
      await env.KV.delete(key(id));
      return { error: 'Your WIREGUARD session ended. Sign in again.', status: 401 };
    }
    if (v === 'outage' && t - s.validatedAt > OUTAGE_GRACE_MS) {
      return { error: 'WIREGUARD is unreachable, so sign-in cannot be confirmed. Try again shortly.', status: 503 };
    }
    if (v === 'ok') s.validatedAt = t;
  }
  s.lastSeen = t;
  await env.KV.put(key(id), JSON.stringify(s), { expirationTtl: SESSION_TTL_S });

  const row = await env.DB.prepare('SELECT role, active, countries FROM user_roles WHERE username = ?').bind(s.username).first<{ role: Role; active: number; countries: string }>();
  if (!row || !row.active) return { error: 'Your SLK Ops access is switched off. Ask an administrator.', status: 403 };
  const menus = await loadMenus(env, row.role, s.username);
  // countries belong to the SLK Ops admin (Users & Roles); admins see every country WIREGUARD has
  let countries = JSON.parse(row.countries || '[]') as string[];
  if (row.role === 'admin') {
    const all = await env.DB.prepare('SELECT DISTINCT country FROM wg_units WHERE wg_active = 1').all<{ country: string }>();
    countries = [...new Set([...countries, ...all.results.map((r) => r.country)])].sort();
  }
  // the header country switch narrows every screen to one country without changing what the person may see
  const allCountries = countries;
  const pick = c.req.header('x-slk-country');
  if (pick && countries.includes(pick)) countries = [pick];
  return { user: { username: s.username, fullName: s.fullName, role: row.role, wgRole: s.wgRole, countries, allCountries, menus, sessionId: id, stepUpUntil: s.stepUpUntil ?? 0 } };
}

/** Requires a valid SLK Ops session that WIREGUARD still honours. */
export const requireSession: MiddlewareHandler<AppBindings> = async (c, next) => {
  const r = await resolveSession(c);
  if ('error' in r) return c.json({ error: r.error }, r.status);
  c.set('user', r.user);
  await next();
};

export const STEP_UP_MS = 30 * 60_000;

/**
 * Step-up for compensation and revenue figures: the person re-enters their WIREGUARD password, WIREGUARD checks it,
 * and the session opens those pages for 30 minutes. Replaces the original's shared access code.
 */
export async function stepUp(c: Context<AppBindings>, password: string) {
  const user = c.get('user');
  await wgLogin(c.env, user.username, password);
  const raw = await c.env.KV.get(key(user.sessionId));
  if (!raw) return { ok: false as const };
  const s = JSON.parse(raw) as Session;
  s.stepUpUntil = Date.now() + STEP_UP_MS;
  await c.env.KV.put(key(user.sessionId), JSON.stringify(s), { expirationTtl: SESSION_TTL_S });
  await c.env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, 'step_up', 'auth', user.username, 'Unlocked bonus and revenue figures for 30 minutes').run();
  return { ok: true as const, until: s.stepUpUntil };
}
