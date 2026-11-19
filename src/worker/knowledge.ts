import { Hono, type Context } from 'hono';
import { checkUpload } from '../shared/attachments';
import { GLOBAL, checkDoc, fileKey, folderName, nextQaf, type KbFile, type KnowledgeDoc } from '../shared/knowledge';
import {
  DEFAULT_NUMBERING, DEFAULT_PERIODS, REV_STATUS, addMonths, checkNumbering, checkPeriods, isStaff, mayAct, mayOpen, mayRetire, nextRevision, numberPrefix,
  editableProblem, submitProblems, type Controller, type FlowAction, type Numbering, type Periods, type RevStatus, type Revision,
} from '../shared/knowledgeControl';
import type Anthropic from '@anthropic-ai/sdk';
import { costMicroUsd, limitCheck } from '../shared/ai';
import { analysisPrompt, answerSchema, cleanSuggestion, extractText } from '../shared/docAnalysis';
import { cleanDigest, digestPrompt, digestSchema, type Digest } from '../shared/docDigest';
import { ADD_TYPES, type AddType } from '../shared/knowledge';
import { COPY_COMPANIES, DEFAULT_COPY_SETTINGS, checkCopySettings, copyKind, copyNumber, copySettingsOf, makeCompanyCopy, makeCompanySlides, mayHaveCopies, type CopyCompany, type CopySettings } from '../shared/companyCopy';

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
import { unzip } from '../shared/xlsxRead';
import { client, fallbackFor, loadSettings, serviceError, spend } from './ai';
import type { AppBindings, AuthedUser, Env } from './env';
import { copyId, stampPdf, stampText } from './stamp';

// Knowledge Hub with document control (S21, 6z.13, 6z.14), after the NESR Document Control app.
// Readers see published revisions only and download the current file, stamped with a copy number. Editors (the
// tab's edit right) add documents and prepare revisions; reviewers and approvers (Knowledge Hub → Settings, or any
// admin) move them through review and approval. The published revision stays live until the next one is approved.
// Admins and approvers retire with a reason. Nothing is deleted; every step and every download is in the audit log.

type C = Context<AppBindings>;
const now = () => new Date().toISOString();
const riyadhToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string, type = 'knowledge_docs') =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, type, id, summary.slice(0, 1000));

async function controller(env: Env, user: AuthedUser): Promise<Controller> {
  const row = await env.DB.prepare('SELECT can_review, can_approve FROM knowledge_people WHERE username = ?').bind(user.username).first<{ can_review: number; can_approve: number }>();
  const admin = user.role === 'admin';
  // an admin is reviewer and approver until Settings says otherwise; admins can still act on any step
  return { username: user.username, admin, editor: !!user.menus.knowledge_hub?.edit, reviewer: row ? !!row.can_review : admin, approver: row ? !!row.can_approve : admin };
}

/** Reviewer and approver flags as stored, with admins counted as both until a choice is saved for them. */
const PERSON_FLAGS = `u.username, u.full_name, u.role, coalesce(k.can_review, CASE WHEN u.role = 'admin' THEN 1 ELSE 0 END) AS can_review,
  coalesce(k.can_approve, CASE WHEN u.role = 'admin' THEN 1 ELSE 0 END) AS can_approve`;

/** What Claude reads of a file: PDFs and pictures as they are, Office and text files as their text, else the name only. */
async function contentPart(name: string, type: string, bytes: Uint8Array): Promise<{ error: string } | { part: Anthropic.Beta.BetaContentBlockParam; source: string }> {
  const b64 = () => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  if (type === 'application/pdf') {
    if (bytes.length > 20 * 1024 * 1024) return { error: 'This PDF is too large for AI (over 20 MB).' };
    return { part: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64() } }, source: name };
  }
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type)) {
    if (bytes.length > 5 * 1024 * 1024) return { error: 'This picture is too large for AI (over 5 MB).' };
    return { part: { type: 'image', source: { type: 'base64', media_type: type as 'image/png', data: b64() } }, source: name };
  }
  const text = await extractText(name, bytes);
  return { part: { type: 'text', text: text ? `<document name="${name}">\n${text}\n</document>` : `Only the file name is available ("${name}"); the file's contents couldn't be read. Use what the name shows and leave the rest "".` }, source: name };
}

/** Numbering with every section's prefix (settings saved before SWI and Forms existed keep their defaults). */
async function numberingOf(env: Env): Promise<Numbering> {
  const n = await setting<Numbering>(env, 'numbering', DEFAULT_NUMBERING);
  return { ...n, prefix: { ...DEFAULT_NUMBERING.prefix, ...n.prefix } };
}

async function setting<T>(env: Env, key: string, fallback: T): Promise<T> {
  const r = await env.DB.prepare('SELECT value FROM knowledge_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return r ? { ...fallback, ...(JSON.parse(r.value) as T) } : fallback;
}

/** Countries an entry may be filed under: every active country for admins, the person's own for everyone else. */
async function placesFor(env: Env, user: AuthedUser): Promise<string[]> {
  if (user.role !== 'admin') return [...new Set([...(user.allCountries ?? user.countries)])];
  const { results } = await env.DB.prepare('SELECT DISTINCT country FROM wg_units WHERE wg_active = 1 ORDER BY country').all<{ country: string }>();
  return [...new Set([...results.map((r) => r.country), ...(user.allCountries ?? user.countries)])].sort();
}

const COLS = `d.id, d.section, d.country, d.company, d.client, d.doc_type, d.category, d.title, d.summary, d.key_action, d.failure_types, d.published_on, d.rilr_ref, d.source_ref,
  d.duplicate_of, d.lesson_of_week_from, d.doc_no, d.revision, d.review_due, d.retired_at, d.retire_reason, d.origin, d.author, d.expires_on, d.is_form, d.published_at, d.approved_by,
  d.copy_of, d.copy_of_revision,
  coalesce(ra.full_name, d.approved_by) AS approved_by_name`;
const FROM = 'FROM knowledge_docs d LEFT JOIN user_roles ra ON ra.username = d.approved_by';
const FILE_COLS = 'f.id, f.doc_id, f.kind, f.revision, f.file_name, f.content_type, f.size_bytes, f.uploaded_at, f.superseded_at, f.change_note, coalesce(r.full_name, f.uploaded_by) AS uploaded_by_name';
const REV_COLS = `v.*, coalesce(r1.full_name, v.reviewer) AS reviewer_name, coalesce(r2.full_name, v.approver) AS approver_name,
  coalesce(r3.full_name, v.submitted_by) AS submitted_by_name, coalesce(r4.full_name, v.created_by) AS created_by_name`;
const REV_FROM = `FROM knowledge_revisions v LEFT JOIN user_roles r1 ON r1.username = v.reviewer LEFT JOIN user_roles r2 ON r2.username = v.approver
  LEFT JOIN user_roles r3 ON r3.username = v.submitted_by LEFT JOIN user_roles r4 ON r4.username = v.created_by`;
const toDoc = (r: Record<string, unknown>) => ({ ...r, failure_types: JSON.parse(String(r.failure_types ?? '[]')) }) as KnowledgeDoc;

async function find(env: Env, id: string) {
  const r = await env.DB.prepare(`SELECT ${COLS} ${FROM} WHERE d.id = ?`).bind(id).first<Record<string, unknown>>();
  return r ? toDoc(r) : null;
}
const openRev = (env: Env, docId: string) =>
  env.DB.prepare(`SELECT * FROM knowledge_revisions WHERE doc_id = ? AND status IN ('draft','review','approval')`).bind(docId).first<Revision>();

/** May this person see the entry at all? Readers: published and not retired. Staff: everything not retired. */
const visible = (p: Controller, d: KnowledgeDoc) => (d.retired_at ? p.admin || p.approver : isStaff(p) || !!d.published_at);

/** Email to whoever must act next. Silent when email isn't set up or the person has no address. */
async function notify(c: C, username: string | null, subject: string, text: string) {
  if (!username || !c.env.EMAIL) return;
  const r = await c.env.DB.prepare(`SELECT coalesce(u.email, e.contact_email) AS email FROM user_roles u LEFT JOIN employees e ON lower(e.wg_username) = lower(u.username) AND e.active = 1
    WHERE u.username = ? AND u.active = 1`).bind(username).first<{ email: string | null }>();
  if (!r?.email) return;
  const link = `${c.env.APP_URL ?? 'https://slkops.nesrapp.com'}/knowledge?view=queue`;
  const send = c.env.EMAIL.send({ to: r.email, from: { email: c.env.EMAIL_FROM ?? 'slkops@nesrapp.com', name: 'SLK Operations Hub' }, subject,
    text: `${text}\n\nOpen the Knowledge Hub queue: ${link}`, html: `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p><p><a href="${link}">Open the Knowledge Hub queue</a></p>` })
    .catch((e: Error) => console.error('knowledge email not sent', e.message));
  try { c.executionCtx.waitUntil(send); } catch { await send; }
}

export const knowledge = new Hono<AppBindings>();

// ---- the library ------------------------------------------------------------------------------------------------

knowledge.get('/', async (c) => {
  const user = c.get('user');
  const p = await controller(c.env, user);
  const staff = isStaff(p);
  const [docs, files, opens, places, clients, numbering, people, queue] = await Promise.all([
    c.env.DB.prepare(`SELECT ${COLS} ${FROM} WHERE d.retired_at IS NULL ${staff ? '' : 'AND d.published_at IS NOT NULL'} ORDER BY d.published_on DESC, d.title LIMIT 5000`).all<Record<string, unknown>>(),
    // the live revision's files
    c.env.DB.prepare(`SELECT ${FILE_COLS} FROM knowledge_files f JOIN knowledge_docs d ON d.id = f.doc_id AND f.revision = d.revision AND d.published_at IS NOT NULL
      LEFT JOIN user_roles r ON r.username = f.uploaded_by WHERE f.superseded_at IS NULL`).all<KbFile & { doc_id: string; kind: 'published' | 'source' }>(),
    staff ? c.env.DB.prepare(`SELECT id, doc_id, revision, status, reviewer, approver, sent_back_reason FROM knowledge_revisions WHERE status IN ('draft','review','approval')`).all<{ id: string; doc_id: string; revision: number; status: 'draft' | 'review' | 'approval'; reviewer: string | null; approver: string | null; sent_back_reason: string | null }>() : null,
    placesFor(c.env, user),
    c.env.DB.prepare(`SELECT DISTINCT client FROM knowledge_docs WHERE client IS NOT NULL UNION SELECT DISTINCT location FROM jobs WHERE location IS NOT NULL AND deleted_at IS NULL ORDER BY 1 LIMIT 500`).all<{ client: string }>(),
    setting<Numbering>(c.env, 'numbering', DEFAULT_NUMBERING),
    staff ? c.env.DB.prepare(`SELECT * FROM (SELECT ${PERSON_FLAGS} FROM user_roles u LEFT JOIN knowledge_people k ON k.username = u.username WHERE u.active = 1)
      WHERE can_review = 1 OR can_approve = 1 ORDER BY full_name`).all<{ username: string; full_name: string; can_review: number; can_approve: number }>() : null,
    staff ? c.env.DB.prepare(`SELECT count(*) AS n FROM knowledge_revisions WHERE (status = 'review' AND reviewer = ?1) OR (status = 'approval' AND approver = ?1)
      OR (status = 'draft' AND sent_back_reason IS NOT NULL AND (submitted_by = ?1 OR created_by = ?1))`).bind(user.username).first<{ n: number }>() : null,
  ]);
  // support files (pictures, videos, documents) of every entry, listed under it (6z.19)
  const support = await c.env.DB.prepare(`SELECT id, entity_id, file_name, content_type, size_bytes FROM attachments
    WHERE entity_type = 'knowledge' AND deleted_at IS NULL ORDER BY uploaded_at`).all<{ id: string; entity_id: string; file_name: string; content_type: string; size_bytes: number }>();
  const supportOf = new Map<string, { id: string; file_name: string; content_type: string; size_bytes: number }[]>();
  for (const s of support.results) supportOf.set(s.entity_id, [...(supportOf.get(s.entity_id) ?? []), { id: s.id, file_name: s.file_name, content_type: s.content_type, size_bytes: s.size_bytes }]);
  const live = new Map<string, { file?: KbFile; source?: KbFile }>();
  for (const f of files.results) {
    const e = live.get(f.doc_id) ?? {};
    if (f.kind === 'published') e.file = f; else e.source = f;
    live.set(f.doc_id, e);
  }
  const open = new Map((opens?.results ?? []).map((o) => [o.doc_id, o]));
  return c.json({
    docs: docs.results.map((r) => {
      const d = toDoc(r);
      const l = live.get(d.id);
      const showSource = !!l?.source && mayOpen(p, { kind: 'source', revision: d.revision }, { revision: d.revision, published_at: d.published_at ?? null, is_form: d.is_form }, 'approved');
      const o = open.get(d.id);
      return { ...d, file: l?.file ?? null, source: showSource ? l!.source : null, support: supportOf.get(d.id) ?? [], open: o ? { id: o.id, revision: o.revision, status: o.status, reviewer: o.reviewer, approver: o.approver, sent_back_reason: o.sent_back_reason } : null };
    }),
    canEdit: p.editor || p.admin, isAdmin: p.admin, me: p, places, clients: clients.results.map((r) => r.client), numbering,
    people: people?.results ?? [], queueCount: queue?.n ?? 0,
  });
});

/** Revisions waiting on someone: mine to review or approve, mine sent back, and (admins, editors) everything open. */
knowledge.get('/queue', async (c) => {
  const user = c.get('user');
  const p = await controller(c.env, user);
  if (!isStaff(p)) return c.json({ error: 'The queue is for editors, reviewers and approvers' }, 403);
  const { results } = await c.env.DB.prepare(`SELECT ${REV_COLS}, d.title, d.doc_no, d.section, d.country, d.company, d.client, d.revision AS live_revision, d.published_at,
    d.copy_of, d.copy_of_revision, s.doc_no AS copy_of_no,
    (SELECT count(*) FROM knowledge_files f WHERE f.doc_id = v.doc_id AND f.revision = v.revision AND f.kind = 'published' AND f.superseded_at IS NULL) AS has_pdf
    ${REV_FROM} JOIN knowledge_docs d ON d.id = v.doc_id LEFT JOIN knowledge_docs s ON s.id = d.copy_of WHERE v.status IN ('draft','review','approval') AND d.retired_at IS NULL ORDER BY coalesce(v.submitted_at, v.created_at) DESC`).all<Revision & Record<string, unknown>>();
  const mine = (u: unknown) => typeof u === 'string' && u.toLowerCase() === user.username.toLowerCase();
  const rows = results.filter((r) => p.admin || p.editor || mine(r.reviewer) || mine(r.approver) || mine(r.submitted_by) || mine(r.created_by))
    .map((r) => ({ ...r, mayReview: mayAct(p, r, 'review'), mayApprove: mayAct(p, r, 'approve'), maySendBack: mayAct(p, r, 'send_back'), maySubmit: mayAct(p, r, 'submit'),
      waitingOnMe: (r.status === 'review' && mine(r.reviewer)) || (r.status === 'approval' && mine(r.approver)) || (r.status === 'draft' && !!r.sent_back_reason && (mine(r.submitted_by) || mine(r.created_by))) }));
  return c.json({ rows });
});

/** The document register (API Q2 style): every entry with its status, revision, dates and prior revisions. */
knowledge.get('/register', async (c) => {
  const p = await controller(c.env, c.get('user'));
  if (!isStaff(p)) return c.json({ error: 'The register is for editors, reviewers and approvers' }, 403);
  const [docs, opens, prior] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT ${COLS} ${FROM} ${p.admin || p.approver ? '' : 'WHERE d.retired_at IS NULL'} ORDER BY d.section, d.country, d.doc_no`),
    c.env.DB.prepare(`SELECT doc_id, revision, status FROM knowledge_revisions WHERE status IN ('draft','review','approval')`),
    c.env.DB.prepare(`SELECT doc_id, count(*) AS n FROM knowledge_revisions WHERE status = 'superseded' GROUP BY doc_id`),
  ]);
  const open = new Map((opens.results as { doc_id: string; revision: number; status: RevStatus }[]).map((o) => [o.doc_id, o]));
  const n = new Map((prior.results as { doc_id: string; n: number }[]).map((o) => [o.doc_id, o.n]));
  return c.json({ rows: (docs.results as Record<string, unknown>[]).map((r) => { const d = toDoc(r); return { doc: d, open: open.get(d.id) ?? null, priorRevisions: n.get(d.id) ?? 0 }; }) });
});

/**
 * The QAF number record (6z.27): every form number in use, retired ones included (a number is never given twice),
 * what file each holds and its fingerprint, so a form already uploaded is spotted before it is added again.
 */
knowledge.get('/forms-record', async (c) => {
  const p = await controller(c.env, c.get('user'));
  const [docs, files] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT d.id, d.doc_no, d.title, d.country, d.company, d.revision, d.published_at, d.retired_at,
      (SELECT status FROM knowledge_revisions v WHERE v.doc_id = d.id AND v.status IN ('draft','review','approval') LIMIT 1) AS open_status
      FROM knowledge_docs d WHERE d.section = 'form' ORDER BY d.doc_no`),
    c.env.DB.prepare(`SELECT f.doc_id, f.kind, f.file_name, f.sha256, f.revision, f.uploaded_at, coalesce(u.full_name, f.uploaded_by) AS uploaded_by_name
      FROM knowledge_files f JOIN knowledge_docs d ON d.id = f.doc_id LEFT JOIN user_roles u ON u.username = f.uploaded_by
      WHERE d.section = 'form' AND f.superseded_at IS NULL ORDER BY f.uploaded_at`),
  ]);
  type Row = { id: string; doc_no: string | null; title: string; country: string; company: string | null; revision: number; published_at: string | null; retired_at: string | null; open_status: RevStatus | null };
  type F = { doc_id: string; kind: string; file_name: string; sha256: string; revision: number; uploaded_at: string; uploaded_by_name: string };
  const byDoc = new Map<string, F[]>();
  for (const f of files.results as F[]) byDoc.set(f.doc_id, [...(byDoc.get(f.doc_id) ?? []), f]);
  const rows = (docs.results as Row[]).map((d) => ({
    ...d,
    // readers see the numbers and titles; who uploaded what is for document control staff
    files: (isStaff(p) ? byDoc.get(d.id) ?? [] : []).map(({ doc_id: _, ...f }) => f),
    hashes: (byDoc.get(d.id) ?? []).map((f) => f.sha256),
  }));
  return c.json({ next: nextQaf(rows.map((r) => r.doc_no)), rows });
});

/** Retired entries (the archive), for admins and approvers. */
knowledge.get('/archive', async (c) => {
  const p = await controller(c.env, c.get('user'));
  if (!mayRetire(p)) return c.json({ error: 'The archive is for admins and approvers' }, 403);
  const { results } = await c.env.DB.prepare(`SELECT ${COLS}, d.retired_by, coalesce(rr.full_name, d.retired_by) AS retired_by_name ${FROM} LEFT JOIN user_roles rr ON rr.username = d.retired_by
    WHERE d.retired_at IS NOT NULL ORDER BY d.retired_at DESC`).all<Record<string, unknown>>();
  return c.json({ docs: results.map(toDoc) });
});

// ---- settings: numbering, periods, reviewers and approvers (admins) -----------------------------------------------

knowledge.get('/settings', async (c) => {
  const p = await controller(c.env, c.get('user'));
  if (!isStaff(p)) return c.json({ error: 'Settings are for editors, reviewers and approvers' }, 403);
  const [numbering, periods, people] = await Promise.all([
    numberingOf(c.env), setting<Periods>(c.env, 'periods', DEFAULT_PERIODS),
    c.env.DB.prepare(`SELECT ${PERSON_FLAGS} FROM user_roles u LEFT JOIN knowledge_people k ON k.username = u.username WHERE u.active = 1 ORDER BY u.full_name`).all(),
  ]);
  return c.json({ numbering, periods, people: people.results, isAdmin: p.admin, copies: await copySettings(c.env) });
});

// ---- company copies of global NESR SOPs and SWIs (6z.21) ----------------------------------------------------------

const copySettings = async (env: Env): Promise<CopySettings> => copySettingsOf(await setting<CopySettings>(env, 'copies', DEFAULT_COPY_SETTINGS));
const isCopyCompany = (v: unknown): v is CopyCompany => (COPY_COMPANIES as readonly unknown[]).includes(v);
const putSetting = (env: Env, user: AuthedUser, key: string, v: unknown) => env.DB.prepare(`INSERT INTO knowledge_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(key, JSON.stringify(v), user.username, now());

/** Company names, number prefixes, colours, cover approvers and word list. Admins. */
knowledge.put('/settings/copies', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Only an admin changes the company templates' }, 403);
  const r = checkCopySettings(await c.req.json().catch(() => ({})), await copySettings(c.env));
  if ('error' in r) return c.json({ error: r.error }, 400);
  await c.env.DB.batch([putSetting(c.env, user, 'copies', r.value),
    audit(c.env, user, 'settings', 'copies', `Company templates: ${COPY_COMPANIES.map((co) => `${co} ${r.value.companies[co].prefix} #${r.value.companies[co].colour}`).join(', ')}`, 'knowledge_settings')]);
  return c.json({ ok: true, copies: r.value });
});

/** The company's template (raw body, X-File-Name): one of its own SOPs in Word, or with ?kind=slides one of its presentations for lesson copies (6z.27). Admins. */
knowledge.post('/settings/copies/:company/template', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Only an admin changes the company templates' }, 403);
  if (!c.env.FILES) return c.json({ error: 'File storage isn’t set up on the server yet (R2 bucket slkops-files).' }, 503);
  const co = c.req.param('company');
  if (!isCopyCompany(co)) return c.json({ error: 'Pick SAPESCO or Gulf Energy' }, 400);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const ok = checkUpload(decodeURIComponent(c.req.header('x-file-name') ?? ''), bytes.length);
  if ('error' in ok) return c.json({ error: ok.error }, 400);
  const slides = c.req.query('kind') === 'slides';
  const parts = await unzip(bytes).catch(() => null);
  if (slides) {
    if (!/\.pptx$/i.test(ok.name)) return c.json({ error: 'The slides template is a PowerPoint file (.pptx): one of the company’s own presentations' }, 400);
    if (!parts?.has('ppt/presentation.xml')) return c.json({ error: 'This file is not a PowerPoint presentation' }, 400);
    if (![...parts.keys()].some((k) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(k))) return c.json({ error: 'This presentation has no slide layouts to use' }, 400);
  } else {
    if (!/\.docx$/i.test(ok.name)) return c.json({ error: 'The template is a Word file (.docx): one of the company’s own SOPs' }, 400);
    if (!parts?.has('word/document.xml')) return c.json({ error: 'This file is not a Word document' }, 400);
    if (![...parts.keys()].some((k) => /^word\/(header|footer)\d*\.xml$/.test(k))) return c.json({ error: 'This Word file has no header or footer to take the logo from' }, 400);
  }
  const key = `knowledge/Templates/${folderName(co)}/${crypto.randomUUID().slice(0, 8)} ${ok.name}`;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: ok.type }, customMetadata: { name: ok.name, by: user.username } });
  const s = await copySettings(c.env);
  const file = { key, file_name: ok.name, uploaded_at: now(), uploaded_by: user.username };
  s.companies[co] = { ...s.companies[co], ...(slides ? { slides: file } : { template: file }) };
  await c.env.DB.batch([putSetting(c.env, user, 'copies', s), audit(c.env, user, 'upload', 'copies', `${co} ${slides ? 'slides ' : ''}template “${ok.name}”`, 'knowledge_settings')]);
  return c.json({ ok: true, copies: s });
});

knowledge.get('/settings/copies/:company/template', async (c) => {
  const p = await controller(c.env, c.get('user'));
  if (!isStaff(p)) return c.json({ error: 'Templates are for editors, reviewers and approvers' }, 403);
  const co = c.req.param('company');
  const slides = c.req.query('kind') === 'slides';
  const cs = isCopyCompany(co) ? (await copySettings(c.env)).companies[co] : null;
  const t = cs ? (slides ? cs.slides : cs.template) : null;
  if (!t || !c.env.FILES) return c.json({ error: 'No template yet' }, 404);
  const obj = await c.env.FILES.get(t.key);
  if (!obj) return c.json({ error: 'The template is missing from storage' }, 404);
  return fileResponse(obj.body, slides ? PPTX : DOCX, t.file_name, false);
});

/** "30th December 2022", as NESR covers print dates. */
const printedDate = (iso: string | null | undefined) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return undefined;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`), n = d.getUTCDate();
  const th = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${th} ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
};

/**
 * Makes (or makes again) the SAPESCO and Gulf Energy Word copies of a global NESR SOP or SWI from its editable
 * Word file. Each copy is a draft revision with the same number as the NESR revision, holding only the Word file;
 * an admin saves it as PDF, uploads it and sends it for review. A copy already in review or approval is left alone.
 */
knowledge.post('/:id/copies', async (c) => {
  const user = c.get('user');
  const p = await controller(c.env, user);
  if (!p.admin && !p.editor) return c.json({ error: 'Your role cannot make company copies' }, 403);
  if (!c.env.FILES) return c.json({ error: 'File storage isn’t set up on the server yet (R2 bucket slkops-files).' }, 503);
  const d = await find(c.env, c.req.param('id'));
  if (!d || d.retired_at) return c.json({ error: 'Document not found' }, 404);
  if (!mayHaveCopies(d)) return c.json({ error: 'Only global NESR SOPs and SWIs, and lessons, get SAPESCO and Gulf Energy copies' }, 400);
  // lessons are copied as slides (6z.27), SOPs and SWIs as Word files
  const slides = copyKind(d) === 'slides';
  const ext = slides ? 'pptx' : 'docx', fileType = slides ? PPTX : DOCX, what = slides ? 'PowerPoint file (.pptx)' : 'Word file (.docx)';
  // JSON { companies }, or (6z.23) the NESR Word file itself as the body with ?companies=…, for when the stored
  // editable version is not a .docx (an older .doc, for example): used only to make the copies, the NESR record is untouched
  const given = /octet-stream/.test(c.req.header('content-type') ?? '');
  const b = given ? { companies: (c.req.query('companies') ?? '').split(',').filter(Boolean) } : await c.req.json().catch(() => ({})) as { companies?: unknown };
  const companies = (Array.isArray(b.companies) && b.companies.length ? b.companies : [...COPY_COMPANIES]).filter(isCopyCompany);
  if (!companies.length) return c.json({ error: 'Pick SAPESCO, Gulf Energy or both' }, 400);
  let srcBytes: Uint8Array;
  let src: { file_name: string; revision: number; revision_date: string | null; expires_on: string | null };
  if (given) {
    const name = decodeURIComponent(c.req.header('x-file-name') ?? '');
    if (!new RegExp(`\\.${ext}$`, 'i').test(name)) return c.json({ error: slides ? 'Pick the slides saved as .pptx' : 'Pick the Word file saved as .docx' }, 400);
    srcBytes = new Uint8Array(await c.req.arrayBuffer());
    const ok = checkUpload(name, srcBytes.length);
    if ('error' in ok) return c.json({ error: ok.error }, 400);
    const rev = await c.env.DB.prepare(`SELECT revision, revision_date, expires_on FROM knowledge_revisions WHERE doc_id = ? AND status IN ('draft','review','approval','approved') ORDER BY revision DESC LIMIT 1`)
      .bind(d.id).first<{ revision: number; revision_date: string | null; expires_on: string | null }>();
    src = { file_name: ok.name, revision: rev?.revision ?? d.revision, revision_date: rev?.revision_date ?? null, expires_on: rev?.expires_on ?? null };
  } else {
    // the NESR file: the newest revision's editable version (for a lesson, its document file when that is the .pptx)
    const f = await c.env.DB.prepare(`SELECT f.file_name, f.r2_key, f.revision, v.revision_date, v.expires_on FROM knowledge_files f
      JOIN knowledge_revisions v ON v.doc_id = f.doc_id AND v.revision = f.revision
      WHERE f.doc_id = ? AND f.superseded_at IS NULL AND v.status IN ('draft','review','approval','approved') AND (f.kind = 'source' OR (? AND lower(f.file_name) LIKE '%.pptx'))
      ORDER BY f.revision DESC, f.kind = 'source' DESC LIMIT 1`)
      .bind(d.id, slides ? 1 : 0).first<{ file_name: string; r2_key: string; revision: number; revision_date: string | null; expires_on: string | null }>();
    if (!f) return c.json({ error: `Company copies are made from the NESR ${what}. Add it as the editable version, or pick the .${ext} file here.`, needsWord: true }, 400);
    if (!new RegExp(`\\.${ext}$`, 'i').test(f.file_name)) {
      return c.json({ error: slides
        ? `The editable version is “${f.file_name}”, not a .pptx PowerPoint file. Open it in PowerPoint, Save As › PowerPoint Presentation (.pptx), and pick that file here.`
        : `The editable version is “${f.file_name}”, not a .docx Word file. Open it in Word, Save As › Word Document (.docx), and pick that file here.`, needsWord: true }, 400);
    }
    const obj = await c.env.FILES.get(f.r2_key);
    if (!obj) return c.json({ error: `The NESR file is missing from storage. Pick the .${ext} file here.`, needsWord: true }, 404);
    srcBytes = new Uint8Array(await obj.arrayBuffer());
    src = f;
  }
  const [settings, periods] = await Promise.all([copySettings(c.env), setting<Periods>(c.env, 'periods', DEFAULT_PERIODS)]);
  const pad = (n: number) => String(n).padStart(2, '0');
  const made: { company: CopyCompany; id: string; doc_no: string | null; revision: number; changes: { label: string; n: number }[]; leftovers: string[] }[] = [];
  const skipped: { company: CopyCompany; reason: string }[] = [];

  for (const co of companies) {
    const t = settings.companies[co];
    const tpl = slides ? t.slides : t.template;
    if (!tpl) { skipped.push({ company: co, reason: `Add the ${co} ${slides ? 'slides ' : ''}template in Knowledge Hub › Doc Control › Settings first` }); continue; }
    const tplObj = await c.env.FILES.get(tpl.key);
    if (!tplObj) { skipped.push({ company: co, reason: `The ${co} template is missing from storage: upload it again in Settings` }); continue; }
    const copyNo = copyNumber(d.doc_no, t.prefix);
    const existing = await c.env.DB.prepare('SELECT id, revision, published_at FROM knowledge_docs WHERE copy_of = ? AND company = ? AND retired_at IS NULL')
      .bind(d.id, co).first<{ id: string; revision: number; published_at: string | null }>();
    const open = existing ? await openRev(c.env, existing.id) : null;
    if (open && open.status !== 'draft') { skipped.push({ company: co, reason: `The ${co} copy is ${REV_STATUS[open.status].toLowerCase()}: finish or send it back first` }); continue; }
    if (existing && !open && existing.published_at && src.revision <= existing.revision) { skipped.push({ company: co, reason: `The ${co} copy is already at Rev ${existing.revision}` }); continue; }

    let out;
    try {
      const tb = new Uint8Array(await tplObj.arrayBuffer());
      out = slides
        ? await makeCompanySlides(srcBytes, tb, { t, nesrColours: settings.nesrColours })
        : await makeCompanyCopy(srcBytes, tb, { t, nesrColours: settings.nesrColours, copyNo, revision: pad(src.revision), date: printedDate(src.revision_date) });
    } catch (e) { skipped.push({ company: co, reason: (e as Error).message }); continue; }

    const docId = existing?.id ?? crypto.randomUUID();
    const rev = open?.revision ?? src.revision;
    const revDate = src.revision_date ?? riyadhToday();
    const expires = src.expires_on && src.expires_on > revDate ? src.expires_on : addMonths(revDate, periods.expiryMonths);
    const stmts: D1PreparedStatement[] = [];
    if (!existing) {
      stmts.push(c.env.DB.prepare(`INSERT INTO knowledge_docs (id, section, country, company, client, doc_type, category, title, summary, key_action, failure_types, doc_no, created_by, revision,
          origin, author, is_form, expires_on, copy_of, copy_of_revision) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(docId, d.section, d.country, co, d.doc_type ?? null, d.category, d.title, d.summary, d.key_action ?? null, JSON.stringify(d.failure_types ?? []), copyNo, user.username, rev,
          d.origin ?? 'internal', d.author ?? null, d.is_form ?? 0, expires, d.id, src.revision));
    } else stmts.push(c.env.DB.prepare('UPDATE knowledge_docs SET copy_of_revision = ?, title = ? WHERE id = ?').bind(src.revision, d.title, docId));
    if (!open) {
      stmts.push(c.env.DB.prepare(`INSERT INTO knowledge_revisions (id, doc_id, revision, status, change_note, author, revision_date, expires_on, created_by) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), docId, rev, `${co} copy of ${d.doc_no ?? d.title} Rev ${src.revision}`, d.author ?? null, revDate, expires, user.username));
    }
    const fileId = crypto.randomUUID();
    const name = `${copyNo ?? co} ${d.title} Rev ${pad(rev)}.${ext}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').slice(0, 180);
    const key = fileKey({ section: d.section, country: d.country, company: co, client: null, doc_no: copyNo, title: d.title }, rev, 'source', fileId, name);
    const bytes = out.bytes;
    const sha = hex(await crypto.subtle.digest('SHA-256', bytes));
    stmts.push(
      c.env.DB.prepare(`UPDATE knowledge_files SET superseded_at = ? WHERE doc_id = ? AND kind = 'source' AND revision = ? AND superseded_at IS NULL`).bind(now(), docId, rev),
      c.env.DB.prepare('INSERT INTO knowledge_files (id, doc_id, kind, revision, file_name, content_type, size_bytes, sha256, r2_key, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(fileId, docId, 'source', rev, name, fileType, bytes.length, sha, key, user.username),
      audit(c.env, user, existing ? 'revise' : 'create', docId, `${co} ${slides ? 'slides' : 'Word'} copy ${copyNo ?? d.title} Rev ${rev} made from ${d.doc_no ?? d.title} Rev ${src.revision}: ${out.changes.map((x) => `${x.label} ×${x.n}`).join(', ')}${out.leftovers.length ? `. Still says NESR in ${out.leftovers.length} places` : ''}`),
    );
    try {
      await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: fileType }, customMetadata: { name, by: user.username, sha256: sha, doc: docId, revision: String(rev), from: d.id } });
      await c.env.DB.batch(stmts);
    } catch (e) {
      const m = (e as Error).message;
      skipped.push({ company: co, reason: /UNIQUE/.test(m) ? (/doc_no/.test(m) ? `Another document already has the number ${copyNo}` : `Rev ${rev} of the ${co} copy was used before`) : m });
      continue;
    }
    made.push({ company: co, id: docId, doc_no: copyNo, revision: rev, changes: out.changes, leftovers: out.leftovers });
  }
  return c.json({ made, skipped }, made.length ? 201 : 200);
});

/**
 * Document analysis for Add document (raw body, X-File-Name, ?section=): Claude reads the file and suggests every
 * field; the person checks them before saving. Uses the AI settings and monthly budget of Administration → AI Agent.
 */
knowledge.post('/analyse', async (c) => {
  const user = c.get('user');
  const p = await controller(c.env, user);
  if (!p.admin && !p.editor) return c.json({ error: 'Your role cannot add documents' }, 403);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'Document analysis isn’t set up: the Anthropic API key is missing on the server. Fill in the fields by hand.' }, 503);
  const s = await loadSettings(c.env);
  const u = await spend(c.env, user.username, 'document');
  const blocked = limitCheck(s, u.monthMicro, u.sentToday);
  if (blocked) return c.json({ error: `${blocked.replace('The AI Agent is switched off', 'AI is switched off')} Fill in the fields by hand.` }, 429);
  const name = decodeURIComponent(c.req.header('x-file-name') ?? '');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const ok = checkUpload(name, bytes.length);
  if ('error' in ok) return c.json({ error: ok.error }, 400);
  const section = c.req.query('section') ?? 'lesson';
  const fallback = (section in ADD_TYPES ? section : 'lesson_learnt') as AddType;
  const [places, clients, cats] = await Promise.all([
    placesFor(c.env, user),
    c.env.DB.prepare(`SELECT DISTINCT client FROM knowledge_docs WHERE client IS NOT NULL UNION SELECT DISTINCT location FROM jobs WHERE location IS NOT NULL AND deleted_at IS NULL ORDER BY 1 LIMIT 200`).all<{ client: string }>(),
    c.env.DB.prepare('SELECT DISTINCT category FROM knowledge_docs WHERE category IS NOT NULL ORDER BY 1 LIMIT 80').all<{ category: string }>(),
  ]);
  const read = await contentPart(ok.name, ok.type, bytes);
  if ('error' in read) return c.json({ error: `${read.error} Fill in the fields by hand.` }, 400);
  const part = read.part;
  const prompt = analysisPrompt({ fileName: ok.name, places, clients: clients.results.map((r) => r.client), categories: cats.results.map((r) => r.category), today: riyadhToday(), sectionHint: section });
  let micro = 0, inTok = 0, outTok = 0;
  try {
    const res = await client(c.env).beta.messages.create({
      model: s.model, max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: answerSchema(places) } },
      messages: [{ role: 'user', content: [part, { type: 'text', text: prompt }] }],
      ...fallbackFor(s.model),
    });
    micro = costMicroUsd(res.usage, s.model);
    inTok = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    outTok = res.usage.output_tokens;
    if (res.stop_reason === 'refusal') return c.json({ error: 'The AI declined to read this document. Fill in the fields by hand.' }, 422);
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return c.json({ error: 'The AI answer couldn’t be read. Fill in the fields by hand.' }, 502); }
    return c.json({ suggestion: cleanSuggestion(raw, places, fallback), model: s.model });
  } catch (e) {
    const msg = serviceError(e);
    if (!msg) throw e;
    return c.json({ error: `${msg} You can fill in the fields by hand.` }, 502);
  } finally {
    await c.env.DB.prepare('INSERT INTO ai_usage (id, username, feature, model, input_tokens, output_tokens, cost_microusd) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), user.username, 'document', s.model, inTok, outTok, micro).run();
  }
});

/** Document control dashboard: totals, work in progress, reviews and expiry coming up, downloads. Staff only. */
knowledge.get('/dashboard', async (c) => {
  const p = await controller(c.env, c.get('user'));
  if (!isStaff(p)) return c.json({ error: 'The dashboard is for editors, reviewers and approvers' }, 403);
  const since = new Date(Date.now() - 180 * 864e5).toISOString();
  const [docs, opens, approvers, downloads, top] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT ${COLS} ${FROM} WHERE d.retired_at IS NULL`),
    c.env.DB.prepare(`SELECT v.doc_id, v.revision, v.status, v.submitted_at, coalesce(r1.full_name, v.reviewer) AS reviewer_name, coalesce(r2.full_name, v.approver) AS approver_name
      FROM knowledge_revisions v LEFT JOIN user_roles r1 ON r1.username = v.reviewer LEFT JOIN user_roles r2 ON r2.username = v.approver WHERE v.status IN ('draft','review','approval')`),
    c.env.DB.prepare(`SELECT coalesce(r.full_name, v.approver) AS label, count(*) AS n FROM knowledge_revisions v LEFT JOIN user_roles r ON r.username = v.approver
      WHERE v.status IN ('approved','superseded') AND v.approved_at IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 12`),
    c.env.DB.prepare(`SELECT substr(occurred_at, 1, 7) AS month, count(*) AS n FROM audit_log WHERE entity_type = 'knowledge_docs' AND action = 'download' AND occurred_at >= ? GROUP BY 1 ORDER BY 1`).bind(since),
    c.env.DB.prepare(`SELECT a.entity_id AS id, d.title, d.doc_no, count(*) AS n FROM audit_log a JOIN knowledge_docs d ON d.id = a.entity_id
      WHERE a.entity_type = 'knowledge_docs' AND a.action = 'download' AND a.occurred_at >= ? GROUP BY a.entity_id ORDER BY n DESC LIMIT 10`).bind(since),
  ]);
  return c.json({ docs: (docs.results as Record<string, unknown>[]).map(toDoc), open: opens.results, approvers: approvers.results, downloads: downloads.results, top: top.results });
});

knowledge.put('/settings', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Only an admin changes document control settings' }, 403);
  const b = await c.req.json().catch(() => ({}));
  const n = checkNumbering(b.numbering);
  if ('error' in n) return c.json({ error: n.error }, 400);
  const per = checkPeriods(b.periods);
  if ('error' in per) return c.json({ error: per.error }, 400);
  const put = (key: string, v: unknown) => c.env.DB.prepare(`INSERT INTO knowledge_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(key, JSON.stringify(v), user.username, now());
  await c.env.DB.batch([put('numbering', n.value), put('periods', per.value),
    audit(c.env, user, 'settings', 'knowledge', `Numbering ${n.value.mode}, ${Object.values(n.value.prefix).join('/')} ${n.value.digits} digits; review ${per.value.reviewMonths} months, expiry ${per.value.expiryMonths} months`, 'knowledge_settings')]);
  return c.json({ ok: true });
});

knowledge.put('/people/:username', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Only an admin chooses reviewers and approvers' }, 403);
  const who = c.req.param('username');
  const b = await c.req.json().catch(() => ({}));
  const exists = await c.env.DB.prepare('SELECT full_name FROM user_roles WHERE username = ?').bind(who).first<{ full_name: string }>();
  if (!exists) return c.json({ error: 'Person not found' }, 404);
  const review = b.can_review ? 1 : 0, approve = b.can_approve ? 1 : 0;
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO knowledge_people (username, can_review, can_approve, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (username) DO UPDATE SET can_review = excluded.can_review, can_approve = excluded.can_approve, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(who, review, approve, user.username, now()),
    audit(c.env, user, 'roles', who, `${exists.full_name}: ${review ? 'reviewer' : 'not a reviewer'}, ${approve ? 'approver' : 'not an approver'}`, 'knowledge_people'),
  ]);
  return c.json({ ok: true });
});

// ---- slides and mind map (6z.16) --------------------------------------------------------------------------------

type DigestRow = { slides: string; mindmap: string; source: string; model: string; made_at: string; revision: number };
const digestOut = (r: DigestRow) => ({ digest: { slides: JSON.parse(r.slides), mindmap: JSON.parse(r.mindmap) } as Digest, revision: r.revision, source: r.source, made_at: r.made_at });

/** The saved slides and mind map of the published revision, or none yet. */
knowledge.get('/:id/digest', async (c) => {
  const p = await controller(c.env, c.get('user'));
  const d = await find(c.env, c.req.param('id'));
  if (!d || !visible(p, d)) return c.json({ error: 'Document not found' }, 404);
  if (!d.published_at) return c.json({ digest: null, reason: 'The mind map is made once the document is published.' });
  const r = await c.env.DB.prepare('SELECT slides, mindmap, source, model, made_at, revision FROM knowledge_digests WHERE doc_id = ? AND revision = ?').bind(d.id, d.revision).first<DigestRow>();
  return c.json(r ? digestOut(r) : { digest: null, mayMake: true });
});

/**
 * Makes the slides and mind map of the published revision from its document file (or, for a lesson without a
 * file, from its summary) and saves them. Anyone with the tab may make the first one; staff may make it again.
 */
knowledge.post('/:id/digest', async (c) => {
  const user = c.get('user');
  const p = await controller(c.env, user);
  const d = await find(c.env, c.req.param('id'));
  if (!d || !visible(p, d)) return c.json({ error: 'Document not found' }, 404);
  if (!d.published_at) return c.json({ error: 'The mind map is made once the document is published.' }, 400);
  const again = (await c.req.json().catch(() => ({}))).again === true;
  const have = await c.env.DB.prepare('SELECT slides, mindmap, source, model, made_at, revision FROM knowledge_digests WHERE doc_id = ? AND revision = ?').bind(d.id, d.revision).first<DigestRow>();
  if (have && !(again && isStaff(p))) return c.json(digestOut(have));
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'Mind maps need AI, which isn’t set up on the server (the Anthropic API key is missing).' }, 503);
  const s = await loadSettings(c.env);
  const u = await spend(c.env, user.username, 'document');
  const blocked = limitCheck(s, u.monthMicro, u.sentToday);
  if (blocked) return c.json({ error: blocked.replace('The AI Agent is switched off', 'AI is switched off') }, 429);
  // the document file of the published revision; a lesson may have only its written summary
  const f = await c.env.DB.prepare(`SELECT file_name, content_type, r2_key FROM knowledge_files WHERE doc_id = ? AND revision = ? AND kind = 'published' AND superseded_at IS NULL`)
    .bind(d.id, d.revision).first<{ file_name: string; content_type: string; r2_key: string }>();
  let part: Anthropic.Beta.BetaContentBlockParam;
  let source: string;
  if (f && c.env.FILES) {
    const obj = await c.env.FILES.get(f.r2_key);
    if (!obj) return c.json({ error: 'The document file is missing from storage' }, 404);
    const read = await contentPart(f.file_name, f.content_type, new Uint8Array(await obj.arrayBuffer()));
    if ('error' in read) return c.json({ error: read.error }, 400);
    ({ part, source } = read);
  } else if (d.summary || d.key_action) {
    part = { type: 'text', text: `<document name="${d.title}">\n${[d.summary, d.key_action && `Key action: ${d.key_action}`, d.failure_types.length ? `Failure types: ${d.failure_types.join(', ')}` : ''].filter(Boolean).join('\n\n')}\n</document>` };
    source = 'the written summary';
  } else return c.json({ error: 'This document has no file or summary to make slides from.' }, 400);
  const kind = d.section === 'lesson' ? ADD_TYPES[(d.doc_type ?? 'lesson_learnt') as AddType].label.toLowerCase() : ADD_TYPES[d.section as Exclude<typeof d.section, 'lesson'>].label;
  let micro = 0, inTok = 0, outTok = 0;
  try {
    const res = await client(c.env).beta.messages.create({
      model: s.model, max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: digestSchema() } },
      messages: [{ role: 'user', content: [part, { type: 'text', text: digestPrompt({ title: d.title, docNo: d.doc_no, kind, summary: d.summary, keyAction: d.key_action }) }] }],
      ...fallbackFor(s.model),
    });
    micro = costMicroUsd(res.usage, s.model);
    inTok = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    outTok = res.usage.output_tokens;
    if (res.stop_reason === 'refusal') return c.json({ error: 'The AI declined to read this document.' }, 422);
    if (res.stop_reason === 'max_tokens') return c.json({ error: 'The document is too long for one pass. Try again, or ask an admin.' }, 422);
    let raw: unknown;
    try { raw = JSON.parse(res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('')); }
    catch { return c.json({ error: 'The AI answer couldn’t be read. Try again.' }, 502); }
    const dg = cleanDigest(raw, d.title);
    if (!dg.mindmap.branches.length) return c.json({ error: 'The AI couldn’t make the mind map from this document. Try again.' }, 502);
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO knowledge_digests (doc_id, revision, slides, mindmap, source, model, made_by) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (doc_id, revision) DO UPDATE SET slides = excluded.slides, mindmap = excluded.mindmap, source = excluded.source, model = excluded.model, made_by = excluded.made_by, made_at = excluded.made_at`)
        .bind(d.id, d.revision, JSON.stringify(dg.slides), JSON.stringify(dg.mindmap), source, s.model, user.username),
      audit(c.env, user, 'digest', d.id, `Mind map for ${d.doc_no ?? d.title} Rev ${d.revision} from ${source}`),
    ]);
    return c.json({ digest: dg, revision: d.revision, source, made_at: now() });
  } catch (e) {
    const msg = serviceError(e);
    if (!msg) throw e;
    return c.json({ error: msg }, 502);
  } finally {
    await c.env.DB.prepare('INSERT INTO ai_usage (id, username, feature, model, input_tokens, output_tokens, cost_microusd) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), user.username, 'document', s.model, inTok, outTok, micro).run();
  }
});

// ---- reference manuals: an uncontrolled folder library ------------------------------------------------------------

knowledge.get('/manuals', async (c) => {
  const [folders, files] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, name FROM knowledge_manual_folders ORDER BY name'),
    c.env.DB.prepare(`SELECT f.id, f.folder_id, f.file_name, f.content_type, f.size_bytes, f.uploaded_at, coalesce(r.full_name, f.uploaded_by) AS uploaded_by_name
      FROM knowledge_manual_files f LEFT JOIN user_roles r ON r.username = f.uploaded_by WHERE f.removed_at IS NULL ORDER BY f.file_name`),
  ]);
  return c.json({ folders: folders.results, files: files.results, canManage: c.get('user').role === 'admin', storage: !!c.env.FILES });
});

knowledge.post('/manuals/folders', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Only an admin manages the manuals' }, 403);
  const b = await c.req.json().catch(() => ({}));
  const name = folderName(String(b.name ?? ''));
  if (!String(b.name ?? '').trim()) return c.json({ error: 'Name the folder' }, 400);
  const id = typeof b.id === 'string' ? b.id : null;
  try {
    if (id) await c.env.DB.batch([c.env.DB.prepare('UPDATE knowledge_manual_folders SET name = ? WHERE id = ?').bind(name, id), audit(c.env, user, 'rename', id, `Manuals folder renamed ${name}`, 'knowledge_manual_folders')]);
    else {
      const nid = crypto.randomUUID();
      await c.env.DB.batch([c.env.DB.prepare('INSERT INTO knowledge_manual_folders (id, name, created_by) VALUES (?, ?, ?)').bind(nid, name, user.username), audit(c.env, user, 'create', nid, `Manuals folder ${name}`, 'knowledge_manual_folders')]);
    }
  } catch (e) {
    if (/UNIQUE/.test((e as Error).message)) return c.json({ error: 'A folder already has that name' }, 400);
    throw e;
  }
  return c.json({ ok: true });
});

knowledge.post('/manuals/folders/:id/remove', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Only an admin manages the manuals' }, 403);
  const n = await c.env.DB.prepare('SELECT count(*) AS n FROM knowledge_manual_files WHERE folder_id = ? AND removed_at IS NULL').bind(c.req.param('id')).first<{ n: number }>();
  if (n?.n) return c.json({ error: 'Remove the files in the folder first' }, 400);
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM knowledge_manual_folders WHERE id = ?').bind(c.req.param('id')), audit(c.env, user, 'remove', c.req.param('id'), 'Manuals folder removed', 'knowledge_manual_folders')]);
  return c.json({ ok: true });
});

knowledge.post('/manuals/folders/:id/files', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Only an admin manages the manuals' }, 403);
  if (!c.env.FILES) return c.json({ error: 'File storage isn’t set up on the server yet (R2 bucket slkops-files).' }, 503);
  const folder = await c.env.DB.prepare('SELECT id, name FROM knowledge_manual_folders WHERE id = ?').bind(c.req.param('id')).first<{ id: string; name: string }>();
  if (!folder) return c.json({ error: 'Folder not found' }, 404);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const ok = checkUpload(decodeURIComponent(c.req.header('x-file-name') ?? ''), bytes.length);
  if ('error' in ok) return c.json({ error: ok.error }, 400);
  const id = crypto.randomUUID();
  const key = `knowledge/Reference manuals/${folderName(folder.name)}/${id.slice(0, 8)} ${ok.name}`;
  const sha = hex(await crypto.subtle.digest('SHA-256', bytes));
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: ok.type }, customMetadata: { name: ok.name, by: user.username, sha256: sha } });
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO knowledge_manual_files (id, folder_id, file_name, content_type, size_bytes, sha256, r2_key, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, folder.id, ok.name, ok.type, bytes.length, sha, key, user.username),
    audit(c.env, user, 'upload', id, `Manual “${ok.name}” in ${folder.name}`, 'knowledge_manual_files'),
  ]);
  return c.json({ id }, 201);
});

knowledge.post('/manuals/files/:id/remove', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Only an admin manages the manuals' }, 403);
  const f = await c.env.DB.prepare('SELECT file_name FROM knowledge_manual_files WHERE id = ? AND removed_at IS NULL').bind(c.req.param('id')).first<{ file_name: string }>();
  if (!f) return c.json({ error: 'File not found' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE knowledge_manual_files SET removed_at = ?, removed_by = ? WHERE id = ?').bind(now(), user.username, c.req.param('id')),
    audit(c.env, user, 'remove', c.req.param('id'), `Manual “${f.file_name}” removed`, 'knowledge_manual_files'),
  ]);
  return c.json({ ok: true });
});

knowledge.get('/manuals/files/:id', async (c) => {
  const f = await c.env.DB.prepare('SELECT * FROM knowledge_manual_files WHERE id = ? AND removed_at IS NULL').bind(c.req.param('id')).first<{ id: string; file_name: string; content_type: string; r2_key: string }>();
  if (!f) return c.json({ error: 'File not found' }, 404);
  if (!c.env.FILES) return c.json({ error: 'File storage isn’t set up on the server yet' }, 503);
  const obj = await c.env.FILES.get(f.r2_key);
  if (!obj) return c.json({ error: 'The file is missing from storage' }, 404);
  await audit(c.env, c.get('user'), 'download', f.id, `Manual “${f.file_name}” (reference only, uncontrolled)`, 'knowledge_manual_files').run();
  return fileResponse(obj.body, f.content_type, f.file_name, c.req.query('inline') === '1');
});

// ---- one entry ----------------------------------------------------------------------------------------------------

knowledge.get('/:id', async (c) => {
  const p = await controller(c.env, c.get('user'));
  const d = await find(c.env, c.req.param('id'));
  return d && visible(p, d) ? c.json(d) : c.json({ error: 'Document not found' }, 404);
});

const uniqueError = (e: unknown) => {
  const m = (e as Error).message;
  if (!/UNIQUE/.test(m)) throw e;
  return /doc_no/.test(m) ? 'Another document already has that number' : 'Another document already uses that link';
};

/** The document already holding a number, named, so a duplicate is refused with who has it (6z.27). */
async function numberTaken(env: Env, docNo: string | null, notId?: string): Promise<string | null> {
  if (!docNo) return null;
  const r = await env.DB.prepare('SELECT title, retired_at FROM knowledge_docs WHERE doc_no = ? AND id IS NOT ? LIMIT 1').bind(docNo, notId ?? null).first<{ title: string; retired_at: string | null }>();
  return r ? `${docNo} is already used by “${r.title}”${r.retired_at ? ' (retired)' : ''}` : null;
}

/** The next free QAF number for a new form. */
async function nextFormNumber(env: Env): Promise<string> {
  const { results } = await env.DB.prepare(`SELECT doc_no FROM knowledge_docs WHERE doc_no GLOB 'QAF[0-9]*'`).all<{ doc_no: string }>();
  return nextQaf(results.map((r) => r.doc_no));
}

/** Revision details a person types: what changed, author, revision date, expiry. */
function revisionFields(b: Record<string, unknown>, periods: Periods) {
  const t = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const date = t(b.revision_date, 10) || riyadhToday();
  const expires = t(b.expires_on, 10) || addMonths(date, periods.expiryMonths);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return { error: 'Dates must be dates' } as const;
  if (expires <= date) return { error: 'The expiry must be after the revision date' } as const;
  return { change_note: t(b.change_note, 500) || null, author: t(b.author, 120) || null, revision_date: date, expires_on: expires } as const;
}

/** A new entry starts as a draft revision (Rev 0, or the number typed when an existing document is brought in). */
knowledge.post('/', async (c) => {
  const user = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const r = checkDoc(b, [...(await placesFor(c.env, user))]);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const d = r.doc;
  const [numbering, periods] = await Promise.all([setting<Numbering>(c.env, 'numbering', DEFAULT_NUMBERING), setting<Periods>(c.env, 'periods', DEFAULT_PERIODS)]);
  // a form keeps the QAF number it was given, or takes the next free one
  if (d.section === 'form' && !d.doc_no) d.doc_no = await nextFormNumber(c.env);
  if (numbering.mode === 'manual' && !d.doc_no) return c.json({ error: 'Numbering is manual: type the document number' }, 400);
  const taken = await numberTaken(c.env, d.doc_no);
  if (taken) return c.json({ error: taken }, 400);
  if (d.duplicate_of && !(await find(c.env, d.duplicate_of))) return c.json({ error: 'The original document was not found' }, 400);
  const rev = nextRevision(0, false, b.revision);
  if ('error' in rev) return c.json({ error: rev.error }, 400);
  const rf = revisionFields(b, periods);
  if ('error' in rf) return c.json({ error: rf.error }, 400);
  const id = crypto.randomUUID();
  const prefix = numberPrefix(d, numbering);
  const fmt = `%s-%0${numbering.digits}d`;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO knowledge_docs (id, section, country, company, client, doc_type, category, title, summary, key_action, failure_types, published_on, rilr_ref, source_ref,
          duplicate_of, doc_no, review_due, created_by, revision, origin, author, is_form, expires_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          coalesce(?, printf(?, ?, 1 + (SELECT coalesce(max(CAST(substr(doc_no, length(?) + 2) AS INTEGER)), 0) FROM knowledge_docs WHERE doc_no LIKE ? || '-%' AND substr(doc_no, length(?) + 2) GLOB '[0-9][0-9]*'))),
          ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, d.section, d.country, d.company, d.client, d.doc_type, d.category, d.title, d.summary, d.key_action, JSON.stringify(d.failure_types), d.published_on, d.rilr_ref, d.source_ref,
          d.duplicate_of, d.doc_no, fmt, prefix, prefix, prefix, prefix, d.review_due, user.username, rev.value, d.origin, d.author ?? rf.author, d.is_form, rf.expires_on),
      c.env.DB.prepare(`INSERT INTO knowledge_revisions (id, doc_id, revision, status, change_note, author, revision_date, expires_on, created_by) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), id, rev.value, rf.change_note ?? 'First issue', d.author ?? rf.author, rf.revision_date, rf.expires_on, user.username),
      audit(c.env, user, 'create', id, `${d.section} ${d.country}: ${d.title} (draft Rev ${rev.value})`),
    ]);
  } catch (e) {
    return c.json({ error: uniqueError(e) }, 400);
  }
  const row = await c.env.DB.prepare('SELECT doc_no FROM knowledge_docs WHERE id = ?').bind(id).first<{ doc_no: string }>();
  return c.json({ id, doc_no: row?.doc_no, revision: rev.value }, 201);
});

knowledge.put('/:id', async (c) => {
  const user = c.get('user');
  const p = await controller(c.env, user);
  const cur = await find(c.env, c.req.param('id'));
  if (!cur || cur.retired_at) return c.json({ error: 'Document not found' }, 404);
  const places = await placesFor(c.env, user);
  const r = checkDoc(await c.req.json().catch(() => ({})), [...places, cur.country]);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const d = r.doc;
  if (d.country !== cur.country && !(d.country === GLOBAL || places.includes(d.country))) return c.json({ error: 'Pick one of your countries or Global' }, 400);
  if (d.duplicate_of === cur.id) return c.json({ error: 'A document can’t repeat itself' }, 400);
  if (d.duplicate_of && !(await find(c.env, d.duplicate_of))) return c.json({ error: 'The original document was not found' }, 400);
  const taken = d.doc_no && d.doc_no !== cur.doc_no ? await numberTaken(c.env, d.doc_no, cur.id) : null;
  if (taken) return c.json({ error: taken }, 400);
  // the review date follows approval; only an admin may move it by hand
  const review = p.admin ? d.review_due : cur.review_due;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE knowledge_docs SET section = ?, country = ?, company = ?, client = ?, doc_type = ?, category = ?, title = ?, summary = ?, key_action = ?, failure_types = ?,
          published_on = ?, rilr_ref = ?, source_ref = ?, duplicate_of = ?, doc_no = coalesce(?, doc_no), review_due = ?, origin = ?, author = ?, is_form = ? WHERE id = ?`)
        .bind(d.section, d.country, d.company, d.client, d.doc_type, d.category, d.title, d.summary, d.key_action, JSON.stringify(d.failure_types),
          d.published_on, d.rilr_ref, d.source_ref, d.duplicate_of, d.doc_no, review, d.origin, d.author, d.is_form, cur.id),
      audit(c.env, user, 'update', cur.id, d.title === cur.title ? d.title : `${cur.title} → ${d.title}`),
    ]);
  } catch (e) {
    return c.json({ error: uniqueError(e) }, 400);
  }
  return c.json({ ok: true });
});

/** Makes this the lesson of the week from today (Riyadh date). */
knowledge.post('/:id/lesson-of-week', async (c) => {
  const user = c.get('user');
  const cur = await find(c.env, c.req.param('id'));
  if (!cur || cur.retired_at || !cur.published_at) return c.json({ error: 'Only a published lesson can be the lesson of the week' }, 400);
  if (cur.section !== 'lesson') return c.json({ error: 'Only lessons can be the lesson of the week' }, 400);
  if (cur.duplicate_of) return c.json({ error: 'Pick the original, not a duplicate' }, 400);
  const today = riyadhToday();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE knowledge_docs SET lesson_of_week_from = ? WHERE id = ?').bind(today, cur.id),
    audit(c.env, user, 'lesson_of_week', cur.id, `${cur.title} from ${today}`),
  ]);
  return c.json({ ok: true, from: today });
});

/** Retire (reason required) moves the entry to the archive; restore brings it back. Admins and approvers. */
knowledge.post('/:id/:action{retire|restore}', async (c) => {
  const user = c.get('user');
  const p = await controller(c.env, user);
  if (!mayRetire(p)) return c.json({ error: 'Only an admin or an approver can retire a document' }, 403);
  const cur = await find(c.env, c.req.param('id'));
  if (!cur) return c.json({ error: 'Document not found' }, 404);
  const retire = c.req.param('action') === 'retire';
  const reason = String((await c.req.json().catch(() => ({}))).reason ?? '').trim().slice(0, 300);
  if (retire && !reason) return c.json({ error: 'Say why it is retired' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE knowledge_docs SET retired_at = ?, retired_by = ?, retire_reason = ? WHERE id = ?').bind(retire ? now() : null, retire ? user.username : null, retire ? reason : null, cur.id),
    audit(c.env, user, retire ? 'retire' : 'restore', cur.id, `${cur.doc_no ?? ''} ${cur.title}${retire ? `: ${reason}` : ''}`),
  ]);
  return c.json({ ok: true });
});

// ---- revisions and the review / approval workflow -----------------------------------------------------------------

/** Every revision with its files, showing only the files this person may open. */
knowledge.get('/:id/revisions', async (c) => {
  const p = await controller(c.env, c.get('user'));
  const d = await find(c.env, c.req.param('id'));
  if (!d || !visible(p, d)) return c.json({ error: 'Document not found' }, 404);
  const [revs, files] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT ${REV_COLS} ${REV_FROM} WHERE v.doc_id = ? AND v.status <> 'discarded' ORDER BY v.revision DESC`).bind(d.id),
    c.env.DB.prepare(`SELECT ${FILE_COLS} FROM knowledge_files f LEFT JOIN user_roles r ON r.username = f.uploaded_by WHERE f.doc_id = ? AND f.superseded_at IS NULL ORDER BY f.uploaded_at DESC`).bind(d.id),
  ]);
  const list = (revs.results as Revision[]).filter((v) => isStaff(p) || v.status === 'approved');
  const fl = files.results as (KbFile & { kind: 'published' | 'source' })[];
  return c.json({
    me: p, live: d.published_at ? d.revision : null, storage: !!c.env.FILES, mayRetire: mayRetire(p),
    revisions: list.map((v) => ({
      ...v, files: fl.filter((f) => f.revision === v.revision && mayOpen(p, f, { revision: d.revision, published_at: d.published_at ?? null, is_form: d.is_form }, v.status)),
      can: Object.fromEntries((['submit', 'review', 'approve', 'send_back', 'discard', 'edit_files'] as FlowAction[]).map((a) => [a, mayAct(p, v, a)])),
      problems: v.status === 'draft' ? submitProblems(d, fl.filter((f) => f.revision === v.revision)) : [],
    })),
  });
});

/** Starts the next revision of a published document. The live one stays published until this one is approved. */
knowledge.post('/:id/revisions', async (c) => {
  const user = c.get('user');
  const p = await controller(c.env, user);
  if (!p.admin && !p.editor) return c.json({ error: 'Your role cannot start a revision' }, 403);
  const d = await find(c.env, c.req.param('id'));
  if (!d || d.retired_at) return c.json({ error: 'Document not found' }, 404);
  if (!d.published_at) return c.json({ error: 'The first revision is still being worked on' }, 400);
  const open = await openRev(c.env, d.id);
  if (open) return c.json({ error: `Rev ${open.revision} is already ${REV_STATUS[open.status].toLowerCase()}` }, 409);
  const b = await c.req.json().catch(() => ({}));
  if (!String(b.change_note ?? '').trim()) return c.json({ error: 'Say what changes in this revision' }, 400);
  const rev = nextRevision(d.revision, true, b.revision);
  if ('error' in rev) return c.json({ error: rev.error }, 400);
  const rf = revisionFields(b, await setting<Periods>(c.env, 'periods', DEFAULT_PERIODS));
  if ('error' in rf) return c.json({ error: rf.error }, 400);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO knowledge_revisions (id, doc_id, revision, status, change_note, author, revision_date, expires_on, created_by) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`)
        .bind(id, d.id, rev.value, rf.change_note, rf.author ?? d.author ?? null, rf.revision_date, rf.expires_on, user.username),
      audit(c.env, user, 'revise', d.id, `Rev ${rev.value} of ${d.doc_no ?? d.title} started: ${rf.change_note}`),
    ]);
  } catch (e) {
    if (/UNIQUE/.test((e as Error).message)) return c.json({ error: `Rev ${rev.value} was used before. Pick a higher number` }, 400);
    throw e;
  }
  return c.json({ id, revision: rev.value }, 201);
});

async function revisionFor(c: C) {
  const d = await find(c.env, c.req.param('id') ?? '');
  if (!d || d.retired_at) return null;
  const v = await c.env.DB.prepare('SELECT * FROM knowledge_revisions WHERE doc_id = ? AND revision = ?').bind(d.id, Number(c.req.param('rev'))).first<Revision>();
  return v ? { d, v } : null;
}

/** Corrects a draft's details. */
knowledge.put('/:id/revisions/:rev{[0-9]+}', async (c) => {
  const user = c.get('user');
  const p = await controller(c.env, user);
  const x = await revisionFor(c);
  if (!x) return c.json({ error: 'Revision not found' }, 404);
  if (!mayAct(p, x.v, 'edit_files')) return c.json({ error: 'Only a draft can be changed' }, 400);
  const rf = revisionFields(await c.req.json().catch(() => ({})), await setting<Periods>(c.env, 'periods', DEFAULT_PERIODS));
  if ('error' in rf) return c.json({ error: rf.error }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE knowledge_revisions SET change_note = ?, author = ?, revision_date = ?, expires_on = ? WHERE id = ?').bind(rf.change_note, rf.author, rf.revision_date, rf.expires_on, x.v.id),
    audit(c.env, user, 'update', x.d.id, `Rev ${x.v.revision} details of ${x.d.doc_no ?? x.d.title}`),
  ]);
  return c.json({ ok: true });
});

const names = async (env: Env, u: string) => (await env.DB.prepare('SELECT full_name FROM user_roles WHERE username = ?').bind(u).first<{ full_name: string }>())?.full_name ?? u;
async function holds(env: Env, username: string, right: 'can_review' | 'can_approve') {
  const r = await env.DB.prepare(`SELECT ${PERSON_FLAGS} FROM user_roles u LEFT JOIN knowledge_people k ON k.username = u.username WHERE u.username = ? AND u.active = 1`)
    .bind(username).first<{ can_review: number; can_approve: number }>();
  return !!r && r[right] === 1;
}

knowledge.post('/:id/revisions/:rev{[0-9]+}/:step{submit|review|approve|send-back|discard}', async (c) => {
  const user = c.get('user');
  const p = await controller(c.env, user);
  const x = await revisionFor(c);
  if (!x) return c.json({ error: 'Revision not found' }, 404);
  const { d, v } = x;
  const step = c.req.param('step');
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const text = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, 500) : '');
  const label = `${d.doc_no ?? d.title} Rev ${v.revision}`;
  const t = now();

  if (step === 'submit') {
    if (!mayAct(p, v, 'submit')) return c.json({ error: 'Only a draft can be sent for review, by an editor' }, 403);
    const files = (await c.env.DB.prepare('SELECT kind, content_type, file_name FROM knowledge_files WHERE doc_id = ? AND revision = ? AND superseded_at IS NULL').bind(d.id, v.revision).all<{ kind: 'published' | 'source'; content_type: string; file_name: string }>()).results;
    const problems = submitProblems(d, files);
    if (problems.length) return c.json({ error: problems.join('. ') }, 400);
    const reviewer = text('reviewer');
    if (!reviewer) return c.json({ error: 'Pick the reviewer' }, 400);
    if (!(await holds(c.env, reviewer, 'can_review'))) return c.json({ error: 'That person is not a reviewer' }, 400);
    if (reviewer.toLowerCase() === user.username.toLowerCase() && !p.admin) return c.json({ error: 'Someone else must review it' }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE knowledge_revisions SET status = 'review', reviewer = ?, submitted_by = ?, submitted_at = ?, approver = NULL, sent_back_reason = NULL WHERE id = ?`).bind(reviewer, user.username, t, v.id),
      audit(c.env, user, 'submit', d.id, `${label} sent for review to ${await names(c.env, reviewer)}${text('comment') ? `: ${text('comment')}` : ''}`),
    ]);
    await notify(c, reviewer, `Review: ${label} ${d.title}`, `${user.fullName} sent ${label} "${d.title}" for your review.`);
  } else if (step === 'review') {
    if (!mayAct(p, v, 'review')) return c.json({ error: 'Only the reviewer can pass this review, and not on their own submission' }, 403);
    const approver = text('approver');
    if (!approver) return c.json({ error: 'Pick the approver' }, 400);
    if (!(await holds(c.env, approver, 'can_approve'))) return c.json({ error: 'That person is not an approver' }, 400);
    if (approver.toLowerCase() === (v.submitted_by ?? '').toLowerCase() && !p.admin) return c.json({ error: 'The approver must be someone other than whoever submitted it' }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE knowledge_revisions SET status = 'approval', reviewed_at = ?, review_comment = ?, approver = ?, reviewer = coalesce(reviewer, ?) WHERE id = ?`).bind(t, text('comment') || null, approver, user.username, v.id),
      audit(c.env, user, 'review', d.id, `${label} reviewed, sent to ${await names(c.env, approver)} for approval${text('comment') ? `: ${text('comment')}` : ''}`),
    ]);
    await notify(c, approver, `Approval: ${label} ${d.title}`, `${user.fullName} reviewed ${label} "${d.title}". It is waiting for your approval.`);
  } else if (step === 'approve') {
    if (!mayAct(p, v, 'approve')) return c.json({ error: 'Only the approver can publish this, and not on their own submission' }, 403);
    const periods = await setting<Periods>(c.env, 'periods', DEFAULT_PERIODS);
    const today = riyadhToday();
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE knowledge_revisions SET status = 'superseded' WHERE doc_id = ? AND status = 'approved'`).bind(d.id),
      c.env.DB.prepare(`UPDATE knowledge_revisions SET status = 'approved', approved_at = ?, approve_comment = ?, approver = coalesce(approver, ?) WHERE id = ?`).bind(t, text('comment') || null, user.username, v.id),
      c.env.DB.prepare(`UPDATE knowledge_docs SET revision = ?, published_at = ?, approved_by = ?, review_due = ?, expires_on = ?, author = coalesce(?, author), published_on = coalesce(?, published_on) WHERE id = ?`)
        .bind(v.revision, t, user.username, addMonths(today, periods.reviewMonths), v.expires_on ?? addMonths(v.revision_date ?? today, periods.expiryMonths), v.author, v.revision_date, d.id),
      audit(c.env, user, 'approve', d.id, `${label} approved and published${d.published_at ? `, Rev ${d.revision} superseded` : ''}${text('comment') ? `: ${text('comment')}` : ''}`),
    ]);
    await notify(c, v.submitted_by, `Published: ${label} ${d.title}`, `${user.fullName} approved ${label} "${d.title}". It is now the published revision.`);
  } else if (step === 'send-back') {
    if (!mayAct(p, v, 'send_back')) return c.json({ error: 'Only the reviewer or approver holding it can send it back' }, 403);
    const reason = text('reason');
    if (!reason) return c.json({ error: 'Say why it is sent back' }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE knowledge_revisions SET status = 'draft', sent_back_by = ?, sent_back_at = ?, sent_back_reason = ? WHERE id = ?`).bind(user.username, t, reason, v.id),
      audit(c.env, user, 'send_back', d.id, `${label} sent back from ${v.status === 'review' ? 'review' : 'approval'}: ${reason}`),
    ]);
    await notify(c, v.submitted_by ?? v.created_by, `Sent back: ${label} ${d.title}`, `${user.fullName} sent ${label} "${d.title}" back: ${reason}`);
  } else {
    if (!mayAct(p, v, 'discard')) return c.json({ error: 'Only a draft can be discarded' }, 403);
    if (!d.published_at) return c.json({ error: 'This is the first revision: an admin or approver retires the document instead' }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE knowledge_revisions SET status = 'discarded' WHERE id = ?`).bind(v.id),
      audit(c.env, user, 'discard', d.id, `${label} draft discarded`),
    ]);
  }
  return c.json({ ok: true });
});

// ---- files --------------------------------------------------------------------------------------------------------

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Upload to a draft revision (raw body, X-File-Name, ?kind=published|source&rev=N). A new file replaces the draft's earlier one. */
knowledge.post('/:id/files', async (c) => {
  const user = c.get('user');
  const p = await controller(c.env, user);
  const d = await find(c.env, c.req.param('id'));
  if (!d || d.retired_at) return c.json({ error: 'Document not found' }, 404);
  if (!c.env.FILES) return c.json({ error: 'File storage isn’t set up on the server yet (R2 bucket slkops-files).' }, 503);
  const kind = c.req.query('kind') === 'source' ? 'source' : 'published';
  // admins replace the editable version of the published revision in place (6z.24); its PDF and approval stay
  const live = kind === 'source' && c.req.query('live') === '1';
  let v: Revision | null;
  if (live) {
    if (!p.admin) return c.json({ error: 'Only an admin replaces the editable version of a published document' }, 403);
    if (!d.published_at) return c.json({ error: 'This document is not published yet: add files to its draft' }, 400);
    v = await c.env.DB.prepare(`SELECT * FROM knowledge_revisions WHERE doc_id = ? AND revision = ? AND status = 'approved'`).bind(d.id, d.revision).first<Revision>();
    if (!v) return c.json({ error: 'The published revision was not found' }, 404);
  } else {
    v = await openRev(c.env, d.id);
    if (!v || (c.req.query('rev') !== undefined && Number(c.req.query('rev')) !== v.revision)) return c.json({ error: 'Start a new revision before adding files' }, 400);
    if (!mayAct(p, v, 'edit_files')) return c.json({ error: v.status === 'draft' ? 'Your role cannot add files' : 'Files can only change while the revision is a draft' }, 403);
  }
  const fileName = decodeURIComponent(c.req.header('x-file-name') ?? '');
  // editable versions are Word .docx only (fillable forms may also be Excel .xlsx); forms filed under Forms keep any format
  if (kind === 'source' && d.section !== 'form') { const bad = editableProblem(d, fileName); if (bad) return c.json({ error: bad }, 400); }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const ok = checkUpload(fileName, bytes.length);
  if ('error' in ok) return c.json({ error: ok.error }, 400);
  const id = crypto.randomUUID();
  const key = fileKey(d, v.revision, kind, id, ok.name);
  const sha = hex(await crypto.subtle.digest('SHA-256', bytes));
  // a form file already uploaded under another form is refused, so the same form is not filed twice (6z.27)
  if (d.section === 'form') {
    const dup = await c.env.DB.prepare(`SELECT d.doc_no, d.title FROM knowledge_files f JOIN knowledge_docs d ON d.id = f.doc_id
      WHERE f.sha256 = ? AND f.doc_id <> ? AND f.superseded_at IS NULL AND d.section = 'form' AND d.retired_at IS NULL LIMIT 1`).bind(sha, d.id).first<{ doc_no: string | null; title: string }>();
    if (dup) return c.json({ error: `This file is already uploaded as ${dup.doc_no ? `${dup.doc_no} ` : ''}“${dup.title}”. Open that form instead of adding it again.` }, 400);
  }
  // the file being replaced stays in storage and in the record (superseded), named in the audit line
  const prev = live ? await c.env.DB.prepare(`SELECT file_name FROM knowledge_files WHERE doc_id = ? AND kind = 'source' AND revision = ? AND superseded_at IS NULL`).bind(d.id, v.revision).first<{ file_name: string }>() : null;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: ok.type }, customMetadata: { name: ok.name, by: user.username, sha256: sha, doc: d.id, revision: String(v.revision) } });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE knowledge_files SET superseded_at = ? WHERE doc_id = ? AND kind = ? AND revision = ? AND superseded_at IS NULL').bind(now(), d.id, kind, v.revision),
    c.env.DB.prepare('INSERT INTO knowledge_files (id, doc_id, kind, revision, file_name, content_type, size_bytes, sha256, r2_key, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, d.id, kind, v.revision, ok.name, ok.type, bytes.length, sha, key, user.username),
    audit(c.env, user, 'upload', d.id, `${kind === 'source' ? 'Editable version' : 'Document'} “${ok.name}” for ${d.doc_no ?? d.title} Rev ${v.revision} (${live ? `published, replaced by an admin${prev ? `; was “${prev.file_name}”` : ""}` : "draft"})`),
  ]);
  return c.json({ id, revision: v.revision, name: ok.name }, 201);
});

function fileResponse(body: BodyInit | null, type: string, name: string, inline: boolean, extra: Record<string, string> = {}) {
  const show = inline && ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type);
  return new Response(body, {
    headers: {
      'Content-Type': type, 'Content-Disposition': `${show ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'", 'Cache-Control': 'private, no-store', ...extra,
    },
  });
}

/**
 * Download. PDFs are stamped on every page with the number, revision, who downloaded it, the date and a copy number;
 * a revision that is not approved also carries NOT APPROVED across each page. The copy number goes in the audit log.
 */
knowledge.get('/:id/files/:fileId', async (c) => {
  const user = c.get('user');
  const p = await controller(c.env, user);
  const f = await c.env.DB.prepare(`SELECT f.*, v.status AS rev_status FROM knowledge_files f LEFT JOIN knowledge_revisions v ON v.doc_id = f.doc_id AND v.revision = f.revision WHERE f.id = ? AND f.doc_id = ?`)
    .bind(c.req.param('fileId'), c.req.param('id')).first<KbFile & { kind: 'published' | 'source'; r2_key: string; rev_status: RevStatus | null }>();
  const d = await find(c.env, c.req.param('id'));
  if (!f || !d || !visible(p, d)) return c.json({ error: 'File not found' }, 404);
  const status = f.rev_status ?? 'superseded';
  if (!mayOpen(p, f, { revision: d.revision, published_at: d.published_at ?? null, is_form: d.is_form }, status)) return c.json({ error: 'Your access does not include this version' }, 403);
  if (!c.env.FILES) return c.json({ error: 'File storage isn’t set up on the server yet' }, 503);
  const obj = await c.env.FILES.get(f.r2_key);
  if (!obj) return c.json({ error: 'The file is missing from storage' }, 404);
  const copy = copyId();
  let body: BodyInit | null = obj.body;
  let stamped = false;
  if (f.content_type === 'application/pdf') {
    const text = stampText({ docNo: d.doc_no ?? d.title.slice(0, 40), revision: f.revision, by: `${user.fullName} (${user.username})`, date: riyadhToday(), copy, status: status === 'approved' ? 'approved' : REV_STATUS[status].toLowerCase() });
    const out = await stampPdf(new Uint8Array(await obj.arrayBuffer()), text, status !== 'approved');
    if (out) { body = out; stamped = true; } else body = (await c.env.FILES.get(f.r2_key))?.body ?? null;
  }
  await audit(c.env, user, 'download', d.id,
    `${f.kind === 'source' ? 'Editable version' : 'Document'} “${f.file_name}” Rev ${f.revision} (${REV_STATUS[status].toLowerCase()}) of ${d.doc_no ?? d.title}, ${copy}${stamped ? '' : ', not stamped'}`).run();
  return fileResponse(body, f.content_type, f.file_name, c.req.query('inline') === '1', { 'X-Copy-Id': copy });
});

