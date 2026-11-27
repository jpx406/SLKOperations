// Winch data, runs and SOP-04 (6z.41). A Lineminder recording or a winch export often holds a whole job: several
// runs, each from surface down and back to surface. This splits the samples into runs, checks each against the
// speed rules and detects jarring and checks it against the jarring rules of NESR-8000-SOP-04 Winch Operations
// (6.2 Wire speed guidelines, 8.3 Wire cycling and jarring operations). Every limit can be changed; the BHA speed
// table and the jarring flow chart live in the Speed Guidelines and Jarring Guidelines documents of the Knowledge Hub.
// Pure TypeScript: the Closure tab runs it in the browser; tests run it in Node.

import { median, medianTension, type Sample } from './winchData';

// ---------------------------------------------------------------- runs

export interface Run {
  /** 1-based run number. */
  n: number;
  i0: number; i1: number;
  t0: number; t1: number;
  maxD: number;
  /** The recording started or ended with the tools in the hole. */
  partial: boolean;
}

/**
 * Runs: from the tools leaving surface (deeper than surfaceFt) until they are back above it. A run must reach
 * minRunFt and last a minute; each run keeps the surface samples on either side, so the speed near surface is checked.
 */
export function splitRuns(S: Sample[], opts: { surfaceFt?: number; minRunFt?: number } = {}): Run[] {
  const surface = opts.surfaceFt ?? 30, minRun = opts.minRunFt ?? 200;
  const runs: Run[] = [];
  let i = 0;
  while (i < S.length) {
    while (i < S.length && S[i].depth <= surface) i++;
    if (i >= S.length) break;
    const start = i;
    let maxD = S[i].depth;
    while (i < S.length && S[i].depth > surface) { if (S[i].depth > maxD) maxD = S[i].depth; i++; }
    const i0 = Math.max(0, start - 1), i1 = Math.min(S.length - 1, i);
    const partial = start === 0 || i >= S.length;
    if (maxD >= minRun && S[i1].t - S[i0].t >= 60) runs.push({ n: runs.length + 1, i0, i1, t0: S[i0].t, t1: S[i1].t, maxD, partial });
  }
  return runs;
}

// ---------------------------------------------------------------- SOP-04 rules

export interface SopRules {
  /** 6.2: BHA shallower than this: speed at or below surfaceSpeed. */
  surfaceDepth: number; surfaceSpeed: number;
  /** 6.2: within this distance of a restriction (SSSV, nipple, hanger, GLM…): speed at or below restrictionSpeed. */
  restrictionBand: number; restrictionSpeed: number;
  /** 6.4 / Speed Guidelines: running and pulling speed for the BHA; 0 means not checked. */
  maxRih: number; maxPooh: number;
  /** 8.3: the wire's minimum breaking strength, lbs (0 when not known). */
  mbs: number;
  /** 8.3: jarring up never over this share of the breaking strength. */
  matPct: number;
  /** 8.3: Maximum Allowable Tension set by management with the client, lbs; 0 uses matPct of the breaking strength. */
  mat: number;
  /** 8.3: spang jars in the string: their limit applies. */
  spang: boolean; spangLimit: number;
  /** Jarring Guidelines: jarring over this is heavy jarring, which needs a new program and an MoC (0: not checked). */
  heavyLb: number;
  /** Speed Guidelines: normal tension above rihFactor × static running in, below poohFactor × static pulling out (0: not checked). */
  rihFactor: number; poohFactor: number;
  /** 8.3: jarring down never loses more than this share of the normal tension. */
  jarDownLossPct: number;
  /** 8.3: at most maxCycles cycles of cycleMin minutes of jarring, with restMin minutes of rest between. */
  cycleMin: number; restMin: number; maxCycles: number;
  detect: {
    /** Stationary: the depth moves less than this over the window. */
    stationaryFt: number; windowSec: number;
    /** A jar up: tension over the normal tension by this much (the larger of the two). */
    upMinLb: number; upPct: number;
    /** A jar down: tension under the normal tension by this share. */
    downPct: number;
    /** Hits less than this apart are one cycle. */
    gapSec: number;
    /** A speed finding counts when it lasts this long; findings less than mergeSec apart are one. */
    minSec: number; mergeSec: number;
    /** A tension finding counts when it lasts this long. */
    tensionSec: number;
  };
}

export const SOP_DEFAULTS: SopRules = {
  surfaceDepth: 200, surfaceSpeed: 30,
  restrictionBand: 100, restrictionSpeed: 30,
  maxRih: 0, maxPooh: 0,
  mbs: 0, matPct: 60, mat: 0,
  spang: false, spangLimit: 1450, heavyLb: 1300, rihFactor: 0, poohFactor: 0,
  jarDownLossPct: 20,
  cycleMin: 15, restMin: 10, maxCycles: 3,
  detect: { stationaryFt: 30, windowSec: 60, upMinLb: 150, upPct: 15, downPct: 10, gapSec: 120, minSec: 3, mergeSec: 30, tensionSec: 5 },
};

/** The jar-up limit in lbs: the MAT if set, else matPct of the breaking strength; null when neither is known. */
export function jarUpLimit(R: SopRules): { limit: number; from: string } | null {
  if (R.mat > 0) return { limit: R.mat, from: 'MAT' };
  if (R.mbs > 0) return { limit: (R.mbs * R.matPct) / 100, from: `${R.matPct}% of the breaking strength` };
  return null;
}

export interface Restriction { depth: number; label: string }

/** Restrictions typed as "650 SSSV, 7450 X nipple" or one per line. */
export function parseRestrictions(text: string): Restriction[] {
  return text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(\d+(?:\.\d+)?)\s*(?:ft)?\s*(.*)$/i);
    return m ? { depth: parseFloat(m[1]), label: m[2].trim() || 'restriction' } : null;
  }).filter((r): r is Restriction => !!r && r.depth > 0).sort((a, b) => a.depth - b.depth);
}

// ---------------------------------------------------------------- findings

export type SopRuleKey = 'surfaceSpeed' | 'restrictionSpeed' | 'maxRih' | 'maxPooh' | 'rihTension' | 'poohTension' | 'jarMat' | 'jarSpang' | 'jarHeavy' | 'jarDown' | 'jarCycle' | 'jarRest' | 'jarCycles';
export const SOP_LABEL: Record<SopRuleKey, string> = {
  surfaceSpeed: 'Speed near surface', restrictionSpeed: 'Speed at a restriction', maxRih: 'RIH speed for the service', maxPooh: 'POOH speed for the service',
  rihTension: 'RIH tension against static', poohTension: 'POOH tension against static',
  jarMat: 'Jar-up tension', jarSpang: 'Spang jar limit', jarHeavy: 'Heavy jarring', jarDown: 'Jar-down tension loss', jarCycle: 'Jarring cycle too long', jarRest: 'Rest between cycles too short', jarCycles: 'Too many jarring cycles',
};
/** Where each rule comes from, for the report. */
export const SOP_SOURCE: Record<SopRuleKey, string> = {
  surfaceSpeed: 'Speed Guidelines', restrictionSpeed: 'Speed Guidelines', maxRih: 'Speed Guidelines', maxPooh: 'Speed Guidelines',
  rihTension: 'Speed Guidelines', poohTension: 'Speed Guidelines',
  jarMat: 'Jarring Guidelines', jarSpang: 'Jarring Guidelines', jarHeavy: 'Jarring Guidelines', jarDown: 'SOP-04 8.3', jarCycle: 'Jarring Guidelines', jarRest: 'Jarring Guidelines', jarCycles: 'Jarring Guidelines',
};

export interface SopFinding {
  rule: SopRuleKey; label: string; source: string;
  t0: number; t1: number; sec: number; d0: number; d1: number; dir: Sample['dir'];
  worst: number; limit: number; unit: string; side: 'min' | 'max';
  /** Extra words, e.g. the restriction or the cycle. */
  note: string;
}

/** Speed against SOP-04 6.2 and the BHA speeds: one finding per stretch over the limit. */
export function sopSpeedFindings(S: Sample[], R: SopRules, restrictions: Restriction[]): SopFinding[] {
  const limitAt = (s: Sample): { key: SopRuleKey; limit: number; note: string } | null => {
    if (s.dir === 'STOP') return null;
    const opts: { key: SopRuleKey; limit: number; note: string }[] = [];
    if (R.surfaceDepth > 0 && s.depth < R.surfaceDepth) opts.push({ key: 'surfaceSpeed', limit: R.surfaceSpeed, note: `shallower than ${R.surfaceDepth} ft` });
    const near = R.restrictionBand > 0 ? restrictions.find((r) => Math.abs(s.depth - r.depth) <= R.restrictionBand) : undefined;
    if (near) opts.push({ key: 'restrictionSpeed', limit: R.restrictionSpeed, note: `${near.label} at ${near.depth} ft` });
    if (s.dir === 'RIH' && R.maxRih > 0) opts.push({ key: 'maxRih', limit: R.maxRih, note: '' });
    if (s.dir === 'POOH' && R.maxPooh > 0) opts.push({ key: 'maxPooh', limit: R.maxPooh, note: '' });
    const over = opts.filter((o) => s.sp > o.limit).sort((a, b) => a.limit - b.limit);
    return over[0] ?? null;
  };
  const out: SopFinding[] = [];
  let cur: SopFinding | null = null;
  const flush = () => { if (cur && cur.sec >= R.detect.minSec) out.push(cur); cur = null; };
  for (const s of S) {
    const L = limitAt(s);
    if (!L || (cur && cur.rule !== L.key)) flush();
    if (!L) continue;
    if (!cur) {
      cur = { rule: L.key, label: SOP_LABEL[L.key], source: SOP_SOURCE[L.key], t0: s.t, t1: s.t + s.dt, sec: s.dt, d0: s.depth, d1: s.depth, dir: s.dir, worst: s.sp, limit: L.limit, unit: 'fpm', side: 'max', note: L.note };
    } else {
      cur.t1 = s.t + s.dt; cur.sec += s.dt; cur.d0 = Math.min(cur.d0, s.depth); cur.d1 = Math.max(cur.d1, s.depth);
      if (s.sp > cur.worst) cur.worst = s.sp;
    }
  }
  flush();
  const merged: SopFinding[] = [];
  for (const e of out) {
    const p = merged[merged.length - 1];
    if (p && p.rule === e.rule && p.dir === e.dir && e.t0 - p.t1 < R.detect.mergeSec) {
      p.t1 = e.t1; p.sec = p.t1 - p.t0; p.d0 = Math.min(p.d0, e.d0); p.d1 = Math.max(p.d1, e.d1); p.worst = Math.max(p.worst, e.worst);
    } else merged.push(e);
  }
  return merged;
}

/**
 * Tension against the static tension at the same depth (Speed Guidelines): running in, the normal tension stays over
 * rihFactor × static; pulling out, under poohFactor × static. Checked deeper than the surface stretch only.
 */
export function sopTensionFindings(S: Sample[], R: SopRules, staticAt: (depth: number) => number | null): SopFinding[] {
  if (!(R.rihFactor > 0) && !(R.poohFactor > 0)) return [];
  const out: SopFinding[] = [];
  let cur: SopFinding | null = null;
  const flush = () => { if (cur && cur.sec >= R.detect.tensionSec) out.push(cur); cur = null; };
  const ten = medianTension(S);
  for (let k = 0; k < S.length; k++) {
    const s = { ...S[k], ten: ten[k] };
    let L: { key: SopRuleKey; limit: number; side: 'min' | 'max' } | null = null;
    const st = s.dir === 'STOP' || s.depth < Math.max(R.surfaceDepth, 100) ? null : staticAt(s.depth);
    if (st && st > 0) {
      if (s.dir === 'RIH' && R.rihFactor > 0 && s.ten < st * R.rihFactor) L = { key: 'rihTension', limit: st * R.rihFactor, side: 'min' };
      if (s.dir === 'POOH' && R.poohFactor > 0 && s.ten > st * R.poohFactor) L = { key: 'poohTension', limit: st * R.poohFactor, side: 'max' };
    }
    if (!L || (cur && cur.rule !== L.key)) flush();
    if (!L) continue;
    const note = `static ${Math.round(st!)} lbs × ${L.key === 'rihTension' ? R.rihFactor : R.poohFactor}`;
    if (!cur) {
      cur = { rule: L.key, label: SOP_LABEL[L.key], source: SOP_SOURCE[L.key], t0: s.t, t1: s.t + s.dt, sec: s.dt, d0: s.depth, d1: s.depth, dir: s.dir, worst: s.ten, limit: L.limit, unit: 'lbs', side: L.side, note };
    } else {
      cur.t1 = s.t + s.dt; cur.sec += s.dt; cur.d0 = Math.min(cur.d0, s.depth); cur.d1 = Math.max(cur.d1, s.depth);
      if (L.side === 'min' ? s.ten < cur.worst : s.ten > cur.worst) Object.assign(cur, { worst: s.ten, limit: L.limit, note });
    }
  }
  flush();
  const merged: SopFinding[] = [];
  for (const e of out) {
    const p = merged[merged.length - 1];
    if (p && p.rule === e.rule && e.t0 - p.t1 < R.detect.mergeSec) {
      p.t1 = e.t1; p.sec = p.t1 - p.t0; p.d0 = Math.min(p.d0, e.d0); p.d1 = Math.max(p.d1, e.d1);
      if (e.side === 'min' ? e.worst < p.worst : e.worst > p.worst) Object.assign(p, { worst: e.worst, limit: e.limit, note: e.note });
    } else merged.push(e);
  }
  return merged;
}

// ---------------------------------------------------------------- jarring

export interface JarHit { t: number; depth: number; kind: 'up' | 'down'; ten: number; normal: number }
export interface JarCycle {
  n: number; t0: number; t1: number; depth: number; normal: number;
  up: number; down: number; peak: number; low: number;
  /** Rest since the cycle before at the same place, seconds; null for the first. */
  restBefore: number | null;
}
export interface Jarring { hits: JarHit[]; cycles: JarCycle[]; findings: SopFinding[]; limit: ReturnType<typeof jarUpLimit> }

/** Index ranges where the depth stays within stationaryFt over the window: the tools held in one place. */
function stationaryStretches(S: Sample[], R: SopRules): [number, number][] {
  const half = R.detect.windowSec / 2;
  const still = new Uint8Array(S.length);
  // a sliding window over time, with running min and max of the depth
  const minQ: number[] = [], maxQ: number[] = [];
  let lo = 0, hi = 0;
  for (let i = 0; i < S.length; i++) {
    while (hi < S.length && S[hi].t <= S[i].t + half) {
      while (minQ.length && S[minQ[minQ.length - 1]].depth >= S[hi].depth) minQ.pop();
      while (maxQ.length && S[maxQ[maxQ.length - 1]].depth <= S[hi].depth) maxQ.pop();
      minQ.push(hi); maxQ.push(hi); hi++;
    }
    while (S[lo].t < S[i].t - half) lo++;
    while (minQ[0] < lo) minQ.shift();
    while (maxQ[0] < lo) maxQ.shift();
    still[i] = S[maxQ[0]].depth - S[minQ[0]].depth < R.detect.stationaryFt ? 1 : 0;
  }
  const out: [number, number][] = [];
  for (let i = 0; i < S.length;) {
    if (!still[i]) { i++; continue; }
    let j = i;
    while (j + 1 < S.length && still[j + 1]) j++;
    if (S[j].t - S[i].t >= 20) out.push([i, j]);
    i = j + 1;
  }
  return out;
}

/**
 * Jarring, from the tension while the tools are held in one place: a jar up is a sharp tension peak over the normal
 * tension that releases within seconds (the jar fired); a jar down is a sharp drop under it that recovers. Hits less
 * than gapSec apart make one cycle. The normal tension is the median tension of the stretch.
 */
export function detectJarring(S: Sample[], R: SopRules): Jarring {
  const hits: JarHit[] = [];
  for (const [a, b] of stationaryStretches(S, R)) {
    if (S[a].depth < 50) continue; // at surface: rigging, not jarring
    const normal = median(S.slice(a, b + 1).map((s) => s.ten));
    if (!(normal > 0)) continue;
    const upAt = normal + Math.max(R.detect.upMinLb, (normal * R.detect.upPct) / 100);
    const downAt = normal * (1 - R.detect.downPct / 100);
    for (let i = a + 1; i <= b; i++) {
      const s = S[i];
      if (s.ten >= upAt) {
        // follow the pull to its top, then fired: within 5 s of the top the tension falls back at least half way
        let top = i;
        let j = i + 1, fired = false;
        while (j <= b && S[j].t - S[top].t <= 5) {
          if (S[j].ten > S[top].ten) top = j;
          else if (S[j].ten <= normal + (S[top].ten - normal) / 2) { fired = true; break; }
          j++;
        }
        if (fired) hits.push({ t: S[top].t, depth: S[top].depth, kind: 'up', ten: S[top].ten, normal });
        i = j;
      } else if (s.ten <= downAt) {
        let low = i;
        let j = i + 1, back = false;
        while (j <= b && S[j].t - S[low].t <= 5) {
          if (S[j].ten < S[low].ten) low = j;
          else if (S[j].ten >= normal - (normal - S[low].ten) / 2) { back = true; break; }
          j++;
        }
        if (back) hits.push({ t: S[low].t, depth: S[low].depth, kind: 'down', ten: S[low].ten, normal });
        i = j;
      }
    }
  }
  hits.sort((x, y) => x.t - y.t);
  const cycles: JarCycle[] = [];
  for (const h of hits) {
    const c = cycles[cycles.length - 1];
    if (c && h.t - c.t1 <= R.detect.gapSec && Math.abs(h.depth - c.depth) < 100) {
      c.t1 = h.t; if (h.kind === 'up') c.up++; else c.down++;
      c.peak = Math.max(c.peak, h.ten); c.low = Math.min(c.low, h.ten);
    } else {
      const prev = c && Math.abs(h.depth - c.depth) < 100 ? c : null;
      cycles.push({ n: cycles.length + 1, t0: h.t, t1: h.t, depth: h.depth, normal: h.normal, up: h.kind === 'up' ? 1 : 0, down: h.kind === 'down' ? 1 : 0, peak: h.ten, low: h.ten, restBefore: prev ? h.t - prev.t1 : null });
    }
  }
  const limit = jarUpLimit(R);
  const findings: SopFinding[] = [];
  const f = (rule: SopRuleKey, c: JarCycle, worst: number, lim: number, unit: string, side: 'min' | 'max', note: string) => findings.push({
    rule, label: SOP_LABEL[rule], source: SOP_SOURCE[rule], t0: c.t0, t1: c.t1, sec: c.t1 - c.t0, d0: c.depth, d1: c.depth, dir: 'STOP', worst, limit: lim, unit, side, note,
  });
  let atPlace = 0, lastDepth = NaN;
  for (const c of cycles) {
    // cycles at the same place (within 100 ft) are counted together
    atPlace = Math.abs(c.depth - lastDepth) < 100 ? atPlace + 1 : 1;
    lastDepth = c.depth;
    const cyc = `cycle ${c.n} at ${Math.round(c.depth)} ft`;
    if (limit && c.up && c.peak > limit.limit) f('jarMat', c, c.peak, limit.limit, 'lbs', 'max', `${cyc}; limit is the ${limit.from}`);
    if (R.spang && c.up && c.peak > R.spangLimit) f('jarSpang', c, c.peak, R.spangLimit, 'lbs', 'max', cyc);
    if (R.heavyLb > 0 && c.up && c.peak > R.heavyLb) f('jarHeavy', c, c.peak, R.heavyLb, 'lbs', 'max', `${cyc}: heavy jarring needs a new program and an MoC approved by the NESR OM`);
    const lowest = c.normal * (1 - R.jarDownLossPct / 100);
    if (c.down && c.low < lowest) f('jarDown', c, c.low, lowest, 'lbs', 'min', `${cyc}; normal tension ${Math.round(c.normal)} lbs`);
    if (c.t1 - c.t0 > R.cycleMin * 60) f('jarCycle', c, (c.t1 - c.t0) / 60, R.cycleMin, 'min', 'max', cyc);
    if (c.restBefore !== null && c.restBefore < R.restMin * 60) f('jarRest', c, c.restBefore / 60, R.restMin, 'min', 'min', `before ${cyc}`);
    if (atPlace === R.maxCycles + 1) f('jarCycles', c, atPlace, R.maxCycles, 'cycles', 'max', `${cyc}: shear and pull out, cut the wire and re-test it`);
  }
  return { hits, cycles, findings, limit };
}

// ---------------------------------------------------------------- the samples the checks read (6z.60)

/** The times the tools were held for jarring: each cycle, padded a few seconds either side. */
export const heldTimes = (j: Jarring, padSec = 10): [number, number][] => j.cycles.map((c) => [c.t0 - padSec, c.t1 + padSec]);

/**
 * The samples as the time view reads them, for the speed and tension checks, the depth view and the top speeds.
 * The speed is the depth's change over windowSec of time (the depth against time curve), not the speed channel, so
 * a half-second spike from a jar stroke or a noisy sensor is not taken for running speed. The tools count as held,
 * not running in or out, while jarring (held) and while worked up and down in one place: over a minute the depth stays
 * within workFt while the line travels at least twice that back and forth. The tension is kept as recorded, so the
 * jarring peaks still show.
 */
export function steadySamples(S: Sample[], opts: { windowSec?: number; held?: [number, number][]; workFt?: number } = {}): Sample[] {
  const half = (opts.windowSec ?? 5) / 2, workFt = opts.workFt ?? 100, held = opts.held ?? [];
  const out = S.map((s) => ({ ...s }));
  if (!S.length) return out;
  // the speed from the depth over the window
  let a = 0, b = 0;
  for (let i = 0; i < S.length; i++) {
    while (S[a].t < S[i].t - half) a++;
    while (b + 1 < S.length && S[b + 1].t <= S[i].t + half) b++;
    const slope = S[b].t > S[a].t ? ((S[b].depth - S[a].depth) / (S[b].t - S[a].t)) * 60 : 0;
    out[i].sp = Math.abs(slope);
    out[i].dir = slope > 15 ? 'RIH' : slope < -15 ? 'POOH' : 'STOP';
  }
  // worked in one place: over a minute, a small depth range but a long way travelled back and forth
  const path = [0];
  for (let i = 1; i < S.length; i++) path.push(path[i - 1] + Math.abs(S[i].depth - S[i - 1].depth));
  const minQ: number[] = [], maxQ: number[] = [];
  let lo = 0, hi = -1;
  for (let i = 0; i < S.length; i++) {
    while (hi + 1 < S.length && S[hi + 1].t <= S[i].t + 30) {
      hi++;
      while (minQ.length && S[minQ[minQ.length - 1]].depth >= S[hi].depth) minQ.pop();
      while (maxQ.length && S[maxQ[maxQ.length - 1]].depth <= S[hi].depth) maxQ.pop();
      minQ.push(hi); maxQ.push(hi);
    }
    while (S[lo].t < S[i].t - 30) lo++;
    while (minQ[0] < lo) minQ.shift();
    while (maxQ[0] < lo) maxQ.shift();
    const range = S[maxQ[0]].depth - S[minQ[0]].depth;
    const worked = S[i].depth > 50 && range < workFt && path[hi] - path[lo] > 2 * Math.max(range, 10);
    if (worked || held.some(([x, y]) => S[i].t >= x && S[i].t <= y)) out[i].dir = 'STOP';
  }
  return out;
}


// ---------------------------------------------------------------- the CSV

export function sopCsv(runs: { n: number; findings: SopFinding[] }[], clock: (t: number) => string): string {
  const head = ['Run', 'Rule', 'Source', 'Start', 'End', 'Seconds', 'From ft', 'To ft', 'Direction', 'Worst', 'Limit', 'Unit', 'Note'];
  const q = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = runs.flatMap((r) => r.findings.map((f) => [r.n, f.label, f.source, clock(f.t0), clock(f.t1), Math.round(f.sec), Math.round(f.d0), Math.round(f.d1), f.dir, Math.round(f.worst * 10) / 10, Math.round(f.limit * 10) / 10, f.unit, f.note]));
  return [head, ...rows].map((r) => r.map(q).join(',')).join('\n');
}
