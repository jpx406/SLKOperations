import { Hono } from 'hono';
import { bhaFromStrings, coerceForm, hasSig, rowsAsEvents, type JobForLog } from '../shared/jobLogForm';
import { canEditStage } from '../shared/stages';
import type { Job } from '../shared/types';
import type { AppBindings, AuthedUser, Env } from './env';
import { getJob } from './jobs';
import { logOptionsFor } from './logOptions';

// The Job log · Sequence of Events (6z.51): one form per job, every save a new version. A save names the version it
// started from; when someone saved meanwhile, the answer is "conflict" with their copy, and the page merges and
// saves again. Both signatures in place set the job's "Job log signed" to Yes; the log stays editable.

export const jobLogs = new Hono<AppBindings>();

interface LogRowDb { id: string; job_id: string; current_version: number; form: string; created_by: string | null; saved_by: string | null; saved_at: string; sent_by: string | null; sent_at: string | null; sent_version: number | null; email_to: string | null; email_cc: string | null }

const now = () => new Date().toISOString();
const mayEdit = (u: AuthedUser) => !!u.menus.jobs?.edit && canEditStage(u.menus, 'execution');

/** What the job gives the log's header (6z.52: the Slickline Service Report's fields), the crew and each run's BHA. */
async function jobFacts(env: Env, job: Job): Promise<JobForLog> {
  const [crew, wire, strings] = await Promise.all([
    env.DB.prepare(`SELECT e.full_name, e.eid, c.crew_role FROM job_crew c JOIN employees e ON e.id = c.employee_id WHERE c.job_id = ? AND c.end_date IS NULL AND c.crew_role IN ('slickline_supervisor', 'slickline_operator', 'assistant_operator') ORDER BY CASE c.crew_role WHEN 'slickline_supervisor' THEN 0 WHEN 'slickline_operator' THEN 1 ELSE 2 END, c.slot`)
      .bind(job.id).all<{ full_name: string; eid: string | null; crew_role: string }>(),
    job.wire_serial_number ? env.DB.prepare('SELECT wire_grade, wire_size, remaining_length_ft FROM wg_wires WHERE wire_serial_number = ?').bind(job.wire_serial_number)
      .first<{ wire_grade: string | null; wire_size: string | null; remaining_length_ft: number | null }>() : Promise.resolve(null),
    env.DB.prepare(`SELECT run_no, items FROM job_diagrams WHERE job_id = ? AND kind = 'toolstring' ORDER BY run_no`).bind(job.id).all<{ run_no: number; items: string }>(),
  ]);
  const who = (r: { full_name: string; eid: string | null }) => [r.full_name, r.eid].filter(Boolean).join(' - ');
  const sup = crew.results.filter((r) => r.crew_role === 'slickline_supervisor'), ops = crew.results.filter((r) => r.crew_role !== 'slickline_supervisor');
  const names = (items: string) => { try { const rows = JSON.parse(items) as { name?: string }[]; return rows.map((r) => String(r.name ?? '').trim()).filter(Boolean); } catch { return []; } };
  const n = (v: number | null | undefined) => (v == null ? null : String(v));
  const bha = bhaFromStrings(strings.results.map((r) => ({ run: r.run_no, names: names(r.items) })));
  if (!bha.length && job.toolstring?.length) bha.push({ run: '1', text: job.toolstring.map((p) => p.component).join(' + ') });
  return {
    ticket: job.ticket_no, well: job.well, customer: job.location, jobType: (job.services ?? []).join(', '), rig: job.rig, startDate: job.start_date,
    engineers: crew.results.map((r) => r.full_name),
    field: job.field, wellType: job.well_type, whConnection: job.wellhead_connection, unit: job.unit_number, siwhp: n(job.siwhp_psi),
    tubingSize: /tubing/i.test(job.target_casing_type ?? '') ? job.target_casing_od : null,
    supervisor: sup.map(who).join(' / ') || null, operator1: ops[0] ? who(ops[0]) : null, operator2: ops.slice(1).map(who).join(' / ') || null,
    wireType: wire?.wire_grade ?? null, wireSize: wire?.wire_size ? `${wire.wire_size}"` : null, wireInitial: n(wire?.remaining_length_ft), wireCut: n(job.wire_cut_ft), wireMaxPull: n(job.max_pull_lb),
    bha,
  };
}

const load = (env: Env, jobId: string) => env.DB.prepare('SELECT * FROM job_logs WHERE job_id = ?').bind(jobId).first<LogRowDb>();

/** The form, the job's header and crew, and the rights. */
jobLogs.get('/:jobId', async (c) => {
  const user = c.get('user');
  const job = await getJob(c.env, user, c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const [row, facts, crewNames, options] = await Promise.all([
    load(c.env, job.id), jobFacts(c.env, job),
    c.env.DB.prepare(`SELECT DISTINCT e.full_name FROM job_crew c JOIN employees e ON e.id = c.employee_id WHERE c.job_id = ? ORDER BY e.full_name`).bind(job.id).all<{ full_name: string }>(),
    logOptionsFor(c.env, job.country),
  ]);
  return c.json({
    job: facts, crew: crewNames.results.map((r) => r.full_name), canEdit: mayEdit(user), options,
    log: row ? { id: row.id, version: row.current_version, form: coerceForm(JSON.parse(row.form), facts), createdBy: row.created_by, savedBy: row.saved_by, savedAt: row.saved_at, sentBy: row.sent_by, sentAt: row.sent_at, sentVersion: row.sent_version } : null,
  });
});

/** Saves a new version, or answers "conflict" with the copy someone saved since `base`. */
jobLogs.put('/:jobId', async (c) => {
  const user = c.get('user');
  if (!mayEdit(user)) return c.json({ error: 'Your role does not edit Execution' }, 403);
  const job = await getJob(c.env, user, c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const b = (await c.req.json().catch(() => null)) as { form?: unknown; base?: unknown; summary?: unknown } | null;
  if (!b?.form) return c.json({ error: 'Send the form' }, 400);
  const form = coerceForm(b.form);
  const text = JSON.stringify(form);
  if (text.length > 900_000) return c.json({ error: 'The job log is too large: remove some drawn signatures or rows' }, 413);
  const base = Math.max(0, Math.round(Number(b.base) || 0));
  const summary = typeof b.summary === 'string' && b.summary.trim() ? b.summary.trim().slice(0, 300) : base === 0 ? 'Initial version' : 'No content change';
  const at = now(), next = base + 1;
  let row = await load(c.env, job.id);
  if (!row && base === 0) {
    // a first save: whoever gets the row in first wins, the other is told there is a version to merge
    await c.env.DB.prepare('INSERT INTO job_logs (id, job_id, current_version, form, created_by, saved_by, saved_at) VALUES (?, ?, 0, ?, ?, ?, ?) ON CONFLICT (job_id) DO NOTHING')
      .bind(crypto.randomUUID(), job.id, text, user.fullName, user.fullName, at).run();
    row = await load(c.env, job.id);
  }
  if (!row) return c.json({ error: 'The job log could not be started' }, 500);
  // only one save can move the version on from `base`; the version row is written in the same transaction, and only
  // when the move happened, so the history never has a gap
  const signed = hasSig(form.engSig) && hasSig(form.fmSig);
  const [upd] = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE job_logs SET current_version = ?, form = ?, saved_by = ?, saved_at = ? WHERE id = ? AND current_version = ?')
      .bind(next, text, user.fullName, at, row.id, base),
    c.env.DB.prepare('INSERT INTO job_log_versions (id, log_id, version, form, change_summary, created_by) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1')
      .bind(crypto.randomUUID(), row.id, next, text, summary, user.fullName),
  ]);
  if (!upd.meta.changes) {
    const cur = (await load(c.env, job.id))!;
    return c.json({ conflict: true, version: cur.current_version, serverForm: coerceForm(JSON.parse(cur.form)), savedBy: cur.saved_by });
  }
  if (signed) await c.env.DB.prepare(`UPDATE jobs SET job_log_signed = 'yes', updated_at = ? WHERE id = ? AND coalesce(job_log_signed, '') <> 'yes'`).bind(at, job.id).run();
  return c.json({ conflict: false, version: next, savedBy: user.fullName, savedAt: at, logId: row.id, createdBy: row.created_by, jobLogSigned: signed });
});

/** Every version, newest first, with what changed. */
jobLogs.get('/:jobId/versions', async (c) => {
  const job = await getJob(c.env, c.get('user'), c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const { results } = await c.env.DB.prepare(`SELECT v.version, v.change_summary, v.created_by, v.created_at, v.form FROM job_log_versions v JOIN job_logs l ON l.id = v.log_id
    WHERE l.job_id = ? ORDER BY v.version DESC LIMIT 200`).bind(job.id).all<{ version: number; change_summary: string; created_by: string; created_at: string; form: string }>();
  return c.json(results.map((v) => ({ ...v, form: coerceForm(JSON.parse(v.form)) })));
});

/** Records that a version was e-mailed (the card shows EMAILED). */
jobLogs.post('/:jobId/sent', async (c) => {
  const user = c.get('user');
  const job = await getJob(c.env, user, c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const b = (await c.req.json().catch(() => ({}))) as { version?: unknown; to?: unknown; cc?: unknown };
  const clip = (v: unknown) => (typeof v === 'string' ? v.slice(0, 500) : null);
  const version = Math.round(Number(b.version) || 0);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE job_logs SET sent_by = ?, sent_at = ?, sent_version = ?, email_to = ?, email_cc = ? WHERE job_id = ?')
      .bind(user.fullName, now(), version, clip(b.to), clip(b.cc), job.id),
    c.env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), user.username, 'send', 'job', job.id, `Job log version ${version} e-mailed${clip(b.to) ? ` to ${clip(b.to)}` : ''}`.slice(0, 1000)),
  ]);
  return c.json({ ok: true });
});

/** The log's rows as events, for the pages that read the sequence of events (Execution, the job report). */
export async function logEvents(env: Env, jobId: string) {
  const row = await load(env, jobId);
  if (!row) return null;
  return rowsAsEvents(coerceForm(JSON.parse(row.form))).map((e) => ({ ...e, client_id: e.id, created_by: row.saved_by, created_at: row.saved_at }));
}
