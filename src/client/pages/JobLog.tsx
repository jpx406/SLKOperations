import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Printer, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { activeFilterCount, filtersToQuery } from '../../shared/filters';
import { JOB_LOG_COLUMNS, displayValue, jobLogTable, type JobLogRow } from '../../shared/jobLog';
import { csv, workbook } from '../../shared/xlsx';
import { api, formatDate } from '../api';
import { FilterBar, useFilters } from '../components/FilterBar';
import { Banner, Button, EmptyState, PageTitle, Skeleton, StatusPill, cx, inputSized } from '../components/ui';
import type { JobStatus } from '../../shared/types';

const stamp = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

function save(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function JobLog() {
  const [filters] = useFilters();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = [filtersToQuery(filters), params.get('q') ? `q=${encodeURIComponent(params.get('q')!)}` : ''].filter(Boolean).join('&');
  const log = useQuery({ queryKey: ['job-log', query], queryFn: () => api<{ rows: JobLogRow[]; truncated: boolean; limit: number }>(`/job-log?${query}`), refetchInterval: 30_000 });
  const rows = log.data?.rows ?? [];

  const search = (v: string) => {
    setQ(v);
    const n = new URLSearchParams(params);
    if (v.trim()) n.set('q', v.trim()); else n.delete('q');
    setParams(n, { replace: true });
  };
  const exportXlsx = () => { const t = jobLogTable(rows); save(`job-log-${stamp()}.xlsx`, workbook('Job Log', t.header, t.rows, t.widths), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); };
  const exportCsv = () => { const t = jobLogTable(rows); save(`job-log-${stamp()}.csv`, csv(t.header, t.rows), 'text/csv;charset=utf-8'); };

  return (
    <section aria-labelledby="log-title">
      <PageTitle aside={
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <label className="relative">
            <span className="sr-only">Search ticket, well, rig or DRSS</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle" />
            <input className={inputSized('h-(--layout-control-sm) w-56 pl-8')} placeholder="Ticket, well, rig, DRSS" value={q} onChange={(e) => search(e.target.value)} />
          </label>
          <Button size="sm" onClick={() => window.print()} disabled={!rows.length}><Printer aria-hidden className="size-4" />Print</Button>
          <Button size="sm" onClick={exportCsv} disabled={!rows.length}><Download aria-hidden className="size-4" />CSV</Button>
          <Button size="sm" variant="primary" onClick={exportXlsx} disabled={!rows.length}><FileSpreadsheet aria-hidden className="size-4" />XLSX</Button>
        </div>
      }>
        <span id="log-title">Job log</span>
        {log.data && <span className="ml-3 align-middle font-mono text-sm font-normal text-text-muted">{rows.length.toLocaleString()} job{rows.length === 1 ? '' : 's'}</span>}
      </PageTitle>
      <FilterBar optionsPath="/filter-options" />
      <p className="mb-3 hidden text-xs print:block">
        Printed {stamp()}{activeFilterCount(filters) ? ` · filters: ${Object.entries(filters).map(([k, v]) => `${k} ${v?.join('/')}`).join('; ')}` : ''}
      </p>
      {log.data?.truncated && <div className="mb-3"><Banner tone="warning">Showing the latest {log.data.limit.toLocaleString()} jobs. Narrow the filters to see older ones.</Banner></div>}
      {log.isPending && <Skeleton className="h-96" />}
      {log.isError && <Banner tone="danger">{log.error.message}</Banner>}
      {log.data && !rows.length && (
        <EmptyState title={activeFilterCount(filters) || params.get('q') ? 'No jobs match these filters' : 'No jobs yet'}>
          {activeFilterCount(filters) || params.get('q') ? 'Clear a filter or the search to see more.' : <>Jobs appear here as soon as they are created on the <Link className="underline" to="/operation/jobs">job board</Link>.</>}
        </EmptyState>
      )}
      {rows.length > 0 && (
        <div className="max-h-[calc(100vh-15rem)] overflow-auto rounded-lg border border-border bg-surface print:max-h-none print:overflow-visible print:border-0">
          <table className="w-max min-w-full border-separate border-spacing-0 text-xs print:text-[7pt]">
            <caption className="sr-only">Job log, one row per job. Select a row to open the job.</caption>
            <thead className="sticky top-0 z-10 bg-surface-2 print:static">
              <tr>
                {JOB_LOG_COLUMNS.map((c, i) => (
                  <th key={c.key} scope="col" style={{ minWidth: `${c.width * 0.55}rem` }}
                    className={cx('border-b border-border px-2.5 py-2 text-left font-semibold whitespace-nowrap text-text-muted', c.num && 'text-right', i === 0 && 'sticky left-0 z-20 bg-surface-2 print:static')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} tabIndex={0} className="cursor-pointer hover:bg-surface-2 focus-visible:bg-surface-2"
                  onClick={() => navigate(`/operation/jobs/${r.id}/design`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/operation/jobs/${r.id}/design`); }}>
                  {JOB_LOG_COLUMNS.map((c, i) => {
                    const v = displayValue(r, c.key);
                    return (
                      <td key={c.key} className={cx('border-b border-border px-2.5 py-1.5 align-top', c.num && 'text-right font-mono', c.mono && 'font-mono',
                        i === 0 && 'sticky left-0 bg-surface font-semibold print:static', c.width >= 26 ? 'max-w-80 whitespace-normal' : 'whitespace-nowrap')}>
                        {c.key === 'status' ? <StatusPill status={r.status as JobStatus} />
                          : (c.key === 'start_date' || c.key === 'end_date') && v ? formatDate(String(v))
                          : c.key === 'ticket_no' && !v ? <span className="font-normal text-text-subtle">no ticket</span>
                          : v ?? <span className="text-text-subtle">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
