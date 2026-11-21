// A made-up Lineminder recording (6z.41) for the demo button and the tests: two runs on one job. Run 1 is a clean
// gauge run to 5,000 ft. Run 2 goes to 6,000 ft and jars there, breaking SOP-04 on purpose: jar-up peaks over the
// spang jar limit, a jar-down that loses more than 20% of the normal tension, a cycle longer than 15 minutes, a rest
// shorter than 10 minutes and a fourth cycle; it also pulls the last 200 ft faster than 30 ft/min.

import { G_PER_LB, MM_PER_FT, UMS_PER_FTMIN, writeTdat } from './lineminder';

export function demoLineminder(): { buffer: ArrayBuffer; fileName: string } {
  const channels = [
    { name: 'Depth Corrected', type: 1, engineering: true },
    { name: 'Tension', type: 0, engineering: true },
    { name: 'Speed', type: 3, engineering: true },
    { name: 'Diff Tension', type: 0, engineering: true },
    { name: 'High Tension Sound Alarm', type: 0, engineering: true },
    { name: 'Total Depth Action Alarm', type: 1, engineering: true },
    { name: 'Depth Uncorrected', type: 1, engineering: true },
  ];
  const records: { t: number; values: Record<number, number> }[] = [];
  let t = 0, depth = 0;
  const normal = (d: number) => 200 + d * 0.06;
  const push = (ten: number, speedFpm: number, stepMs = 1000) => {
    records.push({ t, values: { 0: depth * MM_PER_FT, 1: ten * G_PER_LB, 2: speedFpm * UMS_PER_FTMIN, 3: (ten - normal(depth)) * G_PER_LB, 6: depth * MM_PER_FT * 1.001 } });
    t += stepMs;
  };
  // the first record also carries the alarm set-points
  records.push({ t: 0, values: { 0: 0, 1: 150 * G_PER_LB, 2: 0, 3: 0, 4: 1300 * G_PER_LB, 5: 6500 * MM_PER_FT, 6: 0 } });
  t = 1000;
  const move = (to: number, fpm: number, nearSurface = 25) => {
    const dir = to > depth ? 1 : -1;
    while (dir > 0 ? depth < to : depth > to) {
      // shallower than 200 ft: 25 ft/min in, and nearSurface out (25 unless the demo means to break the rule)
      const v = depth < 200 ? Math.min(fpm, dir > 0 ? 25 : nearSurface) : fpm;
      depth = Math.max(0, depth + (dir * v) / 60);
      if (dir > 0 && depth > to) depth = to;
      push(normal(depth) + (dir > 0 ? -40 : 60), dir * v);
    }
  };
  const hold = (sec: number) => { for (let i = 0; i < sec; i++) push(normal(depth) + Math.sin(i) * 5, 0); };
  // run 1: a clean gauge run
  hold(60); move(5000, 150); hold(120); move(0, 180); hold(600);
  // run 2: down to 6,000 ft and jar
  move(6000, 160); hold(60);
  const cycle = (minutes: number, peak: number, low: number) => {
    const n = Math.round((minutes * 60) / 6);
    for (let k = 0; k < n; k++) {
      const N = normal(depth);
      // pull up to fire the jar, release, slack off to jar down, pick up again: 6 s, sampled every 200 ms
      const shape = [N, N + 200, N + 500, peak, N + 100, N, N, low, low + 30, N - 50, N];
      for (let s = 0; s < 30; s++) push(shape[Math.min(shape.length - 1, Math.floor((s / 30) * shape.length))], 0, 200);
    }
  };
  cycle(10, 1650, 300); hold(11 * 60);   // cycle 1: peak over the 1,450 lbs spang limit, a deep jar down
  cycle(16, 1300, 500); hold(4 * 60);    // cycle 2: 16 minutes, then only 4 minutes of rest
  cycle(8, 1300, 500); hold(10 * 60);    // cycle 3
  cycle(5, 1300, 500); hold(60);         // cycle 4: one too many at this depth
  move(250, 200); move(0, 60, 60); hold(60); // pulls the last 200 ft at 60 ft/min
  return {
    buffer: writeTdat({ channels, job: { '(Job) Order': 'DEMO-0001', 'Measuring Head': 'MH-21', 'Wire Type': '0.125 in' }, start: Date.UTC(2026, 10, 18, 6, 0, 0) / 1000, periodMs: 100, records }),
    fileName: 'DEMO_W12_LINEMINDER.da_tdat',
  };
}
