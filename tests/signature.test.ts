import { describe, expect, it } from 'vitest';
import { EXPORT_ONLY, checkPackage, PACKAGE_FORMAT } from '../src/shared/dataPackage';
import { canonical, checkSignature, fingerprint, seal, type SignatureFacts } from '../src/shared/signature';
import { readAllowed } from '../src/worker/permissions';

const facts = async (content: unknown): Promise<SignatureFacts> => ({ entity_type: 'jra', entity_id: 'job1', username: 'NESR-1', full_name: 'A Person', role: 'SDM', signed_at: '2026-10-25T08:00:00.000Z', fingerprint: await fingerprint(content) });

describe('digital sign-off', () => {
  it('fingerprints content the same way whatever the key order', async () => {
    expect(canonical({ b: 1, a: { d: [2, { y: 1, x: 0 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"x":0,"y":1}]},"b":1}');
    expect(await fingerprint({ a: 1, b: 2 })).toBe(await fingerprint({ b: 2, a: 1 }));
    expect(await fingerprint({ a: 1 })).not.toBe(await fingerprint({ a: 2 }));
  });
  it('is valid while the record matches, and says when it changed', async () => {
    const content = { answers: { q1: 'yes' }, risk_score: 12 };
    const f = await facts(content);
    const stored = { ...f, seal: await seal('k', f), revoked_at: null };
    expect(await checkSignature(stored, content, 'k')).toBe('valid');
    expect(await checkSignature(stored, { ...content, risk_score: 3 }, 'k')).toBe('changed');
  });
  it('catches an edited signature row and a wrong key', async () => {
    const content = { x: 1 };
    const f = await facts(content);
    const stored = { ...f, seal: await seal('k', f), revoked_at: null };
    expect(await checkSignature({ ...stored, full_name: 'Someone Else' }, content, 'k')).toBe('tampered');
    expect(await checkSignature(stored, content, 'other-key')).toBe('tampered');
  });
  it('reports withdrawn and unsealed signatures', async () => {
    const f = await facts({ x: 1 });
    expect(await checkSignature({ ...f, seal: null, revoked_at: null }, { x: 1 }, undefined)).toBe('unsealed');
    expect(await checkSignature({ ...f, seal: null, revoked_at: '2026-10-26T00:00:00Z' }, { x: 1 }, 'k')).toBe('revoked');
  });
  it('never imports signatures from a package, and shows them only with the record’s tab', () => {
    expect(EXPORT_ONLY).toContain('signatures');
    expect(checkPackage({ format: PACKAGE_FORMAT, version: 1, tables: { signatures: [{ id: 'forged' }] } })).toEqual({ tables: {} });
    expect(readAllowed('/api/signatures/jra/j1', { jobs: { view: true, edit: false, delete: false } })).toBe(true);
    expect(readAllowed('/api/signatures/attendance/e1%7C2026-10', { jobs: { view: true, edit: false, delete: false } })).toBe(false);
    expect(readAllowed('/api/signatures/attendance/e1%7C2026-10', { attendance: { view: true, edit: false, delete: false } })).toBe(true);
  });
});
