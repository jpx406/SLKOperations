import { describe, expect, it } from 'vitest';
import type { Template } from '../src/shared/jra';
import { jraPdf } from '../src/shared/jraPdf';
import { PdfDoc, textWidth, toWinAnsi, wrap } from '../src/shared/pdf';
import { ruleFor } from '../src/worker/permissions';

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

/** Checks the file the way a reader does: the trailer points at the xref, and every xref entry at its object. */
function checkStructure(bytes: Uint8Array) {
  const s = latin1(bytes);
  expect(s.startsWith('%PDF-1.4')).toBe(true);
  expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  const xref = Number(/startxref\n(\d+)\n%%EOF/.exec(s)![1]);
  expect(s.slice(xref, xref + 4)).toBe('xref');
  const count = Number(/xref\n0 (\d+)\n/.exec(s.slice(xref))![1]);
  const entries = s.slice(xref).split('\n').slice(3, 3 + count - 1);
  entries.forEach((e, i) => expect(s.slice(Number(e.slice(0, 10)), Number(e.slice(0, 10)) + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  // stream lengths match their content
  for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) expect(s.slice(m.index! + m[0].length + Number(m[1]), m.index! + m[0].length + Number(m[1]) + 10)).toBe('\nendstream');
  return s;
}
/** The text drawn on the pages, from the Tj strings. */
const drawn = (s: string) => [...s.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1].replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\(.)/g, '$1')).join('\n');

const T: Template = {
  code: 'QAF99999', revision: '4', title: 'Sample Job Risk Assessment', sections: { A: 'Design', B: 'Equipment' }, exemption_points: 5,
  notes: ['a- Three or more exemptions need an SME review.'],
  approval_levels: [{ min: 0, label: 'Cell Leader' }, { min: 10, label: 'Technical Manager' }],
  questions: [
    { id: 'A1', section: 'A', text: 'Has the job program been reviewed by peer(s) with adequate level of technical expertise and approved by the proper level of line management and the client?', risk_if: 'no', points: 5, required: true, options: ['yes', 'no'], scores: { yes: 0, no: 5 }, requirement: { text: 'Exemption Required', when: ['no'] }, approver: { text: 'Ops or Technical Manager', when: ['no'] } },
    { id: 'B1', section: 'B', text: 'Third-party equipment checked?', risk_if: 'no', points: 6, required: true, options: ['yes', 'no', 'na'], scores: { yes: 0, no: 6, na: 6 } },
  ],
};

describe('PDF writer', () => {
  it('encodes typed punctuation as Windows-1252 and replaces what it can’t show', () => {
    expect(toWinAnsi('It’s “ok” – 5 → 6 H₂S ✓')).toEqual([...'It'].map((c) => c.charCodeAt(0)).concat([0x92, 115, 32, 0x93, 111, 107, 0x94, 32, 0x96, 32, 53, 32, 45, 62, 32, 54, 32, 72, 50, 83, 32, 118]));
    expect(toWinAnsi('日本')).toEqual([63, 63]);
  });
  it('wraps to the width and keeps line breaks', () => {
    const lines = wrap('one two three four five six seven eight nine ten', 60, 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l, 10)).toBeLessThanOrEqual(60);
    expect(wrap('a\nb', 500, 10)).toEqual(['a', 'b']);
  });
  it('writes a file a reader can open, across pages', () => {
    const doc = new PdfDoc();
    for (let i = 0; i < 120; i++) doc.para(`Line ${i} with (brackets) and a back\\slash`);
    const s = checkStructure(doc.bytes('footer'));
    expect((s.match(/\/Type \/Page /g) ?? []).length).toBeGreaterThan(1);
    expect(drawn(s)).toContain('Line 119 with (brackets) and a back\\slash');
  });
});

describe('approved JRA PDF', () => {
  it('shows the form, every answer and its points, the score, the approval and the signature', () => {
    const s = checkStructure(jraPdf({
      template: T, answers: { A1: 'no', B1: 'na' },
      job: { ticket_no: '7777', well: 'ABQQ-538', rig: 'SINO21', country: 'Saudi Arabia', unit_number: 'SL-40', start_date: '2026-10-25' },
      details: { client: 'Saudi Aramco', remarks: { A1: 'peer review pending' } },
      approval: { by: 'Ali Abdulhakim', role: 'SDM', at: '2026-10-25T09:17:00.000Z' },
      signature: { fingerprint: 'ab'.repeat(32), sealed: true },
    }));
    const text = drawn(s);
    for (const want of ['Sample Job Risk Assessment', 'QAF99999 Rev 4', 'APPROVED', 'Saudi Aramco', 'A  Design', 'Exemption Required', 'To be approved by: Ops or Technical Manager',
      'Remarks: peer review pending', 'N/A', 'Approved by Ali Abdulhakim (SDM) on 25 Oct 2026, 12:17 Riyadh', 'ab'.repeat(32)]) expect(text).toContain(want);
    // 5 (A1 No) + 6 (B1 N/A) + 1 exemption × 5
    expect(text).toMatch(/Risk index score\n16\n/);
    expect(text).toContain('Technical Manager');
  });
  it('lets job editors file it again', () => {
    expect(ruleFor('POST', '/api/jra/j1/pdf')).toMatchObject({ menu: 'jobs', action: 'edit' });
  });
});
