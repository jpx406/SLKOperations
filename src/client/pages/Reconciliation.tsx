import { Select } from '../components/Select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, Link2, Play, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CHECKS, type CheckCode, type FieldDiff, type Severity } from '../../shared/recon';
import { ApiError, api, formatDate } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, Field, PageTitle, Skeleton, cx, inputClass, inputSized } from '../components/ui';

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
    <details id="digest" className="mt-8 rounded-lg bg-surface p-4 shadow-card">
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

const SEVERITIES: Severity[] = ['high', 'medium', 'low', 'info'];

/**
 * Where reconciliation stands, in words: never checked, all agree, or N open findings. A screen that says "all agree"
 * before any check has run teaches people to trust a check that never happened, so the states are explicit.
 */
function StatusHeader({ s, canEdit, running, onRun, gaps }: { s: Summary; canEdit: boolean; running: boolean; onRun: () => void; gaps: number }) {
  const total = SEVERITIES.reduce((a, k) => a + (s.open[k] ?? 0), 0);
  if (!s.lastRun) {
    return (
      <div className="mb-5 rounded-lg border border-dashed border-border-strong bg-surface p-5">
        <p className="flex items-center gap-2 font-display text-lg font-bold"><CircleDashed aria-hidden className="size-5 text-text-muted" />Never checked</p>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          No comparison with WIREGUARD has run yet, so nothing below has been verified. Runs from {formatDate(s.from)} onward will be checked.
          {!canEdit && ' Ask an SDM or manager to run the first check.'}
        </p>
        {canEdit && <Button className="mt-3" variant="primary" loading={running} onClick={onRun}><Play aria-hidden className="size-4" />Run first check</Button>}
      </div>
    );
  }
  const counts = SEVERITIES.filter((k) => s.open[k]).map((k) => `${s.open[k]} ${k}`).join(' · ');
  return (
    <Card className="mb-5">
      {total === 0 ? (
        <p className="flex items-center gap-2 font-semibold text-success"><CheckCircle2 aria-hidden className="size-5" />All checked jobs agree with WIREGUARD</p>
      ) : (
        <p className="flex items-center gap-2 font-semibold text-warning"><AlertTriangle aria-hidden className="size-5" />{total} open finding{total === 1 ? '' : 's'}<span className="font-normal text-text-muted">· {counts}</span></p>
      )}
      <p className="mt-1 font-mono text-xs text-text-muted">Last check {when(s.lastRun.occurred_at)} Riyadh by {s.lastRun.username} · {s.lastRun.summary}</p>
      {gaps > 0 && (
        <p className="mt-2 flex items-center gap-2 text-sm text-warning"><AlertTriangle aria-hidden className="size-4" />
          {gaps} unit{gaps === 1 ? ' has' : 's have'} SLK Ops jobs in {s.month} but no WIREGUARD runs. See coverage below.</p>
      )}
      <p className="mt-2 text-xs"><a className="text-text-muted underline hover:text-text" href="#digest" onClick={() => { const d = document.getElementById('digest') as HTMLDetailsElement | null; if (d) d.open = true; }}>Preview your morning digest</a></p>
    </Card>
  );
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
  const by = params.get('by') === 'sdm' ? 'sdm' : 'unit';
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
  const s = summary.data;
  const checked = !!s?.lastRun;
  const gaps = (s?.units ?? []).filter((u) => u.jobs > 0 && u.runs === 0).length;
  const filtered = !!(check || severity || unit || sdm || status !== 'open');
  const groups = SEVERITIES.map((k) => ({ k, rows: (findings.data ?? []).filter((f) => f.severity === k) })).filter((g) => g.rows.length);
  const chip = (on: boolean) => cx('inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-pill border px-3 text-sm font-semibold', on ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text');

  return (
    <section aria-labelledby="recon-title">
      <PageTitle aside={canEdit && checked && <Button variant="primary" loading={run.isPending} onClick={() => run.mutate()}><Play aria-hidden className="size-4" />Check now</Button>}>
        <span id="recon-title">Reconciliation</span>
      </PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">
        Compares SLK Ops jobs with the runs logged in WIREGUARD. Fixes to a run are made in WIREGUARD; here you link runs to the right job or explain a difference.
      </p>
      {notice && <div className="mb-4"><Banner tone={notice.tone} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)} aria-label="Dismiss"><X aria-hidden className="size-4" /></Button>}>{notice.text}</Banner></div>}
      {summary.isPending && <Skeleton className="mb-5 h-24" />}
      {s && <StatusHeader s={s} canEdit={canEdit} running={run.isPending} onRun={() => run.mutate()} gaps={gaps} />}

      {checked && (
        <>
          <h2 className="label-caps mb-2 text-text-muted">Findings</h2>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div role="group" aria-label="Severity" className="flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={!severity} className={chip(!severity)} onClick={() => set('severity', '')}>All</button>
              {SEVERITIES.filter((k) => k !== 'info' || s?.open.info).map((k) => (
                <button key={k} type="button" aria-pressed={severity === k} className={chip(severity === k)} onClick={() => set('severity', severity === k ? '' : k)}>
                  <span className="capitalize">{k}</span><span className="font-mono">{s?.open[k] ?? 0}</span>
                </button>
              ))}
            </div>
            <Select aria-label="Status" className={inputSized('h-(--layout-control-sm) w-36')} value={status} onChange={(e) => set('status', e.target.value === 'open' ? '' : e.target.value)}>
              <option value="open">Open</option><option value="explained">Explained</option><option value="resolved">Resolved</option><option value="all">All statuses</option>
            </Select>
            <Select aria-label="Check" className={inputSized('h-(--layout-control-sm) w-64')} value={check} onChange={(e) => set('check', e.target.value)}>
              <option value="">All checks</option>
              {(Object.keys(CHECKS) as CheckCode[]).map((k) => <option key={k} value={k}>{CHECKS[k].label}</option>)}
            </Select>
            <Select aria-label="Unit" className={inputSized('h-(--layout-control-sm) w-32')} value={unit} onChange={(e) => set('unit', e.target.value)}>
              <option value="">All units</option>
              {(s?.units ?? []).map((u) => <option key={u.unit_number} value={u.unit_number}>{u.unit_number}</option>)}
            </Select>
            <Select aria-label="SDM" className={inputSized('h-(--layout-control-sm) w-44')} value={sdm} onChange={(e) => set('sdm', e.target.value)}>
              <option value="">All SDMs</option>
              {(s?.sdms ?? []).map((x) => <option key={x.sdm} value={x.sdm}>{x.name}</option>)}
            </Select>
            {filtered && <Button size="sm" variant="ghost" onClick={() => setParams({ month })}>Clear filters</Button>}
          </div>

          {findings.isPending && <Skeleton className="h-40" />}
          {findings.isError && <Banner tone="danger" action={<Button size="sm" onClick={() => findings.refetch()}>Retry</Button>}>{findings.error.message}</Banner>}
          {findings.data?.length === 0 && (
            <p className="rounded-lg bg-surface px-4 py-3 text-sm text-text-muted">{filtered ? 'No findings match these filters.' : 'No open findings.'}</p>
          )}
          {groups.length > 0 && (
            <Card className="p-0!">
              {groups.map((g) => (
                <section key={g.k} aria-label={`${g.k} severity`}>
                  <h3 className="label-caps flex items-center gap-2 border-b border-border px-4 py-2 text-text-muted"><SeverityPill s={g.k} /><span className="font-mono">{g.rows.length}</span></h3>
                  <ul className="divide-y divide-border">
                    {g.rows.map((f) => (
                      <li key={f.id}>
                        <button onClick={() => set('finding', f.id)} aria-haspopup="dialog"
                          className={cx('grid min-h-(--layout-control-lg) w-full grid-cols-1 items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left hover:bg-surface-2 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_9rem]', f.status !== 'open' && 'text-text-muted')}>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{CHECKS[f.check_code].label}</span>
                            <span className="block truncate text-sm text-text-muted">{f.detail.summary}</span>
                          </span>
                          <span className="min-w-0 truncate text-sm">
                            {f.job_id ? <>{f.ticket_no ?? 'No ticket'} · {f.unit_number ?? '—'} · {f.start_date ? formatDate(f.start_date) : '—'}</> : <span className="text-text-subtle">{f.wg_run_ids.length} WIREGUARD run{f.wg_run_ids.length > 1 ? 's' : ''}, no job</span>}
                          </span>
                          <span className="label-caps text-text-subtle md:text-right">{f.status === 'explained' ? 'explained' : f.status === 'resolved' ? 'resolved' : `seen ${when(f.last_seen_at)}`}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </Card>
          )}
        </>
      )}

      <div className="mt-8 mb-2 flex flex-wrap items-center gap-3">
        <h2 className="label-caps text-text-muted">Coverage in</h2>
        <input type="month" aria-label="Month" className={inputSized('h-(--layout-control-sm) w-44')} value={month} onChange={(e) => set('month', e.target.value)} />
        <div role="group" aria-label="Group coverage by" className="ml-auto flex overflow-hidden rounded-md border border-border-strong">
          {(['unit', 'sdm'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={by === k} onClick={() => set('by', k === 'unit' ? '' : k)}
              className={cx('h-(--layout-control-sm) px-3 text-xs font-semibold', by === k ? 'bg-accent text-on-accent' : 'text-text-muted hover:bg-surface-2')}>{k === 'unit' ? 'By unit' : 'By SDM'}</button>
          ))}
        </div>
      </div>
      {s && (by === 'unit' ? (s.units.length ? (
        <Card className="overflow-x-auto p-0!">
          <table className="w-full text-sm">
            <caption className="sr-only">SLK Ops jobs and WIREGUARD runs per unit in {month}</caption>
            <thead><tr className="label-caps border-b border-border text-left text-text-muted">
              <th scope="col" className="px-4 py-2">Unit</th><th scope="col" className="px-4 py-2 text-right">SLK Ops jobs</th>
              <th scope="col" className="px-4 py-2 text-right">WIREGUARD runs</th><th scope="col" className="px-4 py-2 text-right">Open findings</th>
            </tr></thead>
            <tbody>
              {s.units.map((u) => {
                const gap = u.jobs > 0 && u.runs === 0;
                return (
                  <tr key={u.unit_number} className="border-t border-border">
                    <th scope="row" className="px-4 py-2 text-left font-display font-bold">{u.unit_number}</th>
                    <td className="px-4 py-2 text-right font-mono">{u.jobs}</td>
                    <td className="px-4 py-2 text-right">{gap ? <span className="font-semibold text-warning">0 · No WIREGUARD runs</span> : <span className="font-mono">{u.runs}</span>}</td>
                    <td className="px-4 py-2 text-right">
                      {u.open_findings ? <button className="font-mono text-warning underline" onClick={() => setParams({ unit: u.unit_number, month })}>{u.open_findings}</button> : <span className="font-mono text-text-subtle">0</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : <p className="rounded-lg bg-surface px-4 py-3 text-sm text-text-muted">No jobs or runs in {month}.</p>) : (s.sdms.length ? (
        <Card className="overflow-x-auto p-0!">
          <table className="w-full text-sm">
            <caption className="sr-only">Jobs in {month} and open findings per SDM</caption>
            <thead><tr className="label-caps border-b border-border text-left text-text-muted">
              <th scope="col" className="px-4 py-2">SDM</th><th scope="col" className="px-4 py-2 text-right">Jobs in {month}</th><th scope="col" className="px-4 py-2 text-right">Open findings on their jobs</th>
            </tr></thead>
            <tbody>
              {s.sdms.map((x) => (
                <tr key={x.sdm} className="border-t border-border">
                  <th scope="row" className="px-4 py-2 text-left font-semibold">{x.name}</th>
                  <td className="px-4 py-2 text-right font-mono">{x.jobs}</td>
                  <td className="px-4 py-2 text-right">{x.open_findings ? <button className="font-mono text-warning underline" onClick={() => setParams({ sdm: x.sdm, month })}>{x.open_findings}</button> : <span className="font-mono text-text-subtle">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : <p className="rounded-lg bg-surface px-4 py-3 text-sm text-text-muted">No SDM has jobs in {month}.</p>))}

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
                      <Select id="link-job" className={`${inputClass} w-96 max-w-full`} value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
                        <option value="">Choose…</option>
                        {pick.map((j) => <option key={j.id} value={j.id}>{jobLabel(j)}</option>)}
                      </Select>
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
