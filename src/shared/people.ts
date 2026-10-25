// People analytics: crew utilization (S15) and competency (S16). Pure functions over the roster and job assignments.

import { MONTHS } from './filters';

export interface Person { id: string; full_name: string; crew_role: string | null; rotation: string; title: string }
export interface Assignment {
  employee_id: string; job_id: string; ticket_no: string | null; start_date: string; end_date: string | null; arrived_at: string | null;
  status: string; failure: string | null; npt_hours: number; services: string[]; domains: string[]; crew_role: string;
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(Date.parse(`${d}T00:00:00Z`) + n * DAY);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Share of calendar days a rotation is on duty: 60/30 → 2/3, 28/28 → 1/2, 5/2 → 5/7. */
export function rotationShare(rotation: string): number {
  const [on, off] = rotation.split('/').map(Number);
  return on > 0 && off >= 0 ? on / (on + off) : 1;
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))]; `${y}-${String(m).padStart(2, '0')}` <= to.slice(0, 7) && out.length < 120; m === 12 ? (y++, m = 1) : m++) out.push(`${y}-${String(m).padStart(2, '0')}`);
  return out;
}
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const monthBounds = (m: string) => [`${m}-01`, iso(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0))] as const;

/** Days a person is busy with jobs in [from, to]: arrival or start minus one day to end plus two, each day once. */
export function busyDays(list: Assignment[], from: string, to: string): Set<string> {
  const days = new Set<string>();
  for (const a of list) {
    if (a.status === 'canceled') continue;
    const s = addDays(a.arrived_at?.slice(0, 10) ?? a.start_date, -1);
    const e = addDays(a.end_date ?? a.start_date, 2);
    for (let d = s < from ? from : s; d <= (e > to ? to : e); d = addDays(d, 1)) days.add(d);
  }
  return days;
}

/**
 * Crew utilization per month: busy days ÷ on-duty days for every field person on the roster.
 * People with no jobs count as 0 % (the original's rule), and nobody goes above 100 %.
 */
export function crewUtilization(people: Person[], assignments: Assignment[], months: string[]) {
  const field = people.filter((p) => ['slickline_supervisor', 'slickline_operator', 'assistant_operator', 'helper'].includes(p.crew_role ?? ''));
  const byPerson = new Map<string, Assignment[]>();
  for (const a of assignments) byPerson.set(a.employee_id, [...(byPerson.get(a.employee_id) ?? []), a]);
  const perMonth = months.map((m) => {
    const [f, t] = monthBounds(m);
    const days = Number(t.slice(8));
    const rows = field.map((p) => {
      const busy = busyDays(byPerson.get(p.id) ?? [], f, t).size;
      const available = days * rotationShare(p.rotation);
      return { id: p.id, name: p.full_name, busy, available: r1(available), pct: available > 0 ? Math.min(100, r1((busy / available) * 100)) : 0 };
    });
    return { month: m, label: monthLabel(m), avg: rows.length ? r1(rows.reduce((a, r) => a + r.pct, 0) / rows.length) : null, people: rows };
  });
  return { headcount: field.length, perMonth };
}

// ---- competency ----

export const LEVELS = [{ min: 30, label: 'Expert' }, { min: 20, label: 'Advance' }, { min: 10, label: 'Intermediate' }, { min: 0, label: 'Basic' }] as const;
export type Level = (typeof LEVELS)[number]['label'];
export const levelFor = (n: number): Level => LEVELS.find((l) => n >= l.min)!.label;
/** Jobs still needed for the next level, or null at Expert. */
export const toNext = (n: number) => { const next = [...LEVELS].reverse().find((l) => l.min > n); return next ? next.min - n : null; };

/** A job counts towards competency when it was completed without a failure. */
export const successful = (a: Assignment) => a.status === 'completed' && a.failure !== 'yes';

export function competency(people: Person[], assignments: Assignment[]) {
  const byPerson = new Map<string, Assignment[]>();
  for (const a of assignments) byPerson.set(a.employee_id, [...(byPerson.get(a.employee_id) ?? []), a]);
  const services = [...new Set(assignments.flatMap((a) => a.services))].sort();
  const cards = people.map((p) => {
    const list = (byPerson.get(p.id) ?? []).filter((a) => a.status !== 'canceled');
    const done = list.filter((a) => a.status === 'completed');
    const ok = done.filter(successful);
    const perService = services.map((s) => {
      const n = ok.filter((a) => a.services.includes(s)).length;
      return { service: s, jobs: n, level: levelFor(n), toNext: toNext(n) };
    }).filter((x) => x.jobs > 0);
    return {
      id: p.id, name: p.full_name, role: p.crew_role, totalJobs: ok.length, perService,
      // quality signal: share of completed jobs with a failure, and NPT per job
      failPct: done.length ? r1(((done.length - ok.length) / done.length) * 100) : null,
      nptPerJob: done.length ? r1(done.reduce((a, x) => a + (x.npt_hours || 0), 0) / done.length) : null,
    };
  });
  const coverage = services.map((s) => {
    const strong = cards.filter((c) => c.perService.some((x) => x.service === s && (x.level === 'Advance' || x.level === 'Expert')));
    return { service: s, advancePlus: strong.length, people: strong.map((c) => c.name), gap: strong.length <= 1 };
  });
  const nearThreshold = cards.flatMap((c) => c.perService.filter((x) => x.toNext !== null && x.toNext <= 2).map((x) => ({ name: c.name, ...x })));
  const overview = LEVELS.map((l) => ({ level: l.label, count: cards.flatMap((c) => c.perService).filter((x) => x.level === l.label).length }));
  return { services, cards, coverage, nearThreshold, overview };
}

/** Successful jobs per service domain per person (the domain roll-up). */
export function domainRollup(assignments: Assignment[]) {
  const m = new Map<string, Map<string, number>>();
  for (const a of assignments.filter(successful)) for (const d of new Set(a.domains)) {
    const inner = m.get(d) ?? new Map<string, number>();
    inner.set(a.employee_id, (inner.get(a.employee_id) ?? 0) + 1);
    m.set(d, inner);
  }
  return [...m.entries()].map(([domain, people]) => ({ domain, people: people.size, jobs: [...people.values()].reduce((a, b) => a + b, 0) })).sort((a, b) => b.jobs - a.jobs);
}
