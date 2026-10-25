import { describe, expect, it } from 'vitest';
import { EXPORT_ONLY, PACKAGE_FORMAT, checkPackage } from '../src/shared/dataPackage';
import { INLINE, MAX_BYTES, checkUpload, cleanName, sizeText } from '../src/shared/attachments';
import { readAllowed, ruleFor } from '../src/worker/permissions';

const view = { view: true, edit: false, delete: false };
const edit = { view: true, edit: true, delete: false };

describe('attachments', () => {
  it('keeps documents and images, refuses anything a browser could run', () => {
    expect(checkUpload('ticket.PDF', 10)).toEqual({ name: 'ticket.PDF', type: 'application/pdf' });
    expect(checkUpload('rig-up.jpg', 10)).toMatchObject({ type: 'image/jpeg' });
    expect(checkUpload('JRA.xlsx', 10)).toMatchObject({ type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    for (const bad of ['page.html', 'logo.svg', 'run.js', 'setup.exe', 'noextension']) expect(checkUpload(bad, 10)).toHaveProperty('error');
    expect(checkUpload('big.pdf', MAX_BYTES + 1)).toHaveProperty('error');
    expect(checkUpload('empty.pdf', 0)).toHaveProperty('error');
    expect(INLINE.has('application/msword')).toBe(false);
  });
  it('cleans names: no folders or odd characters', () => {
    expect(cleanName(String.raw`C:\Users\x\..\Ticket "A".pdf`)).toBe('Ticket _A_.pdf');
    expect(cleanName('../../etc/passwd.txt')).toBe('passwd.txt');
    expect(sizeText(2_500_000)).toBe('2.4 MB');
  });
  it('follows the record’s tab: jobs for job files, Knowledge Hub for its files', () => {
    expect(readAllowed('/api/attachments/job/j1', { jobs: view })).toBe(true);
    expect(readAllowed('/api/attachments/job/j1/f1', { jobs: view })).toBe(true);
    expect(readAllowed('/api/attachments/job/j1', { knowledge_hub: edit })).toBe(false);
    expect(readAllowed('/api/attachments/knowledge/k1', { knowledge_hub: view })).toBe(true);
    expect(ruleFor('POST', '/api/attachments/job/j1')).toMatchObject({ menu: 'jobs', action: 'edit' });
    expect(ruleFor('DELETE', '/api/attachments/job/j1/f1')).toMatchObject({ menu: 'jobs', action: 'edit' });
    expect(ruleFor('POST', '/api/attachments/knowledge/k1')).toMatchObject({ menu: 'knowledge_hub', action: 'edit' });
    expect(ruleFor('POST', '/api/attachments/job')).toBeUndefined();
  });
  it('exports file records but never imports them', () => {
    expect(EXPORT_ONLY).toContain('attachments');
    expect(checkPackage({ format: PACKAGE_FORMAT, version: 1, tables: { attachments: [{ id: 'x' }] } })).toEqual({ tables: {} });
  });
});
