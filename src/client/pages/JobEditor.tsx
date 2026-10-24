import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, Check, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { FIELD_POLICY, canEditField } from '../../shared/fieldPolicy';
import { jobEfficiency, opHours, runEfficiency } from '../../shared/metrics';
import { STAGES, stagePercent, type Stage } from '../../shared/stages';
import type { Job, Lookups } from '../../shared/types';
import { ApiError, api, isoToLocalInput, localInputToIso } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, Field, LockHint, ProgressBar, Skeleton, StatusPill, cx, inputClass } from '../components/ui';

type SaveState = { kind: 'idle' | 'dirty' | 'saving' | 'saved' } | { kind: 'error'; message: string } | { kind: 'conflict'; message: string };

const DATETIME = new Set(['arrived_at', 'rig_up_at', 'rig_down_at']);
const STAGE_INFO: Record<Stage, { n: string; title: string; sub: string }> = {
  design: { n: '01', title: 'Design', sub: 'Request, unit, dates and services' },
  preparation: { n: '02', title: 'Preparation', sub: 'Well, wire, pressure control, toolstring' },
  execution: { n: '03', title: 'Execution', sub: 'Times, runs, depths and NPT' },
  closure: { n: '04', title: 'Closure', sub: 'Sign-off and reporting' },
};

const toInput = (field: string, v: unknown) => (v == null ? '' : DATETIME.has(field) ? isoToLocalInput(String(v)) : String(v));
const fromInput = (field: string, v: string) => (DATETIME.has(field) ? localInputToIso(v) : v === '' ? null : v);

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
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

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

  const change = (field: string, v: string) => {
    setValues((cur) => ({ ...cur, [field]: v }));
    pending.current[field] = fromInput(field, v);
    setSave({ kind: 'dirty' });
    schedule();
  };

  const reloadAfterConflict = async () => {
    pending.current = {};
    conflict.current = false;
    const fresh = await api<Job>(`/jobs/${jobRef.current?.id}`);
    adopt(fresh);
    setSave({ kind: 'idle' });
  };

  const canEditJobs = !!me?.menus.jobs?.edit;
  const editable = (f: string) => canEditJobs && !!me && canEditField(me.role, f);
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

  const select = (field: string, label: string, options: { value: string; label: string }[], hint?: ReactNode) => (
    <Field id={field} label={label} badge={FIELD_POLICY[field]?.badge} hint={hint} error={fieldError?.field === field ? fieldError.message : null}>
      <select id={field} className={inputClass} value={values[field] ?? ''} disabled={!editable(field)} onChange={(e) => change(field, e.target.value)}>
        <option value="">Choose…</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );

  const L = lookups.data;
  const num = (f: string) => (values[f] ? Number(values[f]) : null);
  const op = opHours(preview.rig_up_at ?? null, preview.rig_down_at ?? null, num('op_hours_override'));
  const eff = jobEfficiency(op, num('npt_hours') ?? 0);
  const runEff = runEfficiency(num('runs_ok'), num('runs_failed'));

  return (
    <section aria-labelledby="job-title">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/operation/jobs" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-xs font-semibold hover:bg-surface-3">
          <ArrowLeft aria-hidden className="size-4" />Jobs
        </Link>
        <h1 id="job-title" className="min-w-0 truncate font-display text-xl font-extrabold uppercase">
          {job?.ticket_no ?? (isNew ? 'New job' : 'Job without ticket')}
        </h1>
        {job && <StatusPill status={job.status} />}
        <SaveIndicator state={save} />
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
              {select('status', 'Job status', ['planned', 'ongoing', 'completed', 'canceled'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })))}
              {select('unit_number', 'Slickline unit', (L?.units ?? []).map((u) => ({ value: u.unit_number, label: `${u.unit_number} · ${u.country}` })), 'From WIREGUARD')}
              {select('sdm_username', 'SDM', (sdms.data ?? []).map((s) => ({ value: s.username, label: s.full_name })),
                sdms.data && !sdms.data.length ? 'No one holds the SDM role yet' : undefined)}
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
            <ServicesPicker job={job} options={L?.jobTypes ?? []} canEdit={editable('run_details')} onSaved={adopt} />
          </Card>
        )}

        {stage === 'execution' && (
          <Card>
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
              {text('arrived_at', 'Arrived on site', { type: 'datetime-local', hint: 'Riyadh time' })}
              {text('rig_up_at', 'Rig-up', { type: 'datetime-local', hint: 'Riyadh time' })}
              {text('rig_down_at', 'Rig-down', { type: 'datetime-local', hint: 'Riyadh time' })}
              {text('runs_ok', 'Successful runs', { type: 'number' })}
              {text('runs_failed', 'Failed runs', { type: 'number' })}
              {text('max_depth_ft', 'Max depth reached', { type: 'number', unit: 'ft' })}
              {text('tag_depth_ft', 'Tag depth', { type: 'number', unit: 'ft' })}
              {text('max_pull_lb', 'Max pull', { type: 'number', unit: 'lb' })}
              {text('jarring_minutes', 'Jarring time', { type: 'number', unit: 'min' })}
              {text('wire_cut_ft', 'Wire cut', { type: 'number', unit: 'ft', hint: 'Compared with WIREGUARD runs in reconciliation' })}
              {text('npt_hours', 'NPT', { type: 'number', unit: 'h' })}
              {select('failure', 'Failure', [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'na', label: 'N/A' }])}
              {text('op_hours_override', 'Operating hours override', { type: 'number', unit: 'h', hint: 'SDM or Ops Manager only. Leave empty to use rig-up → rig-down' })}
            </div>
            <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-live="polite">
              <Metric label="Operating hours" value={op != null ? `${op} h` : '—'} note={op == null ? 'needs rig-up and rig-down' : preview.op_hours_override ? 'override' : 'rig-up → rig-down'} />
              <Metric label="Job efficiency" value={eff != null ? `${eff}%` : '—'} note="(1 − NPT ÷ op hours) × 100" />
              <Metric label="Run efficiency" value={runEff != null ? `${runEff}%` : '—'} note="successful ÷ total runs" />
            </dl>
          </Card>
        )}

        {(stage === 'preparation' || stage === 'closure') && (
          <Card><LockHint>{STAGE_INFO[stage].title} fields arrive with milestone 2d: {stage === 'preparation' ? 'well data, wire and drum from WIREGUARD, pressure control and the toolstring builder' : 'sign-off, reporting and the failure follow-up'}.</LockHint></Card>
        )}
      </div>
    </section>
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

function ServicesPicker({ job, options, canEdit, onSaved }: { job: Job | null; options: string[]; canEdit: boolean; onSaved: (j: Job) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = job?.services ?? [];
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
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      {job && (
        <div className="flex flex-wrap gap-2">
          {options.map((name) => {
            const on = selected.includes(name);
            return (
              <button key={name} type="button" role="checkbox" aria-checked={on} disabled={!canEdit || busy} onClick={() => toggle(name)}
                className={cx('h-7 rounded-pill border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60',
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
