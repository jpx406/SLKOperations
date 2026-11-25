import { Hono, type Context } from 'hono';
import type Anthropic from '@anthropic-ai/sdk';
import { checkUpload } from '../shared/attachments';
import { costMicroUsd, limitCheck } from '../shared/ai';
import { extractText } from '../shared/docAnalysis';
import { DEFAULT_COPY_SETTINGS, copySettingsOf, slideTemplate, type CopySettings } from '../shared/companyCopy';
import { GLOBAL, fileKey, placeCode } from '../shared/knowledge';
import { DEFAULT_NUMBERING, DEFAULT_PERIODS, addMonths, type Numbering, type Periods } from '../shared/knowledgeControl';
import {
  EMPTY_CONTENT, LESSON_KINDS, LIMITS, cleanContent, cleanDraft, fileTitle, isLessonCompany, isLessonKind, lessonPrompt, lessonSchema, mayCreate, mayDo,
  nextLessonNumber, submitProblems, type LessonCompany, type LessonContent, type LessonKind, type LessonPerson, type LessonPicture, type LessonStatus,
} from '../shared/lessons';
import { chrome, layoutLesson, type PageInput } from '../shared/lessonLayout';
import { lessonPdf, type PdfImage } from '../shared/lessonPdf';
import { lessonPptx, templateLogo, templateStyle } from '../shared/lessonPptx';
import { roleLabel } from '../shared/roles';
import { unzip } from '../shared/xlsxRead';
import { client, fallbackFor, loadSettings, serviceError, spend } from './ai';
import type { AppBindings, AuthedUser, Env } from './env';

// Lessons and best practices written in the app (Utilities, 6z.57). Knowledge Hub approvers and admins start one on
// a company template, by hand or drafted by AI from a failure report; it goes to a reviewer and an approver chosen
// from the Knowledge Hub people. Approval numbers it the Knowledge Hub way, makes the PDF and the PowerPoint, and
// publishes both to the Knowledge Hub for the country: a new entry, or a new revision of the entry it was published
// as before (or of one with the same title, type and company there), so nothing is filed twice.

type C = Context<AppBindings>;
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const now = () => new Date().toISOString();
const riyadhToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const pad = (n: number) => String(n).padStart(2, '0');

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string, type = 'lessons') =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, type, id, summary.slice(0, 1000));

interface Row {
  id: string; kind: LessonKind; company: LessonCompany; country: string; title: string; content: string; status: LessonStatus;
  reviewer: string | null; approver: string | null; submit_note: string | null; review_comment: string | null; sent_back_reason: string | null; sent_back_by: string | null;
  submitted_by: string | null; submitted_at: string | null; reviewed_at: string | null; approved_at: string | null; source_name: string | null; source_key: string | null;
  kb_doc_id: string | null; doc_no: string | null; revision: number | null; change_note: string | null; created_by: string; created_at: string; updated_by: string | null; updated_at: string;
}

async function person(env: Env, user: AuthedUser): Promise<LessonPerson> {
  const row = await env.DB.prepare('SELECT can_review, can_approve FROM knowledge_people WHERE username = ?').bind(user.username).first<{ can_review: number; can_approve: number }>();
  const admin = user.role === 'admin';
  return { username: user.username, admin, reviewer: row ? !!row.can_review : admin, approver: row ? !!row.can_approve : admin };
}
async function setting<T>(env: Env, key: string, fallback: T): Promise<T> {
  const r = await env.DB.prepare('SELECT value FROM knowledge_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return r ? { ...fallback, ...(JSON.parse(r.value) as T) } : fallback;
}
const copySettings = async (env: Env): Promise<CopySettings> => copySettingsOf(await setting<CopySettings>(env, 'copies', DEFAULT_COPY_SETTINGS));
const colourOf = (s: CopySettings, co: LessonCompany) => (co === 'NESR' ? s.nesrColours[0] ?? '024800' : s.companies[co].colour).toUpperCase();
const templateOf = (s: CopySettings, co: LessonCompany, kind: LessonKind) => slideTemplate(s, co, kind === 'best_practice' ? 'bp' : 'slides')?.file ?? null;

/** Countries a lesson may be filed under: Global and the person's own (every active one for admins). */
async function placesFor(env: Env, user: AuthedUser): Promise<string[]> {
  const own = [...new Set(user.allCountries ?? user.countries)];
  if (user.role !== 'admin') return [...own, GLOBAL];
  const { results } = await env.DB.prepare('SELECT DISTINCT country FROM wg_units WHERE wg_active = 1').all<{ country: string }>();
  return [...new Set([...results.map((r) => r.country), ...own])].sort().concat(GLOBAL);
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
/** Seen by people of its country, and always by whoever wrote, reviews or approves it. */
const visible = (user: AuthedUser, l: Row) => user.role === 'admin' || l.country === GLOBAL || (user.allCountries ?? user.countries).includes(l.country)
  || same(user.username, l.created_by) || same(user.username, l.reviewer) || same(user.username, l.approver);

async function load(c: C): Promise<Row | null> {
  const l = await c.env.DB.prepare('SELECT * FROM lessons WHERE id = ?').bind(c.req.param('id') ?? '').first<Row>();
  return l && visible(c.get('user'), l) ? l : null;
}
const contentOf = (l: Row): LessonContent => cleanContent(JSON.parse(l.content || '{}'));

async function notify(c: C, username: string | null, subject: string, text: string) {
  if (!username || !c.env.EMAIL) return;
  const r = await c.env.DB.prepare(`SELECT coalesce(u.email, e.contact_email) AS email FROM user_roles u LEFT JOIN employees e ON lower(e.wg_username) = lower(u.username) AND e.active = 1
    WHERE u.username = ? AND u.active = 1`).bind(username).first<{ email: string | null }>();
  if (!r?.email) return;
  const link = `${c.env.APP_URL ?? 'https://slkops.nesrapp.com'}/utilities/lessons`;
  const send = c.env.EMAIL.send({ to: r.email, from: { email: c.env.EMAIL_FROM ?? 'slkops@nesrapp.com', name: 'SLK Operations Hub' }, subject,
    text: `${text}\n\nOpen Lessons & best practices: ${link}`, html: `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p><p><a href="${link}">Open Lessons &amp; best practices</a></p>` })
    .catch((e: Error) => console.error('lesson email not sent', e.message));
  try { c.executionCtx.waitUntil(send); } catch { await send; }
}

const nameOf = async (env: Env, u: string | null) => (u ? (await env.DB.prepare('SELECT full_name FROM user_roles WHERE username = ?').bind(u).first<{ full_name: string }>())?.full_name ?? u : '');
async function positionOf(env: Env, u: string | null): Promise<string> {
  if (!u) return '';
  const r = await env.DB.prepare('SELECT c.position, u.role FROM user_roles u LEFT JOIN competency_users c ON c.username = u.username WHERE u.username = ?').bind(u).first<{ position: string | null; role: string }>();
  return r?.position || roleLabel(r?.role as never) || '';
}
async function holds(env: Env, username: string, right: 'can_review' | 'can_approve') {
  const r = await env.DB.prepare(`SELECT coalesce(k.${right}, CASE WHEN u.role = 'admin' THEN 1 ELSE 0 END) AS ok FROM user_roles u LEFT JOIN knowledge_people k ON k.username = u.username WHERE u.username = ? AND u.active = 1`)
    .bind(username).first<{ ok: number }>();
  return r?.ok === 1;
}

// ---- making the page ----------------------------------------------------------------------------------------------

interface Made { input: PageInput; images: Map<string, PdfImage>; logo: (PdfImage & { w: number; h: number }) | null; template: Uint8Array | null; templateName: string | null }

async function prepare(env: Env, l: Row, c: LessonContent, extra: { docNo: string | null; revision: string | null; signoff?: PageInput['signoff'] }): Promise<Made> {
  const s = await copySettings(env);
  const tf = templateOf(s, l.company, l.kind);
  const tpl = tf && env.FILES ? await env.FILES.get(tf.key) : null;
  const template = tpl ? new Uint8Array(await tpl.arrayBuffer()) : null;
  const logo = template ? await templateLogo(template) : null;
  const style = template ? await templateStyle(template) : null;
  const images = new Map<string, PdfImage>();
  if (env.FILES) {
    for (const p of c.pictures) {
      const o = await env.FILES.get(picKey(l.id, p));
      if (o) images.set(p.id, { bytes: new Uint8Array(await o.arrayBuffer()), type: p.type });
    }
  }
  const signoff = extra.signoff ?? { date: '', changes: '', prepared: await nameOf(env, l.created_by), reviewed: await nameOf(env, l.reviewer), approver: await nameOf(env, l.approver), position: await positionOf(env, l.approver) };
  return { input: { style, kind: l.kind, company: l.company, country: l.country, title: l.title, content: c, colour: colourOf(s, l.company), docNo: extra.docNo, revision: extra.revision, signoff }, images, logo, template, templateName: tf?.file_name ?? null };
}
const picKey = (id: string, p: Pick<LessonPicture, 'id' | 'type'>) => `lessons/${id}/pictures/${p.id}.${p.type === 'image/png' ? 'png' : 'jpg'}`;

async function makePdf(m: Made, title: string) { return lessonPdf(m.input, m.images, m.logo, title); }
async function makePptx(m: Made) {
  if (!m.template) return null;
  const lay = layoutLesson(m.input);
  return lessonPptx(m.template, [...chrome(m.input, null).slide, ...lay.blocks], m.images);
}

function fileResponse(body: BodyInit, type: string, name: string, inline: boolean) {
  return new Response(body, { headers: { 'Content-Type': type, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } });
}

/** Width and height of a PNG or JPEG. */
export function imageSize(b: Uint8Array): { w: number; h: number; type: 'image/png' | 'image/jpeg' } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: v.getUint32(16), h: v.getUint32(20), type: 'image/png' };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], type: 'image/jpeg' };
      i += 2 + len;
    }
  }
  return null;
}

export const lessons = new Hono<AppBindings>();

// ---- the list ---------------------------------------------------------------------------------------------------------

lessons.get('/', async (c) => {
  const user = c.get('user');
  const p = await person(c.env, user);
  const { results } = await c.env.DB.prepare(`SELECT l.id, l.kind, l.company, l.country, l.title, l.status, l.doc_no, l.revision, l.kb_doc_id, l.updated_at, l.created_by, l.reviewer, l.approver,
      coalesce(u1.full_name, l.updated_by) AS updated_by_name, coalesce(u2.full_name, l.created_by) AS created_by_name,
      coalesce(u3.full_name, l.reviewer) AS reviewer_name, coalesce(u4.full_name, l.approver) AS approver_name
    FROM lessons l LEFT JOIN user_roles u1 ON u1.username = l.updated_by LEFT JOIN user_roles u2 ON u2.username = l.created_by
      LEFT JOIN user_roles u3 ON u3.username = l.reviewer LEFT JOIN user_roles u4 ON u4.username = l.approver
    ORDER BY l.updated_at DESC LIMIT 500`).all<Row & { updated_by_name: string; created_by_name: string; reviewer_name: string | null; approver_name: string | null }>();
  const s = await copySettings(c.env);
  const people = await c.env.DB.prepare(`SELECT u.username, u.full_name, coalesce(k.can_review, CASE WHEN u.role = 'admin' THEN 1 ELSE 0 END) AS can_review,
      coalesce(k.can_approve, CASE WHEN u.role = 'admin' THEN 1 ELSE 0 END) AS can_approve
    FROM user_roles u LEFT JOIN knowledge_people k ON k.username = u.username WHERE u.active = 1 ORDER BY u.full_name`).all<{ username: string; full_name: string; can_review: number; can_approve: number }>();
  const list = results.filter((l) => visible(user, l)).map((l) => ({
    ...l, withMe: (l.status === 'review' && same(l.reviewer, user.username)) || (l.status === 'approval' && same(l.approver, user.username)),
    mine: same(l.created_by, user.username),
  }));
  return c.json({
    lessons: list, canCreate: mayCreate(p), places: await placesFor(c.env, user), myCountry: (user.allCountries ?? user.countries)[0] ?? GLOBAL,
    reviewers: people.results.filter((x) => x.can_review).map((x) => ({ username: x.username, name: x.full_name })),
    approvers: people.results.filter((x) => x.can_approve).map((x) => ({ username: x.username, name: x.full_name })),
    templates: Object.fromEntries((['NESR', 'SAPESCO', 'Gulf Energy'] as LessonCompany[]).map((co) => [co, { lesson_learnt: !!templateOf(s, co, 'lesson_learnt'), best_practice: !!templateOf(s, co, 'best_practice') }])),
    ai: !!c.env.ANTHROPIC_API_KEY,
  });
});

/** A blank template: the company's slides with one empty slide, the header, logo and sign-off tables kept. */
lessons.get('/templates/:company/:kind', async (c) => {
  const co = c.req.param('company'), kind = c.req.param('kind');
  if (!isLessonCompany(co) || !isLessonKind(kind)) return c.json({ error: 'Unknown template' }, 404);
  const s = await copySettings(c.env);
  const tf = templateOf(s, co, kind);
  if (!tf || !c.env.FILES) return c.json({ error: `There is no ${co} ${LESSON_KINDS[kind].toLowerCase()} template yet. An admin adds it in Knowledge Hub › Doc Control › Settings.` }, 404);
  const obj = await c.env.FILES.get(tf.key);
  if (!obj) return c.json({ error: 'The template is missing from storage' }, 404);
  const bytes = await lessonPptx(new Uint8Array(await obj.arrayBuffer()), [], new Map());
  return fileResponse(bytes, PPTX, `${co} ${LESSON_KINDS[kind]} template.pptx`, false);
});

/** The logo on the company's template, for the page preview. */
lessons.get('/logo/:company/:kind', async (c) => {
  const co = c.req.param('company'), kind = c.req.param('kind');
  if (!isLessonCompany(co) || !isLessonKind(kind)) return c.json({ error: 'Unknown template' }, 404);
  const tf = templateOf(await copySettings(c.env), co, kind);
  const obj = tf && c.env.FILES ? await c.env.FILES.get(tf.key) : null;
  const logo = obj ? await templateLogo(new Uint8Array(await obj.arrayBuffer())) : null;
  if (!logo) return c.json({ error: 'No logo' }, 404);
  return new Response(logo.bytes, { headers: { 'Content-Type': logo.type, 'Cache-Control': 'private, max-age=600', 'X-Logo-Size': `${logo.w}x${logo.h}` } });
});

lessons.post('/', async (c) => {
  const user = c.get('user');
  const p = await person(c.env, user);
  if (!mayCreate(p)) return c.json({ error: 'Only Knowledge Hub approvers and admins start lessons and best practices' }, 403);
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (!isLessonKind(b.kind)) return c.json({ error: 'Pick lesson learnt or best practice' }, 400);
  if (!isLessonCompany(b.company)) return c.json({ error: 'Pick the company' }, 400);
  const country = String(b.country ?? '');
  if (!(await placesFor(c.env, user)).includes(country)) return c.json({ error: 'Pick one of your countries or Global' }, 400);
  const title = String(b.title ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.title);
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO lessons (id, kind, company, country, title, content, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, b.kind, b.company, country, title, JSON.stringify(EMPTY_CONTENT), user.username, user.username),
    audit(c.env, user, 'create', id, `${LESSON_KINDS[b.kind]} ${b.company} ${country}: ${title || 'untitled'}`),
  ]);
  return c.json({ id }, 201);
});

lessons.get('/:id', async (c) => {
  const user = c.get('user');
  const l = await load(c);
  if (!l) return c.json({ error: 'Not found' }, 404);
  const p = await person(c.env, user);
  const s = await copySettings(c.env);
  const can = Object.fromEntries((['edit', 'submit', 'review', 'approve', 'send_back', 'delete', 'revise'] as const).map((a) => [a, mayDo(p, l, a)]));
  const tf = templateOf(s, l.company, l.kind);
  const tplObj = tf && c.env.FILES ? await c.env.FILES.get(tf.key) : null;
  const style = tplObj ? await templateStyle(new Uint8Array(await tplObj.arrayBuffer())) : null;
  const [created, reviewer, approver] = await Promise.all([nameOf(c.env, l.created_by), nameOf(c.env, l.reviewer), nameOf(c.env, l.approver)]);
  return c.json({
    lesson: { ...l, content: contentOf(l), created_by_name: created, reviewer_name: reviewer, approver_name: approver },
    can, colour: colourOf(s, l.company), style, template: !!tf, me: user.username,
  });
});

/** Saves the title and page while it is with whoever may edit it. */
lessons.put('/:id', async (c) => {
  const user = c.get('user');
  const l = await load(c);
  if (!l) return c.json({ error: 'Not found' }, 404);
  if (!mayDo(await person(c.env, user), l, 'edit')) return c.json({ error: l.status === 'approved' ? 'Start a new revision to change it' : 'It is with someone else now' }, 403);
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const title = typeof b.title === 'string' ? b.title.replace(/\s+/g, ' ').trim().slice(0, LIMITS.title) : l.title;
  const content = b.content === undefined ? contentOf(l) : cleanContent(b.content);
  // pictures are added and removed by their own routes; a save keeps the stored list's files
  const stored = new Map(contentOf(l).pictures.map((x) => [x.id, x]));
  content.pictures = content.pictures.filter((x) => stored.has(x.id)).map((x) => ({ ...stored.get(x.id)!, caption: x.caption, section: x.section }));
  for (const x of stored.values()) if (!content.pictures.some((y) => y.id === x.id)) content.pictures.push(x);
  const change = typeof b.change_note === 'string' ? b.change_note.trim().slice(0, 200) : l.change_note;
  await c.env.DB.prepare('UPDATE lessons SET title = ?, content = ?, change_note = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .bind(title, JSON.stringify(content), change, user.username, now(), l.id).run();
  return c.json({ ok: true, updated_at: now() });
});

lessons.delete('/:id', async (c) => {
  const user = c.get('user');
  const l = await load(c);
  if (!l) return c.json({ error: 'Not found' }, 404);
  if (!mayDo(await person(c.env, user), l, 'delete')) return c.json({ error: 'Only a draft that was never published is deleted, by whoever wrote it or an admin' }, 403);
  const keys = [...contentOf(l).pictures.map((p) => picKey(l.id, p)), ...(l.source_key ? [l.source_key] : [])];
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM lessons WHERE id = ?').bind(l.id), audit(c.env, user, 'delete', l.id, `Draft deleted: ${l.title}`)]);
  if (c.env.FILES && keys.length) await c.env.FILES.delete(keys).catch(() => undefined);
  return c.json({ ok: true });
});

// ---- pictures and the failure report --------------------------------------------------------------------------------

async function addPicture(env: Env, l: Row, bytes: Uint8Array, caption: string, section: 'description' | 'analysis'): Promise<LessonPicture | { error: string }> {
  const size = imageSize(bytes);
  if (!size || !size.w || !size.h) return { error: 'Pictures are JPEG or PNG' };
  if (bytes.length > 6 * 1024 * 1024) return { error: 'A picture can be up to 6 MB' };
  const pic: LessonPicture = { id: crypto.randomUUID(), caption: caption.slice(0, LIMITS.caption), section, w: size.w, h: size.h, type: size.type };
  await env.FILES!.put(picKey(l.id, pic), bytes, { httpMetadata: { contentType: size.type } });
  return pic;
}

lessons.post('/:id/pictures', async (c) => {
  const user = c.get('user');
  const l = await load(c);
  if (!l) return c.json({ error: 'Not found' }, 404);
  if (!mayDo(await person(c.env, user), l, 'edit')) return c.json({ error: 'It is with someone else now' }, 403);
  if (!c.env.FILES) return c.json({ error: 'File storage isn’t set up on the server yet' }, 503);
  const content = contentOf(l);
  if (content.pictures.length >= LIMITS.pictures) return c.json({ error: `Up to ${LIMITS.pictures} pictures` }, 400);
  const section = c.req.query('section') === 'analysis' ? 'analysis' : 'description';
  const pic = await addPicture(c.env, l, new Uint8Array(await c.req.arrayBuffer()), decodeURIComponent(c.req.header('x-caption') ?? ''), section);
  if ('error' in pic) return c.json({ error: pic.error }, 400);
  content.pictures.push(pic);
  await c.env.DB.prepare('UPDATE lessons SET content = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(content), user.username, now(), l.id).run();
  return c.json({ picture: pic }, 201);
});

lessons.get('/:id/pictures/:pid', async (c) => {
  const l = await load(c);
  const pic = l ? contentOf(l).pictures.find((p) => p.id === c.req.param('pid')) : null;
  if (!l || !pic || !c.env.FILES) return c.json({ error: 'Not found' }, 404);
  const o = await c.env.FILES.get(picKey(l.id, pic));
  if (!o) return c.json({ error: 'Not found' }, 404);
  return new Response(o.body, { headers: { 'Content-Type': pic.type, 'Cache-Control': 'private, max-age=3600' } });
});

lessons.delete('/:id/pictures/:pid', async (c) => {
  const user = c.get('user');
  const l = await load(c);
  if (!l) return c.json({ error: 'Not found' }, 404);
  if (!mayDo(await person(c.env, user), l, 'edit')) return c.json({ error: 'It is with someone else now' }, 403);
  const content = contentOf(l);
  const pic = content.pictures.find((p) => p.id === c.req.param('pid'));
  if (!pic) return c.json({ error: 'Not found' }, 404);
  content.pictures = content.pictures.filter((p) => p.id !== pic.id);
  await c.env.DB.prepare('UPDATE lessons SET content = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(content), user.username, now(), l.id).run();
  // a published revision may still show it in its files; those are copies, so the picture itself can go
  if (c.env.FILES) await c.env.FILES.delete(picKey(l.id, pic)).catch(() => undefined);
  return c.json({ ok: true });
});

lessons.get('/:id/source', async (c) => {
  const l = await load(c);
  if (!l || !l.source_key || !c.env.FILES) return c.json({ error: 'Not found' }, 404);
  const o = await c.env.FILES.get(l.source_key);
  if (!o) return c.json({ error: 'The file is missing from storage' }, 404);
  return fileResponse(o.body, o.httpMetadata?.contentType ?? 'application/octet-stream', l.source_name ?? 'Failure report', c.req.query('inline') === '1');
});

/**
 * AI draft from a failure report (raw body, X-File-Name): keeps the report, reads it, fills every part of the page and
 * flags each for checking. Pictures inside a Word or PowerPoint report are added too (up to the picture limit).
 */
lessons.post('/:id/analyse', async (c) => {
  const user = c.get('user');
  const l = await load(c);
  if (!l) return c.json({ error: 'Not found' }, 404);
  if (!mayDo(await person(c.env, user), l, 'edit') || l.status !== 'draft') return c.json({ error: 'Only a draft is drafted with AI' }, 403);
  if (!c.env.FILES) return c.json({ error: 'File storage isn’t set up on the server yet' }, 503);
  const name = decodeURIComponent(c.req.header('x-file-name') ?? '');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const ok = checkUpload(name, bytes.length);
  if ('error' in ok) return c.json({ error: ok.error }, 400);
  if (!/\.(pdf|docx|pptx|txt)$/i.test(ok.name)) return c.json({ error: 'The failure report is a PDF, Word (.docx) or PowerPoint (.pptx) file' }, 400);
  // keep the report with the lesson
  const key = `lessons/${l.id}/source/${crypto.randomUUID().slice(0, 8)} ${ok.name}`;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: ok.type }, customMetadata: { name: ok.name, by: user.username } });
  if (l.source_key && l.source_key !== key) await c.env.FILES.delete(l.source_key).catch(() => undefined);
  await c.env.DB.prepare('UPDATE lessons SET source_name = ?, source_key = ? WHERE id = ?').bind(ok.name, key, l.id).run();

  const content = contentOf(l);
  // pictures inside an Office report
  let added = 0;
  if (/\.(docx|pptx)$/i.test(ok.name)) {
    const parts = await unzip(bytes, true).catch(() => new Map<string, Uint8Array>());
    const media = [...parts.entries()].filter(([k, v]) => /^(word|ppt)\/media\/[^/]+\.(png|jpe?g)$/i.test(k) && v.length > 20_000).sort((a, b) => b[1].length - a[1].length);
    for (const [, v] of media) {
      if (content.pictures.length >= Math.min(LIMITS.pictures, 6)) break;
      if (v.length > 6 * 1024 * 1024) continue;
      const pic = await addPicture(c.env, l, v, 'From the failure report', 'description');
      if ('error' in pic) continue;
      content.pictures.push(pic); added++;
    }
  }

  if (!c.env.ANTHROPIC_API_KEY) {
    await c.env.DB.prepare('UPDATE lessons SET content = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(content), user.username, now(), l.id).run();
    return c.json({ error: `AI isn’t set up on the server. The report is kept${added ? ` and ${added} of its pictures added` : ''}: fill in the page by hand.` }, 503);
  }
  const s = await loadSettings(c.env);
  const u = await spend(c.env, user.username, 'document');
  const blocked = limitCheck(s, u.monthMicro, u.sentToday);
  if (blocked) return c.json({ error: `${blocked.replace('The AI Agent is switched off', 'AI is switched off')} Fill in the page by hand.` }, 429);
  let part: Anthropic.Beta.BetaContentBlockParam;
  if (ok.type === 'application/pdf') {
    if (bytes.length > 20 * 1024 * 1024) return c.json({ error: 'This PDF is too large for AI (over 20 MB). Fill in the page by hand.' }, 400);
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    part = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: btoa(bin) } };
  } else {
    const text = await extractText(ok.name, bytes);
    if (!text) return c.json({ error: 'The report’s text couldn’t be read. Fill in the page by hand.' }, 400);
    part = { type: 'text', text: `<document name="${ok.name}">\n${text.slice(0, 150_000)}\n</document>` };
  }
  const cats = await c.env.DB.prepare(`SELECT DISTINCT category FROM knowledge_docs WHERE section = 'lesson' AND category IS NOT NULL ORDER BY 1 LIMIT 60`).all<{ category: string }>();
  let micro = 0, inTok = 0, outTok = 0;
  try {
    const res = await client(c.env).beta.messages.create({
      model: s.model, max_tokens: 6000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: lessonSchema() } },
      messages: [{ role: 'user', content: [part, { type: 'text', text: lessonPrompt({ kind: l.kind, fileName: ok.name, today: riyadhToday(), categories: cats.results.map((r) => r.category) }) }] }],
      ...fallbackFor(s.model),
    });
    micro = costMicroUsd(res.usage, s.model);
    inTok = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    outTok = res.usage.output_tokens;
    if (res.stop_reason === 'refusal') return c.json({ error: 'The AI declined to read this report. Fill in the page by hand.' }, 422);
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return c.json({ error: 'The AI answer couldn’t be read. Fill in the page by hand.' }, 502); }
    const draft = cleanDraft(raw, l.kind);
    const merged = cleanContent({ ...content, ...draft.content, pictures: content.pictures });
    const title = l.title || draft.title;
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE lessons SET title = ?, content = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(title, JSON.stringify(merged), user.username, now(), l.id),
      audit(c.env, user, 'ai_draft', l.id, `Drafted with AI from “${ok.name}”${added ? `, ${added} pictures added` : ''}`),
    ]);
    return c.json({ ok: true, pictures: added });
  } catch (e) {
    const msg = serviceError(e);
    if (!msg) throw e;
    return c.json({ error: `${msg} You can fill in the page by hand.` }, 502);
  } finally {
    await c.env.DB.prepare('INSERT INTO ai_usage (id, username, feature, model, input_tokens, output_tokens, cost_microusd) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), user.username, 'document', s.model, inTok, outTok, micro).run();
  }
});

// ---- exports ----------------------------------------------------------------------------------------------------------

/** The PDF or PowerPoint as it stands (drafts carry no number yet). Approved ones open from the Knowledge Hub. */
lessons.get('/:id/:fmt{pdf|pptx}', async (c) => {
  const l = await load(c);
  if (!l) return c.json({ error: 'Not found' }, 404);
  const m = await prepare(c.env, l, contentOf(l), { docNo: l.status === 'approved' ? l.doc_no : null, revision: l.status === 'approved' && l.revision !== null ? pad(l.revision) : null });
  const name = `${l.status === 'approved' && l.doc_no ? `${l.doc_no} ` : 'DRAFT '}${fileTitle(l.title)}`;
  if (c.req.param('fmt') === 'pdf') return fileResponse(await makePdf(m, l.title), 'application/pdf', `${name}.pdf`, c.req.query('inline') === '1');
  const pptx = await makePptx(m);
  if (!pptx) return c.json({ error: `There is no ${l.company} ${LESSON_KINDS[l.kind].toLowerCase()} slides template yet. An admin adds it in Knowledge Hub › Doc Control › Settings.` }, 404);
  return fileResponse(pptx, PPTX, `${name}.pptx`, false);
});

// ---- review and approval ------------------------------------------------------------------------------------------------

lessons.post('/:id/:step{submit|review|approve|send-back|revise}', async (c) => {
  const user = c.get('user');
  const l = await load(c);
  if (!l) return c.json({ error: 'Not found' }, 404);
  const p = await person(c.env, user);
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const text = (k: string, n = 500) => (typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, n) : '');
  const step = c.req.param('step');
  const t = now();
  const label = `${LESSON_KINDS[l.kind]} “${l.title}”`;

  if (step === 'submit') {
    if (!mayDo(p, l, 'submit')) return c.json({ error: 'Only a draft is sent for review' }, 403);
    const content = contentOf(l);
    const m = await prepare(c.env, l, content, { docNo: null, revision: null });
    const problems = submitProblems(l.title, content, layoutLesson(m.input).fits);
    if (problems.length) return c.json({ error: problems.join('. ') }, 400);
    const reviewer = text('reviewer', 80), approver = text('approver', 80);
    if (!reviewer || !approver) return c.json({ error: 'Pick the reviewer and the approver' }, 400);
    if (!(await holds(c.env, reviewer, 'can_review'))) return c.json({ error: 'That person is not a Knowledge Hub reviewer' }, 400);
    if (!(await holds(c.env, approver, 'can_approve'))) return c.json({ error: 'That person is not a Knowledge Hub approver' }, 400);
    if (!p.admin && (same(reviewer, user.username) || same(approver, user.username))) return c.json({ error: 'Someone else must review and approve it' }, 400);
    if (l.kb_doc_id && !text('change_note') && !l.change_note) return c.json({ error: 'Say what changes in this revision' }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE lessons SET status = 'review', reviewer = ?, approver = ?, submit_note = ?, submitted_by = ?, submitted_at = ?, sent_back_reason = NULL, sent_back_by = NULL,
          change_note = coalesce(nullif(?, ''), change_note), updated_by = ?, updated_at = ? WHERE id = ?`)
        .bind(reviewer, approver, text('note') || null, user.username, t, text('change_note', 200), user.username, t, l.id),
      audit(c.env, user, 'submit', l.id, `${label} sent for review to ${await nameOf(c.env, reviewer)}, approver ${await nameOf(c.env, approver)}${text('note') ? `: ${text('note')}` : ''}`),
    ]);
    await notify(c, reviewer, `Review: ${label}`, `${user.fullName} sent ${label} for your review.${text('note') ? ` Note: ${text('note')}` : ''}`);
  } else if (step === 'review') {
    if (!mayDo(p, l, 'review')) return c.json({ error: 'Only the reviewer passes the review' }, 403);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE lessons SET status = 'approval', reviewed_at = ?, review_comment = ?, updated_by = ?, updated_at = ? WHERE id = ?`).bind(t, text('comment') || null, user.username, t, l.id),
      audit(c.env, user, 'review', l.id, `${label} reviewed, sent to ${await nameOf(c.env, l.approver)} for approval${text('comment') ? `: ${text('comment')}` : ''}`),
    ]);
    await notify(c, l.approver, `Approval: ${label}`, `${user.fullName} reviewed ${label}. It is waiting for your approval.`);
  } else if (step === 'send-back') {
    if (!mayDo(p, l, 'send_back')) return c.json({ error: 'Only the reviewer or approver holding it sends it back' }, 403);
    const reason = text('reason');
    if (!reason) return c.json({ error: 'Say why it is sent back' }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE lessons SET status = 'draft', sent_back_reason = ?, sent_back_by = ?, updated_by = ?, updated_at = ? WHERE id = ?`).bind(reason, user.username, user.username, t, l.id),
      audit(c.env, user, 'send_back', l.id, `${label} sent back: ${reason}`),
    ]);
    await notify(c, l.submitted_by ?? l.created_by, `Sent back: ${label}`, `${user.fullName} sent ${label} back: ${reason}`);
  } else if (step === 'revise') {
    if (!mayDo(p, l, 'revise')) return c.json({ error: 'Only an approved one gets a new revision, started by an approver or admin' }, 403);
    const note = text('change_note', 200);
    if (!note) return c.json({ error: 'Say what changes in this revision' }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE lessons SET status = 'draft', change_note = ?, reviewer = NULL, approver = NULL, review_comment = NULL, sent_back_reason = NULL, created_by = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
        .bind(note, user.username, user.username, t, l.id),
      audit(c.env, user, 'revise', l.id, `New revision of ${l.doc_no ?? l.title}: ${note}`),
    ]);
  } else {
    if (!mayDo(p, l, 'approve')) return c.json({ error: 'Only the approver approves it' }, 403);
    const r = await publish(c, l, text('comment'));
    if ('error' in r) return c.json({ error: r.error }, r.status);
    await notify(c, l.submitted_by ?? l.created_by, `Published: ${r.docNo} ${l.title}`, `${user.fullName} approved ${label}. It is published in the Knowledge Hub as ${r.docNo} Rev ${pad(r.revision)}.`);
    return c.json({ ok: true, doc_no: r.docNo, revision: r.revision, kb_doc_id: r.docId });
  }
  return c.json({ ok: true });
});

/**
 * Approval: picks the Knowledge Hub entry (the one it was published as, else one with the same title, type and
 * company in that country, else a new number), makes the PDF and PowerPoint, and publishes them as an approved
 * revision. The files are made once per revision, so approving never adds copies.
 */
async function publish(c: C, l: Row, comment: string): Promise<{ docId: string; docNo: string; revision: number } | { error: string; status: 400 | 409 | 503 }> {
  const user = c.get('user');
  if (!c.env.FILES) return { error: 'File storage isn’t set up on the server yet', status: 503 };
  const content = contentOf(l);
  const [numbering, periods, settings] = await Promise.all([
    setting<Numbering>(c.env, 'numbering', DEFAULT_NUMBERING), setting<Periods>(c.env, 'periods', DEFAULT_PERIODS), copySettings(c.env),
  ]);
  const kbCompany = l.company === 'NESR' ? null : l.company;
  type Doc = { id: string; doc_no: string | null; revision: number; published_at: string | null; retired_at: string | null };
  let doc: Doc | null = l.kb_doc_id ? await c.env.DB.prepare('SELECT id, doc_no, revision, published_at, retired_at FROM knowledge_docs WHERE id = ?').bind(l.kb_doc_id).first<Doc>() : null;
  if (doc?.retired_at) doc = null;
  if (!doc) {
    doc = await c.env.DB.prepare(`SELECT id, doc_no, revision, published_at, retired_at FROM knowledge_docs WHERE section = 'lesson' AND country = ? AND doc_type = ? AND lower(title) = lower(?)
        AND coalesce(company, 'NESR') = ? AND retired_at IS NULL AND copy_of IS NULL ORDER BY published_at DESC LIMIT 1`)
      .bind(l.country, l.kind, l.title, l.company).first<Doc>();
  }
  if (doc) {
    const open = await c.env.DB.prepare(`SELECT revision, status FROM knowledge_revisions WHERE doc_id = ? AND status IN ('draft','review','approval')`).bind(doc.id).first<{ revision: number; status: string }>();
    if (open) return { error: `The Knowledge Hub entry ${doc.doc_no ?? l.title} has Rev ${open.revision} open (${open.status}). Finish or discard it there first.`, status: 409 };
  }
  let docNo = doc?.doc_no ?? null;
  if (!docNo) {
    const head = l.kind === 'best_practice' ? 'BP' : numbering.prefix.lesson || 'LL';
    const base = numbering.place ? `${head}-${placeCode(l.country)}` : head;
    const { results } = await c.env.DB.prepare('SELECT doc_no FROM knowledge_docs WHERE doc_no LIKE ?').bind(`%${base}-%`).all<{ doc_no: string }>();
    const prefix = l.company === 'NESR' ? null : settings.companies[l.company].prefix;
    docNo = nextLessonNumber(base, prefix, results.map((r) => r.doc_no), numbering.digits);
  }
  const revision = doc ? (doc.published_at ? doc.revision + 1 : doc.revision) : 0;
  const today = riyadhToday();
  const [prepared, reviewed, approverName, position] = await Promise.all([nameOf(c.env, l.created_by), nameOf(c.env, l.reviewer), nameOf(c.env, l.approver ?? user.username), positionOf(c.env, l.approver ?? user.username)]);
  const changes = revision === 0 ? 'First version' : l.change_note || 'Revised';
  const m = await prepare(c.env, l, content, { docNo, revision: pad(revision), signoff: { date: today, changes, prepared, reviewed, approver: approverName, position } });
  const pdf = await makePdf(m, `${docNo} ${l.title}`);
  let pptx: Uint8Array | null = null;
  try { pptx = await makePptx(m); } catch (e) { return { error: `The PowerPoint couldn’t be made from the ${l.company} template: ${(e as Error).message}`, status: 400 }; }

  const docId = doc?.id ?? crypto.randomUUID();
  const dref = { section: 'lesson' as const, country: l.country, company: kbCompany, client: null, doc_no: docNo, title: l.title };
  const base = `${docNo} ${fileTitle(l.title)} Rev ${pad(revision)}`;
  const files = [
    { kind: 'published', name: `${base}.pdf`, type: 'application/pdf', bytes: pdf },
    ...(pptx ? [{ kind: 'source', name: `${base}.pptx`, type: PPTX, bytes: pptx }] : []),
  ];
  const stmts: D1PreparedStatement[] = [];
  const t = now();
  const expires = addMonths(today, periods.expiryMonths);
  const summary = content.key_lesson || content.description.split('\n')[0] || null;
  if (!doc) {
    stmts.push(c.env.DB.prepare(`INSERT INTO knowledge_docs (id, section, country, company, client, doc_type, category, title, summary, key_action, failure_types, published_on, doc_no,
        review_due, created_by, revision, origin, author, is_form, expires_on, published_at, approved_by) VALUES (?, 'lesson', ?, ?, NULL, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, 'internal', ?, 0, ?, ?, ?)`)
      .bind(docId, l.country, kbCompany, l.kind, content.category || null, l.title, summary, content.actions[0]?.action ?? null, today, docNo,
        addMonths(today, periods.reviewMonths), l.created_by, revision, prepared, expires, t, user.username));
  } else {
    stmts.push(
      c.env.DB.prepare(`UPDATE knowledge_revisions SET status = 'superseded' WHERE doc_id = ? AND status = 'approved'`).bind(docId),
      c.env.DB.prepare(`UPDATE knowledge_docs SET title = ?, summary = ?, key_action = ?, category = coalesce(?, category), revision = ?, published_at = ?, approved_by = ?, review_due = ?, expires_on = ?,
          author = ?, published_on = ? WHERE id = ?`)
        .bind(l.title, summary, content.actions[0]?.action ?? null, content.category || null, revision, t, user.username, addMonths(today, periods.reviewMonths), expires, prepared, today, docId),
    );
  }
  stmts.push(c.env.DB.prepare(`INSERT INTO knowledge_revisions (id, doc_id, revision, status, change_note, author, revision_date, expires_on, created_by, submitted_by, submitted_at,
      reviewer, reviewed_at, review_comment, approver, approved_at, approve_comment) VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), docId, revision, `${changes} (written in Utilities › Lessons & best practices)`, prepared, today, expires, l.created_by, l.submitted_by, l.submitted_at,
      l.reviewer, l.reviewed_at, l.review_comment, l.approver ?? user.username, t, comment || null));
  for (const f of files) {
    const id = crypto.randomUUID();
    const key = fileKey(dref, revision, f.kind as 'published' | 'source', id, f.name);
    const sha = hex(await crypto.subtle.digest('SHA-256', f.bytes));
    await c.env.FILES.put(key, f.bytes, { httpMetadata: { contentType: f.type }, customMetadata: { name: f.name, by: user.username, sha256: sha, doc: docId, revision: String(revision), lesson: l.id } });
    stmts.push(
      c.env.DB.prepare('UPDATE knowledge_files SET superseded_at = ? WHERE doc_id = ? AND kind = ? AND revision = ? AND superseded_at IS NULL').bind(t, docId, f.kind, revision),
      c.env.DB.prepare('INSERT INTO knowledge_files (id, doc_id, kind, revision, file_name, content_type, size_bytes, sha256, r2_key, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, docId, f.kind, revision, f.name, f.type, f.bytes.length, sha, key, user.username),
    );
  }
  // the failure report goes with the entry as a support file, once
  if (l.source_key) {
    const o = await c.env.FILES.head(l.source_key);
    const sha = o?.customMetadata?.sha256 ?? l.source_key;
    const has = await c.env.DB.prepare(`SELECT 1 FROM attachments WHERE entity_type = 'knowledge' AND entity_id = ? AND (r2_key = ? OR sha256 = ?) AND deleted_at IS NULL`).bind(docId, l.source_key, sha).first();
    if (o && !has) {
      stmts.push(c.env.DB.prepare(`INSERT INTO attachments (id, country, entity_type, entity_id, category, file_name, content_type, size_bytes, sha256, r2_key, note, uploaded_by)
          VALUES (?, ?, 'knowledge', ?, 'document', ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), l.country, docId, l.source_name ?? 'Failure report', o.httpMetadata?.contentType ?? 'application/octet-stream', o.size, sha, l.source_key, 'Failure report the lesson was written from', user.username));
    }
  }
  stmts.push(
    c.env.DB.prepare(`UPDATE lessons SET status = 'approved', approved_at = ?, kb_doc_id = ?, doc_no = ?, revision = ?, updated_by = ?, updated_at = ? WHERE id = ?`).bind(t, docId, docNo, revision, user.username, t, l.id),
    audit(c.env, user, 'approve', l.id, `${LESSON_KINDS[l.kind]} “${l.title}” approved, published as ${docNo} Rev ${pad(revision)}${pptx ? '' : ' (PDF only: no slides template)'}${comment ? `: ${comment}` : ''}`),
    audit(c.env, user, doc ? 'approve' : 'create', docId, `${docNo} Rev ${pad(revision)} published from Utilities › Lessons & best practices`, 'knowledge_docs'),
  );
  try {
    await c.env.DB.batch(stmts);
  } catch (e) {
    if (/UNIQUE/.test((e as Error).message)) return { error: `${docNo} Rev ${pad(revision)} is already taken in the Knowledge Hub. Try again.`, status: 409 };
    throw e;
  }
  return { docId, docNo, revision };
}
