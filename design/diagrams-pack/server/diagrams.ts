import { Hono, type Context } from 'hono';
import { FAMILY_OF, FORM, afterChange, cleanRows, type DiagramKind, type DiagramStatus, type Row } from '../core/diagram';
import { diagramPdf } from '../core/diagramPdf';

// Rig Up (QAF14009) and tool string (QAF14010) diagrams of a job: one rig up per job, one tool string per run, saved
// samples, review and revisioned PDFs. Portable version of SLK Operations Hub's src/worker/diagrams.ts: everything that
// belongs to the host app (database, signed-in user, jobs, rights, names, file storage, audit) comes in through `host`.
//
//   app.route('/api/diagrams', createDiagramsRouter(host))
//
// Tables: migrations/0001_diagrams.sql (parts, job_diagrams, diagram_samples). The parts catalogue's write routes
// (add, edit, remove a part) belong to the host's admin area; cleanPart() in core/diagram.ts validates them.

export interface DiagramsUser { username: string; role: string; countries: string[] }

/** The job fields the diagrams read. Map your job onto this shape in host.getJob. */
export interface DiagramsJob {
  id: string; country: string;
  ticket_no: string | null; drss_no: string | null; well: string | null; field: string | null; rig: string | null; unit_number: string | null; start_date: string | null;
  sdm_username: string | null;
  /** Shut-in wellhead pressure used as MPWHP for the rating check (psi). */
  siwhp_psi: number | null; h2s_ppm: number | null; min_restriction_in: number | null; target_depth_ft: number | null;
  /** Wire diameter in inches, for the stem-weight check. */
  wire_in: number | null;
  /** An older simple toolstring on the job, offered under "Start from"; [] if your app has none. */
  toolstring?: { component: string; od_in?: number | null; length_ft?: number | null; weight_lb?: number | null }[];
}

export interface DiagramsHost {
  db(c: Context): D1Database;
  user(c: Context): DiagramsUser;
  /** The job if this user may see it, else null. */
  getJob(c: Context, user: DiagramsUser, id: string): Promise<DiagramsJob | null>;
  /** canEdit: may change diagrams and save samples. canReview: may mark reviewed (SLK: the job's SDM or a role rule). */
  rights(c: Context, user: DiagramsUser, job: DiagramsJob): Promise<{ canEdit: boolean; canReview: boolean }>;
  /** Display names for usernames; return the username when unknown. */
  displayNames?(c: Context, usernames: string[]): Promise<Record<string, string>>;
  /** Files a PDF with the job (SLK: the job's attachments). Leave out to only return the PDF to the browser. */
  storePdf?(c: Context, user: DiagramsUser, job: DiagramsJob, file: { name: string; bytes: Uint8Array; note: string }): Promise<{ error?: string }>;
  /** Writes an audit line. Leave out if your app has no audit log. */
  audit?(c: Context, user: DiagramsUser, action: string, jobId: string, summary: string): Promise<void>;
  /** Runs after a diagram's rows change, e.g. to copy the lubricator length or Run 1 onto the job (see README). */
  onSaved?(c: Context, user: DiagramsUser, job: DiagramsJob, kind: DiagramKind, run: number, rows: Row[]): Promise<void>;
  /** The client name printed in the PDF header. Default 'Saudi Aramco'. */
  client?(job: DiagramsJob): string;
  /** Who may remove any sample. Default: role 'admin'. */
  isAdmin?(user: DiagramsUser): boolean;
}

interface DiagramRow {
  id: string; job_id: string; kind: DiagramKind; run_no: number; items: string; rev: number; pdf_rev: number | null; pdf_at: string | null; pdf_by: string | null;
  status: DiagramStatus; sent_by: string | null; sent_at: string | null; reviewed_by: string | null; reviewed_at: string | null; updated_by: string | null; updated_at: string;
}

const label = (kind: DiagramKind, run: number) => (kind === 'rigup' ? `rig up diagram (${FORM.rigup.code})` : `Run ${run} tool string diagram (${FORM.toolstring.code})`);
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function createDiagramsRouter(host: DiagramsHost) {
  const r = new Hono();
  const audit = (c: Context, user: DiagramsUser, action: string, jobId: string, summary: string) => host.audit?.(c, user, action, jobId, summary.slice(0, 1000)) ?? Promise.resolve();

  const names = async (c: Context, users: (string | null)[]) => {
    const list = [...new Set(users.filter((u): u is string => !!u))];
    const map = host.displayNames && list.length ? await host.displayNames(c, list) : {};
    return (u: string | null) => (u ? map[u] ?? Object.entries(map).find(([k]) => same(k, u))?.[1] ?? u : null);
  };
  const shape = (d: DiagramRow, who: (u: string | null) => string | null) => ({
    ...d, items: JSON.parse(d.items) as Row[], pdf_by_name: who(d.pdf_by), sent_by_name: who(d.sent_by), reviewed_by_name: who(d.reviewed_by), updated_by_name: who(d.updated_by),
  });
  const context = async (c: Context) => {
    const user = host.user(c);
    const job = await host.getJob(c, user, c.req.param('jobId')!);
    if (!job) return { error: c.json({ error: 'Job not found' }, 404) };
    return { user, job, ...(await host.rights(c, user, job)) };
  };
  const current = (c: Context, jobId: string, kind: DiagramKind, run: number) =>
    host.db(c).prepare('SELECT * FROM job_diagrams WHERE job_id = ? AND kind = ? AND run_no = ?').bind(jobId, kind, run).first<DiagramRow>();
  const target = (c: Context) => {
    const kind = c.req.param('kind') as DiagramKind, run = Number(c.req.param('run'));
    if (kind !== 'rigup' && kind !== 'toolstring') return { error: 'Unknown diagram' };
    if (!Number.isInteger(run) || (kind === 'rigup' ? run !== 0 : run < 1 || run > 20)) return { error: kind === 'rigup' ? 'The rig up is run 0' : 'Runs are 1 to 20' };
    return { kind, run };
  };

  /** The catalogue: active parts for the editor; with ?all=1 the switched-off ones too. */
  r.get('/parts', async (c) => {
    const { results } = await host.db(c).prepare(`SELECT * FROM parts ${c.req.query('all') === '1' ? '' : 'WHERE active = 1'} ORDER BY family, kind, name`).all();
    return c.json(results);
  });

  // ---- samples: saved diagrams and previous jobs' diagrams to start from ----

  r.get('/samples', async (c) => {
    const user = host.user(c), db = host.db(c);
    const kind = c.req.query('kind') === 'toolstring' ? 'toolstring' : 'rigup';
    const jobId = c.req.query('job') ?? '', countries = JSON.stringify(user.countries);
    const [saved, previous] = await db.batch([
      db.prepare(`SELECT id, name, items, created_at, created_by FROM diagram_samples WHERE kind = ? AND country IN (SELECT value FROM json_each(?)) ORDER BY name`).bind(kind, countries),
      db.prepare(
        `SELECT d.id, d.run_no, d.items, d.rev, d.updated_at, j.id AS job_id, j.ticket_no, j.well, j.start_date,
                (j.well IS NOT NULL AND j.well = (SELECT well FROM jobs WHERE id = ?3)) AS same_well
         FROM job_diagrams d JOIN jobs j ON j.id = d.job_id
         WHERE d.kind = ?1 AND d.job_id <> ?3 AND j.country IN (SELECT value FROM json_each(?2)) AND d.items <> '[]'
         ORDER BY same_well DESC, d.updated_at DESC LIMIT 25`,
      ).bind(kind, countries, jobId),
    ]);
    const savedRows = saved.results as { items: string; created_by: string }[];
    const who = await names(c, savedRows.map((s) => s.created_by));
    return c.json({
      saved: savedRows.map((s) => ({ ...s, items: JSON.parse(s.items) as Row[], created_by_name: who(s.created_by) })),
      previous: (previous.results as { items: string }[]).map((d) => ({ ...d, items: JSON.parse(d.items) as Row[] })),
    });
  });

  r.post('/samples', async (c) => {
    const user = host.user(c);
    const b = await c.req.json<{ kind?: string; name?: string; items?: unknown; job?: string }>().catch(() => ({} as { kind?: string; name?: string; items?: unknown; job?: string }));
    const kind: DiagramKind = b.kind === 'toolstring' ? 'toolstring' : 'rigup';
    const name = String(b.name ?? '').trim().slice(0, 80);
    if (!name) return c.json({ error: 'Give the sample a name' }, 400);
    const job = b.job ? await host.getJob(c, user, b.job) : null;
    if (!job) return c.json({ error: 'Job not found' }, 404);
    if (!(await host.rights(c, user, job)).canEdit) return c.json({ error: 'You may not edit this job’s diagrams' }, 403);
    const rows = cleanRows(b.items, FAMILY_OF[kind]);
    if ('error' in rows) return c.json({ error: rows.error }, 400);
    if (!rows.rows.length) return c.json({ error: 'Add parts before saving a sample' }, 400);
    const id = crypto.randomUUID();
    try {
      await host.db(c).prepare('INSERT INTO diagram_samples (id, country, kind, name, items, from_job_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, job.country, kind, name, JSON.stringify(rows.rows), job.id, user.username).run();
    } catch (e) {
      if (/UNIQUE/.test((e as Error).message)) return c.json({ error: `There is already a ${kind === 'rigup' ? 'rig up' : 'tool string'} sample called “${name}”` }, 409);
      throw e;
    }
    await audit(c, user, 'create', job.id, `Saved the ${kind === 'rigup' ? 'rig up' : 'tool string'} as the sample “${name}”`);
    return c.json({ ok: true, id }, 201);
  });

  r.delete('/samples/:id', async (c) => {
    const user = host.user(c), db = host.db(c);
    const s = await db.prepare(`SELECT id, created_by FROM diagram_samples WHERE id = ? AND country IN (SELECT value FROM json_each(?))`)
      .bind(c.req.param('id'), JSON.stringify(user.countries)).first<{ id: string; created_by: string }>();
    if (!s) return c.json({ error: 'Sample not found' }, 404);
    const admin = host.isAdmin ? host.isAdmin(user) : user.role === 'admin';
    if (!admin && !same(s.created_by, user.username)) return c.json({ error: 'Only the person who saved it, or an admin, removes a sample' }, 403);
    await db.prepare('DELETE FROM diagram_samples WHERE id = ?').bind(s.id).run();
    return c.json({ ok: true });
  });

  // ---- one job's diagrams ----

  r.get('/:jobId', async (c) => {
    const ctx = await context(c);
    if ('error' in ctx) return ctx.error;
    const { job } = ctx;
    const { results } = await host.db(c).prepare('SELECT * FROM job_diagrams WHERE job_id = ? ORDER BY kind, run_no').bind(job.id).all<DiagramRow>();
    const who = await names(c, [job.sdm_username, ...results.flatMap((d) => [d.pdf_by, d.sent_by, d.reviewed_by, d.updated_by])]);
    const list = results.map((d) => shape(d, who));
    return c.json({
      job: {
        id: job.id, ticket_no: job.ticket_no, drss_no: job.drss_no, well: job.well, field: job.field, rig: job.rig, unit_number: job.unit_number, start_date: job.start_date,
        sdm_username: job.sdm_username, sdm_name: who(job.sdm_username), siwhp_psi: job.siwhp_psi, h2s_ppm: job.h2s_ppm, min_restriction_in: job.min_restriction_in,
        wire_in: job.wire_in, target_depth_ft: job.target_depth_ft,
      },
      rigup: list.find((d) => d.kind === 'rigup') ?? null,
      toolstrings: list.filter((d) => d.kind === 'toolstring'),
      legacy_toolstring: job.toolstring ?? [],
      canEdit: ctx.canEdit, canReview: ctx.canReview,
    });
  });

  /** Saves a diagram's rows. A change after a PDF of this revision raises the revision; any change sends it back to draft. */
  r.put('/:jobId/:kind/:run', async (c) => {
    const ctx = await context(c);
    if ('error' in ctx) return ctx.error;
    const { user, job } = ctx, db = host.db(c);
    if (!ctx.canEdit) return c.json({ error: 'You may not edit this job’s diagrams' }, 403);
    const t = target(c);
    if ('error' in t) return c.json({ error: t.error }, 400);
    const b = await c.req.json<{ items?: unknown; updated_at?: string | null }>().catch(() => ({} as { items?: unknown; updated_at?: string | null }));
    const rows = cleanRows(b.items, FAMILY_OF[t.kind]);
    if ('error' in rows) return c.json({ error: rows.error }, 400);
    const cur = await current(c, job.id, t.kind, t.run);
    if (cur && b.updated_at && b.updated_at !== cur.updated_at) {
      const who = await names(c, [cur.updated_by]);
      return c.json({ error: `Changed by ${who(cur.updated_by)} since you opened it`, diagram: shape(cur, who) }, 409);
    }
    if (!cur && t.kind === 'toolstring' && t.run > 1 && !(await current(c, job.id, 'toolstring', t.run - 1))) return c.json({ error: `Add Run ${t.run - 1} first` }, 400);
    const items = JSON.stringify(rows.rows);
    const changed = !cur || cur.items !== items;
    const next = afterChange(cur ?? { rev: 0, pdf_rev: null, status: 'draft' }, changed && !!cur);
    const at = new Date().toISOString();
    await (cur
      ? db.prepare('UPDATE job_diagrams SET items = ?, rev = ?, status = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(items, next.rev, next.status, user.username, at, cur.id)
      : db.prepare('INSERT INTO job_diagrams (id, job_id, kind, run_no, items, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), job.id, t.kind, t.run, items, user.username, at)).run();
    if (changed) {
      await host.onSaved?.(c, user, job, t.kind, t.run, rows.rows);
      await audit(c, user, cur ? 'update' : 'create', job.id,
        `${cur ? 'Changed' : 'Started'} the ${label(t.kind, t.run)}: ${rows.rows.length} part${rows.rows.length === 1 ? '' : 's'}${cur && next.rev !== cur.rev ? `, now Rev ${next.rev}` : ''}`);
    }
    const saved = (await current(c, job.id, t.kind, t.run))!;
    return c.json({ diagram: shape(saved, await names(c, [saved.pdf_by, saved.sent_by, saved.reviewed_by, saved.updated_by])) });
  });

  /** Removes the last run's tool string if it never had a PDF, so runs stay numbered 1, 2, 3… */
  r.delete('/:jobId/toolstring/:run', async (c) => {
    const ctx = await context(c);
    if ('error' in ctx) return ctx.error;
    if (!ctx.canEdit) return c.json({ error: 'You may not edit this job’s diagrams' }, 403);
    const run = Number(c.req.param('run'));
    const cur = await current(c, ctx.job.id, 'toolstring', run);
    if (!cur) return c.json({ error: 'No such run' }, 404);
    if (cur.pdf_rev != null) return c.json({ error: `Run ${run} has a filed PDF, so it stays. Change it instead.` }, 409);
    if (await current(c, ctx.job.id, 'toolstring', run + 1)) return c.json({ error: `Remove Run ${run + 1} first` }, 409);
    await host.db(c).prepare('DELETE FROM job_diagrams WHERE id = ?').bind(cur.id).run();
    await audit(c, ctx.user, 'remove', ctx.job.id, `Removed the ${label('toolstring', run)}`);
    return c.json({ ok: true });
  });

  /** Builds the PDF. The first PDF of a revision, and every reviewed one, is filed through host.storePdf. */
  const makePdf = async (c: Context, user: DiagramsUser, job: DiagramsJob, d: DiagramRow) => {
    const who = await names(c, [d.sent_by, d.updated_by, d.reviewed_by]);
    const reviewed = d.status === 'reviewed' && d.reviewed_by && d.reviewed_at ? { by: who(d.reviewed_by)!, at: d.reviewed_at } : null;
    const prepBy = d.sent_by ?? d.updated_by;
    const bytes = diagramPdf({
      kind: d.kind, run_no: d.run_no, rev: d.rev, rows: JSON.parse(d.items) as Row[],
      job: { client: host.client?.(job) ?? 'Saudi Aramco', well: job.well, field: job.field, rig: job.rig, unit_number: job.unit_number, date: job.start_date, ticket_no: job.ticket_no, drss_no: job.drss_no },
      prepared: prepBy ? { by: who(prepBy)!, at: d.sent_at ?? d.updated_at } : null,
      reviewed,
      totalDepth: d.kind === 'toolstring' ? { md: job.target_depth_ft, tvd: null } : undefined,
    });
    const form = FORM[d.kind];
    const name = `${form.code} ${d.kind === 'rigup' ? 'Rig Up' : `Run ${d.run_no} String`} ${job.ticket_no ?? job.id.slice(0, 8)} Rev ${d.rev}${reviewed ? ' reviewed' : ''}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
    let filed: string | null = null, fileError: string | undefined;
    if (host.storePdf && (d.pdf_rev !== d.rev || reviewed)) {
      const stored = await host.storePdf(c, user, job, { name, bytes, note: `${form.title} ${form.code} Rev ${d.rev}${reviewed ? ', reviewed' : ''}` });
      if (stored.error) fileError = stored.error; else filed = name;
    }
    return { bytes, name, filed, fileError };
  };

  r.post('/:jobId/:kind/:run/:action', async (c) => {
    const ctx = await context(c);
    if ('error' in ctx) return ctx.error;
    const { user, job } = ctx, db = host.db(c);
    const t = target(c);
    if ('error' in t) return c.json({ error: t.error }, 400);
    const action = c.req.param('action');
    const cur = await current(c, job.id, t.kind, t.run);
    if (!cur) return c.json({ error: 'Save the diagram first' }, 404);
    const at = new Date().toISOString();
    const empty = !(JSON.parse(cur.items) as Row[]).length;

    if (action === 'pdf') {
      const pdf = await makePdf(c, user, job, cur);
      await db.prepare('UPDATE job_diagrams SET pdf_rev = ?, pdf_at = ?, pdf_by = ? WHERE id = ?').bind(cur.rev, at, user.username, cur.id).run();
      if (pdf.filed) await audit(c, user, 'pdf', job.id, `Made the PDF of the ${label(t.kind, t.run)}, Rev ${cur.rev}`);
      return new Response(pdf.bytes as unknown as BodyInit, {
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${pdf.name}"`, 'X-Filed': pdf.filed ? 'yes' : 'no', ...(pdf.fileError ? { 'X-File-Error': encodeURIComponent(pdf.fileError) } : {}) },
      });
    }
    if (action === 'send') {
      if (!ctx.canEdit) return c.json({ error: 'You may not edit this job’s diagrams' }, 403);
      if (empty) return c.json({ error: 'Add the parts first' }, 409);
      if (cur.status !== 'draft') return c.json({ ok: true });
      await db.prepare(`UPDATE job_diagrams SET status = 'sent', sent_by = ?, sent_at = ? WHERE id = ?`).bind(user.username, at, cur.id).run();
      await audit(c, user, 'send', job.id, `Sent the ${label(t.kind, t.run)} Rev ${cur.rev} for review`);
      return c.json({ ok: true });
    }
    if (action === 'review') {
      if (!ctx.canReview) return c.json({ error: 'You may not review this job’s diagrams' }, 403);
      if (empty) return c.json({ error: 'The diagram has no parts' }, 409);
      if (cur.status === 'reviewed') return c.json({ ok: true });
      const done: DiagramRow = { ...cur, status: 'reviewed', reviewed_by: user.username, reviewed_at: at, sent_by: cur.sent_by ?? cur.updated_by, sent_at: cur.sent_at ?? cur.updated_at };
      const pdf = await makePdf(c, user, job, done);
      await db.prepare(`UPDATE job_diagrams SET status = 'reviewed', reviewed_by = ?, reviewed_at = ?, sent_by = ?, sent_at = ?, pdf_rev = ?, pdf_at = ?, pdf_by = ? WHERE id = ?`)
        .bind(user.username, at, done.sent_by, done.sent_at, cur.rev, at, user.username, cur.id).run();
      await audit(c, user, 'approve', job.id, `Reviewed the ${label(t.kind, t.run)} Rev ${cur.rev}`);
      return c.json({ ok: true, pdf: pdf.filed, pdf_error: pdf.fileError });
    }
    if (action === 'reopen') {
      if (!ctx.canReview) return c.json({ error: 'Only a reviewer reopens a reviewed diagram' }, 403);
      await db.prepare(`UPDATE job_diagrams SET status = 'draft' WHERE id = ?`).bind(cur.id).run();
      await audit(c, user, 'reopen', job.id, `Sent the ${label(t.kind, t.run)} Rev ${cur.rev} back to draft`);
      return c.json({ ok: true });
    }
    return c.json({ error: 'Unknown action' }, 400);
  });

  return r;
}
