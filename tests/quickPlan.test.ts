import { describe, expect, it } from 'vitest';
import { checkCard, isColumn, reorder } from '../src/shared/quickPlan';
import { readAllowed, ruleFor } from '../src/worker/permissions';

describe('quick plan', () => {
  it('needs a title and a real date', () => {
    expect(checkCard({ title: '  ' })).toHaveProperty('error');
    expect(checkCard({ title: 'ABQQ-538 gauge', target_date: 'next week' })).toEqual({ error: 'The target date must be a date' });
    expect(checkCard({ title: ' ABQQ-538 ', unit_number: '', notes: ' ' })).toEqual({ card: { title: 'ABQQ-538', notes: null, target_date: null, unit_number: null } });
    expect(isColumn('likely')).toBe(true);
    expect(isColumn('done')).toBe(false);
  });
  it('places a moved card at its index and renumbers the column', () => {
    const cards = [{ id: 'a', column_key: 'likely' as const, sort: 0 }, { id: 'b', column_key: 'likely' as const, sort: 1 }, { id: 'x', column_key: 'idea' as const, sort: 0 }];
    expect(reorder(cards, 'x', 'likely', 1)).toEqual([{ id: 'a', column_key: 'likely', sort: 0 }, { id: 'x', column_key: 'likely', sort: 1 }, { id: 'b', column_key: 'likely', sort: 2 }]);
    expect(reorder(cards, 'x', 'likely', 99).at(-1)).toEqual({ id: 'x', column_key: 'likely', sort: 2 });
    expect(reorder(cards, 'a', 'likely', 1)).toEqual([{ id: 'b', column_key: 'likely', sort: 0 }, { id: 'a', column_key: 'likely', sort: 1 }]);
  });
  it('keeps the board behind its tab', () => {
    expect(readAllowed('/api/quick-plan', { quick_plan: { view: true, edit: false, delete: false } })).toBe(true);
    expect(readAllowed('/api/quick-plan', { jobs: { view: true, edit: true, delete: false } })).toBe(false);
    for (const [m, p] of [['POST', '/api/quick-plan'], ['PUT', '/api/quick-plan/a'], ['POST', '/api/quick-plan/a/move'], ['POST', '/api/quick-plan/a/promote'], ['DELETE', '/api/quick-plan/a']]) {
      expect(ruleFor(m, p)).toMatchObject({ menu: 'quick_plan', action: 'edit' });
    }
  });
});
