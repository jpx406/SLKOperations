// Attendance (S17): the day codes from the user manual's legend, weekend and holiday shading,
// and the "on leave while assigned to a job" flag.

export const CODES = {
  P: 'Present', A: 'Absent', AL: 'Paid vacation', SL: 'Sick leave', UL: 'Unpaid leave', EL: 'Exam leave', PL: 'Paternity leave',
  HL: 'Hajj leave', MAL: 'Marriage leave', JBFS: 'Field bonus + food', JO: 'Field bonus without food', FA: 'Food allowance only',
  JBOF: 'Job bonus offshore + food + remote', TR: 'Training', JBOFS: 'Job bonus + food',
} as const;
export type Code = keyof typeof CODES;
export const CODE_LIST = Object.keys(CODES) as Code[];

/** Codes that mean the person is away; one of these on a day they are crewed on a job gets flagged. */
export const LEAVE: Code[] = ['A', 'AL', 'SL', 'UL', 'EL', 'PL', 'HL', 'MAL'];
/** Codes that carry a field payment (used in the summary column and later by the bonus report). */
export const FIELD: Code[] = ['JBFS', 'JO', 'FA', 'JBOF', 'JBOFS'];

export const isCode = (v: unknown): v is Code => typeof v === 'string' && v in CODES;

export function monthDays(month: string): string[] {
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** Friday and Saturday, the Saudi and Bahraini weekend. */
export const isWeekend = (day: string) => [5, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay());

export interface Assignment { employee_id: string; job_id: string; ticket_no: string | null; start_date: string; end_date: string | null }

/** Jobs a person is crewed on that cover the day. */
export const assignmentsOn = (list: Assignment[], employee: string, day: string) =>
  list.filter((a) => a.employee_id === employee && a.start_date <= day && (a.end_date ?? a.start_date) >= day);

export function rowSummary(codes: (Code | undefined)[]) {
  const c = codes.filter(Boolean) as Code[];
  return {
    present: c.filter((x) => x === 'P' || x === 'TR' || FIELD.includes(x)).length,
    field: c.filter((x) => FIELD.includes(x)).length,
    leave: c.filter((x) => LEAVE.includes(x)).length,
    blank: codes.length - c.length,
  };
}

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
