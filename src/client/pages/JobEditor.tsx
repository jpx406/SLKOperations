import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, Check, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { EXECUTION_FIELDS, FIELD_POLICY, canEditField } from '../../shared/fieldPolicy';
import { jobEfficiency, opHours, runEfficiency } from '../../shared/metrics';
import { STAGES, hasFailure, stagePercent, type Stage } from '../../shared/stages';
import type { ToolPart } from '../../shared/toolstring';
import type { Job, Lookups } from '../../shared/types';
import { ApiError, api, isoToLocalInput, localInputToIso } from '../api';
import { useMe } from '../auth';
import { JraBanner, useJraLock } from './Jra';
import { Attachments } from '../components/Attachments';
import { JobLogEvents } from '../components/JobLogEvents';
import { BonusDistribution } from './Bonus';
import { PreJobNotePanel } from './PreJobNotes';
import { CrewPanel, DetailsSection, SectionTitle, ToolstringBuilder, WirePanel, serviceFlags } from '../components/jobParts';
import { Banner, Button, Card, Field, LockHint, ProgressBar, Skeleton, StatusPill, cx, inputClass } from '../components/ui';

type SaveState = { kind: 'idle' | 'dirty' | 'saving' | 'saved' } | { kind: 'error'; message: string } | { kind: 'conflict'; message: string };

const DATETIME = new Set(['arrived_at', 'rig_up_at', 'rig_down_at']);
const STAGE_INFO: Record<Stage, { n: string; title: string; sub: string }> = {
  design: { n: '01', title: 'Design', sub: 'Request, unit, dates and services' },
  preparation: { n: '02', title: 'Preparation', sub: 'Well, wire, pressure control, toolstring' },
  execution: { n: '03', title: 'Execution', sub: 'Times, runs, depths and NPT' },
  closure: { n: '04', title: 'Closure', sub: 'Sign-off and reporting' },
};

const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'na', label: 'N/A' }];
const kind = (field: string) => FIELD_POLICY[field]?.kind;
const emptyJson = (field: string) => (field === 'toolstring' ? '[]' : '{}');

// the editor keeps every field as text: JSON fields hold their JSON, money is shown in whole currency units
const toInput = (field: string, v: unknown) => {
  if (kind(field) === 'json') return JSON.stringify(v ?? JSON.parse(emptyJson(field)));
  if (v == null) return '';
  if (kind(field) === 'money') return String(Number(v) / 100);
  return DATETIME.has(field) ? isoToLocalInput(String(v)) : String(v);
};
const fromInput = (field: string, v: string): unknown => {
  if (kind(field) === 'json') return JSON.parse(v || emptyJson(field));
  if (kind(field) === 'money') return v === '' ? null : Math.round(Number(v) * 100);
  return DATETIME.has(field) ? localInputToIso(v) : v === '' ? null : v;
};

export function JobEditor() {
  const { id = 'new', stage: stageParam } = useParams();
  const stage: Stage = (STAGES as readonly string[]).includes(stageParam ?? '') ? (stageParam as Stage) : 'design';
  const isNew = id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();

  const jobQ = useQuery<Job, ApiError>({ queryKey: ['job', id], queryFn: () => api<Job>(`/jobs/${id}`), enabled: !isNew });
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<Lookups>('/lookups'), staleTime: 5 * 60_000 });
  const sdms = useQuery({ queryKey: ['sdms'], queryFn: () => api<{ username: string; full_name: string }[]>('/sdms'), staleTime: 5 * 60_000 });

  const [job, setJob] = useState<Job | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const pending = useRef<Record<string, unknown>>({});
  const jobRef = useRef<Job | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);

  const adopt = useCallback((j: Job) => {
    jobRef.current = j;
    setJob(j);
    setValues((cur) => {
      const next: Record<string, string> = {};
      for (const k of Object.keys(FIELD_POLICY)) next[k] = k in pending.current ? cur[k] ?? '' : toInput(k, (j as unknown as Record<string, unknown>)[k]);
      return next;
    });
  }, []);

  useEffect(() => { if (jobQ.data) adopt(jobQ.data); }, [jobQ.data, adopt]);
  // leaving the editor saves what is still waiting instead of dropping it
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); flushRef.current(); } }, []);

  const conflict = useRef(false);
  const flushRef = useRef<() => void>(() => undefined);
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), 1200);
  }, []);

  const flush = useCallback(async () => {
    if (inflight.current || conflict.current || !Object.keys(pending.current).length) return;
    inflight.current = true;
    const patch = pending.current;
    pending.current = {};
    setSave({ kind: 'saving' });
    try {
      const current = jobRef.current;
      const res = current
        ? await api<{ job: Job; ignored: string[] }>(`/jobs/${current.id}`, { method: 'PATCH', json: { patch, expectedUpdatedAt: current.updated_at } })
        : await api<{ job: Job; ignored: string[] }>('/jobs', { method: 'POST', json: { patch } });
      adopt(res.job);
      setFieldError(null);
      setSave({ kind: 'saved' });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
      if (!current) navigate(`/operation/jobs/${res.job.id}/${stage}`, { replace: true });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409) {
        pending.current = { ...patch, ...pending.current };
        conflict.current = true;
        setSave({ kind: 'conflict', message: err.message });
      } else {
        const field = Object.keys(patch)[0];
        setFieldError({ field, message: err.message });
        setSave({ kind: 'error', message: err.message });
      }
    } finally {
      inflight.current = false;
      if (Object.keys(pending.current).length && !conflict.current) schedule();
    }
  }, [adopt, navigate, qc, stage, schedule]);
  flushRef.current = flush;

  const changeMany = (fields: Record<string, string>) => {
    setValues((cur) => ({ ...cur, ...fields }));
    for (const [f, v] of Object.entries(fields)) pending.current[f] = fromInput(f, v);
    setSave({ kind: 'dirty' });
    schedule();
  };
  const change = (field: string, v: string) => changeMany({ [field]: v });
  const changeJson = (field: string, v: unknown) => changeMany({ [field]: JSON.stringify(v) });

  const reloadAfterConflict = async () => {
    pending.current = {};
    conflict.current = false;
    const fresh = await api<Job>(`/jobs/${jobRef.current?.id}`);
    adopt(fresh);
    setSave({ kind: 'idle' });
  };

  const canEditJobs = !!me?.menus.jobs?.edit;
  const jraLocked = useJraLock(job?.id);
  // Execution waits for an approved JRA on jobs that need one (the API refuses it too)
  const editable = (f: string) => canEditJobs && !!me && canEditField(me.role, f) && !(jraLocked && EXECUTION_FIELDS.includes(f));
  const preview = useMemo(() => ({ ...(job ?? {}), ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, fromInput(k, v)])), services: job?.services ?? [] }) as Partial<Job>, [job, values]);

  if (!isNew && jobQ.isPending) return <div aria-busy="true"><Skeleton className="mb-4 h-24" /><Skeleton className="h-96" /></div>;
  if (!isNew && jobQ.isError) {
    return <Banner tone="danger" action={<Link className="underline" to="/operation/jobs">Back to jobs</Link>}>{jobQ.error.status === 404 ? 'This job does not exist or is not in your countries.' : jobQ.error.message}</Banner>;
  }

  const text = (field: string, label: string, opts: { type?: string; unit?: string; hint?: ReactNode; placeholder?: string; list?: string } = {}) => (
    <Field id={field} label={label} badge={FIELD_POLICY[field]?.badge} unit={opts.unit} hint={opts.hint}
      error={fieldError?.field === field ? fieldError.message : null}>
      <input id={field} className={cx(inputClass, opts.unit && 'pr-10')} type={opts.type ?? 'text'} value={values[field] ?? ''}
        inputMode={opts.type === 'number' ? 'decimal' : undefined} min={opts.type === 'number' ? 0 : undefined} list={opts.list}
        placeholder={opts.placeholder} disabled={!editable(field)} aria-invalid={fieldError?.field === field || undefined}
        aria-describedby={fieldError?.field === field ? `${field}-err` : opts.hint ? `${field}-hint` : undefined}
        onChange={(e) => change(field, e.target.value)} />
    </Field>
  );

  const select = (field: string, label: string, options: { value: string; label: string }[], hint?: ReactNode, onPick?: (v: string) => void, locked?: boolean) => (
    <Field id={field} label={label} badge={FIELD_POLICY[field]?.badge} hint={hint} error={fieldError?.field === field ? fieldError.message : null}>
      <select id={field} className={inputClass} value={values[field] ?? ''} disabled={locked || !editable(field)}
        onChange={(e) => (onPick ?? ((v: string) => change(field, v)))(e.target.value)}>
        <option value="">Choose…</option>
        {/* keep a saved value visible even after it leaves the list */}
        {values[field] && !options.some((o) => o.value === values[field]) && <option value={values[field]}>{values[field]}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );

  const area = (field: string, label: string, placeholder?: string) => (
    <Field id={field} label={label} badge={FIELD_POLICY[field]?.badge} error={fieldError?.field === field ? fieldError.message : null}>
      <textarea id={field} rows={3} className={cx(inputClass, 'h-auto py-2')} value={values[field] ?? ''} placeholder={placeholder}
        disabled={!editable(field)} onChange={(e) => change(field, e.target.value)} />
    </Field>
  );

  const L = lookups.data;
  const num = (f: string) => (values[f] ? Number(values[f]) : null);
  const list = (k: string) => (L?.lists[k] ?? []).map((v) => ({ value: v, label: v }));
  const country = job?.country;
  // switched-off equipment stays on the jobs that have it but can't be picked again
  const pceOptions = (L?.pce ?? []).filter((p) => p.country === country && (p.active || p.id === values.pce_id));
  const pce = pceOptions.find((p) => p.id === values.pce_id);
  const flags = serviceFlags(job, L);
  const failureOpen = hasFailure(preview);
  const json = <T,>(f: string, fallback: T): T => { try { return JSON.parse(values[f] || 'null') ?? fallback; } catch { return fallback; } };
  const pickPce = (id: string) => {
    const p = pceOptions.find((x) => x.id === id);
    const next: Record<string, string> = { pce_id: id };
    // fill rating and lubricator length from the equipment while they are still empty
    if (p?.rating_psi && !values.pressure_rating_psi && editable('pressure_rating_psi')) next.pressure_rating_psi = String(p.rating_psi);
    if (p?.length_ft && !values.lubricator_length_ft && editable('lubricator_length_ft')) next.lubricator_length_ft = String(p.length_ft);
    changeMany(next);
  };
  const needsJob = !job ? <Card><LockHint>Save a first detail on Design, then fill this stage.</LockHint></Card> : null;
  const op = opHours(preview.rig_up_at ?? null, preview.rig_down_at ?? null, num('op_hours_override'));
  const eff = jobEfficiency(op, num('npt_hours') ?? 0);
  const runEff = runEfficiency(num('runs_ok'), num('runs_failed'));

  return (
    <section aria-labelledby="job-title">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/operation/jobs" className="inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-xs font-semibold hover:bg-surface-3">
          <ArrowLeft aria-hidden className="size-4" />Jobs
        </Link>
        <h1 id="job-title" className="min-w-0 truncate font-display text-xl font-extrabold uppercase">
          {job?.ticket_no ?? (isNew ? 'New job' : 'Job without ticket')}
        </h1>
        {job && <StatusPill status={job.status} />}
        <SaveIndicator state={save} />
        {job && <Link to={`/operation/jobs/${job.id}/report`} className="inline-flex h-(--layout-control-sm) items-center rounded-md border border-border-strong px-3 text-xs font-semibold hover:bg-surface-2">Job report</Link>}
        {job && me?.menus.jobs?.delete && <DeleteJob job={job} onDeleted={() => { qc.invalidateQueries({ queryKey: ['jobs'] }); qc.invalidateQueries({ queryKey: ['schedule'] }); navigate('/operation/jobs', { replace: true }); }} />}
      </div>

      {isNew && <p className="mb-4 text-sm text-text-muted">Nothing is saved until you enter the first detail, so opening this page never leaves an empty job behind.</p>}
      {save.kind === 'conflict' && (
        <div className="mb-4"><Banner tone="warning" action={<Button size="sm" onClick={reloadAfterConflict}>Load their version</Button>}>{save.message}. Your unsaved edits are kept until you reload.</Banner></div>
      )}
      {!canEditJobs && <div className="mb-4"><Banner tone="info">You can view this job. Your role does not edit jobs.</Banner></div>}

      <div role="tablist" aria-label="Job stages" className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {STAGES.map((s) => {
          const pct = stagePercent(preview, s);
          return (
            <Link key={s} role="tab" aria-selected={s === stage} to={`/operation/jobs/${id}/${s}`} replace
              className={cx('rounded-lg border bg-surface p-3', s === stage ? 'border-accent bg-surface-2' : 'border-border hover:border-border-strong')}>
              <span className="font-mono text-xs text-text-subtle">{STAGE_INFO[s].n} · {pct}%</span>
              <span className="mt-1 block font-display text-lg leading-none font-extrabold uppercase">{STAGE_INFO[s].title}</span>
              <span className="mt-1 mb-2 block text-xs text-text-muted">{STAGE_INFO[s].sub}</span>
              <ProgressBar value={pct} label={STAGE_INFO[s].title} />
            </Link>
          );
        })}
      </div>

      <div role="tabpanel" aria-label={STAGE_INFO[stage].title}>
        {stage === 'design' && (
          <Card>
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
              {text('ticket_no', 'Field ticket', { placeholder: 'e.g. 26560', hint: 'Matched against WIREGUARD runs' })}
              {text('drss_no', 'DRSS number')}
              {text('dmr_no', 'DMR number')}
              {select('program_in_place', 'Program in place', [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }])}
              {select('third_party_required', 'Third party required', YES_NO)}
              {select('status', 'Job status', ['planned', 'ongoing', 'completed', 'canceled'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })))}
              {select('unit_number', 'Slickline unit', (L?.units ?? []).map((u) => ({ value: u.unit_number, label: `${u.unit_number} · ${u.country}` })), 'From WIREGUARD')}
              {select('sdm_username', 'SDM', (sdms.data ?? []).map((s) => ({ value: s.username, label: s.full_name })),
                sdms.data && !sdms.data.length && !job?.sdm_username ? 'No one holds the SDM role yet' : undefined)}
              {text('start_date', 'Start date', { type: 'date' })}
              {text('end_date', 'End date', { type: 'date' })}
              {select('location', 'Location (account)', (L?.locations ?? []).map((v) => ({ value: v, label: v })), 'From WIREGUARD')}
              {select('field', 'Field', (L?.fields ?? []).map((v) => ({ value: v, label: v })), 'From WIREGUARD')}
              {text('rig', 'Rig / site', { list: 'rig-list', hint: 'Pick from WIREGUARD rigs or type a site' })}
              <datalist id="rig-list">{(L?.rigs ?? []).map((r) => <option key={r} value={r} />)}</datalist>
              {text('well', 'Well')}
              {select('conveyance', 'Conveyance', (L?.conveyances ?? []).map((v) => ({ value: v, label: v })))}
              <div className="md:col-span-2 xl:col-span-3">
                <Field id="run_details" label="Run details" badge={FIELD_POLICY.run_details.badge}>
                  <textarea id="run_details" rows={3} className={cx(inputClass, 'h-auto py-2')} value={values.run_details ?? ''}
                    disabled={!editable('run_details')} onChange={(e) => change('run_details', e.target.value)}
                    placeholder="Objective, intervals and anything the crew must know" />
                </Field>
              </div>
            </div>
            {job && <PreJobNotePanel jobId={job.id} />}
            <ServicesPicker job={job} options={L?.jobTypes ?? []} profiles={L?.serviceProfiles ?? []} canEdit={editable('run_details')} onSaved={adopt} />
          </Card>
        )}

        {stage === 'execution' && (
          <Card>
            {job && <JraBanner jobId={job.id} />}
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
              {text('arrived_at', 'Arrived on site', { type: 'datetime-local', hint: 'Riyadh time' })}
              {text('rig_up_at', 'Rig-up', { type: 'datetime-local', hint: 'Riyadh time' })}
              {text('rig_down_at', 'Rig-down', { type: 'datetime-local', hint: 'Riyadh time' })}
              {text('runs_ok', 'Successful runs', { type: 'number' })}
              {text('runs_failed', 'Failed runs', { type: 'number' })}
              {text('max_depth_ft', 'Max depth reached', { type: 'number', unit: 'ft' })}
              {text('tag_depth_ft', 'Tag depth', { type: 'number', unit: 'ft' })}
              {text('max_pull_lb', 'Max pull', { type: 'number', unit: 'lb' })}
              {text('max_overpull_lb', 'Max overpull', { type: 'number', unit: 'lb', hint: 'Above string weight' })}
              {text('jarring_minutes', 'Jarring time', { type: 'number', unit: 'min' })}
              {text('wire_cut_ft', 'Wire cut', { type: 'number', unit: 'ft', hint: 'Compared with WIREGUARD runs in reconciliation' })}
              {text('npt_hours', 'NPT', { type: 'number', unit: 'h' })}
              {select('failure', 'Failure', [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'na', label: 'N/A' }])}
              {text('op_hours_override', 'Operating hours override', { type: 'number', unit: 'h', hint: 'SDM or Ops Manager only. Leave empty to use rig-up → rig-down' })}
              {select('plug_type', 'Plug type', flags.is_plug ? list('plug_type') : [], flags.is_plug ? 'Set or pulled on this job' : 'Opens with a plug service', undefined, !flags.is_plug)}
              <div className="md:col-span-2 xl:col-span-3">{area('op_time_details', 'Operating time details', 'What happened, run by run, and any waiting time')}</div>
            </div>
            <ServiceSection on={flags.is_fishing} title="Fishing" need="a fishing service">
              <DetailsSection idPrefix="fishing" value={json('fishing_details', {})} canEdit={editable('fishing_details')} onChange={(v) => changeJson('fishing_details', v)}
                fields={[{ key: 'fish', label: 'Fish description' }, { key: 'fish_top_ft', label: 'Top of fish', type: 'number', unit: 'ft' },
                  { key: 'fish_length_ft', label: 'Fish length', type: 'number', unit: 'ft' }, { key: 'fish_od_in', label: 'Fish OD', type: 'number', unit: 'in' },
                  { key: 'tool_used', label: 'Fishing tool' }, { key: 'outcome', label: 'Outcome (recovered, partial, left)' }]} />
            </ServiceSection>
            <ServiceSection on={flags.is_memory} title="Memory survey" need="a memory gauge service">
              <DetailsSection idPrefix="survey" value={json('survey_details', {})} canEdit={editable('survey_details')} onChange={(v) => changeJson('survey_details', v)}
                fields={[{ key: 'gauge_type', label: 'Gauge type' }, { key: 'gauge_serials', label: 'Gauge serials' },
                  { key: 'survey_type', label: 'Survey (static, flowing, build-up)' }, { key: 'stops', label: 'Stations', type: 'number' },
                  { key: 'deepest_station_ft', label: 'Deepest station', type: 'number', unit: 'ft' }, { key: 'data_quality', label: 'Data quality' }]} />
            </ServiceSection>
            {flags.is_explosive && <ExplosivesPrompt job={job} />}
            <ServiceSection on={flags.is_perforation} title="Perforation" need="a perforation service">
              <DetailsSection idPrefix="perf" value={json('perforation_details', {})} canEdit={editable('perforation_details')} onChange={(v) => changeJson('perforation_details', v)}
                fields={[{ key: 'gun_type', label: 'Gun type' }, { key: 'top_ft', label: 'Top shot', type: 'number', unit: 'ft' },
                  { key: 'bottom_ft', label: 'Bottom shot', type: 'number', unit: 'ft' }, { key: 'shots', label: 'Shots fired', type: 'number' },
                  { key: 'misfires', label: 'Misfires', type: 'number' }, { key: 'explosive_ticket', label: 'Explosive ticket' }]} />
            </ServiceSection>
            <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-live="polite">
              <Metric label="Operating hours" value={op != null ? `${op} h` : '—'} note={op == null ? 'needs rig-up and rig-down' : preview.op_hours_override ? 'override' : 'rig-up → rig-down'} />
              <Metric label="Job efficiency" value={eff != null ? `${eff}%` : '—'} note="(1 − NPT ÷ op hours) × 100" />
              <Metric label="Run efficiency" value={runEff != null ? `${runEff}%` : '—'} note="successful ÷ total runs" />
            </dl>
            {job && (
              <>
                <SectionTitle aside="Kept on the device when there is no signal">Job log · sequence of events</SectionTitle>
                <JobLogEvents jobId={job.id} canEdit={canEditJobs && !jraLocked} />
              </>
            )}
          </Card>
        )}

        {stage === 'preparation' && (needsJob ?? (job && (
          <Card>
            <JraBanner jobId={job.id} />
            <SectionTitle>Well</SectionTitle>
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
              {text('account_assignment', 'Account assignment')}
              {select('well_type', 'Well type', list('well_type'))}
              {text('h2s_ppm', 'H₂S', { type: 'number', unit: 'ppm' })}
              {text('co2_pct', 'CO₂', { type: 'number', unit: '%' })}
              {text('bht_f', 'BHT', { type: 'number', unit: '°F' })}
              {text('bhp_psi', 'BHP', { type: 'number', unit: 'psi' })}
              {text('siwhp_psi', 'SIWHP', { type: 'number', unit: 'psi' })}
              {select('fluid_type', 'Fluid type', list('fluid_type'))}
              {text('fluid_weight_pcf', 'Fluid weight', { type: 'number', unit: 'pcf' })}
              {text('solids_pct', 'Solids', { type: 'number', unit: '%' })}
              {text('target_depth_ft', 'Target depth', { type: 'number', unit: 'ft' })}
              {text('top_interval_ft', 'Top of interval', { type: 'number', unit: 'ft' })}
              {select('nipple_profile', 'Nipple profile', list('nipple_profile'))}
              {text('sssv_depth_ft', 'SSSV depth', { type: 'number', unit: 'ft' })}
              {text('min_restriction_in', 'Minimum restriction', { type: 'number', unit: 'in', hint: 'Checked against the largest tool OD' })}
              {text('max_inclination_deg', 'Max inclination', { type: 'number', unit: '°' })}
              {select('target_casing_type', 'Target casing / tubing', list('casing_type'))}
              {select('target_casing_od', 'Casing OD', list('casing_od'))}
              {text('target_casing_weight_lbft', 'Casing weight', { type: 'number', unit: 'lb/ft' })}
              {select('target_casing_grade', 'Casing grade', list('casing_grade'))}
              {text('wellhead_connection', 'Wellhead connection', { placeholder: 'e.g. 4-1/16" 10K flange' })}
              <div className="md:col-span-2 xl:col-span-3">{area('completion_details', 'Completion details', 'Tubing, nipples and restrictions top to bottom')}</div>
            </div>

            <SectionTitle aside="From WIREGUARD">Wire and drum</SectionTitle>
            <WirePanel job={job} canEdit={editable('drum_no') && editable('wire_serial_number')}
              onPick={(drum, wire) => changeMany({ drum_no: drum ?? '', wire_serial_number: wire ?? '' })} />

            <SectionTitle>Pressure control</SectionTitle>
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
              {select('pce_id', 'Pressure control set', pceOptions.map((p) => ({ value: p.id, label: `${p.label} · ${p.bore_in} in bore${p.active ? '' : ' (switched off)'}` })),
                !pceOptions.some((p) => p.active) ? 'No equipment listed yet (Database)' : pce ? `${pce.bore_in} in bore${pce.rating_psi ? ` · ${pce.rating_psi.toLocaleString()} psi` : ''}` : undefined, pickPce)}
              {select('pressure_rating_psi', 'Pressure rating', ['5000', '10000', '15000'].map((v) => ({ value: v, label: `${Number(v).toLocaleString()} psi` })))}
              {text('lubricator_length_ft', 'Lubricator length', { type: 'number', unit: 'ft' })}
              {select('stuffing_box_type', 'Stuffing box', list('stuffing_box_type'))}
              {select('grease_panel_id', 'Grease panel', (L?.greasePanels ?? []).filter((g) => g.country === country && (g.active || g.id === values.grease_panel_id)).map((g) => ({ value: g.id, label: g.label })), 'Braided line only')}
              {select('jar_type', 'Jar type', list('jar_type'))}
              {select('special_setup', 'Special setup', YES_NO)}
              {values.special_setup === 'yes' && text('special_setup_notes', 'Special setup notes')}
            </div>

            <SectionTitle aside="Rope socket at the top">Toolstring</SectionTitle>
            <ToolstringBuilder value={json<ToolPart[]>('toolstring', [])} canEdit={editable('toolstring')} onChange={(parts) => changeJson('toolstring', parts)}
              ctx={{ minRestrictionIn: num('min_restriction_in'), pceBoreIn: pce?.bore_in ?? null, lubricatorFt: num('lubricator_length_ft') }} />

            <SectionTitle aside="Head count and named crew">Crew</SectionTitle>
            <CrewPanel job={job} canEdit={editable('well_type')} />
          </Card>
        )))}

        {stage === 'closure' && (needsJob ?? (
          <Card>
            <SectionTitle>Sign-off</SectionTitle>
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
              {select('job_log_signed', 'Job log signed', YES_NO)}
              {select('ticket_signed', 'Field ticket signed', YES_NO)}
              {select('wellsite_audit', 'Wellsite audit', YES_NO)}
              {select('wg_runs_logged', 'Runs logged in WIREGUARD', YES_NO, 'Reconciliation checks this against WIREGUARD')}
              {select('service_order', 'Service order raised', YES_NO)}
              {text('job_package_url', 'Job package link', { placeholder: 'https://… or a network path', hint: 'Where the signed documents are filed' })}
            </div>

            <SectionTitle aside="SDM or Sales">Revenue and bonus</SectionTitle>
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
              {text('revenue_cents', 'Ticket value', { type: 'number', unit: job?.revenue_currency ?? 'USD', hint: 'Feeds the Sales Dashboard' })}
              <div className="md:col-span-2">{area('bonus_remarks', 'Bonus remarks', 'Anything the bonus review should know')}</div>
            </div>

            {job && me && ['admin', 'sdm', 'deputy_sdm'].includes(me.role) && (
              <>
                <SectionTitle aside="Admin and SDM only">Crew assignment and bonus distribution</SectionTitle>
                <BonusDistribution jobId={job.id} />
              </>
            )}

            <SectionTitle aside={failureOpen ? 'NPT or a failure on this job' : undefined}>Failure follow-up</SectionTitle>
            {!failureOpen ? <LockHint>Opens when the job has NPT hours or Failure = Yes on Execution.</LockHint> : (
              <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
                {select('eight_min_facts_done', '8 Min. Facts done', YES_NO)}
                {select('prelim_report', 'Preliminary report', YES_NO)}
                {select('final_report', 'Final report', YES_NO)}
                {select('report_closure_status', 'Report status', [{ value: 'open', label: 'Open' }, { value: 'pending_review', label: 'Pending review' }, { value: 'closed', label: 'Closed' }, { value: 'na', label: 'N/A' }])}
                {text('report_closure_date', 'Report closed on', { type: 'date' })}
                {text('gears_no', 'GEARS number')}
                <div className="md:col-span-2 xl:col-span-3">{area('failure_description', 'Failure description', 'What failed, why, and what was done')}</div>
              </div>
            )}
          </Card>
        ))}
        {job && <Card className="mt-4"><Attachments entity="job" id={job.id} /></Card>}
      </div>
    </section>
  );
}

/** Two steps, so a stray click never removes a job. The API refuses jobs that have a Pre-Job Note or 8 Min. Facts. */
function DeleteJob({ job, onDeleted }: { job: Job; onDeleted: () => void }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setStep('busy');
    try { await api(`/jobs/${job.id}`, { method: 'DELETE' }); onDeleted(); }
    catch (e) { setError((e as ApiError).message); setStep('idle'); }
  };
  return (
    <span className="flex items-center gap-2">
      {error && <span role="alert" className="max-w-md text-xs text-danger">{error}</span>}
      {step === 'idle'
        ? <Button size="sm" variant="ghost" onClick={() => { setError(null); setStep('confirm'); }}>Delete job</Button>
        : <><Button size="sm" variant="danger" loading={step === 'busy'} onClick={remove}>Delete {job.ticket_no ?? 'this job'}</Button><Button size="sm" variant="ghost" onClick={() => setStep('idle')}>Keep</Button></>}
    </span>
  );
}

function ServiceSection({ on, title, need, children }: { on: boolean; title: string; need: string; children: ReactNode }) {
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      {on ? children : <LockHint>Opens when the job has {need} (Design → Services).</LockHint>}
    </>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <dt className="label-caps text-text-muted">{label}</dt>
      <dd className="mt-1 font-display text-kpi leading-none font-bold">{value}</dd>
      <dd className="mt-1 text-xs text-text-subtle">{note}</dd>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map = {
    idle: null,
    dirty: <span className="text-text-muted">Unsaved changes</span>,
    saving: <span className="inline-flex items-center gap-1.5 text-text-muted"><Loader2 aria-hidden className="size-3.5 animate-spin" />Saving…</span>,
    saved: <span className="inline-flex items-center gap-1.5 text-success"><Check aria-hidden className="size-3.5" />All changes saved</span>,
    error: <span className="inline-flex items-center gap-1.5 text-danger"><AlertCircle aria-hidden className="size-3.5" />Not saved</span>,
    conflict: <span className="inline-flex items-center gap-1.5 text-warning"><AlertCircle aria-hidden className="size-3.5" />Changed elsewhere</span>,
  } as const;
  return <span role="status" aria-live="polite" className="ml-auto text-xs font-semibold">{map[state.kind]}</span>;
}

/** Tubing punch, cutter and other explosive services: explosives go to the well through the explosive inventory. */
function ExplosivesPrompt({ job }: { job: Job | null }) {
  const { data: me } = useMe();
  const canView = !!me?.menus.inventory_explosive?.view;
  const canMove = !!me?.menus.inventory_explosive?.edit;
  const recon = useQuery({
    queryKey: ['inv-recon', 'explosive', job?.country], enabled: !!job && canView,
    queryFn: () => api<{ rows: { job_id: string | null; item_id: string; mobilized: number; consumed: number; returned: number; open: number }[]; items: { id: string; description: string; uom: string }[] }>(`/inventory/explosive/reconciliation?country=${encodeURIComponent(job!.country)}`),
  });
  if (!job) return null;
  const mine = (recon.data?.rows ?? []).filter((r) => r.job_id === job.id);
  const item = (id: string) => recon.data?.items.find((i) => i.id === id);
  const to = `/inventory/explosive?country=${encodeURIComponent(job.country)}&mobilize=${job.id}${job.well ? `&well=${encodeURIComponent(job.well)}` : ''}`;
  return (
    <div className="mt-4">
      <Banner tone="warning" action={canMove && <Link to={to} className="text-sm font-semibold underline">Mobilize explosives to the well</Link>}>
        This job has an explosive service. Record the explosives sent to the well against this job, then the consumption and return after the job.
        {!canView && ' Ask the explosives custodian to record them; your access does not include the explosive inventory.'}
      </Banner>
      {canView && mine.length > 0 && (
        <table className="mt-2 w-full text-xs">
          <thead><tr className="text-left text-text-muted">{['Item', 'Mobilized', 'Consumed', 'Returned', 'Still at well'].map((h) => <th key={h} scope="col" className="py-1 pr-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{mine.map((r) => (
            <tr key={r.item_id} className="border-t border-border"><td className="py-1 pr-3">{item(r.item_id)?.description ?? r.item_id}</td>
              <td className="py-1 pr-3 font-mono">{r.mobilized}</td><td className="py-1 pr-3 font-mono">{r.consumed}</td><td className="py-1 pr-3 font-mono">{r.returned}</td>
              <td className={cx('py-1 pr-3 font-mono', r.open > 0 && 'text-warning')}>{r.open} {item(r.item_id)?.uom}</td></tr>
          ))}</tbody>
        </table>
      )}
      {canView && recon.isSuccess && !mine.length && <p className="mt-1 text-xs text-text-subtle">No explosives recorded against this job yet.</p>}
    </div>
  );
}

function ServicesPicker({ job, options, profiles, canEdit, onSaved }: { job: Job | null; options: string[]; profiles: Lookups['serviceProfiles']; canEdit: boolean; onSaved: (j: Job) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = job?.services ?? [];
  // the job's service domain follows its first service, as set per job type in Database
  const domains = [...new Set(selected.map((s) => profiles.find((p) => p.job_type_name === s)?.domain).filter(Boolean))];
  const toggle = async (name: string) => {
    if (!job) return;
    const next = selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name];
    if (next.length > 15) { setError('Up to 15 services per job'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ job: Job }>(`/jobs/${job.id}/services`, { method: 'PUT', json: { services: next } });
      onSaved(res.job);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="mt-6" aria-busy={busy}>
      <legend className="label-caps mb-2 flex items-center gap-2 text-text-muted">
        Services <span className="normal-case tracking-normal text-text-subtle">(WIREGUARD job types, up to 15)</span>
      </legend>
      {!job && <LockHint>Save a first detail above, then pick the services.</LockHint>}
      {domains.length > 0 && <p className="mb-2 text-sm"><span className="text-text-muted">Service domain:</span> <span className="font-semibold">{domains[0]}</span>{domains.length > 1 && <span className="text-text-subtle"> (also {domains.slice(1).join(', ')})</span>}</p>}
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      {job && (
        <div className="flex flex-wrap gap-2">
          {options.map((name) => {
            const on = selected.includes(name);
            return (
              <button key={name} type="button" role="checkbox" aria-checked={on} disabled={!canEdit || busy} onClick={() => toggle(name)}
                className={cx('h-(--layout-control-sm) rounded-pill border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60',
                  on ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>
                {on && selected.length > 1 && <span className="mr-1 font-mono">{selected.indexOf(name) + 1}.</span>}{name}
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
