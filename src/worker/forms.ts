import Anthropic from '@anthropic-ai/sdk';
import { Hono } from 'hono';
import { TEMPLATE_SCHEMA, checklistProgress, cleanTemplate, docxLines, linesToTemplate, sheetLines, type FormTemplate } from '../shared/forms';
import type { Template } from '../shared/jra';
import { parseJraForm } from '../shared/jraForm';
import { canEditStage, type Stage } from '../shared/stages';
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
  name: string | null; kind: 'jra' | 'checklist'; stage: Stage; source_file: string | null; created_by: string | null; updated_by: string | null; updated_at: string | null;
};

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'form_template', id, summary.slice(0, 1000));

export function fromRow(r: Row): FormTemplate {
  const q = JSON.parse(r.questions) as Pick<Template, 'sections' | 'questions' | 'title' | 'notes' | 'exemption_points'>;
  return {
    id: r.id, country: r.country, name: r.name ?? 'Job Risk Assessment', kind: r.kind, stage: r.stage, active: !!r.active, source_file: r.source_file,
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
    // one JRA in use per country: a new active one takes over
    ...(t.kind === 'jra' && active ? [c.env.DB.prepare(`UPDATE jra_templates SET active = 0 WHERE country = ? AND kind = 'jra'`).bind(country)] : []),
    c.env.DB.prepare(
      `INSERT INTO jra_templates (id, country, code, revision, questions, approval_levels, active, name, kind, stage, source_file, created_by, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, country, t.code, t.revision, contentOf(t), JSON.stringify(t.approval_levels), active ? 1 : 0, t.name, t.kind, t.stage, t.source_file ?? null, user.username, user.username, at),
    audit(c.env, user, 'create', id, `${country} ${t.kind === 'jra' ? 'JRA' : 'checklist'} “${t.name}” ${t.code} Rev ${t.revision} (${t.questions.length} questions, ${t.stage})${t.source_file ? ` from ${t.source_file}` : ''}`),
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
  const offOthers = t.kind === 'jra' && active ? [c.env.DB.prepare(`UPDATE jra_templates SET active = 0 WHERE country = ? AND kind = 'jra' AND id <> ?`).bind(cur.country, cur.id)] : [];
  if (used) {
    if (b.new_revision !== true) return c.json({ error: `${used} job${used === 1 ? '' : 's'} already filled this template. Save the new questions as the next revision?`, needs_revision: true, used }, 409);
    const revision = await nextRevision(c.env, cur.country, t.code, t.revision);
    const id = crypto.randomUUID();
    await c.env.DB.batch([
      ...(t.kind === 'jra' ? [c.env.DB.prepare(`UPDATE jra_templates SET active = 0 WHERE country = ? AND kind = 'jra'`).bind(cur.country)] : [c.env.DB.prepare('UPDATE jra_templates SET active = 0 WHERE id = ?').bind(cur.id)]),
      c.env.DB.prepare(
        `INSERT INTO jra_templates (id, country, code, revision, questions, approval_levels, active, name, kind, stage, source_file, created_by, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, cur.country, t.code, revision, contentOf(t), JSON.stringify(t.approval_levels), t.name, t.kind, t.stage, t.source_file ?? cur.source_file, user.username, user.username, at),
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

// ---- checklists filled on a job ----------------------------------------------------------------------------

export const jobForms = new Hono<AppBindings>();

type FormRow = { template_id: string; answers: string; remarks: string; status: 'draft' | 'completed'; completed_by: string | null; completed_at: string | null; updated_by: string | null; updated_at: string };

/** The checklists for the job's country (in use, plus any the job already filled) and where the JRA sits. */
jobForms.get('/:jobId', async (c) => {
  const job = await getJob(c.env, c.get('user'), c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const [tpl, filled, jra] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT * FROM jra_templates WHERE kind = 'checklist' AND country = ?1 AND (active = 1 OR id IN (SELECT template_id FROM job_forms WHERE job_id = ?2)) ORDER BY stage, name`).bind(job.country, job.id),
    c.env.DB.prepare(`SELECT f.*, coalesce(u.full_name, f.completed_by) AS completed_by FROM job_forms f LEFT JOIN user_roles u ON u.username = f.completed_by WHERE f.job_id = ?`).bind(job.id),
    c.env.DB.prepare(`SELECT stage FROM jra_templates WHERE kind = 'jra' AND (id = (SELECT template_id FROM jras WHERE job_id = ?2) OR (country = ?1 AND active = 1)) ORDER BY id = (SELECT template_id FROM jras WHERE job_id = ?2) DESC LIMIT 1`).bind(job.country, job.id),
  ]);
  const rows = filled.results as FormRow[];
  // a job that filled an older revision keeps it; the newer one of the same code isn't offered next to it
  const usedCodes = new Set((tpl.results as Row[]).filter((t) => rows.some((f) => f.template_id === t.id)).map((t) => t.code));
  const templates = (tpl.results as Row[]).filter((t) => rows.some((f) => f.template_id === t.id) || !usedCodes.has(t.code)).map(fromRow);
  return c.json({
    jra_stage: (jra.results[0] as { stage?: Stage } | undefined)?.stage ?? 'preparation',
    templates,
    forms: rows.map((f) => ({ ...f, answers: JSON.parse(f.answers), remarks: JSON.parse(f.remarks) })),
  });
});

/** Saves the answers and remarks; `status: 'completed'` needs every required question answered, `'draft'` reopens it. */
jobForms.put('/:jobId/:templateId', async (c) => {
  const user = c.get('user');
  const job = await getJob(c.env, user, c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const row = await c.env.DB.prepare(`SELECT * FROM jra_templates WHERE id = ? AND kind = 'checklist' AND country = ?`).bind(c.req.param('templateId'), job.country).first<Row>();
  if (!row) return c.json({ error: 'No such checklist for this job' }, 404);
  const t = fromRow(row);
  if (!canEditStage(user.menus, t.stage)) return c.json({ error: 'Your role does not edit this stage of the job' }, 403);
  const b = await c.req.json<{ answers?: Record<string, unknown>; remarks?: Record<string, unknown>; status?: string }>().catch(() => ({} as { answers?: Record<string, unknown>; remarks?: Record<string, unknown>; status?: string }));
  const cur = await c.env.DB.prepare('SELECT * FROM job_forms WHERE job_id = ? AND template_id = ?').bind(job.id, row.id).first<FormRow>();
  if (cur?.status === 'completed' && b.status !== 'draft') return c.json({ error: 'The checklist is complete. Reopen it to change answers.' }, 409);
  const ids = new Set(t.questions.map((q) => q.id));
  const answers: Record<string, string> = {}, remarks: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.answers ?? (cur ? JSON.parse(cur.answers) : {}))) {
    if (!ids.has(k) || v === null || v === '') continue;
    if (v !== 'yes' && v !== 'no' && v !== 'na') return c.json({ error: `${k}: answer Yes, No or N/A` }, 400);
    answers[k] = v;
  }
  for (const [k, v] of Object.entries(b.remarks ?? (cur ? JSON.parse(cur.remarks) : {}))) if (ids.has(k) && typeof v === 'string' && v.trim()) remarks[k] = v.trim().slice(0, 500);
  const status = b.status === 'completed' ? 'completed' : b.status === 'draft' ? 'draft' : cur?.status ?? 'draft';
  if (status === 'completed') {
    const missing = checklistProgress(t, answers).missing;
    if (missing.length) return c.json({ error: `Answer ${missing.join(', ')} first` }, 400);
  }
  const at = new Date().toISOString();
  const done = status === 'completed' && cur?.status !== 'completed';
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO job_forms (id, job_id, template_id, answers, remarks, status, completed_by, completed_at, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT (job_id, template_id) DO UPDATE SET answers = ?4, remarks = ?5, status = ?6, completed_by = ?7, completed_at = ?8, updated_by = ?9, updated_at = ?10`,
    ).bind(crypto.randomUUID(), job.id, row.id, JSON.stringify(answers), JSON.stringify(remarks), status,
      status === 'completed' ? (done ? user.username : cur?.completed_by ?? user.username) : null, status === 'completed' ? (done ? at : cur?.completed_at ?? at) : null, user.username, at),
    ...(done || (cur?.status === 'completed' && status === 'draft')
      ? [c.env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), user.username, done ? 'complete' : 'reopen', 'job', job.id, `${done ? 'Completed' : 'Reopened'} checklist “${t.name}” (${t.code} Rev ${t.revision})`)]
      : []),
  ]);
  return c.json({ ok: true, status });
});
