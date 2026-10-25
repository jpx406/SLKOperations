// 8 Min. Facts (S11, S12): severity from NPT, report checks, and the reference matrix shown in the editor.
// The same NPT bands are a generated column on `incidents`, so the database and the screen can't disagree.

export const SEVERITIES = ['negligible', 'light', 'serious', 'major', 'catastrophic'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABEL: Record<Severity, string> = {
  negligible: 'Negligible', light: 'Light', serious: 'Serious', major: 'Major', catastrophic: 'Catastrophic',
};

/** Severity reference (screen only): NPT band and what it usually means on a slickline job. */
export const SEVERITY_MATRIX: { severity: Severity; band: string; meaning: string }[] = [
  { severity: 'negligible', band: 'No NPT', meaning: 'Event recorded for learning, operation not delayed' },
  { severity: 'light', band: 'Under 4 h', meaning: 'Short delay, fixed on site with the crew and tools at hand' },
  { severity: 'serious', band: '4 to 24 h', meaning: 'Run repeated or equipment changed out, client informed' },
  { severity: 'major', band: '24 to 48 h', meaning: 'Fishing or replacement equipment mobilised' },
  { severity: 'catastrophic', band: 'Over 48 h', meaning: 'Well or asset impact, lost-in-hole, or HSE consequence' },
];

export function severityFromNpt(npt: number): Severity {
  if (!(npt > 0)) return 'negligible';
  if (npt < 4) return 'light';
  if (npt <= 24) return 'serious';
  if (npt <= 48) return 'major';
  return 'catastrophic';
}

export const worstSeverity = (list: Severity[]): Severity =>
  list.reduce<Severity>((w, s) => (SEVERITIES.indexOf(s) > SEVERITIES.indexOf(w) ? s : w), 'negligible');

export interface IncidentInput {
  id?: string; what_happened: string; occurred_on: string; occurred_time?: string | null; npt_hours: number;
  failed_items: string[]; immediate_actions?: string | null; current_situation?: string | null;
  informed_client?: string | null; informed_nesr?: string | null; category?: string | null;
}
export interface ReportInput { job_id: string; title: string; rilr_no?: string | null; crew_text?: string | null; incidents: IncidentInput[] }

const str = (v: unknown, max: number) => (v === null || v === undefined ? '' : String(v)).trim().slice(0, max);
const opt = (v: unknown, max: number) => str(v, max) || null;

/** Cleans a report from the editor. Returns the cleaned report or the first problem, phrased for the person typing. */
export function cleanReport(b: unknown): { report: ReportInput } | { error: string } {
  const r = (b ?? {}) as Record<string, unknown>;
  const job_id = str(r.job_id, 64);
  if (!job_id) return { error: 'Pick the job (field ticket) first' };
  const title = str(r.title, 200);
  if (!title) return { error: 'Give the report a title' };
  if (!Array.isArray(r.incidents) || !r.incidents.length) return { error: 'Add at least one incident' };
  if (r.incidents.length > 20) return { error: 'A report holds at most 20 incidents' };
  const incidents: IncidentInput[] = [];
  for (const [i, raw] of (r.incidents as Record<string, unknown>[]).entries()) {
    const n = i + 1;
    const what = str(raw?.what_happened, 4000);
    if (!what) return { error: `Incident ${n}: say what happened` };
    const on = str(raw.occurred_on, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || Number.isNaN(Date.parse(on))) return { error: `Incident ${n}: pick the date` };
    const time = opt(raw.occurred_time, 5);
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: `Incident ${n}: time must be HH:MM` };
    const npt = raw.npt_hours === '' || raw.npt_hours == null ? 0 : Number(raw.npt_hours);
    if (!Number.isFinite(npt) || npt < 0 || npt > 2000) return { error: `Incident ${n}: NPT must be 0 hours or more` };
    const items = Array.isArray(raw.failed_items) ? (raw.failed_items as unknown[]).map((x) => str(x, 200)).filter(Boolean).slice(0, 20) : [];
    incidents.push({
      id: opt(raw.id, 64) ?? undefined, what_happened: what, occurred_on: on, occurred_time: time, npt_hours: Math.round(npt * 100) / 100,
      failed_items: items, immediate_actions: opt(raw.immediate_actions, 4000), current_situation: opt(raw.current_situation, 4000),
      informed_client: opt(raw.informed_client, 300), informed_nesr: opt(raw.informed_nesr, 300), category: opt(raw.category, 80),
    });
  }
  return { report: { job_id, title, rilr_no: opt(r.rilr_no, 60), crew_text: opt(r.crew_text, 1000), incidents } };
}

export const reportTotals = (incidents: { npt_hours: number }[]) => {
  const npt = Math.round(incidents.reduce((a, i) => a + (Number(i.npt_hours) || 0), 0) * 100) / 100;
  return { npt, severity: worstSeverity(incidents.map((i) => severityFromNpt(Number(i.npt_hours) || 0))) };
};

/** Next log number per country: EM-0001, EM-0002 … */
export const nextLogNo = (last: string | null) => `EM-${String((Number(last?.match(/(\d+)$/)?.[1] ?? 0) || 0) + 1).padStart(4, '0')}`;
