import { describe, expect, it } from 'vitest';
import { DEFAULT_COPY_SETTINGS, applyEdits, checkCopySettings, copyNumber, copyState, makeCompanyCopy, mayHaveCopies, printedFields } from '../src/shared/companyCopy';
import { zip } from '../src/shared/xlsx';
import { unzip } from '../src/shared/xlsxRead';
import { readAllowed, ruleFor } from '../src/worker/permissions';

const te = new TextEncoder(), td = new TextDecoder();
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const p = (...runs: string[]) => `<w:p>${runs.map((t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`).join('')}</w:p>`;
const pkg = (parts: Record<string, string | Uint8Array>) => zip(Object.entries(parts).map(([name, v]) => ({ name, data: typeof v === 'string' ? te.encode(v) : v })));
const types = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';
const docRels = '<Relationships><Relationship Id="rId8" Type="x/header" Target="header1.xml"/><Relationship Id="rId9" Type="x/footer" Target="footer1.xml"/></Relationships>';
const sect = '<w:sectPr><w:headerReference w:type="default" r:id="rId8"/><w:footerReference w:type="default" r:id="rId9"/></w:sectPr>';

/** A small NESR SOP: cover table, body text, header and footer, in the NESR green. */
const nesrDocx = () => pkg({
  '[Content_Types].xml': types,
  'word/_rels/document.xml.rels': docRels,
  'word/document.xml': `<w:document ${W}><w:body>
    <w:tbl><w:tr><w:tc><w:tcPr><w:shd w:fill="024800"/></w:tcPr>${p('Document No:')}${p('NES', 'R-8000-SOP-', '11')}</w:tc>
    <w:tc>${p('Prepared By:')}${p('Juan Lopez (Service Delivery Manager)')}${p('Reviewed By:')}${p('Mustapha Aloui (Slickline Regional Manager)')}${p('Corporate Approval:')}${p('Hamza Qarooni (Corporate Quality)')}</w:tc></w:tr></w:tbl>
    ${p('The Job Design approved by Client and ', 'NESR', ' must assess the needs.')}
    ${p('Follow NESR-8000-SOP-04 for winch control and National Energy Services Reunited Corp. rules.')}
    ${p('Pressure test as per Aramco procedure.')}${sect}</w:body></w:document>`,
  'word/header1.xml': `<w:hdr ${W}>${p('Open and Close Otis SSD')}${p('Standard Operation Procedure (SOP)')}</w:hdr>`,
  'word/footer1.xml': `<w:ftr ${W}>${p('Doc No: NESR-8000-SOP-11')}${p('Revision:  01   Date:  30', 'th', ' December 2022')}</w:ftr>`,
});

/** A SAPESCO SOP used as the template: its own header with a logo, and its footer with its own number and date. */
const logo = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const sapTemplate = () => pkg({
  '[Content_Types].xml': types,
  'word/_rels/document.xml.rels': docRels,
  'word/document.xml': `<w:document ${W}><w:body>${p('Anything')}${sect}</w:body></w:document>`,
  'word/header1.xml': `<w:hdr ${W}><w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p>${p('Gauge Cutter Runs')}${p('Standard Operation Procedure (SOP)')}</w:hdr>`,
  'word/_rels/header1.xml.rels': '<Relationships><Relationship Id="rId1" Type="x/image" Target="media/image1.png"/></Relationships>',
  'word/media/image1.png': logo,
  'word/footer1.xml': `<w:ftr ${W}><w:tbl><w:tr><w:tc><w:shd w:fill="EE0000"/>${p('Doc No: ', 'SA', 'P-8000-SOP-', '07')}${p('Revision:  0', '2  Date:  ', '30', 'th', ' December, 2025')}</w:tc></w:tr></w:tbl></w:ftr>`,
});

const text = (xml: string) => [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
const sap = { ...DEFAULT_COPY_SETTINGS.companies.SAPESCO, approvers: { prepared: 'Juan Lopez (Service Quality Manager)', reviewed: 'Chems Eddine Kiaza (Operations Manager)', segment: '', corporate: '' } };

describe('company copies of global NESR SOPs (6z.21)', () => {
  it('numbers copies after the NESR number', () => {
    expect(copyNumber('NESR-8000-SOP-11', 'SAP')).toBe('SAP-8000-SOP-11');
    expect(copyNumber('SOP-GL-NESR-004', 'GES')).toBe('SOP-GL-GES-004');
    expect(copyNumber('QAF14010', 'SAP')).toBe('SAP-QAF14010');
    expect(copyNumber(null, 'SAP')).toBeNull();
  });

  it('only global NESR SOPs and SWIs have copies', () => {
    expect(mayHaveCopies({ section: 'sop', country: 'Global', company: 'NESR' })).toBe(true);
    expect(mayHaveCopies({ section: 'swi', country: 'Global', company: 'NESR' })).toBe(true);
    expect(mayHaveCopies({ section: 'sop', country: 'Oman', company: 'NESR' })).toBe(false);
    expect(mayHaveCopies({ section: 'sop', country: 'Global', company: 'SAPESCO' })).toBe(false);
    expect(mayHaveCopies({ section: 'form', country: 'Global', company: 'NESR' })).toBe(false);
    expect(mayHaveCopies({ section: 'sop', country: 'Global', company: 'NESR', copy_of: 'x' })).toBe(false);
  });

  it('edits only the runs a change covers', () => {
    expect(applyEdits(['NES', 'R-8000'], [{ start: 0, end: 4, to: 'SAP' }])).toEqual(['SAP', '-8000']);
    expect(applyEdits(['Date: 30', 'th', ' December, 2025'], [{ start: 19, end: 25, to: ' 2022' }])).toEqual(['Date: 30', 'th', ' December 2022']);
    expect(applyEdits(['abc'], [{ start: 3, end: 3, to: 'd' }])).toEqual(['abcd']);
  });

  it('reads the number, revision and date a footer prints', () => {
    const f = `<w:ftr ${W}>${p('Doc No: NESR-8000-SOP-11')}${p('Revision:  01   Date:  30', 'th', ' December 2022')}</w:ftr>`;
    expect(printedFields([f])).toEqual({ docNo: 'NESR-8000-SOP-11', revision: '01', date: '30th December 2022' });
  });

  it('checks the settings an admin saves', () => {
    const ok = checkCopySettings({ nesrColours: ['#024800'], companies: { SAPESCO: { ...sap, colour: '#ee0000', words: [{ from: 'Aramco', to: 'Client' }, { from: '', to: 'x' }] } } });
    expect('value' in ok && ok.value.companies.SAPESCO.colour).toBe('EE0000');
    expect('value' in ok && ok.value.companies.SAPESCO.words).toEqual([{ from: 'Aramco', to: 'Client' }]);
    expect('value' in ok && ok.value.companies['Gulf Energy'].prefix).toBe('GES');
    expect(checkCopySettings({ companies: { SAPESCO: { ...sap, colour: 'red' } } })).toEqual({ error: 'SAPESCO: the colour is a six-digit hex code, like EE0000' });
    expect(checkCopySettings({ companies: { SAPESCO: { ...sap, prefix: '1-2' } } })).toHaveProperty('error');
  });

  it('makes the SAPESCO Word file from the NESR one and the SAPESCO template', async () => {
    const r = await makeCompanyCopy(nesrDocx(), sapTemplate(), { t: sap, nesrColours: ['024800'], copyNo: 'SAP-8000-SOP-11' });
    const out = await unzip(r.bytes, true);
    const doc = td.decode(out.get('word/document.xml'));
    const body = text(doc);
    expect(body).toContain('SAP-8000-SOP-11');
    expect(body).toContain('approved by Client and SAPESCO must');
    expect(body).toContain('Follow SAP-8000-SOP-04 for winch control and Sahara Petroleum Services rules.');
    expect(body).toContain('Juan Lopez (Service Quality Manager)');
    expect(body).toContain('Chems Eddine Kiaza (Operations Manager)');
    expect(body).toContain('Hamza Qarooni (Corporate Quality)'); // no corporate approver set: kept
    expect(body).toContain('as per Aramco procedure'); // client names stay
    expect(doc).toContain('w:fill="EE0000"');
    expect(doc).not.toContain('024800');
    // header and footer come from the template, with this document's title, number, revision and date
    const head = td.decode(out.get('word/header1.xml'));
    expect(text(head)).toContain('Open and Close Otis SSD');
    expect(text(head)).not.toContain('Gauge Cutter Runs');
    expect(head).toContain('r:embed="rId1"');
    expect(td.decode(out.get('word/_rels/header1.xml.rels'))).toContain('Target="media/brand_sap_image1.png"');
    expect(out.get('word/media/brand_sap_image1.png')).toEqual(logo);
    expect(td.decode(out.get('[Content_Types].xml'))).toContain('Extension="png"');
    const foot = td.decode(out.get('word/footer1.xml'));
    expect(text(foot)).toBe('Doc No: SAP-8000-SOP-11Revision:  01  Date:  30th December 2022');
    expect(foot).toContain('>th</w:t>'); // the raised "th" keeps its own run
    expect(r.leftovers).toEqual([]);
    expect(r.usedTemplate).toEqual(['header:default', 'footer:default']);
    expect(r.changes.map((c) => c.label)).toEqual(expect.arrayContaining(['NESR → SAPESCO', 'NESR numbers → SAP', 'Cover: Prepared By', 'Logo, header and footer from the template']));
  });

  it('lists what still says NESR and refuses files that are not Word', async () => {
    const t = { ...sap, name: 'NESR Partner' };
    const r = await makeCompanyCopy(nesrDocx(), sapTemplate(), { t, nesrColours: ['024800'], copyNo: 'SAP-8000-SOP-11' });
    expect(r.leftovers.some((s) => s.includes('NESR Partner'))).toBe(true);
    await expect(makeCompanyCopy(new Uint8Array([1, 2, 3]), sapTemplate(), { t: sap, nesrColours: [], copyNo: null })).rejects.toThrow('not a Word file');
  });

  it('says where a copy stands against its NESR source', () => {
    const src = { revision: 2, published_at: '2026-11-01' };
    expect(copyState({ revision: 1, open: { status: 'draft' } }, src)).toBe('draft');
    expect(copyState({ revision: 1, open: { status: 'review' } }, src)).toBe('review');
    expect(copyState({ revision: 1, published_at: null }, src)).toBe('draft');
    expect(copyState({ revision: 1, copy_of_revision: 1, published_at: 'x' }, src)).toBe('behind');
    expect(copyState({ revision: 2, copy_of_revision: 2, published_at: 'x' }, src)).toBe('current');
    expect(copyState({ revision: 1, copy_of_revision: 1, published_at: 'x' }, { revision: 2, published_at: null })).toBe('current');
  });

  it('lets editors make copies and admins set templates', () => {
    expect(ruleFor('POST', '/api/knowledge/d1/copies')).toMatchObject({ menu: 'knowledge_hub', action: 'edit' });
    expect(ruleFor('PUT', '/api/knowledge/settings/copies')).toMatchObject({ menu: 'knowledge_hub' });
    expect(ruleFor('POST', '/api/knowledge/settings/copies/SAPESCO/template')).toMatchObject({ menu: 'knowledge_hub' });
    expect(readAllowed('/api/knowledge/settings/copies/SAPESCO/template', { knowledge_hub: { view: true, edit: false, delete: false } })).toBe(true);
  });
});
