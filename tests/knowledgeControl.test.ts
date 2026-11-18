import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NUMBERING, addMonths, checkNumbering, checkPeriods, expiryState, formatNumber, groupFiles, guessType, mayAct, mayOpen, mayRetire, nextRevision, numberPrefix,
  editableAccept, editableProblem, registerCells, registerMatches, splitBase, submitProblems, type Controller, type RegisterRow,
} from '../src/shared/knowledgeControl';
import type { KnowledgeDoc } from '../src/shared/knowledge';
import { readAllowed, ruleFor } from '../src/worker/permissions';

const who = (o: Partial<Controller>): Controller => ({ username: 'u1', admin: false, editor: false, reviewer: false, approver: false, ...o });
const rev = (o: Record<string, unknown>) => ({ status: 'draft', reviewer: null, approver: null, submitted_by: null, created_by: null, ...o }) as Parameters<typeof mayAct>[1];

describe('document control', () => {
  it('lets each step be taken only by the person holding it, never by whoever submitted it', () => {
    const editor = who({ editor: true }), reader = who({});
    expect(mayAct(editor, rev({}), 'submit')).toBe(true);
    expect(mayAct(reader, rev({}), 'submit')).toBe(false);
    expect(mayAct(editor, rev({ status: 'review' }), 'edit_files')).toBe(false);
    const inReview = rev({ status: 'review', reviewer: 'r1', submitted_by: 'e1' });
    expect(mayAct(who({ username: 'r1', reviewer: true }), inReview, 'review')).toBe(true);
    expect(mayAct(who({ username: 'r2', reviewer: true }), inReview, 'review')).toBe(false);
    expect(mayAct(who({ username: 'a1', approver: true }), inReview, 'approve')).toBe(false);
    expect(mayAct(who({ username: 'e1', reviewer: true }), rev({ status: 'review', reviewer: 'e1', submitted_by: 'e1' }), 'review')).toBe(false);
    expect(mayAct(who({ username: 'e1', admin: true }), rev({ status: 'review', reviewer: 'e1', submitted_by: 'e1' }), 'review')).toBe(true);
    const inApproval = rev({ status: 'approval', reviewer: 'r1', approver: 'A1', submitted_by: 'e1' });
    expect(mayAct(who({ username: 'a1', approver: true }), inApproval, 'approve')).toBe(true);
    expect(mayAct(who({ username: 'a1', approver: true }), inApproval, 'send_back')).toBe(true);
    expect(mayAct(who({ username: 'r1', reviewer: true }), inApproval, 'send_back')).toBe(false);
    expect(mayRetire(who({ approver: true }))).toBe(true);
    expect(mayRetire(who({ editor: true }))).toBe(false);
  });
  it('asks for the required files before review, as Document Control does', () => {
    const pdf = { kind: 'published' as const, content_type: 'application/pdf', file_name: 'a.pdf' };
    const docx = { kind: 'source' as const, content_type: 'application/msword', file_name: 'a.docx' };
    const xlsx = { kind: 'published' as const, content_type: 'application/vnd.ms-excel', file_name: 'a.xls' };
    expect(submitProblems({ section: 'sop', summary: null }, [])).toEqual(['Add the document file (PDF)', 'Add the editable version (Word .docx)']);
    expect(submitProblems({ section: 'sop', summary: null }, [pdf, docx])).toEqual([]);
    expect(submitProblems({ section: 'client', summary: null }, [xlsx, docx])).toEqual(['The document file must be a PDF']);
    expect(submitProblems({ section: 'client', summary: null, is_form: 1 }, [xlsx])).toEqual(['Add the fillable form (Word .docx or Excel .xlsx)']);
    // an older .doc kept from before 6z.24 must be replaced before review
    expect(submitProblems({ section: 'sop', summary: null }, [pdf, { ...docx, file_name: 'a.doc' }])).toEqual(['The editable version must be a Word file (.docx), not “a.doc”. Open it in Word and use Save As › Word Document (.docx).']);
    expect(submitProblems({ section: 'sop', summary: null, is_form: 1 }, [pdf, { ...docx, file_name: 'a.xlsx' }])).toEqual([]);
    expect(submitProblems({ section: 'lesson', summary: null }, [])).toEqual(['Add the document file or write the summary']);
    expect(submitProblems({ section: 'lesson', summary: 'Check packing' }, [])).toEqual([]);
  });
  it('takes editable versions only as Word .docx (fillable forms also Excel .xlsx)', () => {
    expect(editableProblem({}, 'SOP-02.docx')).toBeNull();
    expect(editableProblem({}, 'SOP-02.DOCX')).toBeNull();
    expect(editableProblem({}, 'SOP-02.doc')).toContain('must be a Word file (.docx)');
    expect(editableProblem({}, 'SOP-02.xlsx')).toContain('must be a Word file (.docx)');
    expect(editableProblem({ is_form: 1 }, 'Checklist.xlsx')).toBeNull();
    expect(editableProblem({ is_form: 1 }, 'Checklist.xls')).toContain('Word (.docx) or Excel (.xlsx)');
    expect(editableAccept({})).toBe('.docx');
    expect(editableAccept({ is_form: 1 })).toBe('.docx,.xlsx');
  });
  it('opens the published file to everyone, the editable version to staff, old revisions to reviewers up', () => {
    const doc = { revision: 2, published_at: '2026-11-01' };
    const reader = who({}), editor = who({ editor: true }), reviewer = who({ reviewer: true });
    expect(mayOpen(reader, { kind: 'published', revision: 2 }, doc, 'approved')).toBe(true);
    expect(mayOpen(reader, { kind: 'source', revision: 2 }, doc, 'approved')).toBe(false);
    expect(mayOpen(reader, { kind: 'source', revision: 2 }, { ...doc, is_form: 1 }, 'approved')).toBe(true);
    expect(mayOpen(reader, { kind: 'published', revision: 3 }, doc, 'review')).toBe(false);
    expect(mayOpen(editor, { kind: 'source', revision: 2 }, doc, 'approved')).toBe(true);
    expect(mayOpen(editor, { kind: 'published', revision: 3 }, doc, 'draft')).toBe(true);
    expect(mayOpen(editor, { kind: 'published', revision: 1 }, doc, 'superseded')).toBe(false);
    expect(mayOpen(reviewer, { kind: 'published', revision: 1 }, doc, 'superseded')).toBe(true);
    expect(mayOpen(reader, { kind: 'published', revision: 0 }, { revision: 0, published_at: null }, 'draft')).toBe(false);
  });
  it('numbers revisions upward and keeps the old one live', () => {
    expect(nextRevision(0, false)).toEqual({ value: 0 });
    expect(nextRevision(0, false, '4')).toEqual({ value: 4 });
    expect(nextRevision(3, true)).toEqual({ value: 4 });
    expect(nextRevision(3, true, 3)).toEqual({ error: 'The new revision must be above Rev 3' });
    expect(nextRevision(3, true, 'x')).toHaveProperty('error');
  });
  it('checks the numbering and period settings', () => {
    expect(checkNumbering(DEFAULT_NUMBERING)).toEqual({ value: DEFAULT_NUMBERING });
    expect(checkNumbering({ ...DEFAULT_NUMBERING, digits: 9 })).toEqual({ error: 'Digits must be 2 to 6' });
    expect(checkNumbering({ ...DEFAULT_NUMBERING, prefix: { lesson: 'SOP', sop: 'SOP', client: 'CP' } })).toEqual({ error: 'Each section needs its own prefix' });
    expect(checkNumbering({ ...DEFAULT_NUMBERING, prefix: { lesson: 'll', sop: 'wi', client: 'cp' }, mode: 'manual' })).toMatchObject({ value: { mode: 'manual', prefix: { lesson: 'LL', sop: 'WI' } } });
    expect(checkPeriods({ reviewMonths: 12, expiryMonths: 36 })).toEqual({ value: { reviewMonths: 12, expiryMonths: 36 } });
    expect(checkPeriods({ reviewMonths: 0, expiryMonths: 36 })).toHaveProperty('error');
    const n = { ...DEFAULT_NUMBERING, place: false, digits: 4 };
    expect(formatNumber(numberPrefix({ section: 'sop', country: 'Global', company: 'SAPESCO' }, n), 7, 4)).toBe('SOP-SAP-0007');
    expect(numberPrefix({ section: 'client', country: 'Bahrain', company: null })).toBe('CP-BAH');
  });
  it('dates reviews and expiry, and flags them', () => {
    expect(addMonths('2026-11-17', 12)).toBe('2027-11-17');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-17', 36)).toBe('2029-11-17');
    expect(expiryState('2026-11-16', '2026-11-17')).toBe('expired');
    expect(expiryState('2027-01-20', '2026-11-17')).toBe('soon');
    expect(expiryState('2027-06-01', '2026-11-17')).toBeNull();
  });
  it('builds the register rows and filters', () => {
    const d = { id: 'x', section: 'sop', country: 'Global', company: 'NESR', client: null, doc_type: null, title: 'Rig up', doc_no: 'SOP-GL-NESR-001', revision: 2, published_at: '2026-10-01T00:00:00Z',
      review_due: '2026-11-01', expires_on: '2029-01-01', origin: 'external', retired_at: null, approved_by_name: 'A. Approver' } as unknown as KnowledgeDoc;
    const r: RegisterRow = { doc: d, open: { revision: 3, status: 'review' }, priorRevisions: 2 };
    const overdue = (due: string | null) => !!due && due < '2026-11-17';
    expect(registerMatches(r, 'review_overdue', '2026-11-17', overdue)).toBe(true);
    expect(registerMatches(r, 'in_work', '2026-11-17', overdue)).toBe(true);
    expect(registerMatches(r, 'external', '2026-11-17', overdue)).toBe(true);
    expect(registerMatches(r, 'draft', '2026-11-17', overdue)).toBe(false);
    expect(registerMatches({ ...r, doc: { ...d, retired_at: '2026-11-01' } }, 'published', '2026-11-17', overdue)).toBe(false);
    expect(registerCells(r, ['Review overdue'])).toEqual(['SOP-GL-NESR-001', 'Rig up', 'SOPs', 'SLK Standard Operating Procedure', 'Global', 'NESR', 'External', 2,
      'Published, Rev 3 in review', 'A. Approver', '2026-10-01', '2026-11-01', '2029-01-01', 'Review overdue', 2]);
  });
  it('groups batch files by name and reads the type and number from it', () => {
    const g = groupFiles([{ name: 'SOP-GL-NESR-012 Rig up.pdf' }, { name: 'SOP-GL-NESR-012 Rig up.DOCX' }, { name: 'Jar check.pdf' }]);
    expect(g.map((x) => [x.base, x.files.length])).toEqual([['SOP-GL-NESR-012 Rig up', 2], ['Jar check', 1]]);
    expect(guessType('SOP-GL-NESR-012 Rig up', 'lesson_learnt')).toBe('sop');
    expect(guessType('CP-SA-003 Permit', 'sop')).toBe('client');
    expect(guessType('LFI-2026 wire parted', 'sop')).toBe('learning_from_incident');
    expect(guessType('Jar check', 'best_practice')).toBe('best_practice');
    expect(splitBase('SOP-GL-NESR-012 Rig up')).toEqual({ doc_no: 'SOP-GL-NESR-012', title: 'Rig up' });
    expect(splitBase('Jar_check_list')).toEqual({ doc_no: null, title: 'Jar check list' });
    expect(splitBase('BP-Spooling the drum')).toEqual({ doc_no: null, title: 'Spooling the drum' });
  });
  it('lets reviewers and approvers act with the tab alone, and editors prepare revisions', () => {
    const view = { knowledge_hub: { view: true, edit: false, delete: false } };
    expect(ruleFor('POST', '/api/knowledge/a/revisions/2/approve')).toMatchObject({ action: 'view' });
    expect(ruleFor('POST', '/api/knowledge/a/revisions/2/send-back')).toMatchObject({ action: 'view' });
    expect(ruleFor('POST', '/api/knowledge/a/revisions/2/submit')).toMatchObject({ action: 'edit' });
    expect(ruleFor('POST', '/api/knowledge/a/revisions')).toMatchObject({ action: 'edit' });
    expect(ruleFor('PUT', '/api/knowledge/settings')).toMatchObject({ menu: 'knowledge_hub' });
    expect(ruleFor('POST', '/api/knowledge/manuals/folders/f/files')).toMatchObject({ menu: 'knowledge_hub' });
    expect(readAllowed('/api/knowledge/queue', view)).toBe(true);
    expect(readAllowed('/api/knowledge/a/revisions', view)).toBe(true);
    expect(readAllowed('/api/knowledge/manuals/files/m1', view)).toBe(true);
    expect(readAllowed('/api/knowledge/manuals/files/m1', {})).toBe(false);
  });
});
