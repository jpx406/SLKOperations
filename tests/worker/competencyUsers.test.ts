import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, rows, run, signIn, startApp, type TestApp } from './helpers';

// Deleting a Competency user (src/worker/competency.ts): admins only, and only with their own WIREGUARD password.
// The password check is a read-only sign-in call to WIREGUARD; the stub here answers 404, which counts as wrong.
let t: TestApp;
let admin: string;
let editor: string;

const profile = (username: string) => rows(t, 'SELECT username FROM competency_users WHERE username = ?', username);

beforeAll(async () => {
  t = await startApp();
  admin = await signIn(t, 'adm1', { role: 'admin' });
  // not an admin, but with the Users tab's edit right, which used to be enough to remove a Competency user
  editor = await signIn(t, 'sup1', { role: 'slickline_supervisor' });
  await run(t, `INSERT INTO tab_grants (id, username, menu_key, effect, can_edit) VALUES ('g1', 'sup1', 'users', 'grant', 1)`);
  await signIn(t, 'tech1', { role: 'slickline_supervisor', fullName: 'Tech One' });
  await run(t, `INSERT INTO competency_users (username, role, updated_by, updated_at) VALUES ('tech1', 'Viewer', 'adm1', '2026-11-28T00:00:00Z')`);
});
afterAll(async () => {
  // only the password check may reach WIREGUARD, and only as a sign-in
  expect(t.wgCalls.every((u) => u.endsWith('/auth/login'))).toBe(true);
  await t.dispose();
});

describe('deleting a Competency user', () => {
  it('is refused for someone who is not an admin, even with the Users edit right', async () => {
    const r = await call(t, 'DELETE', '/competency/users/tech1', { cookie: editor, body: { password: 'x' } });
    expect(r.status).toBe(403);
    expect(await profile('tech1')).toHaveLength(1);
    expect(t.wgCalls).toEqual([]);
  });

  it('asks the admin for their password', async () => {
    const r = await call(t, 'DELETE', '/competency/users/tech1', { cookie: admin });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/password/);
    expect(await profile('tech1')).toHaveLength(1);
  });

  it('says so when the person is not a Competency user', async () => {
    const r = await call(t, 'DELETE', '/competency/users/nobody', { cookie: admin, body: { password: 'x' } });
    expect(r.status).toBe(404);
  });

  it('keeps the user and logs the try when the password is wrong', async () => {
    const r = await call(t, 'DELETE', '/competency/users/tech1', { cookie: admin, body: { password: 'wrong' } });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('That password is not right');
    expect(await profile('tech1')).toHaveLength(1);
    expect(await rows(t, `SELECT id FROM audit_log WHERE action = 'delete_refused' AND entity_id = 'tech1'`)).toHaveLength(1);
  });
});
