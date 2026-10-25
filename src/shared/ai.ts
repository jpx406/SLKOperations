// AI Agent (Administrator Manual 6). Read-only tools over the app's own GET endpoints: each tool call goes
// through the same session and permission checks as the asker's browser, so the agent sees only what they can.
// Pure helpers here (settings, cost, tool paths, result shaping); the loop itself is in src/worker/ai.ts.

import { rowSummary, type Code } from './attendance';
import { kpis, groupBy, type StatJob } from './stats';

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', inUsd: 4, outUsd: 20, cacheReadUsd: 0.2 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', inUsd: 2, outUsd: 10, cacheReadUsd: 0.2 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', inUsd: 0.1, outUsd: 0.5, cacheReadUsd: 0.01 },
] as const;
export type AiModel = (typeof AI_MODELS)[number]['id'];
// a fallback can land on an older model; priced at the most expensive one we might meet so the budget never under-counts
const FALLBACK_PRICE = { inUsd: 5, outUsd: 25, cacheReadUsd: 0.5 };

export interface AiSettings { enabled: boolean; model: AiModel; monthly_budget_cents: number; messages_per_user_day: number }
export const AI_DEFAULTS: AiSettings = { enabled: false, model: 'claude-opus-5-5', monthly_budget_cents: 5000, messages_per_user_day: 30 };

export function parseSettings(rows: { key: string; value: string }[]): AiSettings {
  const s: AiSettings = { ...AI_DEFAULTS };
  for (const r of rows) {
    let v: unknown;
    try { v = JSON.parse(r.value); } catch { continue; }
    if (r.key === 'enabled' && typeof v === 'boolean') s.enabled = v;
    if (r.key === 'model' && AI_MODELS.some((m) => m.id === v)) s.model = v as AiModel;
    if (r.key === 'monthly_budget_cents' && Number.isInteger(v) && (v as number) >= 0) s.monthly_budget_cents = v as number;
    if (r.key === 'messages_per_user_day' && Number.isInteger(v) && (v as number) >= 0) s.messages_per_user_day = v as number;
  }
  return s;
}

export function checkSettings(body: Partial<AiSettings>): { error: string } | { settings: Partial<AiSettings> } {
  const out: Partial<AiSettings> = {};
  if (body.enabled !== undefined) { if (typeof body.enabled !== 'boolean') return { error: 'On/off must be true or false' }; out.enabled = body.enabled; }
  if (body.model !== undefined) { if (!AI_MODELS.some((m) => m.id === body.model)) return { error: 'Unknown model' }; out.model = body.model; }
  if (body.monthly_budget_cents !== undefined) {
    if (!Number.isInteger(body.monthly_budget_cents) || body.monthly_budget_cents < 0 || body.monthly_budget_cents > 10_000_000) return { error: 'The monthly budget must be between 0 and 100,000 USD' };
    out.monthly_budget_cents = body.monthly_budget_cents;
  }
  if (body.messages_per_user_day !== undefined) {
    if (!Number.isInteger(body.messages_per_user_day) || body.messages_per_user_day < 0 || body.messages_per_user_day > 1000) return { error: 'Messages per person per day must be between 0 and 1,000' };
    out.messages_per_user_day = body.messages_per_user_day;
  }
  return { settings: out };
}

interface UsageLike {
  input_tokens: number; output_tokens: number;
  cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null;
  iterations?: { type: string; input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; model?: string | null }[] | null;
}

/** Cost in micro-USD. Dollars per million tokens equal micro-dollars per token, so prices multiply straight in. */
export function costMicroUsd(usage: UsageLike, model: string): number {
  const price = (m: string | null | undefined) => AI_MODELS.find((x) => x.id === m) ?? FALLBACK_PRICE;
  const one = (u: Omit<UsageLike, 'iterations'>, m: string | null | undefined) => {
    const p = price(m);
    return u.input_tokens * p.inUsd + (u.cache_creation_input_tokens ?? 0) * p.inUsd * 1.25 + (u.cache_read_input_tokens ?? 0) * p.cacheReadUsd + u.output_tokens * p.outUsd;
  };
  const it = usage.iterations?.filter((i) => i.type === 'message' || i.type === 'fallback_message');
  if (it?.length && it.some((i) => i.type === 'fallback_message')) {
    return Math.ceil(it.reduce((a, i) => a + one({ input_tokens: i.input_tokens ?? 0, output_tokens: i.output_tokens ?? 0, cache_read_input_tokens: i.cache_read_input_tokens, cache_creation_input_tokens: i.cache_creation_input_tokens }, i.model ?? model), 0));
  }
  return Math.ceil(one(usage, model));
}

/** Whether another message may go out: the shared monthly budget (help assistant + agent) and the person's daily count. */
export function limitCheck(s: AiSettings, spentMonthMicro: number, sentToday: number): string | null {
  if (!s.enabled) return 'The AI Agent is switched off. An admin can switch it on under Administration → AI Agent.';
  if (spentMonthMicro >= s.monthly_budget_cents * 10_000) return 'This month’s AI budget is used up. It resets on the 1st (UTC), or an admin can raise it.';
  if (sentToday >= s.messages_per_user_day) return `You’ve sent ${sentToday} messages today, the daily limit. It resets at midnight UTC.`;
  return null;
}

// ---- tools ----------------------------------------------------------------------------------------

const FILTER_PROPS = {
  from: { type: 'string', description: 'First start date, YYYY-MM-DD' },
  to: { type: 'string', description: 'Last start date, YYYY-MM-DD' },
  unit: { type: 'array', items: { type: 'string' }, description: 'Unit numbers, e.g. SL-40' },
  sdm: { type: 'array', items: { type: 'string' }, description: 'SDM usernames' },
  service: { type: 'array', items: { type: 'string' }, description: 'Service (job type) names' },
  domain: { type: 'array', items: { type: 'string' }, description: 'Service domains' },
  account: { type: 'array', items: { type: 'string' }, description: 'Accounts (job location)' },
  area: { type: 'array', items: { type: 'string' }, description: 'Areas (field)' },
  conveyance: { type: 'array', items: { type: 'string' } },
} as const;

export interface AiToolDef {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  /** The menu a person needs for this tool; the endpoint checks it again. */
  menus: string[];
}

export const AI_TOOLS: AiToolDef[] = [
  {
    name: 'job_statistics',
    description: 'Totals for jobs that started in a period (canceled left out): job count, operating and NPT hours, failures, run efficiency, and a breakdown by one dimension. Use for "how many", "how much NPT", "which unit/SDM/service" questions.',
    input_schema: { type: 'object', properties: { ...FILTER_PROPS, group_by: { type: 'string', enum: ['month', 'unit', 'sdm', 'service', 'domain', 'account', 'area', 'conveyance', 'status'], description: 'Breakdown dimension' }, measure: { type: 'string', enum: ['jobs', 'op_hours', 'npt_hours', 'failures'], description: 'What the breakdown sums; default jobs' } }, additionalProperties: false },
    menus: ['statistics', 'npt_analysis', 'utilization', 'competency'],
  },
  {
    name: 'find_jobs',
    description: 'Search jobs by ticket, well, rig, SDM or unit (newest first, at most 40). Returns id, ticket, status, dates, unit, well, SDM.',
    input_schema: { type: 'object', properties: { q: { type: 'string', description: 'Text to look for' }, status: { type: 'string', enum: ['planned', 'ongoing', 'completed', 'canceled', 'all'] } }, additionalProperties: false },
    menus: ['jobs', 'schedule'],
  },
  {
    name: 'get_job',
    description: 'Everything recorded on one job, by its id (from find_jobs).',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    menus: ['jobs', 'schedule'],
  },
  {
    name: 'failure_roster',
    description: 'Failure Roster entries (newest first, at most 60) and a monthly summary, plus jobs with NPT but no 8 Min. Facts and failed jobs missing from the roster.',
    input_schema: { type: 'object', properties: { severity: { type: 'string', enum: ['minor', 'moderate', 'major', 'catastrophic'] }, month: { type: 'string', description: 'YYYY-MM' } }, additionalProperties: false },
    menus: ['failure_roster'],
  },
  {
    name: 'eight_min_facts',
    description: '8 Min. Facts reports (NPT incident reports), newest first, at most 60.',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['saved', 'sent'] }, q: { type: 'string', description: 'Log number, title, well or ticket' } }, additionalProperties: false },
    menus: ['eight_min_facts'],
  },
  {
    name: 'attendance_month',
    description: 'Attendance for one month: per person, days in the field, on leave and unmarked.',
    input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' } }, required: ['month'], additionalProperties: false },
    menus: ['attendance'],
  },
  {
    name: 'reconciliation_findings',
    description: 'Open reconciliation findings between SLK jobs and WIREGUARD runs (unlinked runs, mismatches).',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'explained', 'resolved'] } }, additionalProperties: false },
    menus: ['reconciliation'],
  },
  {
    name: 'sales_revenue',
    description: 'Revenue entered on jobs, totalled by account and by month, and completed jobs still missing revenue. Needs the person to have unlocked bonus and revenue figures with their password.',
    input_schema: { type: 'object', properties: { ...FILTER_PROPS }, additionalProperties: false },
    menus: ['sales_dashboard'],
  },
];

export const toolsFor = (menus: Record<string, { view: boolean }>) => AI_TOOLS.filter((t) => t.menus.some((m) => menus[m]?.view));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function filterQuery(input: Record<string, unknown>): URLSearchParams {
  const q = new URLSearchParams();
  for (const k of ['unit', 'sdm', 'service', 'domain', 'account', 'area', 'conveyance']) {
    const v = input[k];
    if (Array.isArray(v)) for (const x of v.slice(0, 50)) if (typeof x === 'string' && x.trim()) q.append(k, x.trim().slice(0, 80));
  }
  return q;
}

/** The GET path(s) a tool reads. Returns an error for input the tool can't use. */
export function toolPaths(name: string, input: Record<string, unknown>): { paths: string[] } | { error: string } {
  switch (name) {
    case 'job_statistics': case 'sales_revenue': {
      const q = filterQuery(input);
      for (const k of ['from', 'to']) { const v = str(input[k]); if (v) { if (!DATE.test(v)) return { error: `${k} must be YYYY-MM-DD` }; q.set(k, v); } }
      return { paths: [`${name === 'job_statistics' ? '/stats' : '/sales/jobs'}?${q}`] };
    }
    case 'find_jobs': {
      const q = new URLSearchParams();
      if (str(input.q)) q.set('q', str(input.q));
      if (str(input.status)) q.set('status', str(input.status));
      return { paths: [`/jobs?${q}`] };
    }
    case 'get_job': {
      const id = str(input.id);
      if (!/^[\w-]{1,64}$/.test(id)) return { error: 'Give a job id from find_jobs' };
      return { paths: [`/jobs/${id}`] };
    }
    case 'failure_roster': {
      const q = new URLSearchParams();
      if (str(input.severity)) q.set('severity', str(input.severity));
      if (str(input.month)) { if (!MONTH.test(str(input.month))) return { error: 'month must be YYYY-MM' }; q.set('occurred', str(input.month)); }
      return { paths: [`/failure-roster?${q}`, `/failure-roster/summary?${q}`] };
    }
    case 'eight_min_facts': {
      const q = new URLSearchParams();
      if (str(input.status)) q.set('status', str(input.status));
      if (str(input.q)) q.set('q', str(input.q));
      return { paths: [`/emf?${q}`] };
    }
    case 'attendance_month': {
      const m = str(input.month);
      if (!MONTH.test(m)) return { error: 'month must be YYYY-MM' };
      return { paths: [`/attendance?month=${m}`] };
    }
    case 'reconciliation_findings':
      return { paths: [`/recon/findings?status=${['explained', 'resolved'].includes(str(input.status)) ? str(input.status) : 'open'}`] };
    default:
      return { error: `Unknown tool ${name}` };
  }
}

type Rec = Record<string, unknown>;
const pick = (r: Rec, keys: string[]) => Object.fromEntries(keys.filter((k) => r[k] !== null && r[k] !== undefined && r[k] !== '').map((k) => [k, r[k]]));
const round = (n: number) => Math.round(n * 10) / 10;

/** Turns endpoint JSON into a compact result for the model; big lists are summarised or cut. */
export function shapeResult(name: string, input: Record<string, unknown>, bodies: unknown[]): unknown {
  const [a, b] = bodies;
  switch (name) {
    case 'job_statistics': {
      const rows = ((a as { rows?: StatJob[] })?.rows ?? []);
      const measure = str(input.measure) || 'jobs';
      const value = (j: StatJob) => (measure === 'op_hours' ? Number(j.op_hours ?? 0) : measure === 'npt_hours' ? Number(j.npt_hours ?? 0) : measure === 'failures' ? (j.failure === 'yes' ? 1 : 0) : 1);
      const dim = str(input.group_by);
      const key = (j: StatJob): (string | null)[] => {
        const r = j as unknown as Rec;
        if (dim === 'month') return [typeof r.start_date === 'string' ? r.start_date.slice(0, 7) : null];
        if (dim === 'service') return (r.services as string[]) ?? [];
        if (dim === 'domain') return (r.domains as string[]) ?? [];
        const col = { unit: 'unit_number', sdm: 'sdm', account: 'location', area: 'field', conveyance: 'conveyance', status: 'status' }[dim];
        return col ? [(r[col] as string) ?? null] : [];
      };
      const k = kpis(rows) as unknown as Rec;
      return {
        jobs: rows.length,
        totals: Object.fromEntries(Object.entries(k).map(([x, v]) => [x, typeof v === 'number' ? round(v) : v])),
        ...(dim ? { breakdown: groupBy(rows, key, value).slice(0, 40).map((g) => ({ [dim]: g.label, [measure]: round(g.value), jobs: g.ids.length })) } : {}),
      };
    }
    case 'find_jobs': {
      const list = (a as Rec[]) ?? [];
      return { found: list.length, jobs: list.slice(0, 40).map((j) => pick(j, ['id', 'ticket_no', 'status', 'start_date', 'end_date', 'unit_number', 'well', 'rig', 'location', 'field', 'sdm_username', 'npt_hours', 'failure'])) };
    }
    case 'failure_roster': {
      const list = (a as Rec[]) ?? [];
      return { entries: list.length, latest: list.slice(0, 60).map((r) => pick(r, ['occurred_on', 'ticket_no', 'unit_number', 'well', 'category', 'severity', 'action_status', 'npt_hours', 'what_happened', 'log_no'])), summary: b };
    }
    case 'eight_min_facts': {
      const list = (a as Rec[]) ?? [];
      return { reports: list.length, latest: list.slice(0, 60).map((r) => pick(r, ['log_no', 'title', 'well', 'ticket_no', 'status', 'total_npt', 'severity', 'incidents', 'last_saved_at', 'sent_at'])) };
    }
    case 'attendance_month': {
      const body = (a ?? {}) as { days?: string[]; people?: Rec[]; entries?: { employee_id: string; day: string; code: Code }[]; approvals?: { employee_id: string }[] };
      const days = body.days ?? [];
      const codes = new Map<string, Code>((body.entries ?? []).map((e) => [`${e.employee_id}|${e.day}`, e.code]));
      const approved = new Set((body.approvals ?? []).map((x) => x.employee_id));
      return trim({
        month: str(input.month), days: days.length,
        people: (body.people ?? []).map((p) => ({ name: p.full_name, title: p.title, group: p.group_name, approved: approved.has(String(p.id)), ...rowSummary(days.map((d) => codes.get(`${p.id}|${d}`))) })),
      });
    }
    case 'reconciliation_findings': {
      const list = (a as Rec[]) ?? [];
      return { findings: list.length, latest: list.slice(0, 60).map((r) => pick(r, ['check_code', 'severity', 'status', 'ticket_no', 'unit_number', 'start_date', 'well', 'sdm_username', 'detail', 'explanation', 'wg_run_ids'])) };
    }
    case 'sales_revenue': {
      const list = (a as Rec[]) ?? [];
      const withRev = list.filter((j) => j.revenue_cents != null);
      const sum = (key: (j: Rec) => string) => {
        const m = new Map<string, number>();
        for (const j of withRev) m.set(key(j), (m.get(key(j)) ?? 0) + Number(j.revenue_cents) / 100);
        return Object.fromEntries([...m.entries()].sort().map(([k, v]) => [k, Math.round(v)]));
      };
      return {
        jobs: list.length, with_revenue: withRev.length, currency: withRev[0]?.revenue_currency ?? null,
        total: Math.round(withRev.reduce((x, j) => x + Number(j.revenue_cents) / 100, 0)),
        by_account: sum((j) => String(j.location ?? 'No account')), by_month: sum((j) => String(j.start_date ?? 'no date').slice(0, 7)),
        completed_missing_revenue: list.filter((j) => j.status === 'completed' && j.revenue_cents == null).slice(0, 30).map((j) => pick(j, ['ticket_no', 'start_date', 'location', 'well'])),
      };
    }
    default:
      return trim(a);
  }
}

/** Keeps a tool result under a size the model reads comfortably. */
export function trim(v: unknown, max = 30_000): unknown {
  const s = JSON.stringify(v);
  if (s === undefined || s.length <= max) return v;
  return { truncated: true, note: `Only the first ${max} characters are shown; ask a narrower question for the rest.`, partial: s.slice(0, max) };
}

export const STARTER_PROMPTS = [
  'How many jobs did we run last month, and how much NPT did they have?',
  'Which units had the most NPT hours this year?',
  'List the major or catastrophic failures this year and what happened.',
  'Which completed jobs are still missing revenue?',
  'Who was unmarked on attendance this month?',
  'Are there open reconciliation findings I should look at?',
];

export function systemPrompt(p: { fullName: string; role: string; countries: string[]; today: string; tools: string[] }) {
  return `You are the AI Agent in SLK Operations, NESR's slickline operations hub. You answer questions about jobs, NPT, failures, attendance, reconciliation and revenue for ${p.fullName} (${p.role}), whose data covers ${p.countries.join(', ') || 'no countries'}. Today is ${p.today} (Riyadh).

Answer only from what the tools return. The tools read the same pages this person can open, with their permissions; if a tool says access is refused or a page needs unlocking, say so plainly and do not guess the figures. If the tools can't answer the question, say what is missing. You can't change anything in the app; if asked to, say where in SLK Operations the person can do it themselves.

Keep answers short and concrete: lead with the number or the answer, then a few lines of support. Use tables (Markdown) for lists of more than three items. Give dates as 12 Oct 2026. Name the period and filters you used. Tools available to this person: ${p.tools.join(', ') || 'none'}.`;
}
