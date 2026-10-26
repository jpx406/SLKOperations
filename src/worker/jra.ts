import { Hono } from 'hono';
import { DEFAULT_TEMPLATE, approvalLevel, cleanAnswers, flags, jraReasons, progress, riskScore, type Answer, type Template } from '../shared/jra';
import { parseJraForm } from '../shared/jraForm';
import { jraPdf } from '../shared/jraPdf';
import { ROLE_LABEL } from '../shared/roles';
import { canonical } from '../shared/signature';
import { readXlsx } from '../shared/xlsxRead';
import type { AppBindings, AuthedUser, Env } from './env';
import { getJob } from './jobs';
import { storeAttachment } from './attachments';
import { signStatement } from './signatures';

// JRA (S28) for one job: answer, score live, send to an SDM, approve or reject. Approved answers are locked.

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'jra', id, summary.slice(0, 1000));

/** The country's active template; the default is stored on first use so later revisions don't change old JRAs. */
async function template(env: Env, country: string): Promise<{ id: string; t: Template }> {
  const row = await env.DB.prepare('SELECT id, code, revision, questions, approval_levels FROM jra_templates WHERE country = ? AND active = 1 ORDER BY revision DESC LIMIT 1')
    .bind(country).first<{ id: string; code: string; revision: string; questions: string; approval_levels: string }>();
  if (row) return { id: row.id, t: fromRow(row) };
  const id = crypto.randomUUID();
  const t = DEFAULT_TEMPLATE;
  await env.DB.prepare('INSERT OR IGNORE INTO jra_templates (id, country, code, revision, questions, approval_levels) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, country, t.code, t.revision, JSON.stringify({ sections: t.sections, questions: t.questions }), JSON.stringify(t.approval_levels)).run();
  return template(env, country);
}

type TemplateRow = { code: string; revision: string; questions: string; approval_levels: string };

/** The questions column holds sections and questions, plus the form's title, notes and points per exemption when loaded from Excel. */
function fromRow(row: TemplateRow): Template {
  const q = JSON.parse(row.questions) as Pick<Template, 'sections' | 'questions' | 'title' | 'notes' | 'exemption_points'>;
  return { code: row.code, revision: row.revision, sections: q.sections, questions: q.questions, approval_levels: JSON.parse(row.approval_levels), title: q.title, notes: q.notes, exemption_points: q.exemption_points };
}
const storedQuestions = (t: Template) => JSON.stringify({ sections: t.sections, questions: t.questions, title: t.title, notes: t.notes, exemption_points: t.exemption_points });

async function templateById(env: Env, id: string): Promise<Template> {
  const row = await env.DB.prepare('SELECT code, revision, questions, approval_levels FROM jra_templates WHERE id = ?').bind(id).first<TemplateRow>();
  return fromRow(row!);
}

/**
 * Finds or stores the uploaded form's revision for the country. The same revision with different questions is refused
 * when another JRA already uses it, so an approved JRA never changes underneath. A newer form becomes the one new JRAs use.
 */
async function registerTemplate(env: Env, user: AuthedUser, country: string, t: Template, jobId: string, dry: boolean): Promise<{ id: string; isNew: boolean } | { error: string }> {
  const same = (row: TemplateRow) => canonical(JSON.parse(row.questions)) === canonical(JSON.parse(storedQuestions(t))) && canonical(JSON.parse(row.approval_levels)) === canonical(t.approval_levels);
  const row = await env.DB.prepare('SELECT id, code, revision, questions, approval_levels FROM jra_templates WHERE country = ? AND code = ? AND revision = ?').bind(country, t.code, t.revision).first<TemplateRow & { id: string }>();
  if (row && same(row)) return { id: row.id, isNew: false };
  if (row) {
    const used = await env.DB.prepare('SELECT count(*) AS n FROM jras WHERE template_id = ? AND job_id <> ?').bind(row.id, jobId).first<{ n: number }>();
    if (used?.n) return { error: `This file’s questions differ from ${t.code} Rev ${t.revision} already in SLK Operations, which ${used.n} other JRA${used.n === 1 ? '' : 's'} use. Use the current form, or ask QHSE to raise the revision.` };
    if (!dry) await env.DB.batch([
      env.DB.prepare('UPDATE jra_templates SET questions = ?, approval_levels = ? WHERE id = ?').bind(storedQuestions(t), JSON.stringify(t.approval_levels), row.id),
      audit(env, user, 'update_form', row.id, `${country} JRA form ${t.code} Rev ${t.revision} replaced (no other JRA used it)`),
    ]);
    return { id: row.id, isNew: false };
  }
  const id = crypto.randomUUID();
  if (dry) return { id, isNew: true };
  const active = await env.DB.prepare('SELECT code, revision FROM jra_templates WHERE country = ? AND active = 1').bind(country).first<{ code: string; revision: string }>();
  // the uploaded form takes over unless it is an older revision of the active one
  const takeOver = !active || active.code !== t.code || Number.isNaN(Number(t.revision)) || Number(t.revision) >= Number(active.revision);
  await env.DB.batch([
    ...(takeOver ? [env.DB.prepare('UPDATE jra_templates SET active = 0 WHERE country = ?').bind(country)] : []),
    env.DB.prepare('INSERT INTO jra_templates (id, country, code, revision, questions, approval_levels, active) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, country, t.code, t.revision, storedQuestions(t), JSON.stringify(t.approval_levels), takeOver ? 1 : 0),
    audit(env, user, 'load_form', id, `${country} JRA form ${t.code} Rev ${t.revision} loaded from Excel (${t.questions.length} questions)${takeOver ? ', now used for new JRAs' : ''}`),
  ]);
  return { id, isNew: true };
}


export async function explosiveService(env: Env, jobId: string) {
  return !!(await env.DB.prepare('SELECT 1 FROM job_services s JOIN service_profiles p ON p.job_type_name = s.job_type_name WHERE s.job_id = ? AND p.is_explosive = 1 LIMIT 1').bind(jobId).first());
}

type JraRow = { id: string; job_id: string; template_id: string; status: string; answers: string; risk_score: number; approval_level: string | null; sent_to: string | null; sent_at: string | null; decided_by: string | null; decided_at: string | null; updated_at: string; form_details: string | null };

export const jra = new Hono<AppBindings>();

jra.get('/:jobId', async (c) => {
  const user = c.get('user');
  const job = await getJob(c.env, user, c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const row = await c.env.DB.prepare('SELECT * FROM jras WHERE job_id = ?').bind(job.id).first<JraRow>();
  const t = row ? { id: row.template_id, t: await templateById(c.env, row.template_id) } : await template(c.env, job.country);
  const reasons = jraReasons(job, await explosiveService(c.env, job.id));
  const sdm = job.sdm_username ? await c.env.DB.prepare('SELECT username, full_name FROM user_roles WHERE username = ?').bind(job.sdm_username).first() : null;
  // people by name where SLK Ops knows them; the username otherwise
  const names = new Map<string, string>();
  const who = [row?.decided_by, row?.sent_to].filter((u): u is string => !!u);
  if (who.length) {
    const r = await c.env.DB.prepare(`SELECT username, full_name FROM user_roles WHERE username IN (${who.map(() => '?').join(',')})`).bind(...who).all<{ username: string; full_name: string }>();
    for (const u of r.results) if (u.full_name) names.set(u.username, u.full_name);
  }
  const name = (u: string | null | undefined) => (u ? names.get(u) ?? u : null);
  return c.json({ job: { id: job.id, ticket_no: job.ticket_no, well: job.well, sdm }, template: t.t, jra: row ? { ...row, decided_by_name: name(row.decided_by), sent_to_name: name(row.sent_to), answers: JSON.parse(row.answers), form_details: row.form_details ? JSON.parse(row.form_details) : null } : null, reasons });
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

const MAX_UPLOAD = 5 * 1024 * 1024;

/**
 * A JRA filled in on NESR's Excel form. ?dry=1 reads it and shows what would change; without it the answers replace the
 * draft's (the form's revision is loaded first if it is new). Upload again to update, as long as the JRA is a draft.
 */
jra.post('/:jobId/upload', async (c) => {
  const user = c.get('user');
  const job = await getJob(c.env, user, c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const dry = c.req.query('dry') === '1';
  const row = await c.env.DB.prepare('SELECT * FROM jras WHERE job_id = ?').bind(job.id).first<JraRow>();
  if (row && row.status !== 'draft') return c.json({ error: row.status === 'approved' ? 'The JRA is approved and locked' : 'The JRA is waiting for approval. Ask the approver to reject it to upload a new version.' }, 409);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length) return c.json({ error: 'Choose the filled JRA file (.xlsx)' }, 400);
  if (bytes.length > MAX_UPLOAD) return c.json({ error: 'The file is larger than 5 MB' }, 400);
  let parsed;
  try { parsed = parseJraForm(await readXlsx(bytes)); } catch (e) { return c.json({ error: (e as Error).message || 'Can’t read this file. Save it as .xlsx and try again.' }, 400); }
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const { template: t, answers, remarks, details } = parsed;
  const warnings = [...parsed.warnings];
  if (details.country && details.country.toLowerCase() !== job.country.toLowerCase()) warnings.push(`The form says ${details.country}; this job is in ${job.country}.`);
  const squash = (v: string) => v.replace(/\s/g, '').toLowerCase();
  if (details.job_no && job.ticket_no && !squash(details.job_no).includes(squash(job.ticket_no))) warnings.push(`The form’s job no. is ${details.job_no}; this job’s ticket is ${job.ticket_no}.`);
  const reg = await registerTemplate(c.env, user, job.country, t, job.id, dry);
  if ('error' in reg) return c.json({ error: reg.error }, 409);
  const score = riskScore(t, answers);
  const level = approvalLevel(t, score);
  const before = row ? (JSON.parse(row.answers) as Record<string, Answer>) : {};
  const changed = row?.template_id === reg.id ? t.questions.filter((x) => before[x.id] !== answers[x.id]).map((x) => x.id) : t.questions.map((x) => x.id);
  const summary = {
    form: `${t.code} Rev ${t.revision}`, newForm: reg.isNew, sameForm: row?.template_id === reg.id, questions: t.questions.length, answered: Object.keys(answers).length,
    missing: progress(t, answers).missing, score, level, flags: flags(t, answers), changed, details, warnings,
  };
  if (dry) return c.json({ dry: true, ...summary });
  const at = new Date().toISOString();
  const name = decodeURIComponent(c.req.header('x-file-name') ?? '').slice(0, 200);
  const formDetails = JSON.stringify({ ...details, remarks, file: name || null, uploaded_by: user.username, uploaded_at: at });
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO jras (id, job_id, template_id, answers, risk_score, approval_level, form_details, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (job_id) DO UPDATE SET template_id = ?3, answers = ?4, risk_score = ?5, approval_level = ?6, form_details = ?7, updated_at = ?8`,
    ).bind(row?.id ?? crypto.randomUUID(), job.id, reg.id, JSON.stringify(answers), score, level, formDetails, at),
    audit(c.env, user, 'upload', row?.id ?? job.id, `JRA for ticket ${job.ticket_no ?? '—'} uploaded from ${name || 'Excel'} (${t.code} Rev ${t.revision}, ${Object.keys(answers).length}/${t.questions.length} answered, score ${score}, ${level})`),
  ]);
  // keep the original file with the job's attachments; the JRA itself is already saved if storage isn't set up
  const kept = await storeAttachment(c.env, user, { country: job.country, entity: 'job', entityId: job.id, category: 'jra_form', name: name || 'JRA.xlsx', bytes });
  return c.json({ ok: true, ...summary, file_kept: !('error' in kept) });
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
  // approving signs: who, when, role and a fingerprint of the answers (shared/signature.ts)
  const signature = decision === 'approved' ? [await signStatement(c.env, user, 'jra', job.id)] : [];
  await c.env.DB.batch([
    ...signature,
    decision === 'approved'
      ? c.env.DB.prepare(`UPDATE jras SET status = 'approved', decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?`).bind(user.username, at, at, row.id)
      : c.env.DB.prepare(`UPDATE jras SET status = 'draft', decided_by = ?, decided_at = ?, sent_to = NULL, sent_at = NULL, updated_at = ? WHERE id = ?`).bind(user.username, at, at, row.id),
    audit(c.env, user, decision === 'approved' ? 'approve' : 'reject', row.id, `JRA for ticket ${job.ticket_no ?? '—'} ${decision}${note ? `: ${String(note).slice(0, 300)}` : ''}`),
  ]);
  if (decision !== 'approved') return c.json({ ok: true });
  // the approved JRA goes into the job's attachments as a PDF; the approval stands even if storage isn't set up
  const pdf = await fileApprovedPdf(c.env, user, job.id);
  return c.json({ ok: true, pdf: 'error' in pdf ? null : pdf.name, pdf_error: 'error' in pdf ? pdf.error : undefined });
});

/** Builds the approved JRA's PDF from what is stored (answers, form, approval, signature) and files it with the job. */
async function fileApprovedPdf(env: Env, user: AuthedUser, jobId: string) {
  const job = await env.DB.prepare('SELECT id, country, ticket_no, well, rig, unit_number, start_date FROM jobs WHERE id = ?').bind(jobId)
    .first<{ id: string; country: string; ticket_no: string | null; well: string | null; rig: string | null; unit_number: string | null; start_date: string | null }>();
  const row = await env.DB.prepare('SELECT * FROM jras WHERE job_id = ?').bind(jobId).first<JraRow>();
  if (!job || !row || row.status !== 'approved') return { error: 'The JRA isn’t approved' };
  const t = await templateById(env, row.template_id);
  const approver = await env.DB.prepare('SELECT full_name, role FROM user_roles WHERE username = ?').bind(row.decided_by ?? '').first<{ full_name: string; role: keyof typeof ROLE_LABEL }>();
  const sig = await env.DB.prepare(`SELECT fingerprint, seal FROM signatures WHERE entity_type = 'jra' AND entity_id = ? AND revoked_at IS NULL ORDER BY signed_at DESC LIMIT 1`).bind(jobId).first<{ fingerprint: string; seal: string | null }>();
  const bytes = jraPdf({
    template: t, answers: JSON.parse(row.answers) as Record<string, Answer>, job, details: row.form_details ? JSON.parse(row.form_details) : null,
    approval: { by: approver?.full_name ?? row.decided_by ?? '', role: approver ? ROLE_LABEL[approver.role] ?? approver.role : '', at: row.decided_at ?? new Date().toISOString(), sent_at: row.sent_at },
    signature: sig ? { fingerprint: sig.fingerprint, sealed: !!sig.seal } : null,
  });
  const name = `JRA ${job.ticket_no ?? job.id.slice(0, 8)} ${t.code} Rev ${t.revision} approved.pdf`.replace(/[\\/:*?"<>|]/g, '-');
  return storeAttachment(env, user, { country: job.country, entity: 'job', entityId: job.id, category: 'jra_form', name, bytes, note: 'Approved JRA' });
}

/** Files the PDF for a JRA approved before PDFs were kept, or again if it was removed. */
jra.post('/:jobId/pdf', async (c) => {
  const user = c.get('user');
  const job = await getJob(c.env, user, c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const r = await fileApprovedPdf(c.env, user, job.id);
  return 'error' in r ? c.json({ error: r.error }, r.error.includes('set up') ? 503 : 409) : c.json({ ok: true, pdf: r.name });
});
