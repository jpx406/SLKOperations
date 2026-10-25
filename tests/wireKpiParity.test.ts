import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as K from '../src/shared/wireKpis';

// KPI parity: runs WIREGUARD's own dashboard code (v2-patch.js) and the SLK Ops port on the same data and compares.
// WIREGUARD's source is not part of this repo; point WG_V2_PATCH at its v2-patch.js, or keep the sibling checkout.
// Without it the parity cases are skipped (and say so), the port's own tests still run.

const SRC = process.env.WG_V2_PATCH ?? resolve(__dirname, '../../SLK__Wireguard_v2/slkwireguard-backend/Clau_updates/Oct22/v2-patch.js');
const have = existsSync(SRC);
const TODAY = '2026-10-25';

/** The slices of WIREGUARD's file the ported KPIs depend on, found by their own markers rather than line numbers. */
function wireguardEngine(settings: K.Settings, data: { jobs: unknown[]; maint: unknown[]; wires: unknown[]; drums: unknown[]; notifications: unknown[] }) {
  const src = readFileSync(SRC, 'utf8');
  const between = (start: string, end: string) => {
    const a = src.indexOf(start); const b = src.indexOf(end, a);
    if (a < 0 || b < 0) throw new Error(`WIREGUARD source changed: marker not found (${start.slice(0, 40)})`);
    return src.slice(a, b);
  };
  const code = [
    'function v2CardOpt(id, key, dflt) { return dflt; }',
    between('const v2Num = (v) =>', '\n'),
    between('function v2KpiOverrides()', 'function v2CardOpt('),
    between('const v2DateParts = (d) => {', 'const V2_MONTH_NAMES'),
    between('function v2Percentile(values, p) {', '// ── derived facts'),
    between('let v2DerivCache = ', '// ── chart forms'),
    between('const v2St = (r) =>', '\n'),
    between('const V2_P = (key, label', 'const v2Bars = '),
    between('const V2_KPIS = [', '// ── the section view'),
    between('function v2IsCutOnly(j)', '\n'),
  ].join('\n');
  const SOP_SETTING_FALLBACKS = K.SOP_FALLBACKS;
  const DATA = { kpiSettings: settings.kpi, sopSettings: settings.sop, notifications: data.notifications, drums: data.drums, wires: data.wires };
  // stand-ins for WIREGUARD's page helpers: rendering only, they never change a number
  const stubs = {
    DATA, SOP_SETTING_FALLBACKS,
    sopVal: (key: string) => { const row = DATA.sopSettings.find((s) => s.key === key); const raw = row ? row.value : undefined; const n = Number(raw); return raw !== undefined && raw !== null && raw !== '' && !isNaN(n) ? n : (SOP_SETTING_FALLBACKS as Record<string, number>)[key]; },
    esc: (s: unknown) => String(s), v2Fmt: (v: unknown) => String(v), v2Compact: (v: unknown) => String(v), V2_CHART_COLORS: ['#000', '#111'],
    v2Bars: (items: unknown) => ({ body: items }), v2BarsH: (items: unknown) => items, v2ControlChart: (pts: unknown) => pts, v2Histogram: (bins: unknown) => bins,
    v2Lines: () => '', v2TimeChart: (pts: unknown) => pts, v2StackedColumns: () => '', v2GroupedBars: () => '', v2RangeChart: () => '', v2SvgBarsH: () => '',
    v2ThemeSvg: (s: unknown) => s, v2Pick: () => '', v2OptPick: () => '', v2HtmlTable: () => '',
    v2ChartEmpty: () => '', v2Dash: { cardOpts: {} }, V2_GRAIN_OPTS: [], V2_BREAK_DIMS: {}, v2DashDrums: () => data.drums, V2_MONTH_NAMES: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  };
  const fn = new Function(...Object.keys(stubs), `${code}\nreturn { v2Derive, V2_KPIS, v2IsCutOnly, v2ComplianceScore };`);
  return fn(...Object.values(stubs)) as { v2Derive: (a: unknown[], b: unknown[], c: unknown[]) => Record<string, K.Deriv>; V2_KPIS: { id: string; tile?: (c: unknown) => { value: string; sub: string }; tiles?: (c: unknown) => { value: string; sub: string }[]; card?: (c: unknown) => { note: string; body: unknown } }[]; v2IsCutOnly: (j: unknown) => boolean };
}

function mockData() {
  const raw = JSON.parse(readFileSync(resolve(__dirname, '../mock-wireguard/data.json'), 'utf8'));
  const settings: K.Settings = { kpi: raw.settings['kpi-settings'] ?? [], sop: raw.settings['sop-settings'] ?? [] };
  return {
    settings,
    data: { jobs: K.keysToCamel(raw.jobs), maint: K.keysToCamel(raw.documents), wires: K.keysToCamel(raw.wires), drums: K.keysToCamel(raw.drums), notifications: K.keysToCamel(raw.notifications) },
  };
}

describe.skipIf(!have)(`wire KPI parity with WIREGUARD (${have ? SRC : 'source not found'})`, () => {
  const { settings, data } = mockData();
  const wg = wireguardEngine(settings, data);
  const ours = K.context(data, data.jobs, settings, TODAY);
  const wgCtx = { allJobs: data.jobs, allMaint: data.maint, wires: data.wires, drums: data.drums, jobs: data.jobs.filter((j: unknown) => !wg.v2IsCutOnly(j)), cutJobs: data.jobs.filter(wg.v2IsCutOnly), maint: data.maint, deriv: wg.v2Derive(data.jobs, data.maint, data.wires), today: TODAY, filters: {} };
  const def = (id: string) => wg.V2_KPIS.find((k) => k.id === id)!;
  const tile = (id: string) => (def(id).tile ? def(id).tile!(wgCtx) : def(id).tiles!(wgCtx)[0]);
  // the first number in a tile value (G3 wraps its unit in markup)
  const n = (s: string) => Number(/-?\d+(\.\d+)?/.exec(String(s))?.[0]);

  it('derives the same per-run facts for every run', () => {
    expect(Object.keys(ours.deriv).length).toBe(Object.keys(wgCtx.deriv).length);
    expect(ours.deriv).toEqual(wgCtx.deriv);
  });
  it('G1–G6 tiles', () => {
    expect(n(tile('G1').value)).toBe(K.kpiG1(ours).runs);
    expect(n(tile('G2').value)).toBe(K.kpiG2(ours).hours);
    expect(n(tile('G3').value)).toBe(K.kpiG3(ours).cut);
    expect(n(tile('G4').value)).toBe(K.kpiG4(ours).active);
    expect(n(tile('G5').value)).toBe(K.kpiG5(ours).open);
    expect(n(tile('G6').value)).toBe(K.kpiG6(ours).pending);
    expect(tile('G6').sub).toContain(String(K.kpiG6(ours).oldestDays));
  });
  it('C12 and C1–C6', () => {
    const score = K.kpiC12(ours).score;
    expect(tile('C12').value).toBe(score === null ? '—' : `${score}%`);
    for (const [id, f] of [['C1', K.kpiC1], ['C2', K.kpiC2], ['C3', K.kpiC3], ['C4', K.kpiC4], ['C6', K.kpiC6]] as const) {
      const r = f(ours);
      expect(tile(id).value, id).toBe(r.den ? `${r.pct}%` : '—');
    }
    expect(n(tile('C5').value)).toBe(K.kpiC5(ours).count);
  });
  it('J7, J9, M5 counts', () => {
    expect(def('J7').card!(wgCtx).note).toContain(`<b>${K.kpiJ7(ours).points.length}</b> runs plotted`);
    expect(def('J7').card!(wgCtx).note).toMatch(new RegExp(`>${K.kpiJ7(ours).over}</b> over`));
    const j9 = K.kpiJ9(ours);
    expect(def('J9').card!(wgCtx).note).toContain(`<b>${j9.over}</b> of ${j9.measurable} measurable runs`);
    const m5 = K.kpiM5(ours);
    expect(def('M5').card!(wgCtx).note).toContain(`<b>${m5.over}</b> of ${m5.live} wires in service`);
    expect((def('M5').card!(wgCtx).body as { value: number }[]).map((b) => b.value)).toEqual(m5.bins.map((b) => b.value));
  });
  it('W14 and W1 lists', () => {
    expect(def('W14').card!(wgCtx).body).toEqual(K.kpiW14(ours).items.map((i) => ({ label: i.label, value: i.value })));
    expect((def('W1').card!(wgCtx).body as string).length).toBeGreaterThan(0);
    // W1 draws HTML around its list; compare the life-consumed figures through the same derivation
    const runs = (w: { wireSerialNumber: unknown }) => data.jobs.filter((j: { wireSerialNumber: unknown }) => j.wireSerialNumber === w.wireSerialNumber).length;
    const top = data.wires.filter(K.LIVE).map((w: { wireSerialNumber: unknown }) => Math.round((runs(w) / 220) * 1000) / 10).sort((a: number, b: number) => b - a).slice(0, 12);
    expect(K.kpiW1(ours).items.map((i) => i.value)).toEqual(top);
  });
});

describe('wire KPI port on its own', () => {
  it('converts keys the way WIREGUARD does', () => {
    expect(K.keysToCamel({ rated_mbl: 3000, h2s_percent: 1, max_tension: 5, nested: [{ wire_serial_number: 'A' }] }))
      .toEqual({ ratedMBL: 3000, h2sPercent: 1, maxTension: 5, nested: [{ wireSerialNumber: 'A' }] });
  });
  it('reads parameters with WIREGUARD’s fallbacks', () => {
    const p = K.params({ kpi: [{ key: 'C1.tension_window_days', value: '14' }, { key: 'J9.enabled', value: '0' }], sop: [{ key: 'jar_limit', value: 20 }] });
    expect([p.kpi('C1', 'tension_window_days'), p.kpi('C1', 'wrap_torsion_max_days'), p.sop('jar_limit', 25), p.sop('retire_runs_limit', 1), p.sop('unknown', 7)]).toEqual([14, 30, 20, 220, 7]);
    expect([p.enabled('J9'), p.enabled('G1')]).toEqual([false, true]);
  });
  it('resets trips and jarring at a cut-back and uses the used-wire limit after the first run', () => {
    const p = K.params({ kpi: [], sop: [] });
    const runs = [
      { id: 'r1', wireSerialNumber: 'W', jobDate: '2026-10-01', maxTension: 1700, jarringImpactCount: 10 },
      { id: 'r2', wireSerialNumber: 'W', jobDate: '2026-10-02', maxTension: 1700, jarringImpactCount: 20, wireCutFeet: 50 },
      { id: 'r3', wireSerialNumber: 'W', jobDate: '2026-10-03', maxTension: 1400 },
    ];
    const d = K.derive(runs, [], [{ wireSerialNumber: 'W', ratedMBL: 3000 }], p);
    expect([d.r1.tensionCompliant, d.r2.tensionCompliant, d.r3.tensionCompliant]).toEqual([true, false, true]); // 56.7 % new, 56.7 % used > 50 %, 46.7 %
    expect([d.r2.jarsAfter, d.r2.jarCompliant, d.r3.tripsBefore, d.r3.jarsBefore]).toEqual([30, false, 0, 0]);
    expect(d.r1.preJobCompliant).toBe(false);
  });
});
