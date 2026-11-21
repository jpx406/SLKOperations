import { describe, expect, it } from 'vitest';
import { guessChannels, parseTdat, tdatTable } from '../src/shared/lineminder';
import { demoLineminder, demoLineminderPair } from '../src/shared/winchDemo';
import { buildSamples, guessMapping, type Sample, type Table } from '../src/shared/winchData';
import { detectJarring, sopSpeedFindings, sopTensionFindings, splitRuns } from '../src/shared/winchRuns';
import {
  BRAIDED_CHECKS, GUIDE_DEFAULTS, braidedSop, braidedText, checkGuide, gapText, joinPlan, lineKind, listedServices, seasonedFromRuns,
  serviceMatches, speedsFor, staticAt, staticTension, wireSop, type FileSpan,
} from '../src/shared/winchGuide';

// 6z.42: wire or braided line, speeds by service, the static tension check, heavy jarring, saved guidelines and
// joining several winch files into one job

const toTable = (buf: ArrayBuffer): Table => {
  const f = parseTdat(buf);
  const g = guessChannels(f);
  return tdatTable(f, { channels: [g.depth, g.tension, g.speed], step: 0.2 });
};
const samples = (t: Table): Sample[] => buildSamples(t, guessMapping(t));
const limits = { mbs: 3000, mat: 0, spang: false };

describe('the line', () => {
  it('tells slickline wire from braided line by size or description', () => {
    expect(lineKind('0.125', 'SUPA75')).toBe('wire');
    expect(lineKind('0.16', 'Supernova 750')).toBe('wire');
    expect(lineKind('0.1875', 'Supernova 750')).toBe('braided');
    expect(lineKind('0.3125', 'SUPA 75')).toBe('braided');
    expect(lineKind(null, '3/16 braided')).toBe('braided');
    expect(lineKind(null, '0.125 in')).toBe('wire');
    expect(lineKind(null, null)).toBeNull();
  });

  it('calls a braided line seasoned from the run count', () => {
    expect(seasonedFromRuns(10, GUIDE_DEFAULTS.braided)).toBe(true);
    expect(seasonedFromRuns(9, GUIDE_DEFAULTS.braided)).toBe(false);
    expect(seasonedFromRuns(null, GUIDE_DEFAULTS.braided)).toBeNull();
  });

  it('keeps no horizontal-well words in the braided-line rules', () => {
    for (const R of [GUIDE_DEFAULTS.braided.seasoned, GUIDE_DEFAULTS.braided.newLine]) {
      for (const k of BRAIDED_CHECKS) expect(braidedText(R, k)).not.toMatch(/KOP|heel|lateral|curve|horizontal|TVD|pump/i);
    }
    expect(braidedText(GUIDE_DEFAULTS.braided.newLine, 'maxPooh')).toBe('400 fpm');
  });
});

describe('speeds by service', () => {
  const w = GUIDE_DEFAULTS.wire;
  it('takes the Speed Guidelines row for the service', () => {
    expect(speedsFor(w, 'Drift run')).toMatchObject({ speeds: { rih: 300, pooh: 300, surface: 30, restriction: 30 }, isDefault: false });
    expect(speedsFor(w, 'Pulling Tool')).toMatchObject({ speeds: { rih: 200 }, isDefault: false });
    expect(speedsFor(w, 'SBHP survey')).toMatchObject({ speeds: { rih: 120 }, group: 'Pressure surveys' });
    expect(serviceMatches('Gauge cutter', 'Gauge Cutter')).toBe(true);
    expect(serviceMatches('Plugging', 'Plug')).toBe(false);
    expect(serviceMatches('Interwell Plugs', 'Plug')).toBe(true);
    expect(serviceMatches('Bailer run', 'Bailers')).toBe(true);
    expect(serviceMatches('SBHP/FBHP survey', 'FBHP')).toBe(true);
  });

  it('uses the default speeds, flagged, for a service that is not listed or not set', () => {
    expect(speedsFor(w, 'Caliper log')).toEqual({ speeds: w.fallback, group: null, isDefault: true });
    expect(speedsFor(w, '')).toMatchObject({ isDefault: true });
    expect(listedServices(w)).toContain('LIB');
  });

  it('flags running faster than the service allows', () => {
    const S = samples(toTable(demoLineminder().buffer));
    const run1 = S.slice(splitRuns(S)[0].i0, splitRuns(S)[0].i1 + 1);
    // run 1 goes in at 150 ft/min and out at 180: fine for a gauge cutter (300), too fast for a service not listed (120)
    expect(sopSpeedFindings(run1, wireSop(GUIDE_DEFAULTS, speedsFor(w, 'Gauge Cutter').speeds, limits), [])).toEqual([]);
    const def = sopSpeedFindings(run1, wireSop(GUIDE_DEFAULTS, speedsFor(w, 'Caliper').speeds, limits), []).map((f) => f.rule);
    expect(def).toEqual(['maxRih', 'maxPooh']);
  });

  it('checks no service speeds or surface speed on braided line', () => {
    const sop = braidedSop(GUIDE_DEFAULTS, limits);
    expect([sop.maxRih, sop.maxPooh, sop.surfaceDepth, sop.rihFactor, sop.poohFactor]).toEqual([0, 0, 0, 0, 0]);
    const S = samples(toTable(demoLineminder().buffer));
    expect(sopSpeedFindings(S, sop, [])).toEqual([]);
  });
});

describe('tension against static', () => {
  // a made-up trip: 1 ft/s in with 600 lbs at 5,000 ft, out with 1,000 lbs: static 800, in at 0.75×, out at 1.25×
  const S: Sample[] = [];
  const at = (d: number, k: number) => (200 + d * 0.12) * k;
  let t = 0;
  for (let d = 0; d <= 5000; d += 1) S.push({ t: t++, depth: d, ten: at(d, 0.75), sp: 60, dir: 'RIH', dt: 1, phase: 'RIH', zone: 0, tvd: d });
  for (let d = 5000; d >= 0; d -= 1) S.push({ t: t++, depth: d, ten: at(d, 1.25), sp: 60, dir: 'POOH', dt: 1, phase: 'POOH', zone: 0, tvd: d });

  it('finds the static tension halfway between running in and pulling out', () => {
    const st = staticTension(S);
    expect(Math.round(staticAt(st, 3050)!)).toBe(Math.round(at(3050, 1)));
  });

  it('flags running in under 0.8 × static and pulling out over 1.2 × static', () => {
    const st = staticTension(S);
    const f = sopTensionFindings(S, wireSop(GUIDE_DEFAULTS, GUIDE_DEFAULTS.wire.fallback, limits), (d) => staticAt(st, d));
    expect(f.map((x) => x.rule)).toEqual(['rihTension', 'poohTension']);
    expect(f[0]).toMatchObject({ side: 'min', unit: 'lbs', source: 'Speed Guidelines' });
    expect(sopTensionFindings(S, braidedSop(GUIDE_DEFAULTS, limits), (d) => staticAt(st, d))).toEqual([]);
  });
});

describe('heavy jarring', () => {
  it('flags jarring over 1,300 lbs', () => {
    const S = samples(toTable(demoLineminder().buffer));
    const r = splitRuns(S)[1];
    const j = detectJarring(S.slice(r.i0, r.i1 + 1), wireSop(GUIDE_DEFAULTS, GUIDE_DEFAULTS.wire.fallback, limits));
    const heavy = j.findings.filter((f) => f.rule === 'jarHeavy');
    expect(heavy).toHaveLength(1);
    expect(heavy[0].note).toMatch(/MoC/);
  });
});

describe('saved guidelines', () => {
  it('keeps good values and puts the defaults back for broken ones', () => {
    expect(checkGuide(null)).toBeNull();
    const g = checkGuide({ wire: { surfaceDepth: 250, matPct: 'x', groups: [{ name: ' Fishing ', services: ['Overshot', ' ', 'Overshot', 5], rih: 90, pooh: -1 }] }, braided: { seasonedRuns: 12.4, newLine: { maxPooh: { limit: 350 } } } })!;
    expect(g.wire.surfaceDepth).toBe(250);
    expect(g.wire.matPct).toBe(60);
    expect(g.wire.groups).toEqual([{ id: 'g1', name: 'Fishing', services: ['Overshot'], surface: 30, rih: 90, pooh: 120, restriction: 30 }]);
    expect(g.braided.seasonedRuns).toBe(12);
    expect(g.braided.newLine.maxPooh.limit).toBe(350);
    expect(g.braided.newLine.nearSurface.tiers).toEqual(GUIDE_DEFAULTS.braided.newLine.nearSurface.tiers);
    expect(checkGuide({})!.wire.groups).toHaveLength(3);
  });
});

describe('joining files', () => {
  const span = (id: string, t0: number, t1: number, extra: Partial<FileSpan> = {}): FileSpan => ({ id, name: `${id}.da_tdat`, t0, t1, signature: 'A', format: 'lineminder', ...extra });

  it('joins files in time order and asks about a gap of more than a day', () => {
    expect(joinPlan([span('b', 5000, 6000), span('a', 0, 3000)], {})).toEqual({ use: ['a', 'b'], out: [], ask: [], problems: [] });
    const gap = joinPlan([span('a', 0, 3000), span('b', 3000 + 2 * 86400, 3000 + 2 * 86400 + 600)], {});
    expect(gap.ask).toEqual([{ id: 'b', after: 'a', gapSec: 2 * 86400 }]);
    expect(joinPlan([span('a', 0, 3000), span('b', 200000, 200600)], { b: 'same' })).toMatchObject({ use: ['a', 'b'], ask: [] });
    expect(joinPlan([span('a', 0, 3000), span('b', 200000, 200600)], { b: 'different' })).toMatchObject({ use: ['a'], out: ['b'], ask: [] });
    expect(gapText(2 * 86400 + 3 * 3600)).toBe('2 days 3 h');
  });

  it('will not join different kinds, different channels or the same time twice', () => {
    expect(joinPlan([span('a', 0, 100), span('b', 200, 300, { format: 'csv' })], {}).problems[0]).toMatch(/cannot be joined/);
    expect(joinPlan([span('a', 0, 100), span('b', 200, 300, { signature: 'B' })], {}).problems[0]).toMatch(/same channels/);
    expect(joinPlan([span('a', 0, 1000), span('b', 500, 1500)], {}).problems[0]).toMatch(/same time/);
  });

  it('finds the runs across two recordings of one job', () => {
    const [a, b] = demoLineminderPair();
    const ta = toTable(a.buffer), tb = toTable(b.buffer);
    const Sa = samples(ta), Sb = samples(tb);
    const plan = joinPlan([span('a', Sa[0].t, Sa[Sa.length - 1].t), span('b', Sb[0].t, Sb[Sb.length - 1].t)], {});
    expect(plan.ask).toHaveLength(1);
    expect(plan.ask[0].gapSec).toBeGreaterThan(86400);
    const S = samples({ ...ta, data: [...ta.data, ...tb.data] });
    const runs = splitRuns(S);
    expect(runs.map((r) => Math.round(r.maxD))).toEqual([5000, 6000]);
    expect(runs[1].t0 - runs[0].t1).toBeGreaterThan(2 * 86400 - 60);
  });
});
