// Winch data: plots and guidelines check (6z.26). Reads a winch export (time, depth, line speed, tension), splits the
// trip into phases, places every sample in a well zone from the survey, and checks it against the cable rules.
// Pure TypeScript: the Closure tab runs it in the browser; tests run it in Node.

// ---------------------------------------------------------------- rules

export type RuleSetKey = 'post' | 'seasoning';
export interface RuleSet {
  name: string;
  nearSurface: { tiers: [number, number][] };
  maxPooh: { limit: number };
  rihTension: { overSpeed: number; perKft: number; fromDepth: number };
  curveSpeed: { limit: number };
  curveTension: { min: number; max: number };
  lateralTension: { max: number };
  verticalTension: { atKop: number; perKftAbove: number };
  pumpSpeed: { max: number };
  pumpTension: { band: number; lwFrom: number; lwTo: number };
  detect: { speedSec: number; tensionSec: number; mergeSec: number };
}
export type Rules = Record<RuleSetKey, RuleSet>;
export type RuleKey = Exclude<keyof RuleSet, 'name'>;

export const RULE_DEFAULTS: Rules = {
  post: {
    name: 'Post-seasoning procedures',
    nearSurface: { tiers: [[100, 100], [250, 200], [1000, 500]] },
    maxPooh: { limit: 800 },
    rihTension: { overSpeed: 100, perKft: 100, fromDepth: 100 },
    curveSpeed: { limit: 200 },
    curveTension: { min: 1800, max: 2100 },
    lateralTension: { max: 2400 },
    verticalTension: { atKop: 2200, perKftAbove: 100 },
    pumpSpeed: { max: 500 },
    pumpTension: { band: 250, lwFrom: 200, lwTo: 1500 },
    detect: { speedSec: 3, tensionSec: 5, mergeSec: 30 },
  },
  seasoning: {
    name: 'Seasoning procedures',
    nearSurface: { tiers: [[100, 50], [250, 100], [1000, 250]] },
    maxPooh: { limit: 400 },
    rihTension: { overSpeed: 100, perKft: 100, fromDepth: 100 },
    curveSpeed: { limit: 150 },
    curveTension: { min: 1500, max: 1800 },
    lateralTension: { max: 2000 },
    verticalTension: { atKop: 1800, perKftAbove: 100 },
    pumpSpeed: { max: 350 },
    pumpTension: { band: 250, lwFrom: 200, lwTo: 1500 },
    detect: { speedSec: 3, tensionSec: 5, mergeSec: 30 },
  },
};

export const RULE_SET_LABEL: Record<RuleSetKey, string> = { post: 'Post-seasoning (seasoned cable)', seasoning: 'Seasoning procedures' };

/** Each rule: its label, the limits that can be edited (with a short name each) and the guideline text. */
export const RULE_FIELDS: { key: RuleKey; label: string; fields: 'tiers' | { f: string; label: string; unit: string }[]; text: string }[] = [
  { key: 'nearSurface', label: 'POOH speed near surface', fields: 'tiers', text: 'Within [d1] ft: [v1] fpm · [d2] ft: [v2] fpm · [d3] ft: [v3] fpm' },
  { key: 'maxPooh', label: 'Max POOH speed', fields: [{ f: 'limit', label: 'Limit', unit: 'fpm' }], text: '[limit] fpm, horizontal and vertical' },
  { key: 'rihTension', label: 'RIH tension', fields: [{ f: 'overSpeed', label: 'Over speed', unit: 'lbs' }, { f: 'perKft', label: 'Per 1,000 ft TVD', unit: 'lbs' }, { f: 'fromDepth', label: 'From', unit: 'ft' }],
    text: '[overSpeed] lbs over the line speed, and [perKft] lbs per 1,000 ft TVD (the stricter); checked from [fromDepth] ft down to the heel' },
  { key: 'curveSpeed', label: 'Speed in the curve', fields: [{ f: 'limit', label: 'Limit', unit: 'fpm' }], text: 'RIH and POOH [limit] fpm in the heel' },
  { key: 'curveTension', label: 'POOH tension in the curve', fields: [{ f: 'min', label: 'Min', unit: 'lbs' }, { f: 'max', label: 'Max', unit: 'lbs' }], text: '[min] – [max] lbs in the heel' },
  { key: 'lateralTension', label: 'POOH tension in the lateral', fields: [{ f: 'max', label: 'Max', unit: 'lbs' }], text: 'Max [max] lbs' },
  { key: 'verticalTension', label: 'POOH tension in the vertical', fields: [{ f: 'atKop', label: 'At KOP', unit: 'lbs' }, { f: 'perKftAbove', label: 'Less per 1,000 ft', unit: 'lbs' }],
    text: 'Max [atKop] lbs at KOP, [perKftAbove] lbs less per 1,000 ft above it' },
  { key: 'pumpSpeed', label: 'Pump-down speed', fields: [{ f: 'max', label: 'Max', unit: 'fpm' }], text: 'Max [max] fpm (drop the rate if needed)' },
  { key: 'pumpTension', label: 'Pump-down tension (advice)', fields: [{ f: 'band', label: 'Band ±', unit: 'lbs' }, { f: 'lwFrom', label: 'Measured from', unit: 'ft' }, { f: 'lwTo', label: 'Measured to', unit: 'ft' }],
    text: 'Close to the vertical line weight (measured [lwFrom]–[lwTo] ft above the curve) ± [band] lbs' },
  { key: 'detect', label: 'Detection', fields: [{ f: 'speedSec', label: 'Speed', unit: 's' }, { f: 'tensionSec', label: 'Tension', unit: 's' }, { f: 'mergeSec', label: 'Merge', unit: 's' }],
    text: 'A violation counts when it lasts [speedSec] s or more (speed) or [tensionSec] s or more (tension); violations less than [mergeSec] s apart are one' },
];

export const fmt = (n: number | null | undefined, d = 0) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));

export function ruleText(R: RuleSet, key: RuleKey): string {
  let s = RULE_FIELDS.find((r) => r.key === key)!.text;
  if (key === 'nearSurface') {
    R.nearSurface.tiers.forEach(([d, v], i) => { s = s.replace(`[d${i + 1}]`, fmt(d)).replace(`[v${i + 1}]`, fmt(v)); });
    return s;
  }
  for (const [f, v] of Object.entries(R[key])) s = s.split(`[${f}]`).join(fmt(v as number));
  return s;
}

/** A saved rule set from storage or a JSON file, or null when it is not one. */
export function checkRules(o: unknown): Rules | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Partial<Rules>;
  for (const k of ['post', 'seasoning'] as const) {
    const s = r[k];
    if (!s || typeof s !== 'object') return null;
    for (const f of RULE_FIELDS) {
      const v = (s as unknown as Record<string, unknown>)[f.key];
      if (!v || typeof v !== 'object') return null;
      if (f.fields === 'tiers') {
        const t = (v as { tiers?: unknown }).tiers;
        if (!Array.isArray(t) || t.length !== 3 || t.some((x) => !Array.isArray(x) || x.length !== 2 || x.some((n) => typeof n !== 'number'))) return null;
      } else if (f.fields.some((x) => typeof (v as Record<string, unknown>)[x.f] !== 'number')) return null;
    }
  }
  return r as Rules;
}

// ---------------------------------------------------------------- reading files

export const median = (a: number[]) => {
  if (!a.length) return NaN;
  const b = [...a].sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};

export interface Table { header: string[]; data: string[][]; delim: string; preview: string; hasHeader: boolean }

function detectDelim(lines: string[]): { d: string | RegExp; name: string } {
  const cands: [string | RegExp, string][] = [['\t', 'tab'], [',', 'comma'], [';', 'semicolon'], [/\s+/, 'spaces']];
  let best: { d: string | RegExp; name: string; med: number } | null = null;
  for (const [d, name] of cands) {
    const med = median(lines.slice(0, 30).map((l) => l.trim().split(d).length));
    if (med >= 3 && (!best || med > best.med)) best = { d, name, med };
  }
  return best ?? { d: /\s+/, name: 'spaces' };
}

const isNum = (v: string) => v !== '' && !Number.isNaN(parseFloat(v.replace(',', '.')));
export const num = (v: unknown) => parseFloat(String(v ?? '').replace(',', '.'));

/** A delimited text file as a table: finds the delimiter, skips any preamble and takes the header row above the data. */
export function parseTable(text: string): Table {
  const raw = text.split(/\r?\n/).filter((l) => l.trim().length);
  const { d, name } = detectDelim(raw.slice(0, 200));
  const rows = raw.map((l) => l.trim().split(d).map((c) => c.trim().replace(/^"|"$/g, '')));
  let start = 0;
  for (let i = 0; i < Math.min(rows.length, 200); i++) {
    const n = rows[i].filter(isNum).length;
    if (n >= 2 && n >= rows[i].length / 2) { start = i; break; }
  }
  let header: string[] | null = null;
  if (start > 0) { const h = rows[start - 1]; if (h.filter(isNum).length < h.length / 2) header = h; }
  const ncol = median(rows.slice(start, start + 50).map((r) => r.length)) || 0;
  const hasHeader = !!header;
  if (!header) header = Array.from({ length: ncol }, (_, i) => `Column ${i + 1}`);
  return { header, data: rows.slice(start).filter((r) => r.length >= ncol - 1), delim: name, preview: raw.slice(0, 8).join('\n'), hasHeader };
}

export function guessCol(header: string[], pats: RegExp[], exclude: number[] = []): number {
  const H = header.map((h) => h.toLowerCase());
  for (const p of pats) {
    const i = H.findIndex((h, idx) => !exclude.includes(idx) && p.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

export type TimeMode = 'auto' | 'clock' | 'datetime' | 'elapsed_s' | 'elapsed_min' | 'epoch' | 'index';
export const TIME_MODES: { value: TimeMode; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' }, { value: 'clock', label: 'Clock HH:MM:SS' }, { value: 'datetime', label: 'Date and time' },
  { value: 'elapsed_s', label: 'Elapsed seconds' }, { value: 'elapsed_min', label: 'Elapsed minutes' }, { value: 'epoch', label: 'Epoch (s or ms)' },
  { value: 'index', label: 'No time: 1 sample a second' },
];

export function parseDate(s: string): number {
  let m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000;
  m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return Date.UTC(y, +m[2] - 1, +m[1]) / 1000; }
  m = s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m) return Date.UTC(2000 + +m[1], +m[2] - 1, +m[3]) / 1000;
  const d = Date.parse(s);
  return Number.isNaN(d) ? NaN : d / 1000;
}

/** Seconds (UTC) from a time cell. */
export function parseTime(v: unknown, mode: TimeMode, dateStr?: string | null): number {
  const s = String(v ?? '').trim();
  if (mode === 'elapsed_s') return parseFloat(s);
  if (mode === 'elapsed_min') return parseFloat(s) * 60;
  if (mode === 'epoch') { let n = parseFloat(s); if (n > 1e11) n /= 1000; return n; }
  const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(AM|PM)?$/i);
  if (m) {
    let h = +m[1];
    const mi = +m[2], se = m[3] ? parseFloat(m[3]) : 0;
    if (m[4]) { if (/pm/i.test(m[4]) && h < 12) h += 12; if (/am/i.test(m[4]) && h === 12) h = 0; }
    let base = 0;
    const dpart = s.slice(0, m.index).trim() || dateStr || '';
    if (dpart) { const d = parseDate(dpart); if (!Number.isNaN(d)) base = d; }
    return base + h * 3600 + mi * 60 + se;
  }
  const n = parseFloat(s);
  return Number.isNaN(n) ? NaN : n;
}

export function autoTimeMode(sample: unknown): Exclude<TimeMode, 'auto'> {
  const s = String(sample ?? '').trim();
  if (/\d{1,2}:\d{2}/.test(s)) return /\d{4}[-/]\d|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(s) ? 'datetime' : 'clock';
  const n = parseFloat(s);
  if (Number.isNaN(n)) return 'index';
  return n > 1e9 ? 'epoch' : 'elapsed_s';
}

export const UNIT_DEPTH = { ft: 1, m: 3.28084 } as const;
export const UNIT_SPEED = { fpm: 1, mpm: 3.28084, fps: 60, mps: 196.85 } as const;
export const UNIT_TENSION = { lbs: 1, kgf: 2.20462, daN: 2.24809, kN: 224.809 } as const;
export type SpeedSign = 'abs' | 'signed' | 'signedInv';

export interface Mapping {
  time: number; depth: number; speed: number; tension: number; date: number;
  timeMode: TimeMode; depthUnit: keyof typeof UNIT_DEPTH; speedUnit: keyof typeof UNIT_SPEED; tensionUnit: keyof typeof UNIT_TENSION;
  smooth: number; minDepth: number; speedSign: SpeedSign;
}

/** The first guess at which column is which and in what unit, from the header names. */
export function guessMapping(t: Table): Mapping {
  const ct = guessCol(t.header, [/^time$/, /time/, /clock/, /^t$/, /sec/, /elapsed/]);
  const cd = guessCol(t.header, [/^depth/, /depth/, /^md$/, /measured/, /dept/], [ct]);
  const cs = guessCol(t.header, [/speed/, /veloc/, /^rate$/, /fpm/, /spd/], [ct, cd]);
  const cten = guessCol(t.header, [/tension/, /^tens/, /weight/, /cht/, /^wt/, /load/, /lbs/, /pull/], [ct, cd, cs]);
  const cdate = guessCol(t.header, [/^date$/, /date/], [ct, cd, cs, cten]);
  const H = (i: number) => (t.header[i] ?? '').toLowerCase();
  return {
    time: ct, depth: cd >= 0 ? cd : 0, speed: cs, tension: cten >= 0 ? cten : Math.min(1, t.header.length - 1), date: cdate, timeMode: 'auto',
    depthUnit: /\(m\)|\bm\b|meter|metre/.test(H(cd)) ? 'm' : 'ft',
    speedUnit: /m\/min|mpm/.test(H(cs)) ? 'mpm' : 'fpm',
    tensionUnit: /kgf|kg/.test(H(cten)) ? 'kgf' : /dan/.test(H(cten)) ? 'daN' : /kn/.test(H(cten)) ? 'kN' : 'lbs',
    smooth: 5, minDepth: 0, speedSign: 'abs',
  };
}

export const resolvedTimeMode = (t: Table, m: Mapping): Exclude<TimeMode, 'auto'> =>
  m.timeMode !== 'auto' ? m.timeMode : m.time < 0 ? 'index' : autoTimeMode(t.data[0]?.[m.time]);

/** Problems with a mapping, in words; empty when it reads. */
export function mappingProblems(t: Table, m: Mapping): string[] {
  const out: string[] = [];
  if (!t.data.length) return ['The file has no data rows'];
  if (m.depth === m.tension) out.push('Depth and tension point to the same column');
  const mode = resolvedTimeMode(t, m);
  if (m.time >= 0 && mode !== 'index') {
    const a = parseTime(t.data[0][m.time], mode), b = parseTime(t.data[Math.min(10, t.data.length - 1)][m.time], mode);
    if (Number.isNaN(a) || Number.isNaN(b)) out.push('The time column could not be read: pick another time format');
  }
  if (Number.isNaN(num(t.data[0][m.depth]))) out.push('The depth column is not a number');
  if (Number.isNaN(num(t.data[0][m.tension]))) out.push('The tension column is not a number');
  return out;
}

// ---------------------------------------------------------------- survey

export interface Station { md: number; inc: number; tvd: number }
export interface Survey { kop: number; p30: number; lat: number; td: number; stations: Station[]; source: string }

function fillTvd(st: Station[]) {
  st[0].tvd = st[0].md * Math.cos((st[0].inc * Math.PI) / 180);
  for (let i = 1; i < st.length; i++) {
    const a = (((st[i - 1].inc + st[i].inc) / 2) * Math.PI) / 180;
    st[i].tvd = st[i - 1].tvd + (st[i].md - st[i - 1].md) * Math.cos(a);
  }
}

/** Zones from the four depths: vertical to KOP, a straight build to 30° and on to 90° at the lateral. */
export function manualSurvey(kop: number, p30: number, lat: number, td: number): Survey | null {
  if ([kop, p30, lat, td].some((n) => Number.isNaN(n)) || !(kop < p30 && p30 < lat && lat <= td)) return null;
  const st: Station[] = [{ md: 0, inc: 0, tvd: 0 }, { md: kop, inc: 0, tvd: 0 }, { md: p30, inc: 30, tvd: 0 }, { md: lat, inc: 90, tvd: 0 }, { md: td, inc: 90, tvd: 0 }];
  fillTvd(st);
  return { kop, p30, lat, td, stations: st, source: 'manual' };
}

/** A vertical well (6z.41): the whole hole is the vertical zone, so only the vertical rules apply. */
export function verticalSurvey(td: number): Survey {
  const d = Math.max(1, td);
  return { kop: d, p30: d + 0.1, lat: d + 0.2, td: d + 0.2, stations: [{ md: 0, inc: 0, tvd: 0 }, { md: d + 0.2, inc: 0, tvd: d + 0.2 }], source: 'vertical' };
}

export interface SurveyMapping { md: number; inc: number; tvd: number; unit: keyof typeof UNIT_DEPTH; kopInc: number; latInc: number }
export function guessSurveyMapping(t: Table): SurveyMapping {
  return {
    md: Math.max(0, guessCol(t.header, [/^md$/, /meas/, /depth/, /^dept/])), inc: Math.max(0, guessCol(t.header, [/inc/, /angle/, /devi/])),
    tvd: guessCol(t.header, [/tvd/, /vert/]), unit: 'ft', kopInc: 3, latInc: 88,
  };
}

/** Zones from a directional survey file; the lateral falls back to TD when the well never reaches the angle. */
export function fileSurvey(t: Table, m: SurveyMapping, name: string): Survey | null {
  const k = UNIT_DEPTH[m.unit];
  const st = t.data.map((r) => ({ md: num(r[m.md]) * k, inc: num(r[m.inc]), tvd: m.tvd >= 0 ? num(r[m.tvd]) * k : NaN }))
    .filter((s) => !Number.isNaN(s.md) && !Number.isNaN(s.inc)).sort((a, b) => a.md - b.md);
  if (st.length < 2) return null;
  if (st.some((s) => Number.isNaN(s.tvd))) fillTvd(st);
  const at = (target: number) => {
    for (let i = 1; i < st.length; i++) {
      if (st[i].inc >= target) { const a = st[i - 1], b = st[i]; return b.inc === a.inc ? b.md : a.md + ((target - a.inc) / (b.inc - a.inc)) * (b.md - a.md); }
    }
    return NaN;
  };
  const kop = at(m.kopInc), p30 = at(30), td = st[st.length - 1].md;
  let lat = at(m.latInc);
  if (Number.isNaN(kop) || Number.isNaN(p30)) return null;
  if (Number.isNaN(lat)) lat = td;
  return { kop, p30, lat, td, stations: st, source: name };
}

export function tvdAt(sv: Survey, md: number): number {
  const st = sv.stations;
  if (md <= st[0].md) return md;
  for (let i = 1; i < st.length; i++) {
    if (md <= st[i].md) { const a = st[i - 1], b = st[i]; return a.tvd + ((md - a.md) / (b.md - a.md || 1)) * (b.tvd - a.tvd); }
  }
  return st[st.length - 1].tvd;
}

export const ZONE_NAMES = ['Vertical', 'Dev. build (KOP–30°)', 'Heel (30°–89°)', 'Lateral'] as const;
export const zoneOf = (sv: Survey, d: number) => (d < sv.kop ? 0 : d < sv.p30 ? 1 : d < sv.lat ? 2 : 3);

// ---------------------------------------------------------------- analysis

export type Dir = 'RIH' | 'POOH' | 'STOP';
export type Phase = 'RIH' | 'BOTTOM' | 'POOH';
export interface Sample { t: number; depth: number; ten: number; sp: number; dir: Dir; dt: number; phase: Phase; zone: number; tvd: number }

/** The usable samples in time order, in ft, ft/min and lbs, with the direction from the smoothed depth slope. */
export function buildSamples(t: Table, m: Mapping): Sample[] {
  const mode = resolvedTimeMode(t, m);
  const kd = UNIT_DEPTH[m.depthUnit], ks = UNIT_SPEED[m.speedUnit], kt = UNIT_TENSION[m.tensionUnit];
  const raw: { t: number; depth: number; ten: number; spRaw: number }[] = [];
  let lastT: number | null = null, dayOff = 0;
  for (let i = 0; i < t.data.length; i++) {
    const r = t.data[i];
    const depth = num(r[m.depth]) * kd, ten = num(r[m.tension]) * kt;
    if (Number.isNaN(depth) || Number.isNaN(ten)) continue;
    let tt = mode === 'index' || m.time < 0 ? i : parseTime(r[m.time], mode, m.date >= 0 ? r[m.date] : null);
    if (Number.isNaN(tt)) continue;
    // a clock with no date rolls over at midnight
    if (mode === 'clock') { if (lastT !== null && tt + dayOff < lastT - 3600) dayOff += 86400; tt += dayOff; }
    lastT = tt;
    raw.push({ t: tt, depth, ten, spRaw: m.speed >= 0 ? num(r[m.speed]) * ks : NaN });
  }
  raw.sort((a, b) => a.t - b.t);
  const out: Sample[] = [];
  for (const s of raw) {
    if (out.length && s.t === out[out.length - 1].t) continue;
    out.push({ t: s.t, depth: s.depth, ten: s.ten, sp: s.spRaw, dir: 'STOP', dt: 1, phase: 'RIH', zone: 0, tvd: s.depth });
  }
  const N = Math.max(1, Math.round(m.smooth) || 5);
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - N)], b = out[Math.min(out.length - 1, i + N)];
    const slope = ((b.depth - a.depth) / (b.t - a.t || 1)) * 60;
    out[i].dir = slope > 15 ? 'RIH' : slope < -15 ? 'POOH' : 'STOP';
    let sp = out[i].sp;
    if (Number.isNaN(sp)) sp = Math.abs(slope);
    else {
      if (m.speedSign === 'signed' && sp < 0 && out[i].dir === 'STOP') out[i].dir = 'POOH';
      sp = Math.abs(sp);
    }
    out[i].sp = sp;
    out[i].dt = i < out.length - 1 ? out[i + 1].t - out[i].t : i ? out[i].t - out[i - 1].t : 1;
  }
  return out.filter((s) => s.depth >= m.minDepth);
}

export interface Phases { iStart: number; iBottom: number; iSteady: number; iEnd: number; maxD: number; rihSec: number; bottomSec: number; poohSec: number }

export function phases(S: Sample[]): Phases {
  let imax = 0;
  for (let i = 0; i < S.length; i++) if (S[i].depth > S[imax].depth) imax = i;
  const maxD = S[imax].depth;
  let iStart = S.findIndex((s) => s.depth > 50 && s.dir === 'RIH');
  if (iStart < 0) iStart = 0;
  const iBottom = Math.max(0, S.findIndex((s) => s.depth >= maxD * 0.995));
  // steady POOH: after bottom, the first stretch pulling out over 50 ft/min for a minute or more
  let iSteady = S.length - 1;
  for (let i = iBottom; i < S.length; i++) {
    if (S[i].dir === 'POOH' && S[i].sp > 50) {
      let j = i, acc = 0;
      while (j < S.length && S[j].dir === 'POOH' && S[j].sp > 50) { acc += S[j].dt; j++; }
      if (acc >= 60) { iSteady = i; break; }
      i = j;
    }
  }
  let iEnd = S.length - 1;
  while (iEnd > iSteady && S[iEnd].depth < 50) iEnd--;
  return { iStart, iBottom, iSteady, iEnd, maxD, rihSec: S[iBottom].t - S[iStart].t, bottomSec: S[iSteady].t - S[iBottom].t, poohSec: S[iEnd].t - S[iSteady].t };
}

export const RULE_META: Record<Exclude<RuleKey, 'detect'>, { label: string; q: 'sp' | 'ten'; unit: string; kind: 'speed' | 'tension'; advice?: boolean }> = {
  nearSurface: { label: 'POOH speed near surface', q: 'sp', unit: 'fpm', kind: 'speed' },
  maxPooh: { label: 'Max POOH speed', q: 'sp', unit: 'fpm', kind: 'speed' },
  rihTension: { label: 'RIH tension', q: 'ten', unit: 'lbs', kind: 'tension' },
  curveSpeed: { label: 'Speed in the curve', q: 'sp', unit: 'fpm', kind: 'speed' },
  curveTension: { label: 'POOH tension in the curve', q: 'ten', unit: 'lbs', kind: 'tension' },
  lateralTension: { label: 'POOH tension in the lateral', q: 'ten', unit: 'lbs', kind: 'tension' },
  verticalTension: { label: 'POOH tension in the vertical', q: 'ten', unit: 'lbs', kind: 'tension' },
  pumpSpeed: { label: 'Pump-down speed', q: 'sp', unit: 'fpm', kind: 'speed' },
  pumpTension: { label: 'Pump-down tension (advice)', q: 'ten', unit: 'lbs', kind: 'tension', advice: true },
};
export type CheckKey = keyof typeof RULE_META;
export const CHECK_KEYS = Object.keys(RULE_META) as CheckKey[];

export interface Finding {
  rule: CheckKey; label: string; unit: string; advice: boolean;
  t0: number; t1: number; sec: number; d0: number; d1: number; zone: number; dir: Dir; phase: Phase;
  worst: number; limit: number; side: 'min' | 'max'; delta: number;
}
export interface ZoneStats { name: string; lo: number; hi: number | null; rihAvg: number; rihMax: number; poohAvg: number; poohMax: number; rihMinT: number; poohMaxT: number; flags: number }
export interface Analysis {
  S: Sample[]; P: Phases; sv: Survey; R: RuleSet; set: RuleSetKey; LW: number;
  viol: Finding[]; advice: Finding[]; zones: ZoneStats[]; ruleCounts: Record<CheckKey, number>;
  kpi: { maxD: number; rihSec: number; bottomSec: number; poohSec: number; avgRih: number; avgPooh: number; maxT: number; nViol: number };
}

/** The limit a sample must keep for one rule, or null when the rule does not apply to it. */
export function limitFor(key: CheckKey, s: Sample, R: RuleSet, sv: Survey, LW: number): { min?: number; max?: number } | null {
  switch (key) {
    case 'nearSurface':
      if (s.dir !== 'POOH') return null;
      for (const [d, v] of R.nearSurface.tiers) if (s.depth <= d) return { max: v };
      return null;
    case 'maxPooh': return s.dir === 'POOH' ? { max: R.maxPooh.limit } : null;
    case 'rihTension':
      return s.phase === 'RIH' && s.dir === 'RIH' && s.depth >= R.rihTension.fromDepth && s.depth < sv.lat
        ? { min: Math.max(s.sp + R.rihTension.overSpeed, (R.rihTension.perKft * s.tvd) / 1000) } : null;
    case 'curveSpeed': return s.zone === 2 && s.dir !== 'STOP' ? { max: R.curveSpeed.limit } : null;
    case 'curveTension': return s.zone === 2 && s.dir === 'POOH' ? { max: R.curveTension.max } : null;
    case 'lateralTension': return s.zone === 3 && s.dir === 'POOH' ? { max: R.lateralTension.max } : null;
    case 'verticalTension':
      return s.depth < sv.p30 && s.dir === 'POOH' ? { max: R.verticalTension.atKop - (Math.max(0, sv.kop - s.depth) / 1000) * R.verticalTension.perKftAbove } : null;
    case 'pumpSpeed': return s.phase === 'RIH' && s.dir === 'RIH' && s.zone >= 2 ? { max: R.pumpSpeed.max } : null;
    case 'pumpTension':
      return s.phase === 'RIH' && s.dir === 'RIH' && s.zone === 3 && !Number.isNaN(LW) ? { min: LW - R.pumpTension.band, max: LW + R.pumpTension.band } : null;
  }
}

export function analyse(S0: Sample[], sv: Survey, rules: Rules, set: RuleSetKey): Analysis {
  const R = rules[set];
  const S = S0.map((s) => ({ ...s }));
  const P = phases(S);
  S.forEach((s, i) => { s.phase = i < P.iBottom ? 'RIH' : i < P.iSteady ? 'BOTTOM' : 'POOH'; s.zone = zoneOf(sv, s.depth); s.tvd = tvdAt(sv, s.depth); });
  // vertical line weight: the median RIH tension lwFrom–lwTo ft above the 30° point
  const LW = median(S.filter((s) => s.phase === 'RIH' && s.dir === 'RIH' && s.depth >= sv.p30 - R.pumpTension.lwTo && s.depth <= sv.p30 - R.pumpTension.lwFrom).map((s) => s.ten));
  const viol: Finding[] = [], advice: Finding[] = [];
  for (const key of CHECK_KEYS) {
    const M = RULE_META[key];
    const minSec = M.kind === 'speed' ? R.detect.speedSec : R.detect.tensionSec;
    const events: Finding[] = [];
    let cur: Finding | null = null;
    const flush = () => { if (cur && cur.sec >= minSec) events.push(cur); cur = null; };
    for (const s of S) {
      const L = limitFor(key, s, R, sv, LW);
      let lim: number | null = null, side: 'min' | 'max' = 'max';
      if (L) {
        const v = s[M.q];
        if (L.max != null && v > L.max) { lim = L.max; side = 'max'; }
        if (L.min != null && v < L.min) { lim = L.min; side = 'min'; }
      }
      if (lim == null) { flush(); continue; }
      const v = s[M.q], dlt = Math.abs(v - lim);
      if (!cur) {
        cur = { rule: key, label: M.label, unit: M.unit, advice: !!M.advice, t0: s.t, t1: s.t + s.dt, sec: s.dt, d0: s.depth, d1: s.depth, zone: s.zone, dir: s.dir, phase: s.phase, worst: v, limit: lim, side, delta: dlt };
      } else {
        cur.t1 = s.t + s.dt; cur.sec += s.dt; cur.d0 = Math.min(cur.d0, s.depth); cur.d1 = Math.max(cur.d1, s.depth);
        if (dlt > cur.delta) Object.assign(cur, { delta: dlt, worst: v, limit: lim, side, zone: s.zone, dir: s.dir });
      }
    }
    flush();
    // events less than mergeSec apart, same direction, are one
    const merged: Finding[] = [];
    for (const e of events) {
      const p = merged[merged.length - 1];
      if (p && e.t0 - p.t1 < R.detect.mergeSec && p.dir === e.dir) {
        p.t1 = e.t1; p.sec = p.t1 - p.t0; p.d0 = Math.min(p.d0, e.d0); p.d1 = Math.max(p.d1, e.d1);
        if (e.delta > p.delta) Object.assign(p, { delta: e.delta, worst: e.worst, limit: e.limit, side: e.side, zone: e.zone });
      } else merged.push(e);
    }
    (M.advice ? advice : viol).push(...merged);
  }
  viol.sort((a, b) => a.t0 - b.t0);
  advice.sort((a, b) => a.t0 - b.t0);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const max = (a: number[]) => (a.length ? a.reduce((x, y) => Math.max(x, y), -Infinity) : NaN);
  const min = (a: number[]) => (a.length ? a.reduce((x, y) => Math.min(x, y), Infinity) : NaN);
  const zones = ZONE_NAMES.map((name, z): ZoneStats => {
    const rih = S.filter((s) => s.zone === z && s.dir === 'RIH' && s.phase === 'RIH'), pooh = S.filter((s) => s.zone === z && s.dir === 'POOH');
    return {
      name, lo: [0, sv.kop, sv.p30, sv.lat][z], hi: [sv.kop, sv.p30, sv.lat, null][z],
      rihAvg: avg(rih.map((s) => s.sp)), rihMax: max(rih.map((s) => s.sp)), poohAvg: avg(pooh.map((s) => s.sp)), poohMax: max(pooh.map((s) => s.sp)),
      rihMinT: min(rih.map((s) => s.ten)), poohMaxT: max(pooh.map((s) => s.ten)), flags: viol.filter((v) => v.zone === z).length,
    };
  });
  const rihS = S.filter((s) => s.phase === 'RIH' && s.dir === 'RIH'), poohS = S.filter((s) => s.phase === 'POOH' && s.dir === 'POOH');
  const ruleCounts = Object.fromEntries(CHECK_KEYS.map((k) => [k, (RULE_META[k].advice ? advice : viol).filter((v) => v.rule === k).length])) as Record<CheckKey, number>;
  return {
    S, P, sv, R, set, LW, viol, advice, zones, ruleCounts,
    kpi: { maxD: P.maxD, rihSec: P.rihSec, bottomSec: P.bottomSec, poohSec: P.poohSec, avgRih: avg(rihS.map((s) => s.sp)), avgPooh: avg(poohS.map((s) => s.sp)), maxT: max(S.map((s) => s.ten)), nViol: viol.length },
  };
}

// ---------------------------------------------------------------- limit curves for the depth view

export function limitCurves(a: Analysis, step = 25) {
  const { sv, R, LW } = a;
  const D: number[] = [];
  for (let d = 0; d <= a.kpi.maxD; d += step) D.push(d);
  return {
    D,
    poohSpeed: D.map((d) => {
      let m: number = R.maxPooh.limit;
      for (const [dd, v] of R.nearSurface.tiers) if (d <= dd) { m = Math.min(m, v); break; }
      if (zoneOf(sv, d) === 2) m = Math.min(m, R.curveSpeed.limit);
      return m;
    }),
    rihSpeed: D.map((d) => {
      const z = zoneOf(sv, d);
      let m: number | null = null;
      if (z === 2) m = R.curveSpeed.limit;
      if (z >= 2) m = m == null ? R.pumpSpeed.max : Math.min(m, R.pumpSpeed.max);
      return m;
    }),
    poohTension: D.map((d) => (d < sv.p30 ? R.verticalTension.atKop - (Math.max(0, sv.kop - d) / 1000) * R.verticalTension.perKftAbove : zoneOf(sv, d) === 2 ? R.curveTension.max : R.lateralTension.max)),
    rihTensionMin: D.map((d) => (d >= R.rihTension.fromDepth && d < sv.lat ? (R.rihTension.perKft * tvdAt(sv, d)) / 1000 : null)),
    pumpBand: Number.isNaN(LW) ? null : { lo: LW - R.pumpTension.band, hi: LW + R.pumpTension.band, from: sv.lat },
  };
}

// ---------------------------------------------------------------- text and export

const pad2 = (n: number) => String(n).padStart(2, '0');
export const hms = (t: number) => { const d = new Date(t * 1000); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`; };
export const hm = (t: number) => { const d = new Date(t * 1000); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; };
export const dur = (s: number) => (s < 60 ? '<1m' : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${pad2(Math.round((s % 3600) / 60))}m`);
export const whereText = (v: Finding) => `${ZONE_NAMES[v.zone]} · ${v.dir === 'STOP' ? v.phase : v.dir}`;

export function findingsCsv(a: Analysis): string {
  const rows: (string | number)[][] = [['time', 'lasted_s', 'depth_from_ft', 'depth_to_ft', 'zone', 'direction', 'rule', 'worst', 'unit', 'limit_side', 'limit', 'delta', 'type']];
  [...a.viol, ...a.advice].sort((x, y) => x.t0 - y.t0).forEach((v) => rows.push([
    hms(v.t0), Math.round(v.sec), Math.round(v.d0), Math.round(v.d1), ZONE_NAMES[v.zone], v.dir, v.label, Math.round(v.worst), v.unit, v.side, Math.round(v.limit), Math.round(v.worst - v.limit), v.advice ? 'advice' : 'violation',
  ]));
  return rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');
}

// ---------------------------------------------------------------- demo

/** A made-up plug and perf run (1 sample a second) so the screen can be tried without a file. `rnd` is injectable for tests. */
export function demoRun(rnd: () => number = Math.random) {
  const kop = 7278, p30 = 9853, lat = 10934, td = 26415, maxD = 21464;
  const lines = ['Time\tDepth (ft)\tSpeed (ft/min)\tTension (lbs)'];
  const r = (a: number) => (rnd() - 0.5) * 2 * a;
  let t = 21 * 3600 + 46 * 60, d = 0, phase: Phase = 'RIH', hold = 0;
  const push = (sp: number, ten: number) => { lines.push(`${hms(t)}\t${d.toFixed(1)}\t${sp.toFixed(1)}\t${ten.toFixed(0)}`); t += 1; };
  for (let guard = 0; guard < 50_000; guard++) {
    if (phase === 'RIH') {
      let sp = d < kop ? 560 : d < p30 ? 600 : d < lat ? (d < lat - 700 ? 290 : 240) : 350;
      if (d < 300) sp = 200;
      sp += r(25);
      const tvd = Math.min(d, kop + (d - kop) * 0.7);
      let ten = d < kop ? (d < 6500 ? 120 + d * 0.03 : 0.1 * tvd + 150) : d < p30 ? 0.09 * tvd + 100 : d < lat ? 900 + r(40) : 800 + r(60);
      if (d > 19800 && d < 20100) ten = 1150;
      d += sp / 60;
      push(sp, ten + r(20));
      if (d >= maxD) { phase = 'BOTTOM'; hold = 8 * 60; }
    } else if (phase === 'BOTTOM') {
      push(r(3), 1500 + r(80));
      d -= 0.002;
      if (--hold <= 0) phase = 'POOH';
    } else {
      let sp = d > lat ? 460 : d > p30 ? (d > 10200 ? 590 : 400) : d > kop ? 560 : d > 1000 ? 720 : d > 250 ? 520 : d > 100 ? 190 : 90;
      sp += r(20);
      const ten = d > lat ? (d > 16000 && d < 20200 ? 2440 : 2300 + r(60)) : d > p30 ? 2040 + r(40) : d > kop ? 2290 + r(40) : 2200 - ((kop - d) / 1000) * 100 + (d > 2600 && d < 7100 ? 170 : -60);
      d -= sp / 60;
      if (d <= 0) { d = 0; push(0, ten); break; }
      push(sp, ten + r(15));
    }
  }
  return { text: lines.join('\n'), fileName: 'demo-run.txt', survey: { kop, p30, lat, td } };
}
