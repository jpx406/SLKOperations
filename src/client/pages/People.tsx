import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { LEVELS, competency, crewUtilization, domainRollup, monthLabel, monthsBetween, successful, type Assignment, type Person } from '../../shared/people';
import { kpis, unitUtilization, utilBand } from '../../shared/stats';
import { workbook } from '../../shared/xlsx';
import { api, formatDate } from '../api';
import { BarChart, KpiTile, saveFile } from '../components/charts';
import { FilterBar } from '../components/FilterBar';
import { Banner, Button, Card, PageTitle, Skeleton, cx, inputSized } from '../components/ui';
import { PeriodPicker, useStats } from './Statistics';

// Service Quality: Utilization (S15) and Competency (S16).

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
const BAND: Record<string, string> = { high: 'bg-success text-on-accent', mid: 'bg-warning text-on-accent', low: 'bg-sev-major text-on-sev', idle: 'bg-danger-subtle text-danger', none: 'bg-surface-2 text-text-subtle' };
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function usePeople() {
  return useQuery({ queryKey: ['stats-people'], queryFn: () => api<{ people: Person[]; assignments: Assignment[] }>('/stats/people') });
}

export function Utilization() {
  const { q, period, range, setPeriod } = useStats();
  const people = usePeople();
  const rows = q.data?.rows ?? [];
  const from = range.from ?? rows[0]?.start_date ?? today();
  const to = range.to ?? today();
  const months = useMemo(() => monthsBetween(from, to), [from, to]);
  const heat = useMemo(() => {
    if (!q.data) return [];
    return q.data.units.map((u) => ({
      unit: u,
      cells: months.map((m) => {
        const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
        return unitUtilization([u], rows, q.data!.events, `${m}-01`, last)[0];
      }),
      total: unitUtilization([u], rows, q.data!.events, from, to)[0],
    }));
  }, [q.data, rows, months, from, to]);
  const crew = useMemo(() => (people.data ? crewUtilization(people.data.people, people.data.assignments, months) : null), [people.data, months]);
  const fleetAvg = heat.length ? Math.round((heat.reduce((a, h) => a + (h.total.pct ?? 0), 0) / heat.length) * 10) / 10 : null;
  const ranked = [...heat].filter((h) => h.total.pct !== null).sort((a, b) => (b.total.pct ?? 0) - (a.total.pct ?? 0));
  const k = kpis(rows);
  const fleetByMonth = months.map((m, i) => ({ key: m, label: monthLabel(m), value: heat.length ? Math.round((heat.reduce((a, h) => a + (h.cells[i].pct ?? 0), 0) / heat.length) * 10) / 10 : null, ids: rows.filter((j) => j.start_date.startsWith(m)).map((j) => j.id) }));
  const crewByMonth = (crew?.perMonth ?? []).map((m) => ({ key: m.month, label: m.label, value: m.avg, ids: [] as string[] }));
  const exportXlsx = () => saveFile(`utilization-${today()}.xlsx`, workbook('Unit utilization', ['Unit', ...months.map(monthLabel), 'Period %', 'Jobs', 'Active days', 'Available days'],
    heat.map((h) => [h.unit, ...h.cells.map((c) => c.pct), h.total.pct, h.total.jobs, h.total.activeDays, h.total.availableDays]), [10, ...months.map(() => 8), 9, 7, 9, 10]), XLSX);

  return (
    <section aria-labelledby="util-title">
      <PageTitle aside={
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker period={period} onChange={setPeriod} />
          <span className="flex gap-2 print:hidden">
            <Button size="sm" onClick={() => window.print()}><Printer aria-hidden className="size-4" />Print</Button>
            <Button size="sm" onClick={exportXlsx} disabled={!heat.length}><FileSpreadsheet aria-hidden className="size-4" />XLSX</Button>
          </span>
        </div>
      }><span id="util-title">Utilization</span></PageTitle>
      <FilterBar optionsPath="/filter-options" withStatus={false} />
      {(q.isPending || people.isPending) && <Skeleton className="h-96" />}
      {q.isError && <Banner tone="danger">{q.error.message}</Banner>}
      {q.data && crew && (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiTile label="Fleet utilization" value={fleetAvg} unit="%" note={`${heat.length} active units`} />
            <KpiTile label="Crew utilization" value={crew.perMonth.length ? Math.round((crew.perMonth.reduce((a, m) => a + (m.avg ?? 0), 0) / crew.perMonth.length) * 10) / 10 : null} unit="%" note={`${crew.headcount} field people`} />
            <KpiTile label="Jobs" value={k.jobs} />
            <KpiTile label="Op hours" value={k.opHours.toLocaleString()} unit="h" />
            <KpiTile label="Busiest unit" value={ranked[0]?.unit ?? null} note={ranked[0] ? `${ranked[0].total.pct}%` : undefined} />
            <KpiTile label="Least used unit" value={ranked.at(-1)?.unit ?? null} note={ranked.at(-1) ? `${ranked.at(-1)!.total.pct}%` : undefined} />
          </dl>
          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BarChart title="Average crew utilization per month" buckets={crewByMonth} unit="%" max={100} note="Every field person on the roster counts; idle people count as 0 %." />
            <BarChart title="Average fleet utilization per month" buckets={fleetByMonth} unit="%" max={100} />
          </div>
          <Card className="mb-4 overflow-x-auto">
            <h2 className="label-caps mb-1 text-text-muted">Units by month</h2>
            <p className="mb-3 text-xs text-text-subtle">
              <span className="mr-1 inline-block size-2.5 rounded-xs bg-success align-middle" />75 % and over
              <span className="mr-1 ml-3 inline-block size-2.5 rounded-xs bg-warning align-middle" />50–75 %
              <span className="mr-1 ml-3 inline-block size-2.5 rounded-xs bg-sev-major align-middle" />25–49 %
              <span className="mr-1 ml-3 inline-block size-2.5 rounded-xs bg-danger-subtle align-middle" />under 25 %
            </p>
            <table className="text-xs">
              <thead><tr><th scope="col" className="sticky left-0 bg-surface px-2 py-1 text-left">Unit</th>{months.map((m) => <th key={m} scope="col" className="px-1 py-1 font-mono font-normal text-text-muted">{monthLabel(m)}</th>)}<th scope="col" className="px-2 py-1">Period</th></tr></thead>
              <tbody>
                {heat.map((h) => (
                  <tr key={h.unit}>
                    <th scope="row" className="sticky left-0 bg-surface px-2 py-0.5 text-left font-mono">{h.unit}</th>
                    {h.cells.map((c, i) => (
                      <td key={months[i]} className="p-0.5">
                        <span title={`${h.unit} ${monthLabel(months[i])}: ${c.jobs} jobs, ${c.activeDays} active / ${Math.max(0, c.availableDays - c.activeDays)} idle days`}
                          className={cx('flex h-7 w-12 items-center justify-center rounded-xs font-mono', BAND[utilBand(c.pct)])}>{c.pct ?? '—'}</span>
                      </td>
                    ))}
                    <td className="px-2 font-mono font-semibold">{h.total.pct ?? '—'}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card>
            <h2 className="label-caps mb-2 text-text-muted">How this is worked out</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-text-muted">
              <li>A unit’s available days are the calendar days in the period minus maintenance, loan, transferred and junk days.</li>
              <li>Active days run from arrival (or the start date) to the end date, plus one day to mobilise before and two to demobilise after. A day is counted once even when jobs overlap.</li>
              <li>Crew utilization uses each person’s rotation (60/30 means two thirds of the days are on duty) and the days they are crewed on a job, capped at 100 %.</li>
              <li>Canceled jobs are left out. Filters narrow the jobs; units without matching jobs show as idle.</li>
            </ul>
          </Card>
        </>
      )}
    </section>
  );
}

export function Competency() {
  const people = usePeople();
  const [service, setService] = useState('');
  const [person, setPerson] = useState('');
  const [role, setRole] = useState('');
  const data = people.data;
  const comp = useMemo(() => (data ? competency(data.people.filter((p) => !role || p.crew_role === role), data.assignments) : null), [data, role]);
  const domains = useMemo(() => (data ? domainRollup(data.assignments) : []), [data]);
  const trend = useMemo(() => {
    const ok = (data?.assignments ?? []).filter(successful);
    if (!ok.length) return [];
    const months = monthsBetween(ok.reduce((m, a) => (a.start_date < m ? a.start_date : m), ok[0].start_date), today());
    return months.map((m) => ({ key: m, label: monthLabel(m), value: ok.filter((a) => a.start_date.startsWith(m)).length, ids: [] as string[] }));
  }, [data]);
  const cards = (comp?.cards ?? []).filter((c) => (!person || c.id === person) && (!service || c.perService.some((x) => x.service === service)));
  const exportXlsx = () => comp && saveFile(`competency-${today()}.xlsx`, workbook('Competency', ['Person', 'Role', ...comp.services, 'Successful jobs', 'Fail %', 'NPT per job'],
    comp.cards.map((c) => [c.name, c.role, ...comp.services.map((s) => c.perService.find((x) => x.service === s)?.jobs ?? 0), c.totalJobs, c.failPct, c.nptPerJob]), [22, 18, ...comp.services.map(() => 10), 10, 7, 9]), XLSX);
  return (
    <section aria-labelledby="comp-title">
      <PageTitle aside={
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button size="sm" onClick={() => window.print()}><Printer aria-hidden className="size-4" />Print</Button>
          <Button size="sm" onClick={exportXlsx} disabled={!comp}><FileSpreadsheet aria-hidden className="size-4" />XLSX</Button>
        </div>
      }><span id="comp-title">Competency</span></PageTitle>
      <p className="-mt-3 mb-4 text-sm text-text-muted">Experience per person and service, counted from completed jobs without a failure: under 10 Basic, 10–19 Intermediate, 20–29 Advance, 30 or more Expert.</p>
      {people.isPending && <Skeleton className="h-96" />}
      {people.isError && <Banner tone="danger">{people.error.message}</Banner>}
      {comp && data && (
        <>
          <div className="mb-4 flex flex-wrap gap-2 print:hidden">
            <select aria-label="Service" className={inputSized('h-(--layout-control-sm) w-56')} value={service} onChange={(e) => setService(e.target.value)}><option value="">All services</option>{comp.services.map((s) => <option key={s}>{s}</option>)}</select>
            <select aria-label="Person" className={inputSized('h-(--layout-control-sm) w-52')} value={person} onChange={(e) => setPerson(e.target.value)}><option value="">All people</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
            <select aria-label="Role" className={inputSized('h-(--layout-control-sm) w-48')} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">All roles</option><option value="slickline_supervisor">Supervisors</option><option value="slickline_operator">Operators</option><option value="assistant_operator">Assistant operators</option><option value="helper">Helpers</option>
            </select>
          </div>
          <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">{comp.overview.map((o) => <KpiTile key={o.level} label={o.level} value={o.count} note="person-service pairs" />)}</dl>
          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="label-caps mb-2 text-text-muted">Bench strength</h2>
              <p className="mb-2 text-xs text-text-subtle">Services with one person or nobody at Advance or Expert are a coverage gap.</p>
              <ul className="space-y-1 text-sm">
                {comp.coverage.filter((x) => !service || x.service === service).map((x) => (
                  <li key={x.service} className="flex items-center gap-2"><span className={cx('min-w-0 flex-1 truncate', x.gap && 'font-semibold text-warning')}>{x.gap ? '⚠ ' : ''}{x.service}</span>
                    <span className="font-mono text-xs">{x.advancePlus} at Advance+</span></li>
                ))}
              </ul>
            </Card>
            <Card>
              <h2 className="label-caps mb-2 text-text-muted">Close to the next level</h2>
              {!comp.nearThreshold.length ? <p className="text-sm text-text-subtle">Nobody is within two jobs of a new level.</p> : (
                <ul className="space-y-1 text-sm">{comp.nearThreshold.filter((x) => !service || x.service === service).slice(0, 15).map((x, i) => <li key={i}>{x.name} · {x.service}: <span className="font-mono">{x.toNext}</span> job{x.toNext === 1 ? '' : 's'} from the next level ({x.level} now)</li>)}</ul>
              )}
            </Card>
          </div>
          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BarChart title="Successful crew jobs by service domain" horizontal buckets={domains.map((d) => ({ key: d.domain, label: `${d.domain} (${d.people} people)`, value: d.jobs, ids: [] }))} />
            <BarChart title="Successful crew jobs per month" buckets={trend} />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((c) => (
              <Card key={c.id}>
                <div className="mb-2 flex items-baseline gap-2"><h3 className="flex-1 font-semibold">{c.name}</h3><span className="font-mono text-xs text-text-muted">{c.totalJobs} jobs</span></div>
                <p className="mb-2 text-xs text-text-subtle">Fail {c.failPct ?? '—'}% · NPT per job {c.nptPerJob ?? '—'} h</p>
                {!c.perService.length ? <p className="text-sm text-text-subtle">No completed jobs yet.</p> : (
                  <ul className="space-y-1 text-sm">
                    {c.perService.filter((x) => !service || x.service === service).sort((a, b) => b.jobs - a.jobs).map((x) => (
                      <li key={x.service} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{x.service}</span>
                        <span className={cx('label-caps rounded-pill px-2 py-0.5', x.level === 'Expert' ? 'bg-success-subtle text-success' : x.level === 'Advance' ? 'bg-info-subtle text-info' : x.level === 'Intermediate' ? 'bg-warning-subtle text-warning' : 'bg-neutral-subtle text-neutral')}>{x.level}</span>
                        <span className="w-6 text-right font-mono text-xs">{x.jobs}</span></li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
          <p className="mt-3 text-xs text-text-subtle">Levels: {LEVELS.map((l) => `${l.label} ${l.min}+`).join(' · ')}. Figures as of {formatDate(today())}.</p>
        </>
      )}
    </section>
  );
}
