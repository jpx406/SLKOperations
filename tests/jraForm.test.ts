import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { approvalLevel, cleanAnswers, flags, riskScore } from '../src/shared/jra';
import { parseIf, parseJraForm, parseLevels } from '../src/shared/jraForm';
import { zip } from '../src/shared/xlsx';
import { readXlsx } from '../src/shared/xlsxRead';
import { ruleFor } from '../src/worker/permissions';

// A small made-up form laid out like NESR's JRA sheet (the real form is not kept in the repository).
const enc = new TextEncoder();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
type C = { r: string; v?: string | number; f?: string };
function workbook(cells: C[], validations: { sqref: string; list: string }[], comments: { ref: string; text: string }[] = []) {
  const rows = new Map<number, C[]>();
  for (const c of cells) { const n = Number(/\d+$/.exec(c.r)![0]); rows.set(n, [...(rows.get(n) ?? []), c]); }
  const cellXml = (c: C) => {
    const f = c.f ? `<f>${esc(c.f)}</f>` : '';
    if (typeof c.v === 'number') return `<c r="${c.r}">${f}<v>${c.v}</v></c>`;
    if (c.f) return `<c r="${c.r}" t="str">${f}<v>${esc(String(c.v ?? ''))}</v></c>`;
    return `<c r="${c.r}" t="inlineStr"><is><t>${esc(String(c.v ?? ''))}</t></is></c>`;
  };
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[...rows.entries()].sort((a, b) => a[0] - b[0]).map(([n, cs]) => `<row r="${n}">${cs.map(cellXml).join('')}</row>`).join('')}</sheetData>`
    + `<dataValidations>${validations.map((v) => `<dataValidation type="list" sqref="${v.sqref}"><formula1>"${v.list}"</formula1></dataValidation>`).join('')}</dataValidations></worksheet>`;
  const files = [
    { name: 'xl/workbook.xml', data: enc.encode('<workbook xmlns:r="r"><sheets><sheet name="JRA" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode('<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet) },
  ];
  if (comments.length) {
    files.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', data: enc.encode('<Relationships><Relationship Id="c1" Type="comments" Target="../comments1.xml"/></Relationships>') });
    files.push({ name: 'xl/comments1.xml', data: enc.encode(`<comments><commentList>${comments.map((c) => `<comment ref="${c.ref}"><text><r><t>QHSE:</t></r><r><t xml:space="preserve">\n${esc(c.text)}</t></r></text></comment>`).join('')}</commentList></comments>`) });
  }
  return zip(files);
}

const FORM: C[] = [
  { r: 'A1', v: 'Sample Job Risk Assessment' }, { r: 'A2', v: 'Slickline' }, { r: 'AC3', v: 'QAF99999 Rev 4' },
  { r: 'A3', v: 'Job No :' }, { r: 'C3', v: 'T-100' }, { r: 'F3', v: 'Performed By :' }, { r: 'H3', v: 'A. Person' },
  { r: 'A4', v: 'Country :' }, { r: 'C4', v: 'Saudi Arabia' }, { r: 'V4', v: 'JRA Date :' }, { r: 'X4', v: 46000 },
  { r: 'A8', v: 'A' }, { r: 'B8', v: 'Design' }, { r: 'R8', v: 'Answer' }, { r: 'T8', v: 'Risk' }, { r: 'U8', v: 'Requirements' }, { r: 'X8', v: 'To be Approved by' }, { r: 'AB8', v: 'Remarks' },
  { r: 'A9', v: 1 }, { r: 'B9', v: 'Is there a change in supplier?' }, { r: 'R9', v: 'YES' }, { r: 'T9', v: 3, f: 'IF(R9="NO",0,3)' }, { r: 'U9', v: 'MOC Required', f: 'IF(R9="NO","","MOC Required")' }, { r: 'X9', v: 'Ops Manager', f: 'IF(R9="NO","","Ops Manager")' }, { r: 'AB9', v: 'new vendor' },
  { r: 'A10', v: 2, f: 'A9+1' }, { r: 'B10', v: 'Was the program reviewed?' }, { r: 'R10', v: 'NO' }, { r: 'T10', v: 5, f: 'IF(R10="NO",5,0)' }, { r: 'U10', v: 'Exemption Required', f: 'IF(R10="NO","Exemption Required","")' },
  { r: 'A11', v: 3 }, { r: 'B11', v: 'Is the crew rested?' }, { r: 'R11', v: 'MAYBE' }, { r: 'T11', v: 0 },
  { r: 'M12', v: 'Design Risk Total' }, { r: 'T12', v: 8, f: 'SUM(T10:T11)' },
  { r: 'A14', v: 'B' }, { r: 'B14', v: 'Equipment' }, { r: 'R14', v: 'Answer' }, { r: 'T14', v: 'Risk' }, { r: 'U14', v: 'Requirements' },
  { r: 'A15', v: 1 }, { r: 'B15', v: 'Third-party equipment checked?' }, { r: 'R15', v: 'N/A' }, { r: 'T15', v: 6, f: 'IF(R15="YES",0,6)' },
  { r: 'I45', v: 1, f: 'COUNTIF(U9:U42,"Exemption Required")' }, { r: 'P45', v: 0, f: '(T12+I45*5)' },
  { r: 'U45', v: 'Cell Leader', f: 'IF(P45="","",IF(P45<10,"Cell Leader",IF(P45<24,"Technical Manager","Segment VP")))' },
  { r: 'A46', v: 'JRA Notes' }, { r: 'A47', v: 'a- Three or more exemptions need an SME review.' }, { r: 'A51', v: 'JRA Approval' },
];
const VALID = [{ sqref: 'R9:S10 R11', list: 'YES, NO' }, { sqref: 'R15:S15', list: 'YES, NO, N/A' }];

async function parse() {
  const r = parseJraForm(await readXlsx(workbook(FORM, VALID, [{ ref: 'B9', text: 'Check the supplier list.' }])));
  if ('error' in r) throw new Error(r.error);
  return r;
}

describe('JRA Excel form', () => {
  it('reads the IF formulas the form uses', () => {
    expect(parseIf('IF(R9="NO",0,3)')).toEqual({ ref: 'R9', test: 'no', then: 0, else: 3 });
    expect(parseIf(' IF(R10="NO","Exemption Required","")')).toEqual({ ref: 'R10', test: 'no', then: 'Exemption Required', else: '' });
    expect(parseIf('SUM(T9:T12)')).toBeNull();
    expect(parseLevels('IF(P45="","",IF(P45<10,"Cell Leader",IF(P45<24,"CTM",IF(P45<34,"OM","Segment VP"))))')).toEqual([
      { min: 0, label: 'Cell Leader' }, { min: 10, label: 'CTM' }, { min: 24, label: 'OM' }, { min: 34, label: 'Segment VP' }]);
  });
  it('turns the sheet into sections, questions, points, requirements, approvers and guidance', async () => {
    const { template: t } = await parse();
    expect([t.code, t.revision, t.title]).toEqual(['QAF99999', '4', 'Sample Job Risk Assessment · Slickline']);
    expect(t.sections).toEqual({ A: 'Design', B: 'Equipment' });
    expect(t.questions.map((q) => q.id)).toEqual(['A1', 'A2', 'A3', 'B1']);
    const [a1, a2, a3, b1] = t.questions;
    expect(a1).toMatchObject({ options: ['yes', 'no'], scores: { yes: 3, no: 0 }, requirement: { text: 'MOC Required', when: ['yes'] }, approver: { text: 'Ops Manager', when: ['yes'] }, guidance: 'Check the supplier list.' });
    expect(a2).toMatchObject({ scores: { yes: 0, no: 5 }, requirement: { text: 'Exemption Required', when: ['no'] } });
    expect(a3.scores).toEqual({ yes: 0, no: 0 });
    expect(b1).toMatchObject({ options: ['yes', 'no', 'na'], scores: { yes: 0, no: 6, na: 6 } }); // as the form's formula says, N/A scores too
    expect(t.approval_levels).toEqual([{ min: 0, label: 'Cell Leader' }, { min: 10, label: 'Technical Manager' }, { min: 24, label: 'Segment VP' }]);
    expect(t.exemption_points).toBe(5);
    expect(t.notes).toEqual(['a- Three or more exemptions need an SME review.']);
  });
  it('reads the answers, remarks and header, and warns about what it can’t use', async () => {
    const r = await parse();
    expect(r.answers).toEqual({ A1: 'yes', A2: 'no', B1: 'na' });
    expect(r.remarks).toEqual({ A1: 'new vendor' });
    expect(r.details).toMatchObject({ job_no: 'T-100', performed_by: 'A. Person', country: 'Saudi Arabia', jra_date: '2025-12-09' });
    expect(r.warnings).toContain('A3: the answer “MAYBE” isn’t one of the offered answers; left blank.');
    expect(r.warnings.some((w) => w.includes('leaves out A1'))).toBe(true);
  });
  it('scores like the form: points plus 5 per exemption, then the level', async () => {
    const { template: t, answers } = await parse();
    // A1 yes 3 + A2 no 5 + B1 n/a 6 + one exemption × 5
    expect(riskScore(t, answers)).toBe(19);
    expect(approvalLevel(t, 19)).toBe('Technical Manager');
    expect(flags(t, answers).map((f) => f.id)).toEqual(['A1', 'A2']);
    expect(cleanAnswers(t, { A1: 'na' })).toEqual({ error: 'A1: N/A isn’t an answer this form offers' });
  });
  it('refuses files that aren’t the form', async () => {
    expect(parseJraForm(await readXlsx(workbook([{ r: 'A1', v: 'Shopping list' }], [])))).toHaveProperty('error');
    await expect(readXlsx(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not an Excel workbook/);
  });
  it('loads forms in Administration, not on the job', () => {
    expect(ruleFor('POST', '/api/jra/job1/upload')).toBeUndefined();
    expect(ruleFor('POST', '/api/form-templates/read')).toMatchObject({ menu: 'form_templates', action: 'edit' });
  });
  // NESR's own form, when it is on this machine (it is never committed)
  const real = 'C:/Users/JuanCeron/Downloads/SLK_JRA.xlsx';
  it.skipIf(!fs.existsSync(real))('reads QAF14021 Rev 3 as QHSE wrote it', async () => {
    const r = parseJraForm(await readXlsx(new Uint8Array(fs.readFileSync(real))));
    if ('error' in r) throw new Error(r.error);
    expect([r.template.code, r.template.revision, r.template.questions.length, Object.keys(r.template.sections).length]).toEqual(['QAF14021', '3', 26, 5]);
    expect(r.template.approval_levels.map((l) => l.min)).toEqual([0, 10, 24, 34]);
    expect(r.template.exemption_points).toBe(5);
  });
});
