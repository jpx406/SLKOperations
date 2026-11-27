import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileDown, Pencil, Printer, Save } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { dur, findingsCsv, fmt, hm, hms, limitCurves, median, type Analysis, type Sample } from '../../../shared/winchData';
import { SOP_LABEL, SOP_SOURCE, sopCsv, type Jarring, type Restriction, type Run, type SopFinding, type SopRuleKey, type SopRules } from '../../../shared/winchRuns';
import { BRAIDED_CHECKS, BRAIDED_LABEL, LINE_LABEL, braidedText, staticAt, type LineKind } from '../../../shared/winchGuide';
import { saveFile } from '../../components/charts';
import { scorecard, type ScoreRow } from '../../../shared/winchScore';
import { buildReportPdf, saveReport } from './reportPdf';
import { JAR_RULES, SPEED_RULES, sopTexts } from './ruleRows';
import { Button, cx, inputSized } from '../../components/ui';

// The winch report (6z.26), moved here in 6z.41 so the run tabs and the analysis window share it. 6z.41 adds a tab per
// run (a recording can hold a whole job), the SOP-04 speed and jarring checks, and a plot of any recorded channel.
// 6z.42: wire runs are checked against the Speed Guidelines for their service (the default speeds are flagged) and the
// tension against static; braided-line runs against the seasoning rules (new or seasoned line) with no horizontal rules.

/** The job details on the report (6z.44: from the job, not typed). */
export type Meta = { drss: string; field: string; well: string; unit: string; cable: string; date: string; by: string; crew?: string; client?: string };
/**
 * One run: the trip analysis (with the seasoning findings on braided line), the speed and tension findings, the
 * jarring, the rules it was checked with and, on wire, its service and the static tension against depth.
 */
export interface RunReport {
  run: Run; a: Analysis; speed: SopFinding[]; jar: Jarring; sop: SopRules;
  service: string; group: string | null; isDefault: boolean;
  stat: { step: number; v: (number | null)[] } | null;
}
/** A recorded channel against time, for the channel plot. */
export interface ChannelSeries { name: string; unit: string; t: number[]; v: number[] }
/** Everything the report needs: sent as is to the analysis window. */
export interface WinchPayload {
  meta: Meta; fileName: string; reports: RunReport[]; channels: ChannelSeries[]; restrictions: Restriction[]; source: string;
  kind: LineKind;
  /** Braided line: seasoned (true) or new line (false). */
  seasoned: boolean;
  /** The services a wire run can be set to. */
  services: string[];
  /** The run shown first. */
  pick?: number;
  /** The job the report belongs to, for saving the PDF to its attachments, and who is signed in (6z.43). */
  jobId?: string; by?: string;
  /** Where Print and Save keep the PDF (an API path taking ?category=&note=), and the list to refresh (6z.47). */
  reportUpload?: string; reportsKey?: unknown[];
  /** The files the runs came from, with their time spans, for the printout. */
  files?: { name: string; t0: number; t1: number }[];
}

const small = 'h-(--layout-control-sm) text-sm';
type View = 'time' | 'depth' | 'findings' | 'sop' | 'channels';

const runLabel = (r: Run) => `Run ${r.n}`;
// runs from joined files can fall on different days: then each start shows its date (6z.42)
const dayOf = (t: number) => Math.floor(t / 86400);
const dayText = (t: number) => new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const runTime = (r: Run, days: boolean) => `${days ? `${dayText(r.t0)} ` : ''}${hm(r.t0)}–${dayOf(r.t1) !== dayOf(r.t0) ? `${dayText(r.t1)} ` : ''}${hm(r.t1)}`;
const runSpan = (r: RunReport, days: boolean) => `${fmt(r.run.maxD)} ft · ${runTime(r.run, days)}`;
const flagsOf = (r: RunReport) => r.a.viol.length + r.speed.length + r.jar.findings.length;
export const seasonLabel = (seasoned: boolean) => (seasoned ? 'Seasoned line' : 'New line (seasoning)');

/** The whole report: a tab per run, each with the same views. */
export function RunsView({ p, wide, onEdit, onWindow, onSeason, onService }: {
  p: WinchPayload; wide?: boolean; onEdit?: () => void; onWindow?: (pick: number) => void;
  onSeason?: (seasoned: boolean) => void; onService?: (run: number, service: string) => void;
}) {
  const [pick, setPick] = useState(() => Math.min(p.pick ?? 0, Math.max(0, p.reports.length - 1)));
  const [view, setView] = useState<View>('time');
  const qc = useQueryClient();
  const [busy, setBusy] = useState<'print' | 'save' | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const { meta, reports } = p;
  // Print and Save make the PDF and keep it with the job's attachments, named with the time (6z.43)
  const report = async (mode: 'print' | 'save') => {
    setBusy(mode); setNote(null);
    const by = p.by || meta.by || '';
    let bytes: Uint8Array | null = null;
    try {
      const r = await saveReport(p, by, mode);
      bytes = r.bytes;
      setNote({ ok: true, text: `Saved to the ${p.jobId ? "job's attachments" : 'project'} as “${r.saved.name}”.` });
      qc.invalidateQueries({ queryKey: p.reportsKey ?? ['attachments', 'job', p.jobId] });
    } catch (e) {
      setNote({ ok: false, text: `Not saved to the attachments: ${(e as Error).message}` });
      if (mode === 'print') bytes = await buildReportPdf(p, new Date(), by, mode).catch(() => null);
    }
    if (mode === 'print' && bytes) printPdf(bytes);
    setBusy(null);
  };
  const r = reports[Math.min(pick, reports.length - 1)];
  const days = new Set(reports.flatMap((x) => [dayOf(x.run.t0), dayOf(x.run.t1)])).size > 1;
  const date = meta.date ? new Date(`${meta.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
  const sub = [meta.drss && `DRSS ${meta.drss}`, date && `job date ${date}`, `${reports.length} run${reports.length === 1 ? '' : 's'} found`, LINE_LABEL[p.kind] + (p.kind === 'braided' ? `, ${seasonLabel(p.seasoned).toLowerCase()}` : ''), meta.cable && `line ${meta.cable}`, p.fileName, meta.by && `checked by ${meta.by}`].filter(Boolean).join(' · ');
  const csv = () => {
    const guide = reports.map((x) => findingsCsv(x.a).split('\n').map((l, i) => (i === 0 ? `Run,${l}` : `${x.run.n},${l}`))).flatMap((rows, i) => (i === 0 ? rows : rows.slice(1))).join('\n');
    const sop = sopCsv(reports.map((x) => ({ n: x.run.n, findings: [...x.speed, ...x.jar.findings] })), hms);
    const services = p.kind === 'wire' ? `Run,Service,Speed row\n${reports.map((x) => `${x.run.n},"${x.service || 'not set'}","${x.group ?? 'not listed: default speeds used'}"`).join('\n')}\n\n` : '';
    saveFile(`winch-findings${meta.well ? `-w${meta.well}` : ''}.csv`, `${services}${p.kind === 'braided' ? `Seasoning rules\n${guide}\n\n` : ''}Speed, tension and jarring\n${sop}`, 'text/csv');
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-bold">Well {meta.well || '—'} · {meta.field || 'field not set'} · {meta.unit || '—'}</h3>
          <p className="text-xs break-words text-text-muted">{sub}{p.source && ` · ${p.source}`}</p>
        </div>
        <div className="flex flex-wrap gap-1 print:hidden">
          {onEdit && <Button size="sm" variant="ghost" onClick={onEdit}><Pencil aria-hidden className="size-3.5" />Change inputs</Button>}
          {onWindow && <Button size="sm" variant="ghost" onClick={() => onWindow(pick)}><ExternalLink aria-hidden className="size-3.5" />Open in a new window</Button>}
          <Button size="sm" variant="ghost" onClick={csv}><FileDown aria-hidden className="size-3.5" />Findings CSV</Button>
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => report('save')}><Save aria-hidden className="size-3.5" />{busy === 'save' ? 'Saving…' : 'Save report'}</Button>
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => report('print')}><Printer aria-hidden className="size-3.5" />{busy === 'print' ? 'Making the PDF…' : 'Print'}</Button>
        </div>
      </div>

      {note && <p role="status" className={cx('text-xs', note.ok ? 'text-success' : 'text-danger')}>{note.text}</p>}

      <ScorecardView p={p} days={days} pick={pick} onPick={setPick} />

      {reports.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
          <label htmlFor="wd-run-pick" className="font-semibold">Run</label>
          <select id="wd-run-pick" className={inputSized(`w-auto max-w-full ${small}`)} value={pick} onChange={(e) => setPick(Number(e.target.value))}>
            {reports.map((x, i) => <option key={x.run.n} value={i}>{runLabel(x.run)} · {runSpan(x, days)}{flagsOf(x) ? ` · ${flagsOf(x)} flags` : ''}</option>)}
          </select>
          <Button size="sm" variant="ghost" disabled={pick === 0} onClick={() => setPick(pick - 1)}>Previous</Button>
          <Button size="sm" variant="ghost" disabled={pick >= reports.length - 1} onClick={() => setPick(pick + 1)}>Next</Button>
        </div>
      )}

      <div role="tablist" aria-label="Runs" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border print:hidden">
        {reports.map((x, i) => (
          <button key={x.run.n} type="button" role="tab" aria-selected={i === pick} onClick={() => setPick(i)}
            className={cx('-mb-px shrink-0 rounded-t-sm border border-b-0 px-3 py-1.5 text-left text-sm', i === pick ? 'border-border bg-surface font-semibold' : 'border-transparent text-text-muted hover:text-text')}>
            {runLabel(x.run)} {flagsOf(x) > 0 && <Pill tone="danger">{flagsOf(x)}</Pill>}{p.kind === 'wire' && x.isDefault && <span className="ml-1"><Pill tone="warning">default</Pill></span>}
            <span className="block text-xs font-normal text-text-subtle">{runSpan(x, days)}</span>
          </button>
        ))}
      </div>

      <RunPanel key={r.run.n} r={r} p={p} view={view} setView={setView} wide={wide} onSeason={onSeason} onService={onService && ((sv) => onService(pick, sv))} />
    </div>
  );
}

/** Opens the browser's print dialog on the PDF, or the PDF itself when printing from the page is not allowed. */
function printPdf(bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  f.src = url;
  f.onload = () => {
    try { f.contentWindow?.focus(); f.contentWindow?.print(); } catch { window.open(url, '_blank'); }
    setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 120_000);
  };
  document.body.appendChild(f);
}

/** The scorecard (6z.43): the job's totals, a row per run and the flags by rule. */
function ScorecardView({ p, days, pick, onPick }: { p: WinchPayload; days: boolean; pick: number; onPick: (i: number) => void }) {
  const sc = useMemo(() => scorecard(p.reports), [p.reports]);
  const t = sc.total;
  const tiles: [string, string, boolean][] = [
    [String(t.total), 'Flags in all', t.total > 0], [String(t.speedFlags), 'Speed flags', t.speedFlags > 0], [String(t.tensionFlags), 'Tension flags', t.tensionFlags > 0],
    [String(t.jarFlags), 'Jarring flags', t.jarFlags > 0], [String(t.jarCycles), 'Jarring cycles', false], [`${fmt(t.keptPct, 1)}%`, 'Moving time inside the limits', t.keptPct < 100],
  ];
  const num = (v: number, bad = false) => <td className={cx(td, 'px-2 text-right font-mono', bad && 'font-bold text-danger')}>{fmt(v)}</td>;
  const rowCells = (r: ScoreRow) => <>
    <td className={cx(td, 'px-2 text-right font-mono')}>{fmt(r.maxD)}</td>
    {num(r.maxRih)}{num(r.maxPooh)}{num(r.maxT)}
    {num(r.speedFlags, r.speedFlags > 0)}{num(r.tensionFlags, r.tensionFlags > 0)}{num(r.jarCycles)}{num(r.jarFlags, r.jarFlags > 0)}{num(r.total, r.total > 0)}
    <td className={cx(td, 'px-2 text-right font-mono', r.keptPct < 100 && 'text-danger')}>{fmt(r.keptPct, 1)}%</td>
  </>;
  return (
    <section aria-labelledby="wd-score" className="space-y-2">
      <h4 id="wd-score" className="text-sm font-semibold">Scorecard</h4>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([v, l, bad]) => (
          <div key={l} className="rounded-md border border-border bg-surface-2 px-3 py-2">
            <dd className={cx('font-display text-lg leading-tight font-bold', bad ? 'text-danger' : 'text-success')}>{v}</dd>
            <dt className="text-xs text-text-muted">{l}</dt>
          </div>
        ))}
      </dl>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[46rem] text-xs">
          <caption className="sr-only">Scorecard by run</caption>
          <thead><tr>{['Run', p.kind === 'wire' ? 'Service' : 'Line', 'Max depth', 'Top RIH', 'Top POOH', 'Top tension', 'Speed', 'Tension', 'Jar cycles', 'Jar flags', 'Total', 'Kept'].map((h, i) => (
            <th key={h} scope="col" className={cx(th, 'px-2', i > 1 && 'text-right')}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {sc.rows.map((r, i) => (
              <tr key={r.label} tabIndex={0} aria-current={i === pick || undefined} className={cx('cursor-pointer border-t border-border hover:bg-surface-2', i === pick && 'bg-surface-2')} onClick={() => onPick(i)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(i); } }}>
                <td className={cx(td, 'px-2 font-semibold')}>{r.label}<span className="block font-normal text-text-subtle">{runTime(p.reports[i].run, days)}</span></td>
                <td className={cx(td, 'px-2')}>{p.kind === 'wire' ? <>{r.service || 'Not set'}{r.defaultSpeeds && <span className="ml-1"><Pill tone="warning">default speeds</Pill></span>}</> : seasonLabel(p.seasoned)}</td>
                {rowCells(r)}
              </tr>
            ))}
            <tr className="border-t-2 border-border-strong font-semibold"><td className={cx(td, 'px-2')}>Job</td><td className={cx(td, 'px-2 text-text-muted')}>{sc.rows.length} run{sc.rows.length === 1 ? '' : 's'} · {fmt(t.hours, 1)} h</td>{rowCells(t)}</tr>
          </tbody>
        </table>
      </div>
      {sc.byRule.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold">Flags by rule ({sc.byRule.length})</summary>
          <ul className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
            {sc.byRule.map((r) => <li key={`${r.label}${r.source}`} className="flex justify-between gap-2 border-b border-border py-0.5"><span>{r.label} <span className="text-text-subtle">{r.source}</span></span><span className="font-mono font-bold text-danger">{r.count}</span></li>)}
          </ul>
        </details>
      )}
      <p className="text-xs text-text-subtle">Speed and tension flags count each stretch over a limit; jarring flags each jarring rule broken. Kept: the share of moving time with no speed or tension flag open.</p>
    </section>
  );
}

/** One run's report: tiles, then the time, depth, rules and channel views. */
function RunPanel({ r, p, view, setView, wide, onSeason, onService }: {
  r: RunReport; p: WinchPayload; view: View; setView: (v: View) => void; wide?: boolean;
  onSeason?: (seasoned: boolean) => void; onService?: (service: string) => void;
}) {
  const { a } = r;
  const { kpi } = a;
  const wire = p.kind === 'wire';
  const sopN = r.speed.length + r.jar.findings.length;
  const tiles: [string, string, boolean?][] = [
    [`${fmt(kpi.maxD)} ft`, 'Max depth'], [dur(kpi.rihSec), 'RIH, surface to bottom'], [dur(kpi.bottomSec), 'At bottom'], [dur(kpi.poohSec), 'POOH to surface'],
    [`${fmt(kpi.avgRih)} fpm`, 'Avg RIH speed'], [`${fmt(kpi.avgPooh)} fpm`, 'Avg POOH speed'], [`${fmt(kpi.maxT)} lbs`, 'Max tension'],
    wire ? [`${fmt(r.sop.maxRih)} / ${fmt(r.sop.maxPooh)}`, 'RIH / POOH limit, fpm', r.isDefault] : [String(kpi.nViol), 'Seasoning rule flags', kpi.nViol > 0],
    [String(r.jar.cycles.length), 'Jarring cycles'], [String(sopN), wire ? 'Speed, tension, jarring flags' : 'Restriction and jarring flags', sopN > 0],
  ];
  const marks = [...r.jar.cycles.map((c) => ({ t0: c.t0, t1: c.t1, kind: 'jar' as const })), ...r.speed.map((f) => ({ t0: f.t0, t1: f.t1, kind: 'sop' as const }))];
  const tabs: [View, string][] = [['time', 'Time view'], ['depth', 'Depth view']];
  if (!wire) tabs.push(['findings', `Seasoning rules (${kpi.nViol})`]);
  tabs.push(['sop', `${wire ? 'Speed, tension and jarring' : 'Restrictions and jarring'} (${sopN})`]);
  if (p.channels.length) tabs.push(['channels', 'Channels']);
  const v = !wire && view === 'findings' ? view : wire && view === 'findings' ? 'sop' : view;
  const options = [...new Set([...p.services, r.service].filter(Boolean))];
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map(([val, l, bad]) => (
          <div key={l} className="rounded-md border border-border bg-surface-2 px-3 py-2">
            <dd className={cx('font-display text-base leading-tight font-bold', bad ? (l.startsWith('RIH /') ? 'text-warning' : 'text-danger') : 'text-success')}>{val}</dd>
            <dt className="text-xs text-text-muted">{l}</dt>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {!wire && <span className={cx('rounded-pill px-2.5 py-0.5 font-semibold', kpi.nViol ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success')}>
          {kpi.nViol ? `${kpi.nViol} seasoning rule flag${kpi.nViol > 1 ? 's' : ''}` : 'Seasoning rules kept'}</span>}
        <span className={cx('rounded-pill px-2.5 py-0.5 font-semibold', sopN ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success')}>
          {sopN ? `${sopN} ${wire ? 'speed, tension or jarring' : 'restriction or jarring'} flag${sopN > 1 ? 's' : ''}` : 'Guidelines kept'}</span>
        {wire ? <>
          {onService ? <>
            <label htmlFor="wd-service" className="ml-1 text-text-muted">Service</label>
            <select id="wd-service" className={inputSized(`w-auto max-w-full ${small}`)} value={r.service} onChange={(e) => onService(e.target.value)}>
              <option value="">Not set</option>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </> : <span className="text-text-muted">Service: {r.service || 'not set'}</span>}
          {r.isDefault
            ? <span className="rounded-pill bg-warning-subtle px-2.5 py-0.5 font-semibold text-warning">Default speeds in use: {r.service ? `${r.service} is not in the Speed Guidelines` : 'no service set'}</span>
            : <span className="text-text-subtle">Speeds: {r.group}</span>}
        </> : onSeason ? <>
          <label htmlFor="wd-season" className="ml-1 text-text-muted">Line</label>
          <select id="wd-season" className={inputSized(`w-auto ${small}`)} value={p.seasoned ? 'seasoned' : 'new'} onChange={(e) => onSeason(e.target.value === 'seasoned')}>
            <option value="seasoned">{seasonLabel(true)}</option><option value="new">{seasonLabel(false)}</option>
          </select>
        </> : <span className="text-text-muted">Line: {seasonLabel(p.seasoned)}</span>}
      </div>

      <div role="tablist" aria-label="Views" className="flex flex-wrap gap-1 print:hidden">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={v === k} onClick={() => setView(k)}
            className={cx('h-(--layout-control-sm) rounded-sm border px-3 text-sm font-semibold', v === k ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>{l}</button>
        ))}
      </div>

      <div role="tabpanel">
        {v === 'time' && <>
          <TimeChart a={a} marks={marks} tall={wide} />
          <p className="mt-2 text-xs text-text-subtle">Red bands: a speed or tension guideline broken; purple: jarring. Point at the plot for the values; drag across to zoom in.</p>
        </>}
        {v === 'depth' && <>
          <DepthCharts a={a} wire={wire ? { r, restrictions: p.restrictions } : undefined} />
          <p className="mt-2 text-xs text-text-subtle">{wire
            ? 'Trip in (RIH) and trip out (POOH) against depth. Dashed lines: the speed limit for the service (slower near surface and at restrictions); on tension, the static tension (grey) with the running minimum (blue) and the pulling maximum (red). Speed in ft/min, tension in lbs.'
            : 'Trip in (RIH) and trip out (POOH) against depth. Dashed lines: the seasoning rule limit at that depth (red for POOH, blue for RIH). Speed in ft/min, tension in lbs.'}</p>
        </>}
        {v === 'findings' && <Findings a={a} seasoned={p.seasoned} />}
        {v === 'sop' && <SopPanel r={r} kind={p.kind} restrictions={p.restrictions} />}
        {v === 'channels' && <ChannelPlot channels={p.channels} t0={r.run.t0} t1={r.run.t1} tall={wide} />}
      </div>
    </div>
  );
}


/** The speed, tension and jarring rules: what each says, what broke it, and every jarring cycle. */
export function SopPanel({ r, kind, restrictions }: { r: RunReport; kind: LineKind; restrictions: Restriction[] }) {
  const sop = r.sop;
  const text = sopTexts(r, restrictions);
  const speedRules = kind === 'wire' ? SPEED_RULES : (['restrictionSpeed'] as SopRuleKey[]);
  const findings = [...r.speed, ...r.jar.findings].sort((x, y) => x.t0 - y.t0);
  const count = (k: SopRuleKey) => findings.filter((f) => f.rule === k).length;
  const ruleList = (keys: SopRuleKey[]) => (
    <ul className="divide-y divide-border">
      {keys.map((k) => {
        const n = count(k);
        const off = /^(Not checked|No restrictions)/.test(text[k]);
        return (
          <li key={k} className="grid grid-cols-[2.5rem_1fr] gap-2 py-1.5 sm:grid-cols-[2.5rem_14rem_1fr]">
            <span><Pill tone={n ? 'danger' : off ? 'warning' : 'success'}>{n ? `${n}×` : off ? '–' : '✓'}</Pill></span>
            <span className="font-semibold">{SOP_LABEL[k]} <span className="font-normal text-text-subtle">{SOP_SOURCE[k]}</span></span>
            <span className="col-start-2 text-text-muted sm:col-start-auto">{text[k]}</span>
          </li>
        );
      })}
    </ul>
  );
  return (
    <div className="space-y-5 text-xs">
      {r.isDefault && kind === 'wire' && (
        <p className="rounded-md border-l-3 border-warning bg-warning-subtle px-3 py-2 text-warning">
          Default speeds in use: {r.service ? `${r.service} is not in the Speed Guidelines` : 'no service is set for this run'}. Any service not listed needs its plan and speeds confirmed with the Service Manager and written in the JRA.
        </p>
      )}
      <section>
        <h4 className="mb-1 text-sm font-semibold">{kind === 'wire' ? 'Speed and tension (Speed Guidelines, NESR-8000-QAF-04-01)' : 'Restrictions (SOP-04 6.2)'}</h4>
        {ruleList(speedRules)}
        {kind === 'braided' && <p className="mt-1 text-text-subtle">On braided line the speeds and tensions come from the seasoning rules: see that tab.</p>}
      </section>
      <section>
        <h4 className="mb-1 text-sm font-semibold">Jarring (Jarring Guidelines, QAF-SLK-Jarring-01, and SOP-04 8.3)</h4>
        {ruleList(JAR_RULES)}
      </section>
      <section>
        <h4 className="mb-1 text-sm font-semibold">Flags ({findings.length})</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem]">
            <thead><tr>{['Time', 'Lasted', 'Depth (ft)', 'Rule', 'Worst', 'Note'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
            <tbody>{findings.length ? findings.map((f, i) => (
              <tr key={i} className="border-t border-border">
                <td className={cx(td, 'font-mono')}>{hms(f.t0)}</td><td className={td}>{dur(f.sec)}</td>
                <td className={cx(td, 'font-mono')}>{f.d0 === f.d1 ? fmt(f.d0) : `${fmt(f.d0)} – ${fmt(f.d1)}`}</td>
                <td className={td}>{f.label}<span className="block text-text-subtle">{f.source}</span></td>
                <td className={td}><b>{fmt(f.worst, f.unit === 'min' ? 1 : 0)} {f.unit}</b> vs {f.side} {fmt(f.limit, f.unit === 'min' ? 1 : 0)}</td>
                <td className={cx(td, 'text-text-muted')}>{f.note}</td>
              </tr>
            )) : <tr className="border-t border-border"><td colSpan={6} className={cx(td, 'text-text-subtle')}>Nothing broken on this run.</td></tr>}</tbody>
          </table>
        </div>
      </section>
      <section>
        <h4 className="mb-1 text-sm font-semibold">Jarring cycles ({r.jar.cycles.length})</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem]">
            <thead><tr>{['Cycle', 'From', 'To', 'Lasted', 'Depth (ft)', 'Jars up / down', 'Normal tension', 'Peak', 'Lowest', 'Rest before'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
            <tbody>{r.jar.cycles.length ? r.jar.cycles.map((c) => (
              <tr key={c.n} className="border-t border-border">
                <td className={td}>{c.n}</td><td className={cx(td, 'font-mono')}>{hms(c.t0)}</td><td className={cx(td, 'font-mono')}>{hms(c.t1)}</td>
                <td className={td}>{dur(c.t1 - c.t0)}</td><td className={cx(td, 'font-mono')}>{fmt(c.depth)}</td><td className={cx(td, 'font-mono')}>{c.up} / {c.down}</td>
                <td className={cx(td, 'font-mono')}>{fmt(c.normal)} lbs</td><td className={cx(td, 'font-mono')}>{fmt(c.peak)} lbs</td><td className={cx(td, 'font-mono')}>{fmt(c.low)} lbs</td>
                <td className={td}>{c.restBefore === null ? '—' : dur(c.restBefore)}</td>
              </tr>
            )) : <tr className="border-t border-border"><td colSpan={10} className={cx(td, 'text-text-subtle')}>No jarring found on this run.</td></tr>}</tbody>
          </table>
        </div>
        <p className="mt-1 text-text-subtle">
          Jarring is found from the tension while the tools stay within {sop.detect.stationaryFt} ft for {sop.detect.windowSec} s: a jar up is a peak at least {sop.detect.upMinLb} lbs
          or {sop.detect.upPct}% over the normal tension that releases within 5 s; a jar down is a drop of {sop.detect.downPct}% or more that recovers. Hits less than {sop.detect.gapSec} s
          apart are one cycle. The normal tension is the median tension while the tools are held there.
        </p>
      </section>
    </div>
  );
}

/** Any recorded channel against time over the run, one small plot each. */
export function ChannelPlot({ channels, t0, t1, tall }: { channels: ChannelSeries[]; t0: number; t1: number; tall?: boolean }) {
  const [on, setOn] = useState<string[]>(() => channels.slice(0, 3).map((c) => c.name));
  const [ref, W] = useWidth();
  const H = tall ? 180 : 130, M = { l: 56, r: 12, t: 8, b: 20 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const x = (t: number) => M.l + ((t - t0) / (t1 - t0 || 1)) * pw;
  return (
    <div ref={ref} className="space-y-3">
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <legend className="sr-only">Channels to plot</legend>
        {channels.map((c) => (
          <label key={c.name} className="flex items-center gap-1.5">
            <input type="checkbox" checked={on.includes(c.name)} onChange={(e) => setOn((s) => (e.target.checked ? [...s, c.name] : s.filter((n) => n !== c.name)))} />
            {c.name} <span className="text-text-subtle">({c.unit})</span>
          </label>
        ))}
      </fieldset>
      {channels.filter((c) => on.includes(c.name)).map((c) => {
        // the samples inside the run, thinned to about one point per pixel column (keeping each column's low and high)
        let i0 = 0; while (i0 < c.t.length && c.t[i0] < t0) i0++;
        let i1 = i0; while (i1 < c.t.length && c.t[i1] <= t1) i1++;
        const vals = c.v.slice(i0, i1).filter((v) => Number.isFinite(v));
        const lo = vals.length ? Math.min(...vals.slice(0, 50000)) : 0, hi = vals.length ? Math.max(...vals.slice(0, 50000)) : 1;
        const pad = (hi - lo) * 0.05 || 1;
        const y = (v: number) => M.t + ph - ((v - lo + pad) / (hi - lo + 2 * pad)) * ph;
        const per = Math.max(1, Math.floor((i1 - i0) / Math.max(50, pw)));
        let d = '';
        for (let b = i0; b < i1; b += per) {
          let a = b, z = b;
          for (let i = b; i < Math.min(i1, b + per); i++) { if (c.v[i] < c.v[a]) a = i; if (c.v[i] > c.v[z]) z = i; }
          for (const i of a < z ? [a, z] : [z, a]) if (Number.isFinite(c.v[i])) d += `${d ? 'L' : 'M'}${x(c.t[i]).toFixed(1)},${y(c.v[i]).toFixed(1)}`;
        }
        return (
          <figure key={c.name}>
            <figcaption className="text-xs font-semibold">{c.name} <span className="font-normal text-text-subtle">{c.unit} · {fmt(lo, 1)} – {fmt(hi, 1)}</span></figcaption>
            <svg width={W} height={H} role="img" aria-label={`${c.name} against time`}>
              {ticks(lo, hi, 3).map((v) => <g key={v}><line x1={M.l} x2={M.l + pw} y1={y(v)} y2={y(v)} stroke={C.grid} strokeWidth={0.5} />
                <text x={M.l - 4} y={y(v)} dy="0.32em" textAnchor="end" fontSize={10} fill={C.text}>{fmt(v, Math.abs(hi - lo) < 10 ? 1 : 0)}</text></g>)}
              <text x={M.l} y={H - 4} fontSize={10} fill={C.text}>{hm(t0)}</text>
              <text x={M.l + pw} y={H - 4} fontSize={10} textAnchor="end" fill={C.text}>{hm(t1)}</text>
              <path d={d} fill="none" stroke={C.tension} strokeWidth={1.2} />
            </svg>
          </figure>
        );
      })}
    </div>
  );
}

export const th = 'py-1.5 pr-3 text-left font-mono text-label font-semibold tracking-wide text-text-muted uppercase';
export const td = 'py-1.5 pr-3 align-top';

/** Braided line: the seasoning rules that apply in any well, what broke them, and the phases of the run. */
export function Findings({ a, seasoned }: { a: Analysis; seasoned: boolean }) {
  const { viol, R, ruleCounts, P, S } = a;
  const rows = viol.filter((v) => BRAIDED_CHECKS.includes(v.rule)).sort((x, y) => x.t0 - y.t0);
  return (
    <div className="space-y-5 text-xs">
      <section>
        <h4 className="mb-1 text-sm font-semibold">Seasoning rules: {seasonLabel(seasoned)}</h4>
        <ul className="divide-y divide-border">
          {BRAIDED_CHECKS.map((k) => {
            const n = ruleCounts[k];
            return (
              <li key={k} className="grid grid-cols-[2.5rem_1fr] gap-2 py-1.5 sm:grid-cols-[2.5rem_14rem_1fr]">
                <span><Pill tone={n ? 'danger' : 'success'}>{n ? `${n}×` : '✓'}</Pill></span>
                <span className="font-semibold">{BRAIDED_LABEL[k]}</span>
                <span className="col-start-2 text-text-muted sm:col-start-auto">{braidedText(R, k)}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h4 className="mb-1 text-sm font-semibold">Flags ({rows.length})</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem]">
            <thead><tr>{['Time', 'Lasted', 'Depth (ft)', 'Direction', 'Rule', 'Worst'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.length ? rows.map((v, i) => (
              <tr key={i} className="border-t border-border">
                <td className={cx(td, 'font-mono')}>{hms(v.t0)}</td><td className={td}>{dur(v.sec)}</td><td className={cx(td, 'font-mono')}>{fmt(v.d0)} – {fmt(v.d1)}</td>
                <td className={td}>{v.dir === 'STOP' ? v.phase : v.dir}</td><td className={td}>{BRAIDED_LABEL[v.rule] ?? v.label}</td>
                <td className={td}><b>{fmt(v.worst)} {v.unit}</b> vs {v.side} {fmt(v.limit)} ({v.worst >= v.limit ? '+' : '−'}{fmt(Math.abs(v.worst - v.limit))})</td>
              </tr>
            )) : <tr className="border-t border-border"><td colSpan={6} className={cx(td, 'text-text-subtle')}>No seasoning rule broken on this run.</td></tr>}</tbody>
          </table>
        </div>
        <p className="mt-1 text-text-subtle">{braidedText(R, 'detect')}.</p>
      </section>

      <section>
        <h4 className="mb-1 text-sm font-semibold">Phases</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem]">
            <thead><tr>{['Phase', 'From', 'To', 'Duration', 'Depth'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
            <tbody>{([['RIH, surface to bottom', S[P.iStart], S[P.iBottom], P.rihSec], ['At bottom', S[P.iBottom], S[P.iSteady], P.bottomSec], ['POOH to surface', S[P.iSteady], S[P.iEnd], P.poohSec]] as const).map(([l, x, y, sec]) => (
              <tr key={l} className="border-t border-border"><td className={td}>{l}</td><td className={cx(td, 'font-mono')}>{hms(x.t)}</td><td className={cx(td, 'font-mono')}>{hms(y.t)}</td><td className={td}>{dur(sec)}</td><td className={cx(td, 'font-mono')}>{fmt(x.depth)} → {fmt(y.depth)} ft</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mt-1 text-text-subtle">{S.length.toLocaleString()} rows · median {fmt(median(S.map((x) => x.dt)), 1)} s apart</p>
      </section>
    </div>
  );
}

export function Pill({ tone, children }: { tone: 'danger' | 'warning' | 'success'; children: ReactNode }) {
  const cls = { danger: 'bg-danger-subtle text-danger', warning: 'bg-warning-subtle text-warning', success: 'bg-success-subtle text-success' }[tone];
  return <span className={cx('inline-block min-w-6 rounded-pill px-1.5 text-center font-mono text-label font-bold', cls)}>{children}</span>;
}

// ---------------------------------------------------------------- charts (plain SVG, theme colours)

export const C = {
  depth: 'var(--color-text-subtle)', speed: 'var(--color-chart-1)', tension: 'var(--color-chart-2)', rih: 'var(--color-chart-1)', pooh: 'var(--color-chart-3)',
  danger: 'var(--color-danger)', warning: 'var(--color-warning)', grid: 'var(--color-border)', text: 'var(--color-text-muted)', jar: 'var(--color-chart-5)',
};

export function useWidth() {
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
export function ticks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || 1, raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
export const TIME_STEPS = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600];

/** A path through the samples in [i0, i1], keeping each pixel column's lowest and highest value so peaks survive. */
export function linePath(S: Sample[], i0: number, i1: number, x: (t: number) => number, y: (v: number) => number, val: (s: Sample) => number, cols: number) {
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

export const lowerBound = (S: Sample[], t: number) => { let lo = 0, hi = S.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (S[m].t < t) lo = m + 1; else hi = m; } return lo; };

/** marks (6z.41): jarring cycles and SOP-04 speed findings, shaded like the guideline findings; tall in the analysis window. */
export function TimeChart({ a, marks = [], tall }: { a: Analysis; marks?: { t0: number; t1: number; kind: 'jar' | 'sop' }[]; tall?: boolean }) {
  const { S, viol, advice, kpi } = a;
  const [ref, W] = useWidth();
  const narrow = W < 560;
  const H = narrow ? 300 : tall ? 560 : 400, M = { l: narrow ? 44 : 56, r: narrow ? 84 : 110, t: 10, b: 28 };
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
  const dMax = kpi.maxD * 1.02, sMax = Math.max(100, ...S.map((s) => s.sp)) * 1.1, tMax = kpi.maxT * 1.1;
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
{viol.length > 0 && <Key color={C.danger} band>Seasoning rule</Key>}
        {marks.some((m) => m.kind === 'jar') && <Key color={C.jar} band>Jarring</Key>}{marks.some((m) => m.kind === 'sop') && <Key color={C.danger} band>Speed or tension</Key>}
        {zoomed && <Button size="sm" variant="ghost" onClick={() => setRange(full)}>Show the whole run</Button>}
      </div>
      <svg width={W} height={H} role="img" aria-labelledby={titleId} className="touch-pan-y select-none"
        onPointerDown={(e) => { const px = inPlot(localX(e)); setDrag([px, px]); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { const px = inPlot(localX(e)); setHover(tAt(px)); if (drag) setDrag([drag[0], px]); }}
        onPointerUp={() => { if (drag && Math.abs(drag[1] - drag[0]) > 8) { const [p, q] = [Math.min(...drag), Math.max(...drag)]; if (tAt(q) - tAt(p) > 30) setRange([tAt(p), tAt(q)]); } setDrag(null); }}
        onPointerLeave={() => { setHover(null); }} onDoubleClick={() => setRange(full)}>
        <title id={titleId}>{`Depth, line speed and tension against time, ${hm(t0)} to ${hm(t1)}. ${viol.length} violations marked.`}</title>
        <defs><clipPath id={clip}><rect x={M.l} y={M.t} width={pw} height={ph} /></clipPath></defs>
        <g clipPath={`url(#${clip})`}>
          {viol.map((v, i) => <rect key={`v${i}`} x={x(v.t0)} width={Math.max(1.5, x(v.t1) - x(v.t0))} y={M.t} height={ph} fill={C.danger} opacity={0.22} />)}
          {marks.map((m, i) => <rect key={`m${i}`} x={x(m.t0)} width={Math.max(2, x(m.t1) - x(m.t0))} y={M.t} height={ph} fill={m.kind === 'jar' ? C.jar : C.danger} opacity={m.kind === 'jar' ? 0.25 : 0.18} />)}
          {advice.map((v, i) => <rect key={`a${i}`} x={x(v.t0)} width={Math.max(1.5, x(v.t1) - x(v.t0))} y={M.t} height={ph} fill={C.warning} opacity={0.22} />)}
        </g>
        {ticks(0, dMax).map((v) => <g key={v}><line x1={M.l} x2={M.l + pw} y1={yD(v)} y2={yD(v)} stroke={C.grid} strokeWidth={0.5} />
          <text x={M.l - 4} y={yD(v)} dy="0.32em" textAnchor="end" fontSize={10} fill={C.text}>{fmt(v)}</text></g>)}
        {ticks(0, sMax, 4).map((v) => <text key={`s${v}`} x={M.l + pw + 4} y={yS(v)} dy="0.32em" fontSize={10} fill={C.speed}>{fmt(v)}</text>)}
        {ticks(0, tMax, 4).map((v) => <text key={`t${v}`} x={M.l + pw + (narrow ? 40 : 52)} y={yT(v)} dy="0.32em" fontSize={10} fill={C.tension}>{fmt(v)}</text>)}
        {tTicks.map((t) => <text key={t} x={x(t)} y={H - 10} textAnchor="middle" fontSize={10} fill={C.text}>{hm(t)}</text>)}
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

export function Key({ color, band, children }: { color: string; band?: boolean; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5"><span aria-hidden className={band ? 'h-2.5 w-3 opacity-40' : 'h-0.5 w-4'} style={{ background: color }} />{children}</span>;
}

/** The limit lines on wire: the service speeds (slower near surface and at restrictions) and the static tension band. */
function wireCurves(r: RunReport, restrictions: Restriction[], D: number[]) {
  const s = r.sop;
  const speed = (lim: number) => D.map((d) => {
    let m = lim;
    if (s.surfaceDepth > 0 && d < s.surfaceDepth) m = Math.min(m, s.surfaceSpeed);
    if (s.restrictionBand > 0 && restrictions.some((x) => Math.abs(d - x.depth) <= s.restrictionBand)) m = Math.min(m, s.restrictionSpeed);
    return m;
  });
  const st = (k: number) => D.map((d) => { const v = r.stat ? staticAt(r.stat, d) : null; return v == null || d < Math.max(s.surfaceDepth, 100) ? null : v * k; });
  return { pooh: speed(s.maxPooh), rih: speed(s.maxRih), stat: st(1), rihMin: s.rihFactor ? st(s.rihFactor) : D.map(() => null), poohMax: s.poohFactor ? st(s.poohFactor) : D.map(() => null) };
}

/** Two panels against depth (down the page): line speed and tension, trip in and trip out, with the limit lines. */
export function DepthCharts({ a, wire }: { a: Analysis; wire?: { r: RunReport; restrictions: Restriction[] } }) {
  const [ref, W] = useWidth();
  const L = useMemo(() => limitCurves(a), [a]);
  const Wc = useMemo(() => (wire ? wireCurves(wire.r, wire.restrictions, L.D) : null), [wire, L.D]);
  const two = W >= 560;
  const pw = two ? Math.floor((W - 12) / 2) : W;
  const rih = a.S.filter((s) => s.phase === 'RIH' && s.dir === 'RIH'), pooh = a.S.filter((s) => s.dir === 'POOH');
  return (
    <div ref={ref}>
      <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        <Key color={C.rih}>RIH</Key><Key color={C.pooh}>POOH</Key><Key color={C.danger}>POOH limit</Key><Key color={C.rih}>RIH limit</Key>
        {Wc && <Key color={C.depth}>Static tension</Key>}
      </div>
      <div className={cx('grid gap-3', two && 'grid-cols-2')}>
        <DepthPanel W={pw} a={a} title="Speed (ft/min)" rih={rih} pooh={pooh} val={(s) => s.sp}
          limits={Wc ? [{ v: Wc.pooh, color: C.danger }, { v: Wc.rih, color: C.rih, dot: true }] : [{ v: L.poohSpeed, color: C.danger }, { v: L.rihSpeed, color: C.rih }]} D={L.D} />
        <DepthPanel W={pw} a={a} title="Tension (lbs)" rih={rih} pooh={pooh} val={(s) => s.ten} D={L.D}
          limits={Wc ? [{ v: Wc.stat, color: C.depth }, { v: Wc.poohMax, color: C.danger }, { v: Wc.rihMin, color: C.rih, dot: true }]
            : [{ v: L.poohTension, color: C.danger }, { v: L.rihTensionMin, color: C.rih, dot: true }]} />
      </div>
    </div>
  );
}

export function DepthPanel({ W, a, title, rih, pooh, val, limits, D }: {
  W: number; a: Analysis; title: string; rih: Sample[]; pooh: Sample[]; val: (s: Sample) => number; D: number[];
  limits: { v: (number | null)[]; color: string; dot?: boolean }[];
}) {
  const { kpi } = a;
  const H = 420, M = { l: 52, r: 10, t: 8, b: 32 }, pw = W - M.l - M.r, ph = H - M.t - M.b;
  const titleId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const dMax = kpi.maxD * 1.02;
  const vMax = Math.max(100, ...limits.flatMap((l) => l.v.filter((n): n is number => n != null)), ...rih.map(val), ...pooh.map(val)) * 1.05;
  const x = (v: number) => M.l + (v / vMax) * pw, y = (d: number) => M.t + (d / dMax) * ph;
  const path = (arr: Sample[]) => {
    const per = Math.max(1, Math.floor(arr.length / 1500));
    let d = '', last: Sample | null = null;
    for (let i = 0; i < arr.length; i += per) {
      const s = arr[i];
      // a jump in time or depth (another pass, or a stretch held for jarring) starts a new line instead of joining across
      d += `${!last || s.t - last.t > 5 * per || Math.abs(s.depth - last.depth) > 150 ? 'M' : 'L'}${x(val(s)).toFixed(1)},${y(s.depth).toFixed(1)}`;
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
        <title id={titleId}>{`${title} against depth, trip in and trip out, with the limits.`}</title>
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

