// Sales dashboard → Activity sheet and Daily report (owner request 2026-10-28). They replace two Excel workbooks:
// "NESR Activity Sheet" (one billing line per job, one tab per account, each tab with its own columns) and
// "Daily Report" (one line per unit per day, plus upcoming operations and counts). Both use one catalogue of fields
// here, so every account shares the same format: the columns common to all accounts, plus the few that only some
// accounts track (highlighted on screen, and hidden when no line shown needs them).
//
// A field's value comes from one of three places:
//   app   - the job (or unit) in SLK Ops; read-only here, corrected in the job itself
//   sheet - typed on the sheet, the things the app has no column for (DMR status, ticket follow-up dates ...)
//   both  - suggested from the app, and can be overridden on the sheet (revenue month, a unit's daily status ...)
// and calc fields are worked out from the others (total time, net revenue ...).
// A checked line is locked: its values are frozen as a snapshot, so a later change to the job cannot silently
// change a line someone already reviewed. Only an Admin unlocks.

export type FieldType = 'text' | 'longtext' | 'date' | 'datetime' | 'number' | 'money' | 'yesno' | 'choice' | 'month';
export type Source = 'app' | 'sheet' | 'both' | 'calc';

export interface SheetField {
  key: string;
  label: string;
  group: string;
  source: Source;
  type: FieldType;
  choices?: readonly string[];
  /** Only these account formats use the field; none means every account. */
  formats?: readonly FormatKey[];
  /** Daily report: a typed value carries over to the next days until changed. */
  carry?: boolean;
  /** Where to fix an app value in the job (the job stage). */
  stage?: 'design' | 'preparation' | 'execution' | 'closure' | 'crew';
  hint?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Account formats: which extra columns an account's sheet has, and its own ticket statuses. An account picks its
// format by name (SAWCOD → SAWCOD) and Sales can change it on the sheet.

export const FORMATS = {
  standard: { label: 'Standard', match: null as RegExp | null, ticketStatuses: ['Send for Sign', 'Submit to finance', 'Submitted to Finance'] },
  sawcod: { label: 'SAWCOD (Site-less)', match: /sawcod|swacod/i, ticketStatuses: ['Send for Sign', 'Submit to finance'] },
  nawcod: { label: 'NAWCOD (Site-less)', match: /nawco/i, ticketStatuses: ['Send for Sign', 'Submit to finance'] },
  razor: { label: 'RAZOR', match: /razor/i, ticketStatuses: ['Non Dilip', 'Non Dilip-Submitted', 'Revised', 'Accepted', 'Job logging', 'Joblog Submitted', 'E-Ticket submitted', 'No Drss', 'Not submitted in Portal'] },
  dwo: { label: 'D&W Operations', match: /d\s*&\s*w|d\s*&\s*wo|drill|workover/i, ticketStatuses: ['Non Dilip', 'Non Dilip-Submitted', 'Revised', 'Accepted', 'Job logging', 'Joblog Submitted', 'E-Ticket submitted', 'UR NEXUS', 'No Drss', 'Not submitted in Portal'] },
  unc: { label: 'UNC (Unconventional)', match: /unc|unconv|frac/i, ticketStatuses: ['Pending Sign', 'Pending DLTS', 'Pending Sign / DLTS', 'Sent for Certification', 'CERTIFIED', 'Submitted to Finance', 'SENT TO WT'] },
  lstk: { label: 'LSTK', match: /lstk/i, ticketStatuses: ['Need to sign all documents', 'Need DRSS', 'Waiting for DRSS', 'Ticket to be signed from location', 'Will submit soon', 'Submitted'] },
  wireline: { label: 'Wireline & FRAC-LSTK OOS', match: /wireline|\bwl\b|oos/i, ticketStatuses: ['Need to sign all documents', 'Need to sign FST and DRSS', 'Need DRSS', 'Waiting for DRSS', 'Ticket to be signed from location', 'Will submit soon', 'Submitted'] },
} as const;
export type FormatKey = keyof typeof FORMATS;
export const FORMAT_KEYS = Object.keys(FORMATS) as FormatKey[];

/** The format an account uses: the one Sales picked, else the first whose name matches, else Standard. */
export function formatOf(account: string | null | undefined, picked?: Record<string, string>): FormatKey {
  const a = (account ?? '').trim();
  const p = picked?.[a];
  if (p && p in FORMATS) return p as FormatKey;
  // D&WO before UNC: "D&WO UNC" is a D&W contract
  for (const k of ['dwo', 'razor', 'sawcod', 'nawcod', 'lstk', 'wireline', 'unc'] as FormatKey[]) if (FORMATS[k].match?.test(a)) return k;
  return 'standard';
}

const YES_NO = ['Yes', 'No', 'N/A'] as const;
const ALL_TICKET_STATUSES = [...new Set(Object.values(FORMATS).flatMap((f) => f.ticketStatuses))];

// ---------------------------------------------------------------------------------------------------------------
// Activity sheet: one line per job

export const ACTIVITY_GROUPS = [
  { key: 'job', label: 'Job', hint: 'Account, rig, well, service and unit' },
  { key: 'crew', label: 'Crew', hint: 'Supervisors and operators on the job' },
  { key: 'dates', label: 'Dates', hint: 'Call-out to demobilisation' },
  { key: 'hours', label: 'Hours & distance', hint: 'Operating, NPT and stand-by time, man-hours and kilometres' },
  { key: 'docs', label: 'Ticket & documents', hint: 'FST, DRSS, DMR, service order and ticket status' },
  { key: 'follow', label: 'Ticket follow-up', hint: 'When the ticket went to the client and to Finance' },
  { key: 'revenue', label: 'Revenue', hint: 'Gross, partially billed and net' },
  { key: 'account', label: 'Account details', hint: 'Columns only some accounts keep' },
  { key: 'notes', label: 'Comments', hint: 'Notes for this line' },
] as const;

export const ACTIVITY_FIELDS: SheetField[] = [
  { key: 'revenue_month', label: 'Revenue month', group: 'job', source: 'both', type: 'month', hint: 'From the job’s end date; change it when the ticket is billed in another month' },
  { key: 'account', label: 'Account', group: 'job', source: 'app', type: 'text', stage: 'design' },
  { key: 'entity', label: 'Company', group: 'job', source: 'app', type: 'text', stage: 'design', hint: 'NESR, SAPESCO … from the job’s Design' },
  { key: 'field_rig', label: 'Field / rig', group: 'job', source: 'app', type: 'text', stage: 'design' },
  { key: 'well', label: 'Well', group: 'job', source: 'app', type: 'text', stage: 'design' },
  { key: 'job_type', label: 'Job type', group: 'job', source: 'app', type: 'text', stage: 'design' },
  { key: 'job_status', label: 'Job status', group: 'job', source: 'app', type: 'text', stage: 'design' },
  { key: 'unit', label: 'Unit', group: 'job', source: 'app', type: 'text', stage: 'design' },
  { key: 'well_type', label: 'Well type', group: 'job', source: 'app', type: 'text', stage: 'preparation' },

  { key: 'supervisor', label: 'Supervisor', group: 'crew', source: 'app', type: 'text', stage: 'crew' },
  { key: 'supervisor_2', label: 'Supervisor 2', group: 'crew', source: 'app', type: 'text', stage: 'crew' },
  { key: 'operators', label: 'Operators', group: 'crew', source: 'app', type: 'text', stage: 'crew' },

  { key: 'callout_on', label: 'Call-out received', group: 'dates', source: 'sheet', type: 'date' },
  { key: 'booking_on', label: 'Booking', group: 'dates', source: 'sheet', type: 'date' },
  { key: 'planned_mob_on', label: 'Planned mob', group: 'dates', source: 'app', type: 'date', stage: 'design', hint: 'The job’s start date' },
  { key: 'mob_on', label: 'Mob', group: 'dates', source: 'sheet', type: 'date' },
  { key: 'arrived_at', label: 'Arrived on location', group: 'dates', source: 'app', type: 'datetime', stage: 'execution' },
  { key: 'started_at', label: 'Job start', group: 'dates', source: 'app', type: 'datetime', stage: 'execution', hint: 'Rig-up, else the start date' },
  { key: 'finished_at', label: 'Job finished', group: 'dates', source: 'app', type: 'datetime', stage: 'execution', hint: 'Rig-down, else the end date' },
  { key: 'demob_on', label: 'Demob', group: 'dates', source: 'sheet', type: 'date' },

  { key: 'op_hours', label: 'Oper. time (h)', group: 'hours', source: 'app', type: 'number', stage: 'execution' },
  { key: 'npt_hours', label: 'NPT (h)', group: 'hours', source: 'app', type: 'number', stage: 'execution' },
  { key: 'standby_hours', label: 'Stand-by (h)', group: 'hours', source: 'sheet', type: 'number' },
  { key: 'total_hours', label: 'Total time (h)', group: 'hours', source: 'calc', type: 'number', hint: 'Oper. time + stand-by' },
  { key: 'man_hours', label: 'Man-hours', group: 'hours', source: 'app', type: 'number', stage: 'closure', hint: 'Operating hours × people assigned, or the SDM’s figure on Closure' },
  { key: 'km', label: 'KM to location', group: 'hours', source: 'app', type: 'number', stage: 'execution' },
  { key: 'travel_km', label: 'Travel km', group: 'hours', source: 'app', type: 'number', stage: 'closure', hint: 'KM to location × 2, or the SDM’s figure on Closure' },

  { key: 'fst_no', label: 'FST #', group: 'docs', source: 'app', type: 'text', stage: 'design', hint: 'The job’s field ticket' },
  { key: 'drss_no', label: 'DRSS / DLTS', group: 'docs', source: 'app', type: 'text', stage: 'design' },
  { key: 'dmr_no', label: 'DMR', group: 'docs', source: 'app', type: 'text', stage: 'design' },
  { key: 'dmr_status', label: 'DMR status', group: 'docs', source: 'sheet', type: 'choice', choices: ['Planned', 'Completed', 'Approved', 'N/A'] },
  { key: 'service_order_no', label: 'Service order #', group: 'docs', source: 'app', type: 'text', stage: 'closure' },
  { key: 'ticket_created', label: 'Ticket created', group: 'docs', source: 'sheet', type: 'yesno', choices: YES_NO },
  { key: 'ticket_signed', label: 'Ticket signed', group: 'docs', source: 'app', type: 'text', stage: 'closure' },
  { key: 'docs_sent_for_sign', label: 'Documents sent for sign', group: 'docs', source: 'sheet', type: 'yesno', choices: YES_NO, formats: ['nawcod'] },
  { key: 'ticket_status', label: 'Ticket status', group: 'docs', source: 'sheet', type: 'choice', choices: ALL_TICKET_STATUSES },
  { key: 'ticket_status_on', label: 'Ticket status date', group: 'docs', source: 'sheet', type: 'date' },

  { key: 'client_submitted_on', label: 'Ticket to client', group: 'follow', source: 'sheet', type: 'date', formats: ['sawcod'], hint: 'Submitting ticket date to Aramco' },
  { key: 'sv_received_on', label: 'S.V. received', group: 'follow', source: 'sheet', type: 'date', formats: ['sawcod'], hint: 'Receiving ticket date from Aramco' },
  { key: 'base_received_on', label: 'Received in base', group: 'follow', source: 'sheet', type: 'date', formats: ['sawcod'] },
  { key: 'finance_submitted_on', label: 'Ticket to Finance', group: 'follow', source: 'sheet', type: 'date', formats: ['sawcod'] },
  { key: 'ticket_updated_on', label: 'Ticket update', group: 'follow', source: 'sheet', type: 'date', formats: ['sawcod'] },

  { key: 'charges_type', label: 'Charges type', group: 'revenue', source: 'sheet', type: 'choice', choices: ['CALL-OUT Charge', 'X-charge WL', 'X-charge FRAC', 'In scope'], formats: ['wireline'] },
  { key: 'gross', label: 'Gross revenue', group: 'revenue', source: 'app', type: 'money', stage: 'closure', hint: 'The ticket value on the job’s Closure' },
  { key: 'partial', label: 'Partially billed', group: 'revenue', source: 'sheet', type: 'money', hint: 'Already billed in an earlier month' },
  { key: 'net', label: 'Net revenue', group: 'revenue', source: 'calc', type: 'money', hint: 'Gross − partially billed' },
  { key: 'currency', label: 'Currency', group: 'revenue', source: 'app', type: 'text', stage: 'closure' },

  { key: 'client_unit', label: 'Client unit name', group: 'account', source: 'sheet', type: 'text', formats: ['sawcod', 'nawcod'], hint: 'Aramco unit name' },
  { key: 'org_code', label: 'Org code', group: 'account', source: 'sheet', type: 'text', formats: ['sawcod'] },
  { key: 'land_offshore', label: 'Land / offshore', group: 'account', source: 'sheet', type: 'choice', choices: ['Land', 'Offshore'], formats: ['razor', 'dwo'] },
  { key: 'rig_assigned', label: 'Rig assigned', group: 'account', source: 'sheet', type: 'choice', choices: ['Assigned', 'Non-assigned'], formats: ['razor', 'dwo'] },
  { key: 'unit_type', label: 'Unit type', group: 'account', source: 'sheet', type: 'choice', choices: ['DD', 'HD'], formats: ['dwo', 'unc'] },
  { key: 'pce', label: 'PCE', group: 'account', source: 'app', type: 'text', stage: 'preparation', formats: ['dwo'] },
  { key: 'max_deviation', label: 'Max well deviation (°)', group: 'account', source: 'app', type: 'number', stage: 'preparation', formats: ['razor', 'dwo', 'unc'] },
  { key: 'site_assign', label: 'Site assign', group: 'account', source: 'sheet', type: 'text', formats: ['unc'], hint: 'JAF, OOS, deliverability test …' },
  { key: 'campaign_type', label: 'Campaign type', group: 'account', source: 'sheet', type: 'choice', choices: ['WL-CALL OUT', 'LSTK FRAC', 'WL - KHRS Campaign', 'WL - CGG Campaign'], formats: ['wireline'] },
  { key: 'site_name', label: 'Site name', group: 'account', source: 'sheet', type: 'text', formats: ['lstk', 'wireline'] },
  { key: 'pr_plug_serial', label: 'PR plug serial #', group: 'account', source: 'sheet', type: 'text', formats: ['lstk', 'wireline'] },
  { key: 'crews', label: 'Crews', group: 'account', source: 'sheet', type: 'choice', choices: ['1 crew', '2 crews'], formats: ['lstk', 'wireline'] },

  { key: 'comments', label: 'Comments', group: 'notes', source: 'sheet', type: 'longtext' },
];

// ---------------------------------------------------------------------------------------------------------------
// Daily report: one line per unit per day

/** The unit statuses of the daily report, and the utilisation code each one counts as. */
export const DAILY_STATUSES = [
  { status: 'On-going', utilization: 'Others', operating: true },
  { status: 'Booked', utilization: 'Availb. Relocat.', operating: true },
  { status: 'Mob.', utilization: 'Others', operating: true },
  { status: 'Demob.', utilization: 'Others', operating: true },
  { status: 'Stand-by', utilization: 'Others', operating: true },
  { status: 'Base - Available', utilization: 'Base', operating: false },
  { status: 'Preventive < 2 days', utilization: 'Preventive M', operating: false },
  { status: 'Repair 3~5 days', utilization: 'Repairs', operating: false },
  { status: 'Major Repairs > 6 days', utilization: 'Major Repairs', operating: false },
  { status: 'Transfer / on loan', utilization: 'Transfer-out', operating: false },
  { status: 'Others', utilization: 'Others', operating: false },
] as const;
export const LOCATION_TYPES = ['Land Rig', 'Off-shore Rig', 'Site', 'Rigless', 'Base', 'Transfer/On Loan'] as const;
export const DAILY_CLIENTS = ['NESR D&WO', 'SAPESCO D&WO', 'NESR Offshore', 'SAPESCO Offshore', 'FRAC CONV', 'FRAC UNC', 'Out of Scope', 'BAPCO', 'SAWCOD (RIGLESS)', 'NAWCOD (Rigless)', 'KJO - ADC'] as const;

export const DAILY_GROUPS = [
  { key: 'assignment', label: 'Assignment', hint: 'Status, client, rig or site, well and activity' },
  { key: 'people', label: 'People', hint: 'Supervisor on the unit' },
  { key: 'equipment', label: 'Equipment', hint: 'Unit type and PCE' },
  { key: 'well', label: 'Well & location', hint: 'Well type, location type, utilisation and entity' },
  { key: 'notes', label: 'Remarks', hint: 'Notes for the day' },
] as const;

export const DAILY_FIELDS: SheetField[] = [
  { key: 'status', label: 'Status', group: 'assignment', source: 'both', type: 'choice', choices: DAILY_STATUSES.map((s) => s.status), hint: 'From the unit’s job or maintenance that day; change it for booked, stand-by …' },
  { key: 'client', label: 'Client', group: 'assignment', source: 'both', type: 'choice', choices: DAILY_CLIENTS, carry: true, hint: 'From the job’s account; pick the client line it counts under' },
  { key: 'account', label: 'Account', group: 'assignment', source: 'app', type: 'text', stage: 'design' },
  { key: 'rig_site', label: 'Rig / site / location', group: 'assignment', source: 'app', type: 'text', stage: 'design' },
  { key: 'well', label: 'Well', group: 'assignment', source: 'app', type: 'text', stage: 'design' },
  { key: 'activity', label: 'Activity', group: 'assignment', source: 'app', type: 'text', stage: 'design' },

  { key: 'supervisor', label: 'Supervisor', group: 'people', source: 'app', type: 'text', stage: 'crew' },
  { key: 'operators', label: 'Operators', group: 'people', source: 'app', type: 'text', stage: 'crew' },

  { key: 'unit_type', label: 'Unit type', group: 'equipment', source: 'sheet', type: 'choice', choices: ['LANDLINE', 'SLIMLINE', 'SKID', 'TRUCK'], carry: true },
  { key: 'pce', label: 'PCE', group: 'equipment', source: 'both', type: 'text', carry: true, hint: 'From the job’s PCE; type the full set if needed' },

  { key: 'well_type', label: 'Well type', group: 'well', source: 'both', type: 'choice', choices: ['Oil', 'Gas', 'Water', 'Injector', 'N/A'] },
  { key: 'location_type', label: 'Location type', group: 'well', source: 'sheet', type: 'choice', choices: LOCATION_TYPES, carry: true },
  { key: 'utilization', label: 'Utilisation', group: 'well', source: 'calc', type: 'text', hint: 'From the status' },
  { key: 'entity', label: 'Entity', group: 'well', source: 'both', type: 'choice', choices: ['N', 'S', 'BH'], carry: true, hint: 'N NESR, S SAPESCO, BH Bahrain; suggested from the job’s company' },

  { key: 'remarks', label: 'Remarks', group: 'notes', source: 'sheet', type: 'longtext' },
];

// ---------------------------------------------------------------------------------------------------------------
// Values

export type Value = string | number | null;
export type Values = Record<string, Value>;

export interface SheetLine {
  /** The job (activity) or unit (daily) the line is for. */
  id: string;
  job_id: string | null;
  account: string | null;
  format: FormatKey;
  app: Values;
  data: Values;
  locked: { by: string; name: string | null; at: string } | null;
  snapshot: Values | null;
}

const num = (v: Value) => (v === null || v === '' || v === undefined ? null : Number(v));

/** A field's live value on a line (before any lock). */
export function liveValue(f: SheetField, line: Pick<SheetLine, 'app' | 'data'>, all: SheetField[]): Value {
  const typed = line.data[f.key];
  if (f.source === 'app') return line.app[f.key] ?? null;
  if (f.source === 'sheet') return typed ?? null;
  if (f.source === 'both') return typed !== undefined && typed !== null && typed !== '' ? typed : line.app[f.key] ?? null;
  const get = (k: string) => { const g = all.find((x) => x.key === k); return g ? liveValue(g, line, all) : null; };
  switch (f.key) {
    case 'total_hours': { const o = num(get('op_hours')), s = num(get('standby_hours')); return o === null && s === null ? null : Math.round(((o ?? 0) + (s ?? 0)) * 100) / 100; }
    case 'net': { const g = num(get('gross')); return g === null ? null : Math.round((g - (num(get('partial')) ?? 0)) * 100) / 100; }
    case 'utilization': { const s = get('status'); return DAILY_STATUSES.find((d) => d.status === s)?.utilization ?? null; }
    default: return null;
  }
}

/** What the sheet shows: the snapshot once a line is locked, the live value otherwise. */
export function shownValue(f: SheetField, line: SheetLine, all: SheetField[]): Value {
  if (line.locked && line.snapshot) return line.snapshot[f.key] ?? null;
  return liveValue(f, line, all);
}

/** Every field's live value, frozen when a line is locked. */
export const snapshotOf = (line: Pick<SheetLine, 'app' | 'data'>, all: SheetField[]): Values =>
  Object.fromEntries(all.map((f) => [f.key, liveValue(f, line, all)]));

/** The fields whose live value no longer matches the locked snapshot. */
export function changedSinceLock(line: SheetLine, all: SheetField[]): string[] {
  if (!line.locked || !line.snapshot) return [];
  return all.filter((f) => String(liveValue(f, line, all) ?? '') !== String(line.snapshot?.[f.key] ?? '')).map((f) => f.label);
}

/** Does the field belong on this account's sheet? */
export const usesField = (f: SheetField, format: FormatKey) => !f.formats || f.formats.includes(format);

/** The ticket statuses offered for an account. */
export const ticketStatusesFor = (format: FormatKey) => FORMATS[format].ticketStatuses as readonly string[];

/** Checks a typed value against the field; returns the value to store, or an error. */
export function cleanValue(f: SheetField, raw: unknown): { value: Value } | { error: string } {
  if (f.source === 'app' || f.source === 'calc') return { error: `${f.label} comes from the job and can't be typed here` };
  if (raw === null || raw === undefined || raw === '') return { value: null };
  const s = String(raw).trim();
  if (!s) return { value: null };
  switch (f.type) {
    case 'number': case 'money': {
      const n = Number(s.replace(/,/g, ''));
      if (!Number.isFinite(n) || n < 0 || n > 1e9) return { error: `${f.label} must be a number of 0 or more` };
      return { value: Math.round(n * 100) / 100 };
    }
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? { value: s } : { error: `${f.label} must be a date` };
    case 'month': return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? { value: s } : { error: `${f.label} must be a month` };
    case 'yesno': case 'choice': return f.choices?.includes(s) ? { value: s } : { error: `${f.label}: pick one of ${f.choices?.join(', ')}` };
    default: return { value: s.slice(0, f.type === 'longtext' ? 2000 : 200) };
  }
}

/** The daily report's client line suggested by a job's account. */
export function clientFor(account: string | null | undefined, offshore = false): string | null {
  const f = formatOf(account);
  if (f === 'dwo') return offshore ? 'NESR Offshore' : 'NESR D&WO';
  if (f === 'sawcod') return 'SAWCOD (RIGLESS)';
  if (f === 'nawcod') return 'NAWCOD (Rigless)';
  if (f === 'unc' || f === 'lstk') return 'FRAC UNC';
  if (/bapco|bahrain/i.test(account ?? '')) return 'BAPCO';
  return null;
}

/** The daily status a unit's day suggests: its job, or its maintenance or loan, else available at base. */
export function dailyStatus(day: string, job: { status: string; start_date: string | null } | null, event: { kind: string; starts_on: string; ends_on: string } | null): string {
  if (job) {
    if (job.status === 'planned') return job.start_date === day ? 'Mob.' : 'Booked';
    return 'On-going';
  }
  if (event) {
    if (event.kind === 'maintenance') {
      const days = Math.round((Date.parse(event.ends_on) - Date.parse(event.starts_on)) / 86_400_000) + 1;
      return days <= 2 ? 'Preventive < 2 days' : days <= 5 ? 'Repair 3~5 days' : 'Major Repairs > 6 days';
    }
    if (event.kind === 'loan' || event.kind === 'transferred') return 'Transfer / on loan';
    if (event.kind === 'junk') return 'Others';
  }
  return 'Base - Available';
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (ym: string) => (/^\d{4}-\d{2}$/.test(ym) ? `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : ym);
