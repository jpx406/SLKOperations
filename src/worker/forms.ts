import Anthropic from '@anthropic-ai/sdk';
import { Hono, type Context } from 'hono';
import { APPLIES_IF, TEMPLATE_SCHEMA, applies, checklistProgress, cleanTemplate, defaultPackage, docxLines, linesToTemplate, sheetLines, type FormTemplate, type JobFacts } from '../shared/forms';
import { formPdf } from '../shared/formPdf';
import { allowed } from '../shared/approvalRules';
import { jraReasons } from '../shared/jra';
import { ROLE_LABEL } from '../shared/roles';
import type { Job } from '../shared/types';
import { storeAttachment } from './attachments';
import { explosiveService } from './jra';
import { loadRules } from './rules';
import type { Template } from '../shared/jra';
import { parseJraForm } from '../shared/jraForm';
import { canEditStage, hasFailure, type Stage } from '../shared/stages';
import { readXlsx } from '../shared/xlsxRead';
import { costMicroUsd, limitCheck } from '../shared/ai';
import { client, fallbackFor, loadSettings, serviceError, spend } from './ai';
import type { AppBindings, AuthedUser, Env } from './env';
import { getJob } from './jobs';

// Administration → Form templates (owner request 2026-10-28): the JRA and the job checklists, each in a job stage.
// Made by hand, from a Word or Excel file (read here into a first draft), or with the AI assistant, then reviewed
// and saved in the editor. A template some job already uses keeps its questions: changing them saves a new
// revision, and jobs that filled the old one keep it. One JRA is in use per country; checklists can be many.

const MAX_FILE = 5 * 1024 * 1024;

type Row = {
  id: string; country: string; code: string; revision: string; questions: string; approval_levels: string; active: number;
  name: string | null; kind: 'jra' | 'checklist'; package: number; stage: Stage; source_file: string | null; created_by: string | null; updated_by: string | null; updated_at: string | null;
};

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'form_template', id, summary.slice(0, 1000));

export function fromRow(r: Row): FormTemplate {
  const q = JSON.parse(r.questions) as Pick<Template, 'sections' | 'questions' | 'title' | 'notes' | 'exemption_points'>;
  return {
    id: r.id, country: r.country, name: r.name ?? 'Job Risk Assessment', kind: r.package ? 'package' : r.kind, stage: r.stage, active: !!r.active, source_file: r.source_file,
    code: r.code, revision: r.revision, sections: q.sections, questions: q.questions, title: q.title, notes: q.notes, exemption_points: q.exemption_points,
    approval_levels: JSON.parse(r.approval_levels),
  };
}
const contentOf = (t: Pick<FormTemplate, 'sections' | 'questions' | 'title' | 'notes' | 'exemption_points'>) =>
  JSON.stringify({ sections: t.sections, questions: t.questions, title: t.title, notes: t.notes, exemption_points: t.exemption_points });

async function usedBy(env: Env, id: string) {
  const r = await env.DB.prepare('SELECT (SELECT count(*) FROM jras WHERE template_id = ?1) + (SELECT count(*) FROM job_forms WHERE template_id = ?1) AS n').bind(id).first<{ n: number }>();
  return r?.n ?? 0;
}

/** The next free revision: 3 → 4, B → B.1 … */
async function nextRevision(env: Env, country: string, code: string, revision: string) {
  let next = /^\d+$/.test(revision) ? String(Number(revision) + 1) : `${revision}.1`;
  while (await env.DB.prepare('SELECT 1 FROM jra_templates WHERE country = ? AND code = ? AND revision = ?').bind(country, code, next).first()) next = /^\d+$/.test(next) ? String(Number(next) + 1) : `${next}.1`;
  return next;
}

const single = (k: FormTemplate['kind']) => k === 'jra' || k === 'package';
const offSame = (env: Env, country: string, kind: FormTemplate['kind'], except = '') =>
  env.DB.prepare(`UPDATE jra_templates SET active = 0 WHERE country = ? AND ${kind === 'jra' ? `kind = 'jra'` : 'package = 1'} AND id <> ?`).bind(country, except);
/** The kind column keeps jra / checklist; a job package is a checklist with package = 1. */
const insertTemplate = (env: Env, id: string, country: string, t: Omit<FormTemplate, 'id' | 'country' | 'active'>, active: boolean, by: string, at: string) =>
  env.DB.prepare(
    `INSERT INTO jra_templates (id, country, code, revision, questions, approval_levels, active, name, kind, package, stage, source_file, created_by, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, country, t.code, t.revision, contentOf(t), JSON.stringify(t.approval_levels), active ? 1 : 0, t.name, t.kind === 'jra' ? 'jra' : 'checklist', t.kind === 'package' ? 1 : 0, t.stage, t.source_file ?? null, by, by, at);

export const forms = new Hono<AppBindings>();

forms.get('/', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT t.*, (SELECT count(*) FROM jras WHERE template_id = t.id) + (SELECT count(*) FROM job_forms WHERE template_id = t.id) AS used,
            coalesce(u.full_name, t.updated_by, t.created_by) AS changed_by
     FROM jra_templates t LEFT JOIN user_roles u ON u.username = coalesce(t.updated_by, t.created_by)
     WHERE t.country IN (SELECT value FROM json_each(?)) ORDER BY t.active DESC, t.stage, t.kind, t.name, t.revision DESC`,
  ).bind(JSON.stringify(user.countries)).all<Row & { used: number; changed_by: string | null }>();
  return c.json(results.map((r) => ({ ...fromRow(r), used: r.used, changed_by: r.changed_by, updated_at: r.updated_at })));
});

forms.get('/:id', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM jra_templates WHERE id = ? AND country IN (SELECT value FROM json_each(?))').bind(c.req.param('id'), JSON.stringify(c.get('user').countries)).first<Row>();
  if (!r) return c.json({ error: 'No such template' }, 404);
  return c.json({ ...fromRow(r), used: await usedBy(c.env, r.id) });
});

forms.post('/', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const country = typeof b.country === 'string' ? b.country : user.countries[0];
  if (!user.countries.includes(country)) return c.json({ error: 'Pick one of your countries' }, 400);
  const r = cleanTemplate(b);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const t = r.template;
  if (await c.env.DB.prepare('SELECT 1 FROM jra_templates WHERE country = ? AND code = ? AND revision = ?').bind(country, t.code, t.revision).first()) {
    return c.json({ error: `${t.code} Rev ${t.revision} already exists for ${country}. Change the code or the revision.` }, 409);
  }
  const active = b.active !== false;
  const id = crypto.randomUUID();
  const at = new Date().toISOString();
  await c.env.DB.batch([
    // one JRA and one job package in use per country: a new active one takes over
    ...(single(t.kind) && active ? [offSame(c.env, country, t.kind)] : []),
    insertTemplate(c.env, id, country, t, active, user.username, at),
    audit(c.env, user, 'create', id, `${country} ${t.kind === 'jra' ? 'JRA' : t.kind === 'package' ? 'job package' : 'checklist'} “${t.name}” ${t.code} Rev ${t.revision} (${t.questions.length} questions, ${t.stage})${t.source_file ? ` from ${t.source_file}` : ''}`),
  ]);
  return c.json({ ok: true, id }, 201);
});

/**
 * Saves changes. Name, stage and in-use can always change. New questions on a template that jobs already used are
 * saved as the next revision when `new_revision` is set (409 otherwise, so the editor can ask).
 */
forms.put('/:id', async (c) => {
  const user = c.get('user');
  const cur = await c.env.DB.prepare('SELECT * FROM jra_templates WHERE id = ? AND country IN (SELECT value FROM json_each(?))').bind(c.req.param('id'), JSON.stringify(user.countries)).first<Row>();
  if (!cur) return c.json({ error: 'No such template' }, 404);
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const old = fromRow(cur);
  const r = cleanTemplate({ ...old, ...b, kind: old.kind });
  if ('error' in r) return c.json({ error: r.error }, 400);
  const t = r.template;
  const active = typeof b.active === 'boolean' ? b.active : old.active;
  const changed = contentOf(t) !== contentOf(old) || JSON.stringify(t.approval_levels) !== JSON.stringify(old.approval_levels);
  const used = changed ? await usedBy(c.env, cur.id) : 0;
  const at = new Date().toISOString();
  const offOthers = single(t.kind) && active ? [offSame(c.env, cur.country, t.kind, cur.id)] : [];
  if (used) {
    if (b.new_revision !== true) return c.json({ error: `${used} job${used === 1 ? '' : 's'} already filled this template. Save the new questions as the next revision?`, needs_revision: true, used }, 409);
    const revision = await nextRevision(c.env, cur.country, t.code, t.revision);
    const id = crypto.randomUUID();
    await c.env.DB.batch([
      single(t.kind) ? offSame(c.env, cur.country, t.kind) : c.env.DB.prepare('UPDATE jra_templates SET active = 0 WHERE id = ?').bind(cur.id),
      insertTemplate(c.env, id, cur.country, { ...t, revision, source_file: t.source_file ?? cur.source_file }, true, user.username, at),
      audit(c.env, user, 'revise', id, `“${t.name}” ${t.code} Rev ${revision} replaces Rev ${cur.revision} (the old one stays with the ${used} job${used === 1 ? '' : 's'} that used it)`),
    ]);
    return c.json({ ok: true, id, revision });
  }
  if (t.code !== cur.code || t.revision !== cur.revision) {
    if (await c.env.DB.prepare('SELECT 1 FROM jra_templates WHERE country = ? AND code = ? AND revision = ? AND id <> ?').bind(cur.country, t.code, t.revision, cur.id).first()) {
      return c.json({ error: `${t.code} Rev ${t.revision} already exists for ${cur.country}` }, 409);
    }
  }
  await c.env.DB.batch([
    ...offOthers,
    c.env.DB.prepare(
      `UPDATE jra_templates SET code = ?, revision = ?, questions = ?, approval_levels = ?, active = ?, name = ?, stage = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    ).bind(t.code, t.revision, contentOf(t), JSON.stringify(t.approval_levels), active ? 1 : 0, t.name, t.stage, user.username, at, cur.id),
    audit(c.env, user, 'edit', cur.id, `“${t.name}” ${t.code} Rev ${t.revision}: ${[changed && 'questions', t.name !== old.name && 'name', t.stage !== old.stage && `stage → ${t.stage}`, active !== old.active && (active ? 'in use' : 'not in use')].filter(Boolean).join(', ') || 'saved'}`),
  ]);
  return c.json({ ok: true, id: cur.id });
});

forms.delete('/:id', async (c) => {
  const user = c.get('user');
  const cur = await c.env.DB.prepare('SELECT * FROM jra_templates WHERE id = ? AND country IN (SELECT value FROM json_each(?))').bind(c.req.param('id'), JSON.stringify(user.countries)).first<Row>();
  if (!cur) return c.json({ error: 'No such template' }, 404);
  const used = await usedBy(c.env, cur.id);
  if (used) return c.json({ error: `${used} job${used === 1 ? '' : 's'} filled this template, so it stays on record. Switch “In use” off instead to stop new jobs getting it.` }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM jra_templates WHERE id = ?').bind(cur.id),
    audit(c.env, user, 'delete', cur.id, `Deleted ${cur.country} “${cur.name}” ${cur.code} Rev ${cur.revision}`),
  ]);
  return c.json({ ok: true });
});

/** Reads an uploaded Word (.docx) or Excel (.xlsx) file into a first draft and the document's lines (for the AI). */
forms.post('/read', async (c) => {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const name = decodeURIComponent(c.req.header('x-file-name') ?? '').slice(0, 200) || 'form';
  if (!bytes.length) return c.json({ error: 'Choose a Word (.docx) or Excel (.xlsx) file' }, 400);
  if (bytes.length > MAX_FILE) return c.json({ error: 'The file is larger than 5 MB' }, 400);
  try {
    if (/\.docx$/i.test(name)) {
      const lines = await docxLines(bytes);
      return c.json({ draft: linesToTemplate(lines, name), lines: lines.slice(0, 1500), source: 'word' });
    }
    if (/\.xlsx$/i.test(name)) {
      const sheet = await readXlsx(bytes);
      const lines = sheetLines(sheet);
      // NESR's JRA form is read exactly: questions, points per answer, MOC / exemption triggers, approval levels
      const jra = parseJraForm(sheet);
      if (!('error' in jra)) return c.json({ draft: { ...jra.template, name: jra.template.title ?? 'Job Risk Assessment', kind: 'jra', stage: 'preparation', source_file: name }, lines: lines.slice(0, 1500), source: 'jra-form' });
      return c.json({ draft: linesToTemplate(lines, name), lines: lines.slice(0, 1500), source: 'excel' });
    }
  } catch (e) {
    return c.json({ error: (e as Error).message || 'Can’t read this file' }, 400);
  }
  return c.json({ error: 'Use a Word (.docx) or Excel (.xlsx) file. Save older .doc / .xls files in the new format first.' }, 400);
});

const AI_SYSTEM = `You help an admin of SLK Operations (slickline field operations at NESR) build form templates: the Job Risk Assessment (JRA) and job checklists.
A template has a name, a kind (jra or checklist), the job stage where it is filled (design, preparation, execution or closure), lettered sections and Yes / No / N/A questions.
- Keep the document's own wording, order and section headings. Do not invent questions the document does not have, unless the admin asks you to add some.
- Phrase each item so it can be answered Yes / No / N/A. Drop column headers, answer boxes, signature lines and page furniture.
- For a JRA, keep its risk points and approval levels when the document gives them; otherwise use risk points 1 to 5 by severity and the approval levels SDM (0), Operations Manager (20), Country Manager (35).
- A job package (kind package) lists the documents filed after the job, one item per document (e.g. "Field ticket signed by the client"), with applies_if when a document is needed only on some jobs.
- Pick the stage from the form's purpose: planning and approvals before mobilisation are design or preparation, on-site checks during the job are execution, sign-offs after the job are closure.
Return the template with the save_template tool, and say in summary what the admin should check.`;

/** The AI assistant drafts or improves a template from the document's text and the admin's instructions. */
forms.post('/ai', async (c) => {
  const user = c.get('user');
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'The AI assistant isn’t set up yet: the Anthropic API key is missing on the server.' }, 503);
  const s = await loadSettings(c.env);
  const u = await spend(c.env, user.username);
  const blocked = limitCheck(s, u.monthMicro, u.sentToday);
  if (blocked) return c.json({ error: blocked }, 429);
  const b = await c.req.json<{ lines?: unknown; instructions?: unknown; draft?: unknown }>().catch(() => ({} as { lines?: unknown; instructions?: unknown; draft?: unknown }));
  const lines = Array.isArray(b.lines) ? b.lines.filter((l): l is string => typeof l === 'string').slice(0, 1500) : [];
  const instructions = typeof b.instructions === 'string' ? b.instructions.trim().slice(0, 4000) : '';
  if (!lines.length && !instructions && !b.draft) return c.json({ error: 'Upload a file or tell the assistant what the form should cover' }, 400);
  const parts = [
    lines.length && `The uploaded document, one line per paragraph or table row:\n<document>\n${lines.join('\n').slice(0, 120_000)}\n</document>`,
    b.draft && `The template as it stands in the editor:\n<draft>\n${JSON.stringify(b.draft).slice(0, 60_000)}\n</draft>`,
    `The admin's request: ${instructions || 'Build the template from the document.'}`,
  ].filter(Boolean).join('\n\n');
  let micro = 0, inTok = 0, outTok = 0;
  try {
    const res = await client(c.env).beta.messages.create({
      model: s.model, max_tokens: 16000, system: AI_SYSTEM, messages: [{ role: 'user', content: parts }],
      tools: [{ name: 'save_template', description: 'Return the finished form template', input_schema: TEMPLATE_SCHEMA as unknown as Anthropic.Beta.BetaTool.InputSchema }],
      tool_choice: { type: 'tool', name: 'save_template' }, ...fallbackFor(s.model),
    });
    micro = costMicroUsd(res.usage, s.model);
    inTok = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    outTok = res.usage.output_tokens;
    if (res.stop_reason === 'max_tokens') return c.json({ error: 'The form is too long for one go. Split the file, or ask for one section at a time.' }, 422);
    if (res.stop_reason === 'refusal') return c.json({ error: 'The assistant declined this request. Rephrase it and try again.' }, 422);
    const call = res.content.find((x): x is Anthropic.Beta.BetaToolUseBlock => x.type === 'tool_use');
    if (!call) return c.json({ error: 'The assistant did not return a template. Try again.' }, 502);
    const out = call.input as Record<string, unknown>;
    const checked = cleanTemplate(out);
    if ('error' in checked) return c.json({ error: `The assistant’s draft is incomplete (${checked.error}). Try again or adjust it by hand.` }, 422);
    return c.json({ draft: checked.template, summary: typeof out.summary === 'string' ? out.summary : '' });
  } catch (e) {
    const msg = serviceError(e);
    if (!msg) throw e;
    return c.json({ error: msg }, 502);
  } finally {
    await c.env.DB.prepare('INSERT INTO ai_usage (id, username, feature, model, input_tokens, output_tokens, cost_microusd) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), user.username, 'agent', s.model, inTok, outTok, micro).run();
  }
});

// ---- checklists and the job package, filled on a job ---------------------------------------------------------
// A checklist is answered and marked complete by whoever edits its stage, then approved by the SDM (the rule
// forms.approve, or the job's own SDM); the job package works the same way with a file per document instead of
// an answer. Every step keeps who and when, every save goes to the audit trail, the approved form is filed as a
// PDF with the job's attachments, and only an admin reopens a completed or approved one.

export const jobForms = new Hono<AppBindings>();

type FormRow = {
  template_id: string; answers: string; remarks: string; status: 'draft' | 'completed'; completed_by: string | null; completed_at: string | null;
  approved_by: string | null; approved_at: string | null; reopened_by: string | null; reopened_at: string | null; updated_by: string | null; updated_at: string;
};
type PkgFile = { id: string; package_item: string; file_name: string; size_bytes: number; uploaded_by: string; uploaded_at: string; r2_key: string };

const jobAudit = (env: Env, user: AuthedUser, action: string, jobId: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'job', jobId, summary.slice(0, 1000));

const slug = (v: string | null | undefined) => (v ?? '').trim().replace(/[\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

/**
 * Where the job's package lives in R2: job-packages/<YYYY-MM>/<Rig-Well-Date>/, the date being the day the job was
 * completed (its end date; the start date or today while it has none). Files move there if the date changes.
 */
export function packageFolder(job: Pick<Job, 'rig' | 'well' | 'end_date' | 'start_date'>) {
  const date = job.end_date ?? job.start_date ?? new Date().toISOString().slice(0, 10);
  const name = [slug(job.rig) || 'NO-RIG', slug(job.well) || 'NO-WELL', date].join('-');
  return { month: date.slice(0, 7), name, path: `job-packages/${date.slice(0, 7)}/${name}` };
}

/** What the job has, for the package items that apply only to some jobs. */
async function jobFacts(env: Env, job: Job): Promise<JobFacts> {
  const explosive = await explosiveService(env, job.id);
  const jra = await env.DB.prepare('SELECT 1 FROM jras WHERE job_id = ?').bind(job.id).first();
  return {
    service_order: job.service_order === 'yes', failure: hasFailure(job), explosive, third_party: job.third_party_required === 'yes',
    jra: !!jra || jraReasons(job, explosive).length > 0,
  };
}

/** The country's job package template; the one known today is loaded the first time a country needs it. */
export async function packageTemplate(env: Env, country: string): Promise<FormTemplate & { id: string } | null> {
  const row = await env.DB.prepare('SELECT * FROM jra_templates WHERE country = ? AND package = 1 ORDER BY active DESC, updated_at DESC LIMIT 1').bind(country).first<Row>();
  if (row) return row.active ? fromRow(row) as FormTemplate & { id: string } : null;
  const t = defaultPackage();
  const id = crypto.randomUUID();
  await insertTemplate(env, id, country, t, true, 'auto', new Date().toISOString()).run();
  return { ...t, id, country, active: true };
}

/** The template a job's package uses: the one it started with, else the country's current one. */
async function jobPackage(env: Env, job: Job) {
  const used = await env.DB.prepare(`SELECT t.* FROM job_forms f JOIN jra_templates t ON t.id = f.template_id WHERE f.job_id = ? AND t.package = 1`).bind(job.id).first<Row>();
  return used ? fromRow(used) as FormTemplate & { id: string } : packageTemplate(env, job.country);
}

/** Why the job can't be completed yet (Service Order number, job package), or null. Called when the status goes to completed. */
export async function completionBlock(env: Env, job: Job, patch: Record<string, unknown>): Promise<string | null> {
  const next = { ...job, ...patch } as Job;
  if (next.service_order === 'yes' && !String(next.service_order_no ?? '').trim()) return 'Enter the Service Order number on Closure before completing the job';
  const t = await jobPackage(env, next);
  if (!t) return null;
  const f = await env.DB.prepare('SELECT approved_at FROM job_forms WHERE job_id = ? AND template_id = ?').bind(job.id, t.id).first<{ approved_at: string | null }>();
  return f?.approved_at ? null : 'Upload the job package and have the SDM approve it (Closure → Job package) before completing the job';
}

const canApprove = async (env: Env, user: AuthedUser, job: Job) =>
  allowed(await loadRules(env), 'forms.approve', user.role) || (!!job.sdm_username && job.sdm_username.toLowerCase() === user.username.toLowerCase());

/** The checklists for the job's country (in use, plus any the job already filled), the job package, and where the JRA sits. */
jobForms.get('/:jobId', async (c) => {
  const user = c.get('user');
  const job = await getJob(c.env, user, c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const pkg = await jobPackage(c.env, job);
  const [tpl, filled, jra, files] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT * FROM jra_templates WHERE kind = 'checklist' AND package = 0 AND country = ?1 AND (active = 1 OR id IN (SELECT template_id FROM job_forms WHERE job_id = ?2)) ORDER BY stage, name`).bind(job.country, job.id),
    c.env.DB.prepare(
      `SELECT f.*, coalesce(u.full_name, f.completed_by) AS completed_by_name, coalesce(a.full_name, f.approved_by) AS approved_by_name, coalesce(r.full_name, f.reopened_by) AS reopened_by_name
       FROM job_forms f LEFT JOIN user_roles u ON u.username = f.completed_by LEFT JOIN user_roles a ON a.username = f.approved_by LEFT JOIN user_roles r ON r.username = f.reopened_by
       WHERE f.job_id = ?`,
    ).bind(job.id),
    c.env.DB.prepare(`SELECT stage FROM jra_templates WHERE kind = 'jra' AND (id = (SELECT template_id FROM jras WHERE job_id = ?2) OR (country = ?1 AND active = 1)) ORDER BY id = (SELECT template_id FROM jras WHERE job_id = ?2) DESC LIMIT 1`).bind(job.country, job.id),
    c.env.DB.prepare(
      `SELECT a.id, a.package_item, a.file_name, a.size_bytes, coalesce(u.full_name, a.uploaded_by) AS uploaded_by, a.uploaded_at, a.r2_key
       FROM attachments a LEFT JOIN user_roles u ON u.username = a.uploaded_by
       WHERE a.entity_type = 'job' AND a.entity_id = ? AND a.template_id = ? AND a.deleted_at IS NULL ORDER BY a.uploaded_at`,
    ).bind(job.id, pkg?.id ?? ''),
  ]);
  const rows = filled.results as (FormRow & Record<string, string | null>)[];
  // a job that filled an older revision keeps it; the newer one of the same code isn't offered next to it
  const usedCodes = new Set((tpl.results as Row[]).filter((t) => rows.some((f) => f.template_id === t.id)).map((t) => t.code));
  const templates = (tpl.results as Row[]).filter((t) => rows.some((f) => f.template_id === t.id) || !usedCodes.has(t.code)).map(fromRow);
  const facts = await jobFacts(c.env, job);
  return c.json({
    jra_stage: (jra.results[0] as { stage?: Stage } | undefined)?.stage ?? 'preparation',
    templates,
    forms: rows.map((f) => ({ ...f, answers: JSON.parse(f.answers), remarks: JSON.parse(f.remarks) })),
    package: pkg && {
      template: pkg, folder: packageFolder(job), facts, applies_labels: APPLIES_IF,
      files: (files.results as PkgFile[]).map(({ r2_key: _k, ...f }) => f),
    },
    can_approve: await canApprove(c.env, user, job), can_reopen: user.role === 'admin',
  });
});

/** A template of the job's country, the job's form row, and what may happen to it. */
async function formContext(c: Context<AppBindings>) {
  const user = c.get('user');
  const job = await getJob(c.env, user, c.req.param('jobId')!);
  if (!job) return { error: c.json({ error: 'Job not found' }, 404) };
  const row = await c.env.DB.prepare(`SELECT * FROM jra_templates WHERE id = ? AND kind = 'checklist' AND country = ?`).bind(c.req.param('templateId')!, job.country).first<Row>();
  if (!row) return { error: c.json({ error: 'No such form for this job' }, 404) };
  const t = fromRow(row) as FormTemplate & { id: string };
  const cur = await c.env.DB.prepare('SELECT * FROM job_forms WHERE job_id = ? AND template_id = ?').bind(job.id, t.id).first<FormRow>();
  return { user, job, t, cur };
}

const label = (t: FormTemplate) => `${t.kind === 'package' ? 'job package' : 'checklist'} “${t.name}” (${t.code} Rev ${t.revision})`;

/** The required documents of a package still without a file (only the items that apply to this job). */
async function packageMissing(env: Env, job: Job, t: FormTemplate & { id: string }) {
  const facts = await jobFacts(env, job);
  const { results } = await env.DB.prepare(`SELECT DISTINCT package_item FROM attachments WHERE entity_type = 'job' AND entity_id = ? AND template_id = ? AND deleted_at IS NULL`).bind(job.id, t.id).all<{ package_item: string }>();
  const have = new Set(results.map((r) => r.package_item));
  return t.questions.filter((q) => q.required && applies(q, facts) && !have.has(q.id)).map((q) => q.id);
}

/**
 * Saves a checklist's answers and remarks (`action` omitted), or moves the form on: `complete` (every required
 * question answered, or every required document uploaded), `approve` (the SDM, once complete: the PDF is filed),
 * `reopen` (admins only, back to draft). Each step is stamped and audited.
 */
jobForms.put('/:jobId/:templateId', async (c) => {
  const ctx = await formContext(c);
  if ('error' in ctx) return ctx.error;
  const { user, job, t, cur } = ctx;
  const b = await c.req.json<{ answers?: Record<string, unknown>; remarks?: Record<string, unknown>; action?: string }>().catch(() => ({} as { answers?: Record<string, unknown>; remarks?: Record<string, unknown>; action?: string }));
  const at = new Date().toISOString();
  const action = b.action ?? 'save';

  if (action === 'reopen') {
    if (user.role !== 'admin') return c.json({ error: 'Only an admin can reopen a completed form' }, 403);
    if (!cur || cur.status !== 'completed') return c.json({ ok: true });
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE job_forms SET status = 'draft', completed_by = NULL, completed_at = NULL, approved_by = NULL, approved_at = NULL, reopened_by = ?, reopened_at = ?, updated_by = ?, updated_at = ? WHERE job_id = ? AND template_id = ?`)
        .bind(user.username, at, user.username, at, job.id, t.id),
      jobAudit(c.env, user, 'reopen', job.id, `Reopened ${label(t)}${cur.approved_at ? `, approved by ${cur.approved_by} on ${cur.approved_at}` : `, completed by ${cur.completed_by} on ${cur.completed_at}`}`),
    ]);
    return c.json({ ok: true, status: 'draft' });
  }

  if (action === 'approve') {
    if (!(await canApprove(c.env, user, job))) return c.json({ error: 'The SDM approves job forms (Users & Roles → Approvals → Job forms)' }, 403);
    if (cur?.status !== 'completed') return c.json({ error: 'Mark it complete first' }, 409);
    if (cur.approved_at) return c.json({ ok: true });
    if (t.kind === 'package') {
      const missing = await packageMissing(c.env, job, t);
      if (missing.length) return c.json({ error: `Still missing: ${missing.join(', ')}` }, 409);
      await refilePackage(c.env, job, t.id);
    }
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE job_forms SET approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ? WHERE job_id = ? AND template_id = ?').bind(user.username, at, user.username, at, job.id, t.id),
      jobAudit(c.env, user, 'approve', job.id, `Approved ${label(t)} at ${at}`),
    ]);
    const pdf = await fileFormPdf(c.env, user, job, t, { ...cur, approved_by: user.username, approved_at: at });
    return c.json({ ok: true, approved_at: at, pdf: 'error' in pdf ? null : pdf.name, pdf_error: 'error' in pdf ? pdf.error : undefined });
  }

  if (!canEditStage(user.menus, t.stage)) return c.json({ error: 'Your role does not edit this stage of the job' }, 403);
  if (cur?.status === 'completed') return c.json({ error: cur.approved_at ? 'The form is approved and locked. An admin can reopen it.' : 'The form is complete and waiting for the SDM. An admin can reopen it.' }, 409);
  const ids = new Set(t.questions.map((q) => q.id));
  const answers: Record<string, string> = {}, remarks: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.answers ?? (cur ? JSON.parse(cur.answers) : {}))) {
    if (!ids.has(k) || v === null || v === '') continue;
    if (v !== 'yes' && v !== 'no' && v !== 'na') return c.json({ error: `${k}: answer Yes, No or N/A` }, 400);
    answers[k] = v;
  }
  for (const [k, v] of Object.entries(b.remarks ?? (cur ? JSON.parse(cur.remarks) : {}))) if (ids.has(k) && typeof v === 'string' && v.trim()) remarks[k] = v.trim().slice(0, 500);
  const complete = action === 'complete';
  if (complete) {
    const missing = t.kind === 'package' ? await packageMissing(c.env, job, t) : checklistProgress(t, answers).missing;
    if (missing.length) return c.json({ error: `${t.kind === 'package' ? 'Upload' : 'Answer'} ${missing.join(', ')} first` }, 400);
  }
  // what changed, for the audit trail
  const before = { a: cur ? (JSON.parse(cur.answers) as Record<string, string>) : {}, r: cur ? (JSON.parse(cur.remarks) as Record<string, string>) : {} };
  const changes = [...ids].flatMap((k) => [
    before.a[k] !== answers[k] ? `${k} ${before.a[k] ?? '—'} → ${answers[k] ?? '—'}` : null,
    (before.r[k] ?? '') !== (remarks[k] ?? '') ? `${k} remark “${remarks[k] ?? ''}”` : null,
  ]).filter(Boolean);
  if (!complete && !changes.length && cur) return c.json({ ok: true, status: cur.status });
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO job_forms (id, job_id, template_id, answers, remarks, status, completed_by, completed_at, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT (job_id, template_id) DO UPDATE SET answers = ?4, remarks = ?5, status = ?6, completed_by = ?7, completed_at = ?8, updated_by = ?9, updated_at = ?10`,
    ).bind(crypto.randomUUID(), job.id, t.id, JSON.stringify(answers), JSON.stringify(remarks), complete ? 'completed' : 'draft', complete ? user.username : null, complete ? at : null, user.username, at),
    jobAudit(c.env, user, complete ? 'complete' : 'edit', job.id, `${complete ? 'Completed' : 'Saved'} ${label(t)}${changes.length ? `: ${changes.join('; ')}` : ''}`),
  ]);
  return c.json({ ok: true, status: complete ? 'completed' : 'draft' });
});

/** Uploads one document of the job package into the package's R2 folder. */
jobForms.post('/:jobId/:templateId/files/:item', async (c) => {
  const ctx = await formContext(c);
  if ('error' in ctx) return ctx.error;
  const { user, job, t, cur } = ctx;
  if (t.kind !== 'package') return c.json({ error: 'Files go on the job package' }, 400);
  if (!canEditStage(user.menus, 'closure')) return c.json({ error: 'Your role does not edit Closure' }, 403);
  if (cur?.status === 'completed') return c.json({ error: 'The job package is complete. An admin can reopen it to change files.' }, 409);
  const item = t.questions.find((q) => q.id === c.req.param('item'));
  if (!item) return c.json({ error: 'No such document in the package' }, 404);
  const name = decodeURIComponent(c.req.header('x-file-name') ?? '');
  const folder = packageFolder(job);
  const r = await storeAttachment(c.env, user, {
    country: job.country, entity: 'job', entityId: job.id, category: 'document', name, bytes: new Uint8Array(await c.req.arrayBuffer()),
    note: `Job package · ${item.id} ${item.text}`.slice(0, 300), folder: folder.path, templateId: t.id, packageItem: item.id,
  });
  if ('error' in r) return c.json({ error: r.error }, r.error.includes('set up') ? 503 : 400);
  // the package exists on the job from its first file, so later template revisions don't change it
  await c.env.DB.prepare(`INSERT OR IGNORE INTO job_forms (id, job_id, template_id, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), job.id, t.id, user.username, new Date().toISOString()).run();
  await jobAudit(c.env, user, 'upload', job.id, `Job package ${item.id} “${item.text}”: uploaded ${r.name} to ${folder.path}`).run();
  return c.json(r, 201);
});

/** Removes a package file while the package is open (the object stays in R2, like every removed file). */
jobForms.delete('/:jobId/:templateId/files/:fileId', async (c) => {
  const ctx = await formContext(c);
  if ('error' in ctx) return ctx.error;
  const { user, job, t, cur } = ctx;
  if (!canEditStage(user.menus, 'closure')) return c.json({ error: 'Your role does not edit Closure' }, 403);
  if (cur?.status === 'completed') return c.json({ error: 'The job package is complete. An admin can reopen it to change files.' }, 409);
  const f = await c.env.DB.prepare('SELECT id, file_name, package_item FROM attachments WHERE id = ? AND entity_id = ? AND template_id = ? AND deleted_at IS NULL').bind(c.req.param('fileId'), job.id, t.id).first<{ id: string; file_name: string; package_item: string }>();
  if (!f) return c.json({ error: 'File not found' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE attachments SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(new Date().toISOString(), user.username, f.id),
    jobAudit(c.env, user, 'remove', job.id, `Job package ${f.package_item}: removed ${f.file_name}`),
  ]);
  return c.json({ ok: true });
});

/** Moves package files into the folder of the job's current dates (the end date can change after the first upload). */
async function refilePackage(env: Env, job: Job, templateId: string) {
  if (!env.FILES) return;
  const folder = packageFolder(job).path;
  const { results } = await env.DB.prepare(`SELECT id, r2_key FROM attachments WHERE entity_id = ? AND template_id = ? AND deleted_at IS NULL`).bind(job.id, templateId).all<{ id: string; r2_key: string }>();
  for (const f of results.filter((x) => !x.r2_key.startsWith(`${folder}/`))) {
    const obj = await env.FILES.get(f.r2_key);
    if (!obj) continue;
    const key = `${folder}/${f.r2_key.split('/').pop()}`;
    await env.FILES.put(key, await obj.arrayBuffer(), { httpMetadata: obj.httpMetadata, customMetadata: obj.customMetadata });
    await env.DB.prepare('UPDATE attachments SET r2_key = ? WHERE id = ?').bind(key, f.id).run();
    await env.FILES.delete(f.r2_key);
  }
}

/** The approved checklist (or the package's contents list) as a PDF, filed with the job; the package's also goes in its folder. */
async function fileFormPdf(env: Env, user: AuthedUser, job: Job, t: FormTemplate & { id: string }, f: FormRow) {
  const people = await env.DB.prepare(`SELECT username, full_name, role FROM user_roles WHERE username IN (?, ?)`).bind(f.completed_by ?? '', f.approved_by ?? '').all<{ username: string; full_name: string; role: string }>();
  const who = (u: string | null) => people.results.find((p) => p.username.toLowerCase() === (u ?? '').toLowerCase());
  const answers = JSON.parse(f.answers) as Record<string, string>, remarks = JSON.parse(f.remarks) as Record<string, string>;
  let rows;
  const folder = t.kind === 'package' ? packageFolder(job) : null;
  if (t.kind === 'package') {
    const facts = await jobFacts(env, job);
    const { results } = await env.DB.prepare(`SELECT package_item, file_name, uploaded_at FROM attachments WHERE entity_id = ? AND template_id = ? AND deleted_at IS NULL ORDER BY uploaded_at`).bind(job.id, t.id).all<{ package_item: string; file_name: string; uploaded_at: string }>();
    rows = t.questions.map((q) => {
      const list = results.filter((r) => r.package_item === q.id);
      return { id: q.id, section: q.section, text: q.text, answer: list.length ? `${list.length} file${list.length === 1 ? '' : 's'}` : applies(q, facts) ? (q.required ? 'Missing' : 'None') : 'Not needed', flag: !list.length && applies(q, facts) && q.required, remark: list.map((r) => r.file_name).join(' · ') || null };
    });
  } else {
    const label = { yes: 'Yes', no: 'No', na: 'N/A' } as Record<string, string>;
    rows = t.questions.map((q) => ({ id: q.id, section: q.section, text: q.text, answer: label[answers[q.id]] ?? 'Not answered', flag: answers[q.id] === 'no', remark: remarks[q.id] ? `Remark: ${remarks[q.id]}` : null }));
  }
  const bytes = formPdf({
    title: t.kind === 'package' ? 'Job package contents' : t.title || t.name, code: t.code, revision: t.revision, job, folder: folder?.path, sections: t.sections, rows,
    completed: f.completed_at ? { by: who(f.completed_by)?.full_name ?? f.completed_by ?? '', at: f.completed_at } : null,
    approval: { by: who(f.approved_by)?.full_name ?? f.approved_by ?? '', role: ROLE_LABEL[who(f.approved_by)?.role as keyof typeof ROLE_LABEL] ?? who(f.approved_by)?.role ?? '', at: f.approved_at! },
  });
  const name = `${t.name} ${job.ticket_no ?? job.id.slice(0, 8)} approved.pdf`.replace(/[\\/:*?"<>|]/g, '-');
  return storeAttachment(env, user, {
    country: job.country, entity: 'job', entityId: job.id, category: 'report', name, bytes, note: `Approved ${t.kind === 'package' ? 'job package contents' : 'checklist'} (${t.code} Rev ${t.revision})`,
    ...(folder ? { folder: folder.path } : {}),
  });
}
