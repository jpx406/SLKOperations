import { Hono } from 'hono';
import { checkDoc, type KnowledgeDoc } from '../shared/knowledge';
import type { AppBindings, AuthedUser, Env } from './env';

// Knowledge Hub (S21). Everyone with the tab reads the library for their countries; people with its edit right
// add and correct entries and pick the lesson of the week. Entries are never hard-deleted: a duplicate points at
// the entry it repeats and is hidden unless "Show duplicates" is on.

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'knowledge_docs', id, summary.slice(0, 1000));

const COLS = 'id, country, doc_type, category, title, summary, key_action, failure_types, published_on, rilr_ref, source_ref, duplicate_of, lesson_of_week_from';
const toDoc = (r: Record<string, unknown>) => ({ ...r, failure_types: JSON.parse(String(r.failure_types ?? '[]')) }) as KnowledgeDoc;

export const knowledge = new Hono<AppBindings>();

knowledge.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${COLS} FROM knowledge_docs WHERE country IN (SELECT value FROM json_each(?)) ORDER BY published_on DESC, title LIMIT 5000`)
    .bind(JSON.stringify(c.get('user').countries)).all();
  return c.json({ docs: results.map(toDoc), canEdit: !!c.get('user').menus.knowledge_hub?.edit });
});

async function own(c: { env: Env; get: (k: 'user') => AuthedUser }, id: string) {
  const r = await c.env.DB.prepare(`SELECT ${COLS} FROM knowledge_docs WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  return r && c.get('user').countries.includes(String(r.country)) ? toDoc(r) : null;
}

knowledge.get('/:id', async (c) => {
  const d = await own(c, c.req.param('id'));
  return d ? c.json(d) : c.json({ error: 'Document not found' }, 404);
});

knowledge.post('/', async (c) => {
  const user = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const country = typeof b.country === 'string' ? b.country : user.countries[0];
  if (!user.countries.includes(country)) return c.json({ error: 'Pick one of your countries' }, 400);
  const r = checkDoc(b);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const d = r.doc;
  if (d.duplicate_of && !(await own(c, d.duplicate_of))) return c.json({ error: 'The original document was not found' }, 400);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO knowledge_docs (id, country, doc_type, category, title, summary, key_action, failure_types, published_on, rilr_ref, source_ref, duplicate_of)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, country, d.doc_type, d.category, d.title, d.summary, d.key_action, JSON.stringify(d.failure_types), d.published_on, d.rilr_ref, d.source_ref, d.duplicate_of),
      audit(c.env, user, 'create', id, `${country}: ${d.title}`),
    ]);
  } catch (e) {
    if (/UNIQUE/.test((e as Error).message)) return c.json({ error: 'Another document already uses that link' }, 400);
    throw e;
  }
  return c.json({ id }, 201);
});

knowledge.put('/:id', async (c) => {
  const user = c.get('user');
  const cur = await own(c, c.req.param('id'));
  if (!cur) return c.json({ error: 'Document not found' }, 404);
  const r = checkDoc(await c.req.json().catch(() => ({})));
  if ('error' in r) return c.json({ error: r.error }, 400);
  const d = r.doc;
  if (d.duplicate_of === cur.id) return c.json({ error: 'A document can’t repeat itself' }, 400);
  if (d.duplicate_of && !(await own(c, d.duplicate_of))) return c.json({ error: 'The original document was not found' }, 400);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE knowledge_docs SET doc_type = ?, category = ?, title = ?, summary = ?, key_action = ?, failure_types = ?, published_on = ?, rilr_ref = ?, source_ref = ?, duplicate_of = ? WHERE id = ?`)
        .bind(d.doc_type, d.category, d.title, d.summary, d.key_action, JSON.stringify(d.failure_types), d.published_on, d.rilr_ref, d.source_ref, d.duplicate_of, cur.id),
      audit(c.env, user, 'update', cur.id, d.title === cur.title ? d.title : `${cur.title} → ${d.title}`),
    ]);
  } catch (e) {
    if (/UNIQUE/.test((e as Error).message)) return c.json({ error: 'Another document already uses that link' }, 400);
    throw e;
  }
  return c.json({ ok: true });
});

/** Makes this the lesson of the week from today (Riyadh date). */
knowledge.post('/:id/lesson-of-week', async (c) => {
  const user = c.get('user');
  const cur = await own(c, c.req.param('id'));
  if (!cur) return c.json({ error: 'Document not found' }, 404);
  if (cur.duplicate_of) return c.json({ error: 'Pick the original, not a duplicate' }, 400);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE knowledge_docs SET lesson_of_week_from = ? WHERE id = ?').bind(today, cur.id),
    audit(c.env, user, 'lesson_of_week', cur.id, `${cur.title} from ${today}`),
  ]);
  return c.json({ ok: true, from: today });
});
