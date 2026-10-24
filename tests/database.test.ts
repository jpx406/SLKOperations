import { describe, expect, it } from 'vitest';
import { cleanListValue, cleanPce, pressureTestDue } from '../src/shared/database';
import { readAllowed, ruleFor } from '../src/worker/permissions';

describe('PCE checks', () => {
  it('needs label and bore on creation and fills the type', () => {
    expect(cleanPce({ bore_in: 2.5 }, true)).toEqual({ error: 'Give the equipment a label' });
    expect(cleanPce({ label: 'A' }, true)).toHaveProperty('error');
    expect(cleanPce({ label: ' PCE-1 ', bore_in: '2.5' }, true)).toEqual({ values: { label: 'PCE-1', kind: 'pce_set', bore_in: 2.5 } });
  });
  it('checks rating, length, date and type', () => {
    expect(cleanPce({ rating_psi: 7000 }, false)).toHaveProperty('error');
    expect(cleanPce({ rating_psi: '10000', length_ft: '', last_pressure_test_on: '2026-10-01' }, false))
      .toEqual({ values: { rating_psi: 10000, length_ft: null, last_pressure_test_on: '2026-10-01' } });
    expect(cleanPce({ last_pressure_test_on: '01/10/2026' }, false)).toHaveProperty('error');
    expect(cleanPce({ kind: 'crane' }, false)).toHaveProperty('error');
  });
  it('only changes what an edit sends', () => {
    expect(cleanPce({ active: 0 }, false)).toEqual({ values: { active: 0 } });
  });
});

describe('pressure test due', () => {
  it('counts days and flags overdue or missing tests', () => {
    expect(pressureTestDue('2026-10-01', '2026-10-25')).toEqual({ days: 24, overdue: false });
    expect(pressureTestDue('2026-01-01', '2026-10-25').overdue).toBe(true);
    expect(pressureTestDue(null, '2026-10-25')).toEqual({ days: null, overdue: true });
  });
});

describe('local lists', () => {
  it('accepts known lists and trims values', () => {
    expect(cleanListValue('jar_type', '  Power jar ')).toEqual({ kind: 'jar_type', value: 'Power jar' });
    expect(cleanListValue('colours', 'Red')).toEqual({ error: 'Unknown list' });
    expect(cleanListValue('jar_type', '  ')).toEqual({ error: 'Type a value' });
  });
});

describe('database rights', () => {
  it('needs the database tab to read and its edit or delete right to change', () => {
    expect(readAllowed('/api/database', { database: { view: true, edit: false, delete: false } })).toBe(true);
    expect(readAllowed('/api/database', { jobs: { view: true, edit: true, delete: true } })).toBe(false);
    expect(ruleFor('POST', '/api/database/pce')?.action).toBe('edit');
    expect(ruleFor('DELETE', '/api/database/pce/x')?.action).toBe('delete');
    expect(ruleFor('DELETE', '/api/database/lists/x')).toBeUndefined();
    expect(ruleFor('PUT', '/api/database/service-profiles')?.menu).toBe('database');
  });
});
