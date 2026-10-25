// Job Risk Assessment (S28). The template is data (jra_templates), so NESR can load its own form and revisions.
// The default below is a slickline starting point written for SLK Ops, not a copy of any NESR form.

export type Answer = 'yes' | 'no' | 'na';
export interface Question { id: string; section: string; text: string; risk_if: 'yes' | 'no'; points: number; required: boolean }
export interface ApprovalLevel { min: number; label: string }
export interface Template { code: string; revision: string; sections: Record<string, string>; questions: Question[]; approval_levels: ApprovalLevel[] }

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

/** Risk Index Score: points for every answer that matches the question's risk side. */
export function riskScore(t: Template, answers: Record<string, Answer>): number {
  return t.questions.reduce((s, x) => s + (answers[x.id] === x.risk_if ? x.points : 0), 0);
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
  const ids = new Set(t.questions.map((x) => x.id));
  const out: Record<string, Answer> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!ids.has(k)) return { error: `Unknown question ${k}` };
    if (v === null || v === '') continue;
    if (v !== 'yes' && v !== 'no' && v !== 'na') return { error: `${k}: answer Yes, No or N/A` };
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
