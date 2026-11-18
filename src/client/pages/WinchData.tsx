import { FileDown, FileUp, Pencil, Printer, RotateCcw, Upload } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import {
  CHECK_KEYS, RULE_DEFAULTS, RULE_FIELDS, RULE_META, RULE_SET_LABEL, TIME_MODES, UNIT_DEPTH, UNIT_SPEED, UNIT_TENSION,
  analyse, buildSamples, checkRules, demoRun, dur, fileSurvey, findingsCsv, fmt, guessMapping, guessSurveyMapping, hm, hms, limitCurves,
  manualSurvey, mappingProblems, median, parseTable, resolvedTimeMode, ruleText, whereText,
  type Analysis, type Mapping, type RuleKey, type RuleSetKey, type Rules, type Sample, type SpeedSign, type SurveyMapping, type Table, type TimeMode,
} from '../../shared/winchData';
import type { Job } from '../../shared/types';
import { useMe } from '../auth';
import { printOnly, saveFile } from '../components/charts';
import { Banner, Button, Field, cx, inputClass, inputSized } from '../components/ui';

// Winch data: plots and guidelines check, on the job's Closure tab (6z.26). Everything runs in the browser; nothing is
// saved to the job yet. The rule limits are kept on this device.

const RULES_KEY = 'slk-winch-rules';
const loadRules = (): Rules => {
  try { const r = checkRules(JSON.parse(localStorage.getItem(RULES_KEY) ?? 'null')); if (r) return r; } catch { /* not saved yet */ }
  return structuredClone(RULE_DEFAULTS);
};
const storeRules = (r: Rules) => { try { localStorage.setItem(RULES_KEY, JSON.stringify(r)); } catch { /* private mode: kept for this visit */ } };

type Meta = { job: string; well: string; stage: string; unit: string; cable: string; date: string; by: string };
type SurveyMode = 'manual' | 'file';

const small = 'h-(--layout-control-sm) text-sm';

export function WinchDataCard({ job }: { job: Job }) {
  const { data: me } = useMe();
  const [wd, setWd] = useState<(Table & { fileName: string }) | null>(null);
  const [map, setMap] = useState<Mapping | null>(null);
  const [svMode, setSvMode] = useState<SurveyMode>('manual');
  const [depths, setDepths] = useState({ kop: '', p30: '', lat: '', td: job.target_depth_ft ? String(job.target_depth_ft) : '' });
  const [sv, setSv] = useState<(Table & { fileName: string }) | null>(null);
  const [svMap, setSvMap] = useState<SurveyMapping | null>(null);
  const [rules, setRules] = useState<Rules>(loadRules);
  const [set, setSet] = useState<RuleSetKey>('post');
  const [meta, setMeta] = useState<Meta>({
    job: job.ticket_no ?? job.location ?? '', well: job.well ?? '', stage: '', unit: job.unit_number ?? '',
    cable: job.wire_serial_number ?? '', date: job.start_date?.slice(0, 10) ?? '', by: me?.fullName ?? '',
  });
  const [result, setResult] = useState<Analysis | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [view, setView] = useState<'time' | 'depth' | 'findings'>('time');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { if (me?.fullName) setMeta((m) => (m.by ? m : { ...m, by: me.fullName })); }, [me?.fullName]);

  const loadWd = (text: string, fileName: string) => {
    const t = parseTable(text);
    setWd({ ...t, fileName });
    setMap(guessMapping(t));
    setResult(null);
    setProblem(t.data.length ? null : `${fileName} has no rows of numbers.`);
    // the file name often carries the well and stage, e.g. ...W12_STG-28.txt
    setMeta((m) => {
      const w = fileName.match(/W(\d{2})/i), st = fileName.match(/STG[-_ ]?(\d+)(?!.*STG)/i);
      return { ...m, well: m.well || (w?.[1] ?? ''), stage: m.stage || (st?.[1] ?? '') };
    });
  };
  const loadSv = (text: string, fileName: string) => { const t = parseTable(text); setSv({ ...t, fileName }); setSvMap(guessSurveyMapping(t)); };

  const survey = useMemo(() => svMode === 'file'
    ? sv && svMap ? fileSurvey(sv, svMap, sv.fileName) : null
    : manualSurvey(parseFloat(depths.kop), parseFloat(depths.p30), parseFloat(depths.lat), parseFloat(depths.td)),
  [svMode, sv, svMap, depths]);
  const mapProblems = wd && map ? mappingProblems(wd, map) : [];

  const run = (useSet = set) => {
    if (!wd || !map) { setProblem('Add the winch data file first, or try the demo run.'); return; }
    if (mapProblems.length) { setProblem(mapProblems.join('. ') + '.'); return; }
    if (!survey) { setProblem(svMode === 'file' ? 'The survey file does not give the KOP and the 30° point: check its columns.' : 'Enter the four depths, each deeper than the last (KOP, 30° point, lateral start, TD).'); return; }
    const S = buildSamples(wd, map);
    if (S.length < 20) { setProblem('Fewer than 20 usable rows: check which column is which.'); return; }
    setProblem(null);
    setResult(analyse(S, survey, rules, useSet));
  };

  const demo = () => {
    const d = demoRun();
    loadWd(d.text, d.fileName);
    setSvMode('manual');
    setDepths({ kop: String(d.survey.kop), p30: String(d.survey.p30), lat: String(d.survey.lat), td: String(d.survey.td) });
    setSet('post');
  };

  if (result) {
    return (
      <div ref={box}>
        <Results a={result} meta={meta} fileName={wd?.fileName ?? ''} view={view} setView={setView}
          onEdit={() => setResult(null)} onPrint={() => printOnly(box.current)}
          onSet={(s) => { setSet(s); run(s); }} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-text-muted">Add the winch export, the well zones and the rules. The app splits the trip into phases, checks every sample against the guidelines and shows the plots and findings.</p>
        <Button size="sm" variant="ghost" onClick={demo}>Try the demo run</Button>
      </div>

      <Step n={1} title="Winch data file" note="TXT, CSV, TSV or LOG: one row per sample with time, depth, line speed and tension">
        <DropZone id="wd-file" accept=".txt,.csv,.tsv,.log,.dat,.prn" label="Choose the winch export" onFile={loadWd}
          status={wd ? `${wd.fileName} · ${wd.data.length.toLocaleString()} rows · ${wd.header.length} columns` : 'No file yet'} />
        {wd && (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-text-muted">First lines of the file ({wd.delim} separated, {wd.hasHeader ? 'with a header row' : 'no header row: columns are numbered'})</summary>
            <pre className="mt-1 max-h-36 overflow-auto rounded-sm bg-surface-2 p-2 font-mono text-[0.6875rem]">{wd.preview}</pre>
          </details>
        )}
      </Step>

      {wd && map && (
        <Step n={2} title="Columns and units">
          <MappingForm t={wd} m={map} onChange={(m) => { setMap(m); setResult(null); }} />
          <p className={cx('mt-2 text-xs', mapProblems.length ? 'text-danger' : 'text-success')} role="status">
            {mapProblems.length ? mapProblems.join('. ') + '.'
              : `Time read as ${TIME_MODES.find((x) => x.value === resolvedTimeMode(wd, map))?.label.toLowerCase()}. First row: depth ${wd.data[0][map.depth]}, tension ${wd.data[0][map.tension]}.`}
          </p>
        </Step>
      )}

      <Step n={3} title="Well zones" note="Vertical to KOP · build to 30° · heel to about 89° · lateral to TD">
        <div role="radiogroup" aria-label="Where the zones come from" className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {([['manual', 'Enter the four depths'], ['file', 'Load a directional survey (MD, inclination, TVD optional)']] as const).map(([v, l]) => (
            <label key={v} className="flex items-center gap-2"><input type="radio" name="sv-mode" checked={svMode === v} onChange={() => setSvMode(v)} />{l}</label>
          ))}
        </div>
        {svMode === 'manual' ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {([['kop', 'KOP'], ['p30', '30° point'], ['lat', 'Lateral start (≈89°)'], ['td', 'TD']] as const).map(([k, l]) => (
              <Field key={k} id={`sv-${k}`} label={l} unit="ft MD">
                <input id={`sv-${k}`} className={cx(inputClass, 'pr-14')} type="number" inputMode="decimal" min={0} value={depths[k]}
                  onChange={(e) => setDepths((d) => ({ ...d, [k]: e.target.value }))} />
              </Field>
            ))}
          </div>
        ) : (
          <>
            <DropZone id="sv-file" accept=".txt,.csv,.tsv,.las,.dat" label="Choose the survey file" onFile={loadSv}
              status={sv ? `${sv.fileName} · ${sv.data.length} stations` : 'No survey yet'} />
            {sv && svMap && <SurveyForm t={sv} m={svMap} onChange={setSvMap} />}
          </>
        )}
        <p className={cx('mt-2 text-xs', survey ? 'text-success' : 'text-text-subtle')} role="status">
          {survey ? `KOP ${fmt(survey.kop)} ft · 30° ${fmt(survey.p30)} ft · lateral ${fmt(survey.lat)} ft · TD ${fmt(survey.td)} ft`
            : svMode === 'file' && sv ? 'The KOP and the 30° point could not be found from these columns.' : 'Each depth must be deeper than the one before.'}
        </p>
      </Step>

      <Step n={4} title="Rules">
        <RulesEditor rules={rules} set={set} onSet={setSet} onChange={(r) => { setRules(r); storeRules(r); }} />
      </Step>

      <Step n={5} title="Run details" note="For the heading and the printout only">
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
        <Button variant="primary" onClick={() => run()}>Plot and check the run</Button>
      </div>
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

function DropZone({ id, accept, label, status, onFile }: { id: string; accept: string; label: string; status: string; onFile: (text: string, name: string) => void }) {
  const [over, setOver] = useState(false);
  const take = (f: File | undefined) => { if (f) f.text().then((t) => onFile(t, f.name)); };
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

// ---------------------------------------------------------------- results

function Results({ a, meta, fileName, view, setView, onEdit, onPrint, onSet }: {
  a: Analysis; meta: Meta; fileName: string; view: 'time' | 'depth' | 'findings'; setView: (v: 'time' | 'depth' | 'findings') => void;
  onEdit: () => void; onPrint: () => void; onSet: (s: RuleSetKey) => void;
}) {
  const { kpi, S } = a;
  const date = meta.date ? new Date(`${meta.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
  const sub = [meta.job, [date, `${hm(S[0].t)}–${hm(S[S.length - 1].t)}`].filter(Boolean).join(' '), meta.cable && `cable ${meta.cable}`, fileName, meta.by && `checked by ${meta.by}`].filter(Boolean).join(' · ');
  const tiles: [string, string, boolean?][] = [
    [`${fmt(kpi.maxD)} ft`, 'Max depth'], [dur(kpi.rihSec), 'RIH, surface to bottom'], [dur(kpi.bottomSec), 'Bottom to steady POOH'], [dur(kpi.poohSec), 'POOH to surface'],
    [`${fmt(kpi.avgRih)} fpm`, 'Avg RIH speed'], [`${fmt(kpi.avgPooh)} fpm`, 'Avg POOH speed'], [`${fmt(kpi.maxT)} lbs`, 'Max tension'], [String(kpi.nViol), 'Violations', kpi.nViol > 0],
  ];
  const tabs = [['time', 'Time view'], ['depth', 'Depth view'], ['findings', `Findings (${kpi.nViol})`]] as const;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-bold">Well {meta.well || '—'} · Stage {meta.stage || '—'} · {meta.unit || '—'}</h3>
          <p className="text-xs break-words text-text-muted">{sub}</p>
        </div>
        <div className="flex flex-wrap gap-1 print:hidden">
          <Button size="sm" variant="ghost" onClick={onEdit}><Pencil aria-hidden className="size-3.5" />Change inputs</Button>
          <Button size="sm" variant="ghost" onClick={() => saveFile(`winch-findings${meta.well ? `-w${meta.well}` : ''}${meta.stage ? `-stg${meta.stage}` : ''}.csv`, findingsCsv(a), 'text/csv')}>
            <FileDown aria-hidden className="size-3.5" />Findings CSV</Button>
          <Button size="sm" variant="ghost" onClick={onPrint}><Printer aria-hidden className="size-3.5" />Print</Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        {tiles.map(([v, l, bad]) => (
          <div key={l} className="rounded-md border border-border bg-surface-2 px-3 py-2">
            <dd className={cx('font-display text-base leading-tight font-bold', bad ? 'text-danger' : 'text-success')}>{v}</dd>
            <dt className="text-xs text-text-muted">{l}</dt>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cx('rounded-pill px-2.5 py-0.5 font-semibold', kpi.nViol ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success')}>
          {kpi.nViol ? `${kpi.nViol} violation${kpi.nViol > 1 ? 's' : ''}` : 'No violations'}</span>
        {a.advice.length > 0 && <span className="rounded-pill bg-warning-subtle px-2.5 py-0.5 font-semibold text-warning">{a.advice.length} advisory</span>}
        <label htmlFor="wd-rset" className="ml-1 text-text-muted">Rules</label>
        <select id="wd-rset" className={inputSized(`w-auto ${small}`)} value={a.set} onChange={(e) => onSet(e.target.value as RuleSetKey)}>
          {(Object.keys(RULE_SET_LABEL) as RuleSetKey[]).map((k) => <option key={k} value={k}>{RULE_SET_LABEL[k]}</option>)}
        </select>
        <span className="text-text-subtle">{a.sv.source === 'manual' ? 'Zones entered by hand' : `Zones from ${a.sv.source}`}</span>
      </div>

      <div role="tablist" aria-label="Views" className="flex flex-wrap gap-1 print:hidden">
        {tabs.map(([v, l]) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={cx('h-(--layout-control-sm) rounded-sm border px-3 text-sm font-semibold', view === v ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>{l}</button>
        ))}
      </div>

      <div role="tabpanel">
        {view === 'time' && <>
          <TimeChart a={a} />
          <p className="mt-2 text-xs text-text-subtle">Shaded across: the well zones on the depth scale. Red bands: a guideline broken; amber: outside the advised pump-down tension. Point at the plot for the values; drag across to zoom in.</p>
        </>}
        {view === 'depth' && <>
          <DepthCharts a={a} />
          <p className="mt-2 text-xs text-text-subtle">Trip in (RIH) and trip out (POOH) against depth. Dashed lines: the guideline limit at that depth (red for POOH, blue for RIH, amber for the advised pump-down tension). Speed in ft/min, tension in lbs.</p>
        </>}
        {view === 'findings' && <Findings a={a} />}
      </div>
    </div>
  );
}

const th = 'py-1.5 pr-3 text-left font-mono text-label font-semibold tracking-wide text-text-muted uppercase';
const td = 'py-1.5 pr-3 align-top';

function Findings({ a }: { a: Analysis }) {
  const { zones, viol, advice, R, LW, ruleCounts, sv, P, S } = a;
  const rows = [...viol, ...advice].sort((x, y) => x.t0 - y.t0);
  return (
    <div className="space-y-5 text-xs">
      <section>
        <h4 className="mb-1 text-sm font-semibold">By zone <span className="font-normal text-text-subtle">(speed avg / max in ft/min, tension in lbs)</span></h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem]">
            <thead><tr>{['Zone', 'Depth (ft)', 'RIH speed', 'POOH speed', 'RIH min tension', 'POOH max tension', 'Flags'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
            <tbody>{zones.map((z) => (
              <tr key={z.name} className="border-t border-border">
                <td className={td}>{z.name}</td><td className={cx(td, 'font-mono')}>{fmt(z.lo)} – {z.hi == null ? 'TD' : fmt(z.hi)}</td>
                <td className={cx(td, 'font-mono')}>{fmt(z.rihAvg)} / {fmt(z.rihMax)}</td><td className={cx(td, 'font-mono')}>{fmt(z.poohAvg)} / {fmt(z.poohMax)}</td>
                <td className={cx(td, 'font-mono')}>{fmt(z.rihMinT)}</td><td className={cx(td, 'font-mono')}>{fmt(z.poohMaxT)}</td>
                <td className={td}><Pill tone={z.flags ? 'danger' : 'success'}>{z.flags || '✓'}</Pill></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mt-1 text-text-subtle">Vertical line weight (median RIH tension {fmt(R.pumpTension.lwFrom)}–{fmt(R.pumpTension.lwTo)} ft above the 30° point): {Number.isNaN(LW) ? 'not measurable from this run' : `${fmt(LW)} lbs`}.</p>
      </section>

      <section>
        <h4 className="mb-1 text-sm font-semibold">Guidelines check: {R.name}</h4>
        <ul className="divide-y divide-border">
          {CHECK_KEYS.map((k) => {
            const n = ruleCounts[k], M = RULE_META[k];
            const text = k === 'pumpTension'
              ? `Close to the vertical line weight (${Number.isNaN(LW) ? 'n/a' : `${fmt(LW)} lbs`} measured above the curve): ${Number.isNaN(LW) ? '—' : `${fmt(LW - R.pumpTension.band)} – ${fmt(LW + R.pumpTension.band)} lbs`}`
              : ruleText(R, k);
            return (
              <li key={k} className="grid grid-cols-[2.5rem_1fr] gap-2 py-1.5 sm:grid-cols-[2.5rem_14rem_1fr]">
                <span><Pill tone={n ? (M.advice ? 'warning' : 'danger') : 'success'}>{n ? `${n}×` : '✓'}</Pill></span>
                <span className="font-semibold">{M.label}</span>
                <span className="col-start-2 text-text-muted sm:col-start-auto">{text}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h4 className="mb-1 text-sm font-semibold">Violations ({viol.length}){advice.length > 0 && ` · ${advice.length} advisory`}</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem]">
            <thead><tr>{['Time', 'Lasted', 'Depth (ft)', 'Where', 'Rule', 'Worst'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.length ? rows.map((v, i) => (
              <tr key={i} className={cx('border-t border-border', v.advice && 'text-warning')}>
                <td className={cx(td, 'font-mono')}>{hms(v.t0)}</td><td className={td}>{dur(v.sec)}</td><td className={cx(td, 'font-mono')}>{fmt(v.d0)} – {fmt(v.d1)}</td>
                <td className={td}>{whereText(v)}</td><td className={td}>{v.label}</td>
                <td className={td}><b>{fmt(v.worst)} {v.unit}</b> vs {v.side} {fmt(v.limit)} ({v.worst >= v.limit ? '+' : '−'}{fmt(Math.abs(v.worst - v.limit))})</td>
              </tr>
            )) : <tr className="border-t border-border"><td colSpan={6} className={cx(td, 'text-text-subtle')}>No guideline broken on this run.</td></tr>}</tbody>
          </table>
        </div>
        <p className="mt-1 text-text-subtle">{ruleText(R, 'detect')}.</p>
      </section>

      <section>
        <h4 className="mb-1 text-sm font-semibold">Phases</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem]">
            <thead><tr>{['Phase', 'From', 'To', 'Duration', 'Depth'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
            <tbody>{([['RIH, surface to bottom', S[P.iStart], S[P.iBottom], P.rihSec], ['Bottom to steady POOH (plug and perf)', S[P.iBottom], S[P.iSteady], P.bottomSec], ['POOH, steady to surface', S[P.iSteady], S[P.iEnd], P.poohSec]] as const).map(([l, x, y, s]) => (
              <tr key={l} className="border-t border-border"><td className={td}>{l}</td><td className={cx(td, 'font-mono')}>{hms(x.t)}</td><td className={cx(td, 'font-mono')}>{hms(y.t)}</td><td className={td}>{dur(s)}</td><td className={cx(td, 'font-mono')}>{fmt(x.depth)} → {fmt(y.depth)} ft</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mt-1 text-text-subtle">Zones: KOP {fmt(sv.kop)} · 30° {fmt(sv.p30)} · lateral {fmt(sv.lat)} · TD {fmt(sv.td)} ft · {S.length.toLocaleString()} rows · median {fmt(median(S.map((s) => s.dt)), 1)} s apart</p>
      </section>
    </div>
  );
}

function Pill({ tone, children }: { tone: 'danger' | 'warning' | 'success'; children: ReactNode }) {
  const cls = { danger: 'bg-danger-subtle text-danger', warning: 'bg-warning-subtle text-warning', success: 'bg-success-subtle text-success' }[tone];
  return <span className={cx('inline-block min-w-6 rounded-pill px-1.5 text-center font-mono text-label font-bold', cls)}>{children}</span>;
}

// ---------------------------------------------------------------- charts (plain SVG, theme colours)

const C = {
  depth: 'var(--color-text-subtle)', speed: 'var(--color-chart-1)', tension: 'var(--color-chart-2)', rih: 'var(--color-chart-1)', pooh: 'var(--color-chart-3)',
  danger: 'var(--color-danger)', warning: 'var(--color-warning)', grid: 'var(--color-border)', text: 'var(--color-text-muted)',
};
const ZONE_FILL = ['transparent', 'var(--color-chart-1)', 'var(--color-chart-3)', 'var(--color-chart-6)'];

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Round tick values between lo and hi, about n of them. */
function ticks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || 1, raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
const TIME_STEPS = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600];

/** A path through the samples in [i0, i1], keeping each pixel column's lowest and highest value so peaks survive. */
function linePath(S: Sample[], i0: number, i1: number, x: (t: number) => number, y: (v: number) => number, val: (s: Sample) => number, cols: number) {
  const n = i1 - i0 + 1, per = Math.max(1, Math.floor(n / cols));
  let d = '';
  for (let b = i0; b <= i1; b += per) {
    const e = Math.min(i1, b + per - 1);
    let lo = b, hi = b;
    for (let i = b; i <= e; i++) { if (val(S[i]) < val(S[lo])) lo = i; if (val(S[i]) > val(S[hi])) hi = i; }
    for (const i of lo < hi ? [lo, hi] : lo === hi ? [lo] : [hi, lo]) d += `${d ? 'L' : 'M'}${x(S[i].t).toFixed(1)},${y(val(S[i])).toFixed(1)}`;
  }
  return d;
}

const lowerBound = (S: Sample[], t: number) => { let lo = 0, hi = S.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (S[m].t < t) lo = m + 1; else hi = m; } return lo; };

function TimeChart({ a }: { a: Analysis }) {
  const { S, sv, viol, advice, kpi } = a;
  const [ref, W] = useWidth();
  const narrow = W < 560;
  const H = narrow ? 300 : 400, M = { l: narrow ? 44 : 56, r: narrow ? 84 : 110, t: 10, b: 28 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const full: [number, number] = [S[0].t, S[S.length - 1].t];
  const [range, setRange] = useState<[number, number]>(full);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const zoomed = range[0] !== full[0] || range[1] !== full[1];
  const [t0, t1] = range;
  const x = (t: number) => M.l + ((t - t0) / (t1 - t0 || 1)) * pw;
  const tAt = (px: number) => t0 + ((px - M.l) / pw) * (t1 - t0);
  const dMax = Math.max(sv.td, kpi.maxD) * 1.02, sMax = Math.max(100, ...S.map((s) => s.sp)) * 1.1, tMax = kpi.maxT * 1.1;
  const yD = (v: number) => M.t + ph - (v / dMax) * ph, yS = (v: number) => M.t + ph - (v / sMax) * ph, yT = (v: number) => M.t + ph - (v / tMax) * ph;
  const i0 = Math.max(0, lowerBound(S, t0) - 1), i1 = Math.min(S.length - 1, lowerBound(S, t1));
  const cols = Math.max(50, Math.round(pw));
  const paths = useMemo(() => ({
    depth: linePath(S, i0, i1, x, yD, (s) => s.depth, cols), speed: linePath(S, i0, i1, x, yS, (s) => s.sp, cols), ten: linePath(S, i0, i1, x, yT, (s) => s.ten, cols),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [S, i0, i1, t0, t1, W, H]);
  const step = TIME_STEPS.find((s) => (t1 - t0) / s <= (narrow ? 4 : 8)) ?? 21600;
  const tTicks: number[] = [];
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) tTicks.push(t);
  const localX = (e: RPointerEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * W; };
  const inPlot = (px: number) => Math.min(M.l + pw, Math.max(M.l, px));
  const hs = hover == null ? null : S[Math.min(S.length - 1, lowerBound(S, hover))];
  const clip = `${titleId}-clip`;

  return (
    <div ref={ref} className="relative">
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
        <Key color={C.depth}>Depth (ft)</Key><Key color={C.speed}>Speed (ft/min)</Key><Key color={C.tension}>Tension (lbs)</Key>
        <Key color={C.danger} band>Violation</Key><Key color={C.warning} band>Advice</Key>
        {zoomed && <Button size="sm" variant="ghost" onClick={() => setRange(full)}>Show the whole run</Button>}
      </div>
      <svg width={W} height={H} role="img" aria-labelledby={titleId} className="touch-pan-y select-none"
        onPointerDown={(e) => { const px = inPlot(localX(e)); setDrag([px, px]); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { const px = inPlot(localX(e)); setHover(tAt(px)); if (drag) setDrag([drag[0], px]); }}
        onPointerUp={() => { if (drag && Math.abs(drag[1] - drag[0]) > 8) { const [p, q] = [Math.min(...drag), Math.max(...drag)]; if (tAt(q) - tAt(p) > 30) setRange([tAt(p), tAt(q)]); } setDrag(null); }}
        onPointerLeave={() => { setHover(null); }} onDoubleClick={() => setRange(full)}>
        <title id={titleId}>{`Depth, line speed and tension against time, ${hm(t0)} to ${hm(t1)}. ${viol.length} violations marked.`}</title>
        <defs><clipPath id={clip}><rect x={M.l} y={M.t} width={pw} height={ph} /></clipPath></defs>
        {[[sv.kop, sv.p30, 1], [sv.p30, sv.lat, 2], [sv.lat, dMax, 3]].map(([lo, hi, z]) => (
          <rect key={z} x={M.l} width={pw} y={yD(hi)} height={Math.max(0, yD(lo) - yD(hi))} fill={ZONE_FILL[z]} opacity={0.1} />
        ))}
        <g clipPath={`url(#${clip})`}>
          {viol.map((v, i) => <rect key={`v${i}`} x={x(v.t0)} width={Math.max(1.5, x(v.t1) - x(v.t0))} y={M.t} height={ph} fill={C.danger} opacity={0.22} />)}
          {advice.map((v, i) => <rect key={`a${i}`} x={x(v.t0)} width={Math.max(1.5, x(v.t1) - x(v.t0))} y={M.t} height={ph} fill={C.warning} opacity={0.22} />)}
        </g>
        {ticks(0, dMax).map((v) => <g key={v}><line x1={M.l} x2={M.l + pw} y1={yD(v)} y2={yD(v)} stroke={C.grid} strokeWidth={0.5} />
          <text x={M.l - 4} y={yD(v)} dy="0.32em" textAnchor="end" fontSize={10} fill={C.text}>{fmt(v)}</text></g>)}
        {ticks(0, sMax, 4).map((v) => <text key={`s${v}`} x={M.l + pw + 4} y={yS(v)} dy="0.32em" fontSize={10} fill={C.speed}>{fmt(v)}</text>)}
        {ticks(0, tMax, 4).map((v) => <text key={`t${v}`} x={M.l + pw + (narrow ? 40 : 52)} y={yT(v)} dy="0.32em" fontSize={10} fill={C.tension}>{fmt(v)}</text>)}
        {tTicks.map((t) => <text key={t} x={x(t)} y={H - 10} textAnchor="middle" fontSize={10} fill={C.text}>{hm(t)}</text>)}
        {([['KOP', sv.kop], ['30°', sv.p30], ['Lateral', sv.lat]] as const).map(([n, d]) => (
          <text key={n} x={M.l + 4} y={yD(d) - 3} fontSize={10} fill={C.text}>{n} {fmt(d)}</text>
        ))}
        <g clipPath={`url(#${clip})`} fill="none" strokeLinejoin="round">
          <path d={paths.depth} stroke={C.depth} strokeWidth={1.6} />
          <path d={paths.speed} stroke={C.speed} strokeWidth={1} />
          <path d={paths.ten} stroke={C.tension} strokeWidth={1} />
        </g>
        <rect x={M.l} y={M.t} width={pw} height={ph} fill="none" stroke={C.grid} />
        {drag && <rect x={Math.min(...drag)} width={Math.abs(drag[1] - drag[0])} y={M.t} height={ph} fill="var(--color-focus)" opacity={0.15} />}
        {hs && <line x1={x(hs.t)} x2={x(hs.t)} y1={M.t} y2={M.t + ph} stroke="var(--color-text)" strokeWidth={0.75} strokeDasharray="3 3" />}
      </svg>
      {hs && (
        <div aria-hidden className="pointer-events-none absolute top-8 rounded-sm border border-border bg-surface px-2 py-1 font-mono text-[0.6875rem] shadow-card"
          style={x(hs.t) > W / 2 ? { right: W - x(hs.t) + 8 } : { left: x(hs.t) + 8 }}>
          <div className="font-semibold">{hms(hs.t)} · {hs.dir}</div>
          <div>{fmt(hs.depth)} ft</div><div style={{ color: C.speed }}>{fmt(hs.sp)} fpm</div><div style={{ color: C.tension }}>{fmt(hs.ten)} lbs</div>
        </div>
      )}
    </div>
  );
}

function Key({ color, band, children }: { color: string; band?: boolean; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5"><span aria-hidden className={band ? 'h-2.5 w-3 opacity-40' : 'h-0.5 w-4'} style={{ background: color }} />{children}</span>;
}

/** Two panels against depth (down the page): line speed and tension, trip in and trip out, with the limit lines. */
function DepthCharts({ a }: { a: Analysis }) {
  const [ref, W] = useWidth();
  const L = useMemo(() => limitCurves(a), [a]);
  const two = W >= 560;
  const pw = two ? Math.floor((W - 12) / 2) : W;
  const rih = a.S.filter((s) => s.phase === 'RIH' && s.dir === 'RIH'), pooh = a.S.filter((s) => s.dir === 'POOH');
  return (
    <div ref={ref}>
      <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        <Key color={C.rih}>RIH</Key><Key color={C.pooh}>POOH</Key><Key color={C.danger}>POOH limit</Key><Key color={C.rih}>RIH limit</Key>
        {L.pumpBand && <Key color={C.warning}>Advised pump-down tension</Key>}
      </div>
      <div className={cx('grid gap-3', two && 'grid-cols-2')}>
        <DepthPanel W={pw} a={a} title="Speed (ft/min)" rih={rih} pooh={pooh} val={(s) => s.sp}
          limits={[{ v: L.poohSpeed, color: C.danger }, { v: L.rihSpeed, color: C.rih }]} D={L.D} />
        <DepthPanel W={pw} a={a} title="Tension (lbs)" rih={rih} pooh={pooh} val={(s) => s.ten} D={L.D}
          limits={[{ v: L.poohTension, color: C.danger }, { v: L.rihTensionMin, color: C.rih, dot: true },
            ...(L.pumpBand ? [{ v: L.D.map((d) => (d >= L.pumpBand!.from ? L.pumpBand!.lo : null)), color: C.warning }, { v: L.D.map((d) => (d >= L.pumpBand!.from ? L.pumpBand!.hi : null)), color: C.warning }] : [])]} />
      </div>
    </div>
  );
}

function DepthPanel({ W, a, title, rih, pooh, val, limits, D }: {
  W: number; a: Analysis; title: string; rih: Sample[]; pooh: Sample[]; val: (s: Sample) => number; D: number[];
  limits: { v: (number | null)[]; color: string; dot?: boolean }[];
}) {
  const { sv, kpi } = a;
  const H = 420, M = { l: 52, r: 10, t: 8, b: 32 }, pw = W - M.l - M.r, ph = H - M.t - M.b;
  const titleId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const dMax = Math.max(sv.td, kpi.maxD) * 1.02;
  const vMax = Math.max(100, ...limits.flatMap((l) => l.v.filter((n): n is number => n != null)), ...rih.map(val), ...pooh.map(val)) * 1.05;
  const x = (v: number) => M.l + (v / vMax) * pw, y = (d: number) => M.t + (d / dMax) * ph;
  const path = (arr: Sample[]) => {
    const per = Math.max(1, Math.floor(arr.length / 1500));
    let d = '', last: Sample | null = null;
    for (let i = 0; i < arr.length; i += per) {
      const s = arr[i];
      // a jump in time (another pass) starts a new line instead of joining across
      d += `${!last || s.t - last.t > 30 * per ? 'M' : 'L'}${x(val(s)).toFixed(1)},${y(s.depth).toFixed(1)}`;
      last = s;
    }
    return d;
  };
  const limPath = (v: (number | null)[]) => {
    let d = '', open = false;
    v.forEach((n, i) => { if (n == null) { open = false; return; } d += `${open ? 'L' : 'M'}${x(n).toFixed(1)},${y(D[i]).toFixed(1)}`; open = true; });
    return d;
  };
  const near = (arr: Sample[], depth: number) => arr.reduce<Sample | null>((b, s) => (!b || Math.abs(s.depth - depth) < Math.abs(b.depth - depth) ? s : b), null);
  const hr = hover == null ? null : near(rih, hover), hp = hover == null ? null : near(pooh, hover);
  const p = useMemo(() => ({ rih: path(rih), pooh: path(pooh) }), // eslint-disable-next-line react-hooks/exhaustive-deps
    [rih, pooh, W, vMax]);
  return (
    <div className="relative">
      <svg width={W} height={H} role="img" aria-labelledby={titleId} className="touch-pan-y select-none"
        onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const py = ((e.clientY - r.top) / r.height) * H; setHover(Math.min(dMax, Math.max(0, ((py - M.t) / ph) * dMax))); }}
        onPointerLeave={() => setHover(null)}>
        <title id={titleId}>{`${title} against depth, trip in and trip out, with the guideline limits.`}</title>
        {[[sv.kop, sv.p30, 1], [sv.p30, sv.lat, 2], [sv.lat, dMax, 3]].map(([lo, hi, z]) => (
          <rect key={z} x={M.l} width={pw} y={y(lo)} height={Math.max(0, y(hi) - y(lo))} fill={ZONE_FILL[z]} opacity={0.1} />
        ))}
        {ticks(0, dMax).map((v) => <g key={v}><line x1={M.l} x2={M.l + pw} y1={y(v)} y2={y(v)} stroke={C.grid} strokeWidth={0.5} />
          <text x={M.l - 4} y={y(v)} dy="0.32em" textAnchor="end" fontSize={10} fill={C.text}>{fmt(v)}</text></g>)}
        {ticks(0, vMax, W < 360 ? 3 : 5).map((v) => <g key={`x${v}`}><line x1={x(v)} x2={x(v)} y1={M.t} y2={M.t + ph} stroke={C.grid} strokeWidth={0.5} />
          <text x={x(v)} y={M.t + ph + 12} textAnchor="middle" fontSize={10} fill={C.text}>{fmt(v)}</text></g>)}
        <text x={M.l + pw / 2} y={H - 4} textAnchor="middle" fontSize={11} fill={C.text}>{title}</text>
        <g fill="none" strokeLinejoin="round">
          <path d={p.rih} stroke={C.rih} strokeWidth={1} />
          <path d={p.pooh} stroke={C.pooh} strokeWidth={1} />
          {limits.map((l, i) => <path key={i} d={limPath(l.v)} stroke={l.color} strokeWidth={1.2} strokeDasharray={l.dot ? '2 3' : '6 4'} />)}
        </g>
        <rect x={M.l} y={M.t} width={pw} height={ph} fill="none" stroke={C.grid} />
        {hover != null && <line x1={M.l} x2={M.l + pw} y1={y(hover)} y2={y(hover)} stroke="var(--color-text)" strokeWidth={0.75} strokeDasharray="3 3" />}
      </svg>
      {hover != null && (
        <div aria-hidden className="pointer-events-none absolute right-3 rounded-sm border border-border bg-surface px-2 py-1 font-mono text-[0.6875rem] shadow-card"
          style={{ top: Math.min(H - 70, y(hover) + 6) }}>
          <div className="font-semibold">{fmt(hover)} ft</div>
          {hr && <div style={{ color: C.rih }}>RIH {fmt(val(hr))}</div>}
          {hp && <div style={{ color: C.pooh }}>POOH {fmt(val(hp))}</div>}
        </div>
      )}
    </div>
  );
}

export default WinchDataCard;
