import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE as T, approvalLevel, cleanAnswers, jraReasons, progress, riskScore } from '../src/shared/jra';
import { cleanNote, emptyNote, pjnNo } from '../src/shared/pjn';
import { readAllowed, ruleFor } from '../src/worker/permissions';

describe('JRA scoring', () => {
  it('scores only answers on the risk side', () => {
    expect(riskScore(T, { A1: 'no', B1: 'yes', E1: 'no', A4: 'na' })).toBe(3 + 5);
    expect(riskScore(T, {})).toBe(0);
  });
  it('picks the approval level from the score', () => {
    expect([0, 19, 20, 34, 35, 80].map((s) => approvalLevel(T, s))).toEqual(['SDM', 'SDM', 'Operations Manager', 'Operations Manager', 'Country Manager', 'Country Manager']);
  });
  it('counts progress and lists missing required questions only', () => {
    const all = Object.fromEntries(T.questions.filter((q) => q.required).map((q) => [q.id, 'na' as const]));
    expect(progress(T, all).missing).toEqual([]);
    expect(progress(T, {}).missing).toHaveLength(T.questions.filter((q) => q.required).length);
  });
  it('checks answers', () => {
    expect(cleanAnswers(T, { A1: 'yes', A2: '' })).toEqual({ A1: 'yes' });
    expect(cleanAnswers(T, { Z9: 'yes' })).toEqual({ error: 'Unknown question Z9' });
    expect(cleanAnswers(T, { A1: 'maybe' })).toEqual({ error: 'A1: answer Yes, No or N/A' });
  });
  it('knows which jobs need a JRA', () => {
    expect(jraReasons({ h2s_ppm: 0, siwhp_psi: 3000 }, false)).toEqual([]);
    expect(jraReasons({ h2s_ppm: 10, siwhp_psi: 5000, special_setup: 'yes' }, true)).toEqual(['an explosive service', 'H₂S', 'wellhead pressure of 5,000 psi or more', 'a special setup']);
  });
});

describe('Pre-Job Note checks', () => {
  const ok = { ...emptyNote(), rig_type: 'Land rig', rdd_dept: 'South', casing: '7 in', suite_no: 'S-1', main_contact_id: 'c1', extra_contact_ids: ['c1', 'c2', 'c2'] };
  it('needs the manual’s required fields', () => {
    expect(cleanNote({ ...ok, rig_type: '', main_contact_id: '' })).toEqual({ error: 'Fill in the rig type, main contact' });
  });
  it('drops empty toolstring rows and repeats of the main contact', () => {
    const r = cleanNote({ ...ok, toolstrings: [{ conveyance: 'Slickline', config: '', details: '' }, { conveyance: '', config: '', details: '' }] });
    expect('content' in r && r.content.toolstrings).toHaveLength(1);
    expect('content' in r && r.content.extra_contact_ids).toEqual(['c2']);
  });
  it('checks dates and the SME email', () => {
    expect(cleanNote({ ...ok, date_from: '2026-11-10', date_to: '2026-11-01' })).toEqual({ error: 'The date range ends before it starts' });
    expect(cleanNote({ ...ok, sme: { name: 'A', mobile: '', email: 'nope' } })).toEqual({ error: 'The SME email looks wrong' });
  });
  it('numbers notes', () => { expect(pjnNo(7)).toBe('PJN-0007'); });
});

describe('rights', () => {
  it('keeps Pre-Job Notes behind their tab and JRA with jobs', () => {
    const contact = { pre_job_notes: { view: true, edit: true, delete: false } };
    expect(readAllowed('/api/pre-job-notes/by-job/abc', contact)).toBe(true);
    expect(readAllowed('/api/pre-job-notes/x/versions/2', contact)).toBe(true);
    expect(readAllowed('/api/pre-job-notes', { jobs: { view: true, edit: true, delete: true } })).toBe(false);
    expect(ruleFor('DELETE', '/api/pre-job-notes/x')?.action).toBe('delete');
    expect(ruleFor('POST', '/api/jra/j1/decide')?.menu).toBe('jobs');
  });
});
