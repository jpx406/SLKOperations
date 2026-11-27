import { describe, expect, it } from 'vitest';
import { G_PER_LB, MM_PER_FT, UMS_PER_FTMIN, channelTable, guessChannels, isTdat, parseTdat, tdatChecks, tdatTable, unitFor, writeTdat } from '../src/shared/lineminder';
import { demoLineminder } from '../src/shared/winchDemo';
import { buildSamples, guessMapping, type Sample } from '../src/shared/winchData';
import { SOP_DEFAULTS, detectJarring, jarUpLimit, parseRestrictions, sopSpeedFindings, splitRuns } from '../src/shared/winchRuns';

// 6z.41: Lineminder (.da_tdat) files read in the app, runs, SOP-04 speed and jarring checks

const small = () => writeTdat({
  channels: [{ name: 'Depth Corrected', type: 1, engineering: true }, { name: 'Tension', type: 0, engineering: true }, { name: 'Speed', type: 3, engineering: true }, { name: 'High Tension Sound Alarm', type: 0 }, { name: 'Odd', type: 99 }],
  job: { '(Job) Order': 'J-1', 'Wire Type': '0.108' },
  start: Date.UTC(2026, 9, 31, 0, 0, 0) / 1000,
  records: [
    { t: 0, values: { 0: 0, 1: 100 * G_PER_LB, 2: 0, 3: 1300 * G_PER_LB, 4: 7 } },
    { t: 100, values: { 0: 30.48, 2: 100 * UMS_PER_FTMIN } },
    { t: 200, values: { 1: 500 * G_PER_LB } },
    { t: 300, values: { 1: 200 * G_PER_LB, 0: 60.96 } },
    { t: 1200, values: { 0: 1000 * MM_PER_FT } },
  ],
});

describe('Lineminder files', () => {
  it('reads the header, channels, job fields and every record', () => {
    const buf = small();
    expect(isTdat(buf)).toBe(true);
    expect(isTdat(new ArrayBuffer(400))).toBe(false);
    const f = parseTdat(buf);
    expect(f.channels.map((c) => [c.name, c.type, c.status])).toEqual([
      ['Depth Corrected', 1, 'series'], ['Tension', 0, 'series'], ['Speed', 3, 'series'], ['High Tension Sound Alarm', 0, 'setpoint'], ['Odd', 99, 'setpoint'],
    ]);
    expect(f.job).toEqual({ '(Job) Order': 'J-1', 'Wire Type': '0.108' });
    expect(Array.from(f.times)).toEqual([0, 100, 200, 300, 1200]);
    expect(f.trailer).toBe('0800000000000000');
    expect(() => parseTdat(new ArrayBuffer(10))).toThrow(/not a Lineminder/);
  });

  it('takes the unit from the type code, not the name: mm, g and µm/s to ft, lb and ft/min (or m, kg, m/min)', () => {
    expect(unitFor({ type: 1 }, 'imperial')).toMatchObject({ unit: 'ft', cls: 'length', stored: 'mm' });
    expect(unitFor({ type: 0 }, 'metric')).toMatchObject({ unit: 'kg', k: 0.001 });
    expect(unitFor({ type: 3 }, 'imperial').k * UMS_PER_FTMIN).toBeCloseTo(1);
    expect(unitFor({ type: 99 }, 'imperial')).toMatchObject({ unit: 'raw', known: false });
    const rows = channelTable(parseTdat(small()));
    expect(rows.find((r) => r.name === 'High Tension Sound Alarm')).toMatchObject({ status: 'setpoint', value: 1300, unit: 'lb' });
  });

  it('makes a table forward-filled on the step, keeping the tension peak inside each step', () => {
    const f = parseTdat(small());
    const g = guessChannels(f);
    expect(g).toEqual({ depth: 0, tension: 1, speed: 2 });
    const t = tdatTable(f, { channels: [g.depth, g.tension, g.speed], step: 1 });
    expect(t.header).toEqual(['DateTime', 'Elapsed (s)', 'Depth Corrected (ft)', 'Tension (lb)', 'Speed (ft/min)']);
    expect(t.data[0]).toEqual(['2026-10-31 00:00:00.000', '0.000', '0.00', '100.00', '0.00']);
    // the 500 lb peak at 200 ms is kept in the row at 1.2 s, though the tension was back to 200 lb
    expect(t.data[1]).toEqual(['2026-10-31 00:00:01.200', '1.200', '1000.00', '500.00', '100.00']);
    expect(tdatTable(f, { channels: [1], step: 0.1, units: 'metric' }).header[2]).toBe('Tension (kg)');
  });

  it('runs the self-checks', () => {
    const checks = tdatChecks(parseTdat(small()));
    expect(checks.find((c) => c.name === 'Every channel type is known')).toMatchObject({ ok: false });
    expect(checks.find((c) => c.name === 'End of file marker')).toMatchObject({ ok: true });
    const demo = tdatChecks(parseTdat(demoLineminder().buffer));
    expect(demo.filter((c) => !c.ok)).toEqual([]);
  });
});

const demoSamples = (): Sample[] => {
  const f = parseTdat(demoLineminder().buffer);
  const g = guessChannels(f);
  const t = tdatTable(f, { channels: [g.depth, g.tension, g.speed], step: 0.2 });
  return buildSamples(t, guessMapping(t));
};

describe('runs and SOP-04', () => {
  const S = demoSamples();
  const runs = splitRuns(S);

  it('finds each run from surface and back', () => {
    expect(runs).toHaveLength(2);
    expect(Math.round(runs[0].maxD)).toBe(5000);
    expect(Math.round(runs[1].maxD)).toBe(6000);
    expect(runs.every((r) => !r.partial)).toBe(true);
    expect(splitRuns([])).toEqual([]);
  });

  it('flags speed over 30 ft/min shallower than 200 ft, and near a restriction', () => {
    const run1 = S.slice(runs[0].i0, runs[0].i1 + 1), run2 = S.slice(runs[1].i0, runs[1].i1 + 1);
    expect(sopSpeedFindings(run1, SOP_DEFAULTS, [])).toEqual([]);
    const f2 = sopSpeedFindings(run2, SOP_DEFAULTS, []);
    expect(f2.map((f) => f.rule)).toEqual(['surfaceSpeed']);
    expect(f2[0]).toMatchObject({ dir: 'POOH', limit: 30, source: 'Speed Guidelines' });
    expect(Math.round(f2[0].worst)).toBe(60);
    const near = sopSpeedFindings(run1, SOP_DEFAULTS, parseRestrictions('3000 X nipple'));
    expect(near.map((f) => [f.rule, f.note])).toEqual([['restrictionSpeed', 'X nipple at 3000 ft'], ['restrictionSpeed', 'X nipple at 3000 ft']]);
  });

  it('detects the jarring cycles and flags what breaks SOP-04 8.3', () => {
    const run2 = S.slice(runs[1].i0, runs[1].i1 + 1);
    const j = detectJarring(run2, { ...SOP_DEFAULTS, spang: true, mbs: 3000 });
    expect(j.cycles).toHaveLength(4);
    expect(j.cycles.every((c) => c.up > 0 && c.down > 0)).toBe(true);
    expect(Math.round(j.cycles[0].peak)).toBe(1650);
    expect(j.cycles.map((c) => c.up)).toEqual([100, 160, 80, 50]);
    // cycle 1 peaks over 1,450 lbs and slacks to 300 lbs (more than 20% under 560); cycle 2 lasts 16 min; 4 min of
    // rest before cycle 3; cycle 4 is one too many at the same depth
    expect(j.findings.map((f) => f.rule)).toEqual(['jarSpang', 'jarHeavy', 'jarDown', 'jarCycle', 'jarRest', 'jarCycles']);
    // 60% of 3,000 lbs is 1,800: the 1,650 lbs peak is under it
    expect(j.findings.some((f) => f.rule === 'jarMat')).toBe(false);
    expect(detectJarring(run2, { ...SOP_DEFAULTS, mat: 1500 }).findings.filter((f) => f.rule === 'jarMat')).toHaveLength(1);
    // run 1 has no jarring
    expect(detectJarring(S.slice(runs[0].i0, runs[0].i1 + 1), SOP_DEFAULTS).cycles).toEqual([]);
  });

  it('reads the jar-up limit and the saved limits', () => {
    expect(jarUpLimit(SOP_DEFAULTS)).toBeNull();
    expect(jarUpLimit({ ...SOP_DEFAULTS, mbs: 2000 })).toEqual({ limit: 1200, from: '60% of the breaking strength' });
    expect(jarUpLimit({ ...SOP_DEFAULTS, mbs: 2000, mat: 1100 })).toEqual({ limit: 1100, from: 'MAT' });
    expect(parseRestrictions('650 SSSV, 7450 ft X nipple\n9000')).toEqual([{ depth: 650, label: 'SSSV' }, { depth: 7450, label: 'X nipple' }, { depth: 9000, label: 'restriction' }]);
  });
});
