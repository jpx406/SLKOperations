import { describe, expect, it } from 'vitest';
import { bonusShare, cleanLines, defaultLines, poolFor, type Rule } from '../src/shared/bonus';
import { isOpenWrite, readAllowed, ruleFor } from '../src/worker/permissions';

const rule = (o: Partial<Rule>): Rule => ({ job_type_name: 'Drift', basis: 'per_job', amount_cents: 50000, pct: null, currency: 'USD', active: 1, ...o });

describe('bonus pool', () => {
  it('takes the rule of the first service that has one', () => {
    const rules = [rule({ job_type_name: 'Fishing', amount_cents: 90000 }), rule({})];
    expect(poolFor({ services: ['Gauge', 'Drift', 'Fishing'], runs_ok: 3, revenue_cents: null }, rules).cents).toBe(50000);
    expect(poolFor({ services: ['Gauge'], runs_ok: 3, revenue_cents: null }, rules)).toMatchObject({ cents: 0, rule: null });
  });
  it('works per run and as a share of revenue, and skips switched-off rules', () => {
    expect(poolFor({ services: ['Drift'], runs_ok: 4, revenue_cents: null }, [rule({ basis: 'per_run', amount_cents: 2500 })]).cents).toBe(10000);
    expect(poolFor({ services: ['Drift'], runs_ok: 4, revenue_cents: 1_000_000 }, [rule({ basis: 'pct_revenue', amount_cents: null, pct: 3 })]).cents).toBe(30000);
    expect(poolFor({ services: ['Drift'], runs_ok: 4, revenue_cents: null }, [rule({ basis: 'pct_revenue', amount_cents: null, pct: 3 })]).note).toBe('Enter the job revenue on Closure first');
    expect(poolFor({ services: ['Drift'], runs_ok: 1, revenue_cents: null }, [rule({ active: 0 })]).rule).toBeNull();
  });
});

describe('default split', () => {
  const crew = [
    { employee_id: 'a', full_name: 'A', crew_role: 'slickline_supervisor' as const },
    { employee_id: 'b', full_name: 'B', crew_role: 'slickline_operator' as const },
    { employee_id: 'c', full_name: 'C', crew_role: 'slickline_operator' as const },
  ];
  it('divides a role’s share among its people and spreads missing roles, allocating the whole pool', () => {
    const lines = defaultLines(crew, { slickline_supervisor: 40, slickline_operator: 40, assistant_operator: 10, helper: 10 }, 10001);
    expect(lines.map((l) => l.share_pct)).toEqual([50, 25, 25]);
    expect(lines.reduce((a, l) => a + l.amount_cents, 0)).toBe(10001);
    expect(lines.map((l) => l.amount_cents)).toEqual([5001, 2500, 2500]);
  });
  it('shares equally when no split is set', () => {
    expect(defaultLines(crew.slice(0, 2), {}, 100).map((l) => l.amount_cents)).toEqual([50, 50]);
  });
});

describe('editing lines', () => {
  const ids = new Set(['a', 'b']);
  it('turns shares into amounts and refuses more than the pool', () => {
    expect(cleanLines([{ employee_id: 'a', share_pct: 60 }, { employee_id: 'b', amount_cents: 4000 }], 10000, ids)).toEqual({ lines: [
      { employee_id: 'a', crew_role: null, share_pct: 60, amount_cents: 6000 }, { employee_id: 'b', crew_role: null, share_pct: null, amount_cents: 4000 }] });
    expect(cleanLines([{ employee_id: 'a', amount_cents: 12000 }], 10000, ids)).toHaveProperty('error');
    expect(cleanLines([{ employee_id: 'z', amount_cents: 1 }], 10000, ids)).toEqual({ error: 'Line 1: pick someone from the job’s crew' });
    expect(cleanLines([{ employee_id: 'a', amount_cents: 1 }, { employee_id: 'a', amount_cents: 1 }], 10000, ids)).toEqual({ error: 'Someone is listed twice' });
  });
  it('measures bonus against revenue', () => {
    expect(bonusShare(45000, 1_000_000)).toEqual({ pct: 4.5, target: 4.5, ok: false });
    expect(bonusShare(1, 0).pct).toBeNull();
  });
});

describe('rights', () => {
  it('keeps bonus and sales behind their tabs, with no second password', () => {
    expect(readAllowed('/api/bonus/lines', { bonus: { view: true, edit: false, delete: false } })).toBe(true);
    expect(readAllowed('/api/sales/jobs', { bonus: { view: true, edit: true, delete: true } })).toBe(false);
    expect(ruleFor('PUT', '/api/bonus/rules')?.menu).toBe('bonus');
    expect(ruleFor('POST', '/api/bonus/jobs/j/approve')?.menu).toBe('jobs');
    expect(isOpenWrite('POST', '/api/step-up')).toBe(false);
  });
});
