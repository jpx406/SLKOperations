import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleX, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  CHECK_KEYS, TIME_MODES, UNIT_DEPTH, UNIT_SPEED, UNIT_TENSION, analyse, buildSamples, demoRun, fmt, guessMapping, mappingProblems, num,
  parseTable, parseTime, resolvedTimeMode, verticalSurvey,
  type Analysis, type CheckKey, type Mapping, type RuleKey, type RuleSet, type Sample, type SpeedSign, type Table, type TimeMode,
} from '../../shared/winchData';
import { channelTable, guessChannels, isTdat, parseTdat, tdatChecks, tdatSummary, tdatTable, type Tdat, type Units } from '../../shared/lineminder';
import { detectJarring, parseRestrictions, sopSpeedFindings, sopTensionFindings, splitRuns, type Run } from '../../shared/winchRuns';
import {
  BRAIDED_CHECKS, LINE_LABEL, braidedSop, gapText, joinPlan, lineKind, listedServices, seasonedFromRuns, speedsFor, staticAt, staticTension, wireSop,
  type FileSpan, type JobLimits, type JoinAnswer, type LineKind, type WinchGuide, type WinchLine,
} from '../../shared/winchGuide';
import { demoLineminder, demoLineminderPair } from '../../shared/winchDemo';
import type { Job } from '../../shared/types';
import { api } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Field, Skeleton, cx, inputClass } from '../components/ui';
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
type WFile = { id: string; name: string } & ({ kind: 'lineminder'; f: Tdat } | { kind: 'csv'; t: Table });

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
  const Sr = base.S.slice(r.i0, r.i1 + 1);
  const Sa = Sr.filter((s) => s.depth >= base.minDepth);
  const survey = verticalSurvey(r.maxD);
  const rules = { post: g.braided.seasoned, seasoning: st.newLine };
  const a0 = analyse(Sa.length >= 20 ? Sa : Sr, survey, rules, st.seasoned ? 'post' : 'seasoning');
  if (st.kind === 'braided') {
    const viol = a0.viol.filter((v) => BRAIDED_CHECKS.includes(v.rule));
    const a: Analysis = { ...a0, viol, advice: [], kpi: { ...a0.kpi, nViol: viol.length } };
    const sop = braidedSop(g, st.limits);
    return { run: r, a, speed: sopSpeedFindings(Sr, sop, st.restrictions), jar: detectJarring(Sr, sop), sop, service: '', group: null, isDefault: false, stat: null };
  }
  const a: Analysis = { ...a0, viol: [], advice: [], ruleCounts: Object.fromEntries(CHECK_KEYS.map((k) => [k, 0])) as Record<CheckKey, number>, kpi: { ...a0.kpi, nViol: 0 } };
  const { speeds, group, isDefault } = speedsFor(g.wire, service);
  const sop = wireSop(g, speeds, st.limits);
  const stat = staticTension(Sr);
  const speed = [...sopSpeedFindings(Sr, sop, st.restrictions), ...sopTensionFindings(Sr, sop, (d) => staticAt(stat, d))].sort((x, y) => x.t0 - y.t0);
  return { run: r, a, speed, jar: detectJarring(Sr, sop), sop, service, group, isDefault, stat };
}

export function WinchDataCard({ job }: { job: Job }) {
  const { data: me } = useMe();
  const guideQ = useGuide();
  const lineQ = useQuery({ queryKey: ['winch-line', job.id], queryFn: () => api<WinchLine>(`/winch/line/${encodeURIComponent(job.id)}`), staleTime: 5 * 60_000, retry: false });
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
  const [meta, setMeta] = useState<Meta>({
    job: job.ticket_no ?? job.location ?? '', well: job.well ?? '', stage: '', unit: job.unit_number ?? '',
    cable: job.wire_serial_number ?? '', date: job.start_date?.slice(0, 10) ?? '', by: me?.fullName ?? '',
  });
  const [base, setBase] = useState<Base | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef<WinchPayload | null>(null);
  const windowPick = useRef(0);

  useEffect(() => { if (me?.fullName) setMeta((m) => (m.by ? m : { ...m, by: me.fullName })); }, [me?.fullName]);
  // the breaking strength comes from the job's wire in WIREGUARD unless typed
  useEffect(() => { const mbl = lineQ.data?.mbl; if (mbl) setLimits((l) => (l.mbs ? l : { ...l, mbs: String(mbl) })); }, [lineQ.data?.mbl]);

  const g = guideQ.data?.guide ?? null;
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

  const guessMeta = (fileName: string) => setMeta((m) => {
    // the file name often carries the well and stage, e.g. ...W12_STG-28.txt
    const w = fileName.match(/W(\d{2})/i), st = fileName.match(/STG[-_ ]?(\d+)(?!.*STG)/i);
    return { ...m, well: m.well || (w?.[1] ?? ''), stage: m.stage || (st?.[1] ?? '') };
  });

  const addFile = (buf: ArrayBuffer, name: string, list: WFile[]): WFile[] | string => {
    const id = `${name}-${list.length}-${buf.byteLength}`;
    if (isTdat(buf)) {
      const f = parseTdat(buf);
      if (!lm && !list.some((x) => x.kind === 'lineminder')) {
        const gc = guessChannels(f);
        setLm({ units: 'imperial', step: 0.5, depth: gc.depth, tension: gc.tension, speed: gc.speed, keep: f.channels.filter((c) => c.status === 'series' && [0, 1, 3].includes(c.type)).map((c) => c.index) });
        if (gc.depth < 0 || gc.tension < 0) setProblem('The recording has no depth or no tension channel: pick them below.');
      }
      const order = f.job['(Job) Order'];
      setMeta((m) => ({ ...m, job: m.job || order || '', cable: m.cable || f.job['Wire Type'] || '' }));
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
  const loadFiles = (picked: { buf: ArrayBuffer; name: string }[]) => {
    let list = files;
    const errs: string[] = [];
    for (const p of picked) {
      try { const r = addFile(p.buf, p.name, list); if (typeof r === 'string') errs.push(r); else { list = r; guessMeta(p.name); } }
      catch (e) { errs.push(`${p.name}: ${(e as Error).message}`); }
    }
    setFiles(list);
    setBase(null);
    setProblem(errs.length ? errs.join(' ') : null);
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

  const run = () => {
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
    const js = (job.services ?? []).filter(Boolean);
    setServices(runs.map((_, i) => js[Math.min(i, js.length - 1)] ?? ''));
    setProblem(null);
  };

  const payload = useMemo<WinchPayload | null>(() => {
    if (!base || !g || !setup) return null;
    const reports = base.runs.map((r, i) => checkRun(base, r, g, setup, services[i] ?? ''));
    return {
      meta: base.meta, fileName: base.fileName, reports, channels: base.channels, restrictions: setup.restrictions, source: base.source,
      kind: setup.kind, seasoned: setup.seasoned, services: [...new Set([...listedServices(g.wire), ...(job.services ?? [])])],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, g, services, setup?.kind, setup?.seasoned, setup?.newLine, setup?.limits.mbs, setup?.limits.mat, setup?.limits.spang, restr]);
  latest.current = payload;

  const demoText = () => {
    const d = demoRun();
    setFiles([]); setLm(null); setMap(null); setAnswers({});
    setFormat('csv');
    setTimeout(() => loadFilesFresh([{ buf: new TextEncoder().encode(d.text).buffer as ArrayBuffer, name: d.fileName }]), 0);
    setKindPick('braided');
  };
  const loadFilesFresh = (picked: { buf: ArrayBuffer; name: string }[]) => {
    // the demos start from no files
    let list: WFile[] = [];
    for (const p of picked) { const r = addFile(p.buf, p.name, list); if (typeof r !== 'string') list = r; guessMeta(p.name); }
    setFiles(list); setBase(null); setProblem(null);
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
        <RunsView p={payload} onEdit={() => setBase(null)} onWindow={openWindow}
          onSeason={(s) => setSeasonPick(s)} onService={(i, sv) => setServices((a) => a.map((x, k) => (k === i ? sv : x)))} />
      </div>
    );
  }

  const line = lineQ.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-text-muted">Add the Lineminder recordings or winch exports for the job. The app joins them, finds each run, and checks it against the Speed and Jarring Guidelines (slickline wire) or the seasoning rules (braided line).</p>
        <Button size="sm" variant="ghost" onClick={demoLm}>Demo recording</Button>
        <Button size="sm" variant="ghost" onClick={demoPair}>Demo: two recordings</Button>
        <Button size="sm" variant="ghost" onClick={demoText}>Demo export</Button>
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
        {guideQ.data ? <GuidePanel kind={kind} data={guideQ.data} /> : guideQ.isError ? <Banner tone="danger">The guidelines could not be read.</Banner> : <Skeleton className="h-32" />}
      </Step>

      <Step n={5} title="Run details" note="For the heading and the printout only">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {([['job', 'Job or pad'], ['well', 'Well'], ['stage', 'Stage'], ['unit', 'Unit'], ['cable', 'Line'], ['date', 'Run date'], ['by', 'Checked by']] as const).map(([k, l]) => (
            <Field key={k} id={`wd-${k}`} label={l}>
              <input id={`wd-${k}`} className={inputClass} type={k === 'date' ? 'date' : 'text'} value={meta[k]} onChange={(e) => setMeta((m) => ({ ...m, [k]: e.target.value }))} />
            </Field>
          ))}
        </div>
      </Step>

      {problem && <Banner tone="danger">{problem}</Banner>}
      <div className="flex justify-end">
        <Button variant="primary" onClick={run}>Find the runs and check them</Button>
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
