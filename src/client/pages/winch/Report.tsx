import { ExternalLink, FileDown, Pencil, Printer } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import {
  CHECK_KEYS, RULE_META, RULE_SET_LABEL, dur, findingsCsv, fmt, hm, hms, limitCurves, median, ruleText, whereText,
  type Analysis, type RuleSetKey, type Sample,
} from '../../../shared/winchData';
import { SOP_LABEL, SOP_SOURCE, jarUpLimit, sopCsv, type Jarring, type Restriction, type Run, type SopFinding, type SopRuleKey, type SopRules } from '../../../shared/winchRuns';
import { printOnly, saveFile } from '../../components/charts';
import { Button, cx, inputSized } from '../../components/ui';

// The winch report (6z.26), moved here in 6z.41 so the run tabs and the analysis window share it. 6z.41 adds a tab per
// run (a recording can hold a whole job), the SOP-04 speed and jarring checks, and a plot of any recorded channel.

export type Meta = { job: string; well: string; stage: string; unit: string; cable: string; date: string; by: string };
/** One run: the guidelines analysis, the SOP-04 speed findings and the jarring. */
export interface RunReport { run: Run; a: Analysis; speed: SopFinding[]; jar: Jarring }
/** A recorded channel against time, for the channel plot. */
export interface ChannelSeries { name: string; unit: string; t: number[]; v: number[] }
/** Everything the report needs: sent as is to the analysis window. */
export interface WinchPayload { meta: Meta; fileName: string; reports: RunReport[]; channels: ChannelSeries[]; restrictions: Restriction[]; sop: SopRules; source: string }

const small = 'h-(--layout-control-sm) text-sm';
type View = 'time' | 'depth' | 'findings' | 'sop' | 'channels';

const runLabel = (r: Run) => `Run ${r.n}`;
const runSpan = (r: RunReport) => `${fmt(r.run.maxD)} ft · ${hm(r.run.t0)}–${hm(r.run.t1)}`;
const flagsOf = (r: RunReport) => r.a.viol.length + r.speed.length + r.jar.findings.length;

/** The whole report: a tab per run, each with the same views. */
export function RunsView({ p, wide, onEdit, onWindow, onSet }: { p: WinchPayload; wide?: boolean; onEdit?: () => void; onWindow?: () => void; onSet?: (s: RuleSetKey) => void }) {
  const [pick, setPick] = useState(0);
  const [view, setView] = useState<View>('time');
  const box = useRef<HTMLDivElement>(null);
  const { meta, reports } = p;
  const r = reports[Math.min(pick, reports.length - 1)];
  const date = meta.date ? new Date(`${meta.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
  const sub = [meta.job, date, meta.cable && `cable ${meta.cable}`, p.fileName, meta.by && `checked by ${meta.by}`].filter(Boolean).join(' · ');
  const csv = () => {
    const guide = reports.map((x) => findingsCsv(x.a).split('\n').map((l, i) => (i === 0 ? `Run,${l}` : `${x.run.n},${l}`))).flatMap((rows, i) => (i === 0 ? rows : rows.slice(1))).join('\n');
    const sop = sopCsv(reports.map((x) => ({ n: x.run.n, findings: [...x.speed, ...x.jar.findings] })), hms);
    saveFile(`winch-findings${meta.well ? `-w${meta.well}` : ''}.csv`, `${guide}\n\nSOP-04 and jarring\n${sop}`, 'text/csv');
  };
  return (
    <div ref={box} className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-bold">Well {meta.well || '—'} · Stage {meta.stage || '—'} · {meta.unit || '—'}</h3>
          <p className="text-xs break-words text-text-muted">{sub}{p.source && ` · ${p.source}`}</p>
        </div>
        <div className="flex flex-wrap gap-1 print:hidden">
          {onEdit && <Button size="sm" variant="ghost" onClick={onEdit}><Pencil aria-hidden className="size-3.5" />Change inputs</Button>}
          {onWindow && <Button size="sm" variant="ghost" onClick={onWindow}><ExternalLink aria-hidden className="size-3.5" />Open in a new window</Button>}
          <Button size="sm" variant="ghost" onClick={csv}><FileDown aria-hidden className="size-3.5" />Findings CSV</Button>
          <Button size="sm" variant="ghost" onClick={() => printOnly(box.current)}><Printer aria-hidden className="size-3.5" />Print</Button>
        </div>
      </div>

      {reports.length > 1 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[34rem] text-xs">
            <caption className="sr-only">Runs in this recording</caption>
            <thead><tr>{['Run', 'Time', 'Max depth', 'Guidelines', 'SOP-04 speed', 'Jarring cycles', 'Jarring flags'].map((h) => <th key={h} scope="col" className={cx(th, 'px-3')}>{h}</th>)}</tr></thead>
            <tbody>{reports.map((x, i) => (
              <tr key={x.run.n} className={cx('cursor-pointer border-t border-border hover:bg-surface-2', i === pick && 'bg-surface-2')} onClick={() => setPick(i)}>
                <td className={cx(td, 'px-3 font-semibold')}>{runLabel(x.run)}{x.run.partial && <span className="ml-1 font-normal text-text-subtle">(partial)</span>}</td>
                <td className={cx(td, 'px-3 font-mono')}>{hm(x.run.t0)}–{hm(x.run.t1)}</td>
                <td className={cx(td, 'px-3 font-mono')}>{fmt(x.run.maxD)} ft</td>
                <td className={cx(td, 'px-3')}><Pill tone={x.a.viol.length ? 'danger' : 'success'}>{x.a.viol.length || '✓'}</Pill></td>
                <td className={cx(td, 'px-3')}><Pill tone={x.speed.length ? 'danger' : 'success'}>{x.speed.length || '✓'}</Pill></td>
                <td className={cx(td, 'px-3 font-mono')}>{x.jar.cycles.length || '—'}</td>
                <td className={cx(td, 'px-3')}><Pill tone={x.jar.findings.length ? 'danger' : 'success'}>{x.jar.findings.length || '✓'}</Pill></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div role="tablist" aria-label="Runs" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border print:hidden">
        {reports.map((x, i) => (
          <button key={x.run.n} type="button" role="tab" aria-selected={i === pick} onClick={() => setPick(i)}
            className={cx('-mb-px shrink-0 rounded-t-sm border border-b-0 px-3 py-1.5 text-left text-sm', i === pick ? 'border-border bg-surface font-semibold' : 'border-transparent text-text-muted hover:text-text')}>
            {runLabel(x.run)} {flagsOf(x) > 0 && <Pill tone="danger">{flagsOf(x)}</Pill>}
            <span className="block text-xs font-normal text-text-subtle">{runSpan(x)}</span>
          </button>
        ))}
      </div>

      <RunPanel key={r.run.n} r={r} p={p} view={view} setView={setView} wide={wide} onSet={onSet} />
    </div>
  );
}

/** One run's report: tiles, then the time, depth, findings, SOP-04 and channel views. */
function RunPanel({ r, p, view, setView, wide, onSet }: { r: RunReport; p: WinchPayload; view: View; setView: (v: View) => void; wide?: boolean; onSet?: (s: RuleSetKey) => void }) {
  const { a } = r;
  const { kpi } = a;
  const sopN = r.speed.length + r.jar.findings.length;
  const tiles: [string, string, boolean?][] = [
    [`${fmt(kpi.maxD)} ft`, 'Max depth'], [dur(kpi.rihSec), 'RIH, surface to bottom'], [dur(kpi.bottomSec), 'At bottom'], [dur(kpi.poohSec), 'POOH to surface'],
    [`${fmt(kpi.avgRih)} fpm`, 'Avg RIH speed'], [`${fmt(kpi.avgPooh)} fpm`, 'Avg POOH speed'], [`${fmt(kpi.maxT)} lbs`, 'Max tension'],
    [String(kpi.nViol), 'Guideline violations', kpi.nViol > 0], [String(r.jar.cycles.length), 'Jarring cycles'], [String(sopN), 'SOP-04 flags', sopN > 0],
  ];
  const marks = [...r.jar.cycles.map((c) => ({ t0: c.t0, t1: c.t1, kind: 'jar' as const })), ...r.speed.map((f) => ({ t0: f.t0, t1: f.t1, kind: 'sop' as const }))];
  const tabs: [View, string][] = [['time', 'Time view'], ['depth', 'Depth view'], ['findings', `Guidelines (${kpi.nViol})`], ['sop', `SOP-04 and jarring (${sopN})`]];
  if (p.channels.length) tabs.push(['channels', 'Channels']);
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map(([v, l, bad]) => (
          <div key={l} className="rounded-md border border-border bg-surface-2 px-3 py-2">
            <dd className={cx('font-display text-base leading-tight font-bold', bad ? 'text-danger' : 'text-success')}>{v}</dd>
            <dt className="text-xs text-text-muted">{l}</dt>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cx('rounded-pill px-2.5 py-0.5 font-semibold', kpi.nViol ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success')}>
          {kpi.nViol ? `${kpi.nViol} guideline violation${kpi.nViol > 1 ? 's' : ''}` : 'No guideline violations'}</span>
        <span className={cx('rounded-pill px-2.5 py-0.5 font-semibold', sopN ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success')}>
          {sopN ? `${sopN} SOP-04 flag${sopN > 1 ? 's' : ''}` : 'SOP-04 kept'}</span>
        {a.advice.length > 0 && <span className="rounded-pill bg-warning-subtle px-2.5 py-0.5 font-semibold text-warning">{a.advice.length} advisory</span>}
        {onSet ? <>
          <label htmlFor="wd-rset" className="ml-1 text-text-muted">Rules</label>
          <select id="wd-rset" className={inputSized(`w-auto ${small}`)} value={a.set} onChange={(e) => onSet(e.target.value as RuleSetKey)}>
            {(Object.keys(RULE_SET_LABEL) as RuleSetKey[]).map((k) => <option key={k} value={k}>{RULE_SET_LABEL[k]}</option>)}
          </select>
        </> : <span className="text-text-muted">Rules: {RULE_SET_LABEL[a.set]}</span>}
        <span className="text-text-subtle">{a.sv.source === 'manual' ? 'Zones entered by hand' : a.sv.source === 'vertical' ? 'Vertical well' : `Zones from ${a.sv.source}`}</span>
      </div>

      <div role="tablist" aria-label="Views" className="flex flex-wrap gap-1 print:hidden">
        {tabs.map(([v, l]) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={cx('h-(--layout-control-sm) rounded-sm border px-3 text-sm font-semibold', view === v ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>{l}</button>
        ))}
      </div>

      <div role="tabpanel">
        {view === 'time' && <>
          <TimeChart a={a} marks={marks} tall={wide} />
          <p className="mt-2 text-xs text-text-subtle">Shaded across: the well zones on the depth scale. Red bands: a guideline or SOP-04 speed broken; amber: advice; purple: jarring. Point at the plot for the values; drag across to zoom in.</p>
        </>}
        {view === 'depth' && <>
          <DepthCharts a={a} />
          <p className="mt-2 text-xs text-text-subtle">Trip in (RIH) and trip out (POOH) against depth. Dashed lines: the guideline limit at that depth (red for POOH, blue for RIH, amber for the advised pump-down tension). Speed in ft/min, tension in lbs.</p>
        </>}
        {view === 'findings' && <Findings a={a} />}
        {view === 'sop' && <SopPanel r={r} sop={p.sop} restrictions={p.restrictions} />}
        {view === 'channels' && <ChannelPlot channels={p.channels} t0={r.run.t0} t1={r.run.t1} tall={wide} />}
      </div>
    </div>
  );
}

const SPEED_RULES: SopRuleKey[] = ['surfaceSpeed', 'restrictionSpeed', 'maxRih', 'maxPooh'];
const JAR_RULES: SopRuleKey[] = ['jarMat', 'jarSpang', 'jarDown', 'jarCycle', 'jarRest', 'jarCycles'];

/** The SOP-04 speed rules and the jarring: what each rule says, what broke it, and every jarring cycle. */
export function SopPanel({ r, sop, restrictions }: { r: RunReport; sop: SopRules; restrictions: Restriction[] }) {
  const lim = jarUpLimit(sop);
  const text: Record<SopRuleKey, string> = {
    surfaceSpeed: `${sop.surfaceSpeed} ft/min or less while the BHA is shallower than ${sop.surfaceDepth} ft`,
    restrictionSpeed: restrictions.length ? `${sop.restrictionSpeed} ft/min or less within ${sop.restrictionBand} ft of ${restrictions.map((x) => `${x.label} (${fmt(x.depth)} ft)`).join(', ')}` : 'No restrictions entered for this well',
    maxRih: sop.maxRih ? `${sop.maxRih} ft/min or less running in (Speed Guidelines for the BHA)` : 'Not checked: set the running speed for the BHA',
    maxPooh: sop.maxPooh ? `${sop.maxPooh} ft/min or less pulling out (Speed Guidelines for the BHA)` : 'Not checked: set the pulling speed for the BHA',
    jarMat: lim ? `Jarring up never over ${fmt(lim.limit)} lbs (the ${lim.from})` : 'Not checked: enter the wire breaking strength or the MAT',
    jarSpang: sop.spang ? `Jarring up never over the spang jar limit of ${fmt(sop.spangLimit)} lbs` : 'Not checked: no spang jars in the string',
    jarDown: `Jarring down never loses more than ${sop.jarDownLossPct}% of the normal tension`,
    jarCycle: `A jarring cycle lasts ${sop.cycleMin} minutes or less`,
    jarRest: `At least ${sop.restMin} minutes of rest between cycles`,
    jarCycles: `After ${sop.maxCycles} cycles at one place, shear off, pull out, cut the wire and re-test it`,
  };
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
      <section>
        <h4 className="mb-1 text-sm font-semibold">Speed (NESR-8000-SOP-04, 6.2 and the Speed Guidelines)</h4>
        {ruleList(SPEED_RULES)}
      </section>
      <section>
        <h4 className="mb-1 text-sm font-semibold">Jarring (NESR-8000-SOP-04, 8.3 and the Jarring Guidelines)</h4>
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
            )) : <tr className="border-t border-border"><td colSpan={6} className={cx(td, 'text-text-subtle')}>Nothing against SOP-04 on this run.</td></tr>}</tbody>
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

export function Findings({ a }: { a: Analysis }) {
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

export function Pill({ tone, children }: { tone: 'danger' | 'warning' | 'success'; children: ReactNode }) {
  const cls = { danger: 'bg-danger-subtle text-danger', warning: 'bg-warning-subtle text-warning', success: 'bg-success-subtle text-success' }[tone];
  return <span className={cx('inline-block min-w-6 rounded-pill px-1.5 text-center font-mono text-label font-bold', cls)}>{children}</span>;
}

// ---------------------------------------------------------------- charts (plain SVG, theme colours)

export const C = {
  depth: 'var(--color-text-subtle)', speed: 'var(--color-chart-1)', tension: 'var(--color-chart-2)', rih: 'var(--color-chart-1)', pooh: 'var(--color-chart-3)',
  danger: 'var(--color-danger)', warning: 'var(--color-warning)', grid: 'var(--color-border)', text: 'var(--color-text-muted)', jar: 'var(--color-chart-5)',
};
export const ZONE_FILL = ['transparent', 'var(--color-chart-1)', 'var(--color-chart-3)', 'var(--color-chart-6)'];

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
  const { S, sv, viol, advice, kpi } = a;
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
        {marks.some((m) => m.kind === 'jar') && <Key color={C.jar} band>Jarring</Key>}{marks.some((m) => m.kind === 'sop') && <Key color={C.danger} band>SOP-04 speed</Key>}
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
          {marks.map((m, i) => <rect key={`m${i}`} x={x(m.t0)} width={Math.max(2, x(m.t1) - x(m.t0))} y={M.t} height={ph} fill={m.kind === 'jar' ? C.jar : C.danger} opacity={m.kind === 'jar' ? 0.25 : 0.18} />)}
          {advice.map((v, i) => <rect key={`a${i}`} x={x(v.t0)} width={Math.max(1.5, x(v.t1) - x(v.t0))} y={M.t} height={ph} fill={C.warning} opacity={0.22} />)}
        </g>
        {ticks(0, dMax).map((v) => <g key={v}><line x1={M.l} x2={M.l + pw} y1={yD(v)} y2={yD(v)} stroke={C.grid} strokeWidth={0.5} />
          <text x={M.l - 4} y={yD(v)} dy="0.32em" textAnchor="end" fontSize={10} fill={C.text}>{fmt(v)}</text></g>)}
        {ticks(0, sMax, 4).map((v) => <text key={`s${v}`} x={M.l + pw + 4} y={yS(v)} dy="0.32em" fontSize={10} fill={C.speed}>{fmt(v)}</text>)}
        {ticks(0, tMax, 4).map((v) => <text key={`t${v}`} x={M.l + pw + (narrow ? 40 : 52)} y={yT(v)} dy="0.32em" fontSize={10} fill={C.tension}>{fmt(v)}</text>)}
        {tTicks.map((t) => <text key={t} x={x(t)} y={H - 10} textAnchor="middle" fontSize={10} fill={C.text}>{hm(t)}</text>)}
        {sv.source !== 'vertical' && ([['KOP', sv.kop], ['30°', sv.p30], ['Lateral', sv.lat]] as const).map(([n, d]) => (
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

export function Key({ color, band, children }: { color: string; band?: boolean; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5"><span aria-hidden className={band ? 'h-2.5 w-3 opacity-40' : 'h-0.5 w-4'} style={{ background: color }} />{children}</span>;
}

/** Two panels against depth (down the page): line speed and tension, trip in and trip out, with the limit lines. */
export function DepthCharts({ a }: { a: Analysis }) {
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

export function DepthPanel({ W, a, title, rih, pooh, val, limits, D }: {
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

