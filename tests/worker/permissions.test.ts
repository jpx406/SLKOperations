import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, rows, signIn, startApp, type TestApp } from './helpers';

// The middleware in src/worker/index.ts: reads follow READ_RULES, writes follow WRITE_RULES (deny by default),
// and every write must come from this app's own origin.
let t: TestApp;
let viewer: string, admin: string;

beforeAll(async () => {
  t = await startApp();
  viewer = await signIn(t, 'viewer1', { role: 'viewer' });
  admin = await signIn(t, 'admin1', { role: 'admin' });
});
afterAll(async () => {
  expect(t.wgCalls).toEqual([]);
  await t.dispose();
});

describe('permissions middleware', () => {
  it('lets a signed-in user read what their menus allow', async () => {
    const r = await call(t, 'GET', '/me', { cookie: viewer });
    expect(r.status).toBe(200);
    expect(r.json.username).toBe('viewer1');
    expect(r.json.role).toBe('viewer');
  });

  it('refuses a request without a session', async () => {
    const r = await call(t, 'GET', '/me');
    expect(r.status).toBe(401);
  });

  it('refuses a GET the menus do not allow with 403', async () => {
    // the viewer role has no bonus or reconciliation right
    for (const path of ['/bonus/rules', '/recon/summary', '/sales/activity']) {
      const r = await call(t, 'GET', path, { cookie: viewer });
      expect(r.status, path).toBe(403);
      expect(r.json.error).toBe('Your access does not include this page');
    }
  });

  it('refuses a write with no WRITE_RULE, even for an admin', async () => {
    const r = await call(t, 'POST', '/me', { cookie: admin, body: {} });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('This action is not allowed');
    const r2 = await call(t, 'DELETE', '/bonus/rules', { cookie: admin });
    expect(r2.status).toBe(403);
  });

  it('refuses a write the role lacks the right for', async () => {
    const r = await call(t, 'PUT', '/bonus/splits', { cookie: viewer, body: { country: 'KSA', splits: {} } });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('Your role cannot do this here');
  });

  it('refuses a write from another origin, before the session is looked at', async () => {
    const r = await call(t, 'PUT', '/bonus/splits', { cookie: admin, origin: 'https://other.nesrapp.com', body: { country: 'KSA', splits: { helper: 100 } } });
    expect(r.status).toBe(403);
    expect(r.json.error).toMatch(/another site/);
    expect(await rows(t, 'SELECT * FROM bonus_role_splits')).toEqual([]);
  });

  it('refuses a write with no Origin when the browser says it is cross-site', async () => {
    const r = await call(t, 'PUT', '/bonus/splits', { cookie: admin, origin: null, headers: { 'sec-fetch-site': 'cross-site' }, body: { country: 'KSA', splits: { helper: 100 } } });
    expect(r.status).toBe(403);
  });

  it('accepts the same write from this origin', async () => {
    const r = await call(t, 'PUT', '/bonus/splits', { cookie: admin, body: { country: 'KSA', splits: { slickline_supervisor: 40, slickline_operator: 30, assistant_operator: 20, helper: 10 } } });
    expect(r.status).toBe(200);
    expect(await rows(t, 'SELECT crew_role, share_pct FROM bonus_role_splits ORDER BY crew_role')).toHaveLength(4);
  });

  it('no longer serves the old /api/roster routes', async () => {
    for (const [m, p] of [['GET', '/roster'], ['GET', '/roster/123'], ['POST', '/roster'], ['PATCH', '/roster/123'], ['DELETE', '/roster/123']] as const) {
      const r = await call(t, m, p, { cookie: admin, body: m === 'GET' || m === 'DELETE' ? undefined : {} });
      expect([403, 404], `${m} ${p}`).toContain(r.status);
    }
  });

  it('ends a Face ID session when Face ID is switched off for the account', async () => {
    const c = await signIn(t, 'nopasskey', { role: 'viewer', passkeyAllowed: false });
    const r = await call(t, 'GET', '/me', { cookie: c });
    expect(r.status).toBe(401);
  });
});
