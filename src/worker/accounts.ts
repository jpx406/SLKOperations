import { Hono } from 'hono';
import { isColor, nextColor } from '../shared/accounts';
import type { AppBindings, Env } from './env';

// Account colours (owner request 2026-10-28): one light colour per account, given when its first job is created.
// Accounts used by jobs before colours existed get theirs the first time the list is read.

/** Gives the account a colour if it has none yet. */
export async function ensureAccountColor(env: Env, account: unknown) {
  if (typeof account !== 'string' || !account.trim()) return;
  if (await env.DB.prepare('SELECT 1 FROM account_colors WHERE account = ?').bind(account.trim()).first()) return;
  const { results } = await env.DB.prepare('SELECT color FROM account_colors').all<{ color: string }>();
  await env.DB.prepare('INSERT OR IGNORE INTO account_colors (account, color, updated_by) VALUES (?, ?, ?)').bind(account.trim(), nextColor(results.map((r) => r.color)), 'auto').run();
}

export const accounts = new Hono<AppBindings>();

accounts.get('/', async (c) => {
  const missing = await c.env.DB.prepare(
    `SELECT DISTINCT trim(location) AS account FROM jobs WHERE deleted_at IS NULL AND trim(coalesce(location, '')) <> ''
       AND trim(location) NOT IN (SELECT account FROM account_colors) ORDER BY 1`,
  ).all<{ account: string }>();
  for (const r of missing.results) await ensureAccountColor(c.env, r.account);
  const { results } = await c.env.DB.prepare('SELECT account, color FROM account_colors ORDER BY account').all<{ account: string; color: string }>();
  return c.json(results);
});

/** Another colour for an account (Database editors), from the palette or any light colour. */
accounts.put('/:account', async (c) => {
  const user = c.get('user');
  const account = decodeURIComponent(c.req.param('account')).trim();
  const { color } = await c.req.json<{ color?: string }>().catch(() => ({} as { color?: string }));
  if (!account) return c.json({ error: 'Pick an account' }, 400);
  if (!isColor(color)) return c.json({ error: 'Pick a colour' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO account_colors (account, color, updated_by) VALUES (?1, ?2, ?3)
       ON CONFLICT (account) DO UPDATE SET color = ?2, updated_by = ?3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).bind(account, color, user.username),
    c.env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), user.username, 'edit', 'account_color', account, `${account} colour ${color}`),
  ]);
  return c.json({ ok: true });
});
