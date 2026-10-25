// Reads NESR's JRA Excel form (e.g. QAF14021 Slickline) into a JRA template and, when it is filled in, the answers.
// Nothing about the form is hard-coded: sections are the rows whose answer column says "Answer", points come from each
// row's IF formula, requirements and approvers from theirs, options from the list validations, guidance from comments.
// A new revision of the form loads the same way.

import type { Answer, ApprovalLevel, Conditional, Question, Template } from './jra';
import type { Sheet } from './xlsxRead';

export interface FormDetails {
  job_no?: string; performed_by?: string; position?: string; jra_date?: string; country?: string; client?: string;
  location?: string; rig_well?: string; job_description?: string; expected_date?: string;
}
export interface ParsedForm { template: Template; answers: Record<string, Answer>; remarks: Record<string, string>; details: FormDetails; warnings: string[] }

const col = (ref: string) => /^[A-Z]+/.exec(ref)![0];
const rowOf = (ref: string) => Number(/\d+$/.exec(ref)![0]);
const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export function toAnswer(v: string | undefined): Answer | null {
  const s = clean(v).toUpperCase().replace(/\s/g, '');
  return s === 'YES' ? 'yes' : s === 'NO' ? 'no' : s === 'N/A' || s === 'NA' ? 'na' : null;
}

/** Excel stores dates as day numbers since 1899-12-30. */
function excelDate(v: string | undefined): string | undefined {
  const s = clean(v);
  if (!s) return undefined;
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86_400_000).toISOString().slice(0, 10);
  return s;
}

const IF_RE = /^\s*=?\s*IF\(\s*\$?([A-Z]+)\$?(\d+)\s*=\s*"([^"]*)"\s*,\s*("([^"]*)"|-?\d+(?:\.\d+)?)\s*,\s*("([^"]*)"|-?\d+(?:\.\d+)?)\s*\)\s*$/i;

/** IF(R9="NO",a,b) → the referenced cell, the answer tested, and the two outcomes. */
export function parseIf(f: string): { ref: string; test: Answer; then: string | number; else: string | number } | null {
  const m = IF_RE.exec(f);
  if (!m) return null;
  const test = toAnswer(m[3]);
  if (!test) return null;
  const val = (raw: string, str: string | undefined) => (raw.startsWith('"') ? str ?? '' : Number(raw));
  return { ref: `${m[1]}${m[2]}`, test, then: val(m[4], m[5]), else: val(m[6], m[7]) };
}

/** The nested IF that turns the score into an approval level: IF(P45<10,"Cell Leader",IF(P45<24,…,"Segment VP")). */
export function parseLevels(f: string): ApprovalLevel[] | null {
  const steps = [...f.matchAll(/IF\(\s*\$?[A-Z]+\$?\d+\s*<\s*(\d+(?:\.\d+)?)\s*,\s*"([^"]+)"/gi)].map((m) => ({ below: Number(m[1]), label: m[2] }));
  const last = /,\s*"([^"]+)"\s*\)+\s*$/.exec(f)?.[1];
  if (steps.length < 1 || !last) return null;
  const levels: ApprovalLevel[] = [{ min: 0, label: steps[0].label }];
  for (let i = 1; i < steps.length; i++) levels.push({ min: steps[i - 1].below, label: steps[i].label });
  levels.push({ min: steps[steps.length - 1].below, label: last });
  return levels;
}

export function parseJraForm(sheet: Sheet): ParsedForm | { error: string } {
  const { cells } = sheet;
  const warnings: string[] = [];
  const val = (ref: string) => clean(cells[ref]?.v);
  const byRow = new Map<number, string[]>();
  for (const ref of Object.keys(cells)) byRow.set(rowOf(ref), [...(byRow.get(rowOf(ref)) ?? []), ref]);
  for (const refs of byRow.values()) refs.sort((a, b) => colNum(col(a)) - colNum(col(b)));
  const rows = [...byRow.keys()].sort((a, b) => a - b);

  // form number and revision, e.g. "QAF14021 Rev 3"
  let code = '', revision = '';
  for (const r of rows.slice(0, 8)) for (const ref of byRow.get(r)!) {
    const m = /\b([A-Z]{2,6}[-\s]?\d{3,6})\s*Rev\.?\s*([\w.]+)/i.exec(val(ref));
    if (m && !code) { code = m[1].replace(/\s/g, ''); revision = m[2]; }
  }
  if (!code) return { error: 'Can’t find the form number and revision (for example “QAF14021 Rev 3”) in the first rows. Is this the JRA form?' };

  // header details: the first value to the right of each label
  const labelValue = (re: RegExp) => {
    for (const r of rows.slice(0, 12)) {
      const refs = byRow.get(r)!;
      const i = refs.findIndex((ref) => re.test(val(ref)));
      if (i >= 0) {
        // the value sits right of the label, before the next label (labels end with ":" or are known headings)
        for (const ref of refs.slice(i + 1)) { const v = val(ref); if (!v) continue; if (/\bRev\b|^Page \d+ of \d+/i.test(v)) return undefined; return /:\s*$/.test(v) || /^(Performed By|Position|JRA Date|Client|Location|Rig \/ Well|Job Expected Date)/i.test(v) ? undefined : v; }
      }
    }
    return undefined;
  };
  const details: FormDetails = {
    job_no: labelValue(/^Job No/i), performed_by: labelValue(/^Performed By/i), position: labelValue(/^Position/i), jra_date: excelDate(labelValue(/^JRA Date/i)),
    country: labelValue(/^Country/i), client: labelValue(/^Client/i), location: labelValue(/^Location/i), rig_well: labelValue(/^Rig \/ Well/i),
    job_description: labelValue(/^What is the job/i), expected_date: excelDate(labelValue(/^Job Expected Date/i)),
  };

  // section header rows: a letter, a title, and "Answer" over the answer column
  const headers = rows.filter((r) => byRow.get(r)!.some((ref) => /^answer$/i.test(val(ref))));
  if (!headers.length) return { error: 'Can’t find the question sections (rows with an “Answer” heading).' };
  let remarksCol: string | null = null;
  for (const r of rows) for (const ref of byRow.get(r)!) if (/^remarks/i.test(val(ref))) remarksCol ??= col(ref);

  const sections: Record<string, string> = {};
  const questions: Question[] = [];
  const answers: Record<string, Answer> = {};
  const remarks: Record<string, string> = {};
  const questionRows = new Map<number, string>();

  headers.forEach((h, hi) => {
    const refs = byRow.get(h)!;
    const find = (re: RegExp) => { const ref = refs.find((x) => re.test(val(x))); return ref ? col(ref) : null; };
    const letterRef = refs[0];
    const letter = val(letterRef).toUpperCase();
    const textCol = refs[1] ? col(refs[1]) : null;
    const ansCol = find(/^answer$/i), riskCol = find(/^risk$/i), reqCol = find(/^requirement/i), apprCol = find(/approved by/i);
    if (!/^[A-Z]$/.test(letter) || !textCol || !ansCol) { warnings.push(`Row ${h} looks like a section heading but has no section letter; skipped.`); return; }
    sections[letter] = val(refs[1]);
    const end = headers[hi + 1] ?? Infinity;
    for (const r of rows.filter((x) => x > h && x < end)) {
      const num = val(`${col(letterRef)}${r}`);
      const text = val(`${textCol}${r}`);
      if (!/^\d+$/.test(num) || !text) continue;
      const id = `${letter}${num}`;
      if (questions.some((x) => x.id === id)) { warnings.push(`${id} appears twice; the second one (row ${r}) was skipped.`); continue; }
      const ansRef = `${ansCol}${r}`;
      const options = (sheet.validations.find((v) => v.ranges.includes(ansRef))?.list.map(toAnswer).filter((a): a is Answer => !!a)) ?? [];
      const opts: Answer[] = options.length ? [...new Set(options)] : ['yes', 'no'];
      if (!options.length) warnings.push(`${id}: no Yes/No list on the answer cell; offering Yes and No.`);

      // points per answer from the risk cell
      const scores: Partial<Record<Answer, number>> = {};
      const riskCell = riskCol ? cells[`${riskCol}${r}`] : undefined;
      if (riskCell?.f) {
        const p = parseIf(riskCell.f);
        if (!p || typeof p.then !== 'number' || typeof p.else !== 'number') return void warnings.push(`${id}: can’t read the risk formula “${riskCell.f}”; scored 0.`);
        if (p.ref !== ansRef) warnings.push(`${id}: the risk formula looks at ${p.ref}, not the answer cell ${ansRef}.`);
        for (const o of opts) scores[o] = o === p.test ? p.then : p.else;
      } else {
        const n = Number(riskCell?.v ?? 0) || 0;
        for (const o of opts) scores[o] = n;
        if (riskCol) warnings.push(`${id}: the risk cell has no formula, so every answer scores ${n} (as in the form).`);
      }
      const conditional = (c: string | null): Conditional | undefined => {
        const f = c ? cells[`${c}${r}`]?.f : undefined;
        if (!f) return undefined;
        const p = parseIf(f);
        if (!p) { warnings.push(`${id}: can’t read the formula “${f}”; ignored.`); return undefined; }
        const textOut = String(p.then || p.else);
        const when = opts.filter((o) => String(o === p.test ? p.then : p.else) !== '');
        return textOut && when.length ? { text: textOut, when } : undefined;
      };
      const max = Math.max(...opts.map((o) => scores[o] ?? 0));
      const riskSide = (opts.find((o) => (scores[o] ?? 0) === max && max > 0) ?? 'no') as Answer;
      questions.push({
        id, section: letter, text, required: true,
        risk_if: riskSide === 'na' ? 'no' : riskSide, points: max,
        options: opts, scores, requirement: conditional(reqCol), approver: conditional(apprCol),
        guidance: sheet.comments[`${textCol}${r}`] ?? sheet.comments[ansRef] ?? sheet.comments[`${col(letterRef)}${r}`] ?? undefined,
      });
      questionRows.set(r, id);
      const a = toAnswer(cells[ansRef]?.v);
      if (a && opts.includes(a)) answers[id] = a;
      else if (clean(cells[ansRef]?.v)) warnings.push(`${id}: the answer “${clean(cells[ansRef]?.v)}” isn’t one of the offered answers; left blank.`);
      if (remarksCol && val(`${remarksCol}${r}`)) remarks[id] = val(`${remarksCol}${r}`);
    }
  });
  if (!questions.length) return { error: 'The form has section headings but no numbered questions under them.' };

  // the form's own section totals: say when one leaves a question out (SLK Ops counts every question)
  for (const ref of Object.keys(cells)) {
    const m = /^\s*=?\s*SUM\(\s*\$?([A-Z]+)\$?(\d+)\s*:\s*\$?[A-Z]+\$?(\d+)\s*\)\s*$/i.exec(cells[ref].f ?? '');
    if (!m) continue;
    const [from, to] = [Number(m[2]), Number(m[3])];
    const section = [...questionRows.entries()].filter(([r]) => r > from - 6 && r <= to + 1 && r < rowOf(ref)).map(([r, id]) => ({ r, id }));
    const inSameSection = section.filter((x) => x.id[0] === (questionRows.get(to) ?? questionRows.get(from))?.[0]);
    const missed = inSameSection.filter((x) => x.r < from || x.r > to).map((x) => x.id);
    if (missed.length) warnings.push(`The form’s total in ${ref} (${m[0].trim()}) leaves out ${missed.join(', ')}. SLK Operations counts every question, so its score can be higher than the form’s.`);
  }

  // approval levels and points per exemption
  let approval_levels: ApprovalLevel[] | null = null;
  let exemption_points = 0;
  const exemptionCell = Object.keys(cells).find((ref) => /COUNTIF\([^)]*"Exemption Required"\)/i.test(cells[ref].f ?? ''));
  for (const ref of Object.keys(cells)) {
    const f = cells[ref].f ?? '';
    const lv = /IF\(\s*\$?[A-Z]+\$?\d+\s*</i.test(f) ? parseLevels(f) : null;
    if (lv && (!approval_levels || lv.length > approval_levels.length)) approval_levels = lv;
    if (exemptionCell) { const m = new RegExp(`\\$?${col(exemptionCell)}\\$?${rowOf(exemptionCell)}\\s*\\*\\s*(\\d+)`).exec(f); if (m) exemption_points = Number(m[1]); }
  }
  if (!approval_levels) { warnings.push('No score → approval level formula found; everything goes to the SDM.'); approval_levels = [{ min: 0, label: 'SDM' }]; }

  // notes under "JRA Notes"
  const notes: string[] = [];
  const notesRow = rows.find((r) => byRow.get(r)!.some((ref) => /^JRA Notes/i.test(val(ref))));
  if (notesRow) for (const r of rows.filter((x) => x > notesRow)) {
    const v = val(byRow.get(r)![0]);
    if (/^JRA Approval/i.test(v)) break;
    if (/^[a-z]\s*[-–)]/i.test(v)) notes.push(v);
  }

  const title = [val('A1'), val('A2')].filter(Boolean).join(' · ') || 'Job Risk Assessment';
  return { template: { code, revision, title, sections, questions, approval_levels, exemption_points, notes }, answers, remarks, details, warnings };
}
