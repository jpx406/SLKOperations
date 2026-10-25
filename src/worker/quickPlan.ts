import { Hono } from 'hono';
import { checkCard, isColumn, reorder, type QpCard } from '../shared/quickPlan';
import type { AppBindings, AuthedUser, Env } from './env';

// Quick Plan (S25). Cards are working notes for early scheduling talks, kept per country. Turning one into a job
// creates the job through the normal job route (with its checks) and then links the card here.

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'quick_plan_cards', id, summary.slice(0, 1000));

export const quickPlan = new Hono<AppBindings>();

quickPlan.get('/', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT q.*, j.ticket_no FROM quick_plan_cards q LEFT JOIN jobs j ON j.id = q.promoted_job_id
     WHERE q.country IN (SELECT value FROM json_each(?)) ORDER BY q.column_key, q.sort, q.created_at`,
  ).bind(JSON.stringify(user.countries)).all<QpCard>();
  return c.json({ cards: results, canEdit: !!user.menus.quick_plan?.edit, canCreateJobs: !!user.menus.jobs?.edit });
});

async function own(c: { env: Env; get: (k: 'user') => AuthedUser }, id: string) {
  const r = await c.env.DB.prepare('SELECT * FROM quick_plan_cards WHERE id = ?').bind(id).first<QpCard>();
  return r && c.get('user').countries.includes(r.country) ? r : null;
}

quickPlan.post('/', async (c) => {
  const user = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const country = typeof b.country === 'string' ? b.country : user.countries[0];
  if (!user.countries.includes(country)) return c.json({ error: 'Pick one of your countries' }, 400);
  const r = checkCard(b);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const id = crypto.randomUUID();
  const last = await c.env.DB.prepare(`SELECT coalesce(max(sort), -1) AS s FROM quick_plan_cards WHERE country = ? AND column_key = 'idea'`).bind(country).first<{ s: number }>();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO quick_plan_cards (id, country, title, notes, target_date, unit_number, column_key, sort, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, country, r.card.title, r.card.notes, r.card.target_date, r.card.unit_number, 'idea', (last?.s ?? -1) + 1, user.username),
    audit(c.env, user, 'create', id, `${country}: ${r.card.title}`),
  ]);
  return c.json({ id }, 201);
});

quickPlan.put('/:id', async (c) => {
  const user = c.get('user');
  const cur = await own(c, c.req.param('id'));
  if (!cur) return c.json({ error: 'Card not found' }, 404);
  const r = checkCard(await c.req.json().catch(() => ({})));
  if ('error' in r) return c.json({ error: r.error }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE quick_plan_cards SET title = ?, notes = ?, target_date = ?, unit_number = ? WHERE id = ?').bind(r.card.title, r.card.notes, r.card.target_date, r.card.unit_number, cur.id),
    audit(c.env, user, 'update', cur.id, r.card.title),
  ]);
  return c.json({ ok: true });
});

quickPlan.post('/:id/move', async (c) => {
  const cur = await own(c, c.req.param('id'));
  if (!cur) return c.json({ error: 'Card not found' }, 404);
  const b = await c.req.json<{ column_key?: string; index?: number }>().catch(() => ({} as { column_key?: string; index?: number }));
  if (!isColumn(b.column_key)) return c.json({ error: 'Unknown column' }, 400);
  const { results } = await c.env.DB.prepare('SELECT id, column_key, sort FROM quick_plan_cards WHERE country = ? AND column_key = ?').bind(cur.country, b.column_key).all<Pick<QpCard, 'id' | 'column_key' | 'sort'>>();
  const placed = reorder([...results, cur], cur.id, b.column_key, Number.isInteger(b.index) ? b.index! : results.length);
  await c.env.DB.batch(placed.map((p) => c.env.DB.prepare('UPDATE quick_plan_cards SET column_key = ?, sort = ? WHERE id = ?').bind(p.column_key, p.sort, p.id)));
  return c.json({ ok: true });
});

/** Links the card to the job just created from it. */
quickPlan.post('/:id/promote', async (c) => {
  const user = c.get('user');
  const cur = await own(c, c.req.param('id'));
  if (!cur) return c.json({ error: 'Card not found' }, 404);
  const { job_id } = await c.req.json<{ job_id?: string }>().catch(() => ({} as { job_id?: string }));
  const job = await c.env.DB.prepare('SELECT id, country, ticket_no FROM jobs WHERE id = ? AND deleted_at IS NULL').bind(job_id ?? '').first<{ id: string; country: string; ticket_no: string | null }>();
  if (!job || !user.countries.includes(job.country)) return c.json({ error: 'Job not found' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE quick_plan_cards SET promoted_job_id = ? WHERE id = ?').bind(job.id, cur.id),
    audit(c.env, user, 'promote', cur.id, `${cur.title} → job ${job.ticket_no ?? job.id}`),
  ]);
  return c.json({ ok: true });
});

quickPlan.delete('/:id', async (c) => {
  const user = c.get('user');
  const cur = await own(c, c.req.param('id'));
  if (!cur) return c.json({ error: 'Card not found' }, 404);
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM quick_plan_cards WHERE id = ?').bind(cur.id), audit(c.env, user, 'delete', cur.id, cur.title)]);
  return c.json({ ok: true });
});
