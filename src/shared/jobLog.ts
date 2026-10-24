import type { Cell } from './xlsx';

// Job Log (S08): one row per job, the same columns on screen, in the XLSX and in the CSV.
// Revenue is left out on purpose: it belongs to the Sales Dashboard and its restricted access.

export interface JobLogRow {
  id: string; country: string; ticket_no: string | null; drss_no: string | null; dmr_no: string | null; status: string;
  start_date: string | null; end_date: string | null; unit_number: string | null; sdm: string | null;
  location: string | null; field: string | null; rig: string | null; well: string | null; conveyance: string | null;
  services: string | null; domains: string | null; run_details: string | null;
  wire_serial_number: string | null; drum_no: string | null; max_depth_ft: number | null; wire_cut_ft: number | null;
  runs_ok: number | null; runs_failed: number | null; op_hours: number | null; npt_hours: number; failure: string | null;
  job_efficiency_pct: number | null; run_efficiency_pct: number | null;
  supervisors: string | null; operators: string | null; assistants: string | null; helpers: string | null;
  third_parties: string | null; jra_status: string | null; report_closure_status: string | null; updated_at: string;
}

type Col = { key: keyof JobLogRow; label: string; width: number; num?: boolean; mono?: boolean };

export const JOB_LOG_COLUMNS: Col[] = [
  { key: 'ticket_no', label: 'Field ticket', width: 12, mono: true },
  { key: 'status', label: 'Status', width: 11 },
  { key: 'start_date', label: 'Start', width: 11, mono: true },
  { key: 'end_date', label: 'End', width: 11, mono: true },
  { key: 'unit_number', label: 'Unit', width: 9, mono: true },
  { key: 'sdm', label: 'SDM', width: 18 },
  { key: 'location', label: 'Account', width: 12 },
  { key: 'field', label: 'Area', width: 14 },
  { key: 'rig', label: 'Rig / site', width: 12 },
  { key: 'well', label: 'Well', width: 12 },
  { key: 'conveyance', label: 'Conveyance', width: 12 },
  { key: 'services', label: 'Services', width: 30 },
  { key: 'domains', label: 'Service domain', width: 22 },
  { key: 'drss_no', label: 'DRSS', width: 10, mono: true },
  { key: 'dmr_no', label: 'DMR', width: 10, mono: true },
  { key: 'wire_serial_number', label: 'Wire', width: 12, mono: true },
  { key: 'drum_no', label: 'Drum', width: 10, mono: true },
  { key: 'runs_ok', label: 'Runs OK', width: 8, num: true },
  { key: 'runs_failed', label: 'Runs failed', width: 8, num: true },
  { key: 'max_depth_ft', label: 'Max depth ft', width: 10, num: true },
  { key: 'wire_cut_ft', label: 'Wire cut ft', width: 9, num: true },
  { key: 'op_hours', label: 'Op hours', width: 9, num: true },
  { key: 'npt_hours', label: 'NPT h', width: 7, num: true },
  { key: 'job_efficiency_pct', label: 'Job eff %', width: 8, num: true },
  { key: 'run_efficiency_pct', label: 'Run eff %', width: 8, num: true },
  { key: 'failure', label: 'Failure', width: 8 },
  { key: 'supervisors', label: 'Supervisors', width: 22 },
  { key: 'operators', label: 'Operators', width: 26 },
  { key: 'assistants', label: 'Assistant operators', width: 22 },
  { key: 'helpers', label: 'Helpers', width: 22 },
  { key: 'third_parties', label: 'Third parties (PO)', width: 26 },
  { key: 'jra_status', label: 'JRA', width: 10 },
  { key: 'report_closure_status', label: 'Report status', width: 13 },
  { key: 'run_details', label: 'Run details', width: 40 },
];

const YN: Record<string, string> = { yes: 'Yes', no: 'No', na: 'N/A', other: 'Other' };
const REPORT: Record<string, string> = { open: 'Open', pending_review: 'Pending review', closed: 'Closed', na: 'N/A' };

/** The value as people read it: words for codes, lists joined, numbers kept as numbers for the spreadsheet. */
export function displayValue(row: JobLogRow, key: keyof JobLogRow): Cell {
  const v = row[key];
  if (v === null || v === undefined || v === '') return null;
  if (key === 'status' || key === 'jra_status') return String(v)[0].toUpperCase() + String(v).slice(1);
  if (key === 'failure') return YN[String(v)] ?? String(v);
  if (key === 'report_closure_status') return REPORT[String(v)] ?? String(v);
  if (typeof v === 'string' && ['services', 'domains', 'supervisors', 'operators', 'assistants', 'helpers', 'third_parties'].includes(key)) return v.split('\u001f').join(', ');
  return v as Cell;
}

export const jobLogTable = (rows: JobLogRow[]) => ({
  header: JOB_LOG_COLUMNS.map((c) => c.label),
  rows: rows.map((r) => JOB_LOG_COLUMNS.map((c) => displayValue(r, c.key))),
  widths: JOB_LOG_COLUMNS.map((c) => c.width),
});
