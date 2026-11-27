import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, FileText, Paperclip, Trash2, Upload, X } from 'lucide-react';
import { sizeText } from '../../shared/attachments';
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  CHECK_KEYS, TIME_MODES, UNIT_DEPTH, UNIT_SPEED, UNIT_TENSION, analyse, buildSamples, demoRun, fmt, guessMapping, mappingProblems, num,
  parseTable, parseTime, resolvedTimeMode, verticalSurvey,
  type Analysis, type CheckKey, type Mapping, type RuleKey, type RuleSet, type Sample, type SpeedSign, type Table, type TimeMode,
} from '../../shared/winchData';
import { channelTable, guessChannels, isTdat, parseTdat, tdatChecks, tdatSummary, tdatTable, type Tdat, type Units } from '../../shared/lineminder';
import { detectJarring, heldTimes, parseRestrictions, sopSpeedFindings, sopTensionFindings, splitRuns, steadySamples, type Run } from '../../shared/winchRuns';
import {
  BRAIDED_CHECKS, LINE_LABEL, braidedSop, gapText, joinPlan, lineKind, listedServices, seasonedFromRuns, speedsFor, staticAt, staticTension, wireSop,
  type FileSpan, type JobLimits, type JoinAnswer, type LineKind, type WinchGuide, type WinchLine,
} from '../../shared/winchGuide';
import { demoLineminder, demoLineminderPair } from '../../shared/winchDemo';
import type { Job } from '../../shared/types';
import { api } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Field, Skeleton, cx, inputClass } from '../components/ui';
import { useConfirm } from '../components/Dialog';
import { GuidePanel, RuleFields, useGuide } from './winch/Guide';
import { RunsView, seasonLabel, type ChannelSeries, type Meta, type RunReport, type WinchPayload } from './winch/Report';

// Winch data: plots and guidelines check, on the job's Closure tab (6z.26). Everything runs in the browser; nothing is
// saved to the job yet.
// 6z.41: Lineminder recordings (.da_tdat) are read directly (channels and units from the file), a recording is split
// into runs with a tab each, and the report opens in a window of its own for analysis.
// 6z.42: several files can be joined into one job (a gap of over a day asks whether it is the same job); the line is
// told from the job's wire (slickline wire or braided line); wire runs are checked against the Speed Guidelines for
// their service and the Jarring Guidelines, braided line against the seasoning rules for new or seasoned line, with
// no horizontal-well rules. The guidelines are kept by an admin for everyone.

type Format = 'lineminder' | 'csv';
/** Lineminder choices: units, step, the channels kept and which are depth, tension and speed. */
type LmOpts = { units: Units; step: number; keep: number[]; depth: number; tension: number; speed: number };
/** A winch file: parsed, and its copy in the job's attachments (attId) once uploaded, or why it could not be. */
type WFile = { id: string; name: string; attId?: string; saveError?: string } & ({ kind: 'lineminder'; f: Tdat } | { kind: 'csv'; t: Table });
type JoinAnswers = Record<string, JoinAnswer>;
/** What is kept with the job (6z.43): every choice on the card; the files are referred to by their attachment. */
interface SavedState {
  v: 1; files: { id: string; attId: string; name: string }[]; answers: JoinAnswers; format: Format;
  lm: LmOpts | null; map: Mapping | null; keepCols: number[]; kindPick: LineKind | null; seasonPick: boolean | null; newLine: RuleSet | null;
  limits: { mbs: string; mat: string; spang: boolean }; restr: string; services: string[]; checked: boolean;
}
interface AttRow { id: string; file_name: string; note: string | null; uploaded_at: string; uploaded_by_name: string; category: string; size_bytes: number }
/** Attachments that can be winch data: Lineminder recordings and text or CSV exports (6z.45). */
const WINCH_FILE = /\.(da_tdat|dat|csv|txt|tsv|log|prn)$/i;

/** A file read from its bytes, with no side effects (for restoring). */
function readFile(buf: ArrayBuffer, name: string, id: string, attId?: string): WFile {
  if (isTdat(buf)) return { id, name, attId, kind: 'lineminder', f: parseTdat(buf) };
  return { id, name, attId, kind: 'csv', t: parseTable(new TextDecoder().decode(buf)) };
}

const uniq = (a: number[]) => [...new Set(a.filter((i) => i >= 0))];
const stamp = (t: number) => (Number.isFinite(t) ? new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—');

/** The table and mapping a Lineminder recording gives with these choices. */
function lmTable(f: Tdat, o: LmOpts): { t: Table; m: Mapping; cols: number[] } {
  const chans = uniq([o.depth, o.tension, o.speed, ...o.keep]);
  const t = tdatTable(f, { units: o.units, step: o.step, channels: chans });
  const col = (i: number) => (i < 0 ? -1 : 2 + chans.indexOf(i));
  const metric = o.units === 'metric';
  const m: Mapping = {
    time: 0, depth: col(o.depth), speed: col(o.speed), tension: col(o.tension), date: -1, timeMode: 'datetime',
    depthUnit: metric ? 'm' : 'ft', speedUnit: metric ? 'mpm' : 'fpm', tensionUnit: metric ? 'kgf' : 'lbs', smooth: Math.max(2, Math.round(2.5 / o.step)), minDepth: 0, speedSign: 'abs',
  };
  return { t, m, cols: chans.map((_, k) => 2 + k) };
}

/** Columns of a table as series against time, for the channel plot. */
function channelSeries(t: Table, m: Mapping, cols: number[]): ChannelSeries[] {
  const mode = resolvedTimeMode(t, m);
  const times: number[] = [];
  let last: number | null = null, dayOff = 0;
  for (let i = 0; i < t.data.length; i++) {
    let tt = mode === 'index' || m.time < 0 ? i : parseTime(t.data[i][m.time], mode, m.date >= 0 ? t.data[i][m.date] : null);
    if (mode === 'clock' && last !== null && tt + dayOff < last - 3600) dayOff += 86400;
    tt += mode === 'clock' ? dayOff : 0;
    last = tt;
    times.push(tt);
  }
  return cols.filter((c) => c >= 0 && c < t.header.length && c !== m.time && c !== m.date).map((c) => {
    const h = t.header[c];
    const u = h.match(/\(([^)]+)\)\s*$/);
    return { name: u ? h.slice(0, u.index).trim() : h, unit: u?.[1] ?? '', t: times, v: t.data.map((r) => num(r[c])) };
  });
}

const signature = (w: WFile) => (w.kind === 'lineminder' ? w.f.channels.map((c) => `${c.index}:${c.type}:${c.name}`).join('|') : w.t.header.join('|'));
/** Several tables with the same columns as one, rows in file order (the samples are sorted by time later). */
const joinTables = (ts: Table[]): Table => ({ ...ts[0], data: ts.flatMap((t) => t.data) });

/** What a check needs that is not in the files: the line, the limits for the job and the restrictions. */
interface Setup { kind: LineKind; seasoned: boolean; newLine: RuleSet; limits: JobLimits; restrictions: ReturnType<typeof parseRestrictions> }
/** The joined samples and the runs found in them. */
interface Base { S: Sample[]; runs: Run[]; channels: ChannelSeries[]; fileName: string; source: string; meta: Meta; minDepth: number }

/** One run checked: wire against the service speeds, static tension and jarring; braided line against the seasoning rules. */
function checkRun(base: Base, r: Run, g: WinchGuide, st: Setup, service: string): RunReport {
  const raw = base.S.slice(r.i0, r.i1 + 1);
  const wire = st.kind !== 'braided' ? speedsFor(g.wire, service) : null;
  const sop = wire ? wireSop(g, wire.speeds, st.limits) : braidedSop(g, st.limits);
  // jarring from the tension as recorded; everything else from the samples as the time view reads them (6z.60)
  const jar = detectJarring(raw, sop);
  const Sr = steadySamples(raw, { held: heldTimes(jar) });
  const Sa = Sr.filter((s) => s.depth >= base.minDepth);
  const survey = verticalSurvey(r.maxD);
  const rules = { post: g.braided.seasoned, seasoning: st.newLine };
  const a0 = analyse(Sa.length >= 20 ? Sa : Sr, survey, rules, st.seasoned ? 'post' : 'seasoning');
  if (st.kind === 'braided') {
    const viol = a0.viol.filter((v) => BRAIDED_CHECKS.includes(v.rule));
    const a: Analysis = { ...a0, viol, advice: [], kpi: { ...a0.kpi, nViol: viol.length } };
    return { run: r, a, speed: sopSpeedFindings(Sr, sop, st.restrictions), jar, sop, service: '', group: null, isDefault: false, stat: null };
  }
  const a: Analysis = { ...a0, viol: [], advice: [], ruleCounts: Object.fromEntries(CHECK_KEYS.map((k) => [k, 0])) as Record<CheckKey, number>, kpi: { ...a0.kpi, nViol: 0 } };
  const { group, isDefault } = wire!;
  const stat = staticTension(Sr);
  const speed = [...sopSpeedFindings(Sr, sop, st.restrictions), ...sopTensionFindings(Sr, sop, (d) => staticAt(stat, d))].sort((x, y) => x.t0 - y.t0);
  return { run: r, a, speed, jar, sop, service, group, isDefault, stat };
}

/**
 * Where the winch work lives (6z.47): a job (its attachments, its saved check, its details) or a Utilities project
 * (the project's files and data, details typed in). Both answer the same file and state API shapes.
 */
export interface WinchHost {
  /** For the query keys. */
  key: string;
  /** GET/PUT the saved check: { state, updatedAt, updatedBy, canEdit }. */
  stateUrl: string;
  /** GET the files { files }, POST one (raw, X-File-Name, ?category=&note=), GET <filesUrl>/<id>. */
  filesUrl: string;
  filesKey: unknown[];
  /** The details for the heading: shown from the job, or typed in a project (onMeta set). */
  meta: Meta; onMeta?: (m: Meta) => void;
  /** The job's services, for each run's service. */
  services: string[];
  /** The job's wire from WIREGUARD, when there is a job. */
  lineUrl?: string;
  /** Words: "the job" or "the project". */
  home: 'job' | 'project';
  jobId?: string;
}

/** The winch card on a job's Closure tab: the job is the host. */
export function WinchDataCard({ job }: { job: Job }) {
  const { data: me } = useMe();
  const crewQ = useQuery({ queryKey: ['job-crew', job.id], queryFn: () => api<{ crew: { crew_role: string; full_name: string; end_date: string | null }[] }>(`/jobs/${encodeURIComponent(job.id)}/crew`), staleTime: 5 * 60_000, retry: false });
  // the crew for the printout, as the template lists it: role and name, the current crew only
  const crew = (crewQ.data?.crew ?? []).filter((c) => !c.end_date).map((c) => `${c.crew_role.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase())}: ${c.full_name}`).join('   |   ');
  const meta = useMemo<Meta>(() => ({
    drss: job.drss_no ?? '', field: job.field ?? '', well: job.well ?? '', unit: job.unit_number ?? '',
    cable: job.wire_serial_number ?? '', date: job.start_date?.slice(0, 10) ?? '', by: me?.fullName ?? '', crew,
  }), [job.drss_no, job.field, job.well, job.unit_number, job.wire_serial_number, job.start_date, me?.fullName, crew]);
  const id = encodeURIComponent(job.id);
  const host: WinchHost = {
    key: `job-${job.id}`, stateUrl: `/winch/state/${id}`, filesUrl: `/attachments/job/${id}`, filesKey: ['attachments', 'job', job.id],
    meta, services: (job.services ?? []).filter(Boolean), lineUrl: `/winch/line/${id}`, home: 'job', jobId: job.id,
  };
  return <WinchWorkbench host={host} />;
}

/** The winch check itself, for a job or a Utilities project. */
export function WinchWorkbench({ host }: { host: WinchHost }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const saved = useQuery({ refetchOnMount: 'always', gcTime: 0, queryKey: ['winch-state', host.key], queryFn: () => api<{ state: SavedState | null; updatedAt: string | null; updatedBy: string | null; canEdit: boolean }>(host.stateUrl), staleTime: Infinity, retry: false });
  const atts = useQuery({ queryKey: host.filesKey, queryFn: () => api<{ files: AttRow[] }>(host.filesUrl), retry: false });
  const [restored, setRestored] = useState(false);
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<{ ok: boolean; text: string } | null>(null);
  const pendingRun = useRef(false);
  const guideQ = useGuide();
  const lineQ = useQuery({ queryKey: ['winch-line', host.key], queryFn: () => api<WinchLine>(host.lineUrl!), enabled: !!host.lineUrl, staleTime: 5 * 60_000, retry: false });
  const [format, setFormat] = useState<Format>('lineminder');
  const [files, setFiles] = useState<WFile[]>([]);
  const [answers, setAnswers] = useState<Record<string, JoinAnswer>>({});
  const [map, setMap] = useState<Mapping | null>(null);
  const [keepCols, setKeepCols] = useState<number[]>([]);
  const [lm, setLm] = useState<LmOpts | null>(null);
  const [kindPick, setKindPick] = useState<LineKind | null>(null);
  const [seasonPick, setSeasonPick] = useState<boolean | null>(null);
  const [newLine, setNewLine] = useState<RuleSet | null>(null);
  const [limits, setLimits] = useState<{ mbs: string; mat: string; spang: boolean }>({ mbs: '', mat: '', spang: false });
  const [restr, setRestr] = useState('');
  const meta = host.meta;
  const [base, setBase] = useState<Base | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef<WinchPayload | null>(null);
  const windowPick = useRef(0);

  // the breaking strength comes from the job's wire in WIREGUARD unless typed
  useEffect(() => { const mbl = lineQ.data?.mbl; if (mbl) setLimits((l) => (l.mbs ? l : { ...l, mbs: String(mbl) })); }, [lineQ.data?.mbl]);

  const g = guideQ.data.guide;
  const fileKind = useMemo(() => { const f = files.find((x) => x.kind === 'lineminder'); return f && f.kind === 'lineminder' ? lineKind(null, f.f.job['Wire Type']) : null; }, [files]);
  const detectedKind = lineQ.data?.kind ?? fileKind;
  const kind: LineKind = kindPick ?? detectedKind ?? 'wire';
  const detectedSeason = g ? seasonedFromRuns(lineQ.data?.runs ?? null, g.braided) : null;
  const seasoned = seasonPick ?? detectedSeason ?? false;
  const newLineRules = newLine ?? g?.braided.newLine ?? null;
  const setup: Setup | null = g && newLineRules ? {
    kind, seasoned, newLine: newLineRules, restrictions: parseRestrictions(restr),
    limits: { mbs: Number(limits.mbs) || 0, mat: Number(limits.mat) || 0, spang: limits.spang },
  } : null;

  // the analysis window asks for the report when it opens; only this site's own windows are answered
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'slk-winch-ready' || !latest.current) return;
      (e.source as Window | null)?.postMessage({ type: 'slk-winch', payload: { ...latest.current, pick: windowPick.current } }, window.location.origin);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);



  const addFile = (buf: ArrayBuffer, name: string, list: WFile[]): WFile[] | string => {
    const id = `${name}-${Date.now().toString(36)}-${list.length}-${buf.byteLength}`;
    if (isTdat(buf)) {
      const f = parseTdat(buf);
      if (!lm && !list.some((x) => x.kind === 'lineminder')) {
        const gc = guessChannels(f);
        setLm({ units: 'imperial', step: 0.5, depth: gc.depth, tension: gc.tension, speed: gc.speed, keep: f.channels.filter((c) => c.status === 'series' && [0, 1, 3].includes(c.type)).map((c) => c.index) });
        if (gc.depth < 0 || gc.tension < 0) setProblem('The recording has no depth or no tension channel: pick them below.');
      }
      setFormat('lineminder');
      return [...list, { id, name, kind: 'lineminder', f }];
    }
    if (format === 'lineminder' && /\.da_tdat$|\.dat$/i.test(name) && !/[\t,;]/.test(new TextDecoder().decode(buf.slice(0, 400)))) {
      return `${name} is not a Lineminder recording (it does not start with DTS / da_tdat). If it is a text export, choose CSV.`;
    }
    const t = parseTable(new TextDecoder().decode(buf));
    if (!t.data.length) return `${name} has no rows of numbers.`;
    if (!list.some((x) => x.kind === 'csv')) {
      const gm = guessMapping(t);
      setMap(gm);
      // every numeric column is kept for the channel plot unless the user takes it out
      setKeepCols(t.header.map((_, i) => i).filter((i) => i !== gm.time && i !== gm.date && !Number.isNaN(num(t.data[0]?.[i]))));
    }
    setFormat('csv');
    return [...list, { id, name, kind: 'csv', t }];
  };
  /** Keeps a copy of each new file with the job's attachments, so the check survives a refresh. */
  const upload = (added: WFile[], bufs: Map<string, ArrayBuffer>) => {
    for (const w of added) {
      const buf = bufs.get(w.id);
      if (!buf || w.attId) continue;
      const same = (atts.data?.files ?? []).find((a) => a.file_name === w.name && a.size_bytes === buf.byteLength && (a.note ?? '').startsWith('Winch data file'));
      if (same) { setFiles((l) => l.map((x) => (x.id === w.id ? { ...x, attId: same.id } : x))); continue; }
      api<{ id: string }>(`${host.filesUrl}?category=document&note=${encodeURIComponent('Winch data file')}`, { method: 'POST', headers: { 'X-File-Name': encodeURIComponent(w.name) }, body: buf })
        .then((r) => { setFiles((l) => l.map((x) => (x.id === w.id ? { ...x, attId: r.id, saveError: undefined } : x))); qc.invalidateQueries({ queryKey: host.filesKey }); })
        .catch((e) => setFiles((l) => l.map((x) => (x.id === w.id ? { ...x, saveError: (e as Error).message } : x))));
    }
  };
  const loadFiles = (picked: { buf: ArrayBuffer; name: string }[]) => {
    let list = files;
    const before = new Set(files.map((x) => x.id));
    const bufs = new Map<string, ArrayBuffer>();
    const errs: string[] = [];
    for (const p of picked) {
      try { const r = addFile(p.buf, p.name, list); if (typeof r === 'string') errs.push(r); else { list = r; bufs.set(r[r.length - 1].id, p.buf); } }
      catch (e) { errs.push(`${p.name}: ${(e as Error).message}`); }
    }
    setFiles(list);
    setBase(null);
    setProblem(errs.length ? errs.join(' ') : null);
    upload(list.filter((x) => !before.has(x.id)), bufs);
  };
  const removeFile = (id: string) => {
    const left = files.filter((f) => f.id !== id);
    setFiles(left);
    setBase(null);
    if (!left.some((f) => f.kind === 'lineminder')) setLm(null);
    if (!left.some((f) => f.kind === 'csv')) setMap(null);
  };

  // each file's time span, for ordering and the gap check
  const spans = useMemo<FileSpan[]>(() => files.map((w) => {
    if (w.kind === 'lineminder') {
      const n = w.f.times.length;
      return { id: w.id, name: w.name, format: 'lineminder', signature: signature(w), t0: w.f.start + (n ? w.f.times[0] / 1000 : 0), t1: w.f.start + (n ? w.f.times[n - 1] / 1000 : 0) };
    }
    let t0 = NaN, t1 = NaN;
    if (map && !mappingProblems(w.t, map).length) {
      const S = buildSamples(w.t, map);
      if (S.length) { t0 = S[0].t; t1 = S[S.length - 1].t; }
    }
    return { id: w.id, name: w.name, format: 'csv', signature: signature(w), t0: Number.isFinite(t0) ? t0 : 0, t1: Number.isFinite(t1) ? t1 : 0 };
  }), [files, map]);
  const plan = useMemo(() => joinPlan(spans, answers), [spans, answers]);
  const used = useMemo(() => plan.use.map((id) => files.find((f) => f.id === id)!).filter(Boolean), [plan, files]);

  const built = useMemo(() => {
    if (!used.length || plan.problems.length) return null;
    if (used[0].kind === 'lineminder') {
      if (!lm || lm.depth < 0 || lm.tension < 0) return null;
      const parts = used.map((w) => lmTable((w as Extract<WFile, { kind: 'lineminder' }>).f, lm));
      return { t: joinTables(parts.map((x) => x.t)), m: parts[0].m, cols: parts[0].cols };
    }
    if (!map) return null;
    return { t: joinTables(used.map((w) => (w as Extract<WFile, { kind: 'csv' }>).t)), m: map, cols: keepCols };
  }, [used, plan.problems.length, lm, map, keepCols]);
  const firstTdat = files.find((f) => f.kind === 'lineminder') as Extract<WFile, { kind: 'lineminder' }> | undefined;
  const firstCsv = files.find((f) => f.kind === 'csv') as Extract<WFile, { kind: 'csv' }> | undefined;
  const checks = useMemo(() => (firstTdat ? tdatChecks(firstTdat.f) : []), [firstTdat]);
  const mapProblems = firstCsv && map ? mappingProblems(firstCsv.t, map) : [];

  const run = (restoring = false) => {
    if (!files.length) { setProblem('Add the winch data file first, or try a demo.'); return; }
    if (plan.problems.length) { setProblem(plan.problems.join('. ') + '.'); return; }
    if (plan.ask.length) { setProblem('Say whether each file after a gap of more than a day is the same job.'); return; }
    if (mapProblems.length) { setProblem(mapProblems.join('. ') + '.'); return; }
    if (!built) { setProblem('Pick the depth and tension channels.'); return; }
    if (!g) { setProblem('The guidelines have not loaded yet: try again in a moment.'); return; }
    const S = buildSamples(built.t, { ...built.m, minDepth: 0 });
    if (S.length < 20) { setProblem('Fewer than 20 usable rows: check which column is which.'); return; }
    // the files can hold several runs: each from surface down and back to surface gets its own tab
    let runs: Run[] = splitRuns(S);
    if (!runs.length) runs = [{ n: 1, i0: 0, i1: S.length - 1, t0: S[0].t, t1: S[S.length - 1].t, maxD: Math.max(...S.map((s) => s.depth)), partial: true }];
    const names = used.map((f) => f.name);
    const source = used[0].kind === 'lineminder'
      ? `Lineminder recording${used.length > 1 ? `s (${used.length} joined)` : ''}, read every ${lm!.step} s`
      : `${built.t.delim} separated export${used.length > 1 ? `s (${used.length} joined)` : ''}`;
    setBase({ S, runs, channels: channelSeries(built.t, built.m, built.cols), fileName: names.length > 1 ? `${names[0]} + ${names.length - 1} more` : names[0], source, meta: { ...meta }, minDepth: built.m.minDepth });
    // each run starts with the job's services in order, the last one repeated
    const js = host.services;
    if (!(restoring && services.length === runs.length)) setServices(runs.map((_, i) => js[Math.min(i, js.length - 1)] ?? ''));
    setProblem(null);
  };

  const payload = useMemo<WinchPayload | null>(() => {
    if (!base || !g || !setup) return null;
    const reports = base.runs.map((r, i) => checkRun(base, r, g, setup, services[i] ?? ''));
    return {
      meta, fileName: base.fileName, reports, channels: base.channels, restrictions: setup.restrictions, source: base.source,
      kind: setup.kind, seasoned: setup.seasoned, services: [...new Set([...listedServices(g.wire), ...host.services])], jobId: host.jobId, by: me?.fullName ?? '',
      reportUpload: host.filesUrl, reportsKey: host.filesKey, files: spans.filter((x) => plan.use.includes(x.id)).map((x) => ({ name: x.name, t0: x.t0, t1: x.t1 })),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, g, services, setup?.kind, setup?.seasoned, setup?.newLine, setup?.limits.mbs, setup?.limits.mat, setup?.limits.spang, restr]);
  latest.current = payload;

  // restore what was kept with the job (6z.43): the choices, then each file from the attachments
  useEffect(() => {
    if (restored || saved.isLoading || saved.isFetching || !saved.isFetchedAfterMount) return;
    const st = saved.data?.state;
    if (!st || st.v !== 1) { setRestored(true); return; }
    let gone = false;
    (async () => {
      const list: WFile[] = [];
      const missing: string[] = [];
      for (const x of st.files) {
        try {
          const res = await fetch(`/api${host.filesUrl}/${encodeURIComponent(x.attId)}`, { credentials: 'same-origin' });
          if (!res.ok) throw new Error(String(res.status));
          list.push(readFile(await res.arrayBuffer(), x.name, x.id, x.attId));
        } catch { missing.push(x.name); }
      }
      if (gone) return;
      setFiles(list); setAnswers(st.answers ?? {}); setFormat(st.format ?? 'lineminder'); setLm(st.lm); setMap(st.map); setKeepCols(st.keepCols ?? []);
      setKindPick(st.kindPick); setSeasonPick(st.seasonPick); setNewLine(st.newLine); setLimits(st.limits); setRestr(st.restr ?? '');
      setServices(st.services ?? []);
      setRestoreNote(missing.length ? `Could not open ${missing.join(', ')} from the attachments: add ${missing.length > 1 ? 'them' : 'it'} again.` : null);
      pendingRun.current = !!st.checked && list.length > 0;
      setRestored(true);
    })();
    return () => { gone = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.isLoading, saved.isFetching, saved.isFetchedAfterMount, saved.data, restored]);

  // run the check again once restored, when it had been run
  useEffect(() => {
    if (!restored || !pendingRun.current || !built || !g) return;
    pendingRun.current = false;
    run(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, built, g]);

  // keep every change with the job, a moment after it is made
  const stateJson = useMemo(() => {
    const st: SavedState = {
      v: 1, files: files.filter((x) => x.attId).map((x) => ({ id: x.id, attId: x.attId!, name: x.name })), answers, format, lm, map, keepCols,
      kindPick, seasonPick, newLine, limits, restr, services, checked: !!base,
    };
    return JSON.stringify(st);
  }, [files, answers, format, lm, map, keepCols, kindPick, seasonPick, newLine, limits, restr, services, base]);
  const lastSaved = useRef<string | null>(null);
  useEffect(() => {
    if (!restored) return;
    if (lastSaved.current === null) { lastSaved.current = saved.data?.state ? stateJson : JSON.stringify(null); if (saved.data?.state) return; }
    if (stateJson === lastSaved.current) return;
    if (!saved.data?.state && !files.some((x) => x.attId)) return;
    if (saved.data && !saved.data.canEdit) { setSaveNote({ ok: false, text: `Not kept with the ${host.home}: your role can only view ${host.home}s.` }); return; }
    const t = setTimeout(() => {
      api<{ updatedAt: string }>(host.stateUrl, { method: 'PUT', body: stateJson, headers: { 'Content-Type': 'application/json' } })
        .then((r) => { lastSaved.current = stateJson; qc.setQueryData(['winch-state', host.key], (o: object | undefined) => ({ ...(o ?? {}), state: JSON.parse(stateJson), updatedAt: r.updatedAt })); setSaveNote({ ok: true, text: `Kept with the ${host.home} at ${new Date(r.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` }); })
        .catch((e) => setSaveNote({ ok: false, text: `Not kept with the ${host.home}: ${(e as Error).message}` }));
    }, 800);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateJson, restored]);

  const reports = (atts.data?.files ?? []).filter((a) => (a.note ?? '').startsWith('Winch data analysis'));
  // an admin can delete a saved report (6z.60)
  const admin = me?.role === 'admin';
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteNote, setDeleteNote] = useState<string | null>(null);
  const [ask, confirmDialog] = useConfirm();
  const deleteReport = async (a: AttRow) => {
    if (!(await ask({ title: `Delete the saved report “${a.file_name}”?`, confirm: 'Delete report', danger: true }))) return;
    setDeleting(a.id); setDeleteNote(null);
    try {
      await api(`${host.filesUrl}/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: host.filesKey });
    } catch (e) { setDeleteNote(`Not deleted: ${(e as Error).message}`); }
    setDeleting(null);
  };
  const savedReports = reports.length > 0 && (
    <details className="text-xs">
      <summary className="cursor-pointer font-semibold">Saved reports ({reports.length})</summary>
      <ul className="mt-1 space-y-0.5">
        {reports.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-1">
            <a className="inline-flex min-w-0 items-center gap-1 break-all text-accent-text underline" href={`/api${host.filesUrl}/${a.id}`}><FileText aria-hidden className="size-3 shrink-0" />{a.file_name}</a>
            <span className="text-text-subtle">· {a.uploaded_by_name}</span>
            {admin && <button type="button" onClick={() => deleteReport(a)} disabled={deleting === a.id} aria-label={`Delete the saved report ${a.file_name}`}
              className="ml-1 inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5 text-danger hover:bg-danger-subtle disabled:opacity-50"><Trash2 aria-hidden className="size-3" />{deleting === a.id ? 'Deleting…' : 'Delete'}</button>}
          </li>
        ))}
      </ul>
      {deleteNote && <p role="alert" className="mt-1 text-danger">{deleteNote}</p>}
    </details>
  );
  const status = <p role="status" className={cx('text-xs', saveNote && !saveNote.ok ? 'text-danger' : 'text-text-subtle')}>{saveNote?.text ?? (saved.data?.updatedAt ? `Kept with the ${host.home}, last by ${saved.data.updatedBy ?? 'someone'} on ${new Date(saved.data.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : `Everything here is kept with the ${host.home} as you go.`)}</p>;

  const demoText = () => {
    const d = demoRun();
    setFiles([]); setLm(null); setMap(null); setAnswers({});
    setFormat('csv');
    setTimeout(() => loadFilesFresh([{ buf: new TextEncoder().encode(d.text).buffer as ArrayBuffer, name: d.fileName }]), 0);
    setKindPick('braided');
  };
  /** Adds winch files already in the job's attachments, without uploading them again (6z.45, several at once 6z.46). */
  const addFromAttachments = async (rows: AttRow[]) => {
    setProblem(null);
    let list = files;
    const errs: string[] = [];
    for (const a of rows) {
      try {
        const res = await fetch(`/api${host.filesUrl}/${encodeURIComponent(a.id)}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`could not be opened (${res.status})`);
        const r = addFile(await res.arrayBuffer(), a.file_name, list);
        if (typeof r === 'string') { errs.push(r); continue; }
        const added = r[r.length - 1];
        list = r.map((x) => (x.id === added.id ? { ...x, attId: a.id } : x));
      } catch (e) { errs.push(`${a.file_name} ${(e as Error).message}.`); }
    }
    setFiles(list);
    setBase(null);
    if (errs.length) setProblem(errs.join(' '));
  };
  const loadFilesFresh = (picked: { buf: ArrayBuffer; name: string }[]) => {
    // the demos start from no files
    let list: WFile[] = [];
    const bufs = new Map<string, ArrayBuffer>();
    for (const p of picked) { const r = addFile(p.buf, p.name, list); if (typeof r !== 'string') { list = r; bufs.set(r[r.length - 1].id, p.buf); } }
    // demos are offered only on an empty card, and kept like any other file (6z.45)
    setFiles(list); setBase(null); setProblem(null);
    upload(list, bufs);
  };
  const demoLm = () => { setLm(null); setMap(null); setAnswers({}); setKindPick('wire'); setRestr(''); const d = demoLineminder(); setTimeout(() => loadFilesFresh([{ buf: d.buffer, name: d.fileName }]), 0); };
  const demoPair = () => { setLm(null); setMap(null); setAnswers({}); setKindPick('wire'); setRestr(''); setTimeout(() => loadFilesFresh(demoLineminderPair().map((d) => ({ buf: d.buffer, name: d.fileName }))), 0); };

  const openWindow = (pick: number) => {
    windowPick.current = pick;
    const w = window.open('/winch-window', 'slk-winch-analysis', 'popup,width=1400,height=900');
    if (!w) setProblem('The browser blocked the new window: allow pop-ups for this site and try again.');
  };

  if (payload) {
    return (
      <div className="space-y-3">
        {problem && <Banner tone="danger">{problem}</Banner>}
        {status}
        <RunsView p={payload} onEdit={() => setBase(null)} onWindow={openWindow}
          onSeason={(s) => setSeasonPick(s)} onService={(i, sv) => setServices((a) => a.map((x, k) => (k === i ? sv : x)))} />
        {savedReports}
      </div>
    );
  }

  const line = lineQ.data;
  if (!restored) return <Skeleton className="h-40" />;
  return (
    <div className="space-y-5">
      {confirmDialog}
      {restoreNote && <Banner tone="warning">{restoreNote}</Banner>}
      <div className="flex flex-wrap items-start justify-between gap-2">{status}{savedReports}</div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-text-muted">Add the Lineminder recordings or winch exports for the {host.home}. The app joins them, finds each run, and checks it against the Speed and Jarring Guidelines (slickline wire) or the seasoning rules (braided line).</p>
        {!files.length && <>
          <Button size="sm" variant="ghost" onClick={demoLm}>Demo recording</Button>
          <Button size="sm" variant="ghost" onClick={demoPair}>Demo: two recordings</Button>
          <Button size="sm" variant="ghost" onClick={demoText}>Demo export</Button>
        </>}
      </div>

      <Step n={1} title="Winch data files" note="One or more for the same job">
        <div role="radiogroup" aria-label="File type" className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {([['lineminder', 'Lineminder recording (.da_tdat)'], ['csv', 'CSV or text export (TXT, CSV, TSV, LOG)']] as const).map(([v, l]) => (
            <label key={v} className="flex items-center gap-2"><input type="radio" name="wd-format" checked={format === v} onChange={() => setFormat(v)} />{l}</label>
          ))}
        </div>
        <DropZone id="wd-file" accept={format === 'lineminder' ? '.da_tdat,.dat' : '.txt,.csv,.tsv,.log,.dat,.prn'}
          label={files.length ? 'Add another file' : format === 'lineminder' ? 'Choose the Lineminder recordings' : 'Choose the winch exports'} onFiles={loadFiles}
          status={files.length ? `${files.length} file${files.length > 1 ? 's' : ''}` : 'No file yet'} />
        {(() => {
          const loadedIds = new Set(files.map((x) => x.attId).filter(Boolean));
          const loadedNames = new Set(files.map((x) => x.name));
          // each file once (copies with the same name and size counted), newest first, not loaded yet
          const groups = new Map<string, { row: AttRow; copies: number }>();
          for (const a of atts.data?.files ?? []) {
            if (!WINCH_FILE.test(a.file_name) || loadedIds.has(a.id) || loadedNames.has(a.file_name)) continue;
            const k = `${a.file_name}|${a.size_bytes}`;
            const g = groups.get(k);
            if (g) g.copies++; else groups.set(k, { row: a, copies: 1 });
          }
          const offer = [...groups.values()];
          if (!offer.length) return null;
          return <AttachmentOffer key={offer.map((o) => o.row.id).join()} offer={offer} empty={!files.length} onLoad={addFromAttachments} />;
        })()}
        {files.length > 0 && (
          <ul className="mt-2 divide-y divide-border rounded-md border border-border text-xs" aria-label="Files">
            {[...spans].sort((a, b) => a.t0 - b.t0).map((sp) => {
              const w = files.find((f) => f.id === sp.id)!;
              const ask = plan.ask.find((x) => x.id === sp.id);
              const out = plan.out.includes(sp.id);
              const after = ask ? files.find((f) => f.id === ask.after)?.name : null;
              const gapAns = answers[sp.id];
              return (
                <li key={sp.id} className={cx('px-3 py-2', out && 'opacity-60')}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 font-semibold break-all">{w.name}</span>
                    <span className="text-text-muted">
                      {w.kind === 'lineminder' ? `${tdatSummary(w.f).records.toLocaleString()} records` : `${w.t.data.length.toLocaleString()} rows`} · {stamp(sp.t0)} to {stamp(sp.t1)}
                    </span>
                    {w.attId ? <span className="text-success">In the attachments</span> : w.saveError ? <span className="text-danger">Not saved: {w.saveError}</span> : <span className="text-text-subtle">Saving…</span>}
                    {out && <span className="font-semibold text-warning">Left out: a different job</span>}
                    {gapAns === 'same' && <span className="text-success">Same job, joined</span>}
                    <Button size="sm" variant="ghost" className="ml-auto" aria-label={`Remove ${w.name}`} onClick={() => removeFile(sp.id)}><X aria-hidden className="size-3.5" /></Button>
                  </div>
                  {(ask || gapAns) && (
                    <fieldset className="mt-1.5 rounded-sm bg-warning-subtle/50 px-2 py-1.5">
                      <legend className="sr-only">Same job?</legend>
                      <p className="mb-1">{ask ? `${gapText(ask.gapSec)} after ${after}. Is this the same job?` : 'More than a day after the file before.'}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <label className="flex items-center gap-1.5"><input type="radio" name={`gap-${sp.id}`} checked={gapAns === 'same'} onChange={() => { setAnswers((a) => ({ ...a, [sp.id]: 'same' })); setBase(null); }} />Same job: join it and find the runs across the files</label>
                        <label className="flex items-center gap-1.5"><input type="radio" name={`gap-${sp.id}`} checked={gapAns === 'different'} onChange={() => { setAnswers((a) => ({ ...a, [sp.id]: 'different' })); setBase(null); }} />Different job: leave it out</label>
                      </div>
                    </fieldset>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {plan.problems.length > 0 && <div className="mt-2"><Banner tone="danger">These files cannot be joined: {plan.problems.join('. ')}.</Banner></div>}
        {used.length > 1 && !plan.problems.length && !plan.ask.length && (
          <p className="mt-2 text-xs text-success" role="status">{used.length} files joined: {stamp(spans.find((s) => s.id === plan.use[0])!.t0)} to {stamp(spans.find((s) => s.id === plan.use[plan.use.length - 1])!.t1)}.</p>
        )}
        {firstCsv && (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-text-muted">First lines of {firstCsv.name} ({firstCsv.t.delim} separated, {firstCsv.t.hasHeader ? 'with a header row' : 'no header row: columns are numbered'})</summary>
            <pre className="mt-1 max-h-36 overflow-auto rounded-sm bg-surface-2 p-2 font-mono text-[0.6875rem]">{firstCsv.t.preview}</pre>
          </details>
        )}
      </Step>

      {firstTdat && lm && (
        <Step n={2} title="Channels and units" note="Units come from each channel's type in the file">
          <LineminderForm f={firstTdat.f} o={lm} onChange={(o) => { setLm(o); setBase(null); }} checks={checks} />
        </Step>
      )}
      {firstCsv && map && (
        <Step n={2} title="Columns, units and channels">
          <MappingForm t={firstCsv.t} m={map} onChange={(m) => { setMap(m); setBase(null); }} />
          <p className={cx('mt-2 text-xs', mapProblems.length ? 'text-danger' : 'text-success')} role="status">
            {mapProblems.length ? mapProblems.join('. ') + '.'
              : `Time read as ${TIME_MODES.find((x) => x.value === resolvedTimeMode(firstCsv.t, map))?.label.toLowerCase()}. First row: depth ${firstCsv.t.data[0][map.depth]}, tension ${firstCsv.t.data[0][map.tension]}.`}
          </p>
          <fieldset className="mt-3">
            <legend className="mb-1 text-xs font-semibold text-text-muted">Channels to keep for the channel plot</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {firstCsv.t.header.map((h, i) => (i === map.time || i === map.date ? null : (
                <label key={i} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={keepCols.includes(i)} onChange={(e) => setKeepCols((s) => (e.target.checked ? [...s, i] : s.filter((x) => x !== i)))} />{h}
                </label>
              )))}
            </div>
          </fieldset>
        </Step>
      )}

      <Step n={3} title="Line and job limits">
        <div className="space-y-3">
          <div>
            <div role="radiogroup" aria-label="Line" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {(['wire', 'braided'] as const).map((k) => (
                <label key={k} className="flex items-center gap-2"><input type="radio" name="wd-kind" checked={kind === k} onChange={() => { setKindPick(k); setBase(null); }} />{LINE_LABEL[k]}</label>
              ))}
            </div>
            <p className="mt-1 text-xs text-text-subtle">
              {lineQ.isLoading ? 'Reading the job\'s wire…'
                : line?.serial ? `Job wire ${line.serial}${line.grade ? `, ${line.grade}` : ''}${line.size ? `, ${line.size} in` : ''}: ${line.kind ? `${LINE_LABEL[line.kind].toLowerCase()} (found from the size)` : 'size not known'}.`
                  : fileKind ? `From the recording: ${LINE_LABEL[fileKind].toLowerCase()}.` : 'No wire on the job: pick the line.'}
              {detectedKind && kindPick && kindPick !== detectedKind && ' You picked a different line.'}
            </p>
          </div>
          {kind === 'braided' && g && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <div role="radiogroup" aria-label="Line condition" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="wd-season" checked={!seasoned} onChange={() => setSeasonPick(false)} />{seasonLabel(false)}</label>
                <label className="flex items-center gap-2"><input type="radio" name="wd-season" checked={seasoned} onChange={() => setSeasonPick(true)} />Seasoned line ({g.braided.seasonedRuns} runs or more)</label>
              </div>
              <p className="text-xs text-text-subtle">{line?.runs != null ? `${line.runs} run${line.runs === 1 ? '' : 's'} on this line in WIREGUARD up to the job: ${detectedSeason ? 'seasoned' : 'new line'}.` : 'The run count on this line is not known: pick.'}</p>
              {!seasoned && newLineRules && (
                <details open={!!newLine}>
                  <summary className="cursor-pointer text-sm font-semibold">Speeds for this new line</summary>
                  <p className="mt-1 text-xs text-text-subtle">Start from the guideline values; changes are used for this check only.</p>
                  <RuleFields R={newLineRules} only={['nearSurface', 'maxPooh'] as RuleKey[]} onChange={(key, f, v, tier) => {
                    const next = structuredClone(newLineRules);
                    if (tier) next.nearSurface.tiers[tier[0]][tier[1]] = v; else (next[key] as unknown as Record<string, number>)[f] = v;
                    setNewLine(next);
                  }} />
                  {newLine && <Button size="sm" variant="ghost" onClick={() => setNewLine(null)}>Back to the guideline speeds</Button>}
                </details>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Field id="wd-mbs" label="Wire breaking strength" unit="lbs" hint={line?.mbl ? 'From WIREGUARD' : '0 or empty: not known'}>
              <input id="wd-mbs" className={cx(inputClass, 'pr-12')} type="number" min={0} value={limits.mbs} onChange={(e) => setLimits((l) => ({ ...l, mbs: e.target.value }))} />
            </Field>
            <Field id="wd-mat" label="MAT (if set)" unit="lbs" hint="Wins over the % of the breaking strength">
              <input id="wd-mat" className={cx(inputClass, 'pr-12')} type="number" min={0} value={limits.mat} onChange={(e) => setLimits((l) => ({ ...l, mat: e.target.value }))} />
            </Field>
            <div className="col-span-2 flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={limits.spang} onChange={(e) => setLimits((l) => ({ ...l, spang: e.target.checked }))} />Spang jars in the string</label>
            </div>
          </div>
          <Field id="wd-restr" label="Restrictions" hint="Depth in ft and what it is, e.g. 650 SSSV, 7450 X nipple. Speed is checked 100 ft either side.">
            <input id="wd-restr" className={inputClass} value={restr} onChange={(e) => setRestr(e.target.value)} placeholder="650 SSSV, 7450 X nipple" />
          </Field>
        </div>
      </Step>

      <Step n={4} title={kind === 'wire' ? 'Speed and Jarring Guidelines' : 'Seasoning rules'} note={kind === 'wire' ? 'Each run takes the speeds for its service' : 'New or seasoned line'}>
        <GuidePanel kind={kind} data={guideQ.data} offline={guideQ.offline} />
      </Step>

      {host.onMeta ? (
        <Step n={5} title="Job details" note="For the heading and the printout">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {([['drss', 'DRSS'], ['client', 'Client'], ['field', 'Field'], ['well', 'Well'], ['unit', 'Unit'], ['cable', 'Line'], ['date', 'Job date'], ['by', 'Checked by']] as const).map(([k, l]) => (
              <Field key={k} id={`wd-m-${k}`} label={l}>
                <input id={`wd-m-${k}`} className={inputClass} type={k === 'date' ? 'date' : 'text'} value={meta[k] ?? ''} onChange={(e) => host.onMeta!({ ...meta, [k]: e.target.value })} />
              </Field>
            ))}
            <div className="col-span-2 lg:col-span-4"><Field id="wd-m-crew" label="Crew" hint="e.g. SDM: name | Supervisor: name | Operator: name">
              <input id="wd-m-crew" className={inputClass} value={meta.crew ?? ''} onChange={(e) => host.onMeta!({ ...meta, crew: e.target.value })} />
            </Field></div>
          </div>
        </Step>
      ) : (
      <Step n={5} title="Job details" note="From the job: change them on the job's earlier steps">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {([['drss', 'DRSS'], ['field', 'Field'], ['well', 'Well'], ['unit', 'Unit'], ['cable', 'Line'], ['date', 'Job date'], ['by', 'Checked by']] as const).map(([k, l]) => (
            <div key={k} className="rounded-sm border border-border bg-surface-2 px-3 py-1.5">
              <dt className="font-mono text-label font-semibold tracking-wide text-text-muted uppercase">{l}</dt>
              <dd className={cx('text-sm', !meta[k] && 'text-text-subtle')}>{meta[k] || 'Not on the job'}</dd>
            </div>
          ))}
          <div className="rounded-sm border border-border bg-surface-2 px-3 py-1.5">
            <dt className="font-mono text-label font-semibold tracking-wide text-text-muted uppercase">Runs</dt>
            <dd className={cx("text-sm", !services.length && "text-text-subtle")}>{services.length ? `${services.length} found in the files` : "Found from the files when checked"}</dd>
          </div>
        </dl>
      </Step>
      )}

      {problem && <Banner tone="danger">{problem}</Banner>}
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => run()}>Find the runs and check them</Button>
      </div>
    </div>
  );
}

/**
 * Winch files found in the job's attachments (6z.46). On an empty card it asks whether to load them, every file
 * ticked; once files are loaded it stays as a short list to add more. Each can be ticked or not.
 */
function AttachmentOffer({ offer, empty, onLoad }: { offer: { row: AttRow; copies: number }[]; empty: boolean; onLoad: (rows: AttRow[]) => Promise<void> }) {
  const [pick, setPick] = useState<Set<string>>(() => new Set(empty ? offer.map((o) => o.row.id) : []));
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const ask = empty && !later;
  const chosen = offer.filter((o) => pick.has(o.row.id)).map((o) => o.row);
  const load = async () => { setBusy(true); await onLoad(chosen); setBusy(false); };
  return (
    <div className={cx('mt-2 rounded-md border px-3 py-2 text-xs', ask ? 'border-accent bg-accent/10' : 'border-border')} role={ask ? 'region' : undefined} aria-label="Winch files in the job's attachments">
      <p className="mb-1.5 text-sm font-semibold">{ask
        ? `Winch data found in this job's attachments: ${offer.length} file${offer.length > 1 ? 's' : ''}. Load ${offer.length > 1 ? 'them' : 'it'}?`
        : "Add from the job's attachments"}</p>
      <ul className="space-y-1">
        {offer.map(({ row: a, copies }) => (
          <li key={a.id}>
            <label className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <input type="checkbox" checked={pick.has(a.id)} onChange={(e) => setPick((p) => { const n = new Set(p); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n; })} />
              <span className="min-w-0 font-semibold break-all">{a.file_name}</span>
              <span className="text-text-subtle">{sizeText(a.size_bytes)} · {a.uploaded_by_name} · {new Date(a.uploaded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}{copies > 1 ? ` · ${copies} copies, one is loaded` : ''}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={ask ? 'primary' : 'ghost'} disabled={!chosen.length || busy} onClick={load}>
          <Paperclip aria-hidden className="size-3.5" />{busy ? 'Loading…' : `Load ${chosen.length ? `${chosen.length} ` : ''}selected`}</Button>
        {offer.length > 1 && <Button size="sm" variant="ghost" onClick={() => setPick(new Set(chosen.length === offer.length ? [] : offer.map((o) => o.row.id)))}>{chosen.length === offer.length ? 'Untick all' : 'Tick all'}</Button>}
        {ask && <Button size="sm" variant="ghost" onClick={() => { setLater(true); setPick(new Set()); }}>Not now</Button>}
      </div>
    </div>
  );
}

/** The recording's channels: which to keep, which are depth, tension and speed, the units, the step and the checks. */
function LineminderForm({ f, o, onChange, checks }: { f: Tdat; o: LmOpts; onChange: (o: LmOpts) => void; checks: ReturnType<typeof tdatChecks> }) {
  const rows = channelTable(f, o.units);
  const series = rows.filter((r) => r.status === 'series');
  const setpoints = rows.filter((r) => r.status === 'setpoint' && r.known && r.value !== null && ['force', 'length', 'speed'].includes(r.cls));
  const set = <K extends keyof LmOpts>(k: K, v: LmOpts[K]) => onChange({ ...o, [k]: v });
  const pick = (id: string, label: string, k: 'depth' | 'tension' | 'speed', cls: string) => (
    <Field id={id} label={label}>
      <select id={id} className={inputClass} value={o[k]} onChange={(e) => set(k, Number(e.target.value))}>
        {k === 'speed' && <option value={-1}>None: work it out from the depth</option>}
        {series.map((r) => <option key={r.index} value={r.index}>{r.name} ({r.unit}){r.cls !== cls ? ` · ${r.cls}` : ''}</option>)}
      </select>
    </Field>
  );
  const wrong = [['depth', 'length'], ['tension', 'force'], ['speed', 'speed']].filter(([k, cls]) => o[k as 'depth'] >= 0 && f.channels[o[k as 'depth']]?.type !== { length: 1, force: 0, speed: 3 }[cls]);
  const job = Object.entries(f.job).filter(([, v]) => v);
  return (
    <div className="space-y-3">
      {job.length > 0 && <p className="text-xs text-text-muted">{job.map(([k, v]) => `${k.replace(/[()]/g, '')}: ${v}`).join(' · ')}</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {pick('lm-depth', 'Depth channel', 'depth', 'length')}
        {pick('lm-ten', 'Tension channel', 'tension', 'force')}
        {pick('lm-speed', 'Speed channel', 'speed', 'speed')}
        <Field id="lm-units" label="Units">
          <select id="lm-units" className={inputClass} value={o.units} onChange={(e) => set('units', e.target.value as Units)}>
            <option value="imperial">ft, lb, ft/min</option><option value="metric">m, kg, m/min</option>
          </select>
        </Field>
        <Field id="lm-step" label="Read every" hint="Tension keeps the peak in each step">
          <select id="lm-step" className={inputClass} value={o.step} onChange={(e) => set('step', Number(e.target.value))}>
            {[0.1, 0.2, 0.5, 1, 2].map((s) => <option key={s} value={s}>{s} s</option>)}
          </select>
        </Field>
      </div>
      {wrong.length > 0 && <Banner tone="warning">Check the {wrong.map(([k]) => k).join(' and ')} channel: its type in the file is not {wrong.map(([, c]) => c).join(' / ')}.</Banner>}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[34rem] text-xs">
          <caption className="sr-only">Channels in the recording</caption>
          <thead><tr>{['Keep', 'Channel', 'Kind', 'In the file', 'Shown in', 'Changes'].map((h) => <th key={h} scope="col" className="px-2 py-1.5 text-left font-mono text-label font-semibold tracking-wide text-text-muted uppercase">{h}</th>)}</tr></thead>
          <tbody>{series.map((r) => {
            const required = [o.depth, o.tension, o.speed].includes(r.index);
            return (
              <tr key={r.index} className="border-t border-border">
                <td className="px-2 py-1"><input type="checkbox" aria-label={`Keep ${r.name}`} checked={required || o.keep.includes(r.index)} disabled={required}
                  onChange={(e) => set('keep', e.target.checked ? [...o.keep, r.index] : o.keep.filter((x) => x !== r.index))} /></td>
                <td className="px-2 py-1 font-semibold">{r.name}{required && <span className="ml-1 font-normal text-text-subtle">(used)</span>}</td>
                <td className="px-2 py-1">{r.cls}{!r.known && <span className="ml-1 text-warning">unknown type, kept raw</span>}</td>
                <td className="px-2 py-1 font-mono">{r.stored}</td><td className="px-2 py-1 font-mono">{r.unit}</td><td className="px-2 py-1 font-mono">{r.changes.toLocaleString()}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {setpoints.length > 0 && (
        <p className="text-xs text-text-muted"><span className="font-semibold">Alarm set-points in the file:</span> {setpoints.map((r) => `${r.name} ${fmt(r.value)} ${r.unit}`).join(' · ')}</p>
      )}
      <ul className="grid gap-1 text-xs sm:grid-cols-2" aria-label="Checks on the units">
        {checks.map((c) => (
          <li key={c.name} className="flex items-start gap-1.5">
            {c.ok ? <CircleCheck aria-hidden className="mt-px size-3.5 shrink-0 text-success" /> : <CircleX aria-hidden className="mt-px size-3.5 shrink-0 text-danger" />}
            <span><span className="font-semibold">{c.name}</span> <span className="text-text-muted">{c.detail}</span><span className="sr-only">{c.ok ? ' (passed)' : ' (failed)'}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Step({ n, title, note, children }: { n: number; title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold"><span className="mr-2 font-mono text-text-subtle">{n}</span>{title}{note && <span className="ml-2 text-xs font-normal text-text-subtle">{note}</span>}</h3>
      {children}
    </section>
  );
}

function DropZone({ id, accept, label, status, onFiles }: { id: string; accept: string; label: string; status: string; onFiles: (f: { buf: ArrayBuffer; name: string }[]) => void }) {
  const [over, setOver] = useState(false);
  const take = (list: FileList | null | undefined) => {
    const fs = [...(list ?? [])];
    if (fs.length) Promise.all(fs.map((f) => f.arrayBuffer().then((buf) => ({ buf, name: f.name })))).then(onFiles);
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); };
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
      className={cx('flex flex-wrap items-center gap-3 rounded-md border-2 border-dashed px-3 py-3', over ? 'border-accent bg-accent/10' : 'border-border-strong bg-surface-2')}>
      <label htmlFor={id} className="inline-flex h-(--layout-control-sm) cursor-pointer items-center gap-1.5 rounded-sm border border-border-strong bg-surface px-3 text-sm font-semibold hover:bg-surface-3 focus-within:outline-2 focus-within:outline-focus">
        <Upload aria-hidden className="size-3.5" />{label}
        <input id={id} type="file" multiple accept={accept} className="sr-only" onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
      </label>
      <span className="min-w-0 text-xs break-all text-text-muted">{status} <span className="text-text-subtle">· or drop them here</span></span>
    </div>
  );
}

function ColSelect({ id, label, t, value, onChange, none }: { id: string; label: string; t: Table; value: number; onChange: (v: number) => void; none?: boolean }) {
  return (
    <Field id={id} label={label}>
      <select id={id} className={inputClass} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {none && <option value={-1}>None</option>}
        {t.header.map((h, i) => <option key={i} value={i}>{i + 1}: {h}</option>)}
      </select>
    </Field>
  );
}

function Pick<T extends string>({ id, label, value, options, onChange }: { id: string; label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <Field id={id} label={label}>
      <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}
const opts = <T extends string>(o: Record<T, unknown>, labels?: Partial<Record<T, string>>) => (Object.keys(o) as T[]).map((v) => ({ value: v, label: labels?.[v] ?? v }));

function MappingForm({ t, m, onChange }: { t: Table; m: Mapping; onChange: (m: Mapping) => void }) {
  const set = <K extends keyof Mapping>(k: K, v: Mapping[K]) => onChange({ ...m, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <ColSelect id="wd-c-time" label="Time column" t={t} value={m.time} none onChange={(v) => set('time', v)} />
      <ColSelect id="wd-c-depth" label="Depth column" t={t} value={m.depth} onChange={(v) => set('depth', v)} />
      <ColSelect id="wd-c-speed" label="Line speed column" t={t} value={m.speed} none onChange={(v) => set('speed', v)} />
      <ColSelect id="wd-c-ten" label="Tension column" t={t} value={m.tension} onChange={(v) => set('tension', v)} />
      <Pick<TimeMode> id="wd-tmode" label="Time format" value={m.timeMode} options={TIME_MODES} onChange={(v) => set('timeMode', v)} />
      <Pick id="wd-u-depth" label="Depth unit" value={m.depthUnit} options={opts(UNIT_DEPTH)} onChange={(v) => set('depthUnit', v)} />
      <Pick id="wd-u-speed" label="Speed unit" value={m.speedUnit} options={opts(UNIT_SPEED, { fpm: 'ft/min', mpm: 'm/min', fps: 'ft/s', mps: 'm/s' })} onChange={(v) => set('speedUnit', v)} />
      <Pick id="wd-u-ten" label="Tension unit" value={m.tensionUnit} options={opts(UNIT_TENSION)} onChange={(v) => set('tensionUnit', v)} />
      <ColSelect id="wd-c-date" label="Date column (if apart)" t={t} value={m.date} none onChange={(v) => set('date', v)} />
      <Pick<SpeedSign> id="wd-sign" label="Speed sign" value={m.speedSign}
        options={[{ value: 'abs', label: 'Use the absolute value' }, { value: 'signed', label: '+ RIH / − POOH' }, { value: 'signedInv', label: '− RIH / + POOH' }]} onChange={(v) => set('speedSign', v)} />
      <Field id="wd-smooth" label="Smoothing (rows)" hint="For telling RIH from POOH">
        <input id="wd-smooth" className={inputClass} type="number" min={1} max={60} value={m.smooth} onChange={(e) => set('smooth', Number(e.target.value) || 1)} />
      </Field>
      <Field id="wd-mind" label="Skip rows shallower than" unit="ft">
        <input id="wd-mind" className={cx(inputClass, 'pr-10')} type="number" min={0} value={m.minDepth} onChange={(e) => set('minDepth', Number(e.target.value) || 0)} />
      </Field>
    </div>
  );
}

export default WinchDataCard;
