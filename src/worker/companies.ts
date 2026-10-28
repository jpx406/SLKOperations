import { Hono } from 'hono';
import type { AppBindings, AuthedUser, Env } from './env';

// Administration → Companies (owner request 2026-10-28): the companies a job can be run by (NESR, SAPESCO …),
// picked on the job's Design stage. A rename follows through to the jobs that use the company; a company in use
// can be switched off (no longer offered) but not deleted.

export const companies = new Hono<AppBindings>();

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'company', id, summary.slice(0, 1000));

const cleanName = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);

companies.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT co.id, co.name, co.active, co.sort, co.updated_at, coalesce(u.full_name, co.updated_by) AS updated_by,
            (SELECT count(*) FROM job_extras x JOIN jobs j ON j.id = x.job_id WHERE x.company = co.name AND j.deleted_at IS NULL) AS jobs
     FROM companies co LEFT JOIN user_roles u ON u.username = co.updated_by ORDER BY co.sort, co.name`,
  ).all();
  return c.json(results);
});

companies.post('/', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  const name = cleanName(b.name);
  if (!name) return c.json({ error: 'Type the company name' }, 400);
  if (await c.env.DB.prepare('SELECT 1 FROM companies WHERE name = ? COLLATE NOCASE').bind(name).first()) return c.json({ error: `${name} is already on the list` }, 409);
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO companies (id, name, sort, updated_by) VALUES (?, ?, (SELECT coalesce(max(sort), 0) + 1 FROM companies), ?)`).bind(id, name, user.username),
    audit(c.env, user, 'create', id, `Company ${name} added`),
  ]);
  return c.json({ ok: true, id });
});

companies.put('/:id', async (c) => {
  const user = c.get('user');
  const cur = await c.env.DB.prepare('SELECT id, name, active, sort FROM companies WHERE id = ?').bind(c.req.param('id')).first<{ id: string; name: string; active: number; sort: number }>();
  if (!cur) return c.json({ error: 'Company not found' }, 404);
  const b = await c.req.json<{ name?: string; active?: boolean; sort?: number }>().catch(() => ({} as { name?: string; active?: boolean; sort?: number }));
  const name = b.name === undefined ? cur.name : cleanName(b.name);
  if (!name) return c.json({ error: 'Type the company name' }, 400);
  if (name.toLowerCase() !== cur.name.toLowerCase() && await c.env.DB.prepare('SELECT 1 FROM companies WHERE name = ? COLLATE NOCASE AND id <> ?').bind(name, cur.id).first()) {
    return c.json({ error: `${name} is already on the list` }, 409);
  }
  const active = b.active === undefined ? cur.active : b.active ? 1 : 0;
  const sort = Number.isFinite(Number(b.sort)) && b.sort !== undefined ? Math.round(Number(b.sort)) : cur.sort;
  const changes = [name !== cur.name && `renamed ${cur.name} → ${name}`, active !== cur.active && (active ? 'switched on' : 'switched off'), sort !== cur.sort && `order ${cur.sort} → ${sort}`].filter(Boolean);
  if (!changes.length) return c.json({ ok: true });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE companies SET name = ?, active = ?, sort = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(name, active, sort, user.username, new Date().toISOString(), cur.id),
    // the jobs keep the company's name, so a rename follows through to them
    ...(name !== cur.name ? [c.env.DB.prepare('UPDATE job_extras SET company = ? WHERE company = ?').bind(name, cur.name)] : []),
    audit(c.env, user, 'edit', cur.id, `Company ${cur.name}: ${changes.join(', ')}`),
  ]);
  return c.json({ ok: true });
});

companies.delete('/:id', async (c) => {
  const user = c.get('user');
  const cur = await c.env.DB.prepare('SELECT id, name FROM companies WHERE id = ?').bind(c.req.param('id')).first<{ id: string; name: string }>();
  if (!cur) return c.json({ error: 'Company not found' }, 404);
  const used = await c.env.DB.prepare('SELECT count(*) AS n FROM job_extras x JOIN jobs j ON j.id = x.job_id WHERE x.company = ? AND j.deleted_at IS NULL').bind(cur.name).first<{ n: number }>();
  if (used?.n) return c.json({ error: `${cur.name} is on ${used.n} job${used.n === 1 ? '' : 's'}. Switch it off instead, so it is no longer offered.` }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM companies WHERE id = ?').bind(cur.id),
    audit(c.env, user, 'delete', cur.id, `Company ${cur.name} removed`),
  ]);
  return c.json({ ok: true });
});
