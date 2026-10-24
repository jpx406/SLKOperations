import type { Env } from './env';

// The only door to WIREGUARD. Read-only by construction: GETs on an allow-list, plus sign-in.
// WIREGUARD stays independent; nothing here can change its data.

const READ_ALLOW = new Set([
  '/health', '/auth/me', '/units', '/job-types', '/job-locations', '/fields', '/rigs',
  '/wires', '/drums', '/jobs', '/documents', '/notifications', '/kpi-settings', '/sop-settings',
  '/sop-wire-size-thresholds', '/wire-alloy-database', '/wire-retirement-reasons', '/',
]);

export class WgError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface WgUser { username: string; fullName: string; role: string; mustChangePassword?: boolean }

async function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await env.WIREGUARD.fetch(new Request(`https://wireguard${path}`, init));
  } catch (e) {
    throw new WgError(503, `WIREGUARD unreachable: ${(e as Error).message}`);
  }
}

export async function wgLogin(env: Env, username: string, password: string): Promise<{ token: string; user: WgUser }> {
  const res = await call(env, '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string; user?: WgUser; error?: string };
  if (!res.ok || !body.token || !body.user) throw new WgError(res.status || 502, body.error ?? 'Sign-in failed');
  return { token: body.token, user: body.user };
}

export async function wgGet<T>(env: Env, token: string, path: string): Promise<T> {
  const bare = path.split('?')[0];
  if (!READ_ALLOW.has(bare)) throw new WgError(500, `WIREGUARD path not on the read allow-list: ${bare}`);
  const res = await call(env, path, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new WgError(401, 'WIREGUARD session expired');
  if (!res.ok) throw new WgError(res.status >= 500 ? 503 : res.status, `WIREGUARD ${bare} answered ${res.status}`);
  return (await res.json()) as T;
}

/** Countries a user can see, worked out from the units WIREGUARD shows them (its /auth/me has no countries). */
export async function wgCountriesFor(env: Env, token: string): Promise<string[]> {
  const units = await wgGet<{ country: string | null }[]>(env, token, '/units');
  return [...new Set(units.map((u) => u.country).filter((c): c is string => !!c))].sort();
}
