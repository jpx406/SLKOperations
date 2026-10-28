import Anthropic from '@anthropic-ai/sdk';
import type { Context } from 'hono';
import { AI_MODELS, STARTER_PROMPTS, checkSettings, costMicroUsd, limitCheck, parseSettings, shapeResult, systemPrompt, toolPaths, toolsFor, trim, type AiSettings } from '../shared/ai';
import { assistantPrompt, helpFor } from '../shared/help';
import { roleLabel } from '../shared/roles';
import type { AppBindings, Env } from './env';

// AI Agent (S35). Answers questions from the asker's own data: every tool is a GET through the app itself,
// with the asker's cookie and country switch, so permissions and countries apply exactly as in the browser.
// One ai_usage row per question; the monthly budget is shared with the help assistant.

const MAX_TURNS = 8;
const MAX_HISTORY = 20;

type Fetcher = (path: string) => Promise<Response>;

const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`;
const dayStart = () => `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;

export async function loadSettings(env: Env): Promise<AiSettings> {
  const { results } = await env.DB.prepare('SELECT key, value FROM ai_settings').all<{ key: string; value: string }>();
  return parseSettings(results);
}

export async function spend(env: Env, username: string, feature: 'agent' | 'assistant' = 'agent') {
  const [month, today] = await env.DB.batch([
    env.DB.prepare('SELECT coalesce(sum(cost_microusd), 0) AS micro FROM ai_usage WHERE occurred_at >= ?').bind(monthStart()),
    env.DB.prepare(`SELECT count(*) AS n FROM ai_usage WHERE feature = ? AND username = ? AND occurred_at >= ?`).bind(feature, username, dayStart()),
  ]);
  return { monthMicro: Number((month.results[0] as { micro: number }).micro), sentToday: Number((today.results[0] as { n: number }).n) };
}

export async function aiStatus(c: Context<AppBindings>) {
  const user = c.get('user');
  const s = await loadSettings(c.env);
  const u = await spend(c.env, user.username);
  return c.json({
    enabled: s.enabled, configured: !!c.env.ANTHROPIC_API_KEY, model: AI_MODELS.find((m) => m.id === s.model)?.label,
    sentToday: u.sentToday, dailyLimit: s.messages_per_user_day, blocked: limitCheck(s, u.monthMicro, u.sentToday),
    tools: toolsFor(user.menus).map((t) => t.name), starters: STARTER_PROMPTS,
  });
}

/** Turns the request body into a clean user/assistant history ending with the user's question. */
function readHistory(body: ChatIn) {
  const history = (body.messages ?? []).slice(-MAX_HISTORY)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: (m.content as string).slice(0, 8000) }));
  while (history.length && history[0].role !== 'user') history.shift();
  return history.length && history[history.length - 1].role === 'user' ? history : null;
}

export const client = (env: Env) => new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) });
export const fallbackFor = (model: string) => (model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const });
export const serviceError = (e: unknown) => {
  if (!(e instanceof Anthropic.APIError)) return null;
  console.error('ai', e.status, e.message);
  return e.status === 429 || e.status === 529 ? 'The AI service is busy. Try again in a minute.' : 'The AI service returned an error. Try again, or tell an admin if it keeps happening.';
};

/** Help assistant (S23): answers how-to questions from the in-app guide. No tools, no data. */
export async function assistantChat(c: Context<AppBindings>) {
  const user = c.get('user');
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'The help assistant isn’t set up yet: the Anthropic API key is missing on the server.' }, 503);
  const s = await loadSettings(c.env);
  const u = await spend(c.env, user.username, 'assistant');
  const blocked = limitCheck(s, u.monthMicro, u.sentToday);
  if (blocked) return c.json({ error: blocked.replace('The AI Agent is switched off', 'The help assistant is switched off') }, 429);
  const history = readHistory(await c.req.json<ChatIn>().catch(() => ({} as ChatIn)));
  if (!history) return c.json({ error: 'Ask a question' }, 400);
  let micro = 0, inTok = 0, outTok = 0;
  let reply = '', note: string | null = null;
  try {
    const res = await client(c.env).beta.messages.create({
      model: s.model, max_tokens: 4000, output_config: { effort: 'low' },
      system: assistantPrompt(helpFor(user.menus, user.role === 'admin')), messages: history, ...fallbackFor(s.model),
    });
    micro = costMicroUsd(res.usage, s.model);
    inTok = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    outTok = res.usage.output_tokens;
    reply = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (res.stop_reason === 'refusal') note = 'The assistant declined to answer this. Try asking it another way.';
    if (res.stop_reason === 'max_tokens') note = 'The answer was cut short.';
  } catch (e) {
    const msg = serviceError(e);
    if (!msg) throw e;
    return c.json({ error: msg }, 502);
  } finally {
    await c.env.DB.prepare('INSERT INTO ai_usage (id, username, feature, model, input_tokens, output_tokens, cost_microusd) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), user.username, 'assistant', s.model, inTok, outTok, micro).run();
  }
  return c.json({ reply, note, sentToday: u.sentToday + 1, dailyLimit: s.messages_per_user_day });
}

interface ChatIn { messages?: { role?: string; content?: unknown }[] }

export async function aiChat(c: Context<AppBindings>, self: Fetcher) {
  const user = c.get('user');
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'The AI Agent isn’t set up yet: the Anthropic API key is missing on the server.' }, 503);
  const s = await loadSettings(c.env);
  const u = await spend(c.env, user.username);
  const blocked = limitCheck(s, u.monthMicro, u.sentToday);
  if (blocked) return c.json({ error: blocked }, 429);

  const body = await c.req.json<ChatIn>().catch(() => ({} as ChatIn));
  const history = readHistory(body);
  if (!history) return c.json({ error: 'Ask a question' }, 400);

  const allowed = toolsFor(user.menus);
  const tools: Anthropic.Beta.BetaTool[] = allowed.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  const system = systemPrompt({
    fullName: user.fullName, role: roleLabel(user.role), countries: user.countries, tools: allowed.map((t) => t.name),
    today: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }),
  });
  const api = client(c.env);
  const messages: Anthropic.Beta.BetaMessageParam[] = history;
  const used: { name: string; input: unknown; ok: boolean }[] = [];
  let micro = 0, inTok = 0, outTok = 0;
  let reply = '';
  let note: string | null = null;

  const record = () => c.env.DB.prepare('INSERT INTO ai_usage (id, username, feature, model, input_tokens, output_tokens, cost_microusd) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, 'agent', s.model, inTok, outTok, micro).run();

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await api.beta.messages.create({
        model: s.model,
        max_tokens: 8000,
        system,
        tools,
        messages,
        output_config: { effort: 'medium' },
        // a declined request is retried server-side on Anthropic's recommended model; Haiku has no fallback
        ...fallbackFor(s.model),
      });
      micro += costMicroUsd(res.usage, s.model);
      inTok += res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
      outTok += res.usage.output_tokens;
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();

      if (res.stop_reason === 'refusal') { reply = text; note = 'The model declined to answer this. Try asking it another way.'; break; }
      if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
      if (res.stop_reason !== 'tool_use') {
        reply = text;
        if (res.stop_reason === 'max_tokens') note = 'The answer was cut short. Ask a narrower question for the rest.';
        break;
      }

      messages.push({ role: 'assistant', content: res.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const b of res.content) {
        if (b.type !== 'tool_use') continue;
        const input = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>;
        const out = await runTool(b.name, input, allowed.map((t) => t.name), self);
        used.push({ name: b.name, input, ok: !out.error });
        results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out.error ? { error: out.error } : out.result), ...(out.error ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: results });
      if (turn === MAX_TURNS - 1) { reply = text; note = 'The agent stopped after several lookups. Ask a narrower question.'; }
    }
  } catch (e) {
    await record();
    const msg = serviceError(e);
    if (!msg) throw e;
    return c.json({ error: msg }, 502);
  }
  await record();
  return c.json({ reply: reply || (note ? '' : 'No answer came back.'), note, tools: used, sentToday: u.sentToday + 1, dailyLimit: s.messages_per_user_day });
}

/** Runs one tool through the app's own endpoints. A refused or failed read comes back as an error the model reports. */
export async function runTool(name: string, input: Record<string, unknown>, allowed: string[], self: Fetcher): Promise<{ result?: unknown; error?: string }> {
  if (!allowed.includes(name)) return { error: 'This person’s access does not include that data' };
  const p = toolPaths(name, input);
  if ('error' in p) return { error: p.error };
  const bodies: unknown[] = [];
  for (const path of p.paths) {
    const res = await self(path);
    const body = await res.json().catch(() => null) as { error?: string } | null;
    if (!res.ok) {
      return { error: body?.error ?? `The page refused the request (${res.status})` };
    }
    bodies.push(body);
  }
  return { result: trim(shapeResult(name, input, bodies)) };
}

// ---- admin settings ----

export async function aiAdminGet(c: Context<AppBindings>) {
  const s = await loadSettings(c.env);
  const [month, people] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT feature, count(*) AS messages, coalesce(sum(cost_microusd), 0) AS micro FROM ai_usage WHERE occurred_at >= ? GROUP BY feature').bind(monthStart()),
    c.env.DB.prepare(
      `SELECT a.username, coalesce(r.full_name, a.username) AS full_name, count(*) AS messages, coalesce(sum(a.cost_microusd), 0) AS micro, max(a.occurred_at) AS last_at
       FROM ai_usage a LEFT JOIN user_roles r ON r.username = a.username WHERE a.occurred_at >= ? GROUP BY a.username ORDER BY micro DESC LIMIT 200`,
    ).bind(monthStart()),
  ]);
  return c.json({ settings: s, models: AI_MODELS, configured: !!c.env.ANTHROPIC_API_KEY, month: month.results, people: people.results });
}

export async function aiAdminPut(c: Context<AppBindings>) {
  const user = c.get('user');
  const r = checkSettings(await c.req.json().catch(() => ({})));
  if ('error' in r) return c.json({ error: r.error }, 400);
  const entries = Object.entries(r.settings);
  if (!entries.length) return c.json({ error: 'Nothing to change' }, 400);
  await c.env.DB.batch([
    ...entries.map(([k, v]) => c.env.DB.prepare(
      `INSERT INTO ai_settings (key, value, updated_by) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).bind(k, JSON.stringify(v), user.username)),
    c.env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), user.username, 'update', 'ai_settings', 'ai', `AI Agent settings: ${entries.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')}`),
  ]);
  return c.json({ settings: await loadSettings(c.env) });
}
