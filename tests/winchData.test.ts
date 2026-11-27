import { describe, expect, it } from 'vitest';
import {
  RULE_DEFAULTS, analyse, autoTimeMode, buildSamples, demoRun, findingsCsv, guessMapping,
  limitFor, manualSurvey, mappingProblems, parseTable, parseTime, tvdAt, zoneOf, type Sample,
} from '../src/shared/winchData';

// a repeatable random source, so the demo run is the same every time
const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

describe('winch data: reading the file (6z.26)', () => {
  it('finds the delimiter, skips a preamble and keeps the header', () => {
    const t = parseTable('Unit WL-2\nWell 12\nTime,Depth (m),Speed (m/min),Tension (kgf)\n21:46:00,0,0,50\n21:46:01,1.5,90,52\n21:46:02,3,90,54\n');
    expect(t.delim).toBe('comma');
    expect(t.hasHeader).toBe(true);
    expect(t.header).toEqual(['Time', 'Depth (m)', 'Speed (m/min)', 'Tension (kgf)']);
    expect(t.data).toHaveLength(3);
    const m = guessMapping(t);
    expect([m.time, m.depth, m.speed, m.tension]).toEqual([0, 1, 2, 3]);
    expect([m.depthUnit, m.speedUnit, m.tensionUnit]).toEqual(['m', 'mpm', 'kgf']);
    expect(mappingProblems(t, m)).toEqual([]);
  });

  it('numbers the columns when there is no header and flags a clash', () => {
    const t = parseTable('1\t100\t5\t900\n2\t110\t5\t905\n3\t120\t5\t910\n');
    expect(t.hasHeader).toBe(false);
    expect(t.header[0]).toBe('Column 1');
    const m = guessMapping(t);
    expect(mappingProblems(t, { ...m, tension: m.depth })).toContain('Depth and tension point to the same column');
  });

  it('reads clock, date and elapsed times', () => {
    expect(autoTimeMode('21:46:05')).toBe('clock');
    expect(autoTimeMode('2026-11-04 21:46:05')).toBe('datetime');
    expect(autoTimeMode('12.5')).toBe('elapsed_s');
    expect(autoTimeMode('1762292765')).toBe('epoch');
    expect(parseTime('09:30:15 PM', 'clock')).toBe(21 * 3600 + 30 * 60 + 15);
    expect(parseTime('2026-11-04 00:00:10', 'datetime')).toBe(Date.UTC(2026, 10, 4) / 1000 + 10);
    expect(parseTime('2', 'elapsed_min')).toBe(120);
    expect(parseTime('1762292765000', 'epoch')).toBe(1762292765);
  });
});

describe('winch data: well zones', () => {
  it('takes four depths in order, and refuses them out of order', () => {
    const sv = manualSurvey(7278, 9853, 10934, 26415)!;
    expect(sv.source).toBe('manual');
    expect([zoneOf(sv, 100), zoneOf(sv, 8000), zoneOf(sv, 10000), zoneOf(sv, 20000)]).toEqual([0, 1, 2, 3]);
    expect(tvdAt(sv, 5000)).toBeCloseTo(5000);
    expect(tvdAt(sv, 20000)).toBeLessThan(11000);
    expect(manualSurvey(9000, 8000, 10000, 12000)).toBeNull();
  });

});

describe('winch data: rules', () => {
  it('applies the near-surface tiers and the TVD rule for RIH tension', () => {
    const sv = manualSurvey(7278, 9853, 10934, 26415)!;
    const s = (o: Partial<Sample>): Sample => ({ t: 0, depth: 0, ten: 0, sp: 0, dir: 'POOH', dt: 1, phase: 'POOH', zone: 0, tvd: 0, ...o });
    expect(limitFor('nearSurface', s({ depth: 80 }), RULE_DEFAULTS.post, sv, NaN)).toEqual({ max: 100 });
    expect(limitFor('nearSurface', s({ depth: 2000 }), RULE_DEFAULTS.post, sv, NaN)).toBeNull();
    expect(limitFor('rihTension', s({ dir: 'RIH', phase: 'RIH', depth: 5000, tvd: 5000, sp: 300 }), RULE_DEFAULTS.post, sv, NaN)).toEqual({ min: 500 });
    expect(limitFor('pumpTension', s({ dir: 'RIH', phase: 'RIH', zone: 3, depth: 15000 }), RULE_DEFAULTS.post, sv, 900)).toEqual({ min: 650, max: 1150 });
  });
});

describe('winch data: checking a run', () => {
  const demo = demoRun(seeded());
  const t = parseTable(demo.text);
  const S = buildSamples(t, guessMapping(t));
  const sv = manualSurvey(demo.survey.kop, demo.survey.p30, demo.survey.lat, demo.survey.td)!;
  const a = analyse(S, sv, structuredClone(RULE_DEFAULTS), 'post');

  it('splits the demo run into its phases', () => {
    expect(a.kpi.maxD).toBeGreaterThan(21_400);
    expect(a.P.iStart).toBeLessThan(a.P.iBottom);
    expect(a.P.iBottom).toBeLessThan(a.P.iSteady);
    // eight minutes on bottom for the plug and perf
    expect(a.kpi.bottomSec).toBeGreaterThanOrEqual(8 * 60);
    expect(a.kpi.avgRih).toBeGreaterThan(300);
  });

  it('finds the breaks built into the demo', () => {
    const rules = new Set(a.viol.map((v) => v.rule));
    // POOH over 2,400 lbs in the lateral, over 2,100 lbs in the heel, and too fast through the heel and near surface
    expect(rules).toContain('lateralTension');
    expect(rules).toContain('curveSpeed');
    expect(rules).toContain('verticalTension');
    expect(a.kpi.nViol).toBe(a.viol.length);
    expect(a.zones).toHaveLength(4);
    expect(Number.isNaN(a.LW)).toBe(false);
  });

  it('the seasoning set is stricter than post-seasoning', () => {
    const b = analyse(S, sv, structuredClone(RULE_DEFAULTS), 'seasoning');
    expect(b.viol.length).toBeGreaterThanOrEqual(a.viol.length);
  });

  it('exports the findings as CSV, one row each', () => {
    const csv = findingsCsv(a).split('\n');
    expect(csv[0]).toBe('time,lasted_s,depth_from_ft,depth_to_ft,zone,direction,rule,worst,unit,limit_side,limit,delta,type');
    expect(csv).toHaveLength(1 + a.viol.length + a.advice.length);
  });
});

describe('winch data: speed and tension as the time view reads them (6z.60)', () => {
  const mk = (rows: [number, number, number, number][]): Sample[] =>
    rows.map(([t, depth, sp, ten]) => ({ t, depth, ten, sp, dir: 'STOP' as const, dt: 0.5, phase: 'RIH' as const, zone: 0, tvd: depth }));
  // running in at 400 ft/min (6.667 ft/s) read every half second, with a 900 ft/min spike on the speed channel
  const run = mk(Array.from({ length: 120 }, (_, i) => [i / 2, 1000 + (i / 2) * (400 / 60), i === 60 ? 900 : 400 + ((i % 2) * 2 - 1) * 40, 500]));

  it('takes the speed from the depth over time, not the speed channel', async () => {
    const { steadySamples } = await import('../src/shared/winchRuns');
    const S = steadySamples(run);
    expect(Math.max(...S.slice(10, 110).map((s) => s.sp))).toBeLessThan(405);
    expect(Math.min(...S.slice(10, 110).map((s) => s.sp))).toBeGreaterThan(395);
    expect(S.slice(10, 110).every((s) => s.dir === 'RIH')).toBe(true);
  });

  it('counts working the tools up and down in one place, and jarring, as held', async () => {
    const { steadySamples } = await import('../src/shared/winchRuns');
    // strokes of 30 ft up and down every 4 s at 4,500 ft for two minutes
    const work = mk(Array.from({ length: 240 }, (_, i) => { const p = (i / 2) % 4; return [i / 2, 4500 - (p < 2 ? p * 15 : (4 - p) * 15), 900, 500]; }));
    expect(steadySamples(work).slice(60, 180).every((s) => s.dir === 'STOP')).toBe(true);
    // a steady run is not held, unless it falls in a jarring stretch
    expect(steadySamples(run).slice(10, 110).some((s) => s.dir === 'STOP')).toBe(false);
    expect(steadySamples(run, { held: [[20, 30]] }).filter((s) => s.t >= 20 && s.t <= 30).every((s) => s.dir === 'STOP')).toBe(true);
  });

  it('reads the tension through a one-second median, so one noisy reading is not a flag', async () => {
    const { medianTension } = await import('../src/shared/winchData');
    const S = mk(Array.from({ length: 20 }, (_, i) => [i / 2, 3000, 300, i === 10 ? 1500 : 500]));
    expect(Math.max(...medianTension(S))).toBe(500);
  });
});
