import { describe, expect, it } from 'vitest';
import { buildDigest, type DigestFinding } from '../src/shared/digest';

const f = (o: Partial<DigestFinding>): DigestFinding => ({
  id: Math.random().toString(36).slice(2), check_code: 'value_mismatch', severity: 'low', country: 'Saudi Arabia', first_seen_at: '2026-10-24T02:00:00Z',
  summary: 'Wire cut 50 ft on the job, 0 ft in WIREGUARD', ticket_no: 'T1', unit_number: 'SL-40', sdm_username: 'NESR-90001', ...o,
});
const sdm = { username: 'nesr-90001', full_name: 'Test SDM', role: 'sdm', countries: ['Saudi Arabia'], email: 'sdm@example.com' };
const mgr = { ...sdm, username: 'NESR-90100', full_name: 'Ops', role: 'operations_manager' };
const SINCE = '2026-10-24T01:00:00Z';

describe('reconciliation digest', () => {
  it('gives an SDM their own findings plus every high one, newest marked', () => {
    const d = buildDigest(sdm, [f({}), f({ severity: 'high', sdm_username: 'NESR-90002', check_code: 'no_runs', summary: 'No runs' }), f({ sdm_username: 'NESR-90002' }), f({ first_seen_at: '2026-10-01T00:00:00Z' })], 'https://slkops.nesrapp.com/', SINCE)!;
    expect(d.count).toBe(3);
    expect(d.fresh).toBe(2);
    expect(d.subject).toBe('SLK Ops reconciliation: 3 open findings (2 new)');
    expect(d.text.split('\n').find((l) => l.includes('HIGH'))).toContain('[new] HIGH · No WIREGUARD runs for a completed job');
    expect(d.text).toContain('Review them: https://slkops.nesrapp.com/wires/reconciliation');
  });
  it('gives managers high and medium findings only, and nothing outside their countries', () => {
    const d = buildDigest(mgr, [f({ severity: 'medium' }), f({ severity: 'low' }), f({ severity: 'high', country: 'Bahrain' })], 'https://x', SINCE)!;
    expect(d.count).toBe(1);
  });
  it('sends nothing when there is nothing to look at', () => {
    expect(buildDigest(mgr, [f({ severity: 'low' })], 'https://x', SINCE)).toBeNull();
  });
  it('escapes text in the HTML version', () => {
    const d = buildDigest(sdm, [f({ summary: '<b>x</b>' })], 'https://x', SINCE)!;
    expect(d.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(d.html).not.toContain('<b>x</b>');
  });
});
