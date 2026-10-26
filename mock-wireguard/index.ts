// Mock WIREGUARD for local development. Mirrors the response shapes of the real Worker's endpoints that
// SLK Ops reads (see replica/integration-wireguard.md), including its country rule: rows are filtered to
// the caller's countries, Admin sees everything, rows without a country are Admin-only.
// It is wired in only by `vite dev` (auxiliary Worker). Production binds to the real WIREGUARD.

import data from './data.json';
import fixtures from './fixtures.json';
import userFile from './users.json';

type MockUser = (typeof userFile.users)[number];

const SESSION_MS = 12 * 3600_000;
const BUILD_STAMP = 'mock-2026-10-19T01-00';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// Unsigned on purpose: this token only ever exists between two local dev Workers.
const makeToken = (u: MockUser) => btoa(JSON.stringify({ uid: u.id, username: u.username, exp: Date.now() + SESSION_MS }));

function readToken(request: Request): MockUser | null {
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const payload = JSON.parse(atob(auth.slice(7)));
    if (!(payload.exp > Date.now())) return null;
    const user = userFile.users.find((u) => u.id === payload.uid);
    return user && user.active ? user : null;
  } catch {
    return null;
  }
}

function byCountry<T extends { country?: string | null }>(rows: T[], user: MockUser): T[] {
  if (user.role === 'Admin') return rows;
  if (!user.countries.length) return [];
  return rows.filter((r) => r.country && user.countries.includes(r.country));
}

const withIds = <T extends object>(prefix: string, rows: T[]) => rows.map((r, i) => ({ id: `${prefix}-${i + 1}`, ...r }));

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const method = request.method;

    if (pathname === '/health') return json({ status: 'ok', timestamp: Date.now(), skipAuth: false });
    if (pathname === '/' || pathname === '/wireguard.html') {
      return new Response(`<!doctype html><meta name="app-build" content="${BUILD_STAMP}"><title>WIREGUARD (mock)</title>`, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (pathname === '/auth/login' && method === 'POST') {
      let body: { username?: string; password?: string };
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      if (!body.username || !body.password) return json({ error: 'Username and password required' }, 400);
      const user = userFile.users.find((u) => u.username.toLowerCase() === String(body.username).toLowerCase());
      if (!user) return json({ error: 'Invalid credentials' }, 401);
      if (!user.active) return json({ error: 'Account is inactive. Contact an administrator.' }, 403);
      if (user.password !== body.password) return json({ error: 'Invalid credentials' }, 401);
      return json({
        token: makeToken(user),
        user: { kind: 'user', id: user.id, username: user.username, fullName: user.fullName, role: user.role, mustChangePassword: false },
      });
    }

    const user = readToken(request);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    if (pathname === '/auth/me' && method === 'GET') {
      return json({ user: { kind: 'user', id: user.id, username: user.username, fullName: user.fullName, role: user.role, mustChangePassword: false } });
    }
    if (pathname === '/auth/logout' && method === 'POST') return json({ success: true });

    if (method !== 'GET') return json({ error: 'The mock only serves reads' }, 405);
    const params = new URL(request.url).searchParams;
    switch (pathname) {
      // the user list, shaped like WIREGUARD's GET /users (never with passwords); fake test accounts only
      case '/users': return json(userFile.users.map((u) => ({
        id: u.id, username: u.username, employee_id: u.username.replace('NESR-', ''), full_name: u.fullName,
        email: `${u.username.toLowerCase()}@example.test`, role: u.role, active: u.active, country: u.countries[0] ?? null, field: null, countries: u.countries,
      })));
      case '/wires': return json(byCountry(data.wires, user));
      case '/drums': return json(byCountry(data.drums, user));
      case '/jobs': {
        // like WIREGUARD: approved only by default, ?status=all for everything, ?status=x for one status
        const status = params.get('status');
        const rows = data.jobs.filter((j) => status === 'all' ? true : status ? j.approval_status === status : j.approval_status === 'approved');
        return json(byCountry(rows, user));
      }
      case '/documents': {
        const status = params.get('status');
        const wireCountry = new Map(data.wires.map((w) => [w.wire_serial_number, w.country]));
        const drumCountry = new Map(data.drums.map((d) => [d.drum_no, d.country]));
        const rows = data.documents
          .filter((d) => status === 'all' ? true : status ? d.approval_status === status
            : d.approval_status === 'approved' || !['wire_maintenance_entry', 'drum_mpi'].includes(d.doc_type))
          .map((d) => ({ ...d, resolved_country: wireCountry.get(d.wire_serial_number ?? '') ?? drumCountry.get(d.drum_no ?? '') ?? null }));
        return json(byCountry(rows.map((r) => ({ ...r, country: r.resolved_country })), user).map(({ resolved_country: _r, country: _c, ...d }) => d));
      }
      // WIREGUARD's notifications endpoint has no country filter and no permission check
      case '/notifications': return json(data.notifications);
      case '/kpi-settings':
      case '/sop-settings':
      case '/sop-wire-size-thresholds':
      case '/wire-alloy-database':
      case '/wire-retirement-reasons':
        return json(data.settings[pathname.slice(1) as keyof typeof data.settings]);
      case '/units': return json(byCountry(withIds('unit', fixtures.units), user));
      case '/job-types': return json(byCountry(withIds('jt', fixtures.job_types), user));
      case '/job-locations': return json(byCountry(withIds('jl', fixtures.job_locations), user));
      case '/fields': return json(byCountry(withIds('fld', fixtures.fields), user));
      case '/rigs': return json(byCountry(withIds('rig', fixtures.rigs), user));
      default: return json({ error: 'Not found in mock' }, 404);
    }
  },
};
