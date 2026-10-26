import { describe, expect, it } from 'vitest';
import { AI_DEFAULTS, AI_TOOLS, checkSettings, costMicroUsd, limitCheck, parseSettings, shapeResult, toolPaths, toolsFor } from '../src/shared/ai';
import { runTool } from '../src/worker/ai';
import { readAllowed, ruleFor } from '../src/worker/permissions';

const view = { view: true, edit: false, delete: false };

describe('AI Agent settings and limits', () => {
  it('starts switched off and ignores bad stored values', () => {
    expect(parseSettings([])).toEqual(AI_DEFAULTS);
    expect(AI_DEFAULTS.enabled).toBe(false);
    const s = parseSettings([{ key: 'enabled', value: 'true' }, { key: 'model', value: '"gpt-4"' }, { key: 'monthly_budget_cents', value: '-5' }, { key: 'messages_per_user_day', value: '10' }]);
    expect(s).toEqual({ ...AI_DEFAULTS, enabled: true, messages_per_user_day: 10 });
  });
  it('validates what an admin saves', () => {
    expect(checkSettings({ model: 'claude-sonnet-5-5' })).toEqual({ settings: { model: 'claude-sonnet-5-5' } });
    expect(checkSettings({ model: 'other' as never })).toHaveProperty('error');
    expect(checkSettings({ monthly_budget_cents: 1.5 })).toHaveProperty('error');
    expect(checkSettings({ messages_per_user_day: 5000 })).toHaveProperty('error');
  });
  it('blocks when off, over the shared monthly budget, or over the daily count', () => {
    const on = { ...AI_DEFAULTS, enabled: true, monthly_budget_cents: 100, messages_per_user_day: 3 };
    expect(limitCheck(AI_DEFAULTS, 0, 0)).toMatch(/switched off/);
    expect(limitCheck(on, 1_000_000, 0)).toMatch(/budget/); // 100 cents = 1,000,000 micro-USD
    expect(limitCheck(on, 999_999, 3)).toMatch(/daily limit/);
    expect(limitCheck(on, 999_999, 2)).toBeNull();
  });
  it('prices tokens per model, and fallback attempts at their own model', () => {
    expect(costMicroUsd({ input_tokens: 1000, output_tokens: 100 }, 'claude-opus-5-5')).toBe(4000 + 2000);
    expect(costMicroUsd({ input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 1000 }, 'claude-haiku-5-5')).toBe(Math.ceil(100 + 50 + 10));
    const withFallback = { input_tokens: 0, output_tokens: 0, iterations: [
      { type: 'message', input_tokens: 1000, output_tokens: 0, model: null },
      { type: 'fallback_message', input_tokens: 1000, output_tokens: 100, model: 'claude-opus-4-8' },
    ] };
    expect(costMicroUsd(withFallback, 'claude-opus-5-5')).toBe(4000 + 5000 + 2500); // unknown models at the highest rate
  });
});

describe('AI Agent tools', () => {
  it('offers only the tools whose page the person can open', () => {
    expect(toolsFor({})).toEqual([]);
    expect(toolsFor({ failure_roster: view }).map((t) => t.name)).toEqual(['failure_roster']);
    expect(toolsFor({ sales_dashboard: view }).map((t) => t.name)).toEqual(['sales_revenue']);
    for (const t of AI_TOOLS) expect(t.input_schema.additionalProperties).toBe(false);
  });
  it('reads only GET paths covered by the same read rules, for the same menus', () => {
    const samples: Record<string, Record<string, unknown>> = {
      job_statistics: { from: '2026-01-01', unit: ['SL-40'] }, find_jobs: { q: 'W-1' }, get_job: { id: 'j1' }, failure_roster: { month: '2026-10' },
      eight_min_facts: {}, attendance_month: { month: '2026-10' }, reconciliation_findings: {}, sales_revenue: {},
    };
    for (const t of AI_TOOLS) {
      const r = toolPaths(t.name, samples[t.name]);
      if ('error' in r) throw new Error(r.error);
      for (const p of r.paths) {
        const path = `/api${p.split('?')[0]}`;
        expect(readAllowed(path, Object.fromEntries(t.menus.map((m) => [m, view])))).toBe(true);
        expect(readAllowed(path, {})).toBe(false);
      }
    }
  });
  it('refuses malformed input before reading anything', () => {
    expect(toolPaths('job_statistics', { from: 'last week' })).toEqual({ error: 'from must be YYYY-MM-DD' });
    expect(toolPaths('get_job', { id: '../admin/users' })).toHaveProperty('error');
    expect(toolPaths('attendance_month', {})).toHaveProperty('error');
    expect(toolPaths('delete_job', {})).toEqual({ error: 'Unknown tool delete_job' });
    expect(toolPaths('job_statistics', { unit: ['SL-40', 'SL-41'] })).toEqual({ paths: ['/stats?unit=SL-40&unit=SL-41'] });
  });
  it('summarises statistics with the shared KPI maths and a breakdown', () => {
    const job = (unit: string, npt: number, failure = 'no') => ({ id: unit + npt, unit_number: unit, start_date: '2026-10-02', npt_hours: npt, op_hours: 10, failure, services: [], domains: [], crew: [], runs_ok: 1, runs_failed: 0 });
    const out = shapeResult('job_statistics', { group_by: 'unit', measure: 'npt_hours' }, [{ rows: [job('SL-40', 2), job('SL-40', 3, 'yes'), job('SL-41', 1)] }]) as { jobs: number; totals: Record<string, number>; breakdown: Record<string, unknown>[] };
    expect(out.jobs).toBe(3);
    expect(out.totals.npt).toBe(6);
    expect(out.totals.failures).toBe(1);
    expect(out.breakdown[0]).toEqual({ unit: 'SL-40', npt_hours: 5, jobs: 2 });
  });
  it('runs a tool through the app, passing refusals back as errors', async () => {
    const seen: string[] = [];
    const ok = (body: unknown) => async (p: string) => { seen.push(p); return new Response(JSON.stringify(body), { status: 200 }); };
    expect(await runTool('find_jobs', { q: 'W' }, ['find_jobs'], ok([{ id: 'j1', ticket_no: 'T1', secret: 'x' }]))).toEqual({ result: { found: 1, jobs: [{ id: 'j1', ticket_no: 'T1' }] } });
    expect(seen).toEqual(['/jobs?q=W']);
    expect(await runTool('sales_revenue', {}, ['find_jobs'], ok([]))).toEqual({ error: 'This person’s access does not include that data' });
    const refused = async () => new Response(JSON.stringify({ error: 'Your access does not include this page' }), { status: 403 });
    expect(await runTool('get_job', { id: 'j1' }, ['get_job'], refused)).toEqual({ error: 'Your access does not include this page' });
  });
  it('keeps the chat behind the ai_agent tab and the settings behind admin', () => {
    expect(ruleFor('POST', '/api/ai/chat')).toMatchObject({ menu: 'ai_agent', action: 'view' });
    expect(ruleFor('PUT', '/api/admin/ai')).toMatchObject({ menu: 'users', action: 'edit' });
    expect(readAllowed('/api/ai/status', { ai_agent: view })).toBe(true);
    expect(readAllowed('/api/ai/status', { jobs: view })).toBe(false);
  });
});

describe('AI Agent loop', () => {
  // a fake D1 that serves ai_settings and the usage counts, and records the ai_usage insert
  function fakeEnv(settings: Record<string, unknown>) {
    const inserts: unknown[][] = [];
    const stmt = (sql: string) => {
      let args: unknown[] = [];
      const s = {
        bind: (...a: unknown[]) => { args = a; return s; },
        all: async () => ({ results: sql.includes('FROM ai_settings') ? Object.entries(settings).map(([key, v]) => ({ key, value: JSON.stringify(v) })) : sql.includes('sum(cost_microusd)') ? [{ micro: 0 }] : [{ n: 0 }] }),
        run: async () => { if (sql.startsWith('INSERT INTO ai_usage')) inserts.push(args); return {}; },
      };
      return s;
    };
    const DB = { prepare: stmt, batch: async (list: { all: () => Promise<unknown> }[]) => Promise.all(list.map((x) => x.all())) };
    return { env: { DB, ANTHROPIC_API_KEY: 'test-key' }, inserts };
  }
  const ctx = (env: unknown, body: unknown, menus: Record<string, typeof view>) => ({
    env, get: () => ({ username: 'NESR-1', fullName: 'Test Person', role: 'operations_manager', countries: ['Saudi Arabia'], menus }),
    req: { json: async () => body }, json: (b: unknown, status = 200) => ({ b, status }),
  });

  it('calls a tool, feeds the result back, and records one usage row for the question', async () => {
    const { env, inserts } = fakeEnv({ enabled: true, model: 'claude-opus-5-5' });
    const sent: { tools?: { name: string }[]; messages: unknown[]; fallbacks?: string }[] = [];
    const replies = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'find_jobs', input: { q: 'W-1' } }], usage: { input_tokens: 1000, output_tokens: 50 } },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'One job: **T1**.' }], usage: { input_tokens: 1200, output_tokens: 20 } },
    ];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      const r = replies.shift()!;
      return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_sequence: null, ...r }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const reads: string[] = [];
    try {
      const { aiChat } = await import('../src/worker/ai');
      const out = await aiChat(ctx(env, { messages: [{ role: 'user', content: 'Find W-1' }] }, { jobs: view, ai_agent: view }) as never,
        async (p) => { reads.push(p); return new Response(JSON.stringify([{ id: 'j1', ticket_no: 'T1' }])); }) as unknown as { b: { reply: string; tools: unknown[] }; status: number };
      expect(out.status).toBe(200);
      expect(out.b.reply).toBe('One job: **T1**.');
      expect(out.b.tools).toEqual([{ name: 'find_jobs', input: { q: 'W-1' }, ok: true }]);
    } finally { globalThis.fetch = realFetch; }
    expect(reads).toEqual(['/jobs?q=W-1']);
    expect(sent[0].tools?.map((t) => t.name)).toEqual(['find_jobs', 'get_job']); // only the tools this person's tabs allow
    expect(sent[0].fallbacks).toBe('default');
    expect(JSON.stringify(sent[1].messages)).toContain('"tool_use_id":"t1"');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].slice(2)).toEqual(['agent', 'claude-opus-5-5', 2200, 70, 2200 * 4 + 70 * 20]);
  });

  it('refuses before calling the model when the agent is off', async () => {
    const { env } = fakeEnv({ enabled: false });
    const { aiChat } = await import('../src/worker/ai');
    const out = await aiChat(ctx(env, { messages: [{ role: 'user', content: 'hi' }] }, { ai_agent: view }) as never, async () => new Response('{}')) as unknown as { status: number };
    expect(out.status).toBe(429);
  });
});

describe('help guide and assistant', () => {
  it('shows only the sections for the reader’s tabs, and admin help to admins', async () => {
    const { helpFor, HELP_SECTIONS } = await import('../src/shared/help');
    const crew = helpFor({ schedule: view, jobs: view, knowledge_hub: view, ai_assistant: view }, false).map((s) => s.id);
    expect(crew).toEqual(['start', 'schedule', 'jobs', 'knowledge', 'ai']);
    expect(helpFor({ users: view }, false).map((s) => s.id)).not.toContain('admin');
    expect(helpFor({ users: view }, true).map((s) => s.id)).toContain('admin');
    expect(new Set(HELP_SECTIONS.map((s) => s.id)).size).toBe(HELP_SECTIONS.length);
  });
  it('asks the model with the guide only: no tools, low effort, logged as the assistant', async () => {
    const inserts: unknown[][] = [];
    const stmt = (sql: string) => {
      let args: unknown[] = [];
      const s = { bind: (...a: unknown[]) => { args = a; return s; }, all: async () => ({ results: sql.includes('FROM ai_settings') ? [{ key: 'enabled', value: 'true' }] : sql.includes('sum(') ? [{ micro: 0 }] : [{ n: 0 }] }), run: async () => { inserts.push(args); return {}; } };
      return s;
    };
    const env = { DB: { prepare: stmt, batch: async (l: { all: () => Promise<unknown> }[]) => Promise.all(l.map((x) => x.all())) }, ANTHROPIC_API_KEY: 'k' };
    const c = { env, get: () => ({ username: 'NESR-2', fullName: 'Crew', role: 'crew', countries: ['Saudi Arabia'], menus: { jobs: view, ai_assistant: view } }), req: { json: async () => ({ messages: [{ role: 'user', content: 'How do I add crew?' }] }) }, json: (b: unknown, status = 200) => ({ b, status }) };
    let body: Record<string, unknown> = {};
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text: 'Open Preparation.' }], usage: { input_tokens: 3000, output_tokens: 30 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const { assistantChat } = await import('../src/worker/ai');
      const out = await assistantChat(c as never) as unknown as { b: { reply: string }; status: number };
      expect(out.b.reply).toBe('Open Preparation.');
    } finally { globalThis.fetch = realFetch; }
    expect(body.tools).toBeUndefined();
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(String(body.system)).toContain('## Jobs: stages, fields and locks');
    expect(String(body.system)).not.toContain('## Administration');
    expect(inserts.at(-1)?.slice(2)).toEqual(['assistant', 'claude-opus-5-5', 3000, 30, 3000 * 4 + 30 * 20]);
    const { ruleFor } = await import('../src/worker/permissions');
    expect(ruleFor('POST', '/api/ai/assistant')).toMatchObject({ menu: 'ai_assistant', action: 'view' });
  });
});
