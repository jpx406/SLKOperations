import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Printer, Search } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { activeFilterCount, filtersToQuery } from '../../shared/filters';
import { JOB_LOG_COLUMNS, displayValue, jobLogTable, type JobLogRow } from '../../shared/jobLog';
import { csv, workbook } from '../../shared/xlsx';
import { api } from '../api';
import { FilterBar, useFilters } from '../components/FilterBar';
import { AccountLegend, useAccountColors } from '../components/Accounts';
import { NO_ACCOUNT, byAccount, tint } from '../../shared/accounts';
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

// JRA state as a pill like the job status: sent waiting (ongoing colours), approved (completed), draft and rejected muted
const JRA_PILL: Record<string, string> = {
  draft: 'border-pill-canceled-border bg-pill-canceled-bg text-pill-canceled-fg',
  sent: 'border-pill-ongoing-border bg-pill-ongoing-bg text-pill-ongoing-fg',
  approved: 'border-pill-completed-border bg-pill-completed-bg text-pill-completed-fg',
  rejected: 'border-danger bg-danger-subtle text-danger',
};
function JraPill({ status }: { status: string }) {
  return <span className={cx('label-caps inline-flex rounded-pill border px-2 py-0.5', JRA_PILL[status] ?? JRA_PILL.draft)}>{status}</span>;
}

const accountCounts = (xs: { location: string | null }[]) => xs.reduce((m, x) => m.set(x.location?.trim() || NO_ACCOUNT, (m.get(x.location?.trim() || NO_ACCOUNT) ?? 0) + 1), new Map<string, number>());

export function JobLog() {
  const [filters] = useFilters();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = [filtersToQuery(filters), params.get('q') ? `q=${encodeURIComponent(params.get('q')!)}` : ''].filter(Boolean).join('&');
  const log = useQuery({ queryKey: ['job-log', query], queryFn: () => api<{ rows: JobLogRow[]; truncated: boolean; limit: number }>(`/job-log?${query}`), refetchInterval: 30_000 });
  const colorOf = useAccountColors();
  // grouped by account (name order), the server's order kept inside each account
  const groups = byAccount(log.data?.rows ?? [], (r) => r.location);
  const rows = groups.flatMap((g) => g.items);

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
          <Button onClick={() => window.print()} disabled={!rows.length}><Printer aria-hidden className="size-4" />Print</Button>
          <Button variant="primary" onClick={exportCsv} disabled={!rows.length}><Download aria-hidden className="size-4" />Download</Button>
          <Button onClick={exportXlsx} disabled={!rows.length}><FileSpreadsheet aria-hidden className="size-4" />XLSX</Button>
        </div>
      }>
        <span id="log-title">Job log</span>
        {log.data && <span className="ml-3 align-middle font-mono text-sm font-normal text-text-muted">{rows.length.toLocaleString()} job{rows.length === 1 ? '' : 's'}</span>}
      </PageTitle>
      <FilterBar optionsPath="/filter-options" variant="panel">
        <label className="col-span-2 block">
          <span className="label-caps mb-1 block text-text-muted">Search</span>
          <span className="relative block">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-subtle" />
            <input className={inputSized('w-full pl-9')} placeholder="Ticket, well, rig, DRSS" value={q} onChange={(e) => search(e.target.value)} />
          </span>
        </label>
      </FilterBar>
      {log.data && <AccountLegend counts={accountCounts(log.data.rows)} />}
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
          <table className="w-max min-w-full border-separate border-spacing-0 text-sm print:text-[7pt]">
            <caption className="sr-only">Job log, one row per job. Select a row to open the job.</caption>
            <thead className="sticky top-0 z-10 bg-surface-2 print:static">
              <tr>
                {JOB_LOG_COLUMNS.map((c, i) => (
                  <th key={c.key} scope="col" style={{ minWidth: `${c.width * 0.55}rem` }}
                    className={cx('label-caps border-b border-border px-3 py-3 text-left whitespace-nowrap text-text-muted', c.num && 'text-right', i === 0 && 'sticky left-0 z-20 bg-surface-2 print:static')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.account}>
                  <tr>
                    <th scope="colgroup" colSpan={JOB_LOG_COLUMNS.length} className="border-b border-border p-0 text-left">
                      <span className="sticky left-0 flex w-max items-center gap-2 px-3 py-1.5 font-display text-xs font-extrabold tracking-wide uppercase">
                        <i aria-hidden className="inline-block size-3 rounded-full border border-black/10" style={{ backgroundColor: colorOf(g.account) }} />
                        {g.account}<span className="font-mono font-medium text-text-muted">{g.items.length}</span>
                      </span>
                    </th>
                  </tr>
                  {g.items.map((r) => {
                    const bg = tint(colorOf(r.location), 16);
                    return (
                <tr key={r.id} tabIndex={0} className="group cursor-pointer" style={{ backgroundColor: bg }}
                  onClick={() => navigate(`/operation/jobs/${r.id}/design`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/operation/jobs/${r.id}/design`); }}>
                  {JOB_LOG_COLUMNS.map((c, i) => {
                    const v = displayValue(r, c.key);
                    return (
                      <td key={c.key} style={i === 0 ? { backgroundColor: bg ?? 'var(--color-surface)', boxShadow: colorOf(r.location) ? `inset 5px 0 ${colorOf(r.location)}` : undefined } : undefined}
                        className={cx('border-b border-border px-3 py-3 align-middle group-hover:brightness-95 group-focus-visible:brightness-95', c.num && 'text-right font-mono', c.mono && 'font-mono',
                        i === 0 && 'sticky left-0 pl-4 font-semibold text-accent-text print:static', c.key === 'sdm' || c.width >= 26 ? 'max-w-48 whitespace-normal' : 'whitespace-nowrap')}>
                        {c.key === 'status' ? <StatusPill status={r.status as JobStatus} />
                          : c.key === 'jra_status' ? (v ? <JraPill status={String(r.jra_status)} /> : <span className="text-text-subtle">—</span>)
                          : c.key === 'ticket_no' && !v ? <span className="font-normal text-text-subtle">no ticket</span>
                          : v ?? <span className="text-text-subtle">—</span>}
                      </td>
                    );
                  })}
                </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
