// Wire KPIs ported from WIREGUARD's dashboard (v2-patch.js, build 2026-10-22): the same codes, the same
// parameters (kpi-settings, sop-settings with WIREGUARD's fallbacks) and the same per-run derivation.
// Each function follows its WIREGUARD counterpart line for line but returns numbers instead of HTML.
// tests/wireKpiParity.test.ts runs WIREGUARD's own code on the same data and compares.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

// ---- WIREGUARD's snake_case → camelCase conversion (wireguard.html keysToCamel) ----
const CAMEL_KEY_OVERRIDES: Record<string, string> = {
  partial_pressure_h2s: 'partialPressureH2S', partial_pressure_co2: 'partialPressureCO2', sour_service_h2s: 'sourServiceH2S',
  sour_service_co2: 'sourServiceCO2', h2s_percent: 'h2sPercent', co2_percent: 'co2Percent', rated_mbl: 'ratedMBL',
};
const snakeToCamelKey = (k: string) => CAMEL_KEY_OVERRIDES[k] ?? k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
export function keysToCamel(obj: any): any {
  if (Array.isArray(obj)) return obj.map(keysToCamel);
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    const out: Row = {};
    for (const [k, v] of Object.entries(obj)) out[snakeToCamelKey(k)] = keysToCamel(v);
    return out;
  }
  return obj;
}

// ---- parameters ----
/** WIREGUARD's SOP_SETTING_FALLBACKS (wireguard.html), used when sop-settings lacks a key. */
export const SOP_FALLBACKS: Record<string, number> = {
  wrap_min_count: 8, tension_min_percent_mbl: 0.75, mpi_expiry_warning_days: 30, cutback_trips_limit: 3, jar_limit: 25, jar_minutes_limit: 30,
  retire_runs_limit: 220, retire_runs_warning: 180, od_reduction_limit_percent: 12, od_reduction_warning_percent: 9, test_stale_days: 30,
  tension_limit_new_wire_percent: 0.6, tension_limit_used_wire_percent: 0.5, low_length_warning_ft: 2000,
};
/** Defaults of the registry params (V2_P) for the KPIs ported here. */
const PARAM_DEFAULTS: Record<string, number> = {
  'C1.wrap_torsion_max_days': 30, 'C1.tension_window_days': 30, 'C1.require_tension': 1, 'C1.target_pct': 100,
  'C2.target_pct': 100, 'C3.target_pct': 100, 'C4.target_pct': 100, 'C7.target_days': 3, 'C12.target_pct': 95,
};

export interface Settings { kpi: { key: string; value: unknown }[]; sop: { key: string; value: unknown }[] }

export function params(s: Settings) {
  const kpiMap = new Map(s.kpi.map((r) => [r.key, r.value]));
  const isNum = (raw: unknown) => raw !== undefined && raw !== null && raw !== '' && !isNaN(Number(raw));
  const sopVal = (key: string): number | undefined => {
    const raw = s.sop.find((r) => r.key === key)?.value;
    return isNum(raw) ? Number(raw) : SOP_FALLBACKS[key];
  };
  return {
    /** v2SopNum: the SOP value, else WIREGUARD's fallback table, else the call's fallback. */
    sop: (key: string, fallback: number) => { const v = Number(sopVal(key)); return isFinite(v) ? v : fallback; },
    /** v2KpiParam: an override from kpi-settings, else the registry default. */
    kpi: (id: string, key: string) => { const raw = kpiMap.get(`${id}.${key}`); return isNum(raw) ? Number(raw) : PARAM_DEFAULTS[`${id}.${key}`]; },
    /** v2KpiEnabled: on unless kpi-settings says "<id>.enabled" = 0. */
    enabled: (id: string) => { const raw = kpiMap.get(`${id}.enabled`); return raw === undefined || raw === null || raw === '' ? true : String(raw) !== '0'; },
  };
}
export type Params = ReturnType<typeof params>;

// ---- helpers (v2Num, v2DateParts, v2DaysBetween, …) ----
export const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
export function dateParts(d: unknown) {
  const raw = String(d == null ? '' : d).trim();
  if (!raw) return null;
  let y: string | undefined, mo: string | undefined, da: string | undefined;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) { y = m[1]; mo = m[2]; da = m[3]; }
  if (!y) { m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw); if (m) { y = m[3]; mo = String(m[1]).padStart(2, '0'); da = String(m[2]).padStart(2, '0'); } }
  if (!y && /^\d{5}$/.test(raw)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Number(raw) * 86400000);
    if (!isNaN(dt.getTime())) { y = String(dt.getUTCFullYear()); mo = String(dt.getUTCMonth() + 1).padStart(2, '0'); da = String(dt.getUTCDate()).padStart(2, '0'); }
  }
  if (!y || Number(mo) < 1 || Number(mo) > 12) return null;
  return { y, m: mo!, q: `Q${Math.ceil(Number(mo) / 3)}`, ym: `${y}-${mo}`, date: `${y}-${mo}-${da}` };
}
export function daysBetween(a: unknown, b: unknown) {
  const pa = dateParts(a), pb = dateParts(b);
  if (!pa || !pb) return null;
  return Math.round((Date.UTC(+pb.y, +pb.m - 1, +pb.date.slice(8, 10)) - Date.UTC(+pa.y, +pa.m - 1, +pa.date.slice(8, 10))) / 86400000);
}
const pctText = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
export const LIVE = (w: Row) => !['Retired', 'Scrapped', 'Disposed'].includes(w.status);
export const st = (r: Row) => String((r && r.approvalStatus) || '').toLowerCase();
export const isCutOnly = (j: Row) => !!(j && (j.sourceDocumentId || j.jobName === 'Maintenance Wire cut' || j.drssNumber === 'SPOOL-AD'));
const latest = (rows: Row[], dateOf: (r: Row) => unknown) =>
  rows.slice().sort((a, b) => String(dateParts(dateOf(b))?.date || '').localeCompare(String(dateParts(dateOf(a))?.date || '')))[0] || null;
function runOrder(a: Row, b: Row) {
  const da = dateParts(a.jobDate)?.date || '9999-99-99', db = dateParts(b.jobDate)?.date || '9999-99-99';
  if (da !== db) return da < db ? -1 : 1;
  const sa = num(a.seq), sb = num(b.seq); if (sa !== sb) return sa - sb;
  return num(a.runNumber) - num(b.runNumber);
}

// ---- derived facts per run (v2Derive) ----
export interface Deriv {
  tripsBefore: number; jarsBefore: number; jarMinBefore: number; cumRunsBefore: number; used: boolean; cutOnly: boolean;
  jarsAfter: number; jarMinAfter: number; tripCompliant: boolean; jarCompliant: boolean; limitPct: number; utilisation: number | null;
  tensionCompliant: boolean | null; preJobWT: 'none' | 'job-between' | 'stale' | 'ok'; preJobTension: 'none' | 'stale' | 'ok'; preJobCompliant: boolean | null;
}
export function derive(allJobs: Row[], allMaint: Row[], wires: Row[], p: Params): Record<string, Deriv> {
  const byWire: Record<string, Row[]> = {};
  allJobs.forEach((j) => { (byWire[j.wireSerialNumber] = byWire[j.wireSerialNumber] || []).push(j); });
  const wireOf: Record<string, Row> = {}; wires.forEach((w) => { wireOf[w.wireSerialNumber] = w; });
  const testsByWire: Record<string, Row[]> = {};
  allMaint.filter((d) => d.docType === 'wire_maintenance_entry').forEach((d) => { (testsByWire[d.wireSerialNumber] = testsByWire[d.wireSerialNumber] || []).push(d); });
  Object.keys(testsByWire).forEach((k) => testsByWire[k].sort((a, b) => String(dateParts(a.testDate)?.date || '').localeCompare(String(dateParts(b.testDate)?.date || ''))));
  const tripLimit = p.sop('cutback_trips_limit', 3), jarLimit = p.sop('jar_limit', 25), jarMinLimit = p.sop('jar_minutes_limit', 30);
  const limNew = p.sop('tension_limit_new_wire_percent', 0.6), limUsed = p.sop('tension_limit_used_wire_percent', 0.5);
  const wtMaxDays = p.kpi('C1', 'wrap_torsion_max_days'), tenDays = p.kpi('C1', 'tension_window_days'), needTension = p.kpi('C1', 'require_tension') !== 0;
  const map: Record<string, Deriv> = {};
  Object.keys(byWire).forEach((sn) => {
    const runs = byWire[sn].slice().sort(runOrder);
    const wire = wireOf[sn]; const mbl = wire ? num(wire.ratedMBL) : 0;
    let trips = 0, jars = 0, jarMin = 0, cumRuns = 0;
    const tests = testsByWire[sn] || [];
    runs.forEach((j, idx) => {
      const cutOnly = isCutOnly(j);
      const imp = num(j.jarringImpactCount), mins = num(j.jarringMinutes);
      const t = num(j.maxTension);
      const used = cumRuns > 0;
      const limitPct = used ? limUsed : limNew;
      const utilisation = mbl > 0 && t > 0 ? t / mbl : null;
      // pre-job test: the latest passing Wrap/Torsional on or before the job, no older than the window, no job in between
      const jd = dateParts(j.jobDate)?.date || null;
      let wt: { date: string } | null = null, ten: { date: string } | null = null;
      if (jd) {
        for (let k = tests.length - 1; k >= 0; k--) {
          const te = tests[k]; const td = dateParts(te.testDate)?.date;
          if (!td || td > jd || te.result !== 'Pass') continue;
          if (!wt && (te.testType === 'Wrap' || te.testType === 'Torsional')) wt = { date: td };
          if (!ten && te.testType === 'Tension') ten = { date: td };
          if (wt && ten) break;
        }
      }
      const prev = idx > 0 ? dateParts(runs[idx - 1].jobDate)?.date || null : null;
      const preJobWT: Deriv['preJobWT'] = !wt ? 'none' : prev && wt.date < prev ? 'job-between' : wtMaxDays > 0 && (daysBetween(wt.date, jd) ?? 0) > wtMaxDays ? 'stale' : 'ok';
      const preJobTension: Deriv['preJobTension'] = !needTension ? 'ok' : !ten ? 'none' : (daysBetween(ten.date, jd) ?? 0) > tenDays ? 'stale' : 'ok';
      map[j.id] = {
        tripsBefore: trips, jarsBefore: jars, jarMinBefore: jarMin, cumRunsBefore: cumRuns, used, cutOnly,
        jarsAfter: jars + imp, jarMinAfter: jarMin + mins, tripCompliant: trips < tripLimit, jarCompliant: jars + imp <= jarLimit && jarMin + mins <= jarMinLimit,
        limitPct, utilisation, tensionCompliant: utilisation === null ? null : utilisation <= limitPct,
        preJobWT, preJobTension, preJobCompliant: jd ? preJobWT === 'ok' && preJobTension === 'ok' : null,
      };
      if (!cutOnly) { trips += 1; jars += imp; jarMin += mins; cumRuns += 1; }
      if (num(j.wireCutFeet) > 0) { trips = 0; jars = 0; jarMin = 0; }
    });
  });
  return map;
}

// ---- context (v2DashCtx) ----
export interface Ctx { allJobs: Row[]; allMaint: Row[]; wires: Row[]; drums: Row[]; notifications: Row[]; jobs: Row[]; cutJobs: Row[]; deriv: Record<string, Deriv>; today: string; p: Params }

/** `filtered` is the run list after the screen's filters; derivation always walks every run, as in WIREGUARD. */
export function context(data: { jobs: Row[]; maint: Row[]; wires: Row[]; drums: Row[]; notifications: Row[] }, filtered: Row[], settings: Settings, today: string): Ctx {
  const p = params(settings);
  return {
    allJobs: data.jobs, allMaint: data.maint, wires: data.wires, drums: data.drums, notifications: data.notifications,
    jobs: filtered.filter((j) => !isCutOnly(j)), cutJobs: filtered.filter(isCutOnly), deriv: derive(data.jobs, data.maint, data.wires, p), today, p,
  };
}

export function wireRemaining(w: Row, allJobs: Row[]) {
  const last = latest(allJobs.filter((j) => j.wireSerialNumber === w.wireSerialNumber && num(j.remainingLengthFeet) > 0), (j) => j.jobDate);
  return last ? num(last.remainingLengthFeet) : num(w.remainingLength || w.spooledLength);
}
export const wireRunCount = (w: Row, allJobs: Row[]) => allJobs.filter((j) => j.wireSerialNumber === w.wireSerialNumber).length;
export function mpiStatus(drum: Row, allMaint: Row[], today: string, p: Params) {
  const last = latest(allMaint.filter((d) => d.docType === 'drum_mpi' && d.drumNo === drum.drumNo), (d) => d.testDate);
  if (!last) return { state: 'none' as const, days: null, latest: null };
  if (last.result === 'Fail' || last.result === 'Rejected') return { state: 'failed' as const, days: null, latest: last };
  const days = last.expiryDate ? daysBetween(today, last.expiryDate) : null;
  if (days === null) return { state: 'valid' as const, days: null, latest: last };
  const warn = p.sop('mpi_expiry_warning_days', 30);
  return { state: days < 0 ? ('expired' as const) : days <= warn ? ('expiring' as const) : ('valid' as const), days, latest: last };
}
export function complianceScore(c: Pick<Ctx, 'jobs' | 'deriv'>) {
  const part = (label: string, ok: number, den: number) => ({ label, rate: den ? Math.round((ok / den) * 1000) / 10 : null });
  const d = c.deriv; const rows = c.jobs.filter((j) => d[j.id]);
  const tens = rows.filter((j) => d[j.id].tensionCompliant !== null), pre = rows.filter((j) => d[j.id].preJobCompliant !== null);
  const parts = [
    part('Pre-job test', pre.filter((j) => d[j.id].preJobCompliant).length, pre.length),
    part('Cut-back on trips', rows.filter((j) => d[j.id].tripCompliant).length, rows.length),
    part('Cut-back on jarring', rows.filter((j) => d[j.id].jarCompliant).length, rows.length),
    part('Tension', tens.filter((j) => d[j.id].tensionCompliant).length, tens.length),
  ];
  const have = parts.filter((x) => x.rate !== null);
  return { parts, score: have.length ? Math.round((have.reduce((s, x) => s + (x.rate as number), 0) / have.length) * 10) / 10 : null };
}

/** Monthly series (v2SeriesBy, grain = month) over the last 36 periods. */
function seriesByMonth<T extends Row>(rows: T[], dateOf: (r: T) => unknown, reduce: (rs: T[]) => number) {
  const acc: Record<string, T[]> = {};
  rows.forEach((r) => { const pp = dateParts(dateOf(r)); if (pp) (acc[pp.ym] = acc[pp.ym] || []).push(r); });
  return Object.keys(acc).sort().map((k) => ({ key: k, value: reduce(acc[k]), rows: acc[k] })).slice(-36);
}
const rate = (num0: number, den: number) => ({ ok: num0, den, pct: pctText(num0, den) });

// ---- the 17 KPIs ----
export function kpiG1(c: Ctx) { return { runs: c.jobs.length, pending: c.jobs.filter((j) => st(j) === 'pending').length }; }
export function kpiG2(c: Ctx) { const h = c.jobs.reduce((s, j) => s + num(j.hoursWorking), 0); return { hours: h, perRun: c.jobs.length ? h / c.jobs.length : 0 }; }
export function kpiG3(c: Ctx) {
  const rows = c.jobs.concat(c.cutJobs);
  return { cut: rows.reduce((s, j) => s + num(j.wireCutFeet), 0), shop: c.cutJobs.reduce((s, j) => s + num(j.wireCutFeet), 0), wires: new Set(rows.filter((j) => num(j.wireCutFeet) > 0).map((j) => j.wireSerialNumber).filter(Boolean)).size };
}
export function kpiG4(c: Ctx) { return { active: c.wires.filter(LIVE).length, registry: c.wires.length, drums: c.drums.length }; }
export function kpiG5(c: Ctx) {
  const open = c.notifications.filter((n) => !n.resolvedAt);
  const sev = (x: Row) => x.severity || x.sev || '';
  const data = (x: Row) => String(x.code || '').startsWith('DATA_');
  return { open: open.length, crit: open.filter((x) => sev(x) === 'crit' && !data(x)).length, warn: open.filter((x) => sev(x) === 'warn' && !data(x)).length, data: open.filter(data).length };
}
export function kpiG6(c: Ctx) {
  const pj = c.allJobs.filter((j) => st(j) === 'pending'), pm = c.allMaint.filter((d) => st(d) === 'pending');
  const ages = pj.map((j) => daysBetween(j.jobDate, c.today)).concat(pm.map((d) => daysBetween(d.testDate, c.today))).filter((x): x is number => x !== null);
  return { pending: pj.length + pm.length, runs: pj.length, maint: pm.length, oldestDays: ages.length ? Math.max(...ages) : 0, overTarget: (ages.length ? Math.max(...ages) : 0) > c.p.kpi('C7', 'target_days') };
}
export function kpiC12(c: Ctx) { return { ...complianceScore(c), target: c.p.kpi('C12', 'target_pct') }; }

export function kpiC1(c: Ctx) {
  const rows = c.jobs.filter((j) => c.deriv[j.id] && c.deriv[j.id].preJobCompliant !== null);
  const why: Record<string, number> = {};
  rows.filter((j) => !c.deriv[j.id].preJobCompliant).forEach((j) => {
    const d = c.deriv[j.id];
    const k = d.preJobWT !== 'ok'
      ? ({ none: 'no Wrap/Torsional test on record', 'job-between': 'another job came after the test', stale: `test older than ${c.p.kpi('C1', 'wrap_torsion_max_days')} days` } as Record<string, string>)[d.preJobWT]
      : ({ none: 'no Tension test on record', stale: `Tension test older than ${c.p.kpi('C1', 'tension_window_days')} days` } as Record<string, string>)[d.preJobTension];
    why[k] = (why[k] || 0) + 1;
  });
  const r = (rs: Row[], f: (j: Row) => boolean) => (rs.length ? Math.round((rs.filter(f).length / rs.length) * 1000) / 10 : null);
  return {
    ...rate(rows.filter((j) => c.deriv[j.id].preJobCompliant).length, rows.length), target: c.p.kpi('C1', 'target_pct'), why,
    monthly: seriesByMonth(rows, (j) => j.jobDate, (rs) => r(rs, (j) => !!c.deriv[j.id].preJobCompliant) ?? 0).map(({ key, value }) => ({ key, value })),
  };
}
const adherence = (id: string, pick: (d: Deriv) => boolean, measurable?: (d: Deriv) => boolean) => (c: Ctx) => {
  const rows = c.jobs.filter((j) => c.deriv[j.id] && (!measurable || measurable(c.deriv[j.id])));
  return {
    ...rate(rows.filter((j) => pick(c.deriv[j.id])).length, rows.length), target: c.p.kpi(id, 'target_pct'),
    breaches: rows.filter((j) => !pick(c.deriv[j.id])).length, unmeasured: c.jobs.length - rows.length,
    monthly: seriesByMonth(rows, (j) => j.jobDate, (rs) => (rs.length ? Math.round((rs.filter((j) => pick(c.deriv[j.id])).length / rs.length) * 1000) / 10 : 0)).map(({ key, value }) => ({ key, value })),
  };
};
export const kpiC2 = adherence('C2', (d) => d.tripCompliant);
export const kpiC3 = adherence('C3', (d) => d.jarCompliant);
export const kpiC4 = adherence('C4', (d) => !!d.tensionCompliant, (d) => d.tensionCompliant !== null);
export function kpiC5(c: Ctx) {
  const odLim = c.p.sop('od_reduction_limit_percent', 12), runLim = c.p.sop('retire_runs_limit', 220);
  const bad = c.wires.filter(LIVE).filter((w) => num(w.odReductionPercent) >= odLim || wireRunCount(w, c.allJobs) >= runLim);
  return { count: bad.length, wires: bad.map((w) => String(w.wireSerialNumber)), odLim, runLim };
}
export function kpiC6(c: Ctx) {
  const live = c.drums.filter((d) => d.active !== 0 && d.active !== false);
  const states = live.map((d) => mpiStatus(d, c.allMaint, c.today, c.p).state);
  return { ...rate(states.filter((s) => s === 'valid' || s === 'expiring').length, live.length), expiring: states.filter((s) => s === 'expiring').length, warnDays: c.p.sop('mpi_expiry_warning_days', 30) };
}
export function kpiJ7(c: Ctx) {
  const runs = c.jobs.filter((j) => c.deriv[j.id] && c.deriv[j.id].utilisation !== null).sort(runOrder);
  const points = runs.map((j) => { const d = c.deriv[j.id]; return { id: j.id, wire: String(j.wireSerialNumber ?? ''), date: j.jobDate, pct: Math.round((d.utilisation as number) * 1000) / 10, over: !d.tensionCompliant, limit: Math.round(d.limitPct * 100), tension: num(j.maxTension) }; });
  return { points, over: points.filter((x) => x.over).length, limNew: Math.round(c.p.sop('tension_limit_new_wire_percent', 0.6) * 100), limUsed: Math.round(c.p.sop('tension_limit_used_wire_percent', 0.5) * 100) };
}
export function kpiJ9(c: Ctx) {
  const rows = c.jobs.filter((j) => c.deriv[j.id] && c.deriv[j.id].tensionCompliant !== null);
  const over = rows.filter((j) => !c.deriv[j.id].tensionCompliant).length;
  return { over, measurable: rows.length, pct: pctText(over, rows.length), monthly: seriesByMonth(rows, (j) => j.jobDate, (rs) => rs.filter((j) => !c.deriv[j.id].tensionCompliant).length).map(({ key, value }) => ({ key, value })) };
}
/** M5, W14 and W1 take the screen's country and wire filters, as WIREGUARD's do. */
export interface WireFilter { countries?: string[]; wires?: string[] }
export function kpiM5(c: Ctx, f: WireFilter = {}) {
  const win = c.p.sop('test_stale_days', 30);
  const live = c.wires.filter(LIVE).filter((w) => !(f.countries || []).length || (f.countries || []).includes(w.country || ''));
  const ages = live.map((w) => {
    const last = latest(c.allMaint.filter((d) => d.docType === 'wire_maintenance_entry' && d.wireSerialNumber === w.wireSerialNumber && d.result === 'Pass'), (d) => d.testDate);
    return { wire: String(w.wireSerialNumber), days: last ? daysBetween(last.testDate, c.today) : null };
  });
  const bands: [string, (d: number | null) => boolean][] = [['0–14 d', (d) => d !== null && d <= 14], ['15–30 d', (d) => d !== null && d > 14 && d <= 30], ['31–60 d', (d) => d !== null && d > 30 && d <= 60], ['60+ d', (d) => d !== null && d > 60], ['never tested', (d) => d === null]];
  const late = ages.filter((a) => a.days === null || a.days > win);
  return {
    window: win, live: live.length, over: late.length, bins: bands.map(([label, test]) => ({ label, value: ages.filter((a) => test(a.days)).length })),
    worst: late.sort((a, b) => (b.days === null ? 1e9 : b.days) - (a.days === null ? 1e9 : a.days)).slice(0, 8),
  };
}
export type W14Metric = 'remaining' | 'od' | 'runs';
export function kpiW14(c: Ctx, metric: W14Metric = 'remaining', f: WireFilter = {}) {
  const m = {
    remaining: { pick: (w: Row) => wireRemaining(w, c.allJobs), asc: true, unit: 'ft' },
    od: { pick: (w: Row) => num(w.odReductionPercent), asc: false, unit: '%' },
    runs: { pick: (w: Row) => wireRunCount(w, c.allJobs), asc: false, unit: '' },
  }[metric];
  const live = c.wires.filter(LIVE).filter((w) => !(f.countries || []).length || (f.countries || []).includes(w.country || ''))
    .filter((w) => !(f.wires || []).length || (f.wires || []).includes(String(w.wireSerialNumber)));
  const items = live.map((w) => ({ label: String(w.wireSerialNumber), value: m.pick(w) })).sort((a, b) => (m.asc ? a.value - b.value : b.value - a.value)).slice(0, 12);
  return { items, unit: m.unit, lowLength: c.p.sop('low_length_warning_ft', 2000) };
}
export function kpiW1(c: Ctx) {
  const lim = c.p.sop('retire_runs_limit', 220), warn = c.p.sop('retire_runs_warning', 180);
  const vals = c.wires.filter(LIVE).map((w) => ({ wire: String(w.wireSerialNumber), runs: wireRunCount(w, c.allJobs) }));
  const items = vals.map((v) => ({ label: v.wire, value: Math.round((v.runs / lim) * 1000) / 10 })).sort((a, b) => b.value - a.value).slice(0, 12);
  const bands = [0, 20, 40, 60, 80].map((lo, i) => ({ label: `${lo}–${lo + 20}%`, value: vals.filter((v) => { const pc = (v.runs / lim) * 100; return pc >= lo && (pc < lo + 20 || (i === 4 && pc >= 80)); }).length }));
  return { items, bands, limit: lim, warning: warn };
}

export const KPI_INFO: { id: string; section: 'general' | 'compliance' | 'jobs' | 'maintenance' | 'integrity'; title: string; about: string }[] = [
  { id: 'G1', section: 'general', title: 'Runs logged', about: 'Volume of work in the selection.' },
  { id: 'G2', section: 'general', title: 'Hours worked', about: 'Exposure of the fleet.' },
  { id: 'G3', section: 'general', title: 'Wire cut', about: 'Consumption in the selection, shop cuts included.' },
  { id: 'G4', section: 'general', title: 'Active wires', about: 'Wires in service, the registry and drums.' },
  { id: 'G5', section: 'general', title: 'Open alerts', about: 'Critical, warning and suspicious items open now.' },
  { id: 'G6', section: 'general', title: 'Awaiting approval', about: 'Runs and maintenance pending in WIREGUARD, and the oldest.' },
  { id: 'C12', section: 'general', title: 'Compliance score', about: 'Mean of pre-job test, cut-back on trips, cut-back on jarring and tension, equally weighted.' },
  { id: 'C1', section: 'compliance', title: 'Pre-job test compliance', about: 'A passing Wrap or Torsional test before each job, and a Tension test within its window.' },
  { id: 'C2', section: 'compliance', title: 'Cut-back on trips', about: 'Cut back and re-terminated every few trips (SOP limit).' },
  { id: 'C3', section: 'compliance', title: 'Cut-back on jarring', about: 'Cut back after the SOP number of impacts or minutes of jarring since the last cut.' },
  { id: 'C4', section: 'compliance', title: 'Tension within limit', about: 'Max tension within the new-wire and used-wire share of rated MBL.' },
  { id: 'C5', section: 'compliance', title: 'Discard rule respected', about: 'Active wires past the OD or run-count retirement threshold. Should be zero.' },
  { id: 'C6', section: 'compliance', title: 'MPI currency', about: 'Active drums with a valid MPI certificate.' },
  { id: 'J7', section: 'jobs', title: 'Tension utilisation per run', about: 'Each run’s max tension as a share of rated MBL, against the limits.' },
  { id: 'J9', section: 'jobs', title: 'Runs over the tension limit', about: 'How often the tension rule is broken, per month.' },
  { id: 'M5', section: 'maintenance', title: 'Time since last passing test', about: 'Which wires in service are due a pre-job test.' },
  { id: 'W14', section: 'integrity', title: 'Wires needing attention first', about: 'Least length left, most worn, or most worked.' },
  { id: 'W1', section: 'integrity', title: 'Life consumed', about: 'Runs against the retirement limit.' },
];
