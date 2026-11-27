// The Job log · Sequence of Events form (6z.51), ported from the owner's WL Operations Hub job log package and
// adjusted for slickline: each row also has the run and the depth, the sign-off is the slickline supervisor or
// operator and the client representative. One form per job, saved with every version kept; two people saving at
// once are merged (rows by id, header fields "mine if I changed them, else theirs"). Pure functions: the editor,
// the Worker and the tests share them.
//
// 6z.52: everything on the owner's NESR Slickline Service Report (the Excel job log) is added: the well and crew
// header with pressures and gauges, From and To on each line, the job status, the wire details, the BHA of each run
// (read from the run's tool string) and a note. A new log starts with the three lines every log must have:
// arrival on location first, then a rig up and a rig down line with the work between them.

import { riyadhDay } from './dates';
import { MONTHS } from './filters';

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const uid = () => ((globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

/** Today in Riyadh as YYYY-MM-DD. */
export const todayISO = () => riyadhDay();

export const dayOf = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  return DAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
};
/** "2026-11-22" → "22-Nov-26". */
export const dateShort = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}-${MONTHS[+m[2] - 1]}-${m[1].slice(2)}` : String(iso || '');
};
export const timeHM = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? `${String(+m[1]).padStart(2, '0')}:${m[2]}` : String(t || '').trim();
};
export const num = (v: unknown) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

/** One row of the sequence of events. Run and depth are the slickline additions; `to` is when the work ended. */
export interface LogRow { id: string; date: string; time: string; to: string; run: string; depth: string; desc: string; remark: string }
/** A signature: drawn (a PNG data URL) or typed, with who put it there and when. */
export interface Sig { img: string | null; text: string | null; by: string; at: string }
export const hasSig = (s: Sig | null | undefined) => !!(s && (s.img || s.text));

export const JOB_STATUSES = { complete: 'Complete', in_progress: 'In progress', incomplete: 'Incomplete', aborted: 'Aborted' } as const;
export type JobStatusKey = keyof typeof JOB_STATUSES;
/** The tools run in the hole on one run, read from that run's tool string and editable. */
export interface Bha { run: string; text: string }

export interface LogForm {
  ticket: string; well: string; customer: string; jobType: string; rig: string; date: string;
  // the Slickline Service Report's header (6z.52)
  field: string; tubingSize: string; tubingFl: string; tubingSi: string; casingFl: string; casingSi: string; whConnection: string; wellType: string;
  supervisor: string; operator1: string; operator2: string; unit: string; pickup: string; gauge1: string; gauge2: string;
  arrFl: string; arrSi: string; depFl: string; depSi: string; locationCond: string;
  rows: LogRow[];
  status: '' | JobStatusKey;
  wireType: string; wireSize: string; wireInitial: string; wireMaxPull: string; wireHrs: string; wireCut: string; wireFinal: string;
  bha: Bha[];
  notes: string;
  /** "" = worked out from the first to the last event. */
  dayHrs: string; nightHrs: string;
  /** NESR representative: the slickline supervisor and operators (several), their I.D. and signature. */
  engNames: string[]; engId: string; engSig: Sig | null;
  /** Client representative (company man). */
  fmName: string; fmId: string; fmDate: string; fmSig: Sig | null;
}

export const newRow = (o: Partial<LogRow> = {}): LogRow => ({ id: uid(), date: '', time: '', to: '', run: '', depth: '', desc: '', remark: '', ...o });

/** What the job gives the header. */
export interface JobForLog {
  ticket?: string | null; well?: string | null; customer?: string | null; jobType?: string | null; rig?: string | null; startDate?: string | null; engineers?: string[];
  field?: string | null; wellType?: string | null; whConnection?: string | null; unit?: string | null; siwhp?: string | null; tubingSize?: string | null;
  supervisor?: string | null; operator1?: string | null; operator2?: string | null;
  wireType?: string | null; wireSize?: string | null; wireInitial?: string | null; wireCut?: string | null; wireMaxPull?: string | null;
  bha?: Bha[];
}

// ---- what the job fills (6z.53): a field the job has a value for is read from the job and not typed on the log

export const JOB_FIELDS = {
  ticket: 'ticket', well: 'well', customer: 'customer', jobType: 'jobType', rig: 'rig', date: 'startDate', field: 'field', wellType: 'wellType',
  whConnection: 'whConnection', unit: 'unit', tubingSize: 'tubingSize', tubingSi: 'siwhp', supervisor: 'supervisor', operator1: 'operator1', operator2: 'operator2',
  wireType: 'wireType', wireSize: 'wireSize', wireInitial: 'wireInitial', wireCut: 'wireCut', wireMaxPull: 'wireMaxPull',
} as const satisfies Partial<Record<string, keyof JobForLog>>;
export type JobField = keyof typeof JOB_FIELDS;

/** The values the job gives the log: only fields the job has a value for. */
export function jobValues(job: JobForLog | null | undefined): Partial<Record<JobField, string>> {
  const out: Partial<Record<JobField, string>> = {};
  if (!job) return out;
  for (const [k, src] of Object.entries(JOB_FIELDS) as [JobField, keyof JobForLog][]) {
    const v = job[src];
    const t = typeof v === 'string' ? (k === 'date' ? v.slice(0, 10) : v).trim() : '';
    if (t) out[k] = t;
  }
  return out;
}
/** The form with the job's values in place of what was saved. */
export const applyJob = <F extends LogForm>(f: F, job: JobForLog | null | undefined): F => ({ ...f, ...jobValues(job) });

/** Setting a line's To also makes it the next line's From (`link` false: only this line, as when a picked To starts at the From). */
export function setRowTo(rows: LogRow[], id: string, to: string, link = true): LogRow[] {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return rows;
  return rows.map((r, j) => (j === i ? { ...r, to } : link && j === i + 1 && timeHM(to) ? { ...r, time: timeHM(to) } : r));
}

// ---- the job log's pick lists (6z.53): kept per country, people with the job's edit right add, change and remove

export const LOG_OPTION_KINDS = {
  phrase: 'Work description wording', well: 'Well number', jobType: 'Job type', rig: 'Rig / rigless / site', field: 'Field', customer: 'Client',
  wellType: 'Well type', tubingSize: 'Tubing size', whConnection: 'W/H connection', unit: 'SLK unit', locationCond: 'Location condition',
  supervisor: 'SLK supervisor', operator1: 'SLK operator', operator2: 'SLK operator', wireType: 'Wire type', wireSize: 'Wire size',
} as const;
export type LogOptionKind = keyof typeof LOG_OPTION_KINDS;
/** The usual values offered before anyone adds their own. */
export const LOG_OPTION_DEFAULTS: Partial<Record<LogOptionKind, string[]>> = {
  tubingSize: ['2 3/8"', '2 7/8"', '3 1/2"', '4 1/2"', '5 1/2"', '7"'],
  whConnection: ['2 9/16" 5K', '3 1/16" 5K', '3 1/16" 10K', '4 1/16" 5K', '4 1/16" 10K', '5 1/8" 5K', '7 1/16" 5K'],
  locationCond: ['Good', 'Fair', 'Poor', 'Wet / muddy', 'Sandy'],
  wellType: ['Oil', 'Gas', 'Water', 'Injector', 'Observation'],
  wireType: ['Carbon steel', 'Stainless steel 316', 'Supa 75', 'Braided line'],
  wireSize: ['0.092"', '0.108"', '0.125"', '0.140"', '0.160"', '3/16"'],
};
export interface LogOption { id: string; kind: LogOptionKind; grp: string; value: string }
/** A value for a pick list: one line, trimmed; the wording may be longer. */
export function cleanLogOption(kind: unknown, grp: unknown, value: unknown): { kind: LogOptionKind; grp: string; value: string } | { error: string } {
  if (typeof kind !== 'string' || !(kind in LOG_OPTION_KINDS)) return { error: 'Unknown list' };
  const v = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, kind === 'phrase' ? 400 : 80);
  if (!v) return { error: 'Type a value' };
  const g = kind === 'phrase' ? String(grp ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Other' : '';
  return { kind: kind as LogOptionKind, grp: g, value: v };
}
/** The wording grouped for the checklist, in the order the groups first appear. */
export function phraseGroups(opts: { grp: string; value: string }[]): { group: string; phrases: string[] }[] {
  const out: { group: string; phrases: string[] }[] = [];
  for (const o of opts) { let g = out.find((x) => x.group === o.grp); if (!g) out.push(g = { group: o.grp, phrases: [] }); g.phrases.push(o.value); }
  return out;
}

// ---- the lines every log must have

const ARRIVED = /\barriv|\bon (site|location)\b/i;
const RIG_UP = /\brig(ged|ging)?[\s-]*up\b|\br\/u\b/i;
const RIG_DOWN = /\brig(ged|ging)?[\s-]*down\b|\br\/d\b/i;
export type RowKind = 'arrival' | 'rigup' | 'rigdown';
/** Which of the three required lines a description is, if any ("RU" and "RD" count in capitals only). */
export function rowKind(desc: string): RowKind | null {
  const d = desc || '';
  if (ARRIVED.test(d)) return 'arrival';
  if (/\bRD\b/.test(d) || RIG_DOWN.test(d)) return 'rigdown';
  if (/\bRU\b/.test(d) || RIG_UP.test(d)) return 'rigup';
  return null;
}
export const ROW_KIND_LABEL: Record<RowKind, string> = { arrival: 'Arrival', rigup: 'Rig up', rigdown: 'Rig down' };

/** What a new log starts with: the three required lines, the work goes between rig up and rig down. */
export const seedRows = (date: string): LogRow[] => [
  newRow({ date, desc: 'ARRIVED ON LOCATION.' }),
  newRow({ date, desc: 'RU SLK PCE ON WELL.' }),
  newRow({ date, desc: 'COMPLETELY RD SLK EQUIPMENT AND SECURED WELL.' }),
];

/**
 * The required lines, in the order they are on the form: arrival on location on the first line, a rig up line and a
 * rig down line after it. Lists what is missing; empty means the log can be signed.
 */
export function mandatoryProblems(f: LogForm): string[] {
  const rows = f.rows.filter((r) => !isEmptyRow(r));
  const out: string[] = [];
  if (!rows.length || rowKind(rows[0].desc) !== 'arrival') out.push('The first line must be the arrival on location.');
  const up = rows.findIndex((r, i) => i > 0 && rowKind(r.desc) === 'rigup');
  const down = rows.reduce((a, r, i) => (rowKind(r.desc) === 'rigdown' ? i : a), -1);
  if (up < 0) out.push('Add a rig up line after the arrival.');
  if (down < 0) out.push('Add a rig down line.');
  else if (up >= 0 && down < up) out.push('The rig down line must come after the rig up line.');
  for (const i of [0, up, down]) {
    const r = rows[i];
    if (i >= 0 && r && rowKind(r.desc) && !timeHM(r.time)) out.push(`Give the ${ROW_KIND_LABEL[rowKind(r.desc)!].toLowerCase()} line (line ${i + 1}) its time.`);
  }
  return out;
}

// ---- the description checklist: the owner's job log wording; ___ is a blank to fill in

export const PHRASE_GROUPS: { group: string; phrases: string[] }[] = [
  { group: 'Arrival and preparation', phrases: [
    'ARRIVED ON LOCATION.', 'MOVED SLK EQUIPMENT FROM ___ TO ___ AND SECURED.', 'WAITED FOR WELL READINESS.', 'RAISED PTW.', 'HELD TOOLBOX TALK AND JSA WITH ALL CREW.',
    'WAITED FOR WELL INTEGRITY TEST.', 'WAITED ON CLIENT.', 'WAITED ON DAYLIGHT.',
  ] },
  { group: 'Rig up and testing', phrases: [
    'SPOTTED SLK PCE ON WELL.', 'RU SLK PCE ON SURFACE.', 'COC BOP OKAY.', 'RU SLK PCE ON WELL.', 'PRESSURE-TESTED SLK PCE TO ___ PSI FOR ___ MINS OK.',
  ] },
  { group: 'Runs', phrases: [
    'RIH W/ ___ GC AND SOFT TAGGED AT ___ FT DF.', 'INFORMED AF AND WSC.', 'POOH.', 'CONNECTED EMGs AND PT QTS TO ___ PSI FOR ___ MINS OK.',
    'RIH W/EMGs TO SD AT ___ FT DF AND OBSERVED ___ MINS STOP.', 'POOH MAKING SBHP STOPS TO SURFACE (OBSERVED ___ MINS STOP AT EVERY ___ FT AND ___ MINS STOP AT ___ PSI).',
    'DISCONNECTED EMGs AND DOWNLOADED DATA OK.', 'RIH W/ ___ AND SET AT ___ FT DF.', 'RIH W/ ___ AND PULLED AT ___ FT DF.', 'JARRED UP ___ TIMES.',
  ] },
  { group: 'Rig down', phrases: ['RD SLK PCE FROM WELL.', 'COMPLETELY RD SLK EQUIPMENT AND SECURED WELL.', 'HANDED OVER THE WELL TO THE CLIENT.'] },
];
/** The fixed start of a phrase (before its first blank), used to tell whether it is in a description. */
const lead = (p: string) => p.split('___')[0].trim().replace(/[.\s]+$/, '');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();
export const hasPhrase = (desc: string, p: string) => !!lead(p) && norm(desc).includes(norm(lead(p)));
/** Ticking a phrase adds it to the end; unticking takes out the sentence that starts with it. */
export function togglePhrase(desc: string, p: string): string {
  if (!hasPhrase(desc, p)) return [desc.trim(), p].filter(Boolean).join(' ');
  const parts = desc.split(/(?<=\.)\s+/);
  const kept = parts.filter((s) => !norm(s).startsWith(norm(lead(p))));
  return (kept.length === parts.length ? desc.replace(new RegExp(lead(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '') : kept.join(' ')).replace(/\s+/g, ' ').trim();
}

export const newForm = (job: JobForLog = {}, o: Partial<LogForm> = {}): LogForm => {
  const date = job.startDate?.slice(0, 10) || todayISO();
  const s = (v: string | null | undefined) => v ?? '';
  return {
    ticket: s(job.ticket), well: s(job.well), customer: s(job.customer), jobType: s(job.jobType), rig: s(job.rig), date,
    field: s(job.field), tubingSize: '', tubingFl: '', tubingSi: s(job.siwhp), casingFl: '', casingSi: '', whConnection: s(job.whConnection), wellType: s(job.wellType),
    supervisor: s(job.supervisor), operator1: s(job.operator1), operator2: s(job.operator2), unit: s(job.unit), pickup: '', gauge1: '', gauge2: '',
    arrFl: '', arrSi: '', depFl: '', depSi: '', locationCond: '',
    rows: seedRows(date), status: '',
    wireType: s(job.wireType), wireSize: s(job.wireSize), wireInitial: s(job.wireInitial), wireMaxPull: s(job.wireMaxPull), wireHrs: '', wireCut: s(job.wireCut), wireFinal: '',
    bha: job.bha?.map((b) => ({ ...b })) ?? [], notes: '',
    dayHrs: '', nightHrs: '',
    engNames: job.engineers?.slice() ?? [], engId: '', engSig: null, fmName: '', fmId: '', fmDate: '', fmSig: null, ...o,
  };
};

export const HEADER_LABELS: Record<string, string> = {
  ticket: 'Ticket', well: 'Well', customer: 'Client', jobType: 'Job type', rig: 'Rig/Site', date: 'Date', dayHrs: 'Day hours', nightHrs: 'Night hours',
  field: 'Field', tubingSize: 'Tubing size', tubingFl: 'Tubing pressure FL', tubingSi: 'Tubing pressure SI', casingFl: 'Casing pressure FL', casingSi: 'Casing pressure SI',
  whConnection: 'W/H connection', wellType: 'Well type', supervisor: 'SLK supervisor', operator1: 'SLK operator', operator2: 'SLK operator (2)', unit: 'Unit',
  pickup: 'Pick up', gauge1: 'Gauge S/N', gauge2: 'Gauge S/N (2)', arrFl: 'Arrival FL', arrSi: 'Arrival SI', depFl: 'Departure FL', depSi: 'Departure SI',
  locationCond: 'Location condition', status: 'Job status', wireType: 'Wire type', wireSize: 'Wire size', wireInitial: 'Initial length', wireMaxPull: 'Max. pull',
  wireHrs: 'Hours in hole', wireCut: 'Wire cut', wireFinal: 'Final length', bha: 'BHA', notes: 'Note',
  engNames: 'Slickline crew', engId: 'Crew I.D.', fmName: 'Client rep.', fmId: 'Client rep. I.D.', fmDate: 'Client rep. date',
};

/** A row with nothing in it: not an event, left out of the exports. */
export const isEmptyRow = (r: LogRow | undefined) => !r || !(r.desc.trim() || r.remark.trim() || r.time.trim());
export const eventCount = (f: LogForm) => f.rows.filter((r) => !isEmptyRow(r)).length;

export const sortRows = (rows: LogRow[]) => rows.slice().sort((a, b) => {
  if (isEmptyRow(a) !== isEmptyRow(b)) return isEmptyRow(a) ? 1 : -1;
  return `${a.date || '9999'} ${timeHM(a.time) || '00:00'}`.localeCompare(`${b.date || '9999'} ${timeHM(b.time) || '00:00'}`);
});

/** Minutes since 1970 for a local date and time (both Riyadh wall time). */
const minutesOf = (date: string, time: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), t = /^(\d{2}):(\d{2})$/.exec(timeHM(time));
  return m && t ? Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]) / 60_000 : null;
};

/** The To of a row: typed, else the next row's From (as the Excel's =D19 does). */
export const toOf = (rows: LogRow[], i: number) => timeHM(rows[i]?.to) || timeHM(rows.slice(i + 1).find((r) => !isEmptyRow(r))?.time ?? '');

/**
 * Crew hours worked out: from the first logged time to the last (a line's To counts), split into Day
 * (06:00–18:00) and Night (18:00–06:00), to the half hour. A typed number wins; clearing it goes back to the
 * worked-out one.
 */
export function autoHours(f: LogForm): { day: number | null; night: number | null; total: number | null } {
  const pts: number[] = [];
  for (const r of f.rows.filter((x) => !isEmptyRow(x))) {
    const a = minutesOf(r.date, r.time);
    if (a == null) continue;
    pts.push(a);
    const b = minutesOf(r.date, r.to);
    if (b != null) pts.push(b < a ? b + 1440 : b);
  }
  pts.sort((a, b) => a - b);
  if (pts.length < 2) return { day: null, night: null, total: null };
  let day = 0, night = 0;
  for (let t = pts[0]; t < pts[pts.length - 1]; t++) {
    const h = Math.floor((t % 1440) / 60);
    if (h >= 6 && h < 18) day++; else night++;
  }
  const r = (mins: number) => Math.round((mins / 60) * 2) / 2;
  return { day: r(day), night: r(night), total: r(day + night) };
}
export function hours(f: LogForm) {
  const a = autoHours(f);
  const day = num(f.dayHrs) ?? a.day, night = num(f.nightHrs) ?? a.night;
  return { day, night, total: day == null && night == null ? null : (day ?? 0) + (night ?? 0), autoDay: num(f.dayHrs) == null, autoNight: num(f.nightHrs) == null };
}

/** The final wire length: typed, else the initial length less the cut. */
export const wireFinalOf = (f: LogForm) => f.wireFinal.trim() || (num(f.wireInitial) != null ? String(Math.round((num(f.wireInitial)! - (num(f.wireCut) ?? 0)) * 10) / 10) : '');

const rowKey = (r: LogRow) => `${r.date}|${timeHM(r.time)}|${timeHM(r.to)}|${r.run}|${r.depth}|${r.desc.trim()}|${r.remark.trim()}`;
export const SCALARS = ['ticket', 'well', 'customer', 'jobType', 'rig', 'date', 'field', 'tubingSize', 'tubingFl', 'tubingSi', 'casingFl', 'casingSi', 'whConnection', 'wellType',
  'supervisor', 'operator1', 'operator2', 'unit', 'pickup', 'gauge1', 'gauge2', 'arrFl', 'arrSi', 'depFl', 'depSi', 'locationCond', 'status',
  'wireType', 'wireSize', 'wireInitial', 'wireMaxPull', 'wireHrs', 'wireCut', 'wireFinal', 'notes', 'dayHrs', 'nightHrs', 'engId', 'fmName', 'fmId', 'fmDate'] as const;
export type ScalarKey = (typeof SCALARS)[number];

/** "What changed" for the version history. */
export function changeSummary(prev: LogForm | null, next: LogForm): string {
  if (!prev) return 'Initial version';
  const out: string[] = [];
  const hdr = SCALARS.filter((k) => String(prev[k] ?? '') !== String(next[k] ?? '')).map((k) => HEADER_LABELS[k]);
  if (prev.engNames.join('|') !== next.engNames.join('|')) hdr.push(HEADER_LABELS.engNames);
  if (JSON.stringify(prev.bha) !== JSON.stringify(next.bha)) hdr.push(HEADER_LABELS.bha);
  if (hdr.length) out.push(`${hdr.slice(0, 6).join(', ')}${hdr.length > 6 ? ` and ${hdr.length - 6} more` : ''} changed`);
  const pm = new Map(prev.rows.filter((r) => !isEmptyRow(r)).map((r) => [r.id, r]));
  const nm = new Map(next.rows.filter((r) => !isEmptyRow(r)).map((r) => [r.id, r]));
  let added = 0, removed = 0, edited = 0;
  for (const [id, r] of nm) { const p = pm.get(id); if (!p) added++; else if (rowKey(p) !== rowKey(r)) edited++; }
  for (const id of pm.keys()) if (!nm.has(id)) removed++;
  if (added) out.push(`+${added} row${added > 1 ? 's' : ''}`);
  if (removed) out.push(`−${removed} row${removed > 1 ? 's' : ''}`);
  if (edited) out.push(`${edited} row${edited > 1 ? 's' : ''} edited`);
  const sig = (a: Sig | null, b: Sig | null, who: string) => {
    if (hasSig(a) !== hasSig(b)) out.push(hasSig(b) ? `${who} signed` : `${who} signature cleared`);
    else if (hasSig(b) && JSON.stringify(a) !== JSON.stringify(b)) out.push(`${who} re-signed`);
  };
  sig(prev.engSig, next.engSig, 'crew');
  sig(prev.fmSig, next.fmSig, 'client rep.');
  return out.length ? out.join(' · ') : 'No content change';
}

/** Three-way merge: base = last synced, mine = my edits, theirs = what someone saved meanwhile. */
export function mergeForms(base: LogForm | null, mine: LogForm, theirs: LogForm): LogForm {
  const b = base ?? newForm();
  const out: LogForm = { ...theirs };
  for (const k of [...SCALARS, 'engSig', 'fmSig', 'bha'] as const) {
    const iChanged = JSON.stringify(b[k] ?? null) !== JSON.stringify(mine[k] ?? null);
    (out as unknown as Record<string, unknown>)[k] = iChanged ? mine[k] : theirs[k];
  }
  if (b.engNames.join('|') !== mine.engNames.join('|')) out.engNames = mine.engNames;
  const bm = new Map(b.rows.map((r) => [r.id, r])), tm = new Map(theirs.rows.map((r) => [r.id, r])), mm = new Map(mine.rows.map((r) => [r.id, r]));
  const rows: LogRow[] = [];
  // their order, with my new rows placed after the row they follow on my copy
  const order = theirs.rows.map((r) => r.id);
  mine.rows.forEach((r, i) => { if (!order.includes(r.id)) { const after = i > 0 ? order.indexOf(mine.rows[i - 1].id) : -1; order.splice(after + 1, 0, r.id); } });
  for (const id of order) {
    const br = bm.get(id), t = tm.get(id), m = mm.get(id);
    const iChanged = !!m && (!br || rowKey(br) !== rowKey(m)), theyChanged = !!t && (!br || rowKey(br) !== rowKey(t));
    if (br && !m && !theyChanged) continue;   // I deleted it, they left it alone
    if (br && !t && !iChanged) continue;      // they deleted it, I left it alone
    rows.push(iChanged ? m! : (t ?? m!));
  }
  out.rows = rows.length ? rows : [newRow()];
  return out;
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const sigOf = (v: unknown): Sig | null => {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  const img = typeof s.img === 'string' && s.img.startsWith('data:image/') ? s.img : null;
  const text = typeof s.text === 'string' && s.text.trim() ? s.text.trim().slice(0, 120) : null;
  return img || text ? { img, text, by: str(s.by).slice(0, 120), at: str(s.at).slice(0, 40) } : null;
};

/** Anything read back from the server, the device or a version, made into a whole form. Missing fields, and every field the job has a value for, come from the job. */
export function coerceForm(f: unknown, job?: JobForLog): LogForm {
  const base = newForm(job);
  const x = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
  const out = { ...base } as LogForm;
  for (const k of SCALARS) if (x[k] !== undefined) (out as unknown as Record<string, string>)[k] = str(x[k]).slice(0, k === 'notes' ? 4000 : 400);
  if (!(out.status in JOB_STATUSES)) out.status = '';
  out.rows = Array.isArray(x.rows) && x.rows.length
    ? x.rows.slice(0, 2000).map((r) => { const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>; return newRow({ id: str(o.id) || uid(), date: str(o.date).slice(0, 10), time: str(o.time).slice(0, 8), to: str(o.to).slice(0, 8), run: str(o.run).slice(0, 6), depth: str(o.depth).slice(0, 12), desc: str(o.desc).slice(0, 4000), remark: str(o.remark).slice(0, 2000) }); })
    : base.rows;
  if (Array.isArray(x.bha)) out.bha = x.bha.slice(0, 30).map((b) => { const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>; return { run: str(o.run).slice(0, 4), text: str(o.text).slice(0, 1500) }; });
  out.engNames = Array.isArray(x.engNames) ? x.engNames.map(str).filter(Boolean).slice(0, 20) : x.engNames ? str(x.engNames).split(/\s*[,/]\s*/).filter(Boolean) : base.engNames;
  out.engSig = sigOf(x.engSig);
  out.fmSig = sigOf(x.fmSig);
  return job ? applyJob(out, job) : out;
}

/** BHA lines from the job's tool strings: the part names of each run joined with " + ". */
export const bhaFromStrings = (strings: { run: number; names: string[] }[]): Bha[] =>
  strings.filter((s) => s.names.length).sort((a, b) => a.run - b.run).map((s) => ({ run: String(s.run), text: s.names.join(' + ') }));

/** Rows ready for the exports: in order, numbered, empty ones left out, the day filled in. */
export const exportRows = (f: LogForm) => {
  const rows = f.rows.filter((r) => !isEmptyRow(r));
  return rows.map((r, i) => ({
    n: i + 1, date: dateShort(r.date), time: timeHM(r.time), to: toOf(rows, i), day: dayOf(r.date), run: r.run, depth: num(r.depth) != null ? num(r.depth)!.toLocaleString('en-US') : '', desc: r.desc, remark: r.remark,
  }));
};

/** The rows as events with a time (Riyadh wall time, +03:00), for what Execution reads from the log. Lines with no time are left out. */
export function rowsAsEvents(f: LogForm): { id: string; occurred_at: string; run_no: number | null; depth_ft: number | null; text: string }[] {
  return sortRows(f.rows.filter((r) => !isEmptyRow(r) && r.date && timeHM(r.time))).map((r) => ({
    id: r.id, occurred_at: new Date(`${r.date}T${timeHM(r.time)}:00+03:00`).toISOString(),
    run_no: num(r.run) != null && Number.isInteger(num(r.run)) ? num(r.run) : null, depth_ft: num(r.depth),
    text: [r.desc.trim(), r.remark.trim()].filter(Boolean).join(' — '),
  }));
}
