// Bonus (Administrator Manual 1 and 3): a pool per job from the rule of its main service, split among the crew.
// Rules and splits are data entered by NESR; nothing here carries a real amount.

export type Basis = 'per_job' | 'per_run' | 'pct_revenue';
export interface Rule { job_type_name: string; basis: Basis; amount_cents: number | null; pct: number | null; currency: string; active: number }
export type CrewRole = 'slickline_supervisor' | 'slickline_operator' | 'assistant_operator' | 'helper';
export const ROLE_LABEL: Record<CrewRole, string> = { slickline_supervisor: 'Supervisor', slickline_operator: 'Operator', assistant_operator: 'Assistant operator', helper: 'Helper' };

export const BASIS_LABEL: Record<Basis, string> = { per_job: 'Fixed per job', per_run: 'Per successful run', pct_revenue: '% of job revenue' };

/**
 * The job's pool: the rule of its first service that has one (services keep the order they were picked in,
 * so the main service decides). Per run counts successful runs; % of revenue needs the revenue on Closure.
 */
export function poolFor(job: { services: string[]; runs_ok: number | null; revenue_cents: number | null }, rules: Rule[]) {
  const active = rules.filter((r) => r.active);
  const rule = job.services.map((s) => active.find((r) => r.job_type_name === s)).find(Boolean) ?? null;
  if (!rule) return { cents: 0, rule: null, note: job.services.length ? 'None of the job’s services has a bonus rule' : 'The job has no services' };
  if (rule.basis === 'per_job') return { cents: rule.amount_cents ?? 0, rule, note: null };
  if (rule.basis === 'per_run') return { cents: (rule.amount_cents ?? 0) * (job.runs_ok ?? 0), rule, note: job.runs_ok ? null : 'No successful runs recorded' };
  if (job.revenue_cents == null) return { cents: 0, rule, note: 'Enter the job revenue on Closure first' };
  return { cents: Math.round((job.revenue_cents * (rule.pct ?? 0)) / 100), rule, note: null };
}

export interface CrewMember { employee_id: string; full_name: string; crew_role: CrewRole }
export interface Line { employee_id: string; crew_role: CrewRole | null; share_pct: number | null; amount_cents: number }

/**
 * Default split: each role's share is divided among the people in that role. Shares of roles nobody filled are
 * spread over the roles that are present, in proportion, so the whole pool is always allocated.
 * Cents lost to rounding go to the first person.
 */
export function defaultLines(crew: CrewMember[], splits: Partial<Record<CrewRole, number>>, pool: number): Line[] {
  if (!crew.length) return [];
  const present = [...new Set(crew.map((m) => m.crew_role))];
  const raw = present.map((r) => splits[r] ?? 0);
  const total = raw.reduce((a, b) => a + b, 0);
  const roleShare = new Map(present.map((r, i) => [r, total > 0 ? (raw[i] / total) * 100 : 100 / present.length]));
  const lines = crew.map((m) => {
    const inRole = crew.filter((x) => x.crew_role === m.crew_role).length;
    const pct = Math.round(((roleShare.get(m.crew_role) ?? 0) / inRole) * 100) / 100;
    return { employee_id: m.employee_id, crew_role: m.crew_role, share_pct: pct, amount_cents: Math.floor((pool * (roleShare.get(m.crew_role) ?? 0)) / 100 / inRole) };
  });
  const rest = pool - lines.reduce((a, l) => a + l.amount_cents, 0);
  if (lines.length && rest > 0) lines[0].amount_cents += rest;
  return lines;
}

/** Lines from the editor: amounts are what is paid; a share alone is turned into an amount of the pool. */
export function cleanLines(input: unknown, pool: number, crewIds: Set<string>): { lines: Line[] } | { error: string } {
  if (!Array.isArray(input)) return { error: 'Send the list of crew lines' };
  const lines: Line[] = [];
  for (const [i, raw] of (input as Record<string, unknown>[]).entries()) {
    const id = String(raw?.employee_id ?? '');
    if (!crewIds.has(id)) return { error: `Line ${i + 1}: pick someone from the job’s crew` };
    const pct = raw.share_pct === '' || raw.share_pct == null ? null : Number(raw.share_pct);
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) return { error: `Line ${i + 1}: share must be 0 to 100 %` };
    let amount = raw.amount_cents === '' || raw.amount_cents == null ? null : Number(raw.amount_cents);
    if (amount === null && pct !== null) amount = Math.round((pool * pct) / 100);
    if (amount === null || !Number.isInteger(amount) || amount < 0) return { error: `Line ${i + 1}: give an amount or a share` };
    lines.push({ employee_id: id, crew_role: (raw.crew_role as CrewRole) ?? null, share_pct: pct, amount_cents: amount });
  }
  if (new Set(lines.map((l) => l.employee_id)).size !== lines.length) return { error: 'Someone is listed twice' };
  const total = lines.reduce((a, l) => a + l.amount_cents, 0);
  if (total > pool) return { error: `The lines add up to more than the pool (${(total / 100).toFixed(2)} of ${(pool / 100).toFixed(2)})` };
  return { lines };
}

export const money = (cents: number | null | undefined, currency = 'USD') =>
  cents == null ? '—' : `${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

/** Bonus % of revenue for the same jobs, against the manual's < 4.5 % target. */
export function bonusShare(bonusCents: number, revenueCents: number, target = 4.5) {
  const pct = revenueCents > 0 ? Math.round((bonusCents / revenueCents) * 1000) / 10 : null;
  return { pct, target, ok: pct === null ? null : pct < target };
}
