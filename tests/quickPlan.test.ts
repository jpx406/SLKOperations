import { describe, expect, it } from 'vitest';
import { checkCard, isColumn, readServices, reorder } from '../src/shared/quickPlan';
import { readAllowed, ruleFor } from '../src/worker/permissions';

describe('quick plan', () => {
  it('needs a title and a real date', () => {
    expect(checkCard({ title: '  ' })).toHaveProperty('error');
    expect(checkCard({ title: 'ABQQ-538 gauge', target_date: 'next week' })).toEqual({ error: 'The target date must be a date' });
    expect(checkCard({ title: ' ABQQ-538 ', notes: ' ' })).toEqual({ card: { title: 'ABQQ-538', notes: null, target_date: null, services: [], client: null, field: null, well: null, temperature_f: null, pressure_psi: null } });
    expect(isColumn('likely')).toBe(true);
    expect(isColumn('done')).toBe(false);
  });
  it('takes services, client, field, well, temperature and pressure', () => {
    const r = checkCard({ client: ' Saudi Aramco ', well: 'ABQQ-538', field: 'Abqaiq', services: ['Gauge cutter', 'Gauge cutter', 'Memory gauge'], temperature_f: '245', pressure_psi: 3200 });
    expect(r).toEqual({ card: { title: 'Saudi Aramco · ABQQ-538', notes: null, target_date: null, services: ['Gauge cutter', 'Memory gauge'], client: 'Saudi Aramco', field: 'Abqaiq', well: 'ABQQ-538', temperature_f: 245, pressure_psi: 3200 } });
    expect(checkCard({ title: 'x', temperature_f: 'hot' })).toHaveProperty('error');
    expect(checkCard({ title: 'x', pressure_psi: -5 })).toHaveProperty('error');
    expect(checkCard({ title: 'x', services: Array.from({ length: 16 }, (_, i) => 's' + i) })).toHaveProperty('error');
    expect(readServices('["a","b"]')).toEqual(['a', 'b']);
    expect(readServices(null)).toEqual([]);
    expect(readServices('oops')).toEqual([]);
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
    expect(readAllowed('/api/attachments/opportunity/a', { quick_plan: { view: true, edit: false, delete: false } })).toBe(true);
    expect(readAllowed('/api/attachments/opportunity/a', { jobs: { view: true, edit: true, delete: false } })).toBe(false);
    expect(ruleFor('POST', '/api/attachments/opportunity/a')).toMatchObject({ menu: 'quick_plan', action: 'edit' });
  });
});
