import { useQuery } from '@tanstack/react-query';
import { BookOpen, CircleCheck, CircleX, FileDown, FileUp, RotateCcw, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  RULE_DEFAULTS, RULE_FIELDS, RULE_SET_LABEL, TIME_MODES, UNIT_DEPTH, UNIT_SPEED, UNIT_TENSION,
  analyse, buildSamples, checkRules, demoRun, fileSurvey, fmt, guessMapping, guessSurveyMapping,
  manualSurvey, mappingProblems, num, parseTable, parseTime, resolvedTimeMode, ruleText, verticalSurvey,
  type Mapping, type RuleKey, type RuleSetKey, type Rules, type SpeedSign, type SurveyMapping, type Table, type TimeMode,
} from '../../shared/winchData';
import { channelTable, guessChannels, isTdat, parseTdat, tdatChecks, tdatSummary, tdatTable, type Tdat, type Units } from '../../shared/lineminder';
import { SOP_DEFAULTS, checkSopRules, detectJarring, parseRestrictions, sopSpeedFindings, splitRuns, type Run, type SopRules } from '../../shared/winchRuns';
import { demoLineminder } from '../../shared/winchDemo';
import type { KnowledgeDoc } from '../../shared/knowledge';
import type { Job } from '../../shared/types';
import { api } from '../api';
import { useMe } from '../auth';
import { saveFile } from '../components/charts';
import { Banner, Button, Field, cx, inputClass, inputSized } from '../components/ui';
import { fileUrl } from './knowledge/common';
import { RunsView, type ChannelSeries, type Meta, type RunReport, type WinchPayload } from './winch/Report';

// Winch data: plots and guidelines check, on the job's Closure tab (6z.26). Everything runs in the browser; nothing is
// saved to the job yet. The rule limits are kept on this device.
// 6z.41: Lineminder recordings (.da_tdat) are read directly (channels and units from the file), a recording is split
// into runs with a tab each, every run is checked against SOP-04 speed and jarring rules, and the report opens in a
// window of its own for analysis.

const RULES_KEY = 'slk-winch-rules';
const SOP_KEY = 'slk-winch-sop';
const loadRules = (): Rules => {
  try { const r = checkRules(JSON.parse(localStorage.getItem(RULES_KEY) ?? 'null')); if (r) return r; } catch { /* not saved yet */ }
  return structuredClone(RULE_DEFAULTS);
};
const storeRules = (r: Rules) => { try { localStorage.setItem(RULES_KEY, JSON.stringify(r)); } catch { /* private mode: kept for this visit */ } };
const loadSop = (): SopRules => {
  try { const r = checkSopRules(JSON.parse(localStorage.getItem(SOP_KEY) ?? 'null')); if (r) return r; } catch { /* not saved yet */ }
  return structuredClone(SOP_DEFAULTS);
};
const storeSop = (r: SopRules) => { try { localStorage.setItem(SOP_KEY, JSON.stringify(r)); } catch { /* private mode */ } };

type Format = 'lineminder' | 'csv';
type SurveyMode = 'vertical' | 'manual' | 'file';
/** Lineminder choices: units, step, the channels kept and which are depth, tension and speed. */
type LmOpts = { units: Units; step: number; keep: number[]; depth: number; tension: number; speed: number };

const small = 'h-(--layout-control-sm) text-sm';
const uniq = (a: number[]) => [...new Set(a.filter((i) => i >= 0))];

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

export function WinchDataCard({ job }: { job: Job }) {
  const { data: me } = useMe();
  const [format, setFormat] = useState<Format>('lineminder');
  const [wd, setWd] = useState<(Table & { fileName: string }) | null>(null);
  const [map, setMap] = useState<Mapping | null>(null);
  const [keepCols, setKeepCols] = useState<number[]>([]);
  const [tdat, setTdat] = useState<{ f: Tdat; fileName: string } | null>(null);
  const [lm, setLm] = useState<LmOpts | null>(null);
  const [svMode, setSvMode] = useState<SurveyMode>('vertical');
  const [depths, setDepths] = useState({ kop: '', p30: '', lat: '', td: job.target_depth_ft ? String(job.target_depth_ft) : '' });
  const [sv, setSv] = useState<(Table & { fileName: string }) | null>(null);
  const [svMap, setSvMap] = useState<SurveyMapping | null>(null);
  const [rules, setRules] = useState<Rules>(loadRules);
  const [set, setSet] = useState<RuleSetKey>('post');
  const [sop, setSop] = useState<SopRules>(loadSop);
  const [restr, setRestr] = useState('');
  const [meta, setMeta] = useState<Meta>({
    job: job.ticket_no ?? job.location ?? '', well: job.well ?? '', stage: '', unit: job.unit_number ?? '',
    cable: job.wire_serial_number ?? '', date: job.start_date?.slice(0, 10) ?? '', by: me?.fullName ?? '',
  });
  const [payload, setPayload] = useState<WinchPayload | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef<WinchPayload | null>(null);
  latest.current = payload;

  useEffect(() => { if (me?.fullName) setMeta((m) => (m.by ? m : { ...m, by: me.fullName })); }, [me?.fullName]);

  // the analysis window asks for the report when it opens; only this site's own windows are answered
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'slk-winch-ready' || !latest.current) return;
      (e.source as Window | null)?.postMessage({ type: 'slk-winch', payload: latest.current }, window.location.origin);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const guessMeta = (fileName: string) => setMeta((m) => {
    // the file name often carries the well and stage, e.g. ...W12_STG-28.txt
    const w = fileName.match(/W(\d{2})/i), st = fileName.match(/STG[-_ ]?(\d+)(?!.*STG)/i);
    return { ...m, well: m.well || (w?.[1] ?? ''), stage: m.stage || (st?.[1] ?? '') };
  });

  const loadText = (text: string, fileName: string) => {
    const t = parseTable(text);
    setTdat(null); setLm(null);
    setWd({ ...t, fileName });
    const g = guessMapping(t);
    setMap(g);
    // every numeric column is kept for the channel plot unless the user takes it out
    setKeepCols(t.header.map((_, i) => i).filter((i) => i !== g.time && i !== g.date && !Number.isNaN(num(t.data[0]?.[i]))));
    setPayload(null);
    setProblem(t.data.length ? null : `${fileName} has no rows of numbers.`);
    guessMeta(fileName);
  };
  const loadTdat = (buf: ArrayBuffer, fileName: string) => {
    try {
      const f = parseTdat(buf);
      const g = guessChannels(f);
      setTdat({ f, fileName });
      setLm({ units: 'imperial', step: 0.5, depth: g.depth, tension: g.tension, speed: g.speed, keep: f.channels.filter((c) => c.status === 'series' && [0, 1, 3].includes(c.type)).map((c) => c.index) });
      setWd(null); setMap(null); setPayload(null);
      setProblem(g.depth < 0 || g.tension < 0 ? 'The recording has no depth or no tension channel: pick them below.' : null);
      const order = f.job['(Job) Order'];
      setMeta((m) => ({ ...m, job: m.job || order || '', cable: m.cable || f.job['Wire Type'] || '' }));
      guessMeta(fileName);
    } catch (e) { setProblem((e as Error).message); }
  };
  const loadFile = (buf: ArrayBuffer, fileName: string) => {
    if (isTdat(buf)) { if (format !== 'lineminder') setFormat('lineminder'); loadTdat(buf, fileName); return; }
    if (format === 'lineminder' && /\.da_tdat$|\.dat$/i.test(fileName) && !/[\t,;]/.test(new TextDecoder().decode(buf.slice(0, 400)))) {
      setProblem(`${fileName} is not a Lineminder recording (it does not start with DTS / da_tdat). If it is a text export, choose CSV.`); return;
    }
    if (format === 'lineminder') setFormat('csv');
    loadText(new TextDecoder().decode(buf), fileName);
  };
  const loadSv = (buf: ArrayBuffer, fileName: string) => { const t = parseTable(new TextDecoder().decode(buf)); setSv({ ...t, fileName }); setSvMap(guessSurveyMapping(t)); };

  const lmBuilt = useMemo(() => (tdat && lm && lm.depth >= 0 && lm.tension >= 0 ? lmTable(tdat.f, lm) : null), [tdat, lm]);
  const checks = useMemo(() => (tdat ? tdatChecks(tdat.f) : []), [tdat]);
  const table = format === 'lineminder' ? lmBuilt?.t ?? null : wd;
  const mapping = format === 'lineminder' ? lmBuilt?.m ?? null : map;
  const fileName = format === 'lineminder' ? tdat?.fileName ?? '' : wd?.fileName ?? '';

  const manual = useMemo(() => svMode === 'file'
    ? sv && svMap ? fileSurvey(sv, svMap, sv.fileName) : null
    : svMode === 'manual' ? manualSurvey(parseFloat(depths.kop), parseFloat(depths.p30), parseFloat(depths.lat), parseFloat(depths.td)) : null,
  [svMode, sv, svMap, depths]);
  const mapProblems = table && mapping ? mappingProblems(table, mapping) : [];

  const run = (useSet = set) => {
    if (!table || !mapping) { setProblem('Add the winch data file first, or try a demo.'); return; }
    if (mapProblems.length) { setProblem(mapProblems.join('. ') + '.'); return; }
    if (svMode !== 'vertical' && !manual) { setProblem(svMode === 'file' ? 'The survey file does not give the KOP and the 30° point: check its columns.' : 'Enter the four depths, each deeper than the last (KOP, 30° point, lateral start, TD).'); return; }
    const S = buildSamples(table, { ...mapping, minDepth: 0 });
    if (S.length < 20) { setProblem('Fewer than 20 usable rows: check which column is which.'); return; }
    // a recording can hold several runs: each from surface down and back to surface gets its own tab
    let runs: Run[] = splitRuns(S);
    if (!runs.length) runs = [{ n: 1, i0: 0, i1: S.length - 1, t0: S[0].t, t1: S[S.length - 1].t, maxD: Math.max(...S.map((s) => s.depth)), partial: true }];
    const restrictions = parseRestrictions(restr);
    const reports: RunReport[] = runs.map((r) => {
      const Sr = S.slice(r.i0, r.i1 + 1);
      const Sa = Sr.filter((s) => s.depth >= mapping.minDepth);
      const survey = svMode === 'vertical' ? verticalSurvey(Math.max(r.maxD, parseFloat(depths.td) || 0)) : manual!;
      return { run: r, a: analyse(Sa.length >= 20 ? Sa : Sr, survey, rules, useSet), speed: sopSpeedFindings(Sr, sop, restrictions), jar: detectJarring(Sr, sop) };
    });
    const cols = format === 'lineminder' ? lmBuilt!.cols : keepCols;
    const source = format === 'lineminder' && tdat ? `Lineminder recording, ${tdat.f.periodMs} ms, read every ${lm!.step} s` : `${table.delim} separated export`;
    setProblem(null);
    setPayload({ meta, fileName, reports, channels: channelSeries(table, mapping, cols), restrictions, sop, source });
  };

  const demoText = () => {
    const d = demoRun();
    setFormat('csv');
    loadText(d.text, d.fileName);
    setSvMode('manual');
    setDepths({ kop: String(d.survey.kop), p30: String(d.survey.p30), lat: String(d.survey.lat), td: String(d.survey.td) });
    setSet('post');
  };
  const demoLm = () => { const d = demoLineminder(); setFormat('lineminder'); loadTdat(d.buffer, d.fileName); setSvMode('vertical'); setRestr(''); };

  const openWindow = () => {
    const w = window.open('/winch-window', 'slk-winch-analysis', 'popup,width=1400,height=900');
    if (!w) setProblem('The browser blocked the new window: allow pop-ups for this site and try again.');
  };

  if (payload) {
    return <RunsView p={payload} onEdit={() => setPayload(null)} onWindow={openWindow} onSet={(s) => { setSet(s); run(s); }} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-text-muted">Add the Lineminder recording or a winch export, the well and the rules. The app finds each run, checks every sample against the guidelines and SOP-04, finds the jarring and shows the plots and findings.</p>
        <Button size="sm" variant="ghost" onClick={demoLm}>Demo recording</Button>
        <Button size="sm" variant="ghost" onClick={demoText}>Demo export</Button>
      </div>

      <Step n={1} title="Winch data file">
        <div role="radiogroup" aria-label="File type" className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {([['lineminder', 'Lineminder recording (.da_tdat)'], ['csv', 'CSV or text export (TXT, CSV, TSV, LOG)']] as const).map(([v, l]) => (
            <label key={v} className="flex items-center gap-2"><input type="radio" name="wd-format" checked={format === v} onChange={() => setFormat(v)} />{l}</label>
          ))}
        </div>
        <DropZone id="wd-file" accept={format === 'lineminder' ? '.da_tdat,.dat' : '.txt,.csv,.tsv,.log,.dat,.prn'}
          label={format === 'lineminder' ? 'Choose the Lineminder recording' : 'Choose the winch export'} onFile={loadFile}
          status={format === 'lineminder'
            ? tdat ? `${tdat.fileName} · ${tdatSummary(tdat.f).records.toLocaleString()} records · ${fmt(tdatSummary(tdat.f).minutes)} min from ${tdatSummary(tdat.f).start}` : 'No recording yet'
            : wd ? `${wd.fileName} · ${wd.data.length.toLocaleString()} rows · ${wd.header.length} columns` : 'No file yet'} />
        {format === 'csv' && wd && (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-text-muted">First lines of the file ({wd.delim} separated, {wd.hasHeader ? 'with a header row' : 'no header row: columns are numbered'})</summary>
            <pre className="mt-1 max-h-36 overflow-auto rounded-sm bg-surface-2 p-2 font-mono text-[0.6875rem]">{wd.preview}</pre>
          </details>
        )}
      </Step>

      {format === 'lineminder' && tdat && lm && (
        <Step n={2} title="Channels and units" note="Units come from each channel's type in the file">
          <LineminderForm f={tdat.f} o={lm} onChange={(o) => { setLm(o); setPayload(null); }} checks={checks} />
        </Step>
      )}
      {format === 'csv' && wd && map && (
        <Step n={2} title="Columns, units and channels">
          <MappingForm t={wd} m={map} onChange={(m) => { setMap(m); setPayload(null); }} />
          <p className={cx('mt-2 text-xs', mapProblems.length ? 'text-danger' : 'text-success')} role="status">
            {mapProblems.length ? mapProblems.join('. ') + '.'
              : `Time read as ${TIME_MODES.find((x) => x.value === resolvedTimeMode(wd, map))?.label.toLowerCase()}. First row: depth ${wd.data[0][map.depth]}, tension ${wd.data[0][map.tension]}.`}
          </p>
          <fieldset className="mt-3">
            <legend className="mb-1 text-xs font-semibold text-text-muted">Channels to keep for the channel plot</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {wd.header.map((h, i) => (i === map.time || i === map.date ? null : (
                <label key={i} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={keepCols.includes(i)} onChange={(e) => setKeepCols((s) => (e.target.checked ? [...s, i] : s.filter((x) => x !== i)))} />{h}
                </label>
              )))}
            </div>
          </fieldset>
        </Step>
      )}

      <Step n={3} title="Well" note="Vertical, or the zones of a deviated well">
        <div role="radiogroup" aria-label="Where the zones come from" className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {([['vertical', 'Vertical well'], ['manual', 'Deviated: enter the four depths'], ['file', 'Deviated: load a directional survey']] as const).map(([v, l]) => (
            <label key={v} className="flex items-center gap-2"><input type="radio" name="sv-mode" checked={svMode === v} onChange={() => setSvMode(v)} />{l}</label>
          ))}
        </div>
        {svMode === 'manual' && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {([['kop', 'KOP'], ['p30', '30° point'], ['lat', 'Lateral start (≈89°)'], ['td', 'TD']] as const).map(([k, l]) => (
              <Field key={k} id={`sv-${k}`} label={l} unit="ft MD">
                <input id={`sv-${k}`} className={cx(inputClass, 'pr-14')} type="number" inputMode="decimal" min={0} value={depths[k]}
                  onChange={(e) => setDepths((d) => ({ ...d, [k]: e.target.value }))} />
              </Field>
            ))}
          </div>
        )}
        {svMode === 'file' && (
          <>
            <DropZone id="sv-file" accept=".txt,.csv,.tsv,.las,.dat" label="Choose the survey file" onFile={loadSv}
              status={sv ? `${sv.fileName} · ${sv.data.length} stations` : 'No survey yet'} />
            {sv && svMap && <SurveyForm t={sv} m={svMap} onChange={setSvMap} />}
          </>
        )}
        {svMode !== 'vertical' && (
          <p className={cx('mt-2 text-xs', manual ? 'text-success' : 'text-text-subtle')} role="status">
            {manual ? `KOP ${fmt(manual.kop)} ft · 30° ${fmt(manual.p30)} ft · lateral ${fmt(manual.lat)} ft · TD ${fmt(manual.td)} ft`
              : svMode === 'file' && sv ? 'The KOP and the 30° point could not be found from these columns.' : 'Each depth must be deeper than the one before.'}
          </p>
        )}
        <Field id="wd-restr" label="Restrictions" hint="Depth in ft and what it is, e.g. 650 SSSV, 7450 X nipple. Speed is checked 100 ft either side.">
          <input id="wd-restr" className={inputClass} value={restr} onChange={(e) => setRestr(e.target.value)} placeholder="650 SSSV, 7450 X nipple" />
        </Field>
      </Step>

      <Step n={4} title="SOP-04 speed and jarring">
        <SopEditor sop={sop} onChange={(s) => { setSop(s); storeSop(s); setPayload(null); }} />
      </Step>

      <Step n={5} title="Guidelines" note="Cable rules by well zone">
        <RulesEditor rules={rules} set={set} onSet={setSet} onChange={(r) => { setRules(r); storeRules(r); }} />
      </Step>

      <Step n={6} title="Run details" note="For the heading and the printout only">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {([['job', 'Job or pad'], ['well', 'Well'], ['stage', 'Stage'], ['unit', 'Unit'], ['cable', 'Cable'], ['date', 'Run date'], ['by', 'Checked by']] as const).map(([k, l]) => (
            <Field key={k} id={`wd-${k}`} label={l}>
              <input id={`wd-${k}`} className={inputClass} type={k === 'date' ? 'date' : 'text'} value={meta[k]} onChange={(e) => setMeta((m) => ({ ...m, [k]: e.target.value }))} />
            </Field>
          ))}
        </div>
      </Step>

      {problem && <Banner tone="danger">{problem}</Banner>}
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => run()}>Find the runs and check them</Button>
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

/** The SOP-04 limits, kept on this device, with the Knowledge Hub documents they come from. */
function SopEditor({ sop, onChange }: { sop: SopRules; onChange: (s: SopRules) => void }) {
  const lib = useQuery({ queryKey: ['knowledge'], queryFn: () => api<{ docs: KnowledgeDoc[] }>('/knowledge'), retry: false, staleTime: 5 * 60_000 });
  const docs = (lib.data?.docs ?? []).filter((d) => /sop-?0?4\b|winch operation|jarring|speed guideline/i.test(`${d.doc_no ?? ''} ${d.title}`));
  const num = (k: keyof SopRules, label: string, unit: string, hint?: string) => (
    <Field id={`sop-${k}`} label={label} unit={unit} hint={hint}>
      <input id={`sop-${k}`} className={cx(inputClass, 'pr-14')} type="number" min={0} value={sop[k] as number} onChange={(e) => onChange({ ...sop, [k]: Number(e.target.value) || 0 })} />
    </Field>
  );
  const det = (k: keyof SopRules['detect'], label: string, unit: string) => (
    <span className="flex items-center gap-1 text-xs text-text-muted">{label}
      <input aria-label={`${label} (${unit})`} className={inputSized(`w-20 ${small}`)} type="number" min={0} value={sop.detect[k]} onChange={(e) => onChange({ ...sop, detect: { ...sop.detect, [k]: Number(e.target.value) || 0 } })} />{unit}
    </span>
  );
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-subtle">
        From NESR-8000-SOP-04 Winch Operations: 6.2 Wire speed guidelines and 8.3 Wire cycling and jarring. Set the BHA speeds from the Speed Guidelines and the wire breaking strength or MAT for the job. Kept on this device.
        {docs.length > 0 && <> Documents: {docs.map((d, i) => (
          <span key={d.id}>{i > 0 && ' · '}{d.file ? <a className="font-semibold text-accent-text underline" href={fileUrl(d.id, d.file, d.file.content_type === 'application/pdf')} target="_blank" rel="noreferrer"><BookOpen aria-hidden className="mr-0.5 inline size-3" />{d.doc_no ? `${d.doc_no} ` : ''}{d.title}</a> : d.title}</span>
        ))}</>}
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {num('surfaceDepth', 'Near surface: shallower than', 'ft')}{num('surfaceSpeed', 'Near surface: max speed', 'fpm')}
        {num('restrictionBand', 'Restriction: within', 'ft')}{num('restrictionSpeed', 'Restriction: max speed', 'fpm')}
        {num('maxRih', 'BHA: max RIH speed', 'fpm', '0: not checked')}{num('maxPooh', 'BHA: max POOH speed', 'fpm', '0: not checked')}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {num('mbs', 'Wire breaking strength', 'lbs', '0: not known')}{num('matPct', 'Jar up at most', '% MBS')}
        {num('mat', 'MAT (if set)', 'lbs', 'Wins over the % when set')}{num('jarDownLossPct', 'Jar down: lose at most', '%')}
        {num('cycleMin', 'Cycle at most', 'min')}{num('restMin', 'Rest at least', 'min')}{num('maxCycles', 'Cycles at one place', 'max')}
        <div className="flex flex-col justify-end gap-1">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sop.spang} onChange={(e) => onChange({ ...sop, spang: e.target.checked })} />Spang jars in the string</label>
          {sop.spang && <span className="flex items-center gap-1 text-xs text-text-muted">limit <input aria-label="Spang jar limit (lbs)" className={inputSized(`w-24 ${small}`)} type="number" value={sop.spangLimit} onChange={(e) => onChange({ ...sop, spangLimit: Number(e.target.value) || 0 })} /> lbs</span>}
        </div>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">How jarring and speed findings are found</summary>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {det('stationaryFt', 'Held in place: within', 'ft')}{det('windowSec', 'over', 's')}{det('upMinLb', 'Jar up: over normal by', 'lbs')}{det('upPct', 'or', '%')}
          {det('downPct', 'Jar down: under normal by', '%')}{det('gapSec', 'One cycle: hits within', 's')}{det('minSec', 'Speed: lasting', 's')}{det('mergeSec', 'merged within', 's')}
        </div>
      </details>
      <Button size="sm" variant="ghost" onClick={() => onChange(structuredClone(SOP_DEFAULTS))}><RotateCcw aria-hidden className="size-3.5" />Restore SOP-04 defaults</Button>
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

function DropZone({ id, accept, label, status, onFile }: { id: string; accept: string; label: string; status: string; onFile: (buf: ArrayBuffer, name: string) => void }) {
  const [over, setOver] = useState(false);
  const take = (f: File | undefined) => { if (f) f.arrayBuffer().then((b) => onFile(b, f.name)); };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); };
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
      className={cx('flex flex-wrap items-center gap-3 rounded-md border-2 border-dashed px-3 py-3', over ? 'border-accent bg-accent/10' : 'border-border-strong bg-surface-2')}>
      <label htmlFor={id} className="inline-flex h-(--layout-control-sm) cursor-pointer items-center gap-1.5 rounded-sm border border-border-strong bg-surface px-3 text-sm font-semibold hover:bg-surface-3 focus-within:outline-2 focus-within:outline-focus">
        <Upload aria-hidden className="size-3.5" />{label}
        <input id={id} type="file" accept={accept} className="sr-only" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      <span className="min-w-0 text-xs break-all text-text-muted">{status} <span className="text-text-subtle">· or drop it here</span></span>
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

function SurveyForm({ t, m, onChange }: { t: Table; m: SurveyMapping; onChange: (m: SurveyMapping) => void }) {
  const set = <K extends keyof SurveyMapping>(k: K, v: SurveyMapping[K]) => onChange({ ...m, [k]: v });
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
      <ColSelect id="sv-c-md" label="MD column" t={t} value={m.md} onChange={(v) => set('md', v)} />
      <ColSelect id="sv-c-inc" label="Inclination column (°)" t={t} value={m.inc} onChange={(v) => set('inc', v)} />
      <ColSelect id="sv-c-tvd" label="TVD column" t={t} value={m.tvd} none onChange={(v) => set('tvd', v)} />
      <Pick id="sv-unit" label="Survey depth unit" value={m.unit} options={opts(UNIT_DEPTH)} onChange={(v) => set('unit', v)} />
      <Field id="sv-kopinc" label="KOP at first inclination of" unit="°">
        <input id="sv-kopinc" className={inputClass} type="number" value={m.kopInc} onChange={(e) => set('kopInc', Number(e.target.value))} />
      </Field>
      <Field id="sv-latinc" label="Lateral at first inclination of" unit="°">
        <input id="sv-latinc" className={inputClass} type="number" value={m.latInc} onChange={(e) => set('latInc', Number(e.target.value))} />
      </Field>
    </div>
  );
}

function RulesEditor({ rules, set, onSet, onChange }: { rules: Rules; set: RuleSetKey; onSet: (s: RuleSetKey) => void; onChange: (r: Rules) => void }) {
  const [note, setNote] = useState<string | null>(null);
  const R = rules[set];
  const edit = (key: RuleKey, f: string, v: number, tier?: [number, number]) => {
    const next = structuredClone(rules);
    if (tier) next[set].nearSurface.tiers[tier[0]][tier[1]] = v;
    else (next[set][key] as Record<string, number>)[f] = v;
    onChange(next);
  };
  const loadFile = (text: string) => {
    try { const r = checkRules(JSON.parse(text)); if (r) { onChange(r); setNote('Rules loaded.'); } else setNote('That file is not a rules file: it needs both rule sets.'); }
    catch { setNote('That file is not valid JSON.'); }
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-72">
          <Pick<RuleSetKey> id="wd-set" label="Rule set" value={set} options={opts(RULE_SET_LABEL, RULE_SET_LABEL)} onChange={onSet} />
        </div>
        <Button size="sm" variant="ghost" onClick={() => { const n = structuredClone(rules); n[set] = structuredClone(RULE_DEFAULTS[set]); onChange(n); setNote(`Defaults restored for ${R.name}.`); }}>
          <RotateCcw aria-hidden className="size-3.5" />Restore defaults</Button>
        <Button size="sm" variant="ghost" onClick={() => saveFile('winch-rules.json', JSON.stringify(rules, null, 2), 'application/json')}><FileDown aria-hidden className="size-3.5" />Save rules file</Button>
        <label className="inline-flex h-(--layout-control-sm) cursor-pointer items-center gap-1.5 rounded-sm px-3 text-sm font-semibold text-text-muted hover:text-text focus-within:outline-2 focus-within:outline-focus">
          <FileUp aria-hidden className="size-3.5" />Load rules file
          <input type="file" accept=".json" className="sr-only" onChange={(e) => { e.target.files?.[0]?.text().then(loadFile); e.target.value = ''; }} />
        </label>
      </div>
      <p className="mb-2 text-xs text-text-subtle">Every limit can be changed and is kept on this device. The seasoning set has placeholder values: set them from your seasoning procedure before use.</p>
      {note && <p role="status" className="mb-2 text-xs text-success">{note}</p>}
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Limits for {R.name}</summary>
        <ul className="mt-2 divide-y divide-border">
          {RULE_FIELDS.map((rf) => (
            <li key={rf.key} className="grid gap-2 py-2 md:grid-cols-[12rem_1fr]">
              <div><p className="text-sm font-semibold">{rf.label}</p><p className="text-xs text-text-subtle">{ruleText(R, rf.key)}</p></div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {rf.fields === 'tiers'
                  ? R.nearSurface.tiers.map(([d, v], i) => (
                    <span key={i} className="flex items-center gap-1 text-xs text-text-muted">
                      within <input aria-label={`Tier ${i + 1} depth (ft)`} className={inputSized(`w-20 ${small}`)} type="number" value={d} onChange={(e) => edit('nearSurface', '', Number(e.target.value), [i, 0])} /> ft:
                      <input aria-label={`Tier ${i + 1} max speed (fpm)`} className={inputSized(`w-20 ${small}`)} type="number" value={v} onChange={(e) => edit('nearSurface', '', Number(e.target.value), [i, 1])} /> fpm
                    </span>
                  ))
                  : rf.fields.map((f) => (
                    <span key={f.f} className="flex items-center gap-1 text-xs text-text-muted">
                      {f.label}
                      <input aria-label={`${rf.label}: ${f.label} (${f.unit})`} className={inputSized(`w-24 ${small}`)} type="number"
                        value={(R[rf.key] as unknown as Record<string, number>)[f.f]} onChange={(e) => edit(rf.key, f.f, Number(e.target.value))} />
                      {f.unit}
                    </span>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export default WinchDataCard;
