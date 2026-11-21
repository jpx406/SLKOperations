// Winch guidelines (6z.42). Two kinds of line, two sets of rules:
// - slickline wire: the Speed Guidelines (NESR-8000-QAF-04-01, speeds by service) and the Jarring Guidelines
//   (QAF-SLK-Jarring-01), both attached to NESR-8000-SOP-04 in the Knowledge Hub;
// - braided line: the seasoning rules, new line (seasoning) or seasoned line (after a set number of runs), with the
//   horizontal-well rules taken out.
// An admin keeps the values for everyone; they are stored by the Worker. Also here: telling wire from braided line,
// the speeds for a run's service, and whether several winch files can be joined into one job.
// Pure TypeScript: the Closure tab runs it in the browser; the Worker checks saved values with it; tests run it in Node.

import { RULE_DEFAULTS, fmt, type CheckKey, type RuleKey, type RuleSet, type Sample } from './winchData';
import { SOP_DEFAULTS, type SopRules } from './winchRuns';

export type LineKind = 'wire' | 'braided';
export const LINE_LABEL: Record<LineKind, string> = { wire: 'Slickline wire', braided: 'Braided line' };

/** One row of the Speed Guidelines: the services it covers and their speeds in ft/min. */
export interface SpeedRow { id: string; name: string; services: string[]; surface: number; rih: number; pooh: number; restriction: number }
export type Speeds = Pick<SpeedRow, 'surface' | 'rih' | 'pooh' | 'restriction'>;

export interface WireGuide {
  /** Shallower than this the surface speed applies; this close to a restriction the restriction speed applies. */
  surfaceDepth: number; restrictionBand: number;
  groups: SpeedRow[];
  /** Used for a service that is not in any row, and flagged. */
  fallback: Speeds;
  /** Normal tension kept above rihFactor × static tension running in, below poohFactor × static pulling out (0: off). */
  rihFactor: number; poohFactor: number;
  /** Jarring Guidelines. */
  matPct: number; spangLimit: number; heavyLb: number; jarDownLossPct: number; cycleMin: number; restMin: number; maxCycles: number;
}
export interface BraidedGuide {
  /** A line with at least this many runs is seasoned. */
  seasonedRuns: number;
  seasoned: RuleSet; newLine: RuleSet;
}
export interface WinchGuide { wire: WireGuide; braided: BraidedGuide; detect: SopRules['detect'] }

const row = (id: string, name: string, services: string[], rih: number): SpeedRow => ({ id, name, services, surface: 30, rih, pooh: rih, restriction: 30 });

export const GUIDE_DEFAULTS: WinchGuide = {
  wire: {
    surfaceDepth: 200, restrictionBand: 100,
    groups: [
      row('g1', 'Gauge cutter, drift and brushing', ['Gauge Cutter', 'Drift', 'Check Set', 'Brush', 'Prong', 'LIB', 'Blind Box'], 300),
      row('g2', 'Plugs, pulling and bailing', ['Plug', 'Pulling Tool', 'RBP', 'Gauge Hanger', 'ACDC', 'Bailers', 'Finder Grab'], 200),
      row('g3', 'Pressure surveys', ['SBHP', 'FBHP'], 120),
    ],
    fallback: { surface: 30, rih: 120, pooh: 120, restriction: 30 },
    rihFactor: 0.8, poohFactor: 1.2,
    matPct: 60, spangLimit: 1450, heavyLb: 1300, jarDownLossPct: 20, cycleMin: 15, restMin: 10, maxCycles: 3,
  },
  braided: {
    seasonedRuns: 10,
    seasoned: { ...structuredClone(RULE_DEFAULTS.post), name: 'Seasoned line' },
    newLine: { ...structuredClone(RULE_DEFAULTS.seasoning), name: 'New line (seasoning)' },
  },
  detect: { ...SOP_DEFAULTS.detect },
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
/** Numbers from o over the defaults d, same shape; anything that is not a number keeps the default. */
function mergeNums<T>(d: T, o: unknown): T {
  if (Array.isArray(d)) {
    if (!Array.isArray(o) || o.length !== d.length) return structuredClone(d);
    return d.map((x, i) => mergeNums(x, o[i])) as T;
  }
  if (d && typeof d === 'object') {
    const src = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
    const out = {} as Record<string, unknown>;
    for (const [k, v] of Object.entries(d)) out[k] = mergeNums(v, src[k]);
    return out as T;
  }
  if (typeof d === 'number') return (isNum(o) ? o : d) as T;
  if (typeof d === 'string') return (typeof o === 'string' && o.trim() ? o.trim().slice(0, 80) : d) as T;
  return d;
}

/** Saved guidelines, checked: missing or broken values take the defaults; null when it is not an object at all. */
export function checkGuide(o: unknown): WinchGuide | null {
  if (!o || typeof o !== 'object') return null;
  const x = o as Partial<WinchGuide>;
  const w = (x.wire && typeof x.wire === 'object' ? x.wire : {}) as Partial<WireGuide>;
  const { groups: _g, ...wireNums } = GUIDE_DEFAULTS.wire;
  const groups: SpeedRow[] = Array.isArray(w.groups)
    ? w.groups.slice(0, 40).flatMap((g, i) => {
      if (!g || typeof g !== 'object') return [];
      const services = Array.isArray(g.services) ? [...new Set(g.services.filter((s): s is string => typeof s === 'string').map((s) => s.trim().slice(0, 60)).filter(Boolean))].slice(0, 40) : [];
      const name = typeof g.name === 'string' && g.name.trim() ? g.name.trim().slice(0, 80) : services.join(', ') || `Group ${i + 1}`;
      const sp = mergeNums(GUIDE_DEFAULTS.wire.fallback, g);
      return [{ id: typeof g.id === 'string' && g.id ? g.id.slice(0, 40) : `g${i + 1}`, name, services, ...sp }];
    })
    : structuredClone(GUIDE_DEFAULTS.wire.groups);
  const b = (x.braided && typeof x.braided === 'object' ? x.braided : {}) as Partial<BraidedGuide>;
  return {
    wire: { ...mergeNums(wireNums, w), groups },
    braided: {
      seasonedRuns: isNum(b.seasonedRuns) ? Math.round(b.seasonedRuns) : GUIDE_DEFAULTS.braided.seasonedRuns,
      seasoned: mergeNums(GUIDE_DEFAULTS.braided.seasoned, b.seasoned),
      newLine: mergeNums(GUIDE_DEFAULTS.braided.newLine, b.newLine),
    },
    detect: mergeNums(GUIDE_DEFAULTS.detect, x.detect),
  };
}

// ---------------------------------------------------------------- the line

/**
 * Wire or braided line, from the size in inches (slickline wire is 0.092–0.160", braided line 3/16" and up) or the
 * grade or description; null when nothing tells.
 */
export function lineKind(size: string | number | null | undefined, text?: string | null): LineKind | null {
  const t = String(text ?? '');
  if (/braid|strand|\b(3\/16|7\/32|1\/4|5\/16)\b/i.test(t)) return 'braided';
  const n = typeof size === 'number' ? size : Number.parseFloat(String(size ?? ''));
  if (Number.isFinite(n) && n > 0) return n >= 0.18 ? 'braided' : 'wire';
  if (/\b0?\.(092|108|125|140|150|160)\b|\bwire\b/i.test(t)) return 'wire';
  return null;
}

/** What the job's wire record says (from WIREGUARD): for the line kind, the breaking strength and the run count. */
export interface WinchLine { serial: string | null; grade: string | null; size: string | null; mbl: number | null; runs: number | null; kind: LineKind | null }

// ---------------------------------------------------------------- speeds for a service

// words without a plural s, so "Interwell Plugs" holds "Plug" and "Bailer" holds "Bailers"
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
/** A service name matches a listed one when either holds the other as whole words (e.g. "Drift run" and "Drift"). */
export function serviceMatches(service: string, listed: string): boolean {
  const a = ` ${norm(service)} `, b = ` ${norm(listed)} `;
  if (!a.trim() || !b.trim()) return false;
  return a.includes(b) || b.includes(a);
}

/** The speeds for a service: its row of the Speed Guidelines, or the fallback, flagged. */
export function speedsFor(g: WireGuide, service: string): { speeds: Speeds; group: string | null; isDefault: boolean } {
  const hit = service.trim() ? g.groups.find((r) => r.services.some((s) => serviceMatches(service, s))) : undefined;
  if (hit) return { speeds: { surface: hit.surface, rih: hit.rih, pooh: hit.pooh, restriction: hit.restriction }, group: hit.name, isDefault: false };
  return { speeds: { ...g.fallback }, group: null, isDefault: true };
}

/** Every service the Speed Guidelines list, in order, for the run's service list. */
export const listedServices = (g: WireGuide) => [...new Set(g.groups.flatMap((r) => r.services))];

/** The job inputs that are not guidelines: the breaking strength, the MAT and whether spang jars are run. */
export interface JobLimits { mbs: number; mat: number; spang: boolean }

/** The SOP-04 rules for one wire run with its service's speeds. */
export function wireSop(g: WinchGuide, speeds: Speeds, job: JobLimits): SopRules {
  const w = g.wire;
  return {
    surfaceDepth: w.surfaceDepth, surfaceSpeed: speeds.surface, restrictionBand: w.restrictionBand, restrictionSpeed: speeds.restriction,
    maxRih: speeds.rih, maxPooh: speeds.pooh, mbs: job.mbs, matPct: w.matPct, mat: job.mat, spang: job.spang, spangLimit: w.spangLimit,
    heavyLb: w.heavyLb, rihFactor: w.rihFactor, poohFactor: w.poohFactor,
    jarDownLossPct: w.jarDownLossPct, cycleMin: w.cycleMin, restMin: w.restMin, maxCycles: w.maxCycles, detect: { ...g.detect },
  };
}

/** The SOP-04 rules for a braided-line run: the seasoning rules carry the speeds, so only restrictions and jarring are checked here. */
export function braidedSop(g: WinchGuide, job: JobLimits): SopRules {
  const w = g.wire;
  return {
    surfaceDepth: 0, surfaceSpeed: 0, restrictionBand: w.restrictionBand, restrictionSpeed: w.fallback.restriction, maxRih: 0, maxPooh: 0,
    mbs: job.mbs, matPct: w.matPct, mat: job.mat, spang: job.spang, spangLimit: w.spangLimit, heavyLb: w.heavyLb, rihFactor: 0, poohFactor: 0,
    jarDownLossPct: w.jarDownLossPct, cycleMin: w.cycleMin, restMin: w.restMin, maxCycles: w.maxCycles, detect: { ...g.detect },
  };
}

// ---------------------------------------------------------------- braided-line rules, without the horizontal ones

/** The seasoning rules that apply in any well: near-surface and pulling speed, running and pulling tension. */
export const BRAIDED_CHECKS: CheckKey[] = ['nearSurface', 'maxPooh', 'rihTension', 'verticalTension'];
export const BRAIDED_LABEL: Partial<Record<RuleKey, string>> = {
  nearSurface: 'POOH speed near surface', maxPooh: 'Max POOH speed', rihTension: 'RIH tension', verticalTension: 'POOH tension', detect: 'Detection',
};
/** The editable fields of each braided-line rule, with the words used for them. */
export const BRAIDED_FIELDS: { key: RuleKey; fields: 'tiers' | { f: string; label: string; unit: string }[] }[] = [
  { key: 'nearSurface', fields: 'tiers' },
  { key: 'maxPooh', fields: [{ f: 'limit', label: 'Limit', unit: 'fpm' }] },
  { key: 'rihTension', fields: [{ f: 'overSpeed', label: 'Over speed', unit: 'lbs' }, { f: 'perKft', label: 'Per 1,000 ft', unit: 'lbs' }, { f: 'fromDepth', label: 'From', unit: 'ft' }] },
  { key: 'verticalTension', fields: [{ f: 'atKop', label: 'At the deepest point', unit: 'lbs' }, { f: 'perKftAbove', label: 'Less per 1,000 ft above', unit: 'lbs' }] },
  { key: 'detect', fields: [{ f: 'speedSec', label: 'Speed', unit: 's' }, { f: 'tensionSec', label: 'Tension', unit: 's' }, { f: 'mergeSec', label: 'Merge', unit: 's' }] },
];

/** What a braided-line rule says, in words, with the values filled in. */
export function braidedText(R: RuleSet, key: RuleKey): string {
  switch (key) {
    case 'nearSurface': return R.nearSurface.tiers.map(([d, v]) => `within ${fmt(d)} ft: ${fmt(v)} fpm`).join(' · ').replace(/^w/, 'W');
    case 'maxPooh': return `${fmt(R.maxPooh.limit)} fpm`;
    case 'rihTension': return `At least ${fmt(R.rihTension.overSpeed)} lbs over the line speed and ${fmt(R.rihTension.perKft)} lbs per 1,000 ft of depth (the stricter), from ${fmt(R.rihTension.fromDepth)} ft`;
    case 'verticalTension': return `Max ${fmt(R.verticalTension.atKop)} lbs at the deepest point of the run, ${fmt(R.verticalTension.perKftAbove)} lbs less per 1,000 ft above it`;
    case 'detect': return `A finding counts when it lasts ${fmt(R.detect.speedSec)} s or more (speed) or ${fmt(R.detect.tensionSec)} s or more (tension); findings less than ${fmt(R.detect.mergeSec)} s apart are one`;
    default: return '';
  }
}

/** Seasoned or new line from the run count; null when the count is not known. */
export const seasonedFromRuns = (runs: number | null, g: BraidedGuide): boolean | null => (runs == null ? null : runs >= g.seasonedRuns);

// ---------------------------------------------------------------- static tension (wire speed guidelines)

/**
 * The static tension against depth, in 100 ft steps: where the tools were both run in and pulled out at that depth,
 * halfway between the running and the pulling tension (friction works against each the same); else the tension while
 * stopped there. Null where neither is known.
 */
export function staticTension(S: Sample[], step = 100): { step: number; v: (number | null)[] } {
  const maxD = S.reduce((m, s) => Math.max(m, s.depth), 0);
  const n = Math.floor(maxD / step) + 1;
  const rih: number[][] = Array.from({ length: n }, () => []), pooh: number[][] = Array.from({ length: n }, () => []), stop: number[][] = Array.from({ length: n }, () => []);
  for (const s of S) {
    const b = Math.floor(s.depth / step);
    (s.dir === 'RIH' ? rih : s.dir === 'POOH' ? pooh : stop)[b].push(s.ten);
  }
  const med = (a: number[]) => { if (!a.length) return NaN; const c = [...a].sort((x, y) => x - y); const m = c.length >> 1; return c.length % 2 ? c[m] : (c[m - 1] + c[m]) / 2; };
  const v = rih.map((r, i) => {
    const a = med(r), b = med(pooh[i]);
    if (Number.isFinite(a) && Number.isFinite(b)) return (a + b) / 2;
    const c = med(stop[i]);
    return Number.isFinite(c) ? c : null;
  });
  return { step, v };
}
export const staticAt = (st: { step: number; v: (number | null)[] }, depth: number) => st.v[Math.min(st.v.length - 1, Math.max(0, Math.floor(depth / st.step)))] ?? null;

// ---------------------------------------------------------------- several files

export interface FileSpan { id: string; name: string; t0: number; t1: number; signature: string; format: 'lineminder' | 'csv' }
export type JoinAnswer = 'same' | 'different';
export interface JoinPlan {
  /** Files to join, in time order. */
  use: string[];
  /** Files left out: another job. */
  out: string[];
  /** Gaps over a day still waiting for an answer: the file after the gap and the gap in seconds. */
  ask: { id: string; after: string; gapSec: number }[];
  /** Reasons the files cannot be joined at all. */
  problems: string[];
}
export const JOIN_GAP_SEC = 86400;

/**
 * Whether the files can be joined into one job: the same kind of file with the same channels or columns, not
 * covering the same time. A gap of more than a day asks whether the next file is the same job; a different job is
 * left out.
 */
export function joinPlan(files: FileSpan[], answers: Record<string, JoinAnswer>): JoinPlan {
  const plan: JoinPlan = { use: [], out: [], ask: [], problems: [] };
  if (!files.length) return plan;
  const sorted = [...files].sort((a, b) => a.t0 - b.t0);
  if (new Set(sorted.map((f) => f.format)).size > 1) plan.problems.push('Lineminder recordings and text exports cannot be joined: add one kind only');
  const base = sorted[0];
  for (const f of sorted.slice(1)) {
    if (f.format === base.format && f.signature !== base.signature) {
      plan.problems.push(`${f.name} does not have the same ${f.format === 'lineminder' ? 'channels' : 'columns'} as ${base.name}`);
    }
  }
  let last: FileSpan | null = null;
  for (const f of sorted) {
    if (last) {
      if (f.t0 < last.t1 - 60) { plan.problems.push(`${f.name} covers the same time as ${last.name}: remove one of them`); }
      const gap = f.t0 - last.t1;
      if (gap > JOIN_GAP_SEC) {
        const a = answers[f.id];
        if (a === 'different') { plan.out.push(f.id); continue; }
        if (a !== 'same') plan.ask.push({ id: f.id, after: last.id, gapSec: gap });
      }
    }
    plan.use.push(f.id);
    last = f;
  }
  return plan;
}

/** "3 days 4 h" for a gap. */
export function gapText(sec: number): string {
  const d = Math.floor(sec / 86400), h = Math.round((sec % 86400) / 3600);
  return [d && `${d} day${d > 1 ? 's' : ''}`, h && `${h} h`].filter(Boolean).join(' ') || 'under an hour';
}
