// Form templates (owner request 2026-10-28): the JRA and the job checklists are templates managed in
// Administration → Form templates. Each one belongs to a job stage (Design, Preparation, Execution, Closure) and is
// made by hand, from a Word or Excel file, or with the AI assistant's help. The JRA keeps its risk points and
// approval levels; a checklist is questions answered Yes / No / N/A with a remark, then marked complete.

import type { Answer, ApprovalLevel, Question, Template } from './jra';
import { STAGES, type Stage } from './stages';
import { unzip, type Sheet } from './xlsxRead';

export type FormKind = 'jra' | 'checklist';
export const FORM_KINDS: Record<FormKind, string> = { jra: 'Risk assessment (JRA)', checklist: 'Checklist' };

/** A template as the editor and the API exchange it. */
export interface FormTemplate extends Template {
  id?: string; country: string; name: string; kind: FormKind; stage: Stage; active: boolean; source_file?: string | null;
}

const ANSWERS: Answer[] = ['yes', 'no', 'na'];
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Checks and tidies a template from the editor, an upload or the AI. Question ids are kept when given, else made from the section. */
export function cleanTemplate(input: unknown): { template: Omit<FormTemplate, 'id' | 'country' | 'active'> } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'The template is empty' };
  const b = input as Record<string, unknown>;
  const kind: FormKind = b.kind === 'jra' ? 'jra' : 'checklist';
  const name = str(b.name, 120);
  if (!name) return { error: 'Name the template' };
  const stage = (STAGES as readonly string[]).includes(String(b.stage)) ? (b.stage as Stage) : null;
  if (!stage) return { error: 'Pick the job stage the template belongs to' };
  const code = str(b.code, 40) || name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'FORM';
  const revision = str(b.revision, 20) || '1';

  const rawSections = b.sections && typeof b.sections === 'object' && !Array.isArray(b.sections) ? (b.sections as Record<string, unknown>) : {};
  const sections: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawSections)) { const key = str(k, 10); const label = str(v, 120); if (key && label) sections[key] = label; }
  if (!Object.keys(sections).length) sections.A = 'General';

  const list = Array.isArray(b.questions) ? b.questions : [];
  if (!list.length) return { error: 'Add at least one question' };
  if (list.length > 300) return { error: 'At most 300 questions per template' };
  const seen = new Set<string>();
  const perSection: Record<string, number> = {};
  const questions: Question[] = [];
  for (const [i, raw] of list.entries()) {
    const q = (raw ?? {}) as Record<string, unknown>;
    const text = str(q.text, 500);
    if (!text) return { error: `Question ${i + 1} has no text` };
    const section = str(q.section, 10) in sections ? str(q.section, 10) : Object.keys(sections)[0];
    perSection[section] = (perSection[section] ?? 0) + 1;
    let id = str(q.id, 20) || `${section}${perSection[section]}`;
    while (seen.has(id)) id = `${id}′`;
    seen.add(id);
    const options = Array.isArray(q.options) ? ANSWERS.filter((a) => (q.options as unknown[]).includes(a)) : [];
    const points = Math.max(0, Math.min(100, Math.round(Number(q.points) || 0)));
    const out: Question = { id, section, text, risk_if: q.risk_if === 'yes' ? 'yes' : 'no', points, required: q.required !== false };
    if (options.length >= 2 && options.length < 3) out.options = options;
    const guidance = str(q.guidance, 500);
    if (guidance) out.guidance = guidance;
    if (kind === 'jra' && q.scores && typeof q.scores === 'object') out.scores = q.scores as Question['scores'];
    if (kind === 'jra' && q.requirement) out.requirement = q.requirement as Question['requirement'];
    if (kind === 'jra' && q.approver) out.approver = q.approver as Question['approver'];
    questions.push(out);
  }

  let approval_levels: ApprovalLevel[] = [];
  if (kind === 'jra') {
    const levels = Array.isArray(b.approval_levels) ? b.approval_levels : [];
    approval_levels = levels.map((l) => ({ min: Math.max(0, Math.round(Number((l as ApprovalLevel)?.min) || 0)), label: str((l as ApprovalLevel)?.label, 60) })).filter((l) => l.label);
    if (!approval_levels.length) return { error: 'A JRA needs at least one approval level (the score from which a role approves it)' };
    approval_levels.sort((a, b2) => a.min - b2.min);
    approval_levels[0].min = 0;
  }
  const notes = Array.isArray(b.notes) ? b.notes.map((n) => str(n, 300)).filter(Boolean).slice(0, 20) : undefined;
  return {
    template: {
      name, kind, stage, code, revision, sections, questions, approval_levels, title: str(b.title, 200) || name, notes,
      exemption_points: kind === 'jra' && Number(b.exemption_points) > 0 ? Math.round(Number(b.exemption_points)) : undefined,
      source_file: str(b.source_file, 200) || null,
    },
  };
}

// ---- reading Word and Excel files --------------------------------------------------------------------------

const dec = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

/** The text of a .docx, one line per paragraph and one line per table row (cells joined by " | "). */
export async function docxLines(bytes: Uint8Array): Promise<string[]> {
  const files = await unzip(bytes);
  const doc = files.get('word/document.xml');
  if (!doc) throw new Error('This file is not a Word document (.docx)');
  const xml = new TextDecoder().decode(doc);
  const para = (p: string) => dec([...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join('')).trim();
  const lines: string[] = [];
  const body = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const rows = [...tbl.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) => [...c[0].matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map((p) => para(p[0])).filter(Boolean).join(' ')).filter(Boolean).join(' | '));
    return `<w:p><w:t>\u0000${rows.filter(Boolean).join('\u0001')}</w:t></w:p>`;
  });
  for (const m of body.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    const t = para(m[0]);
    if (t.startsWith('\u0000')) lines.push(...t.slice(1).split('\u0001'));
    else if (t) lines.push(t);
  }
  return lines.filter((l) => l.trim());
}

/** The first worksheet as lines: each row's non-empty cells, left to right, joined by " | ". */
export function sheetLines(sheet: Sheet): string[] {
  const rows = new Map<number, [number, string][]>();
  const colNo = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    const v = cell.v?.replace(/\s+/g, ' ').trim();
    if (!m || !v) continue;
    const r = Number(m[2]);
    rows.set(r, [...(rows.get(r) ?? []), [colNo(m[1]), v]]);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, cells]) => cells.sort((a, b) => a[0] - b[0]).map(([, v]) => v).join(' | '));
}

const CELL = /\s*\|\s*/;
// answer boxes and table headings, dropped from the lines
const ANSWER_WORDS = /^(yes|no\.?|n\/?a|y|n|remarks?|comments?|ok|✓|☐|□|#|s\.?\s?no\.?|sr\.?|item|items|description|question|questions|check|status|action|responsible|answer)$/i;

/**
 * A first draft from a document's lines, without the AI: lines that ask something (end with "?", or are numbered
 * or ticked items) become questions, short headings before them become sections, the first line names the form.
 * The admin reviews it in the editor, or asks the AI assistant to do better.
 */
export function linesToTemplate(lines: string[], fileName: string): Omit<FormTemplate, 'country' | 'active'> {
  const clean = lines.map((l) => l.split(CELL).map((c) => c.trim()).filter((c) => c && !ANSWER_WORDS.test(c)).join(' | ')).filter(Boolean);
  const sections: Record<string, string> = {};
  const questions: Question[] = [];
  let section = '';
  const letter = (n: number) => String.fromCharCode(65 + (n % 26)) + (n >= 26 ? String(Math.floor(n / 26)) : '');
  const newSection = (label: string) => { section = letter(Object.keys(sections).length); sections[section] = label.slice(0, 120); };
  const title = clean[0]?.split(CELL)[0]?.slice(0, 120) || fileName.replace(/\.[^.]+$/, '');
  for (const line of clean.slice(1)) {
    const cells = line.split(CELL);
    // a numbered first cell ("1", "1.", "A3") with the question in the next one
    const numbered = cells.length > 1 && /^([A-Z]?\d{1,3}[.)]?|[a-z][.)])$/.test(cells[0]);
    const text = (numbered ? cells.slice(1).join(' ') : line.replace(/^\s*(?:\d{1,3}[.)]|[-•▪●○◦*]|[a-z][.)]|☐|□)\s+/, '')).replace(/ \| /g, ' ').trim();
    if (!text) continue;
    const asks = text.endsWith('?') || numbered || /^\s*(?:\d{1,3}[.)]|[-•▪●○◦*]|☐|□)\s+/.test(line);
    if (!asks && text.length <= 70 && !/[.:;]$/.test(text)) { newSection(text); continue; }
    if (!asks) continue;
    if (!section) newSection('General');
    const n = questions.filter((q) => q.section === section).length + 1;
    questions.push({ id: `${section}${n}`, section, text: text.slice(0, 500), risk_if: 'no', points: 0, required: true });
  }
  // keep only sections that got questions
  for (const k of Object.keys(sections)) if (!questions.some((q) => q.section === k)) delete sections[k];
  return { name: title, kind: 'checklist', stage: 'preparation', code: '', revision: '1', sections, questions, approval_levels: [], title, source_file: fileName };
}

/** How far a filled checklist is: required questions still open. */
export function checklistProgress(t: Pick<Template, 'questions'>, answers: Record<string, string>) {
  const missing = t.questions.filter((q) => q.required && !answers[q.id]).map((q) => q.id);
  return { answered: t.questions.filter((q) => answers[q.id]).length, total: t.questions.length, missing };
}

/** The JSON shape the AI assistant must return (also used to check it). */
export const TEMPLATE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short name of the form, e.g. "Rig-up checklist"' },
    kind: { type: 'string', enum: ['jra', 'checklist'], description: 'jra for a job risk assessment with risk points and approval levels, otherwise checklist' },
    stage: { type: 'string', enum: [...STAGES], description: 'The job stage where the form is filled: design, preparation, execution or closure' },
    code: { type: 'string', description: 'Form code from the document, if any (e.g. QHSE-F-012)' },
    revision: { type: 'string', description: 'Revision from the document, if any' },
    sections: { type: 'object', additionalProperties: { type: 'string' }, description: 'Section letter (A, B, C ...) to section title' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section: { type: 'string', description: 'Section letter' },
          text: { type: 'string', description: 'The question, phrased to be answered Yes / No / N/A' },
          required: { type: 'boolean' },
          options: { type: 'array', items: { type: 'string', enum: ['yes', 'no', 'na'] }, description: 'Only when N/A is not allowed: ["yes","no"]' },
          risk_if: { type: 'string', enum: ['yes', 'no'], description: 'JRA only: the answer that adds risk' },
          points: { type: 'integer', description: 'JRA only: risk points for the risky answer' },
          guidance: { type: 'string', description: 'Optional hint shown under the question' },
        },
        required: ['section', 'text', 'required'],
      },
    },
    approval_levels: {
      type: 'array', description: 'JRA only: from which total score each role approves (first one at 0)',
      items: { type: 'object', properties: { min: { type: 'integer' }, label: { type: 'string' } }, required: ['min', 'label'] },
    },
    notes: { type: 'array', items: { type: 'string' }, description: 'Notes printed with the form, if the document has any' },
    summary: { type: 'string', description: 'One or two sentences to the admin: what you built and anything they should check' },
  },
  required: ['name', 'kind', 'stage', 'sections', 'questions', 'summary'],
} as const;
