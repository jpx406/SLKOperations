import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FolderArchive, Printer } from 'lucide-react';
import { useRef } from 'react';
import { Link, useParams } from 'react-router';
import { STAGES, stagePercent } from '../../shared/stages';
import { toolTotals } from '../../shared/toolstring';
import type { Job, JobCrew } from '../../shared/types';
import { csv, zip } from '../../shared/xlsx';
import { api, formatDate } from '../api';
import { useMe } from '../auth';
import { saveFile } from '../components/charts';
import type { LogEvent } from '../components/JobLogEvents';
import { SignatureBadge } from '../components/Signature';
import { Banner, Button, Skeleton } from '../components/ui';

// Full Job Report and Job Package (S41): everything known about one job on one printable page, and the same
// content as a zip (report, data and tables) for filing. Built in the browser, no document service needed.

const ROLE: Record<string, string> = { slickline_supervisor: 'Supervisor', slickline_operator: 'Operator', assistant_operator: 'Assistant operator', helper: 'Helper' };
const YN: Record<string, string> = { yes: 'Yes', no: 'No', na: 'N/A', other: 'Other' };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function JobReport() {
  const { id = '' } = useParams();
  const { data: me } = useMe();
  const ref = useRef<HTMLElement>(null);
  const job = useQuery({ queryKey: ['job', id], queryFn: () => api<Job>(`/jobs/${id}`) });
  const crew = useQuery({ queryKey: ['crew', id], queryFn: () => api<JobCrew>(`/jobs/${id}/crew`) });
  const events = useQuery({ queryKey: ['job-events', id], queryFn: () => api<LogEvent[]>(`/jobs/${id}/events`) });
  const emf = useQuery({ queryKey: ['emf', 'job', id], queryFn: () => api<{ id: string; log_no: string; title: string; total_npt: number; severity: string; status: string }[]>(`/emf?job=${id}`), enabled: !!me?.menus.eight_min_facts?.view });
  const jra = useQuery({ queryKey: ['jra', id], queryFn: () => api<{ jra: { status: string; risk_score: number; approval_level: string | null; decided_by: string | null } | null; reasons: string[] }>(`/jra/${id}`) });
  const pjn = useQuery({ queryKey: ['pjn-job', id], queryFn: () => api<{ log_no: string; status: string; current_version: number } | null>(`/pre-job-notes/by-job/${id}`), enabled: !!me?.menus.pre_job_notes?.view });
  if (job.isPending) return <Skeleton className="h-96" />;
  if (job.isError) return <Banner tone="danger">{job.error.message}</Banner>;
  const j = job.data;
  const t = toolTotals(j.toolstring ?? []);
  const row = (k: string, v: React.ReactNode) => <tr key={k}><th scope="row" className="w-52 py-0.5 pr-3 text-left align-top font-semibold text-text-muted">{k}</th><td className="py-0.5 align-top">{v === null || v === undefined || v === '' ? '—' : v}</td></tr>;
  const name = `job-${j.ticket_no ?? j.id.slice(0, 8)}`;

  const exportPackage = () => {
    const enc = new TextEncoder();
    const styles = 'body{font-family:Arial,sans-serif;font-size:12px;color:#111}h1{font-size:18px}h2{font-size:14px;border-bottom:1px solid #999;margin-top:16px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:2px 6px;vertical-align:top}';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><style>${styles}</style></head><body>${ref.current?.innerHTML ?? ''}</body></html>`;
    const files = [
      { name: `${name}/report.html`, data: enc.encode(html) },
      { name: `${name}/job.json`, data: enc.encode(JSON.stringify({ job: j, crew: crew.data ?? null, events: events.data ?? [], eightMinFacts: emf.data ?? [], jra: jra.data?.jra ?? null }, null, 2)) },
      { name: `${name}/sequence-of-events.csv`, data: enc.encode(csv(['Time', 'Run', 'Depth ft', 'Entry', 'By'], (events.data ?? []).map((e) => [e.occurred_at, e.run_no, e.depth_ft, e.text, e.created_by]))) },
      { name: `${name}/toolstring.csv`, data: enc.encode(csv(['#', 'Component', 'OD in', 'Length ft', 'Weight lb'], (j.toolstring ?? []).map((p, i) => [i + 1, p.component, p.od_in ?? null, p.length_ft ?? null, p.weight_lb ?? null]))) },
      { name: `${name}/crew.csv`, data: enc.encode(csv(['Role', 'Name', 'EID'], (crew.data?.crew ?? []).map((m) => [ROLE[m.crew_role] ?? m.crew_role, m.full_name ?? '', m.eid ?? '']))) },
    ];
    saveFile(`${name}-package.zip`, zip(files), 'application/zip');
  };

  return (
    <section aria-label="Job report">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link to={`/operation/jobs/${id}/closure`} className="inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-xs font-semibold hover:bg-surface-3"><ArrowLeft aria-hidden className="size-4" />Job</Link>
        <Button size="sm" variant="primary" onClick={() => window.print()}><Printer aria-hidden className="size-4" />Print / PDF</Button>
        <Button size="sm" onClick={exportPackage} disabled={crew.isPending || events.isPending}><FolderArchive aria-hidden className="size-4" />Job package (.zip)</Button>
        <span className="text-xs text-text-muted">The package holds this report, the job data and its tables, for filing with the signed documents.</span>
      </div>
      <article ref={ref} className="space-y-4 rounded-lg border border-border bg-surface p-6 text-sm print:border-0 print:p-0">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-accent-edge pb-2">
          <h1 className="font-display text-xl font-extrabold uppercase">Job report · {j.ticket_no ?? 'no ticket'}</h1>
          <span className="font-mono text-xs">{j.country} · {j.status} · generated {when(new Date().toISOString())}</span>
        </header>
        <p className="text-xs text-text-muted">Completion: {STAGES.map((s) => `${s} ${stagePercent(j, s)}%`).join(' · ')}</p>
        <section><h2 className="label-caps mb-1 text-text-muted">Design</h2><table className="w-full"><tbody>
          {row('Unit', j.unit_number)}{row('Dates', j.start_date ? `${formatDate(j.start_date)}${j.end_date && j.end_date !== j.start_date ? ` to ${formatDate(j.end_date)}` : ''}` : null)}
          {row('Account / area', [j.location, j.field].filter(Boolean).join(' · '))}{row('Rig / well', [j.rig, j.well].filter(Boolean).join(' · '))}{row('Conveyance', j.conveyance)}
          {row('Services', j.services.join(', '))}{row('DRSS / DMR', [j.drss_no, j.dmr_no].filter(Boolean).join(' · '))}{row('SDM', j.sdm_username)}{row('Run details', <span className="whitespace-pre-wrap">{j.run_details}</span>)}
        </tbody></table></section>
        <section><h2 className="label-caps mb-1 text-text-muted">Preparation</h2><table className="w-full"><tbody>
          {row('Well', [j.well_type, j.h2s_ppm != null && `H₂S ${j.h2s_ppm} ppm`, j.siwhp_psi != null && `SIWHP ${j.siwhp_psi} psi`, j.bht_f != null && `BHT ${j.bht_f} °F`].filter(Boolean).join(' · '))}
          {row('Completion', <span className="whitespace-pre-wrap">{[j.target_casing_type, j.target_casing_od, j.nipple_profile && `nipple ${j.nipple_profile}`, j.min_restriction_in != null && `min restriction ${j.min_restriction_in} in`].filter(Boolean).join(' · ')}{j.completion_details ? `\n${j.completion_details}` : ''}</span>)}
          {row('Wire / drum', [j.wire_serial_number, j.drum_no].filter(Boolean).join(' on '))}{row('Pressure control', [j.pressure_rating_psi && `${j.pressure_rating_psi.toLocaleString()} psi`, j.lubricator_length_ft && `lubricator ${j.lubricator_length_ft} ft`, j.stuffing_box_type].filter(Boolean).join(' · '))}
          {row('Toolstring', (j.toolstring ?? []).length ? `${(j.toolstring ?? []).map((p) => p.component).join(' → ')} (${t.length_ft ?? '—'} ft, max OD ${t.max_od_in ?? '—'} in, stem ${t.stem_weight_lb ?? '—'} lb)` : null)}
          {row('Crew', (crew.data?.crew ?? []).map((m) => `${m.full_name} (${ROLE[m.crew_role] ?? m.crew_role})`).join(', '))}
          {row('JRA', jra.data?.jra ? `${jra.data.jra.status} · score ${jra.data.jra.risk_score} · ${jra.data.jra.approval_level ?? ''}${jra.data.jra.decided_by ? ` · decided by ${jra.data.jra.decided_by}` : ''}` : jra.data?.reasons.length ? `needed (${jra.data.reasons.join(', ')}) but not started` : 'not needed')}
          {jra.data?.jra?.status === 'approved' && row('JRA signature', <SignatureBadge type="jra" id={j.id} />)}
          {pjn.data !== undefined && row('Pre-Job Note', pjn.data ? `${pjn.data.log_no} v${pjn.data.current_version} · ${pjn.data.status === 'sent' ? 'sent' : 'not sent'}` : 'none')}
        </tbody></table></section>
        <section><h2 className="label-caps mb-1 text-text-muted">Execution</h2><table className="w-full"><tbody>
          {row('Arrived / rig-up / rig-down', [when(j.arrived_at), when(j.rig_up_at), when(j.rig_down_at)].join(' · '))}
          {row('Runs', `${j.runs_ok ?? 0} successful · ${j.runs_failed ?? 0} failed`)}{row('Depths', [j.max_depth_ft != null && `max ${j.max_depth_ft.toLocaleString()} ft`, j.tag_depth_ft != null && `tag ${j.tag_depth_ft.toLocaleString()} ft`].filter(Boolean).join(' · '))}
          {row('Pull', [j.max_pull_lb != null && `max ${j.max_pull_lb} lb`, j.max_overpull_lb != null && `overpull ${j.max_overpull_lb} lb`, j.jarring_minutes != null && `jarring ${j.jarring_minutes} min`].filter(Boolean).join(' · '))}
          {row('Wire cut', j.wire_cut_ft != null ? `${j.wire_cut_ft} ft` : null)}{row('Hours', `${j.op_hours ?? '—'} op h · ${j.npt_hours} h NPT · job efficiency ${j.job_efficiency_pct ?? '—'}% · run efficiency ${j.run_efficiency_pct ?? '—'}%`)}
          {row('Failure', YN[j.failure ?? ''] ?? null)}{row('Operating time details', <span className="whitespace-pre-wrap">{j.op_time_details}</span>)}
        </tbody></table></section>
        <section><h2 className="label-caps mb-1 text-text-muted">Sequence of events ({events.data?.length ?? 0})</h2>
          {!events.data?.length ? <p className="text-text-subtle">No entries.</p> : (
            <table className="w-full"><tbody>{events.data.map((e) => <tr key={e.id} className="border-t border-border"><td className="w-40 py-0.5 font-mono text-xs">{when(e.occurred_at)}</td><td className="w-16 py-0.5 font-mono text-xs">{e.run_no != null ? `run ${e.run_no}` : ''}</td><td className="w-24 py-0.5 font-mono text-xs">{e.depth_ft != null ? `${e.depth_ft} ft` : ''}</td><td className="py-0.5">{e.text}</td></tr>)}</tbody></table>
          )}
        </section>
        {(emf.data?.length ?? 0) > 0 && <section><h2 className="label-caps mb-1 text-text-muted">8 Min. Facts</h2><ul>{emf.data!.map((r) => <li key={r.id}>{r.log_no} · {r.title} · {r.total_npt} h · {r.severity} · {r.status}</li>)}</ul></section>}
        <section><h2 className="label-caps mb-1 text-text-muted">Closure</h2><table className="w-full"><tbody>
          {row('Sign-off', [`job log ${YN[j.job_log_signed ?? ''] ?? '—'}`, `ticket ${YN[j.ticket_signed ?? ''] ?? '—'}`, `wellsite audit ${YN[j.wellsite_audit ?? ''] ?? '—'}`, `runs in WIREGUARD ${YN[j.wg_runs_logged ?? ''] ?? '—'}`].join(' · '))}
          {row('Job package', j.job_package_url)}{row('Reporting', [j.report_closure_status, j.gears_no && `GEARS ${j.gears_no}`].filter(Boolean).join(' · '))}
          {row('Failure description', <span className="whitespace-pre-wrap">{j.failure_description}</span>)}
        </tbody></table></section>
        <footer className="border-t border-border pt-2 text-xs text-text-subtle">Last changed {when(j.updated_at)} by {j.updated_by ?? '—'}. Revenue is left out of this report.</footer>
      </article>
    </section>
  );
}
