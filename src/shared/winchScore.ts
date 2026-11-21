// Winch scorecard (6z.43): one row per run and a job total, counting what broke the guidelines (speed, tension,
// jarring) with the top speeds and tension and the share of moving time kept inside the limits. The screen, the
// printout and the saved PDF all use it. Pure TypeScript.

import type { Finding, Sample } from './winchData';
import type { JarCycle, JarHit, SopFinding } from './winchRuns';
import { BRAIDED_LABEL } from './winchGuide';

/** What the scorecard needs from a run's report. */
export interface ScoreInput {
  run: { n: number; t0: number; t1: number; maxD: number; partial: boolean };
  a: { S: Sample[]; viol: Finding[] };
  speed: SopFinding[];
  jar: { cycles: JarCycle[]; hits: JarHit[]; findings: SopFinding[] };
  service?: string; isDefault?: boolean;
}

export interface ScoreRow {
  label: string; maxD: number; hours: number;
  maxRih: number; maxPooh: number; avgRih: number; avgPooh: number; maxT: number;
  speedFlags: number; tensionFlags: number; jarCycles: number; jarUp: number; jarDown: number; maxJar: number; jarFlags: number;
  total: number;
  /** Seconds over a speed or tension limit, and the share of moving time inside the limits (100 when nothing moved). */
  secOver: number; keptPct: number;
  defaultSpeeds: boolean;
  service: string;
}
export interface Scorecard { rows: ScoreRow[]; total: ScoreRow; byRule: { label: string; source: string; count: number }[] }

const SPEED_SEASONING = new Set(['nearSurface', 'maxPooh', 'curveSpeed', 'pumpSpeed']);
const isSpeed = (f: SopFinding) => f.unit === 'fpm';
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const max = (a: number[]) => a.reduce((m, v) => (v > m ? v : m), 0);

function row(r: ScoreInput): ScoreRow {
  const S = r.a.S;
  const rih = S.filter((s) => s.dir === 'RIH').map((s) => s.sp), pooh = S.filter((s) => s.dir === 'POOH').map((s) => s.sp);
  const seasonSpeed = r.a.viol.filter((v) => SPEED_SEASONING.has(v.rule));
  const seasonTension = r.a.viol.filter((v) => !SPEED_SEASONING.has(v.rule));
  const speedFlags = r.speed.filter(isSpeed).length + seasonSpeed.length;
  const tensionFlags = r.speed.filter((f) => !isSpeed(f)).length + seasonTension.length;
  const moving = S.filter((s) => s.dir !== 'STOP').reduce((t, s) => t + s.dt, 0);
  // the time with any speed or tension flag open, counting overlapping flags once
  const spans = [...r.speed, ...r.a.viol].map((f) => [f.t0, f.t1] as [number, number]).sort((a, b) => a[0] - b[0]);
  let secOver = 0, end = -Infinity;
  for (const [a, b] of spans) { if (b <= end) continue; secOver += b - Math.max(a, end); end = b; }
  secOver = Math.min(moving, secOver);
  const jarFlags = r.jar.findings.length;
  return {
    label: `Run ${r.run.n}`, maxD: r.run.maxD, hours: (r.run.t1 - r.run.t0) / 3600,
    maxRih: max(rih), maxPooh: max(pooh), avgRih: avg(rih), avgPooh: avg(pooh), maxT: max(S.map((s) => s.ten)),
    speedFlags, tensionFlags, jarCycles: r.jar.cycles.length,
    jarUp: r.jar.hits.filter((h) => h.kind === 'up').length, jarDown: r.jar.hits.filter((h) => h.kind === 'down').length,
    maxJar: max(r.jar.cycles.map((c) => c.peak)), jarFlags, total: speedFlags + tensionFlags + jarFlags,
    secOver, keptPct: moving > 0 ? Math.round(1000 * (1 - secOver / moving)) / 10 : 100,
    defaultSpeeds: !!r.isDefault, service: r.service ?? '',
  };
}

export function scorecard(reports: ScoreInput[]): Scorecard {
  const rows = reports.map(row);
  const sum = (k: keyof ScoreRow) => rows.reduce((t, x) => t + (x[k] as number), 0);
  const top = (k: keyof ScoreRow) => rows.reduce((m, x) => Math.max(m, x[k] as number), 0);
  const moving = reports.reduce((t, r) => t + r.a.S.filter((s) => s.dir !== 'STOP').reduce((u, s) => u + s.dt, 0), 0);
  const secOver = sum('secOver');
  const rihN = reports.reduce((t, r) => t + r.a.S.filter((s) => s.dir === 'RIH').length, 0), poohN = reports.reduce((t, r) => t + r.a.S.filter((s) => s.dir === 'POOH').length, 0);
  const total: ScoreRow = {
    label: 'Job', maxD: top('maxD'), hours: sum('hours'), maxRih: top('maxRih'), maxPooh: top('maxPooh'),
    avgRih: rihN ? rows.reduce((t, x, i) => t + x.avgRih * reports[i].a.S.filter((s) => s.dir === 'RIH').length, 0) / rihN : 0,
    avgPooh: poohN ? rows.reduce((t, x, i) => t + x.avgPooh * reports[i].a.S.filter((s) => s.dir === 'POOH').length, 0) / poohN : 0,
    maxT: top('maxT'), speedFlags: sum('speedFlags'), tensionFlags: sum('tensionFlags'), jarCycles: sum('jarCycles'), jarUp: sum('jarUp'), jarDown: sum('jarDown'),
    maxJar: top('maxJar'), jarFlags: sum('jarFlags'), total: sum('total'), secOver,
    keptPct: moving > 0 ? Math.round(1000 * (1 - secOver / moving)) / 10 : 100, defaultSpeeds: rows.some((x) => x.defaultSpeeds), service: '',
  };
  const counts = new Map<string, { label: string; source: string; count: number }>();
  const add = (label: string, source: string) => { const k = `${label}|${source}`; const c = counts.get(k) ?? { label, source, count: 0 }; c.count++; counts.set(k, c); };
  for (const r of reports) {
    for (const f of [...r.speed, ...r.jar.findings]) add(f.label, f.source);
    for (const v of r.a.viol) add(BRAIDED_LABEL[v.rule] ?? v.label, 'Seasoning rules');
  }
  return { rows, total, byRule: [...counts.values()].sort((a, b) => b.count - a.count) };
}
