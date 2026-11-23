// The Job log · Sequence of Events form (6z.51), ported from the owner's WL Operations Hub job log package and
// adjusted for slickline: each row also has the run and the depth, the sign-off is the slickline supervisor or
// operator and the client representative. One form per job, saved with every version kept; two people saving at
// once are merged (rows by id, header fields "mine if I changed them, else theirs"). Pure functions: the editor,
// the Worker and the tests share them.

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const uid = () => ((globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

/** Today in Riyadh as YYYY-MM-DD. */
export const todayISO = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

export const dayOf = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  return DAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
};
/** "2026-11-22" → "22-Nov-26". */
export const dateShort = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}-${MONTHS[+m[2] - 1]}-${m[1].slice(2)}` : String(iso || '');
};
export const timeHM = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? `${String(+m[1]).padStart(2, '0')}:${m[2]}` : String(t || '').trim();
};
export const num = (v: unknown) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

/** One row of the sequence of events. Run and depth are the slickline additions. */
export interface LogRow { id: string; date: string; time: string; run: string; depth: string; desc: string; remark: string }
/** A signature: drawn (a PNG data URL) or typed, with who put it there and when. */
export interface Sig { img: string | null; text: string | null; by: string; at: string }
export const hasSig = (s: Sig | null | undefined) => !!(s && (s.img || s.text));

export interface LogForm {
  ticket: string; well: string; customer: string; jobType: string; rig: string; date: string;
  rows: LogRow[];
  /** "" = worked out from the first to the last event. */
  dayHrs: string; nightHrs: string;
  /** Slickline supervisor and operators (several), their I.D. and signature. */
  engNames: string[]; engId: string; engSig: Sig | null;
  /** Client representative (company man). */
  fmName: string; fmId: string; fmDate: string; fmSig: Sig | null;
}

export const newRow = (o: Partial<LogRow> = {}): LogRow => ({ id: uid(), date: '', time: '', run: '', depth: '', desc: '', remark: '', ...o });

/** What the job gives the header. */
export interface JobForLog { ticket?: string | null; well?: string | null; customer?: string | null; jobType?: string | null; rig?: string | null; startDate?: string | null; engineers?: string[] }

export const newForm = (job: JobForLog = {}, o: Partial<LogForm> = {}): LogForm => {
  const date = job.startDate?.slice(0, 10) || todayISO();
  return {
    ticket: job.ticket ?? '', well: job.well ?? '', customer: job.customer ?? '', jobType: job.jobType ?? '', rig: job.rig ?? '', date,
    rows: [newRow({ date })], dayHrs: '', nightHrs: '',
    engNames: job.engineers?.slice() ?? [], engId: '', engSig: null, fmName: '', fmId: '', fmDate: '', fmSig: null, ...o,
  };
};

export const HEADER_LABELS: Record<string, string> = {
  ticket: 'Ticket', well: 'Well', customer: 'Client', jobType: 'Services', rig: 'Rig/Site', date: 'Date', dayHrs: 'Day hours', nightHrs: 'Night hours',
  engNames: 'Slickline crew', engId: 'Crew I.D.', fmName: 'Client rep.', fmId: 'Client rep. I.D.', fmDate: 'Client rep. date',
};

/** A row with nothing in it: not an event, left out of the exports. */
export const isEmptyRow = (r: LogRow | undefined) => !r || !(r.desc.trim() || r.remark.trim() || r.time.trim());
export const eventCount = (f: LogForm) => f.rows.filter((r) => !isEmptyRow(r)).length;

export const sortRows = (rows: LogRow[]) => rows.slice().sort((a, b) => {
  if (isEmptyRow(a) !== isEmptyRow(b)) return isEmptyRow(a) ? 1 : -1;
  return `${a.date || '9999'} ${timeHM(a.time) || '00:00'}`.localeCompare(`${b.date || '9999'} ${timeHM(b.time) || '00:00'}`);
});

/** Minutes since 1970 for a row's local date and time (both Riyadh wall time). */
const rowMinutes = (r: LogRow) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date), t = /^(\d{2}):(\d{2})$/.exec(timeHM(r.time));
  return m && t ? Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]) / 60_000 : null;
};

/**
 * Crew hours worked out: from the first to the last logged event, split into Day (06:00–18:00) and Night
 * (18:00–06:00), to the half hour. A typed number wins; clearing it goes back to the worked-out one.
 */
export function autoHours(f: LogForm): { day: number | null; night: number | null; total: number | null } {
  const pts = f.rows.filter((r) => !isEmptyRow(r)).map(rowMinutes).filter((x): x is number => x != null).sort((a, b) => a - b);
  if (pts.length < 2) return { day: null, night: null, total: null };
  let day = 0, night = 0;
  for (let t = pts[0]; t < pts[pts.length - 1]; t++) {
    const h = Math.floor((t % 1440) / 60);
    if (h >= 6 && h < 18) day++; else night++;
  }
  const r = (mins: number) => Math.round((mins / 60) * 2) / 2;
  return { day: r(day), night: r(night), total: r(day + night) };
}
export function hours(f: LogForm) {
  const a = autoHours(f);
  const day = num(f.dayHrs) ?? a.day, night = num(f.nightHrs) ?? a.night;
  return { day, night, total: day == null && night == null ? null : (day ?? 0) + (night ?? 0), autoDay: num(f.dayHrs) == null, autoNight: num(f.nightHrs) == null };
}

const rowKey = (r: LogRow) => `${r.date}|${timeHM(r.time)}|${r.run}|${r.depth}|${r.desc.trim()}|${r.remark.trim()}`;
const SCALARS = ['ticket', 'well', 'customer', 'jobType', 'rig', 'date', 'dayHrs', 'nightHrs', 'engId', 'fmName', 'fmId', 'fmDate'] as const;

/** "What changed" for the version history. */
export function changeSummary(prev: LogForm | null, next: LogForm): string {
  if (!prev) return 'Initial version';
  const out: string[] = [];
  const hdr = SCALARS.filter((k) => String(prev[k] ?? '') !== String(next[k] ?? '')).map((k) => HEADER_LABELS[k]);
  if (prev.engNames.join('|') !== next.engNames.join('|')) hdr.push(HEADER_LABELS.engNames);
  if (hdr.length) out.push(`${hdr.join(', ')} changed`);
  const pm = new Map(prev.rows.filter((r) => !isEmptyRow(r)).map((r) => [r.id, r]));
  const nm = new Map(next.rows.filter((r) => !isEmptyRow(r)).map((r) => [r.id, r]));
  let added = 0, removed = 0, edited = 0;
  for (const [id, r] of nm) { const p = pm.get(id); if (!p) added++; else if (rowKey(p) !== rowKey(r)) edited++; }
  for (const id of pm.keys()) if (!nm.has(id)) removed++;
  if (added) out.push(`+${added} row${added > 1 ? 's' : ''}`);
  if (removed) out.push(`−${removed} row${removed > 1 ? 's' : ''}`);
  if (edited) out.push(`${edited} row${edited > 1 ? 's' : ''} edited`);
  const sig = (a: Sig | null, b: Sig | null, who: string) => {
    if (hasSig(a) !== hasSig(b)) out.push(hasSig(b) ? `${who} signed` : `${who} signature cleared`);
    else if (hasSig(b) && JSON.stringify(a) !== JSON.stringify(b)) out.push(`${who} re-signed`);
  };
  sig(prev.engSig, next.engSig, 'crew');
  sig(prev.fmSig, next.fmSig, 'client rep.');
  return out.length ? out.join(' · ') : 'No content change';
}

/** Three-way merge: base = last synced, mine = my edits, theirs = what someone saved meanwhile. */
export function mergeForms(base: LogForm | null, mine: LogForm, theirs: LogForm): LogForm {
  const b = base ?? newForm();
  const out: LogForm = { ...theirs };
  for (const k of [...SCALARS, 'engSig', 'fmSig'] as const) {
    const iChanged = JSON.stringify(b[k] ?? null) !== JSON.stringify(mine[k] ?? null);
    (out as unknown as Record<string, unknown>)[k] = iChanged ? mine[k] : theirs[k];
  }
  if (b.engNames.join('|') !== mine.engNames.join('|')) out.engNames = mine.engNames;
  const bm = new Map(b.rows.map((r) => [r.id, r])), tm = new Map(theirs.rows.map((r) => [r.id, r])), mm = new Map(mine.rows.map((r) => [r.id, r]));
  const rows: LogRow[] = [];
  for (const id of new Set([...theirs.rows.map((r) => r.id), ...mine.rows.map((r) => r.id)])) {
    const br = bm.get(id), t = tm.get(id), m = mm.get(id);
    const iChanged = !!m && (!br || rowKey(br) !== rowKey(m)), theyChanged = !!t && (!br || rowKey(br) !== rowKey(t));
    if (br && !m && !theyChanged) continue;   // I deleted it, they left it alone
    if (br && !t && !iChanged) continue;      // they deleted it, I left it alone
    rows.push(iChanged ? m! : (t ?? m!));
  }
  out.rows = sortRows(rows.length ? rows : [newRow()]);
  return out;
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const sigOf = (v: unknown): Sig | null => {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  const img = typeof s.img === 'string' && s.img.startsWith('data:image/') ? s.img : null;
  const text = typeof s.text === 'string' && s.text.trim() ? s.text.trim().slice(0, 120) : null;
  return img || text ? { img, text, by: str(s.by).slice(0, 120), at: str(s.at).slice(0, 40) } : null;
};

/** Anything read back from the server, the device or a version, made into a whole form. */
export function coerceForm(f: unknown, job?: JobForLog): LogForm {
  const base = newForm(job);
  const x = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
  const out = { ...base } as LogForm;
  for (const k of SCALARS) if (x[k] !== undefined) (out as unknown as Record<string, string>)[k] = str(x[k]).slice(0, 400);
  out.rows = Array.isArray(x.rows) && x.rows.length
    ? x.rows.slice(0, 2000).map((r) => { const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>; return newRow({ id: str(o.id) || uid(), date: str(o.date).slice(0, 10), time: str(o.time).slice(0, 8), run: str(o.run).slice(0, 6), depth: str(o.depth).slice(0, 12), desc: str(o.desc).slice(0, 4000), remark: str(o.remark).slice(0, 2000) }); })
    : [newRow({ date: out.date })];
  out.engNames = Array.isArray(x.engNames) ? x.engNames.map(str).filter(Boolean).slice(0, 20) : x.engNames ? str(x.engNames).split(/\s*[,/]\s*/).filter(Boolean) : base.engNames;
  out.engSig = sigOf(x.engSig);
  out.fmSig = sigOf(x.fmSig);
  return out;
}

/** Rows ready for the exports: in order, numbered, empty ones left out, the day filled in. */
export const exportRows = (f: LogForm) => sortRows(f.rows.filter((r) => !isEmptyRow(r))).map((r, i) => ({
  n: i + 1, date: dateShort(r.date), time: timeHM(r.time), day: dayOf(r.date), run: r.run, depth: num(r.depth) != null ? num(r.depth)!.toLocaleString('en-US') : '', desc: r.desc, remark: r.remark,
}));

/** The rows as events with a time (Riyadh wall time, +03:00), for what Execution reads from the log. */
export function rowsAsEvents(f: LogForm): { id: string; occurred_at: string; run_no: number | null; depth_ft: number | null; text: string }[] {
  return sortRows(f.rows.filter((r) => !isEmptyRow(r) && r.date)).map((r) => ({
    id: r.id, occurred_at: new Date(`${r.date}T${timeHM(r.time) || '00:00'}:00+03:00`).toISOString(),
    run_no: num(r.run) != null && Number.isInteger(num(r.run)) ? num(r.run) : null, depth_ft: num(r.depth),
    text: [r.desc.trim(), r.remark.trim()].filter(Boolean).join(' — '),
  }));
}
