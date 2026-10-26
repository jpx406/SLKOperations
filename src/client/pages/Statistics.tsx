import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Printer, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { filtersToQuery } from '../../shared/filters';
import {
  PERIODS, auditCompliance, avgRunEff, byMonth, fleetEff, groupBy, kpis, missingData, periodRange, ratioByMonth, unitUtilization,
  type Bucket, type Period, type StatJob, type UnitEvent,
} from '../../shared/stats';
import { workbook } from '../../shared/xlsx';
import { api, formatDate } from '../api';
import { BarChart, Gauge, KpiTile, saveFile } from '../components/charts';
import { FilterBar, useFilters } from '../components/FilterBar';
import { Banner, Button, Card, PageTitle, Skeleton, cx } from '../components/ui';

// Service Quality: Operation Statistics (S13) and NPT & Failure Analysis (S14). Both read the same rows.

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

export function useStats() {
  const [filters] = useFilters();
  const [params, setParams] = useSearchParams();
  const period = (PERIODS.some((p) => p.key === params.get('period')) ? params.get('period') : 'ytd') as Period;
  const range = periodRange(period, today());
  const qs = [filtersToQuery(filters), range.from && `from=${range.from}`, range.to && `to=${range.to}`].filter(Boolean).join('&');
  const q = useQuery({ queryKey: ['stats', qs], queryFn: () => api<{ rows: StatJob[]; units: string[]; events: UnitEvent[] }>(`/stats?${qs}`) });
  const setPeriod = (p: Period) => { const n = new URLSearchParams(params); n.set('period', p); setParams(n, { replace: true }); };
  return { q, period, range, setPeriod };
}

export function PeriodPicker({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div role="radiogroup" aria-label="Period" className="flex flex-wrap gap-1.5 print:hidden">
      {PERIODS.map((p) => (
        <button key={p.key} type="button" role="radio" aria-checked={period === p.key} onClick={() => onChange(p.key)}
          className={cx('h-(--layout-control-sm) rounded-pill border px-3.5 text-sm font-semibold', period === p.key ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>{p.label}</button>
      ))}
    </div>
  );
}

/** The jobs behind a clicked bar or gauge. */
function DrillDown({ title, rows, onClose }: { title: string; rows: StatJob[]; onClose: () => void }) {
  return (
    <Card className="mb-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">{title} · {rows.length} job{rows.length === 1 ? '' : 's'}</h2>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close the job list"><X aria-hidden className="size-4" /></Button>
      </div>
      <div className="max-h-72 overflow-auto">
        <table className="w-full min-w-[44rem] text-xs">
          <thead><tr className="text-left text-text-muted">{['Ticket', 'Start', 'Unit', 'Well', 'SDM', 'Op h', 'NPT h', 'Failure'].map((h) => <th key={h} scope="col" className="py-1 pr-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id} className="border-t border-border">
                <td className="py-1 pr-3 font-mono"><Link className="underline" to={`/operation/jobs/${j.id}/execution`}>{j.ticket_no ?? 'no ticket'}</Link></td>
                <td className="py-1 pr-3 font-mono">{formatDate(j.start_date)}</td><td className="py-1 pr-3 font-mono">{j.unit_number ?? '—'}</td>
                <td className="py-1 pr-3">{j.well ?? '—'}</td><td className="py-1 pr-3">{j.sdm ?? '—'}</td>
                <td className="py-1 pr-3 font-mono">{j.op_hours ?? '—'}</td><td className="py-1 pr-3 font-mono">{j.npt_hours}</td><td className="py-1 pr-3">{j.failure === 'yes' ? 'Yes' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function Statistics() {
  const { q, period, range, setPeriod } = useStats();
  const [drill, setDrill] = useState<{ chart: string; key: string; label: string; ids: string[] } | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const rows = q.data?.rows ?? [];
  const k = kpis(rows);
  // utilization needs real bounds: the period, or for All time the first start to the last end
  const span = useMemo(() => ({
    from: range.from ?? rows[0]?.start_date ?? today(),
    to: range.to ?? rows.reduce((m, j) => ((j.end_date ?? j.start_date) > m ? (j.end_date ?? j.start_date) : m), rows[0]?.start_date ?? today()),
  }), [range.from, range.to, rows]);
  const util = useMemo(() => (q.data ? unitUtilization(q.data.units, rows, q.data.events, span.from, span.to) : []), [q.data, rows, span]);
  const avgUtil = util.length ? Math.round((util.reduce((a, u) => a + (u.pct ?? 0), 0) / util.length) * 10) / 10 : null;
  const missing = missingData(rows);
  const audit = auditCompliance(rows);
  const byAccount = groupBy(rows, (j) => [j.location], () => 1);
  const pick = (chart: string) => (b: Omit<Bucket, 'value'>) => setDrill(drill?.chart === chart && drill.key === b.key ? null : { chart, key: b.key, label: `${chart}: ${b.label}`, ids: b.ids });
  const sel = (chart: string) => (drill?.chart === chart ? drill.key : null);

  const charts: { title: string; buckets: (Omit<Bucket, 'value'> & { value: number | null })[]; unit?: string; horizontal?: boolean; max?: number }[] = [
    { title: 'Jobs per month', buckets: byMonth(rows, () => 1, range) },
    { title: 'Operating hours per month', buckets: byMonth(rows, (j) => j.op_hours ?? 0, range), unit: 'h' },
    { title: 'NPT per month', buckets: byMonth(rows, (j) => j.npt_hours, range), unit: 'h' },
    { title: 'Fleet efficiency per month', buckets: ratioByMonth(rows, fleetEff, range), unit: '%', max: 100 },
    { title: 'Average run efficiency per month', buckets: ratioByMonth(rows, avgRunEff, range), unit: '%', max: 100 },
    { title: 'Failures per month', buckets: byMonth(rows, (j) => (j.failure === 'yes' ? 1 : 0), range) },
    { title: 'Jobs by account', buckets: byAccount, horizontal: true },
    { title: 'Jobs by area', buckets: groupBy(rows, (j) => [j.field], () => 1), horizontal: true },
    { title: 'Jobs by service', buckets: groupBy(rows, (j) => j.services, () => 1), horizontal: true },
    { title: 'Jobs by service domain', buckets: groupBy(rows, (j) => j.domains, () => 1), horizontal: true },
    { title: 'Operating hours by unit', buckets: groupBy(rows, (j) => [j.unit_number], (j) => j.op_hours ?? 0), unit: 'h', horizontal: true },
    { title: 'Operating hours by SDM', buckets: groupBy(rows, (j) => [j.sdm], (j) => j.op_hours ?? 0), unit: 'h', horizontal: true },
  ];

  return (
    <section aria-labelledby="stats-title">
      <PageTitle aside={<PeriodPicker period={period} onChange={setPeriod} />}><span id="stats-title">Operation statistics</span></PageTitle>
      <FilterBar optionsPath="/filter-options" withStatus={false} />
      <p className="mb-3 text-xs text-text-subtle">
        {range.from ? `${formatDate(range.from)} to ${formatDate(range.to!)}` : 'All time'} by job start date · canceled jobs are left out ·
        fleet efficiency = op ÷ (op + NPT); run efficiency = successful ÷ total runs
      </p>
      {q.isPending && <Skeleton className="h-96" />}
      {q.isError && <Banner tone="danger">{q.error.message}</Banner>}
      {q.data && (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiTile label="Jobs" value={k.jobs} />
            <KpiTile label="Op hours" value={k.opHours.toLocaleString()} unit="h" />
            <KpiTile label="NPT" value={k.npt.toLocaleString()} unit="h" />
            <KpiTile label="Fleet efficiency" value={k.fleetEff} unit="%" />
            <KpiTile label="Avg run efficiency" value={k.avgRunEff} unit="%" />
            <KpiTile label="Avg unit utilization" value={avgUtil} unit="%" note={`${util.length} active units, mob −1 / demob +2 days`} />
          </dl>

          {missing.length > 0 && (
            <div className="mb-4">
              <Banner tone="warning" action={<Button size="sm" variant="ghost" onClick={() => setShowMissing(!showMissing)}>{showMissing ? 'Hide list' : 'View list'}</Button>}>
                {missing.length} completed job{missing.length === 1 ? ' is' : 's are'} missing data, so the numbers above undercount.
              </Banner>
              {showMissing && (
                <Card className="mt-2"><ul className="columns-1 gap-6 text-sm md:columns-2">
                  {missing.map((m) => <li key={m.id}><Link className="font-mono underline" to={`/operation/jobs/${m.id}/execution`}>{m.ticket_no ?? 'no ticket'}</Link> <span className="text-text-muted">no {m.missing.join(' or ')}</span></li>)}
                </ul></Card>
              )}
            </div>
          )}

          <Card className="mb-4">
            <h2 className="label-caps mb-1 text-text-muted">Fleet efficiency by account</h2>
            <p className="mb-3 text-xs text-text-subtle">Good at 90 % or more, watch from 75 %, low below that. (1 − NPT ÷ op hours) across the account’s jobs; click a gauge for the jobs.</p>
            {!byAccount.length ? <p className="text-sm text-text-subtle">No jobs in this selection.</p> : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                {byAccount.map((b) => (
                  <button key={b.key} type="button" onClick={() => pick('Account')(b)} aria-pressed={sel('Account') === b.key} className="rounded-md p-1 hover:bg-surface-2">
                    <Gauge label={b.label} value={fleetEff(rows.filter((j) => b.ids.includes(j.id)))} sub={`${b.value} job${b.value === 1 ? '' : 's'}`} />
                  </button>
                ))}
              </div>
            )}
          </Card>

          {drill && <DrillDown title={drill.label} rows={rows.filter((j) => drill.ids.includes(j.id))} onClose={() => setDrill(null)} />}

          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {charts.map((c) => <BarChart key={c.title} {...c} selected={sel(c.title)} onSelect={pick(c.title)} />)}
          </div>

          <Card>
            <h2 className="label-caps mb-1 text-text-muted">Wellsite audit compliance by SDM</h2>
            <p className="mb-3 text-xs text-text-subtle">Audited jobs ÷ all jobs, target 25 % (tick on each gauge). From the Closure stage’s Wellsite audit field.</p>
            {!audit.length ? <p className="text-sm text-text-subtle">No jobs in this selection.</p> : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                {audit.map((a) => (
                  <button key={a.sdm} type="button" onClick={() => pick('Audit')({ key: a.sdm, label: a.sdm, ids: a.ids })} aria-pressed={sel('Audit') === a.sdm} className="rounded-md p-1 hover:bg-surface-2">
                    <Gauge label={a.sdm} value={a.pct} target={25} sub={`${a.audited} of ${a.jobs} audited`} />
                  </button>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </section>
  );
}

export function NptAnalysis() {
  const { q, period, range, setPeriod } = useStats();
  const [drill, setDrill] = useState<{ chart: string; key: string; label: string; ids: string[] } | null>(null);
  const rows = q.data?.rows ?? [];
  const k = kpis(rows);
  const withNpt = rows.filter((j) => j.npt_hours > 0 || j.failure === 'yes');
  const pick = (chart: string) => (b: Omit<Bucket, 'value'>) => setDrill(drill?.chart === chart && drill.key === b.key ? null : { chart, key: b.key, label: `${chart}: ${b.label}`, ids: b.ids });
  const sel = (chart: string) => (drill?.chart === chart ? drill.key : null);
  const npt = (j: StatJob) => j.npt_hours;
  const charts = [
    { title: 'NPT by month', buckets: byMonth(withNpt, npt, range), horizontal: true },
    { title: 'NPT by area', buckets: groupBy(withNpt, (j) => [j.field], npt), horizontal: true },
    { title: 'NPT by account', buckets: groupBy(withNpt, (j) => [j.location], npt), horizontal: true },
    { title: 'NPT by service', buckets: groupBy(withNpt, (j) => j.services, npt), horizontal: true },
    { title: 'NPT by crew member', buckets: groupBy(withNpt, (j) => j.crew, npt, 'No crew named'), horizontal: true },
    { title: 'NPT by unit', buckets: groupBy(withNpt, (j) => [j.unit_number], npt), horizontal: true },
  ];
  const exportXlsx = () => saveFile(`npt-failures-${today()}.xlsx`, workbook('NPT and failures',
    ['Field ticket', 'Start', 'Unit', 'Well', 'Area', 'Account', 'SDM', 'Services', 'Crew', 'Op hours', 'NPT h', 'Failure'],
    withNpt.map((j) => [j.ticket_no, j.start_date, j.unit_number, j.well, j.field, j.location, j.sdm, j.services.join(', '), j.crew.join(', '), j.op_hours, j.npt_hours, j.failure === 'yes' ? 'Yes' : 'No']),
    [12, 11, 9, 12, 14, 12, 18, 30, 30, 9, 7, 8]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  return (
    <section aria-labelledby="npt-title">
      <PageTitle aside={
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker period={period} onChange={setPeriod} />
          <span className="flex gap-2 print:hidden">
            <Button size="sm" onClick={() => window.print()} disabled={!rows.length}><Printer aria-hidden className="size-4" />Download report</Button>
            <Button size="sm" onClick={exportXlsx} disabled={!withNpt.length}><FileSpreadsheet aria-hidden className="size-4" />XLSX</Button>
          </span>
        </div>
      }><span id="npt-title">NPT &amp; failure analysis</span></PageTitle>
      <FilterBar optionsPath="/filter-options" withStatus={false} />
      <p className="mb-3 text-xs text-text-subtle">{range.from ? `${formatDate(range.from)} to ${formatDate(range.to!)}` : 'All time'} by job start date · NPT comes from the job (or its 8 Min. Facts when there are any)</p>
      {q.isPending && <Skeleton className="h-96" />}
      {q.isError && <Banner tone="danger">{q.error.message}</Banner>}
      {q.data && (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiTile label="Total NPT" value={k.npt.toLocaleString()} unit="h" />
            <KpiTile label="Jobs with NPT" value={k.jobsWithNpt} note={`of ${k.jobs} jobs`} />
            <KpiTile label="Failures" value={k.failures} />
            <KpiTile label="Failure rate" value={k.failureRate} unit="%" />
            <KpiTile label="Fleet efficiency" value={k.fleetEff} unit="%" />
          </dl>
          {drill && <DrillDown title={drill.label} rows={rows.filter((j) => drill.ids.includes(j.id))} onClose={() => setDrill(null)} />}
          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {charts.map((c) => <BarChart key={c.title} {...c} unit="h" selected={sel(c.title)} onSelect={pick(c.title)} />)}
          </div>
          <Card className="overflow-x-auto">
            <h2 className="label-caps mb-2 text-text-muted">Jobs with NPT or a failure ({withNpt.length})</h2>
            {!withNpt.length ? <p className="text-sm text-text-subtle">None in this selection.</p> : (
              <table className="w-full min-w-[48rem] text-sm">
                <thead><tr className="text-left text-xs text-text-muted">{['Ticket', 'Start', 'Unit', 'Well', 'Area', 'Services', 'NPT h', 'Failure'].map((h) => <th key={h} scope="col" className="py-1.5 pr-3 font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {[...withNpt].sort((a, b) => b.npt_hours - a.npt_hours).map((j) => (
                    <tr key={j.id} className="border-t border-border">
                      <td className="py-1.5 pr-3 font-mono"><Link className="underline" to={`/operation/jobs/${j.id}/execution`}>{j.ticket_no ?? 'no ticket'}</Link></td>
                      <td className="py-1.5 pr-3 font-mono text-xs">{formatDate(j.start_date)}</td><td className="py-1.5 pr-3 font-mono text-xs">{j.unit_number ?? '—'}</td>
                      <td className="py-1.5 pr-3">{j.well ?? '—'}</td><td className="py-1.5 pr-3">{j.field ?? '—'}</td>
                      <td className="py-1.5 pr-3 text-xs">{j.services.join(', ') || '—'}</td><td className="py-1.5 pr-3 font-mono">{j.npt_hours}</td>
                      <td className="py-1.5 pr-3">{j.failure === 'yes' ? <span className="font-semibold text-danger">Yes</span> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </section>
  );
}
