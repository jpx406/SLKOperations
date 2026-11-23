import { Hono } from 'hono';
import { coerceForm, hasSig, rowsAsEvents, type JobForLog } from '../shared/jobLogForm';
import { canEditStage } from '../shared/stages';
import type { Job } from '../shared/types';
import type { AppBindings, AuthedUser, Env } from './env';
import { getJob } from './jobs';

// The Job log · Sequence of Events (6z.51): one form per job, every save a new version. A save names the version it
// started from; when someone saved meanwhile, the answer is "conflict" with their copy, and the page merges and
// saves again. Both signatures in place set the job's "Job log signed" to Yes; the log stays editable.

export const jobLogs = new Hono<AppBindings>();

interface LogRowDb { id: string; job_id: string; current_version: number; form: string; created_by: string | null; saved_by: string | null; saved_at: string; sent_by: string | null; sent_at: string | null; sent_version: number | null; email_to: string | null; email_cc: string | null }

const now = () => new Date().toISOString();
const mayEdit = (u: AuthedUser) => !!u.menus.jobs?.edit && canEditStage(u.menus, 'execution');

/** What the job gives the log's header, and the crew offered for the sign-off. */
async function jobFacts(env: Env, job: Job): Promise<JobForLog> {
  const crew = await env.DB.prepare(`SELECT e.full_name FROM job_crew c JOIN employees e ON e.id = c.employee_id WHERE c.job_id = ? AND c.end_date IS NULL AND c.crew_role IN ('supervisor', 'operator') ORDER BY c.crew_role DESC, c.slot`)
    .bind(job.id).all<{ full_name: string }>();
  return {
    ticket: job.ticket_no, well: job.well, customer: job.location, jobType: (job.services ?? []).join(', '), rig: job.rig, startDate: job.start_date,
    engineers: crew.results.map((r) => r.full_name),
  };
}

const load = (env: Env, jobId: string) => env.DB.prepare('SELECT * FROM job_logs WHERE job_id = ?').bind(jobId).first<LogRowDb>();

/** The form, the job's header and crew, and the rights. */
jobLogs.get('/:jobId', async (c) => {
  const user = c.get('user');
  const job = await getJob(c.env, user, c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const [row, facts, crewNames] = await Promise.all([
    load(c.env, job.id), jobFacts(c.env, job),
    c.env.DB.prepare(`SELECT DISTINCT e.full_name FROM job_crew c JOIN employees e ON e.id = c.employee_id WHERE c.job_id = ? ORDER BY e.full_name`).bind(job.id).all<{ full_name: string }>(),
  ]);
  return c.json({
    job: facts, crew: crewNames.results.map((r) => r.full_name), canEdit: mayEdit(user),
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
  // only one save can move the version on from `base`
  const upd = await c.env.DB.prepare('UPDATE job_logs SET current_version = ?, form = ?, saved_by = ?, saved_at = ? WHERE id = ? AND current_version = ?')
    .bind(next, text, user.fullName, at, row.id, base).run();
  if (!upd.meta.changes) {
    const cur = (await load(c.env, job.id))!;
    return c.json({ conflict: true, version: cur.current_version, serverForm: coerceForm(JSON.parse(cur.form)), savedBy: cur.saved_by });
  }
  const signed = hasSig(form.engSig) && hasSig(form.fmSig);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO job_log_versions (id, log_id, version, form, change_summary, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), row.id, next, text, summary, user.fullName),
    ...(signed ? [c.env.DB.prepare(`UPDATE jobs SET job_log_signed = 'yes', updated_at = ? WHERE id = ? AND coalesce(job_log_signed, '') <> 'yes'`).bind(at, job.id)] : []),
  ]);
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
  await c.env.DB.prepare('UPDATE job_logs SET sent_by = ?, sent_at = ?, sent_version = ?, email_to = ?, email_cc = ? WHERE job_id = ?')
    .bind(user.fullName, now(), Math.round(Number(b.version) || 0), clip(b.to), clip(b.cc), job.id).run();
  return c.json({ ok: true });
});

/** The log's rows as events, for the pages that read the sequence of events (Execution, the job report). */
export async function logEvents(env: Env, jobId: string) {
  const row = await load(env, jobId);
  if (!row) return null;
  return rowsAsEvents(coerceForm(JSON.parse(row.form))).map((e) => ({ ...e, client_id: e.id, created_by: row.saved_by, created_at: row.saved_at }));
}
