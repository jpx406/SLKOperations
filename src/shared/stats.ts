// Service Quality analytics (S13 Statistics, S14 NPT & Failure, S15 Utilization). Pure functions over job rows
// so every number on screen can be drilled down to the jobs behind it. Canceled jobs never reach these functions.

import { MONTHS } from './filters';
import { runEfficiency } from './metrics';

export interface StatJob {
  id: string; ticket_no: string | null; well: string | null; status: string; start_date: string; end_date: string | null; arrived_at: string | null;
  unit_number: string | null; sdm: string | null; location: string | null; field: string | null; conveyance: string | null;
  op_hours: number | null; npt_hours: number; failure: string | null; runs_ok: number | null; runs_failed: number | null;
  wellsite_audit: string | null; services: string[]; domains: string[]; crew: string[];
}
export interface UnitEvent { unit_number: string; kind: string; starts_on: string; ends_on: string }

export const PERIODS = [
  { key: 'month', label: 'This month' }, { key: '3m', label: '3 months' }, { key: 'ytd', label: 'Year to date' }, { key: 'all', label: 'All time' },
] as const;
export type Period = (typeof PERIODS)[number]['key'];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Date range for a preset, in whole days. "All time" has no bounds. */
export function periodRange(p: Period, today: string): { from: string | null; to: string | null } {
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const lastOfMonth = iso(new Date(Date.UTC(y, m, 0)));
  if (p === 'month') return { from: `${today.slice(0, 7)}-01`, to: lastOfMonth };
  if (p === '3m') return { from: iso(new Date(Date.UTC(y, m - 3, 1))), to: lastOfMonth };
  if (p === 'ytd') return { from: `${y}-01-01`, to: today };
  return { from: null, to: null };
}

export function kpis(rows: StatJob[]) {
  const op = r1(rows.reduce((a, j) => a + (j.op_hours ?? 0), 0));
  const npt = r1(rows.reduce((a, j) => a + (j.npt_hours || 0), 0));
  const runEffs = rows.map((j) => runEfficiency(j.runs_ok, j.runs_failed)).filter((x): x is number => x !== null);
  const failures = rows.filter((j) => j.failure === 'yes').length;
  return {
    jobs: rows.length,
    opHours: op,
    npt,
    // fleet efficiency = op ÷ (op + NPT)
    fleetEff: op + npt > 0 ? r1((op / (op + npt)) * 100) : null,
    avgRunEff: runEffs.length ? r1(runEffs.reduce((a, b) => a + b, 0) / runEffs.length) : null,
    jobsWithNpt: rows.filter((j) => j.npt_hours > 0).length,
    failures,
    failureRate: rows.length ? r1((failures / rows.length) * 100) : null,
  };
}

export interface Bucket { key: string; label: string; value: number; ids: string[] }

/** Groups rows by a key (a row may fall in several buckets, e.g. one per service) and sums a value. Largest first. */
export function groupBy(rows: StatJob[], keys: (j: StatJob) => (string | null)[], value: (j: StatJob) => number, empty = 'Not set'): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const j of rows) {
    const ks = keys(j).map((k) => k || empty);
    for (const k of new Set(ks.length ? ks : [empty])) {
      const b = map.get(k) ?? { key: k, label: k, value: 0, ids: [] };
      b.value += value(j);
      b.ids.push(j.id);
      map.set(k, b);
    }
  }
  return [...map.values()].map((b) => ({ ...b, value: r2(b.value) })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/** Month buckets in date order, filling empty months between the first and last so trends read honestly. */
export function byMonth(rows: StatJob[], value: (j: StatJob) => number, range?: { from: string | null; to: string | null }): Bucket[] {
  const months = rows.map((j) => j.start_date.slice(0, 7)).sort();
  const first = range?.from?.slice(0, 7) ?? months[0];
  const last = range?.to?.slice(0, 7) ?? months[months.length - 1];
  if (!first || !last) return [];
  const out: Bucket[] = [];
  for (let [y, m] = [Number(first.slice(0, 4)), Number(first.slice(5, 7))]; `${y}-${String(m).padStart(2, '0')}` <= last && out.length < 120; m === 12 ? (y++, m = 1) : m++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const inMonth = rows.filter((j) => j.start_date.startsWith(key));
    out.push({ key, label: `${MONTHS[m - 1]} ${String(y).slice(2)}`, value: r2(inMonth.reduce((a, j) => a + value(j), 0)), ids: inMonth.map((j) => j.id) });
  }
  return out;
}

/** A ratio per month (e.g. fleet efficiency), null where the month has nothing to divide. */
export function ratioByMonth(rows: StatJob[], ratio: (list: StatJob[]) => number | null, range?: { from: string | null; to: string | null }): (Omit<Bucket, 'value'> & { value: number | null })[] {
  return byMonth(rows, () => 0, range).map((b) => ({ ...b, value: ratio(rows.filter((j) => b.ids.includes(j.id))) }));
}

const DAY = 86_400_000;
const addDays = (d: string, n: number) => iso(new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY));
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;

/**
 * Unit utilization: active days ÷ available days, per unit.
 * Available = calendar days in the period minus maintenance, loan, transferred and junk days.
 * Active = arrival (or start) to end, plus one day mobilisation before and two days demobilisation after, never counted twice.
 */
export function unitUtilization(units: string[], rows: StatJob[], events: UnitEvent[], from: string, to: string) {
  const blocking = new Set(['maintenance', 'loan', 'transferred', 'junk']);
  return units.map((unit) => {
    const blocked = new Set<string>();
    for (const e of events.filter((x) => x.unit_number === unit && blocking.has(x.kind))) {
      for (let d = e.starts_on < from ? from : e.starts_on; d <= (e.ends_on > to ? to : e.ends_on); d = addDays(d, 1)) blocked.add(d);
    }
    const active = new Set<string>();
    const jobs = rows.filter((j) => j.unit_number === unit);
    for (const j of jobs) {
      const s = addDays((j.arrived_at?.slice(0, 10) ?? j.start_date), -1);
      const e = addDays(j.end_date ?? j.start_date, 2);
      for (let d = s < from ? from : s; d <= (e > to ? to : e); d = addDays(d, 1)) if (!blocked.has(d)) active.add(d);
    }
    const available = days(from, to) - blocked.size;
    return { unit, jobs: jobs.length, activeDays: active.size, availableDays: available, pct: available > 0 ? r1((active.size / available) * 100) : null };
  });
}

export const utilBand = (pct: number | null) => (pct == null ? 'none' : pct >= 75 ? 'high' : pct >= 50 ? 'mid' : pct >= 25 ? 'low' : 'idle');

/** Jobs that should have numbers but don't: completed without operating hours or without run counts. */
export function missingData(rows: StatJob[]) {
  return rows.filter((j) => j.status === 'completed' && (j.op_hours == null || (j.runs_ok == null && j.runs_failed == null)))
    .map((j) => ({ id: j.id, ticket_no: j.ticket_no, missing: [j.op_hours == null && 'operating hours', j.runs_ok == null && j.runs_failed == null && 'runs'].filter(Boolean) as string[] }));
}

/** Wellsite audit compliance per SDM = audited ÷ jobs (target 25 %). */
export function auditCompliance(rows: StatJob[], target = 25) {
  return groupBy(rows, (j) => [j.sdm], () => 1).map((b) => {
    const audited = rows.filter((j) => b.ids.includes(j.id) && j.wellsite_audit === 'yes').length;
    const pct = r1((audited / b.value) * 100);
    return { sdm: b.label, jobs: b.value, audited, pct, met: pct >= target, ids: b.ids };
  });
}

export const fleetEff = (list: StatJob[]) => {
  const op = list.reduce((a, j) => a + (j.op_hours ?? 0), 0);
  const npt = list.reduce((a, j) => a + (j.npt_hours || 0), 0);
  return op + npt > 0 ? r1((op / (op + npt)) * 100) : null;
};
export const avgRunEff = (list: StatJob[]) => kpis(list).avgRunEff;
