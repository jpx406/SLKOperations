import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, ChevronRight, FileText, History, Mail, Plus, Printer, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { SEVERITY_LABEL, SEVERITY_MATRIX, reportTotals, severityFromNpt, type Severity } from '../../shared/emf';
import type { Job, JobCrew } from '../../shared/types';
import { ApiError, api, formatDate } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, EmptyState, Field, PageTitle, SeverityPill, Skeleton, cx, inputClass, inputSized, rovingKeys } from '../components/ui';

// 8 Min. Facts: the list (S11) and the report editor (S12).

interface Incident {
  id?: string; key: string; what_happened: string; occurred_on: string; occurred_time: string; npt_hours: string; failed_items: string[];
  immediate_actions: string; current_situation: string; informed_client: string; informed_nesr: string; category: string; open: boolean;
}
interface Report {
  id: string; log_no: string; title: string; rilr_no: string | null; rig: string | null; well: string | null; crew_text: string | null;
  status: 'saved' | 'sent'; current_version: number; total_npt: number; severity: Severity; created_by: string | null; last_saved_by: string | null;
  last_saved_at: string; sent_by: string | null; sent_at: string | null; job_id: string; ticket_no: string | null; unit_number: string | null; start_date: string | null;
  incidents: (Omit<Incident, 'key' | 'open' | 'npt_hours'> & { npt_hours: number; severity: Severity })[];
  versions: { version: number; saved_by: string | null; saved_at: string }[];
}
interface ListRow {
  id: string; log_no: string; title: string; well: string | null; status: 'saved' | 'sent'; current_version: number; total_npt: number; severity: Severity;
  created_by: string | null; last_saved_at: string; sent_by: string | null; ticket_no: string | null; incidents: number;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
let keySeq = 0;
const blankIncident = (date = today()): Incident => ({
  key: `n${++keySeq}`, what_happened: '', occurred_on: date, occurred_time: '', npt_hours: '', failed_items: [], immediate_actions: '',
  current_situation: '', informed_client: '', informed_nesr: '', category: '', open: true,
});

export function EightMinFactsList() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const q = params.get('q') ?? '';
  const { data: me } = useMe();
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const list = useQuery({ queryKey: ['emf', status, q], queryFn: () => api<ListRow[]>(`/emf?${new URLSearchParams({ ...(status && { status }), ...(q && { q }) })}`) });
  const navigate = useNavigate();
  // the backlog: jobs with NPT or a failure whose 8 Min. Facts isn't done yet
  const jobs = useQuery({ queryKey: ['jobs', '', 'all'], queryFn: () => api<Job[]>('/jobs?q=&status=all'), enabled: !!me?.menus.eight_min_facts?.edit });
  const backlog = (jobs.data ?? []).filter((j) => (j.npt_hours > 0 || j.failure === 'yes') && j.eight_min_facts_done !== 'yes' && j.status !== 'canceled');
  return (
    <section aria-labelledby="emf-title">
      <PageTitle aside={me?.menus.eight_min_facts?.edit && <Link to="/operation/8-min-facts/new" className="inline-flex h-(--layout-control-md) items-center gap-2 rounded-md bg-accent px-3.5 text-sm font-semibold text-on-accent hover:bg-accent-hover"><Plus aria-hidden className="size-4" />New 8 Min. Facts</Link>}>
        <span id="emf-title">8 Min. Facts</span>
      </PageTitle>
      <p className="-mt-3 mb-4 text-sm text-text-muted">One report per failure or NPT event, per field ticket. Saving updates the job’s NPT and the Failure Roster; print, Word and email from the report.</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Status" onKeyDown={rovingKeys} className="flex gap-1.5">
          {[['', 'All'], ['saved', 'Saved'], ['sent', 'Sent']].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={status === v} tabIndex={status === v ? 0 : -1} onClick={() => set('status', v)}
              className={cx('h-(--layout-control-sm) rounded-pill border px-3.5 text-sm font-semibold', status === v ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>{l}</button>
          ))}
        </div>
        <label className="relative ml-auto">
          <span className="sr-only">Search log number, title, well or ticket</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle" />
          <input className={inputSized('h-(--layout-control-sm) w-64 pl-8')} placeholder="Log #, title, well, ticket" defaultValue={q} onChange={(e) => set('q', e.target.value.trim())} />
        </label>
      </div>
      {backlog.length > 0 && !q && !status && (
        <Card className="mb-4">
          <h2 className="label-caps mb-2 text-warning">Waiting for an 8 Min. Facts · {backlog.length}</h2>
          <ul className="divide-y divide-border">
            {backlog.slice(0, 8).map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="font-display font-bold">{j.ticket_no ?? 'No ticket'}</span>
                <span className="text-text-muted">{j.well ?? 'well —'} · {j.unit_number ?? 'no unit'} · {j.start_date ? formatDate(j.start_date) : 'no date'}</span>
                <span className="font-mono text-xs text-warning">{j.npt_hours > 0 ? `${j.npt_hours} h NPT` : ''}{j.npt_hours > 0 && j.failure === 'yes' ? ' · ' : ''}{j.failure === 'yes' ? 'failure' : ''}</span>
                <Link to={`/operation/8-min-facts/new?job=${encodeURIComponent(j.id)}`} className="ml-auto text-sm font-semibold underline">Start report</Link>
              </li>
            ))}
          </ul>
          {backlog.length > 8 && <p className="mt-2 text-xs text-text-subtle">{backlog.length - 8} more. The Failure Roster lists them all.</p>}
        </Card>
      )}
      {list.isPending && <Skeleton className="h-64" />}
      {list.isError && <Banner tone="danger">{list.error.message}</Banner>}
      {list.data && !list.data.length && <EmptyState title={q || status ? 'No reports match' : 'No 8 Min. Facts yet'}>{q || status ? 'Clear the search or the status filter.' : 'Start one from a field ticket when a failure or NPT happens.'}</EmptyState>}
      {!!list.data?.length && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="bg-surface-2"><tr className="text-left text-xs text-text-muted">
              {['Log #', 'Ticket', 'Well', 'Title', 'Incidents', 'Total NPT', 'Severity', 'Status', 'Version', 'Created by', 'Last saved'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id} tabIndex={0} className="cursor-pointer border-t border-border hover:bg-surface-2" onClick={() => navigate(`/operation/8-min-facts/${r.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/operation/8-min-facts/${r.id}`); }}>
                  <th scope="row" className="px-3 py-2 text-left font-mono font-semibold">{r.log_no}</th>
                  <td className="px-3 py-2 font-mono text-xs">{r.ticket_no ?? '—'}</td>
                  <td className="px-3 py-2">{r.well ?? '—'}</td>
                  <td className="px-3 py-2">{r.title}</td>
                  <td className="px-3 py-2 font-mono">{r.incidents}</td>
                  <td className="px-3 py-2 font-mono">{r.total_npt} h</td>
                  <td className="px-3 py-2"><SeverityPill severity={r.severity} /></td>
                  <td className="px-3 py-2 text-xs">{r.status === 'sent' ? <span className="font-semibold text-success">Sent{r.sent_by ? ` by ${r.sent_by}` : ''}</span> : 'Saved'}</td>
                  <td className="px-3 py-2 font-mono text-xs">v{r.current_version}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">{r.created_by ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-text-muted">{when(r.last_saved_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}

const toIncidents = (r: Report): Incident[] => r.incidents.map((i) => ({
  id: i.id, key: i.id ?? `n${++keySeq}`, what_happened: i.what_happened, occurred_on: i.occurred_on, occurred_time: i.occurred_time ?? '',
  npt_hours: String(i.npt_hours ?? ''), failed_items: i.failed_items ?? [], immediate_actions: i.immediate_actions ?? '', current_situation: i.current_situation ?? '',
  informed_client: i.informed_client ?? '', informed_nesr: i.informed_nesr ?? '', category: i.category ?? '', open: false,
}));

export function EightMinFactsEditor() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canEdit = !!me?.menus.eight_min_facts?.edit;
  const reportQ = useQuery({ queryKey: ['emf-report', id], queryFn: () => api<Report>(`/emf/${id}`), enabled: !isNew });
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<{ lists: Record<string, string[]> }>('/lookups'), staleTime: 300_000 });
  const categories = lookups.data?.lists.failure_category ?? [];

  const [job, setJob] = useState<Pick<Job, 'id' | 'ticket_no' | 'well' | 'rig' | 'unit_number' | 'start_date'> | null>(null);
  const [head, setHead] = useState({ title: '', rilr_no: '', crew_text: '' });
  const [incidents, setIncidents] = useState<Incident[]>([blankIncident()]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<'history' | 'email' | null>(null);

  const report = reportQ.data;
  // started from the backlog: the job is already chosen
  const [params] = useSearchParams();
  const fromJob = isNew ? params.get('job') : null;
  useEffect(() => {
    if (!fromJob) return;
    api<Job>(`/jobs/${encodeURIComponent(fromJob)}`).then((j) => pickJob(j)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromJob]);
  useEffect(() => {
    if (!report) return;
    setJob({ id: report.job_id, ticket_no: report.ticket_no, well: report.well, rig: report.rig, unit_number: report.unit_number, start_date: report.start_date });
    setHead({ title: report.title, rilr_no: report.rilr_no ?? '', crew_text: report.crew_text ?? '' });
    setIncidents(toIncidents(report));
    setDirty(false);
  }, [report]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const totals = useMemo(() => reportTotals(incidents.map((i) => ({ npt_hours: Number(i.npt_hours) || 0 }))), [incidents]);
  const edit = (key: string, patch: Partial<Incident>) => { setIncidents((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i))); setDirty(true); };
  const move = (idx: number, by: number) => { setIncidents((list) => { const n = [...list]; [n[idx], n[idx + by]] = [n[idx + by], n[idx]]; return n; }); setDirty(true); };

  const pickJob = async (j: NonNullable<typeof job>) => {
    setJob(j);
    setDirty(true);
    setIncidents((list) => list.map((i) => (i.what_happened ? i : { ...i, occurred_on: j.start_date ?? i.occurred_on })));
    // crew prefilled from the job, still editable
    const crew = await api<JobCrew>(`/jobs/${j.id}/crew`).catch(() => null);
    if (crew?.crew.length && !head.crew_text) setHead((h) => ({ ...h, crew_text: crew.crew.map((m) => m.full_name).join(', ') }));
  };

  const save = async () => {
    if (!job) { setError('Pick the job (field ticket) first'); return; }
    setSaving(true); setError(null); setNotice(null);
    const body = {
      job_id: job.id, ...head, expectedVersion: report?.current_version,
      incidents: incidents.map(({ key: _k, open: _o, ...i }) => ({ ...i, npt_hours: i.npt_hours === '' ? 0 : Number(i.npt_hours) })),
    };
    try {
      const res = isNew ? await api<{ report: Report }>('/emf', { method: 'POST', json: body }) : await api<{ report: Report }>(`/emf/${id}`, { method: 'PUT', json: body });
      qc.setQueryData(['emf-report', res.report.id], res.report);
      qc.invalidateQueries({ queryKey: ['emf'] });
      qc.invalidateQueries({ queryKey: ['job', job.id] });
      setDirty(false);
      setNotice(`Saved as v${res.report.current_version}. The job’s NPT, Failure and 8MF fields and the Failure Roster are updated.`);
      if (isNew) navigate(`/operation/8-min-facts/${res.report.id}`, { replace: true });
    } catch (e) { setError((e as ApiError).message); } finally { setSaving(false); }
  };

  if (!isNew && reportQ.isPending) return <Skeleton className="h-96" />;
  if (!isNew && reportQ.isError) return <Banner tone="danger" action={<Link className="underline" to="/operation/8-min-facts">Back</Link>}>{reportQ.error.message}</Banner>;
  const readOnly = !canEdit;

  return (
    <section aria-labelledby="emf-ed-title" className="emf-print">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/operation/8-min-facts" className="inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-xs font-semibold hover:bg-surface-3 print:hidden"><ArrowLeft aria-hidden className="size-4" />8 Min. Facts</Link>
        <h1 id="emf-ed-title" className="min-w-0 truncate font-display text-xl font-extrabold uppercase">{head.title || (isNew ? 'New 8 Min. Facts' : report?.title)}</h1>
        {report && <span className="font-mono text-sm text-text-muted">{report.log_no} · v{report.current_version}</span>}
        <span role="status" aria-live="polite" className="text-xs font-semibold">
          {dirty ? <span id="mf-export-hint" className="text-text-muted">Unsaved changes. Save to print or export.</span> : report ? <span className="inline-flex items-center gap-1 text-success"><Check aria-hidden className="size-3.5" />All changes saved</span> : null}
        </span>
        <div className="ml-auto flex flex-wrap gap-2 print:hidden">
          {canEdit && <Button variant="primary" onClick={save} loading={saving} disabled={!dirty && !!report}>Save</Button>}
          <Button onClick={() => window.print()} disabled={!report || dirty} aria-describedby="mf-export-hint"><Printer aria-hidden className="size-4" />Print / PDF</Button>
          <Button onClick={() => report && downloadWord(report)} disabled={!report || dirty} aria-describedby="mf-export-hint"><FileText aria-hidden className="size-4" />Word</Button>
          {canEdit && <Button onClick={() => setPanel('email')} disabled={!report || dirty}><Mail aria-hidden className="size-4" />Email…</Button>}
          <Button onClick={() => setPanel('history')} disabled={!report}><History aria-hidden className="size-4" />History</Button>
        </div>
      </div>
      {report && (
        <p className="-mt-2 mb-4 text-xs text-text-subtle">
          Created by {report.created_by ?? '—'} · last saved {when(report.last_saved_at)} by {report.last_saved_by ?? '—'}
          {report.sent_at && <> · {report.status === 'sent' ? 'sent' : 'last sent (before later changes)'} {when(report.sent_at)} by {report.sent_by}</>}
        </p>
      )}
      {(dirty && report) && <p className="mb-3 text-xs text-text-subtle print:hidden">Save before printing, exporting or emailing, so the document matches what is on file.</p>}
      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}
      {notice && <div className="mb-4"><Banner tone="success">{notice}</Banner></div>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card>
            <h2 className="label-caps mb-3 text-text-muted">Report header</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                {isNew && !job ? <JobPicker onPick={pickJob} disabled={readOnly} /> : job && (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
                    <span><span className="text-text-muted">Ticket</span> <Link className="font-mono font-semibold underline" to={`/operation/jobs/${job.id}/execution`}>{job.ticket_no ?? 'no ticket'}</Link></span>
                    <span><span className="text-text-muted">Well</span> {job.well ?? '—'}</span>
                    <span><span className="text-text-muted">Rig</span> {job.rig ?? '—'}</span>
                    <span><span className="text-text-muted">Unit</span> <span className="font-mono">{job.unit_number ?? '—'}</span></span>
                    {isNew && <Button size="sm" variant="ghost" className="ml-auto print:hidden" onClick={() => setJob(null)}>Change</Button>}
                  </div>
                )}
              </div>
              <Field id="emf-title-in" label="Title" required>
                <input id="emf-title-in" className={inputClass} disabled={readOnly} value={head.title} placeholder="e.g. Wire parted at 8,200 ft"
                  onChange={(e) => { setHead({ ...head, title: e.target.value }); setDirty(true); }} />
              </Field>
              <Field id="emf-rilr" label="RILR number">
                <input id="emf-rilr" className={inputClass} disabled={readOnly} value={head.rilr_no} onChange={(e) => { setHead({ ...head, rilr_no: e.target.value }); setDirty(true); }} />
              </Field>
              <div className="md:col-span-2">
                <Field id="emf-crew" label="Crew" hint="Filled from the job’s crew; edit if others were on site">
                  <input id="emf-crew" className={inputClass} disabled={readOnly} value={head.crew_text} onChange={(e) => { setHead({ ...head, crew_text: e.target.value }); setDirty(true); }} />
                </Field>
              </div>
            </div>
          </Card>

          {incidents.map((inc, idx) => {
            const sev = severityFromNpt(Number(inc.npt_hours) || 0);
            return (
              <Card key={inc.key}>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" aria-expanded={inc.open} onClick={() => edit(inc.key, { open: !inc.open })} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    {inc.open ? <ChevronDown aria-hidden className="size-4 shrink-0 print:hidden" /> : <ChevronRight aria-hidden className="size-4 shrink-0 print:hidden" />}
                    <span className="font-display text-base font-bold">Incident {idx + 1}</span>
                    <span className="min-w-0 truncate text-sm text-text-muted">{inc.what_happened || 'not described yet'}</span>
                  </button>
                  <span className="font-mono text-xs">{Number(inc.npt_hours) || 0} h</span>
                  <SeverityPill severity={sev} auto />
                  {!readOnly && (
                    <span className="flex gap-1 print:hidden">
                      <Button size="sm" variant="ghost" aria-label={`Move incident ${idx + 1} up`} disabled={idx === 0} onClick={() => move(idx, -1)}><ArrowUp aria-hidden className="size-3.5" /></Button>
                      <Button size="sm" variant="ghost" aria-label={`Move incident ${idx + 1} down`} disabled={idx === incidents.length - 1} onClick={() => move(idx, 1)}><ArrowDown aria-hidden className="size-3.5" /></Button>
                      <Button size="sm" variant="ghost" aria-label={`Remove incident ${idx + 1}`} disabled={incidents.length === 1}
                        onClick={() => { setIncidents((l) => l.filter((x) => x.key !== inc.key)); setDirty(true); }}><Trash2 aria-hidden className="size-3.5" /></Button>
                    </span>
                  )}
                </div>
                <div className={cx('mt-4 grid-cols-1 gap-4 md:grid-cols-3', inc.open ? 'grid' : 'hidden print:grid')}>
                  <div className="md:col-span-3">
                    <Field id={`${inc.key}-what`} label="What happened" required>
                      <textarea id={`${inc.key}-what`} rows={3} className={cx(inputClass, 'h-auto py-2')} disabled={readOnly} value={inc.what_happened} onChange={(e) => edit(inc.key, { what_happened: e.target.value })} />
                    </Field>
                  </div>
                  <Field id={`${inc.key}-on`} label="Date" required><input id={`${inc.key}-on`} type="date" className={inputClass} disabled={readOnly} value={inc.occurred_on} onChange={(e) => edit(inc.key, { occurred_on: e.target.value })} /></Field>
                  <Field id={`${inc.key}-at`} label="Time" hint="Site time"><input id={`${inc.key}-at`} type="time" className={inputClass} disabled={readOnly} value={inc.occurred_time} onChange={(e) => edit(inc.key, { occurred_time: e.target.value })} /></Field>
                  <Field id={`${inc.key}-npt`} label="NPT" unit="h" hint={`Severity ${SEVERITY_LABEL[sev].toLowerCase()} (auto)`}>
                    <input id={`${inc.key}-npt`} type="number" min={0} step="any" inputMode="decimal" className={cx(inputClass, 'pr-8')} disabled={readOnly} value={inc.npt_hours} onChange={(e) => edit(inc.key, { npt_hours: e.target.value })} />
                  </Field>
                  <Field id={`${inc.key}-cat`} label="Category">
                    <select id={`${inc.key}-cat`} className={inputClass} disabled={readOnly} value={inc.category} onChange={(e) => edit(inc.key, { category: e.target.value })}>
                      <option value="">Choose…</option>
                      {[...new Set([...categories, ...(inc.category ? [inc.category] : [])])].map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </Field>
                  <div className="md:col-span-2"><FailedItems items={inc.failed_items} readOnly={readOnly} idPrefix={inc.key} onChange={(failed_items) => edit(inc.key, { failed_items })} /></div>
                  <div className="md:col-span-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field id={`${inc.key}-act`} label="Immediate actions"><textarea id={`${inc.key}-act`} rows={2} className={cx(inputClass, 'h-auto py-2')} disabled={readOnly} value={inc.immediate_actions} onChange={(e) => edit(inc.key, { immediate_actions: e.target.value })} /></Field>
                    <Field id={`${inc.key}-sit`} label="Current situation"><textarea id={`${inc.key}-sit`} rows={2} className={cx(inputClass, 'h-auto py-2')} disabled={readOnly} value={inc.current_situation} onChange={(e) => edit(inc.key, { current_situation: e.target.value })} /></Field>
                    <Field id={`${inc.key}-cli`} label="Client informed (who, when)"><input id={`${inc.key}-cli`} className={inputClass} disabled={readOnly} value={inc.informed_client} onChange={(e) => edit(inc.key, { informed_client: e.target.value })} /></Field>
                    <Field id={`${inc.key}-nesr`} label="NESR informed (who, when)"><input id={`${inc.key}-nesr`} className={inputClass} disabled={readOnly} value={inc.informed_nesr} onChange={(e) => edit(inc.key, { informed_nesr: e.target.value })} /></Field>
                  </div>
                </div>
              </Card>
            );
          })}
          {!readOnly && <Button className="print:hidden" onClick={() => { setIncidents((l) => [...l, blankIncident(job?.start_date ?? today())]); setDirty(true); }}><Plus aria-hidden className="size-4" />Add incident</Button>}
        </div>

        <aside className="space-y-4">
          <Card>
            <h2 className="label-caps mb-3 text-text-muted">Report totals</h2>
            <dl className="grid grid-cols-3 gap-3 text-center" aria-live="polite">
              <div><dt className="text-xs text-text-muted">Incidents</dt><dd className="font-display text-kpi font-bold">{incidents.length}</dd></div>
              <div><dt className="text-xs text-text-muted">NPT</dt><dd className="font-display text-kpi font-bold">{totals.npt}<span className="text-sm"> h</span></dd></div>
              <div><dt className="text-xs text-text-muted">Severity</dt><dd className="mt-2"><SeverityPill severity={totals.severity} /></dd></div>
            </dl>
            <p className="mt-3 border-t border-border pt-3 text-xs text-text-muted print:hidden">
              On save: the job’s NPT becomes the sum of its 8 Min. Facts, Failure and 8MF are set to Yes, and the Failure Roster gets one row per incident.
            </p>
          </Card>
          <Card className="print:hidden">
            <h2 className="label-caps mb-2 text-text-muted">Severity reference</h2>
            <table className="w-full text-xs">
              <caption className="sr-only">Severity by NPT. The row for this report is highlighted.</caption>
              <tbody>
                {SEVERITY_MATRIX.map((m) => (
                  <tr key={m.severity} aria-current={m.severity === totals.severity || undefined} className={cx('border-t border-border', m.severity === totals.severity && 'bg-surface-2')}>
                    <td className="py-1.5 pr-2 align-top"><SeverityPill severity={m.severity} /></td>
                    <td className="py-1.5 pr-2 align-top font-mono whitespace-nowrap">{m.band}</td>
                    <td className="py-1.5 align-top text-text-muted">{m.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </aside>
      </div>
      {panel === 'history' && report && <HistoryPanel report={report} onClose={() => setPanel(null)} />}
      {panel === 'email' && report && <EmailPanel report={report} onClose={(sent) => { setPanel(null); if (sent) { qc.setQueryData(['emf-report', report.id], sent); qc.invalidateQueries({ queryKey: ['emf'] }); } }} />}
    </section>
  );
}

function FailedItems({ items, readOnly, idPrefix, onChange }: { items: string[]; readOnly: boolean; idPrefix: string; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => { if (draft.trim()) { onChange([...items, draft.trim()]); setDraft(''); } };
  return (
    <div>
      <label htmlFor={`${idPrefix}-item`} className="label-caps mb-1.5 block text-text-muted">What failed</label>
      <ul className="mb-2 flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <li key={`${it}-${i}`} className="inline-flex items-center gap-1 rounded-pill border border-border bg-surface-2 py-0.5 pr-1 pl-2.5 text-xs">
            {it}
            {!readOnly && <button type="button" aria-label={`Remove ${it}`} className="rounded-pill p-0.5 hover:bg-surface-3 print:hidden" onClick={() => onChange(items.filter((_, j) => j !== i))}><X aria-hidden className="size-3" /></button>}
          </li>
        ))}
        {!items.length && <li className="text-xs text-text-subtle">Nothing listed</li>}
      </ul>
      {!readOnly && (
        <div className="flex gap-2 print:hidden">
          <input id={`${idPrefix}-item`} className={cx(inputClass, 'h-(--layout-control-sm)')} placeholder="e.g. 0.125 in wire, rope socket" value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <Button size="sm" onClick={add} disabled={!draft.trim()}><Plus aria-hidden className="size-3.5" />Add item</Button>
        </div>
      )}
    </div>
  );
}

function JobPicker({ onPick, disabled }: { onPick: (j: Pick<Job, 'id' | 'ticket_no' | 'well' | 'rig' | 'unit_number' | 'start_date'>) => void; disabled: boolean }) {
  const [q, setQ] = useState('');
  const jobs = useQuery({ queryKey: ['jobs', q, 'all'], queryFn: () => api<Job[]>(`/jobs?q=${encodeURIComponent(q)}&status=all`), enabled: !disabled });
  return (
    <Field id="emf-job" label="Field ticket" required hint="Search by ticket, well, rig or unit; rig, well and crew are filled from the job">
      <div>
        <input id="emf-job" className={inputClass} disabled={disabled} placeholder="Search jobs" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="mt-1 max-h-56 overflow-y-auto rounded-md border border-border" aria-label="Matching jobs">
          {(jobs.data ?? []).slice(0, 30).map((j) => (
            <li key={j.id}>
              <button type="button" className="flex w-full flex-wrap gap-x-3 px-3 py-1.5 text-left text-sm hover:bg-surface-2" onClick={() => onPick(j)}>
                <span className="font-mono font-semibold">{j.ticket_no ?? 'no ticket'}</span>
                <span>{j.well ?? 'no well'}</span><span className="text-text-muted">{j.unit_number ?? '—'} · {j.start_date ? formatDate(j.start_date) : 'no date'}</span>
              </button>
            </li>
          ))}
          {jobs.data && !jobs.data.length && <li className="px-3 py-2 text-xs text-text-subtle">No jobs match.</li>}
        </ul>
      </div>
    </Field>
  );
}

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="emf-panel-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4 print:hidden" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-pop">
        <div className="mb-4 flex items-start gap-3">
          <h2 id="emf-panel-title" className="flex-1 font-display text-lg font-bold">{title}</h2>
          <Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}><X aria-hidden className="size-4" /></Button>
        </div>
        {children}
      </div>
    </div>
  );
}

function HistoryPanel({ report, onClose }: { report: Report; onClose: () => void }) {
  const [v, setV] = useState<number | null>(null);
  const snap = useQuery({ queryKey: ['emf-version', report.id, v], queryFn: () => api<{ snapshot: { title: string; total_npt: number; severity: Severity; incidents: { what_happened: string; npt_hours: number; occurred_on: string }[] } }>(`/emf/${report.id}/versions/${v}`), enabled: v !== null });
  return (
    <Panel title={`History of ${report.log_no}`} onClose={onClose}>
      <p className="mb-3 text-sm text-text-muted">Every save is kept and can’t be changed. Pick a version to read it.</p>
      <ul className="mb-4 divide-y divide-border rounded-md border border-border">
        {report.versions.map((x) => (
          <li key={x.version}>
            <button type="button" aria-current={v === x.version || undefined} onClick={() => setV(x.version)} className={cx('flex w-full gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2', v === x.version && 'bg-surface-2')}>
              <span className="font-mono font-semibold">v{x.version}</span><span className="flex-1">{x.saved_by ?? '—'}</span><span className="font-mono text-xs text-text-muted">{when(x.saved_at)}</span>
            </button>
          </li>
        ))}
      </ul>
      {v !== null && snap.isPending && <Skeleton className="h-24" />}
      {snap.data && (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-semibold">{snap.data.snapshot.title} · {snap.data.snapshot.total_npt} h · <SeverityPill severity={snap.data.snapshot.severity} /></p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {snap.data.snapshot.incidents.map((i, n) => <li key={n}><span className="font-mono text-xs">{i.occurred_on} · {i.npt_hours} h</span> {i.what_happened}</li>)}
          </ol>
        </div>
      )}
    </Panel>
  );
}

const plainSummary = (r: Report) => [
  `${r.log_no} v${r.current_version}: ${r.title}`,
  `Ticket ${r.ticket_no ?? '—'} · Well ${r.well ?? '—'} · Rig ${r.rig ?? '—'} · Unit ${r.unit_number ?? '—'}${r.rilr_no ? ` · RILR ${r.rilr_no}` : ''}`,
  `Total NPT ${r.total_npt} h · Severity ${SEVERITY_LABEL[r.severity]}`,
  '',
  ...r.incidents.flatMap((i, n) => [
    `Incident ${n + 1} (${i.occurred_on}${i.occurred_time ? ` ${i.occurred_time}` : ''}, ${i.npt_hours} h, ${SEVERITY_LABEL[i.severity]})`,
    `What happened: ${i.what_happened}`,
    ...(i.failed_items?.length ? [`What failed: ${i.failed_items.join(', ')}`] : []),
    ...(i.immediate_actions ? [`Immediate actions: ${i.immediate_actions}`] : []),
    ...(i.current_situation ? [`Current situation: ${i.current_situation}`] : []),
    '',
  ]),
].join('\n');

function EmailPanel({ report, onClose }: { report: Report; onClose: (sent?: Report) => void }) {
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const valid = to.split(/[,;]/).map((x) => x.trim()).filter(Boolean).every((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)) && to.trim().length > 0;
  const send = async () => {
    // the mail app does the sending; SLK Ops records that it was sent
    const href = `mailto:${encodeURIComponent(to.trim()).replace(/%40/g, '@').replace(/%2C/g, ',')}?subject=${encodeURIComponent(`8 Min. Facts ${report.log_no}: ${report.title}`)}&body=${encodeURIComponent(plainSummary(report))}`;
    window.location.href = href;
    try { const res = await api<{ report: Report }>(`/emf/${report.id}/sent`, { method: 'POST', json: { to } }); onClose(res.report); } catch (e) { setError((e as Error).message); }
  };
  return (
    <Panel title={`Email ${report.log_no}`} onClose={() => onClose()}>
      <p className="mb-3 text-sm text-text-muted">Opens your mail app with the report summary, then marks the report as sent. Attach the PDF from Print if the recipient needs it.</p>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      <Field id="emf-to" label="To" hint="Separate several addresses with commas"><input id="emf-to" type="text" inputMode="email" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-surface-2 p-3 text-xs whitespace-pre-wrap">{plainSummary(report)}</pre>
      <div className="mt-4 flex gap-2"><Button variant="primary" disabled={!valid} onClick={send}><Mail aria-hidden className="size-4" />Open mail app</Button><Button onClick={() => onClose()}>Cancel</Button></div>
    </Panel>
  );
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A Word document (HTML that Word opens as .doc), so no conversion library is needed. */
function downloadWord(r: Report) {
  const row = (k: string, v: unknown) => (v ? `<tr><th align="left" style="padding:2pt 8pt 2pt 0;color:#555">${esc(k)}</th><td>${esc(v)}</td></tr>` : '');
  const html = `<html><head><meta charset="utf-8"><title>${esc(r.log_no)}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt}h1{font-size:16pt}h2{font-size:13pt;margin-top:14pt}table{border-collapse:collapse}</style></head><body>
<h1>8 Min. Facts ${esc(r.log_no)}: ${esc(r.title)}</h1>
<table>${row('Version', `v${r.current_version}`)}${row('Field ticket', r.ticket_no)}${row('Well', r.well)}${row('Rig', r.rig)}${row('Unit', r.unit_number)}${row('RILR', r.rilr_no)}${row('Crew', r.crew_text)}${row('Total NPT', `${r.total_npt} h`)}${row('Severity', SEVERITY_LABEL[r.severity])}${row('Last saved', `${when(r.last_saved_at)} by ${r.last_saved_by ?? '—'}`)}</table>
${r.incidents.map((i, n) => `<h2>Incident ${n + 1}</h2><table>${row('When', `${i.occurred_on} ${i.occurred_time ?? ''}`)}${row('NPT', `${i.npt_hours} h (${SEVERITY_LABEL[i.severity]})`)}${row('Category', i.category)}${row('What happened', i.what_happened)}${row('What failed', i.failed_items?.join(', '))}${row('Immediate actions', i.immediate_actions)}${row('Current situation', i.current_situation)}${row('Client informed', i.informed_client)}${row('NESR informed', i.informed_nesr)}</table>`).join('')}
</body></html>`;
  const url = URL.createObjectURL(new Blob(['﻿', html], { type: 'application/msword' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${r.log_no}-v${r.current_version}.doc` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
