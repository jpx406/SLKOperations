import { Hono, type Context } from 'hono';
import { AUDIT_AREAS, areaOf } from '../shared/audit';
import type { AppBindings } from './env';

// Administration → Audit trail (owner request 2026-10-28). Every screen already writes its changes to audit_log;
// this reads them back with filters, and records the sign-in events with the address and browser they came from.

/** A sign-in event (signed in, failed, signed out, timed out, refused), with where it came from. */
export function authEvent(c: Context<AppBindings>, username: string, action: string, summary: string) {
  return c.env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), username.slice(0, 80), action, 'auth', username.slice(0, 80), summary.slice(0, 1000),
      c.req.header('cf-connecting-ip') ?? null, c.req.header('user-agent')?.slice(0, 300) ?? null);
}

export const audit = new Hono<AppBindings>();

const list = (v: string[]) => v.map((x) => x.trim()).filter(Boolean).slice(0, 50);
const isDay = (d: string | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

/**
 * GET /api/audit?from=&to=&user=&action=&area=&q=&before=&limit=
 * Newest first. `before` is the last row's "occurred_at|id" to read the next page. Facets and counts cover the dates
 * picked, so the filters only offer what happened then.
 */
audit.get('/', async (c) => {
  const q = new URL(c.req.url).searchParams;
  const from = isDay(q.get('from') ?? undefined) ? `${q.get('from')}T00:00:00` : '0000';
  const to = isDay(q.get('to') ?? undefined) ? `${q.get('to')}T23:59:59.999Z` : '9999';
  const users = list(q.getAll('user')), actions = list(q.getAll('action')), areas = list(q.getAll('area'));
  const types = areas.flatMap((a) => AUDIT_AREAS[a as keyof typeof AUDIT_AREAS]?.types ?? []);
  const text = (q.get('q') ?? '').trim().slice(0, 100);
  const limit = Math.min(5000, Math.max(1, Number(q.get('limit')) || 200));
  const before = (q.get('before') ?? '').split('|');

  const where = ['a.occurred_at >= ?1', 'a.occurred_at <= ?2'];
  const binds: unknown[] = [from, to];
  const add = (sql: string, v: unknown) => { binds.push(v); where.push(sql.replace('?', `?${binds.length}`)); };
  if (users.length) add('a.username IN (SELECT value FROM json_each(?))', JSON.stringify(users));
  if (actions.length) add('a.action IN (SELECT value FROM json_each(?))', JSON.stringify(actions));
  // "Other" is every entity type no area claims
  if (areas.length) {
    binds.push(JSON.stringify(types));
    const n = binds.length;
    if (areas.includes('other')) {
      binds.push(JSON.stringify(Object.values(AUDIT_AREAS).flatMap((x) => x.types)));
      where.push(`(a.entity_type IN (SELECT value FROM json_each(?${n})) OR a.entity_type NOT IN (SELECT value FROM json_each(?${n + 1})))`);
    } else where.push(`a.entity_type IN (SELECT value FROM json_each(?${n}))`);
  }
  if (text) {
    // ! escapes the LIKE wildcards in what was typed
    binds.push(`%${text.replace(/[!%_]/g, (m) => `!${m}`)}%`);
    const n = binds.length;
    where.push(`(${['a.summary', 'a.entity_id', 'j.ticket_no', 'a.username', 'u.full_name'].map((col) => `${col} LIKE ?${n} ESCAPE '!'`).join(' OR ')})`);
  }
  const base = where.join(' AND ');
  const page = before.length === 2 ? ` AND (a.occurred_at < ?${binds.length + 1} OR (a.occurred_at = ?${binds.length + 1} AND a.id < ?${binds.length + 2}))` : '';
  const from_ = `FROM audit_log a LEFT JOIN jobs j ON a.entity_type = 'job' AND j.id = a.entity_id LEFT JOIN user_roles u ON u.username = a.username`;

  const [rows, byUser, byAction, byType, stats] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT a.id, a.occurred_at, a.username, coalesce(u.full_name, a.username) AS full_name, a.action, a.entity_type, a.entity_id, a.summary, a.ip, a.user_agent, j.ticket_no
       ${from_} WHERE ${base}${page} ORDER BY a.occurred_at DESC, a.id DESC LIMIT ${limit + 1}`,
    ).bind(...binds, ...(page ? before : [])),
    c.env.DB.prepare(`SELECT a.username AS k, coalesce(u.full_name, a.username) AS label, count(*) AS n ${from_} WHERE a.occurred_at >= ?1 AND a.occurred_at <= ?2 GROUP BY a.username ORDER BY n DESC LIMIT 300`).bind(from, to),
    c.env.DB.prepare(`SELECT a.action AS k, count(*) AS n ${from_} WHERE a.occurred_at >= ?1 AND a.occurred_at <= ?2 GROUP BY a.action ORDER BY n DESC`).bind(from, to),
    c.env.DB.prepare(`SELECT a.entity_type AS k, count(*) AS n ${from_} WHERE a.occurred_at >= ?1 AND a.occurred_at <= ?2 GROUP BY a.entity_type`).bind(from, to),
    c.env.DB.prepare(
      `SELECT count(*) AS total,
              sum(CASE WHEN a.action = 'login' THEN 1 ELSE 0 END) AS logins,
              sum(CASE WHEN a.action = 'login_failed' THEN 1 ELSE 0 END) AS failed,
              sum(CASE WHEN a.entity_type <> 'auth' THEN 1 ELSE 0 END) AS changes,
              count(DISTINCT a.username) AS people
       ${from_} WHERE ${base}`,
    ).bind(...binds),
  ]);
  const r = rows.results as Record<string, unknown>[];
  const more = r.length > limit;
  const areaCounts: Record<string, number> = {};
  for (const t of byType.results as { k: string; n: number }[]) { const a = areaOf(t.k); areaCounts[a] = (areaCounts[a] ?? 0) + t.n; }
  return c.json({
    rows: r.slice(0, limit).map((x) => ({ ...x, area: areaOf(String(x.entity_type)) })),
    next: more ? `${r[limit - 1].occurred_at}|${r[limit - 1].id}` : null,
    facets: { users: byUser.results, actions: byAction.results, areas: areaCounts },
    stats: stats.results[0],
  });
});
