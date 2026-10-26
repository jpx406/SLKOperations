import { Select } from '../components/Select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, FileSpreadsheet, Plus, Printer, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { SEVERITIES, SEVERITY_LABEL, type Severity } from '../../shared/emf';
import { MONTHS, filtersToQuery } from '../../shared/filters';
import { csv, workbook, type Cell } from '../../shared/xlsx';
import { ApiError, api, formatDate } from '../api';
import { useMe } from '../auth';
import { FilterBar, useFilters } from '../components/FilterBar';
import { Banner, Button, Card, EmptyState, Field, PageTitle, SeverityPill, Skeleton, cx, inputClass, inputSized } from '../components/ui';

// Failure Roster (S10): failures by month, the jobs not fully tracked, and the register with action status.

interface Row {
  id: string; occurred_on: string; well: string | null; rilr_refs: string[]; category: string | null; severity: Severity | null;
  action_status: 'open' | 'in_progress' | 'closed'; notes: string | null; incident_id: string | null; job_id: string | null; ticket_no: string | null;
  unit_number: string | null; report_id: string | null; log_no: string | null; npt_hours: number | null; what_happened: string | null;
}
interface GapJob { id: string; ticket_no: string | null; well: string | null; npt_hours: number }
interface Summary { byMonth: { month: string; n: number; severe: number }[]; nptWithout8mf: GapJob[]; failureNotInRoster: GapJob[] }

const ACTION_LABEL = { open: 'Open', in_progress: 'In progress', closed: 'Closed' } as const;
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const stamp = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

function save(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const HEADER = ['Date', 'Well', 'RILR', '8MF', 'Severity', 'Field ticket', 'Unit', 'Category', 'NPT h', 'Action status', 'What happened', 'Notes'];
const toCells = (r: Row): Cell[] => [r.occurred_on, r.well, r.rilr_refs.join(', '), r.log_no ?? 'No 8MF', r.severity ? SEVERITY_LABEL[r.severity] : null,
  r.ticket_no, r.unit_number, r.category, r.npt_hours, ACTION_LABEL[r.action_status], r.what_happened, r.notes];

export function FailureRoster() {
  const [filters] = useFilters();
  const [params, setParams] = useSearchParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const canEdit = !!me?.menus.failure_roster?.edit;
  const canDelete = !!me?.menus.failure_roster?.delete;
  const severity = params.get('severity') ?? '';
  const action = params.get('action') ?? '';
  const occurred = params.get('occurred') ?? '';
  const setP = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const base = filtersToQuery(filters);
  const qs = [base, severity && `severity=${severity}`, action && `action=${action}`].filter(Boolean).join('&');
  const listQs = [qs, occurred && `occurred=${occurred}`].filter(Boolean).join('&');
  const rows = useQuery({ queryKey: ['roster', listQs], queryFn: () => api<Row[]>(`/failure-roster?${listQs}`) });
  const summary = useQuery({ queryKey: ['roster-summary', qs], queryFn: () => api<Summary>(`/failure-roster/summary?${qs}`) });
  const [adding, setAdding] = useState(false);
  const [gapsOpen, setGapsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['roster'] }); qc.invalidateQueries({ queryKey: ['roster-summary'] }); };
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api(`/failure-roster/${id}`, { method: 'PATCH', json: body }),
    onSuccess: refresh, onError: (e: ApiError) => setError(e.message),
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/failure-roster/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: (e: ApiError) => setError(e.message) });

  const data = rows.data ?? [];
  const exportRows = (list: Row[], suffix: string, kind: 'xlsx' | 'csv') => {
    const cells = list.map(toCells);
    if (kind === 'xlsx') save(`failure-roster-${suffix}.xlsx`, workbook('Failure Roster', HEADER, cells, [11, 12, 12, 10, 12, 12, 9, 22, 7, 12, 40, 30]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    else save(`failure-roster-${suffix}.csv`, csv(HEADER, cells), 'text/csv;charset=utf-8');
  };
  const gaps = summary.data ? summary.data.nptWithout8mf.length + summary.data.failureNotInRoster.length : 0;
  const max = Math.max(1, ...(summary.data?.byMonth ?? []).map((m) => m.n));

  return (
    <section aria-labelledby="roster-title">
      <PageTitle aside={
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button size="sm" onClick={() => window.print()} disabled={!data.length}><Printer aria-hidden className="size-4" />PDF report</Button>
          <Button size="sm" onClick={() => exportRows(data, stamp(), 'csv')} disabled={!data.length}><Download aria-hidden className="size-4" />CSV</Button>
          <Button size="sm" onClick={() => exportRows(data, stamp(), 'xlsx')} disabled={!data.length}><FileSpreadsheet aria-hidden className="size-4" />XLSX</Button>
          {canEdit && <Button size="sm" variant="primary" onClick={() => setAdding(true)}><Plus aria-hidden className="size-4" />Add failure</Button>}
        </div>
      }><span id="roster-title">Failure roster</span></PageTitle>

      {summary.data && gaps > 0 && (
        <div className="mb-4 print:hidden">
          <Banner tone="warning" action={<Button size="sm" variant="ghost" aria-expanded={gapsOpen} onClick={() => setGapsOpen(!gapsOpen)}>{gapsOpen ? <ChevronDown aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4" />}{gapsOpen ? 'Hide' : 'Show'}</Button>}>
            {gaps} job{gaps === 1 ? '' : 's'} not fully tracked: {summary.data.nptWithout8mf.length} with NPT but no 8 Min. Facts · {summary.data.failureNotInRoster.length} flagged as failure but not in the roster
          </Banner>
          {gapsOpen && (
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
              {([['NPT without 8 Min. Facts', summary.data.nptWithout8mf], ['Failure not in the roster', summary.data.failureNotInRoster]] as const).map(([t, list]) => (
                <Card key={t}>
                  <h2 className="label-caps mb-2 text-text-muted">{t}</h2>
                  {!list.length ? <p className="text-xs text-text-subtle">None</p> : (
                    <ul className="space-y-1 text-sm">{list.map((j) => (
                      <li key={j.id}><Link className="font-mono underline" to={`/operation/jobs/${j.id}/execution`}>{j.ticket_no ?? 'no ticket'}</Link> <span className="text-text-muted">{j.well ?? ''} · {j.npt_hours} h NPT</span></li>
                    ))}</ul>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <FilterBar optionsPath="/filter-options" withStatus={false} />
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        <label className="flex items-center gap-2 text-xs text-text-muted">Severity
          <Select className={inputSized('h-(--layout-control-sm) w-40')} value={severity} onChange={(e) => setP('severity', e.target.value)}>
            <option value="">All</option>{SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}<option value="none">No 8MF (added by hand)</option>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-xs text-text-muted">Action
          <Select className={inputSized('h-(--layout-control-sm) w-36')} value={action} onChange={(e) => setP('action', e.target.value)}>
            <option value="">All</option>{Object.entries(ACTION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </label>
      </div>

      <Card className="mb-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="label-caps text-text-muted">Failures by month</h2>
          {occurred && (
            <span className="ml-auto flex flex-wrap items-center gap-2 text-xs print:hidden">
              Showing {monthLabel(occurred)}
              <Button size="sm" onClick={() => exportRows(data, occurred, 'xlsx')}>Excel</Button>
              <Button size="sm" onClick={() => window.print()}>PDF</Button>
              <Button size="sm" onClick={() => exportRows(data, occurred, 'csv')}>CSV</Button>
              <Button size="sm" variant="ghost" onClick={() => setP('occurred', '')}><X aria-hidden className="size-3.5" />All months</Button>
            </span>
          )}
        </div>
        {summary.isPending ? <Skeleton className="h-36" /> : !summary.data?.byMonth.length ? <p className="py-6 text-center text-sm text-text-subtle">No failures in this selection.</p> : (
          <div role="list" aria-label="Failures per month; select a month to list it" className="flex h-40 items-end gap-2 overflow-x-auto pt-4">
            {summary.data.byMonth.map((m) => (
              <button key={m.month} type="button" role="listitem" aria-pressed={occurred === m.month} aria-label={`${monthLabel(m.month)}: ${m.n} failure${m.n === 1 ? '' : 's'}, ${m.severe} major or worse`}
                onClick={() => setP('occurred', occurred === m.month ? '' : m.month)} className="group flex h-full w-14 shrink-0 flex-col items-center justify-end gap-1">
                <span className="font-mono text-xs">{m.n}</span>
                <span className={cx('flex w-full max-w-12 flex-col justify-end overflow-hidden rounded-t-sm', occurred && occurred !== m.month && 'opacity-40')} style={{ height: `${(m.n / max) * 100}%` }}>
                  <span className="w-full bg-sev-major" style={{ height: `${(m.severe / m.n) * 100}%` }} />
                  <span className="w-full flex-1 bg-accent group-hover:bg-accent-hover" />
                </span>
                <span className="text-xs whitespace-nowrap text-text-muted">{monthLabel(m.month)}</span>
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-text-subtle"><span className="mr-1 inline-block size-2 rounded-xs bg-sev-major align-middle" />major or catastrophic <span className="mr-1 ml-3 inline-block size-2 rounded-xs bg-accent align-middle" />other</p>
      </Card>

      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      {rows.isPending && <Skeleton className="h-64" />}
      {rows.data && !data.length && <EmptyState title="No failures match">Failures arrive here when an 8 Min. Facts report is saved, or when one is added by hand.</EmptyState>}
      {data.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[64rem] text-sm">
            <thead className="bg-surface-2"><tr className="text-left text-xs text-text-muted">
              {['#', 'Date', 'Well · RILR · 8MF', 'Field ticket', 'Category', 'Action status', ''].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-mono text-xs text-text-subtle">{data.length - i}</td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatDate(r.occurred_on)}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold">{r.well ?? '—'}</span>
                    {r.rilr_refs.length > 0 && <span className="ml-2 font-mono text-xs text-text-muted">{r.rilr_refs.join(', ')}</span>}
                    <span className="ml-2">{r.report_id ? <Link to={`/operation/8-min-facts/${r.report_id}`} className="inline-flex items-center gap-1.5"><span className="font-mono text-xs underline">{r.log_no}</span><SeverityPill severity={r.severity} /></Link> : <SeverityPill severity={null} />}</span>
                    {(r.what_happened || r.notes) && <span className="mt-0.5 block max-w-xl text-xs text-text-muted">{r.what_happened ?? r.notes}</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.job_id ? <Link className="underline" to={`/operation/jobs/${r.job_id}/execution`}>{r.ticket_no ?? 'no ticket'}</Link> : '—'}</td>
                  <td className="px-3 py-2">{r.category ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Select aria-label={`Action status for ${r.well ?? 'failure'} on ${r.occurred_on}`} className={cx(inputClass, 'h-(--layout-control-sm) w-36', r.action_status === 'open' && 'text-warning', r.action_status === 'closed' && 'text-success')}
                      disabled={!canEdit || patch.isPending} value={r.action_status} onChange={(e) => patch.mutate({ id: r.id, body: { action_status: e.target.value } })}>
                      {Object.entries(ACTION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </Select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!r.incident_id && canDelete && <Button size="sm" variant="ghost" aria-label="Remove this hand-added row" onClick={() => { if (window.confirm('Remove this failure from the roster?')) remove.mutate(r.id); }}><Trash2 aria-hidden className="size-3.5" /></Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {adding && <AddFailure onClose={(ok) => { setAdding(false); if (ok) refresh(); }} />}
    </section>
  );
}

function AddFailure({ onClose }: { onClose: (ok?: boolean) => void }) {
  const { data: me } = useMe();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<{ lists: Record<string, string[]> }>('/lookups'), staleTime: 300_000 });
  const [f, setF] = useState({ occurred_on: stamp(), well: '', category: '', severity: '', rilr: '', notes: '', country: me?.countries.length === 1 ? me.countries[0] : '' });
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({ mutationFn: () => api('/failure-roster', { method: 'POST', json: f }), onSuccess: () => onClose(true), onError: (e: ApiError) => setError(e.message) });
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="add-fail-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <form className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-pop" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <div className="mb-3 flex items-start gap-3">
          <h2 id="add-fail-title" className="flex-1 font-display text-lg font-bold">Add a failure by hand</h2>
          <Button size="sm" variant="ghost" aria-label="Close" onClick={() => onClose()}><X aria-hidden className="size-4" /></Button>
        </div>
        <p className="mb-4 text-sm text-text-muted">For events without an 8 Min. Facts report, such as older failures. Failures with NPT on a job belong in an 8 Min. Facts report.</p>
        {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(me?.countries.length ?? 0) > 1 && (
            <Field id="af-country" label="Country"><Select id="af-country" className={inputClass} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}><option value="">Choose…</option>{me?.countries.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          )}
          <Field id="af-on" label="Date" required><input id="af-on" type="date" className={inputClass} value={f.occurred_on} onChange={(e) => setF({ ...f, occurred_on: e.target.value })} /></Field>
          <Field id="af-well" label="Well"><input id="af-well" className={inputClass} value={f.well} onChange={(e) => setF({ ...f, well: e.target.value })} /></Field>
          <Field id="af-cat" label="Category"><Select id="af-cat" className={inputClass} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Choose…</option>{(lookups.data?.lists.failure_category ?? []).map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field id="af-sev" label="Severity"><Select id="af-sev" className={inputClass} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="">Not set</option>{SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}</Select></Field>
          <Field id="af-rilr" label="RILR numbers" hint="Separate with commas"><input id="af-rilr" className={inputClass} value={f.rilr} onChange={(e) => setF({ ...f, rilr: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field id="af-notes" label="Notes"><textarea id="af-notes" rows={3} className={cx(inputClass, 'h-auto py-2')} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
        </div>
        <div className="mt-4 flex gap-2"><Button type="submit" variant="primary" loading={add.isPending}>Add</Button><Button onClick={() => onClose()}>Cancel</Button></div>
      </form>
    </div>
  );
}
