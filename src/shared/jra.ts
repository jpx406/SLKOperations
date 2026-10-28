// Job Risk Assessment (S28). The template is data (jra_templates), so NESR can load its own form and revisions.
// The default below is a slickline starting point written for SLK Ops, not a copy of any NESR form.

export type Answer = 'yes' | 'no' | 'na';
/** A requirement or approver that applies when the answer is one of `when` (from the form's formulas). */
export interface Conditional { text: string; when: Answer[] }
export interface Question {
  id: string; section: string; text: string; risk_if: 'yes' | 'no'; points: number; required: boolean;
  /** Loaded from NESR's form: the answers offered, the points each one scores, and what each one triggers. */
  options?: Answer[]; scores?: Partial<Record<Answer, number>>; requirement?: Conditional; approver?: Conditional; guidance?: string;
  /** Job package items only: the item is needed only when the job has this (see forms.ts APPLIES_IF). */
  applies_if?: string;
}
export interface ApprovalLevel { min: number; label: string }
export interface Template {
  code: string; revision: string; sections: Record<string, string>; questions: Question[]; approval_levels: ApprovalLevel[];
  title?: string; notes?: string[];
  /** Points added to the score for each "Exemption Required" (the form's COUNTIF × N). */
  exemption_points?: number;
}

const q = (id: string, text: string, risk_if: 'yes' | 'no', points: number, required = true): Question => ({ id, section: id[0], text, risk_if, points, required });

export const DEFAULT_TEMPLATE: Template = {
  code: 'SLK-JRA',
  revision: '1',
  sections: { A: 'Design and preparation', B: 'Well conditions', C: 'Equipment and pressure control', D: 'Crew and site', E: 'Special operations' },
  questions: [
    q('A1', 'Is a written job program approved and on site?', 'no', 3),
    q('A2', 'Has the well history (previous runs, restrictions, fish) been reviewed?', 'no', 3),
    q('A3', 'Is the toolstring clearance checked against the minimum restriction?', 'no', 3),
    q('A4', 'Is this a first-time operation for this well or client?', 'yes', 2),
    q('A5', 'Has the wire passed its pre-job wrap/torsion and tension tests?', 'no', 4),
    q('A6', 'Is the job planned for night operations?', 'yes', 2),
    q('B1', 'Is H₂S expected in the well?', 'yes', 5),
    q('B2', 'Is the shut-in wellhead pressure above 5,000 psi?', 'yes', 4),
    q('B3', 'Is the well deviated beyond 60°?', 'yes', 3),
    q('B4', 'Is bottom-hole temperature above 300 °F?', 'yes', 2),
    q('B5', 'Are scale, wax, hydrates or sand expected?', 'yes', 2),
    q('B6', 'Is the well live and flowing during the operation?', 'yes', 3),
    q('C1', 'Is the pressure control equipment rated above the maximum expected wellhead pressure?', 'no', 5),
    q('C2', 'Has the PCE passed a documented pressure test within its validity?', 'no', 4),
    q('C3', 'Is the lubricator long enough for the full toolstring?', 'no', 3),
    q('C4', 'Is the unit due or overdue for maintenance?', 'yes', 2),
    q('C5', 'Are certified lifting gear and a crane available as required?', 'no', 2),
    q('C6', 'Is a grease injection system needed and fully functional (braided line)?', 'no', 2, false),
    q('D1', 'Does the crew include a supervisor competent for this service?', 'no', 4),
    q('D2', 'Have all crew members had adequate rest before the shift?', 'no', 3),
    q('D3', 'Is any crew member new to the site or the service?', 'yes', 1),
    q('D4', 'Is simultaneous operation (SIMOPS) planned with other contractors?', 'yes', 3),
    q('D5', 'Have permits to work and isolations been agreed with the client?', 'no', 4),
    q('D6', 'Are emergency response and H₂S escape routes briefed?', 'no', 3),
    q('E1', 'Will explosives (power charges, punch or cutter charges) be used?', 'yes', 5),
    q('E2', 'Will a plug or lock be set or retrieved under pressure?', 'yes', 2),
    q('E3', 'Is fishing of a lost toolstring or wire planned?', 'yes', 3),
    q('E4', 'Is radio silence or an exclusion zone needed and agreed?', 'no', 3, false),
    q('E5', 'Is any non-standard or modified tool being run?', 'yes', 3),
  ],
  approval_levels: [{ min: 0, label: 'SDM' }, { min: 20, label: 'Operations Manager' }, { min: 35, label: 'Country Manager' }],
};

export const ANSWER_LABEL: Record<Answer, string> = { yes: 'Yes', no: 'No', na: 'N/A' };
export const optionsOf = (x: Question): Answer[] => x.options ?? ['yes', 'no', 'na'];

/** Points one answer scores: from the form's per-answer points when loaded, else the risk side. */
export function pointsFor(x: Question, a: Answer | undefined): number {
  if (!a) return 0;
  if (x.scores) return x.scores[a] ?? 0;
  return a === x.risk_if ? x.points : 0;
}

/** Answers that trigger a requirement (MOC or exemption) or a named approver. */
export function flags(t: Template, answers: Record<string, Answer>) {
  return t.questions.flatMap((x) => {
    const a = answers[x.id];
    if (!a) return [];
    const requirement = x.requirement?.when.includes(a) ? x.requirement.text : null;
    const approver = x.approver?.when.includes(a) ? x.approver.text : null;
    return requirement || approver ? [{ id: x.id, requirement, approver }] : [];
  });
}

export const exemptions = (t: Template, answers: Record<string, Answer>) => flags(t, answers).filter((f) => f.requirement && /exemption/i.test(f.requirement)).length;

/** Risk Index Score: points of every answer, plus the form's points per exemption. */
export function riskScore(t: Template, answers: Record<string, Answer>): number {
  return t.questions.reduce((s, x) => s + pointsFor(x, answers[x.id]), 0) + exemptions(t, answers) * (t.exemption_points ?? 0);
}

export function approvalLevel(t: Template, score: number): string {
  return [...t.approval_levels].sort((a, b) => b.min - a.min).find((l) => score >= l.min)?.label ?? t.approval_levels[0]?.label ?? 'SDM';
}

export function progress(t: Template, answers: Record<string, Answer>) {
  const required = t.questions.filter((x) => x.required);
  const missing = required.filter((x) => !answers[x.id]).map((x) => x.id);
  return { answered: t.questions.filter((x) => answers[x.id]).length, total: t.questions.length, missing };
}

export function cleanAnswers(t: Template, input: unknown): Record<string, Answer> | { error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Answers must be a set of question ids' };
  const byId = new Map(t.questions.map((x) => [x.id, x]));
  const out: Record<string, Answer> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const x = byId.get(k);
    if (!x) return { error: `Unknown question ${k}` };
    if (v === null || v === '') continue;
    if (v !== 'yes' && v !== 'no' && v !== 'na') return { error: `${k}: answer Yes, No or N/A` };
    if (!optionsOf(x).includes(v)) return { error: `${k}: ${ANSWER_LABEL[v]} isn’t an answer this form offers` };
    out[k] = v;
  }
  return out;
}

/** A JRA is needed (and Execution waits for its approval) on jobs with these risks. */
export function jraReasons(job: { h2s_ppm?: number | null; siwhp_psi?: number | null; special_setup?: string | null }, explosiveService: boolean): string[] {
  const r: string[] = [];
  if (explosiveService) r.push('an explosive service');
  if ((job.h2s_ppm ?? 0) > 0) r.push('H₂S');
  if ((job.siwhp_psi ?? 0) >= 5000) r.push('wellhead pressure of 5,000 psi or more');
  if (job.special_setup === 'yes') r.push('a special setup');
  return r;
}
