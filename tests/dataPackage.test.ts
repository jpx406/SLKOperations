import { describe, expect, it } from 'vitest';
import { IMPORT_ORDER, PACKAGE_FORMAT, checkPackage, diffTable } from '../src/shared/dataPackage';
import { ruleFor } from '../src/worker/permissions';

describe('data package', () => {
  it('accepts only SLK Ops packages of the known version and tables', () => {
    expect(checkPackage({})).toEqual({ error: 'This file is not an SLK Ops data package' });
    expect(checkPackage({ format: PACKAGE_FORMAT, version: 9, tables: {} })).toHaveProperty('error');
    expect(checkPackage({ format: PACKAGE_FORMAT, version: 1, tables: { secrets: [] } })).toEqual({ error: 'Unknown table secrets' });
    expect(checkPackage({ format: PACKAGE_FORMAT, version: 1, tables: { pce: {} } })).toEqual({ error: 'Table pce must be a list of rows' });
    const ok = checkPackage({ format: PACKAGE_FORMAT, version: 1, tables: { pce: [{ id: 'a' }], audit_log: [{ id: 'x' }] } });
    expect(ok).toEqual({ tables: { pce: [{ id: 'a' }] } }); // the audit log is exported for the record, never imported
  });
  it('sorts rows into new, changed and unchanged by primary key', () => {
    const d = diffTable('pce', [{ id: 'a', label: 'A' }, { id: 'b', label: 'B2' }, { id: 'c', label: 'C' }], [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], ['id'], ['id', 'label']);
    expect([d.added, d.changed, d.unchanged, d.refused]).toEqual([1, 1, 1, 0]);
    expect(d.samples).toContainEqual({ key: 'b', kind: 'changed', fields: ['label'] });
  });
  it('treats a number and its text as the same value, and refuses changes to history', () => {
    expect(diffTable('pce', [{ id: 'a', bore_in: '2.5' }], [{ id: 'a', bore_in: 2.5 }], ['id'], ['id', 'bore_in']).unchanged).toBe(1);
    const h = diffTable('inventory_movements', [{ id: 'm', qty: 9 }], [{ id: 'm', qty: 1 }], ['id'], ['id', 'qty']);
    expect([h.changed, h.refused]).toEqual([0, 1]);
  });
  it('keys composite primary keys', () => {
    expect(diffTable('bonus_role_splits', [{ country: 'SA', crew_role: 'helper', share_pct: 10 }], [{ country: 'SA', crew_role: 'helper', share_pct: 5 }], ['country', 'crew_role'], ['country', 'crew_role', 'share_pct']).changed).toBe(1);
  });
  it('imports parents before children and keeps imports behind the admin right', () => {
    expect(IMPORT_ORDER.indexOf('jobs')).toBeLessThan(IMPORT_ORDER.indexOf('job_crew'));
    expect(IMPORT_ORDER.indexOf('employees')).toBeLessThan(IMPORT_ORDER.indexOf('job_crew'));
    expect(IMPORT_ORDER.indexOf('eight_min_facts')).toBeLessThan(IMPORT_ORDER.indexOf('incidents'));
    expect(ruleFor('POST', '/api/admin/import/apply')?.menu).toBe('users');
  });
});
