import { Hono } from 'hono';
import { DEFAULT_TEMPLATE, approvalLevel, cleanAnswers, jraReasons, progress, riskScore, type Answer, type Template } from '../shared/jra';
import type { AppBindings, AuthedUser, Env } from './env';
import { getJob } from './jobs';

// JRA (S28) for one job: answer, score live, send to an SDM, approve or reject. Approved answers are locked.

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'jra', id, summary.slice(0, 1000));

/** The country's active template; the default is stored on first use so later revisions don't change old JRAs. */
async function template(env: Env, country: string): Promise<{ id: string; t: Template }> {
  const row = await env.DB.prepare('SELECT id, code, revision, questions, approval_levels FROM jra_templates WHERE country = ? AND active = 1 ORDER BY revision DESC LIMIT 1')
    .bind(country).first<{ id: string; code: string; revision: string; questions: string; approval_levels: string }>();
  if (row) {
    const q = JSON.parse(row.questions) as { sections: Template['sections']; questions: Template['questions'] };
    return { id: row.id, t: { code: row.code, revision: row.revision, sections: q.sections, questions: q.questions, approval_levels: JSON.parse(row.approval_levels) } };
  }
  const id = crypto.randomUUID();
  const t = DEFAULT_TEMPLATE;
  await env.DB.prepare('INSERT OR IGNORE INTO jra_templates (id, country, code, revision, questions, approval_levels) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, country, t.code, t.revision, JSON.stringify({ sections: t.sections, questions: t.questions }), JSON.stringify(t.approval_levels)).run();
  return template(env, country);
}

async function templateById(env: Env, id: string): Promise<Template> {
  const row = await env.DB.prepare('SELECT code, revision, questions, approval_levels FROM jra_templates WHERE id = ?').bind(id).first<{ code: string; revision: string; questions: string; approval_levels: string }>();
  const q = JSON.parse(row!.questions) as { sections: Template['sections']; questions: Template['questions'] };
  return { code: row!.code, revision: row!.revision, sections: q.sections, questions: q.questions, approval_levels: JSON.parse(row!.approval_levels) };
}

export async function explosiveService(env: Env, jobId: string) {
  return !!(await env.DB.prepare('SELECT 1 FROM job_services s JOIN service_profiles p ON p.job_type_name = s.job_type_name WHERE s.job_id = ? AND p.is_explosive = 1 LIMIT 1').bind(jobId).first());
}

type JraRow = { id: string; job_id: string; template_id: string; status: string; answers: string; risk_score: number; approval_level: string | null; sent_to: string | null; sent_at: string | null; decided_by: string | null; decided_at: string | null; updated_at: string };

export const jra = new Hono<AppBindings>();

jra.get('/:jobId', async (c) => {
  const user = c.get('user');
  const job = await getJob(c.env, user, c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const row = await c.env.DB.prepare('SELECT * FROM jras WHERE job_id = ?').bind(job.id).first<JraRow>();
  const t = row ? { id: row.template_id, t: await templateById(c.env, row.template_id) } : await template(c.env, job.country);
  const reasons = jraReasons(job, await explosiveService(c.env, job.id));
  const sdm = job.sdm_username ? await c.env.DB.prepare('SELECT username, full_name FROM user_roles WHERE username = ?').bind(job.sdm_username).first() : null;
  return c.json({ job: { id: job.id, ticket_no: job.ticket_no, well: job.well, sdm }, template: t.t, jra: row ? { ...row, answers: JSON.parse(row.answers) } : null, reasons });
});

jra.put('/:jobId', async (c) => {
  const user = c.get('user');
  const job = await getJob(c.env, user, c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const row = await c.env.DB.prepare('SELECT * FROM jras WHERE job_id = ?').bind(job.id).first<JraRow>();
  if (row && row.status !== 'draft') return c.json({ error: row.status === 'approved' ? 'The JRA is approved and locked' : 'The JRA is waiting for approval. Ask the approver to reject it to make changes.' }, 409);
  const t = row ? { id: row.template_id, t: await templateById(c.env, row.template_id) } : await template(c.env, job.country);
  const { answers } = await c.req.json<{ answers?: unknown }>().catch(() => ({} as { answers?: unknown }));
  const a = cleanAnswers(t.t, answers);
  if ('error' in a) return c.json({ error: a.error }, 400);
  const score = riskScore(t.t, a);
  const level = approvalLevel(t.t, score);
  const at = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO jras (id, job_id, template_id, answers, risk_score, approval_level, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (job_id) DO UPDATE SET answers = ?4, risk_score = ?5, approval_level = ?6, updated_at = ?7`,
  ).bind(row?.id ?? crypto.randomUUID(), job.id, t.id, JSON.stringify(a), score, level, at).run();
  return c.json({ ok: true, risk_score: score, approval_level: level, progress: progress(t.t, a) });
});

jra.post('/:jobId/send', async (c) => {
  const user = c.get('user');
  const job = await getJob(c.env, user, c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const row = await c.env.DB.prepare('SELECT * FROM jras WHERE job_id = ?').bind(job.id).first<JraRow>();
  if (!row) return c.json({ error: 'Answer the JRA first' }, 400);
  if (row.status !== 'draft') return c.json({ error: 'Already sent' }, 409);
  const t = await templateById(c.env, row.template_id);
  const p = progress(t, JSON.parse(row.answers) as Record<string, Answer>);
  if (p.missing.length) return c.json({ error: `Answer every required question first (${p.missing.join(', ')})` }, 400);
  const { to } = await c.req.json<{ to?: string }>().catch(() => ({} as { to?: string }));
  const approver = String(to ?? job.sdm_username ?? '');
  const ok = await c.env.DB.prepare(`SELECT 1 FROM user_roles WHERE username = ? AND active = 1 AND role IN ('sdm','deputy_sdm','operations_manager','admin')`).bind(approver).first();
  if (!ok) return c.json({ error: 'Pick an SDM or manager to approve it' }, 400);
  const at = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE jras SET status = 'sent', sent_to = ?, sent_at = ?, updated_at = ? WHERE id = ?`).bind(approver, at, at, row.id),
    audit(c.env, user, 'send', row.id, `JRA for ticket ${job.ticket_no ?? '—'} (score ${row.risk_score}, ${row.approval_level}) sent to ${approver}`),
  ]);
  return c.json({ ok: true });
});

/** The named approver, or an admin or operations manager, decides. Rejecting returns it to draft. */
jra.post('/:jobId/decide', async (c) => {
  const user = c.get('user');
  const job = await getJob(c.env, user, c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const row = await c.env.DB.prepare('SELECT * FROM jras WHERE job_id = ?').bind(job.id).first<JraRow>();
  if (!row || row.status !== 'sent') return c.json({ error: 'There is no JRA waiting for approval' }, 409);
  const may = row.sent_to?.toLowerCase() === user.username.toLowerCase() || user.role === 'admin' || user.role === 'operations_manager';
  if (!may) return c.json({ error: `Only ${row.sent_to} (or an admin or operations manager) can decide` }, 403);
  const { decision, note } = await c.req.json<{ decision?: string; note?: string }>().catch(() => ({} as { decision?: string; note?: string }));
  if (decision !== 'approved' && decision !== 'rejected') return c.json({ error: 'Approve or reject' }, 400);
  const at = new Date().toISOString();
  await c.env.DB.batch([
    decision === 'approved'
      ? c.env.DB.prepare(`UPDATE jras SET status = 'approved', decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?`).bind(user.username, at, at, row.id)
      : c.env.DB.prepare(`UPDATE jras SET status = 'draft', decided_by = ?, decided_at = ?, sent_to = NULL, sent_at = NULL, updated_at = ? WHERE id = ?`).bind(user.username, at, at, row.id),
    audit(c.env, user, decision === 'approved' ? 'approve' : 'reject', row.id, `JRA for ticket ${job.ticket_no ?? '—'} ${decision}${note ? `: ${String(note).slice(0, 300)}` : ''}`),
  ]);
  return c.json({ ok: true });
});
