import { Hono, type Context } from 'hono';
import { allowed } from '../shared/approvalRules';
import { FAMILY_OF, FORM, afterChange, cleanRows, legacyToolstring, rigTotals, stringTotals, type DiagramKind, type DiagramStatus, type Row } from '../shared/diagram';
import { diagramPdf } from '../shared/diagramPdf';
import { canEditField } from '../shared/fieldPolicy';
import { emptyNote } from '../shared/pjn';
import { canEditStage } from '../shared/stages';
import type { Job } from '../shared/types';
import { storeAttachment } from './attachments';
import type { AppBindings, AuthedUser, Env } from './env';
import { getJob } from './jobs';
import { loadRules } from './rules';

// Rig Up (QAF14009) and tool string (QAF14010) diagrams of a job: one rig up per job, one tool string per run.
// Saving keeps the old Preparation fields in step (lubricator length from the rig up, the toolstring from Run 1).
// The job's SDM, or a role in Approvals → "Review the rig up and tool string diagrams", reviews; reviewing files a PDF.

export const diagrams = new Hono<AppBindings>();

interface DiagramRow {
  id: string; job_id: string; kind: DiagramKind; run_no: number; items: string; rev: number; pdf_rev: number | null; pdf_at: string | null; pdf_by: string | null;
  status: DiagramStatus; sent_by: string | null; sent_at: string | null; reviewed_by: string | null; reviewed_at: string | null; updated_by: string | null; updated_at: string;
}

const audit = (env: Env, user: AuthedUser, action: string, jobId: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'job', jobId, summary.slice(0, 1000));

const label = (kind: DiagramKind, run: number) => (kind === 'rigup' ? `rig up diagram (${FORM.rigup.code})` : `Run ${run} tool string diagram (${FORM.toolstring.code})`);
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

async function rights(env: Env, user: AuthedUser, job: Job) {
  const rules = await loadRules(env);
  const jobsEdit = !!user.menus.jobs?.edit;
  return {
    canEdit: jobsEdit && canEditField(user.role, 'toolstring', rules) && canEditStage(user.menus, 'preparation'),
    canReview: jobsEdit && (allowed(rules, 'job.diagram_review', user.role) || same(job.sdm_username, user.username)),
  };
}

async function context(c: Context<AppBindings>) {
  const user = c.get('user');
  const job = await getJob(c.env, user, c.req.param('jobId')!);
  if (!job) return { error: c.json({ error: 'Job not found' }, 404) };
  return { user, job, ...(await rights(c.env, user, job)) };
}

/** The catalogue: active parts for the editor; with ?all=1 the switched-off ones too (Database). */
diagrams.get('/parts', async (c) => {
  const all = c.req.query('all') === '1';
  const { results } = await c.env.DB.prepare(`SELECT * FROM parts ${all ? '' : 'WHERE active = 1'} ORDER BY family, kind, name`).all();
  return c.json(results);
});

// ---- samples: saved diagrams and previous jobs' diagrams to start from ----

/** Saved samples of one kind, and that kind's diagrams on other jobs (this job's well first, then the newest). */
diagrams.get('/samples', async (c) => {
  const user = c.get('user');
  const kind = c.req.query('kind') === 'toolstring' ? 'toolstring' : 'rigup';
  const jobId = c.req.query('job') ?? '';
  const countries = JSON.stringify(user.countries);
  const [saved, previous] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT s.id, s.name, s.items, s.created_at, s.created_by, coalesce(u.full_name, s.created_by) AS created_by_name
       FROM diagram_samples s LEFT JOIN user_roles u ON u.username = s.created_by
       WHERE s.kind = ? AND s.country IN (SELECT value FROM json_each(?)) ORDER BY s.name`,
    ).bind(kind, countries),
    c.env.DB.prepare(
      `SELECT d.id, d.run_no, d.items, d.rev, d.updated_at, j.id AS job_id, j.ticket_no, j.well, j.start_date,
              (j.well IS NOT NULL AND j.well = (SELECT well FROM jobs WHERE id = ?3)) AS same_well
       FROM job_diagrams d JOIN jobs j ON j.id = d.job_id
       WHERE d.kind = ?1 AND d.job_id <> ?3 AND j.deleted_at IS NULL AND j.country IN (SELECT value FROM json_each(?2)) AND d.items <> '[]'
       ORDER BY same_well DESC, d.updated_at DESC LIMIT 25`,
    ).bind(kind, countries, jobId),
  ]);
  const parse = <T extends { items: string }>(rows: T[]) => rows.map((r) => ({ ...r, items: JSON.parse(r.items) as Row[] }));
  return c.json({ saved: parse(saved.results as { items: string }[]), previous: parse(previous.results as { items: string }[]) });
});

/** Saves the rows as a named sample for the job's country. */
diagrams.post('/samples', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<{ kind?: string; name?: string; items?: unknown; job?: string }>().catch(() => ({} as { kind?: string; name?: string; items?: unknown; job?: string }));
  const kind: DiagramKind = b.kind === 'toolstring' ? 'toolstring' : 'rigup';
  const name = String(b.name ?? '').trim().slice(0, 80);
  if (!name) return c.json({ error: 'Give the sample a name' }, 400);
  const job = b.job ? await getJob(c.env, user, b.job) : null;
  if (!job) return c.json({ error: 'Job not found' }, 404);
  if (!(await rights(c.env, user, job)).canEdit) return c.json({ error: 'Your role does not edit Preparation' }, 403);
  const r = cleanRows(b.items, FAMILY_OF[kind]);
  if ('error' in r) return c.json({ error: r.error }, 400);
  if (!r.rows.length) return c.json({ error: 'Add parts before saving a sample' }, 400);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO diagram_samples (id, country, kind, name, items, from_job_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, job.country, kind, name, JSON.stringify(r.rows), job.id, user.username),
      audit(c.env, user, 'create', job.id, `Saved the ${kind === 'rigup' ? 'rig up' : 'tool string'} as the sample “${name}”`),
    ]);
  } catch (e) {
    if (/UNIQUE/.test((e as Error).message)) return c.json({ error: `There is already a ${kind === 'rigup' ? 'rig up' : 'tool string'} sample called “${name}”` }, 409);
    throw e;
  }
  return c.json({ ok: true, id }, 201);
});

/** Removes a sample: whoever saved it, or an admin. */
diagrams.delete('/samples/:id', async (c) => {
  const user = c.get('user');
  const s = await c.env.DB.prepare(`SELECT id, name, created_by FROM diagram_samples WHERE id = ? AND country IN (SELECT value FROM json_each(?))`)
    .bind(c.req.param('id'), JSON.stringify(user.countries)).first<{ id: string; name: string; created_by: string }>();
  if (!s) return c.json({ error: 'Sample not found' }, 404);
  if (user.role !== 'admin' && !same(s.created_by, user.username)) return c.json({ error: 'Only the person who saved it, or an admin, removes a sample' }, 403);
  await c.env.DB.prepare('DELETE FROM diagram_samples WHERE id = ?').bind(s.id).run();
  return c.json({ ok: true });
});

const names = (env: Env, users: (string | null)[]) => {
  const list = [...new Set(users.filter((u): u is string => !!u))];
  return env.DB.prepare(`SELECT username, full_name FROM user_roles WHERE username IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(list)).all<{ username: string; full_name: string }>()
    .then((r) => (u: string | null) => (u ? r.results.find((x) => same(x.username, u))?.full_name ?? u : null));
};

const shape = (d: DiagramRow, who: (u: string | null) => string | null) => ({
  ...d, items: JSON.parse(d.items) as Row[], pdf_by_name: who(d.pdf_by), sent_by_name: who(d.sent_by), reviewed_by_name: who(d.reviewed_by), updated_by_name: who(d.updated_by),
});

async function wireSize(env: Env, serial: string | null) {
  if (!serial) return null;
  const w = await env.DB.prepare('SELECT wire_size FROM wg_wires WHERE wire_serial_number = ?').bind(serial).first<{ wire_size: string | null }>();
  const n = Number.parseFloat(w?.wire_size ?? '');
  return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

/** Everything the diagram editor needs for one job. */
diagrams.get('/:jobId', async (c) => {
  const ctx = await context(c);
  if ('error' in ctx) return ctx.error;
  const { job } = ctx;
  const { results } = await c.env.DB.prepare('SELECT * FROM job_diagrams WHERE job_id = ? ORDER BY kind, run_no').bind(job.id).all<DiagramRow>();
  const who = await names(c.env, [job.sdm_username, ...results.flatMap((d) => [d.pdf_by, d.sent_by, d.reviewed_by, d.updated_by])]);
  const list = results.map((d) => shape(d, who));
  return c.json({
    job: {
      id: job.id, ticket_no: job.ticket_no, drss_no: job.drss_no, well: job.well, field: job.field, rig: job.rig, unit_number: job.unit_number, start_date: job.start_date,
      sdm_username: job.sdm_username, sdm_name: who(job.sdm_username), siwhp_psi: job.siwhp_psi, h2s_ppm: job.h2s_ppm, min_restriction_in: job.min_restriction_in,
      wire_serial_number: job.wire_serial_number, wire_in: await wireSize(c.env, job.wire_serial_number), target_depth_ft: job.target_depth_ft,
    },
    rigup: list.find((d) => d.kind === 'rigup') ?? null,
    toolstrings: list.filter((d) => d.kind === 'toolstring'),
    legacy_toolstring: job.toolstring ?? [],
    canEdit: ctx.canEdit, canReview: ctx.canReview,
  });
});

function target(c: Context<AppBindings>) {
  const kind = c.req.param('kind') as DiagramKind;
  const run = Number(c.req.param('run'));
  if (kind !== 'rigup' && kind !== 'toolstring') return { error: 'Unknown diagram' };
  if (!Number.isInteger(run) || (kind === 'rigup' ? run !== 0 : run < 1 || run > 20)) return { error: kind === 'rigup' ? 'The rig up is run 0' : 'Runs are 1 to 20' };
  return { kind, run };
}

const current = (env: Env, jobId: string, kind: DiagramKind, run: number) =>
  env.DB.prepare('SELECT * FROM job_diagrams WHERE job_id = ? AND kind = ? AND run_no = ?').bind(jobId, kind, run).first<DiagramRow>();

/** Saves a diagram's rows. A change after a PDF of this revision raises the revision; any change sends it back to draft. */
diagrams.put('/:jobId/:kind/:run', async (c) => {
  const ctx = await context(c);
  if ('error' in ctx) return ctx.error;
  const { user, job } = ctx;
  if (!ctx.canEdit) return c.json({ error: 'Your role does not edit Preparation' }, 403);
  const t = target(c);
  if ('error' in t) return c.json({ error: t.error }, 400);
  const b = await c.req.json<{ items?: unknown; updated_at?: string | null }>().catch(() => ({} as { items?: unknown; updated_at?: string | null }));
  const r = cleanRows(b.items, FAMILY_OF[t.kind]);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const cur = await current(c.env, job.id, t.kind, t.run);
  if (cur && b.updated_at && b.updated_at !== cur.updated_at) {
    const who = await names(c.env, [cur.updated_by]);
    return c.json({ error: `Changed by ${who(cur.updated_by)} since you opened it`, diagram: shape(cur, who) }, 409);
  }
  if (!cur && t.kind === 'toolstring' && t.run > 1) {
    const prev = await current(c.env, job.id, 'toolstring', t.run - 1);
    if (!prev) return c.json({ error: `Add Run ${t.run - 1} first` }, 400);
  }
  const items = JSON.stringify(r.rows);
  const changed = !cur || cur.items !== items;
  const next = afterChange(cur ?? { rev: 0, pdf_rev: null, status: 'draft' }, changed && !!cur);
  const at = new Date().toISOString();
  const stmts = [
    cur
      ? c.env.DB.prepare('UPDATE job_diagrams SET items = ?, rev = ?, status = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(items, next.rev, next.status, user.username, at, cur.id)
      : c.env.DB.prepare('INSERT INTO job_diagrams (id, job_id, kind, run_no, items, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), job.id, t.kind, t.run, items, user.username, at),
  ];
  if (changed) {
    // keep the old Preparation fields in step, so checks, report, package and pre-job note read the diagrams
    if (t.kind === 'rigup') {
      const lub = rigTotals(r.rows).lubricator_ft;
      stmts.push(c.env.DB.prepare('UPDATE jobs SET lubricator_length_ft = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(lub || null, user.username, at, job.id));
    } else if (t.run === 1) {
      const s = stringTotals(r.rows);
      stmts.push(c.env.DB.prepare('UPDATE jobs SET toolstring = ?, toolstring_length_ft = ?, stem_weight_lb = ?, max_tool_od_in = ?, updated_by = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(legacyToolstring(r.rows)), r.rows.length ? s.length_ft : null, s.weight_above_jar_lb, s.max_od_in, user.username, at, job.id));
    }
    stmts.push(audit(c.env, user, cur ? 'update' : 'create', job.id,
      `${cur ? 'Changed' : 'Started'} the ${label(t.kind, t.run)}: ${r.rows.length} part${r.rows.length === 1 ? '' : 's'}${cur && next.rev !== cur.rev ? `, now Rev ${next.rev}` : ''}`));
  }
  await c.env.DB.batch(stmts);
  const saved = (await current(c.env, job.id, t.kind, t.run))!;
  return c.json({ diagram: shape(saved, await names(c.env, [saved.pdf_by, saved.sent_by, saved.reviewed_by, saved.updated_by])) });
});

/** Removes a run's tool string that never had a PDF (the last run only, so runs stay numbered 1, 2, 3…). */
diagrams.delete('/:jobId/toolstring/:run', async (c) => {
  const ctx = await context(c);
  if ('error' in ctx) return ctx.error;
  if (!ctx.canEdit) return c.json({ error: 'Your role does not edit Preparation' }, 403);
  const run = Number(c.req.param('run'));
  const cur = await current(c.env, ctx.job.id, 'toolstring', run);
  if (!cur) return c.json({ error: 'No such run' }, 404);
  if (cur.pdf_rev != null) return c.json({ error: `Run ${run} has a filed PDF, so it stays. Change it instead.` }, 409);
  if (await current(c.env, ctx.job.id, 'toolstring', run + 1)) return c.json({ error: `Remove Run ${run + 1} first` }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM job_diagrams WHERE id = ?').bind(cur.id),
    audit(c.env, ctx.user, 'remove', ctx.job.id, `Removed the ${label('toolstring', run)}`),
  ]);
  return c.json({ ok: true });
});

/** Builds the PDF. The first PDF of a revision is filed with the job's attachments and fixes that revision. */
async function makePdf(env: Env, user: AuthedUser, job: Job, d: DiagramRow) {
  const rows = JSON.parse(d.items) as Row[];
  const who = await names(env, [d.sent_by, d.updated_by, d.reviewed_by]);
  const reviewed = d.status === 'reviewed' && d.reviewed_by && d.reviewed_at ? { by: who(d.reviewed_by)!, at: d.reviewed_at } : null;
  const prepBy = d.sent_by ?? d.updated_by;
  const bytes = diagramPdf({
    kind: d.kind, run_no: d.run_no, rev: d.rev, rows,
    job: { client: emptyNote().client, well: job.well, field: job.field, rig: job.rig, unit_number: job.unit_number, date: job.start_date, ticket_no: job.ticket_no, drss_no: job.drss_no },
    prepared: prepBy ? { by: who(prepBy)!, at: d.sent_at ?? d.updated_at } : null,
    reviewed,
    totalDepth: d.kind === 'toolstring' ? { md: job.target_depth_ft, tvd: null } : undefined,
  });
  const form = FORM[d.kind];
  const name = `${form.code} ${d.kind === 'rigup' ? 'Rig Up' : `Run ${d.run_no} String`} ${job.ticket_no ?? job.id.slice(0, 8)} Rev ${d.rev}${reviewed ? ' reviewed' : ''}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
  let filed: string | null = null, fileError: string | undefined;
  if (d.pdf_rev !== d.rev || reviewed) {
    const stored = await storeAttachment(env, user, { country: job.country, entity: 'job', entityId: job.id, category: 'report', name, bytes, note: `${form.title} ${form.code} Rev ${d.rev}${reviewed ? ', reviewed by the SDM' : ''}` });
    if ('error' in stored) fileError = stored.error; else filed = name;
  }
  return { bytes, name, filed, fileError };
}

diagrams.post('/:jobId/:kind/:run/:action', async (c) => {
  const ctx = await context(c);
  if ('error' in ctx) return ctx.error;
  const { user, job } = ctx;
  const t = target(c);
  if ('error' in t) return c.json({ error: t.error }, 400);
  const action = c.req.param('action');
  const cur = await current(c.env, job.id, t.kind, t.run);
  if (!cur) return c.json({ error: 'Save the diagram first' }, 404);
  const at = new Date().toISOString();

  if (action === 'pdf') {
    const pdf = await makePdf(c.env, user, job, cur);
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE job_diagrams SET pdf_rev = ?, pdf_at = ?, pdf_by = ? WHERE id = ?').bind(cur.rev, at, user.username, cur.id),
      ...(pdf.filed ? [audit(c.env, user, 'pdf', job.id, `Made the PDF of the ${label(t.kind, t.run)}, Rev ${cur.rev}`)] : []),
    ]);
    return new Response(pdf.bytes, {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${pdf.name}"`, 'X-Filed': pdf.filed ? 'yes' : 'no', ...(pdf.fileError ? { 'X-File-Error': encodeURIComponent(pdf.fileError) } : {}) },
    });
  }
  if (action === 'send') {
    if (!ctx.canEdit) return c.json({ error: 'Your role does not edit Preparation' }, 403);
    if (!(JSON.parse(cur.items) as Row[]).length) return c.json({ error: 'Add the parts first' }, 409);
    if (cur.status !== 'draft') return c.json({ ok: true });
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE job_diagrams SET status = 'sent', sent_by = ?, sent_at = ? WHERE id = ?`).bind(user.username, at, cur.id),
      audit(c.env, user, 'send', job.id, `Sent the ${label(t.kind, t.run)} Rev ${cur.rev} for SDM review`),
    ]);
    return c.json({ ok: true });
  }
  if (action === 'review') {
    if (!ctx.canReview) return c.json({ error: 'The job’s SDM reviews diagrams (Users & Roles → Approvals → Job)' }, 403);
    if (!(JSON.parse(cur.items) as Row[]).length) return c.json({ error: 'The diagram has no parts' }, 409);
    if (cur.status === 'reviewed') return c.json({ ok: true });
    const done: DiagramRow = { ...cur, status: 'reviewed', reviewed_by: user.username, reviewed_at: at, sent_by: cur.sent_by ?? cur.updated_by, sent_at: cur.sent_at ?? cur.updated_at };
    const pdf = await makePdf(c.env, user, job, done);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE job_diagrams SET status = 'reviewed', reviewed_by = ?, reviewed_at = ?, sent_by = ?, sent_at = ?, pdf_rev = ?, pdf_at = ?, pdf_by = ? WHERE id = ?`)
        .bind(user.username, at, done.sent_by, done.sent_at, cur.rev, at, user.username, cur.id),
      audit(c.env, user, 'approve', job.id, `Reviewed the ${label(t.kind, t.run)} Rev ${cur.rev}`),
    ]);
    return c.json({ ok: true, pdf: pdf.filed, pdf_error: pdf.fileError });
  }
  if (action === 'reopen') {
    if (!ctx.canReview) return c.json({ error: 'Only the SDM reopens a reviewed diagram' }, 403);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE job_diagrams SET status = 'draft' WHERE id = ?`).bind(cur.id),
      audit(c.env, user, 'reopen', job.id, `Sent the ${label(t.kind, t.run)} Rev ${cur.rev} back to draft`),
    ]);
    return c.json({ ok: true });
  }
  return c.json({ error: 'Unknown action' }, 400);
});
