// Lineminder recordings (6z.41): the NOV / ASEP "Analyse" time-data file (*.da_tdat) the Lineminder panel writes.
// A TypeScript port of the owner's tdat2csv 1.1.0 reader (MIT): the same header layout, record stream, type-code
// units and self-checks, so the browser reads the file with nothing to install. Pure TypeScript, no browser or
// Worker APIs: the Closure tab runs it in the browser; tests run it in Node.
//
// Format (all integers little-endian):
//   0x000 "DTS\0" · 0x008 "da_tdat\0" · 0x010 uint32 start (local time stored as Unix seconds)
//   0x0A8 uint32 channels N · 0x0AC uint32 job fields · 0x0B8 uint32 enum options · 0x0BC start · 0x0C0 end · 0x0C4 period ms
//   0x100 N × 384-byte channel descriptors: name[32], type code at +32, engineering flag at +140
//   then job fields (label[32] + value[96]), enum options (uint32 id, uint32 index, label[32]), one uint32 block word
//   records: uint32 mask (bit i → channel i), int32 per set bit in channel order, uint32 elapsed ms; the first is a
//   full snapshot, later ones carry only the channels that changed (forward-fill); 8-byte terminator 08 00 00 00 ...

import type { Table } from './winchData';

export const MM_PER_FT = 304.8;
export const G_PER_LB = 453.59237;
export const UMS_PER_FTMIN = 5080; // 1 ft/min = 5.08 mm/s

export type Units = 'imperial' | 'metric';
type UnitDef = { cls: string; stored: string; imperial: [string, number]; metric: [string, number] };

/** Channel type code (descriptor byte +32) → unit class. From the file, never guessed from names. */
export const TYPES: Record<number, UnitDef> = {
  0: { cls: 'force', stored: 'g', imperial: ['lb', 1 / G_PER_LB], metric: ['kg', 1 / 1000] },
  1: { cls: 'length', stored: 'mm', imperial: ['ft', 1 / MM_PER_FT], metric: ['m', 1 / 1000] },
  3: { cls: 'speed', stored: 'µm/s', imperial: ['ft/min', 1 / UMS_PER_FTMIN], metric: ['m/min', 60 / 1e6] },
  6: { cls: 'flag', stored: 'bits', imperial: ['bits', 1], metric: ['bits', 1] },
  7: { cls: 'aux', stored: 'counts', imperial: ['counts', 1], metric: ['counts', 1] },
  10: { cls: 'frequency', stored: 'raw', imperial: ['raw', 1], metric: ['raw', 1] },
  16: { cls: 'encoder', stored: 'counts', imperial: ['counts', 1], metric: ['counts', 1] },
  19: { cls: 'events', stored: 'code', imperial: ['code', 1], metric: ['code', 1] },
  25: { cls: 'loadcell', stored: 'counts', imperial: ['counts', 1], metric: ['counts', 1] },
};
/** Depth, tension and speed: the calibrated engineering classes. */
export const CALIBRATED = new Set([0, 1, 3]);

export type ChannelStatus = 'series' | 'setpoint' | 'not recorded';
export interface TdatChannel {
  index: number; name: string; type: number; engineering: boolean;
  status: ChannelStatus; changes: number; first: number | null;
}
export interface Tdat {
  channels: TdatChannel[];
  job: Record<string, string>;
  enums: { enumId: number; index: number; label: string }[];
  /** Recording start and end as written (local wall-clock time stored as Unix seconds). */
  start: number; end: number; periodMs: number;
  /** Records, flat: record r has times[r], and channels chan[starts[r]..starts[r+1]) with vals at the same places. */
  times: Float64Array; starts: Uint32Array; chan: Uint8Array; vals: Int32Array;
  trailer: string;
}

const cstr = (b: Uint8Array) => {
  let n = b.indexOf(0);
  if (n < 0) n = b.length;
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[i]); // latin-1
  return s.trim();
};

/** Whether the bytes start like a .da_tdat file. */
export function isTdat(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 0x100) return false;
  const u = new Uint8Array(buf);
  return u[0] === 0x44 && u[1] === 0x54 && u[2] === 0x53 && cstr(u.subarray(8, 16)) === 'da_tdat';
}

/** Reads a .da_tdat file. Throws with a plain message when it is not one. */
export function parseTdat(buf: ArrayBuffer): Tdat {
  if (!isTdat(buf)) throw new Error('This is not a Lineminder (.da_tdat) file: the first bytes are not DTS / da_tdat.');
  const dv = new DataView(buf);
  const u = new Uint8Array(buf);
  const n = buf.byteLength;
  const u32 = (o: number) => dv.getUint32(o, true);
  const nch = u32(0xa8), njob = u32(0xac), nenum = u32(0xb8), t0 = u32(0xbc), t1 = u32(0xc0), period = u32(0xc4);
  if (nch < 1 || nch > 32) throw new Error(`The file says it has ${nch} channels; a Lineminder file has 1 to 32.`);
  let off = 0x100;
  const channels: TdatChannel[] = [];
  for (let i = 0; i < nch; i++) {
    channels.push({ index: i, name: cstr(u.subarray(off, off + 32)), type: u[off + 32], engineering: !!u[off + 140], status: 'not recorded', changes: 0, first: null });
    off += 0x180;
  }
  const job: Record<string, string> = {};
  for (let i = 0; i < njob && off + 0x80 <= n; i++) { job[cstr(u.subarray(off, off + 32))] = cstr(u.subarray(off + 32, off + 128)); off += 0x80; }
  const enums: Tdat['enums'] = [];
  for (let i = 0; i < nenum && off + 0x28 <= n; i++) { enums.push({ enumId: u32(off), index: u32(off + 4), label: cstr(u.subarray(off + 8, off + 40)) }); off += 0x28; }
  off += 4; // block header word

  // first pass: how many records and values
  let nrec = 0, nval = 0;
  for (let o = off; o + 4 <= n;) {
    const mask = u32(o);
    let bits = 0;
    for (let m = mask; m; m &= m - 1) bits++;
    const need = 4 * (bits + 2);
    if (o + need > n) break;
    nrec++; nval += bits; o += need;
  }
  const times = new Float64Array(nrec), starts = new Uint32Array(nrec + 1), chan = new Uint8Array(nval), vals = new Int32Array(nval);
  const counts = new Uint32Array(32);
  let r = 0, v = 0;
  while (off + 4 <= n) {
    const mask = u32(off);
    let bits = 0;
    for (let m = mask; m; m &= m - 1) bits++;
    const need = 4 * (bits + 2);
    if (off + need > n) break;
    starts[r] = v;
    let p = off + 4;
    for (let b = 0; b < 32; b++) {
      if ((mask >>> b) & 1) { chan[v] = b; vals[v] = dv.getInt32(p, true); counts[b]++; v++; p += 4; }
    }
    times[r] = u32(p);
    r++; off += need;
  }
  starts[nrec] = v;
  let trailer = '';
  for (let i = off; i < n; i++) trailer += u[i].toString(16).padStart(2, '0');
  const firstVals = new Map<number, number>();
  if (nrec) for (let i = starts[0]; i < starts[1]; i++) firstVals.set(chan[i], vals[i]);
  for (const c of channels) {
    c.changes = counts[c.index] ?? 0;
    c.first = firstVals.get(c.index) ?? null;
    c.status = c.changes > 1 ? 'series' : firstVals.has(c.index) ? 'setpoint' : 'not recorded';
  }
  return { channels, job, enums, start: t0, end: t1, periodMs: period, times, starts, chan, vals, trailer };
}

/** The output unit, multiplier and class of a channel. Unknown type codes stay raw integers. */
export function unitFor(c: Pick<TdatChannel, 'type'>, units: Units): { unit: string; k: number; cls: string; stored: string; known: boolean } {
  const t = TYPES[c.type];
  if (!t) return { unit: 'raw', k: 1, cls: `unknown type ${c.type}`, stored: 'raw', known: false };
  const [unit, k] = t[units];
  return { unit, k, cls: t.cls, stored: t.stored, known: true };
}

/** The recorder's clock, as written (local time). */
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export function clockText(startSec: number, ms: number): string {
  const d = new Date(startSec * 1000 + ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}

export interface ChannelRow {
  index: number; name: string; type: number; cls: string; stored: string; unit: string; engineering: boolean;
  status: ChannelStatus; changes: number; value: number | null; known: boolean;
}

/** One row per channel: class, stored and output unit, whether it is a series or a constant alarm set-point. */
export function channelTable(f: Tdat, units: Units = 'imperial'): ChannelRow[] {
  return f.channels.map((c) => {
    const u = unitFor(c, units);
    const value = c.status === 'setpoint' && c.first !== null ? (u.known && CALIBRATED.has(c.type) ? Math.round(c.first * u.k * 1000) / 1000 : c.first) : null;
    return { index: c.index, name: c.name, type: c.type, cls: u.cls, stored: u.stored, unit: u.unit, engineering: c.engineering, status: c.status, changes: c.changes, value, known: u.known };
  });
}

/** The channels most likely to be depth, tension and speed: by name, else the first series of that class. */
export function guessChannels(f: Tdat): { depth: number; tension: number; speed: number } {
  const series = f.channels.filter((c) => c.status === 'series');
  const pick = (names: RegExp[], type: number) => {
    for (const p of names) { const c = series.find((x) => p.test(x.name.toLowerCase())); if (c) return c.index; }
    return series.find((x) => x.type === type)?.index ?? -1;
  };
  return {
    depth: pick([/^depth corrected$/, /depth corr/, /^depth$/], 1),
    tension: pick([/^tension$/, /^line tension/, /^tension(?! \d)/], 0),
    speed: pick([/^speed$/, /line speed/], 3),
  };
}

/**
 * The recording as a table the winch check reads: DateTime, elapsed seconds and the chosen channels in the chosen
 * units, one row per step (forward-filled). Tension (force) channels keep the highest value inside each step, so
 * short jarring peaks are not lost between rows.
 */
export function tdatTable(f: Tdat, opts: { units?: Units; step?: number; channels: number[] }): Table {
  const units = opts.units ?? 'imperial';
  const stepMs = Math.max(100, Math.round((opts.step ?? 0.5) * 1000));
  const sel = opts.channels.map((i) => f.channels[i]).filter(Boolean);
  const conv = sel.map((c) => ({ c, ...unitFor(c, units), force: c.type === 0 }));
  const header = ['DateTime', 'Elapsed (s)', ...conv.map((x) => `${x.c.name} (${x.unit})`)];
  const state = new Float64Array(32).fill(NaN);
  // the highest value of each channel since the last row, starting from the value carried into the step
  const peak = new Float64Array(32).fill(NaN);
  const data: string[][] = [];
  const nrec = f.times.length;
  let next = 0;
  for (let r = 0; r < nrec; r++) {
    const t = f.times[r];
    for (let i = f.starts[r]; i < f.starts[r + 1]; i++) {
      const c = f.chan[i], v = f.vals[i];
      state[c] = v;
      if (Number.isNaN(peak[c]) || v > peak[c]) peak[c] = v;
    }
    if (t < next && r < nrec - 1) continue;
    const row = [clockText(f.start, t), (t / 1000).toFixed(3)];
    for (const x of conv) {
      const raw = x.force && !Number.isNaN(peak[x.c.index]) ? peak[x.c.index] : state[x.c.index];
      row.push(Number.isNaN(raw) ? '' : x.known && CALIBRATED.has(x.c.type) ? (raw * x.k).toFixed(2) : String(raw));
    }
    data.push(row);
    peak.set(state);
    next = (Math.floor(t / stepMs) + 1) * stepMs;
  }
  const preview = [header.join(','), ...data.slice(0, 7).map((r) => r.join(','))].join('\n');
  return { header, data, delim: 'Lineminder', preview, hasHeader: true };
}

export interface TdatCheck { name: string; ok: boolean; detail: string }

/** Independent checks that the units are right for this file (the converter's self-checks). */
export function tdatChecks(f: Tdat): TdatCheck[] {
  const out: TdatCheck[] = [];
  const nrec = f.times.length;
  const tLast = nrec ? f.times[nrec - 1] / 1000 : 0;
  const dur = f.end - f.start;
  out.push({ name: 'Recording length', ok: Math.abs(tLast - dur) < 5, detail: `last record at ${tLast.toFixed(1)} s, header says ${dur} s` });
  const g = guessChannels(f);
  if (g.depth >= 0 && g.speed >= 0) {
    const kd = unitFor(f.channels[g.depth], 'metric').k, ks = unitFor(f.channels[g.speed], 'metric').k;
    const st = new Float64Array(32).fill(NaN);
    const pts: [number, number, number][] = [];
    for (let r = 0; r < nrec; r++) {
      for (let i = f.starts[r]; i < f.starts[r + 1]; i++) st[f.chan[i]] = f.vals[i];
      if (!Number.isNaN(st[g.depth]) && !Number.isNaN(st[g.speed])) pts.push([f.times[r], st[g.depth] * kd, st[g.speed] * ks]);
    }
    const ratios: number[] = [];
    const W = 600, jump = Math.max(1, Math.floor(pts.length / 60));
    for (let i = 0; i + W < pts.length; i += jump) {
      const [ta, da] = pts[i], [tb, db] = pts[i + W];
      if (tb <= ta) continue;
      const vMeas = (db - da) / ((tb - ta) / 60000);
      let s = 0; for (let j = i; j < i + W; j++) s += pts[j][2];
      const vCh = s / W;
      // the speed channel may be unsigned: compare sizes
      if (Math.abs(vCh) > 5 && vMeas) ratios.push(Math.abs(vCh / vMeas));
    }
    if (ratios.length) {
      ratios.sort((a, b) => a - b);
      const med = ratios[ratios.length >> 1];
      out.push({ name: 'Speed agrees with the depth change', ok: med > 0.9 && med < 1.1, detail: `median ratio ${med.toFixed(3)} over ${ratios.length} windows (1.000 expected)` });
    }
  }
  let round = 0, total = 0;
  for (const c of f.channels) {
    if (c.status === 'setpoint' && CALIBRATED.has(c.type) && c.first !== null) {
      total++;
      const imp = c.first * unitFor(c, 'imperial').k, met = c.first * unitFor(c, 'metric').k;
      if (Math.min(Math.abs(imp - Math.round(imp)), Math.abs(met - Math.round(met))) < 0.02) round++;
    }
  }
  if (total) out.push({ name: 'Alarm set-points are round numbers', ok: round >= Math.max(1, total - 1), detail: `${round} of ${total} read as whole ft, lb or ft/min (or m, kg, m/min)` });
  const unknown = f.channels.filter((c) => !TYPES[c.type]).map((c) => c.name);
  out.push({ name: 'Every channel type is known', ok: !unknown.length, detail: unknown.length ? `unknown: ${unknown.join(', ')}` : `all ${f.channels.length} channels recognised` });
  out.push({ name: 'End of file marker', ok: f.trailer === '0800000000000000' || f.trailer === '', detail: f.trailer ? `last bytes ${f.trailer}` : 'none' });
  return out;
}

/** The recording's start, end and length in words, from its own clock. */
export function tdatSummary(f: Tdat) {
  return {
    start: clockText(f.start, 0).slice(0, 19), end: clockText(f.end, 0).slice(0, 19),
    minutes: (f.end - f.start) / 60, records: f.times.length, periodMs: f.periodMs,
  };
}

// ---------------------------------------------------------------- writing (tests and the demo file)

/** Writes a .da_tdat file (the same layout the reader takes): for tests and the demo recording. */
export function writeTdat(opts: {
  channels: { name: string; type: number; engineering?: boolean }[]; job?: Record<string, string>; start: number; periodMs?: number;
  /** Records in time order: elapsed ms and the stored values that changed, by channel index. */
  records: { t: number; values: Record<number, number> }[];
}): ArrayBuffer {
  const job = Object.entries(opts.job ?? {});
  const header = 0x100 + opts.channels.length * 0x180 + job.length * 0x80 + 4;
  let body = 0;
  for (const r of opts.records) body += 4 * (Object.keys(r.values).length + 2);
  const buf = new ArrayBuffer(header + body + 8);
  const dv = new DataView(buf), u = new Uint8Array(buf);
  const put = (o: number, s: string) => { for (let i = 0; i < s.length; i++) u[o + i] = s.charCodeAt(i) & 0xff; };
  put(0, 'DTS'); put(8, 'da_tdat');
  const end = opts.start + Math.round((opts.records[opts.records.length - 1]?.t ?? 0) / 1000);
  dv.setUint32(0x10, opts.start, true);
  dv.setUint32(0xa8, opts.channels.length, true); dv.setUint32(0xac, job.length, true); dv.setUint32(0xb8, 0, true);
  dv.setUint32(0xbc, opts.start, true); dv.setUint32(0xc0, end, true); dv.setUint32(0xc4, opts.periodMs ?? 100, true);
  let off = 0x100;
  for (const c of opts.channels) { put(off, c.name.slice(0, 31)); u[off + 32] = c.type; u[off + 140] = c.engineering ? 1 : 0; off += 0x180; }
  for (const [k, v] of job) { put(off, k.slice(0, 31)); put(off + 32, v.slice(0, 95)); off += 0x80; }
  dv.setUint32(off, 12, true); off += 4;
  for (const r of opts.records) {
    const idx = Object.keys(r.values).map(Number).sort((a, b) => a - b);
    let mask = 0; for (const i of idx) mask |= 1 << i;
    dv.setUint32(off, mask >>> 0, true); off += 4;
    for (const i of idx) { dv.setInt32(off, Math.round(r.values[i]), true); off += 4; }
    dv.setUint32(off, r.t, true); off += 4;
  }
  dv.setUint32(off, 8, true);
  return buf;
}
