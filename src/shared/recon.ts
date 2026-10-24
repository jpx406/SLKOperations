// Reconciliation of SLK Ops jobs with WIREGUARD job-log runs. Pure functions: no database, so every
// rule here is unit-tested (tests/recon.test.ts). The Worker loads the rows, calls reconcile() and stores
// the findings (src/worker/recon.ts).
//
// Matching, in order: a manual link → the same real field ticket → the same real DRSS number →
// the run's drum belongs to the job's unit and the run date falls in the job's dates (±1 day), and
// the well agrees when both sides have one. WIREGUARD's legacy rows carry placeholder tickets
// (LEG-BATCH-n), which never count as a match.

export type CheckCode =
  | 'no_runs' | 'unlinked_runs' | 'date_mismatch' | 'unit_drum_mismatch' | 'wire_mismatch'
  | 'location_mismatch' | 'service_mismatch' | 'value_mismatch' | 'runs_pending_approval';
export type Severity = 'info' | 'low' | 'medium' | 'high';

export const CHECKS: Record<CheckCode, { severity: Severity; label: string }> = {
  no_runs: { severity: 'high', label: 'No WIREGUARD runs for a completed job' },
  unit_drum_mismatch: { severity: 'high', label: 'Run drum is on another unit' },
  wire_mismatch: { severity: 'high', label: 'Run used a different wire' },
  unlinked_runs: { severity: 'medium', label: 'WIREGUARD runs not linked to any job' },
  date_mismatch: { severity: 'medium', label: 'Run dates outside the job dates' },
  runs_pending_approval: { severity: 'medium', label: 'Runs still awaiting approval in WIREGUARD' },
  location_mismatch: { severity: 'low', label: 'Well, field or rig differ' },
  service_mismatch: { severity: 'low', label: 'Run job type not among the job services' },
  value_mismatch: { severity: 'low', label: 'Depth, jarring or wire cut differ' },
};

export const TOLERANCE = { depthFt: 50, depthPct: 0.02, jarringMin: 5, wireCutFt: 10, dayWindow: 1 };

export interface ReconJob {
  id: string; country: string; status: string; ticket_no: string | null; drss_no: string | null;
  unit_number: string | null; start_date: string | null; end_date: string | null;
  well: string | null; field: string | null; rig: string | null; wire_serial_number: string | null;
  max_depth_ft: number | null; jarring_minutes: number | null; wire_cut_ft: number | null; services: string[];
}

export interface ReconRun {
  wg_id: string; country: string | null; job_date: string; field_ticket: string | null; drss_number: string | null;
  drum_no: string | null; wire_serial_number: string | null; well: string | null; field_name: string | null; rig: string | null;
  job_name: string | null; max_depth_ft: number | null; jarring_minutes: number | null; wire_cut_ft: number | null; approval_status: string | null;
}

export interface FieldDiff { field: string; ours: string | number | null; theirs: string | number | null; ok: boolean }

export interface Finding {
  check: CheckCode; severity: Severity; country: string; job_id: string | null; wg_run_ids: string[];
  fingerprint: string; detail: { summary: string; matchedBy?: string; fields?: FieldDiff[]; candidates?: string[]; unit?: string | null };
}

export interface ReconInput {
  jobs: ReconJob[];
  runs: ReconRun[];
  links: { wg_run_id: string; job_id: string }[];
  drumUnit: Record<string, string | null>;
  today: string; // YYYY-MM-DD, local
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const isPlaceholder = (s: string | null | undefined) => !s || /^leg-?batch/i.test(s.trim());
export const realKey = (s: string | null | undefined) => (isPlaceholder(s) ? '' : norm(s));

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function jobWindow(job: Pick<ReconJob, 'start_date' | 'end_date'>) {
  if (!job.start_date) return null;
  return { from: addDays(job.start_date, -TOLERANCE.dayWindow), to: addDays(job.end_date ?? job.start_date, TOLERANCE.dayWindow) };
}

/** Assigns runs to jobs. Returns the matches and, for runs left over, the jobs they could belong to. */
export function matchRuns(input: ReconInput) {
  const byJob = new Map<string, { runs: ReconRun[]; by: Set<string> }>();
  const assign = (jobId: string, run: ReconRun, by: string) => {
    const m = byJob.get(jobId) ?? { runs: [], by: new Set<string>() };
    m.runs.push(run);
    m.by.add(by);
    byJob.set(jobId, m);
  };
  const jobsById = new Map(input.jobs.map((j) => [j.id, j]));
  const linked = new Map(input.links.map((l) => [l.wg_run_id, l.job_id]));
  const byTicket = new Map<string, ReconJob[]>();
  const byDrss = new Map<string, ReconJob[]>();
  for (const j of input.jobs) {
    const t = realKey(j.ticket_no);
    if (t) byTicket.set(`${j.country}|${t}`, [...(byTicket.get(`${j.country}|${t}`) ?? []), j]);
    const d = realKey(j.drss_no);
    if (d) byDrss.set(`${j.country}|${d}`, [...(byDrss.get(`${j.country}|${d}`) ?? []), j]);
  }

  const unmatched: { run: ReconRun; candidates: string[] }[] = [];
  for (const run of input.runs) {
    const manual = linked.get(run.wg_id);
    if (manual && jobsById.has(manual)) { assign(manual, run, 'manual link'); continue; }

    const t = realKey(run.field_ticket);
    const tJobs = t ? byTicket.get(`${run.country}|${t}`) ?? [] : [];
    if (tJobs.length === 1) { assign(tJobs[0].id, run, 'field ticket'); continue; }

    const d = realKey(run.drss_number);
    const dJobs = d ? byDrss.get(`${run.country}|${d}`) ?? [] : [];
    if (dJobs.length === 1) { assign(dJobs[0].id, run, 'DRSS number'); continue; }

    const unit = run.drum_no ? input.drumUnit[run.drum_no] ?? null : null;
    const onUnit = input.jobs.filter((j) => {
      const w = jobWindow(j);
      return !!unit && j.unit_number === unit && j.country === run.country && !!w && run.job_date >= w.from && run.job_date <= w.to;
    });
    const wellAgrees = (j: ReconJob) => !j.well || !run.well || norm(j.well) === norm(run.well);
    const auto = onUnit.filter(wellAgrees);
    if (auto.length === 1) { assign(auto[0].id, run, 'unit + date' + (auto[0].well && run.well ? ' + well' : '')); continue; }
    unmatched.push({ run, candidates: [...new Set([...tJobs, ...dJobs, ...onUnit].map((j) => j.id))] });
  }
  return { byJob, unmatched };
}

const diff = (field: string, ours: string | number | null, theirs: string | number | null, ok: boolean): FieldDiff => ({ field, ours, theirs, ok });
const distinct = <T,>(xs: T[]) => [...new Set(xs.filter((x) => x !== null && x !== undefined && x !== ''))];
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

export function reconcile(input: ReconInput): Finding[] {
  const { byJob, unmatched } = matchRuns(input);
  const out: Finding[] = [];
  const add = (check: CheckCode, job: ReconJob | null, runs: ReconRun[], key: string, detail: Finding['detail']) =>
    out.push({
      check, severity: CHECKS[check].severity, country: job?.country ?? runs[0]?.country ?? '',
      job_id: job?.id ?? null, wg_run_ids: runs.map((r) => r.wg_id).sort(), fingerprint: `${check}:${key}`, detail,
    });

  for (const job of input.jobs) {
    const m = byJob.get(job.id);
    const runs = m?.runs ?? [];
    const matchedBy = m ? [...m.by].join(', ') : undefined;
    const done = job.status === 'completed';
    const ended = (job.end_date ?? job.start_date ?? '9999') <= input.today;

    if (!runs.length) {
      if (done && ended) add('no_runs', job, [], job.id, { summary: 'The job is completed but WIREGUARD has no runs for it' });
      continue;
    }

    const w = jobWindow(job);
    const outside = w ? runs.filter((r) => r.job_date < w.from || r.job_date > w.to) : [];
    if (outside.length) {
      add('date_mismatch', job, outside, job.id, {
        summary: `${outside.length} run${outside.length > 1 ? 's' : ''} dated outside ${job.start_date} – ${job.end_date ?? job.start_date}`,
        matchedBy, fields: [diff('dates', `${job.start_date} – ${job.end_date ?? job.start_date}`, distinct(outside.map((r) => r.job_date)).join(', '), false)],
      });
    }

    if (job.unit_number) {
      const other = runs.filter((r) => r.drum_no && input.drumUnit[r.drum_no] && input.drumUnit[r.drum_no] !== job.unit_number);
      if (other.length) {
        add('unit_drum_mismatch', job, other, job.id, {
          summary: `Drum ${distinct(other.map((r) => r.drum_no)).join(', ')} is on ${distinct(other.map((r) => input.drumUnit[r.drum_no!])).join(', ')}, not ${job.unit_number}`,
          matchedBy, fields: [diff('unit', job.unit_number, distinct(other.map((r) => input.drumUnit[r.drum_no!])).join(', '), false)],
        });
      }
    }

    if (job.wire_serial_number) {
      const other = runs.filter((r) => r.wire_serial_number && norm(r.wire_serial_number) !== norm(job.wire_serial_number));
      if (other.length) {
        add('wire_mismatch', job, other, job.id, {
          summary: `Runs used wire ${distinct(other.map((r) => r.wire_serial_number)).join(', ')}, the job planned ${job.wire_serial_number}`,
          matchedBy, fields: [diff('wire', job.wire_serial_number, distinct(other.map((r) => r.wire_serial_number)).join(', '), false)],
        });
      }
    }

    const loc: FieldDiff[] = [];
    const cmp = (field: string, ours: string | null, theirs: (string | null)[]) => {
      const t = distinct(theirs);
      if (ours && t.length && t.some((x) => norm(x) !== norm(ours))) loc.push(diff(field, ours, t.join(', '), false));
    };
    cmp('well', job.well, runs.map((r) => r.well));
    cmp('field', job.field, runs.map((r) => r.field_name));
    cmp('rig', job.rig, runs.map((r) => r.rig));
    if (loc.length) add('location_mismatch', job, runs, job.id, { summary: `${loc.map((l) => l.field).join(', ')} differ`, matchedBy, fields: loc });

    if (job.services.length) {
      const extra = distinct(runs.map((r) => r.job_name)).filter((n) => !job.services.some((s) => norm(s) === norm(n)));
      if (extra.length) {
        add('service_mismatch', job, runs.filter((r) => extra.includes(r.job_name ?? '')), job.id, {
          summary: `Runs logged as ${extra.join(', ')}, which the job does not list`, matchedBy,
          fields: [diff('services', job.services.join(', '), distinct(runs.map((r) => r.job_name)).join(', '), false)],
        });
      }
    }

    const vals: FieldDiff[] = [];
    const maxDepth = Math.max(...runs.map((r) => r.max_depth_ft ?? 0));
    if (job.max_depth_ft != null && runs.some((r) => r.max_depth_ft != null)) {
      const tol = Math.max(TOLERANCE.depthFt, job.max_depth_ft * TOLERANCE.depthPct);
      if (Math.abs(job.max_depth_ft - maxDepth) > tol) vals.push(diff('max depth (ft)', job.max_depth_ft, maxDepth, false));
    }
    const jar = sum(runs.map((r) => r.jarring_minutes));
    if (job.jarring_minutes != null && Math.abs(job.jarring_minutes - jar) > TOLERANCE.jarringMin) vals.push(diff('jarring (min)', job.jarring_minutes, jar, false));
    const cut = sum(runs.map((r) => r.wire_cut_ft));
    if (job.wire_cut_ft != null && Math.abs(job.wire_cut_ft - cut) > TOLERANCE.wireCutFt) vals.push(diff('wire cut (ft)', job.wire_cut_ft, cut, false));
    if (vals.length) add('value_mismatch', job, runs, job.id, { summary: `${vals.map((v) => v.field).join(', ')} differ beyond tolerance`, matchedBy, fields: vals });

    if (done) {
      const pending = runs.filter((r) => (r.approval_status ?? '').toLowerCase() !== 'approved');
      if (pending.length) {
        add('runs_pending_approval', job, pending, job.id, {
          summary: `${pending.length} run${pending.length > 1 ? 's' : ''} still awaiting approval in WIREGUARD`, matchedBy,
        });
      }
    }
  }

  // Unlinked runs, one finding per likely job: same real DRSS, else same unit, day and well.
  const groups = new Map<string, { runs: ReconRun[]; candidates: Set<string> }>();
  for (const u of unmatched) {
    const r = u.run;
    const unit = r.drum_no ? input.drumUnit[r.drum_no] ?? r.drum_no : 'no drum';
    const key = realKey(r.drss_number) ? `drss:${realKey(r.drss_number)}` : `${norm(unit)}:${r.job_date}:${norm(r.well)}`;
    const g = groups.get(key) ?? { runs: [], candidates: new Set<string>() };
    g.runs.push(r);
    u.candidates.forEach((c) => g.candidates.add(c));
    groups.set(key, g);
  }
  for (const [key, g] of groups) {
    const r = g.runs[0];
    const unit = r.drum_no ? input.drumUnit[r.drum_no] ?? null : null;
    add('unlinked_runs', null, g.runs, key, {
      summary: `${g.runs.length} run${g.runs.length > 1 ? 's' : ''} on ${unit ?? r.drum_no ?? 'an unknown drum'}, ${r.job_date}, well ${r.well ?? '—'}${g.candidates.size ? ' (possible job found)' : ''}`,
      candidates: [...g.candidates],
      unit,
    });
  }
  return out;
}
