// Competency users (6z.35): who uses the Competency system and as what is set in SLK Ops Users & Roles, on the
// person's main SLK Ops user. The Competency role is separate from the SLK Ops role: the SLK Ops role decides which
// tabs of the app open, the Competency role decides what the person can see and do inside the Competency system
// (its role definitions, edited in Competency › Administration › Users & Roles). The profile also carries what the
// Competency employee register needs about the person, and is copied into that register when Competency opens.

export const COMPETENCY_POSITIONS = ['Trainee', 'Assistant Operator', 'Slickline Operator', 'Slickline Supervisor', 'Senior Supervisor', 'Field Specialist', 'Operator', 'FSM', 'SQC', 'Tech Manager', 'SME'] as const;
export const COMPETENCY_GRADES = [6, 7, 8, 9, 10, 11, 12] as const;
export const COMPETENCY_SEGMENTS = ['SLK', 'WL', 'UNC', 'CTU', 'DF'] as const;
export const COMPETENCY_STATUSES = ['Active', 'Inactive', 'Transferred', 'Resigned'] as const;
/** The Competency system's own roles when its dataset has not changed them; `edit` is whether the role may change data. */
export const DEFAULT_COMPETENCY_ROLES = [
  { name: 'Super Admin', edit: true }, { name: 'Admin', edit: true }, { name: 'Manager', edit: true },
  { name: 'Trainer', edit: true }, { name: 'Operator', edit: true }, { name: 'Viewer', edit: false },
] as const;
export type CompetencyRoleDef = { name: string; edit: boolean };

export interface CompetencyProfile {
  username: string;
  /** The role in the Competency system. */
  role: string;
  /** Whether that role may change Competency data (from its role definition when it was set). */
  can_edit: number;
  /** The record in the Competency employee register; blank means the same as the username. */
  employee_id: string | null;
  position: string | null; grade: number | null; segment: string; location: string | null; hire_date: string | null; mentor: string | null; status: string;
  updated_by?: string; updated_at?: string;
}

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** A profile as Users & Roles saves it, checked against the Competency roles in use. */
export function checkProfile(b: Record<string, unknown>, roles: readonly CompetencyRoleDef[]): { error: string } | { value: Omit<CompetencyProfile, 'username'> } {
  const role = str(b.role, 60);
  const def = roles.find((r) => r.name === role);
  if (!def) return { error: `Pick one of the Competency roles: ${roles.map((r) => r.name).join(', ')}` };
  const employee = str(b.employee_id, 40);
  if (employee && !/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(employee)) return { error: 'The employee record ID may use letters, numbers, - . / and spaces' };
  const position = str(b.position, 60);
  if (position && !(COMPETENCY_POSITIONS as readonly string[]).includes(position)) return { error: 'Pick a position from the list' };
  const grade = b.grade === '' || b.grade === null || b.grade === undefined ? null : Number(b.grade);
  if (grade !== null && !(COMPETENCY_GRADES as readonly number[]).includes(grade)) return { error: 'The grade is 6 to 12' };
  const segment = str(b.segment, 10) || 'SLK';
  if (!(COMPETENCY_SEGMENTS as readonly string[]).includes(segment)) return { error: 'Pick a segment from the list' };
  const status = str(b.status, 20) || 'Active';
  if (!(COMPETENCY_STATUSES as readonly string[]).includes(status)) return { error: 'Pick a status from the list' };
  const hire = str(b.hire_date, 10);
  if (hire && !/^\d{4}-\d{2}-\d{2}$/.test(hire)) return { error: 'The hire date must be a date' };
  return {
    value: {
      role, can_edit: def.edit ? 1 : 0, employee_id: employee || null, position: position || null, grade, segment,
      location: str(b.location, 60) || null, hire_date: hire || null, mentor: str(b.mentor, 40) || null, status,
    },
  };
}

/** The Competency roles from the saved dataset's role definitions, else the defaults. */
export function rolesFromDataset(json: string | null): CompetencyRoleDef[] {
  try {
    const defs = json ? (JSON.parse(json) as { roleDefs?: { name?: unknown; edit?: unknown }[] }).roleDefs : null;
    const out = (defs ?? []).filter((r) => typeof r?.name === 'string' && r.name).map((r) => ({ name: String(r.name), edit: !!r.edit }));
    if (out.length) return out;
  } catch { /* a dataset that doesn't read keeps the defaults */ }
  return DEFAULT_COMPETENCY_ROLES.map((r) => ({ ...r }));
}

// ---- Excel download and upload (6z.36) ---------------------------------------------------------------------------
// One row per person. Employee ID is the person's SLK Ops username (their WIREGUARD employee number, e.g. NESR-12345)
// and is the key: a row for someone already set up updates them, never adds a second profile; the same Employee ID
// twice in one file keeps the first row; an Employee ID that is not a SLK Ops user is left out with the reason.

export const COMPETENCY_SHEET_HEADER = ['Employee ID', 'Name', 'Competency role', 'Employee record', 'Position', 'Grade', 'Segment', 'Location', 'Hire date', 'Mentor', 'Status'] as const;
export const COMPETENCY_SHEET_WIDTHS = [16, 26, 16, 16, 22, 8, 9, 12, 12, 14, 11];

export interface SheetProfileRow { row: number; id: string; values: Record<string, unknown> }

const cellText = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
/** An Excel date (a serial number) or a typed one (2024-03-01, 01/03/2024) as YYYY-MM-DD; '' when blank or unreadable. */
export function sheetDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^\d+(\.\d+)?$/.test(s) ? sheetDate(Number(s)) : s;
}

/** The rows of an uploaded sheet (row 1 the header, found by name so columns can be in any order). */
export function profileRowsFromSheet(aoa: unknown[][]): { rows: SheetProfileRow[] } | { error: string } {
  const head = (aoa[0] ?? []).map((h) => cellText(h).toLowerCase());
  const col = (name: string) => head.indexOf(name.toLowerCase());
  if (col('Employee ID') < 0) return { error: 'The first row must have the column names, with an Employee ID column. Download the Excel file to see them.' };
  const rows: SheetProfileRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const get = (name: string) => { const c = col(name); return c < 0 ? undefined : r[c]; };
    const id = cellText(get('Employee ID'));
    if (!id && !r.some((x) => cellText(x))) continue;
    const grade = cellText(get('Grade')).replace(/^G/i, '');
    rows.push({
      row: i + 1, id,
      values: {
        role: cellText(get('Competency role')), employee_id: cellText(get('Employee record')), position: cellText(get('Position')),
        grade: grade === '' ? null : Number(grade), segment: cellText(get('Segment')) || 'SLK', location: cellText(get('Location')),
        hire_date: sheetDate(get('Hire date')), mentor: cellText(get('Mentor')), status: cellText(get('Status')) || 'Active',
      },
    });
  }
  return { rows };
}

export interface ImportPlan {
  add: { row: number; username: string; value: Omit<CompetencyProfile, 'username'> }[];
  update: { row: number; username: string; value: Omit<CompetencyProfile, 'username'> }[];
  skip: { row: number; id: string; reason: string }[];
}

/**
 * What an upload would do. `users` are the SLK Ops usernames; `existing` the people already set up (matched on their
 * username or their employee record, case aside). Nothing here writes.
 */
export function planImport(rows: SheetProfileRow[], users: string[], existing: Pick<CompetencyProfile, 'username' | 'employee_id'>[], roles: readonly CompetencyRoleDef[]): ImportPlan {
  const plan: ImportPlan = { add: [], update: [], skip: [] };
  const userOf = new Map(users.map((u) => [u.toLowerCase(), u]));
  const setUp = new Map<string, string>();
  for (const e of existing) { setUp.set(e.username.toLowerCase(), e.username); if (e.employee_id) setUp.set(e.employee_id.toLowerCase(), e.username); }
  const seen = new Set<string>();
  for (const r of rows) {
    const key = r.id.toLowerCase();
    if (!r.id) { plan.skip.push({ row: r.row, id: '', reason: 'No Employee ID' }); continue; }
    if (seen.has(key)) { plan.skip.push({ row: r.row, id: r.id, reason: 'Same Employee ID as an earlier row: the first one is kept' }); continue; }
    seen.add(key);
    const already = setUp.get(key);
    const username = already ?? userOf.get(key);
    if (!username) { plan.skip.push({ row: r.row, id: r.id, reason: 'Not a SLK Ops user: add them in People first' }); continue; }
    const v = checkProfile(r.values as Record<string, unknown>, roles);
    if ('error' in v) { plan.skip.push({ row: r.row, id: r.id, reason: v.error }); continue; }
    (already ? plan.update : plan.add).push({ row: r.row, username, value: v.value });
  }
  return plan;
}
