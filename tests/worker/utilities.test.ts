import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, rows, signIn, startApp, type TestApp } from './helpers';

// Utilities projects (src/worker/utilities.ts): a duplicated project shares its original's stored files, so a file is
// removed from storage (R2) only when the last project using it lets go.
let t: TestApp;
let user: string;

async function project(name: string) {
  const r = await call(t, 'POST', '/utilities', { cookie: user, body: { kind: 'rigup', name } });
  expect(r.status).toBe(201);
  return r.json.id as string;
}

async function upload(projectId: string, name: string, text: string) {
  const r = await call(t, 'POST', `/utilities/${projectId}/files`, { cookie: user, headers: { 'x-file-name': encodeURIComponent(name) }, raw: new TextEncoder().encode(text) });
  expect(r.status).toBe(201);
  const [f] = await rows<{ id: string; r2_key: string }>(t, 'SELECT id, r2_key FROM utility_files WHERE id = ?', r.json.id);
  return f;
}

async function duplicate(projectId: string) {
  const r = await call(t, 'POST', `/utilities/${projectId}/duplicate`, { cookie: user, body: {} });
  expect(r.status).toBe(201);
  return r.json.id as string;
}

const stored = async (key: string) => (await t.env.FILES!.head(key)) !== null;

beforeAll(async () => {
  t = await startApp();
  user = await signIn(t, 'sup1', { role: 'slickline_supervisor' });
});
afterAll(async () => {
  expect(t.wgCalls).toEqual([]);
  await t.dispose();
});

describe('utility project files and duplicates', () => {
  it('deleting a file keeps the stored object while a copy still uses it, and removes it with the last user', async () => {
    const p = await project('Rig up A');
    const f = await upload(p, 'notes.txt', 'hello');
    expect(await stored(f.r2_key)).toBe(true);

    const copy = await duplicate(p);
    const copies = await rows<{ id: string; r2_key: string }>(t, 'SELECT id, r2_key FROM utility_files WHERE project_id = ?', copy);
    expect(copies).toEqual([{ id: `${f.id}-${copy.slice(0, 8)}`, r2_key: f.r2_key }]);

    const d1 = await call(t, 'DELETE', `/utilities/${p}/files/${f.id}`, { cookie: user });
    expect(d1.status).toBe(200);
    expect(await stored(f.r2_key)).toBe(true);
    // the copy still downloads it
    const dl = await call(t, 'GET', `/utilities/${copy}/files/${copies[0].id}`, { cookie: user });
    expect(dl.status).toBe(200);
    expect(dl.json).toBe('hello');

    const d2 = await call(t, 'DELETE', `/utilities/${copy}/files/${copies[0].id}`, { cookie: user });
    expect(d2.status).toBe(200);
    expect(await stored(f.r2_key)).toBe(false);
    expect(await rows(t, 'SELECT 1 FROM utility_files WHERE r2_key = ?', f.r2_key)).toEqual([]);
  });

  it('deleting a whole project does the same', async () => {
    const p = await project('Rig up B');
    const f = await upload(p, 'plan.txt', 'plan');
    const copy = await duplicate(p);

    expect((await call(t, 'DELETE', `/utilities/${p}`, { cookie: user })).status).toBe(200);
    expect(await rows(t, 'SELECT 1 FROM utility_projects WHERE id = ?', p)).toEqual([]);
    expect(await stored(f.r2_key)).toBe(true);

    expect((await call(t, 'DELETE', `/utilities/${copy}`, { cookie: user })).status).toBe(200);
    expect(await stored(f.r2_key)).toBe(false);
    const log = await rows<{ action: string }>(t, `SELECT action FROM audit_log WHERE entity_type = 'utility_project' AND entity_id IN (?, ?) ORDER BY rowid`, p, copy);
    expect(log.map((l) => l.action)).toEqual(['create', 'duplicate', 'delete', 'delete']);
  });

  it('only whoever made a project, the delete right or an admin deletes it', async () => {
    const p = await project('Rig up C');
    const other = await signIn(t, 'sup2', { role: 'slickline_supervisor' });
    const r = await call(t, 'DELETE', `/utilities/${p}`, { cookie: other });
    expect(r.status).toBe(403);
    expect(await rows(t, 'SELECT 1 FROM utility_projects WHERE id = ?', p)).toHaveLength(1);
  });
});
