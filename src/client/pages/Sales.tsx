import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Printer, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { money } from '../../shared/bonus';
import { filtersToQuery } from '../../shared/filters';
import { workbook } from '../../shared/xlsx';
import { api, formatDate } from '../api';
import { BarChart, KpiTile, saveFile } from '../components/charts';
import { FilterBar, useFilters } from '../components/FilterBar';
import { Banner, Card, EmptyState, PageTitle, Skeleton, Button, cx, inputSized } from '../components/ui';
import { SalesActivity } from './SalesActivity';
import { SalesDaily } from './SalesDaily';

// Sales Dashboard (Administrator Manual 2): revenue entered on each job, by account, with Analysis,
// Find/Edit Job (opens the job's Closure) and Incomplete Data (completed jobs without revenue). Next to it, the
// Activity sheet and the Daily report that replace the two Excel workbooks (owner request 2026-10-28).

interface SJob { id: string; ticket_no: string | null; status: string; start_date: string | null; location: string | null; field: string | null; unit_number: string | null; well: string | null; revenue_cents: number | null; revenue_currency: string; sdm: string | null; services: string[]; domains: string[]; bonus_cents: number }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const quarter = (d: string) => `${d.slice(0, 4)} Q${Math.ceil(Number(d.slice(5, 7)) / 3)}`;

function SalesRevenue({ views }: { views: ReactNode }) {
  const [filters] = useFilters();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'all';
  const setTab = (t: string) => { const n = new URLSearchParams(params); if (t === 'all') n.delete('tab'); else n.set('tab', t); setParams(n, { replace: true }); };
  const q = useQuery({ queryKey: ['sales', filtersToQuery(filters)], queryFn: () => api<SJob[]>(`/sales/jobs?${filtersToQuery(filters)}`) });
  const [find, setFind] = useState('');
  const all = q.data ?? [];
  const accounts = useMemo(() => [...new Set(all.map((j) => j.location ?? 'No account'))].sort(), [all]);
  const rows = tab === 'all' || tab === 'analysis' || tab === 'find' || tab === 'incomplete' ? all : all.filter((j) => (j.location ?? 'No account') === tab);
  const withRev = rows.filter((j) => j.revenue_cents != null);
  const total = withRev.reduce((a, j) => a + (j.revenue_cents ?? 0), 0);
  const incomplete = all.filter((j) => j.status === 'completed' && j.revenue_cents == null);
  const sum = (key: (j: SJob) => string[]) => {
    const m = new Map<string, { v: number; ids: string[] }>();
    for (const j of withRev) for (const k of key(j)) { const e = m.get(k) ?? { v: 0, ids: [] }; e.v += (j.revenue_cents ?? 0) / 100; e.ids.push(j.id); m.set(k, e); }
    return [...m.entries()].map(([k, e]) => ({ key: k, label: k, value: Math.round(e.v), ids: e.ids }));
  };
  const byQuarter = sum((j) => [j.start_date ? quarter(j.start_date) : 'no date']).sort((a, b) => a.key.localeCompare(b.key));
  const byMonth = sum((j) => [j.start_date?.slice(0, 7) ?? 'no date']).sort((a, b) => a.key.localeCompare(b.key)).map((b) => ({ ...b, label: b.key === 'no date' ? b.key : `${MONTHS[Number(b.key.slice(5, 7)) - 1]} ${b.key.slice(2, 4)}` }));
  const exportXlsx = () => saveFile(`sales-${new Date().toISOString().slice(0, 10)}.xlsx`, workbook('Sales', ['Ticket', 'Start', 'Account', 'Area', 'Unit', 'Well', 'SDM', 'Services', 'Status', 'Revenue', 'Currency', 'Approved bonus'],
    rows.map((j) => [j.ticket_no, j.start_date, j.location, j.field, j.unit_number, j.well, j.sdm, j.services.join(', '), j.status, j.revenue_cents == null ? null : j.revenue_cents / 100, j.revenue_currency, j.bonus_cents / 100]),
    [10, 11, 14, 14, 9, 12, 18, 30, 10, 12, 8, 12]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const found = find.trim() ? all.filter((j) => `${j.ticket_no ?? ''} ${j.well ?? ''} ${j.unit_number ?? ''}`.toLowerCase().includes(find.toLowerCase())).slice(0, 50) : [];
  const tabs: [string, string][] = [['all', 'All accounts'], ...accounts.map((a) => [a, a] as [string, string]), ['analysis', 'Analysis'], ['find', 'Find / edit job'], ['incomplete', `Incomplete data${incomplete.length ? ` (${incomplete.length})` : ''}`]];

  return (
    <section aria-labelledby="sales-title">
      <PageTitle aside={(
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button size="sm" onClick={() => window.print()} disabled={!rows.length}><Printer aria-hidden className="size-4" />Print charts (PDF)</Button>
          <Button size="sm" onClick={exportXlsx} disabled={!rows.length}><FileSpreadsheet aria-hidden className="size-4" />XLSX</Button>
        </div>
      )}><span id="sales-title">SLK Activity Dashboard</span></PageTitle>
        {views}
        <p className="-mt-3 mb-3 text-sm text-text-muted">Revenue is entered on each job’s Closure stage (SDM or Sales). Correcting it there updates this page and Bonus % of Revenue.</p>
        <FilterBar optionsPath="/filter-options" withStatus={false} />
        <div role="tablist" aria-label="Sales views" className="mb-4 flex flex-wrap gap-1.5 print:hidden">
          {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('h-(--layout-control-sm) rounded-pill border px-3.5 text-sm font-semibold', tab === k ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text', k === 'incomplete' && incomplete.length > 0 && tab !== k && 'text-warning')}>{l}</button>)}
        </div>
        {q.isPending && <Skeleton className="h-64" />}
        {q.isError && <Banner tone="danger">{q.error.message}</Banner>}
        {q.data && tab === 'find' && (
          <Card>
            <label className="relative mb-3 block max-w-md"><span className="sr-only">Find a job by ticket, well or unit</span>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle" />
              <input autoFocus className={inputSized('pl-8')} placeholder="Ticket, well or unit" value={find} onChange={(e) => setFind(e.target.value)} />
            </label>
            <ul className="divide-y divide-border text-sm">{found.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-3 py-1.5"><span className="font-mono">{j.ticket_no ?? 'no ticket'}</span><span>{j.well ?? '—'}</span><span className="text-text-muted">{j.location ?? '—'} · {j.start_date ? formatDate(j.start_date) : '—'}</span>
                <span className="ml-auto font-mono">{money(j.revenue_cents, j.revenue_currency)}</span><Link className="text-xs underline" to={`/operation/jobs/${j.id}/closure`}>Edit revenue</Link></li>
            ))}</ul>
            {find.trim() && !found.length && <p className="text-sm text-text-subtle">No job matches.</p>}
          </Card>
        )}
        {q.data && tab === 'incomplete' && (
          !incomplete.length ? <EmptyState title="Every completed job has its revenue" /> : (
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-surface-2"><tr className="text-left text-xs text-text-muted">{['Ticket', 'Start', 'Account', 'Well', 'SDM', ''].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                <tbody>{incomplete.map((j) => <tr key={j.id} className="border-t border-border"><td className="px-3 py-2 font-mono">{j.ticket_no ?? 'no ticket'}</td><td className="px-3 py-2 font-mono text-xs">{j.start_date ? formatDate(j.start_date) : '—'}</td><td className="px-3 py-2">{j.location ?? '—'}</td><td className="px-3 py-2">{j.well ?? '—'}</td><td className="px-3 py-2">{j.sdm ?? '—'}</td>
                  <td className="px-3 py-2 text-right"><Link className="text-xs underline" to={`/operation/jobs/${j.id}/closure`}>Add revenue</Link></td></tr>)}</tbody>
              </table>
            </Card>
          )
        )}
        {q.data && !['find', 'incomplete'].includes(tab) && (
          <>
            <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiTile label="Total revenue" value={money(total, withRev[0]?.revenue_currency ?? 'USD')} />
              <KpiTile label="Jobs #" value={withRev.length} note={rows.length > withRev.length ? `${rows.length - withRev.length} without revenue yet` : undefined} />
              <KpiTile label="Avg revenue / job" value={withRev.length ? money(Math.round(total / withRev.length), withRev[0]?.revenue_currency ?? 'USD') : '—'} />
              <KpiTile label="Approved bonus on these jobs" value={money(withRev.reduce((a, j) => a + j.bonus_cents, 0))} note={total ? `${Math.round((withRev.reduce((a, j) => a + j.bonus_cents, 0) / total) * 1000) / 10}% of revenue (target under 4.5%)` : undefined} />
            </dl>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <BarChart title="Revenue by quarter" buckets={byQuarter} unit="USD" />
              {tab === 'analysis' ? <BarChart title="Revenue by month" buckets={byMonth} unit="USD" /> : <BarChart title="Revenue by account" horizontal buckets={sum((j) => [j.location ?? 'No account'])} unit="USD" />}
              {tab === 'analysis' && <BarChart title="Revenue by service" horizontal buckets={sum((j) => (j.services.length ? [j.services[0]] : ['no service']))} unit="USD" note="By main service." />}
              {tab === 'analysis' && <BarChart title="Revenue by area" horizontal buckets={sum((j) => [j.field ?? 'No area'])} unit="USD" />}
              {tab === 'analysis' && <BarChart title="Revenue by SDM" horizontal buckets={sum((j) => [j.sdm ?? 'No SDM'])} unit="USD" />}
              {tab === 'analysis' && <BarChart title="Revenue by unit" horizontal buckets={sum((j) => [j.unit_number ?? 'No unit'])} unit="USD" />}
            </div>
          </>
        )}
    </section>
  );
}

const VIEWS = [['revenue', 'Revenue', 'Revenue by account, quarter and service'], ['activity', 'Activity sheet', 'A billing line per job for the month, checked and locked line by line'], ['daily', 'Daily report', 'Every unit’s day: status, rig, well and crew']] as const;

export function SalesDashboard() {
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some(([k]) => k === params.get('view')) ? params.get('view')! : 'revenue';
  const setView = (v: string) => { const n = new URLSearchParams(params); n.delete('tab'); n.delete('show'); if (v === 'revenue') n.delete('view'); else n.set('view', v); setParams(n, { replace: true }); };
  const views = (
    <div role="tablist" aria-label="SLK Activity Dashboard sections" className="mb-4 flex flex-wrap gap-1 border-b border-border print:hidden">
      {VIEWS.map(([k, label, hint]) => (
        <button key={k} type="button" role="tab" aria-selected={view === k} title={hint} onClick={() => setView(k)}
          className={cx('-mb-px border-b-2 px-4 py-2 text-sm font-semibold', view === k ? 'border-accent text-text' : 'border-transparent text-text-muted hover:text-text')}>{label}</button>
      ))}
    </div>
  );
  if (view === 'revenue') return <SalesRevenue views={views} />;
  return (
    <section aria-labelledby="sales-title">
      <PageTitle><span id="sales-title">SLK Activity Dashboard</span></PageTitle>
      {views}
      {view === 'activity' ? <SalesActivity /> : <SalesDaily />}
    </section>
  );
}
