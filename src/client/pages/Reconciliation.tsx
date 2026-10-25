import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Link2, Play, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CHECKS, type CheckCode, type FieldDiff, type Severity } from '../../shared/recon';
import { ApiError, api, formatDate } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass } from '../components/ui';

interface FindingRow {
  id: string; check_code: CheckCode; severity: Severity; status: 'open' | 'explained' | 'resolved'; job_id: string | null;
  wg_run_ids: string[]; detail: { summary: string; matchedBy?: string; fields?: FieldDiff[]; candidates?: string[]; unit?: string | null };
  explanation: string | null; explained_by: string | null; first_seen_at: string; last_seen_at: string; resolved_at: string | null;
  ticket_no: string | null; unit_number: string | null; start_date: string | null; end_date: string | null; well: string | null; job_status: string | null;
}
interface RunRow {
  wg_id: string; job_date: string; field_ticket: string | null; drss_number: string | null; drum_no: string | null; unit_number: string | null;
  wire_serial_number: string | null; well: string | null; field_name: string | null; rig: string | null; job_name: string | null;
  max_depth_ft: number | null; jarring_minutes: number | null; wire_cut_ft: number | null; approval_status: string | null; linked_job: string | null;
}
interface JobLite { id: string; ticket_no: string | null; unit_number: string | null; start_date: string | null; end_date: string | null; well: string | null; status: string }
interface Detail extends FindingRow { runs: RunRow[]; job: (JobLite & Record<string, unknown>) | null; candidates: JobLite[]; label: string }
interface Summary { month: string; from: string; units: { unit_number: string; jobs: number; runs: number; open_findings: number }[]; open: Partial<Record<Severity, number>>; lastRun: { occurred_at: string; username: string; summary: string } | null; sdms: { sdm: string; name: string; jobs: number; open_findings: number }[] }

const SEV_STYLE: Record<Severity, string> = {
  high: 'bg-sev-catastrophic text-on-sev',
  medium: 'bg-sev-serious text-on-sev',
  low: 'bg-sev-light text-on-sev',
  info: 'bg-neutral-subtle text-neutral',
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const jobLabel = (j: JobLite) => `${j.ticket_no ?? 'No ticket'} · ${j.unit_number ?? 'no unit'} · ${j.start_date ? formatDate(j.start_date) : 'no date'}${j.well ? ` · well ${j.well}` : ''}`;

/** What the morning email would say to the person looking, sent after the nightly check. */
function DigestPreview() {
  const q = useQuery({ queryKey: ['recon-digest'], queryFn: () => api<{ digest: { subject: string; text: string; count: number; fresh: number } | null; email: string | null; mailer: boolean; receives: boolean }>('/recon/digest') });
  if (!q.data || !q.data.receives) return null;
  const { digest, email, mailer } = q.data;
  return (
    <details className="mt-8 rounded-lg border border-border bg-surface p-4">
      <summary className="cursor-pointer font-display text-lg font-bold">Your morning digest</summary>
      <p className="mt-2 text-sm text-text-muted">
        Sent after the nightly check (04:00 Riyadh){email ? ` to ${email}` : ''}.
        {!email && ' Your roster entry has no contact email, so it isn’t sent to you.'}
        {!mailer && ' Email sending isn’t switched on yet; this is what it will say.'}
      </p>
      {digest ? <><p className="mt-3 text-sm font-semibold">{digest.subject}</p><pre className="mt-2 max-h-72 overflow-auto rounded-md bg-surface-2 p-3 text-xs whitespace-pre-wrap">{digest.text}</pre></>
        : <p className="mt-3 text-sm text-text-subtle">Nothing for you today, so no email.</p>}
    </details>
  );
}

function SeverityPill({ s }: { s: Severity }) {
  return <span className={cx('label-caps inline-flex h-5.5 items-center justify-self-start rounded-pill px-2', SEV_STYLE[s])}>{s}</span>;
}

export function Reconciliation() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canEdit = !!me?.menus.reconciliation?.edit;
  const status = params.get('status') ?? 'open';
  const check = params.get('check') ?? '';
  const severity = params.get('severity') ?? '';
  const unit = params.get('unit') ?? '';
  const sdm = params.get('sdm') ?? '';
  const month = params.get('month') ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).slice(0, 7);
  const open = params.get('finding');
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };

  const qs = new URLSearchParams({ status, ...(check && { check }), ...(severity && { severity }), ...(unit && { unit }), ...(sdm && { sdm }) }).toString();
  const findings = useQuery({ queryKey: ['recon', qs], queryFn: () => api<FindingRow[]>(`/recon/findings?${qs}`) });
  const summary = useQuery({ queryKey: ['recon-summary', month], queryFn: () => api<Summary>(`/recon/summary?month=${month}`) });
  const config = useQuery({ queryKey: ['config'], queryFn: () => api<{ wireguardUrl: string }>('/config'), staleTime: Infinity });
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const run = useMutation({
    mutationFn: () => api<{ findings: number; resolved: number; jobs: number; runs: number; from: string }>('/recon/run', { method: 'POST' }),
    onSuccess: (r) => { setNotice({ tone: 'success', text: `Checked ${r.jobs} jobs against ${r.runs} WIREGUARD runs: ${r.findings} findings, ${r.resolved} resolved since the last check.` }); qc.invalidateQueries({ queryKey: ['recon'] }); qc.invalidateQueries({ queryKey: ['recon-summary'] }); },
    onError: (e: ApiError) => setNotice({ tone: 'danger', text: e.message }),
  });

  return (
    <section aria-labelledby="recon-title">
      <PageTitle aside={canEdit && <Button variant="primary" loading={run.isPending} onClick={() => run.mutate()}><Play aria-hidden className="size-4" />Check now</Button>}>
        <span id="recon-title">Reconciliation</span>
      </PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">
        Compares SLK Ops jobs with the runs logged in WIREGUARD. Fixes to a run are made in WIREGUARD; here you link runs to the right job or explain a difference.
        {summary.data && <> Runs from {formatDate(summary.data.from)} onward are checked. Last check: {summary.data.lastRun ? `${when(summary.data.lastRun.occurred_at)} by ${summary.data.lastRun.username}` : 'not yet'}.</>}
      </p>
      {notice && <div className="mb-4"><Banner tone={notice.tone} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)} aria-label="Dismiss"><X aria-hidden className="size-4" /></Button>}>{notice.text}</Banner></div>}

      <dl className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(['high', 'medium', 'low'] as Severity[]).map((s) => (
          <button key={s} onClick={() => { set('severity', severity === s ? '' : s); }} aria-pressed={severity === s}
            className={cx('rounded-md border bg-surface p-3 text-left hover:border-border-strong', severity === s ? 'border-accent' : 'border-border')}>
            <dt className="label-caps text-text-muted">Open · {s}</dt>
            <dd className="mt-1 font-display text-kpi leading-none font-bold">{summary.data?.open[s] ?? 0}</dd>
          </button>
        ))}
        <div className="rounded-md border border-border bg-surface p-3">
          <dt className="label-caps text-text-muted">Open · all</dt>
          <dd className="mt-1 font-display text-kpi leading-none font-bold">{Object.values(summary.data?.open ?? {}).reduce((a, b) => a + (b ?? 0), 0)}</dd>
        </div>
      </dl>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field id="f-status" label="Status">
          <select id="f-status" className={`${inputClass} w-36`} value={status} onChange={(e) => set('status', e.target.value === 'open' ? '' : e.target.value)}>
            <option value="open">Open</option><option value="explained">Explained</option><option value="resolved">Resolved</option><option value="all">All</option>
          </select>
        </Field>
        <Field id="f-check" label="Check">
          <select id="f-check" className={`${inputClass} w-72`} value={check} onChange={(e) => set('check', e.target.value)}>
            <option value="">All checks</option>
            {(Object.keys(CHECKS) as CheckCode[]).map((k) => <option key={k} value={k}>{CHECKS[k].label}</option>)}
          </select>
        </Field>
        <Field id="f-unit" label="Unit">
          <select id="f-unit" className={`${inputClass} w-32`} value={unit} onChange={(e) => set('unit', e.target.value)}>
            <option value="">All units</option>
            {(summary.data?.units ?? []).map((u) => <option key={u.unit_number} value={u.unit_number}>{u.unit_number}</option>)}
          </select>
        </Field>
        <Field id="f-sdm" label="SDM">
          <select id="f-sdm" className={`${inputClass} w-48`} value={sdm} onChange={(e) => set('sdm', e.target.value)}>
            <option value="">All SDMs</option>
            {(summary.data?.sdms ?? []).map((x) => <option key={x.sdm} value={x.sdm}>{x.name}</option>)}
          </select>
        </Field>
        {(check || severity || unit || sdm || status !== 'open') && <Button variant="ghost" onClick={() => setParams({ month })}>Clear filters</Button>}
      </div>

      {findings.isPending && <div className="flex flex-col gap-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>}
      {findings.isError && <Banner tone="danger" action={<Button size="sm" onClick={() => findings.refetch()}>Retry</Button>}>{findings.error.message}</Banner>}
      {findings.data?.length === 0 && (
        <EmptyState title={status === 'open' && !check && !severity && !unit ? 'Nothing to reconcile' : 'No findings match'}>
          {status === 'open' && !check && !severity && !unit ? 'Every checked job agrees with WIREGUARD. Run a check after new runs are logged.' : 'Try another status, check or unit.'}
        </EmptyState>
      )}
      {!!findings.data?.length && (
        <ul className="flex flex-col gap-2" aria-label="Findings">
          {findings.data.map((f) => (
            <li key={f.id}>
              <button onClick={() => set('finding', f.id)} aria-haspopup="dialog"
                className={cx('grid w-full grid-cols-1 items-center gap-2 rounded-lg border bg-surface p-3 text-left hover:border-border-strong md:grid-cols-[6rem_minmax(0,1fr)_minmax(0,16rem)_8rem]',
                  f.status !== 'open' ? 'border-border text-text-muted' : 'border-border')}>
                <SeverityPill s={f.severity} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{CHECKS[f.check_code].label}</span>
                  <span className="block truncate text-sm text-text-muted">{f.detail.summary}</span>
                </span>
                <span className="min-w-0 truncate text-sm">
                  {f.job_id ? <>{f.ticket_no ?? 'No ticket'} · {f.unit_number ?? '—'} · {f.start_date ? formatDate(f.start_date) : '—'}</> : <span className="text-text-subtle">{f.wg_run_ids.length} WIREGUARD run{f.wg_run_ids.length > 1 ? 's' : ''}, no job</span>}
                </span>
                <span className="label-caps text-right text-text-subtle">{f.status === 'explained' ? 'explained' : f.status === 'resolved' ? 'resolved' : `seen ${when(f.last_seen_at)}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 mb-3 flex flex-wrap items-center gap-3 font-display text-lg font-bold">
        Jobs and runs per unit
        <span className="block w-44"><input type="month" aria-label="Month" className={inputClass} value={month} onChange={(e) => set('month', e.target.value)} /></span>
      </h2>
      {summary.data && (summary.data.units.length ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">SLK Ops jobs and WIREGUARD runs per unit in {month}</caption>
            <thead className="bg-surface-2"><tr className="label-caps text-left text-text-muted">
              <th scope="col" className="px-3 py-2">Unit</th><th scope="col" className="px-3 py-2 text-right">SLK Ops jobs</th>
              <th scope="col" className="px-3 py-2 text-right">WIREGUARD runs</th><th scope="col" className="px-3 py-2 text-right">Open findings</th>
            </tr></thead>
            <tbody>
              {summary.data.units.map((u) => (
                <tr key={u.unit_number} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 text-left font-display font-bold">{u.unit_number}</th>
                  <td className="px-3 py-2 text-right font-mono">{u.jobs}</td>
                  <td className="px-3 py-2 text-right font-mono">{u.runs}</td>
                  <td className="px-3 py-2 text-right">
                    {u.open_findings ? <button className="font-mono text-warning underline" onClick={() => setParams({ unit: u.unit_number, month })}>{u.open_findings}</button> : <span className="font-mono text-text-subtle">0</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title={`No jobs or runs in ${month}`} />)}

      {summary.data && summary.data.sdms.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 font-display text-lg font-bold">Per SDM</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Jobs in {month} and open findings per SDM</caption>
              <thead className="bg-surface-2"><tr className="label-caps text-left text-text-muted">
                <th scope="col" className="px-3 py-2">SDM</th><th scope="col" className="px-3 py-2 text-right">Jobs in {month}</th><th scope="col" className="px-3 py-2 text-right">Open findings on their jobs</th>
              </tr></thead>
              <tbody>
                {summary.data.sdms.map((x) => (
                  <tr key={x.sdm} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 text-left font-semibold">{x.name}</th>
                    <td className="px-3 py-2 text-right font-mono">{x.jobs}</td>
                    <td className="px-3 py-2 text-right">{x.open_findings ? <button className="font-mono text-warning underline" onClick={() => setParams({ sdm: x.sdm, month })}>{x.open_findings}</button> : <span className="font-mono text-text-subtle">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <DigestPreview />

      {open && <FindingDrawer id={open} canEdit={canEdit} wireguardUrl={config.data?.wireguardUrl} onClose={() => set('finding', '')} />}
    </section>
  );
}

function FindingDrawer({ id, canEdit, wireguardUrl, onClose }: { id: string; canEdit: boolean; wireguardUrl?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ['recon-finding', id], queryFn: () => api<Detail>(`/recon/findings/${id}`) });
  const runIds = d.data?.wg_run_ids.join(',') ?? '';
  const candidates = useQuery({
    queryKey: ['recon-candidates', runIds],
    queryFn: () => api<JobLite[]>(`/recon/candidates?runs=${encodeURIComponent(runIds)}`),
    enabled: !!d.data && !d.data.job_id && !!runIds,
  });
  const [note, setNote] = useState('');
  const [linkTo, setLinkTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const done = () => { qc.invalidateQueries({ queryKey: ['recon'] }); qc.invalidateQueries({ queryKey: ['recon-summary'] }); qc.invalidateQueries({ queryKey: ['recon-finding', id] }); };
  const explain = useMutation({
    mutationFn: (status: 'explained' | 'open') => api(`/recon/findings/${id}`, { method: 'PATCH', json: { status, explanation: note } }),
    onSuccess: () => { setError(null); setNote(''); done(); },
    onError: (e: ApiError) => setError(e.message),
  });
  const link = useMutation({
    mutationFn: () => api('/recon/links', { method: 'POST', json: { wg_run_ids: d.data!.wg_run_ids, job_id: linkTo } }),
    onSuccess: () => { setError(null); done(); onClose(); },
    onError: (e: ApiError) => setError(e.message),
  });
  const unlink = useMutation({
    mutationFn: (runId: string) => api(`/recon/links/${encodeURIComponent(runId)}`, { method: 'DELETE' }),
    onSuccess: () => { done(); onClose(); },
    onError: (e: ApiError) => setError(e.message),
  });

  const pick = [...(d.data?.candidates ?? []), ...(candidates.data ?? [])].filter((j, i, a) => a.findIndex((x) => x.id === j.id) === i);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="finding-title" className="fixed inset-0 z-50 flex justify-end bg-bg/70"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="h-full w-full max-w-3xl overflow-y-auto border-l border-border bg-surface p-5 shadow-pop">
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {d.data && <SeverityPill s={d.data.severity} />}
            <h2 id="finding-title" className="mt-2 font-display text-lg font-bold">{d.data?.label ?? 'Finding'}</h2>
            {d.data && <p className="text-sm text-text-muted">{d.data.detail.summary}{d.data.detail.matchedBy && <> · matched by {d.data.detail.matchedBy}</>}</p>}
          </div>
          <Button ref={closeRef} size="sm" variant="ghost" onClick={onClose} aria-label="Close"><X aria-hidden className="size-4" /></Button>
        </div>
        {d.isPending && <Skeleton className="h-64" />}
        {d.isError && <Banner tone="danger">{d.error.message}</Banner>}
        {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
        {d.data && (
          <div className="flex flex-col gap-5">
            {d.data.status === 'explained' && <Banner tone="info">Explained by {d.data.explained_by}: {d.data.explanation}</Banner>}
            {d.data.status === 'resolved' && <Banner tone="success">Resolved {when(d.data.resolved_at)}: the difference no longer shows.</Banner>}

            {d.data.job && (
              <Card>
                <p className="label-caps mb-2 text-text-muted">SLK Ops job</p>
                <p className="font-semibold"><Link className="underline" to={`/operation/jobs/${d.data.job.id}/design`}>{jobLabel(d.data.job)}</Link> <span className="text-sm text-text-muted">({d.data.job.status})</span></p>
              </Card>
            )}

            {!!d.data.detail.fields?.length && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <caption className="sr-only">SLK Ops value next to the WIREGUARD value</caption>
                  <thead className="bg-surface-2"><tr className="label-caps text-left text-text-muted"><th scope="col" className="px-3 py-2">Field</th><th scope="col" className="px-3 py-2">SLK Ops</th><th scope="col" className="px-3 py-2">WIREGUARD</th></tr></thead>
                  <tbody>
                    {d.data.detail.fields.map((f) => (
                      <tr key={f.field} className={cx('border-t border-border', !f.ok && 'bg-warning-subtle')}>
                        <th scope="row" className="px-3 py-2 text-left font-normal">{f.field}</th>
                        <td className="px-3 py-2 font-mono">{String(f.ours ?? '—')}</td>
                        <td className="px-3 py-2 font-mono">{String(f.theirs ?? '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!!d.data.runs.length && (
              <div>
                <p className="label-caps mb-2 text-text-muted">WIREGUARD runs ({d.data.runs.length})</p>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[44rem] text-sm">
                    <caption className="sr-only">WIREGUARD runs in this finding</caption>
                    <thead className="bg-surface-2"><tr className="label-caps text-left text-text-muted">
                      {['Date', 'Unit / drum', 'Wire', 'Well', 'Job type', 'Depth', 'Status', ''].map((h) => <th key={h} scope="col" className="px-2 py-2">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {d.data.runs.map((r) => (
                        <tr key={r.wg_id} className="border-t border-border">
                          <td className="px-2 py-1.5 font-mono text-xs">{r.job_date}</td>
                          <td className="px-2 py-1.5">{r.unit_number ?? '—'} <span className="text-xs text-text-subtle">{r.drum_no}</span></td>
                          <td className="px-2 py-1.5 font-mono text-xs">{r.wire_serial_number ?? '—'}</td>
                          <td className="px-2 py-1.5">{r.well ?? '—'}</td>
                          <td className="px-2 py-1.5">{r.job_name ?? '—'}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-xs">{r.max_depth_ft ?? '—'}</td>
                          <td className={cx('px-2 py-1.5 text-xs', r.approval_status !== 'approved' && 'text-warning')}>{r.approval_status}</td>
                          <td className="px-2 py-1.5">
                            {r.linked_job && canEdit && <Button size="sm" variant="ghost" onClick={() => unlink.mutate(r.wg_id)} aria-label={`Remove manual link of run ${r.wg_id}`}>Unlink</Button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {canEdit && d.data.status !== 'resolved' && !d.data.job_id && (
              <Card>
                <p className="label-caps mb-2 text-text-muted">Link these runs to a job</p>
                {candidates.isPending && <Skeleton className="h-9" />}
                {!candidates.isPending && !pick.length && <p className="text-sm text-text-muted">No SLK Ops job around these dates. Create the job, then check again.</p>}
                {!!pick.length && (
                  <div className="flex flex-wrap items-end gap-2">
                    <Field id="link-job" label="Job">
                      <select id="link-job" className={`${inputClass} w-96 max-w-full`} value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
                        <option value="">Choose…</option>
                        {pick.map((j) => <option key={j.id} value={j.id}>{jobLabel(j)}</option>)}
                      </select>
                    </Field>
                    <Button variant="primary" disabled={!linkTo} loading={link.isPending} onClick={() => link.mutate()}><Link2 aria-hidden className="size-4" />Link</Button>
                  </div>
                )}
              </Card>
            )}

            {canEdit && d.data.status === 'open' && (
              <Card>
                <Field id="explain" label="Explain this difference" hint="Recorded with your name. The finding stays explained until the data changes.">
                  <textarea id="explain" rows={3} className={cx(inputClass, 'h-auto py-2')} value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Second unit joined for one day; runs logged on its drum" />
                </Field>
                <div className="mt-3"><Button loading={explain.isPending} disabled={note.trim().length < 5} onClick={() => explain.mutate('explained')}>Mark explained</Button></div>
              </Card>
            )}
            {canEdit && d.data.status === 'explained' && (
              <div><Button onClick={() => explain.mutate('open')} loading={explain.isPending}><RotateCcw aria-hidden className="size-4" />Reopen</Button></div>
            )}

            {wireguardUrl && (
              <a href={wireguardUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-text-muted underline hover:text-text">
                Open WIREGUARD to correct a run <ExternalLink aria-hidden className="size-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
