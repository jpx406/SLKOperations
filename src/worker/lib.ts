import type { Env } from './env';

// Small helpers every route file shares (6z.72): one audit-log row, one e-mail, one AI usage row and the Knowledge
// Hub settings. Each file used to carry its own copy.

/** One row of the audit trail, as a statement to run or put in a batch. */
export const logRow = (env: Env, username: string, action: string, entityType: string, entityId: string | null | undefined, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), username, action, entityType, entityId ?? null, summary.slice(0, 1000));

/** Sends one e-mail from the app's address. False when the mail binding isn't set up (nothing is sent). */
export async function sendEmail(env: Env, m: { to: string; subject: string; text: string; html?: string }): Promise<boolean> {
  if (!env.EMAIL) return false;
  const html = m.html ?? `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${m.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
  await env.EMAIL.send({ to: m.to, from: { email: env.EMAIL_FROM ?? 'slkops@nesrapp.com', name: 'SLK Operations Hub' }, subject: m.subject, text: m.text, html });
  return true;
}

/** One AI request in the usage log (the monthly budget and daily limits read it). */
export const aiUsageRow = (env: Env, username: string, feature: string, model: string, inputTokens: number, outputTokens: number, costMicroUsd: number) =>
  env.DB.prepare('INSERT INTO ai_usage (id, username, feature, model, input_tokens, output_tokens, cost_microusd) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), username, feature, model, inputTokens, outputTokens, costMicroUsd);

/** A Knowledge Hub setting, merged over its defaults. */
export async function knowledgeSetting<T>(env: Env, key: string, fallback: T): Promise<T> {
  const r = await env.DB.prepare('SELECT value FROM knowledge_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return r ? { ...fallback, ...(JSON.parse(r.value) as T) } : fallback;
}
