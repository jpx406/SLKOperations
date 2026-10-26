import { Hono } from 'hono';
import { roleLabel } from '../shared/roles';
import { STATE_TEXT, checkSignature, fingerprint, isSignedEntity, seal, type SignatureFacts, type SignedEntity } from '../shared/signature';
import type { AppBindings, AuthedUser, Env } from './env';

// Digital sign-off. The approve routes call signStatement() inside their own batch, so an approval and its signature
// are written together or not at all; reopening calls revokeStatement(). GET re-checks a signature against the record.

type Loaded = { country: string; content: unknown } | null;

/** What a signature covers, per record. Status and approval columns are left out: approving must not change the content. */
export async function signedContent(env: Env, type: SignedEntity, id: string): Promise<Loaded> {
  if (type === 'jra') {
    const r = await env.DB.prepare('SELECT x.job_id, x.template_id, x.answers, x.risk_score, x.approval_level, j.country FROM jras x JOIN jobs j ON j.id = x.job_id WHERE x.job_id = ?')
      .bind(id).first<{ job_id: string; template_id: string; answers: string; risk_score: number; approval_level: string | null; country: string }>();
    return r && { country: r.country, content: { job_id: r.job_id, template_id: r.template_id, answers: JSON.parse(r.answers), risk_score: r.risk_score, approval_level: r.approval_level } };
  }
  if (type === 'bonus') {
    const job = await env.DB.prepare('SELECT id, country FROM jobs WHERE id = ?').bind(id).first<{ id: string; country: string }>();
    if (!job) return null;
    const { results } = await env.DB.prepare('SELECT employee_id, crew_role, amount_cents, currency FROM job_bonus_lines WHERE job_id = ? ORDER BY employee_id, crew_role').bind(id).all();
    return { country: job.country, content: { job_id: id, lines: results } };
  }
  const [employee, month] = id.split('|');
  if (!employee || !/^\d{4}-\d{2}$/.test(month ?? '')) return null;
  const e = await env.DB.prepare('SELECT id, country FROM employees WHERE id = ?').bind(employee).first<{ id: string; country: string }>();
  if (!e) return null;
  const { results } = await env.DB.prepare(`SELECT day, code FROM attendance_entries WHERE employee_id = ? AND substr(day, 1, 7) = ? ORDER BY day`).bind(employee, month).all();
  return { country: e.country, content: { employee_id: employee, month, entries: results } };
}

/** The INSERT for a new signature over the record's current content. Call it before the approval batch runs. */
export async function signStatement(env: Env, user: AuthedUser, type: SignedEntity, id: string) {
  const loaded = await signedContent(env, type, id);
  const facts: SignatureFacts = {
    entity_type: type, entity_id: id, username: user.username, full_name: user.fullName, role: roleLabel(user.role),
    signed_at: new Date().toISOString(), fingerprint: await fingerprint(loaded?.content ?? null),
  };
  const s = env.SIGNING_KEY ? await seal(env.SIGNING_KEY, facts) : null;
  return env.DB.prepare('INSERT INTO signatures (id, entity_type, entity_id, username, full_name, role, signed_at, fingerprint, seal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), facts.entity_type, facts.entity_id, facts.username, facts.full_name, facts.role, facts.signed_at, facts.fingerprint, s);
}

export function revokeStatement(env: Env, user: AuthedUser, type: SignedEntity, id: string, reason: string) {
  return env.DB.prepare('UPDATE signatures SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE entity_type = ? AND entity_id = ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), user.username, reason.slice(0, 300), type, id);
}

type Row = SignatureFacts & { id: string; seal: string | null; revoked_at: string | null; revoked_by: string | null; revoke_reason: string | null };

async function describe(env: Env, rows: Row[], current: unknown) {
  return Promise.all(rows.map(async (r) => {
    const { id, revoked_by, revoke_reason, ...stored } = r;
    const state = await checkSignature(stored, current, env.SIGNING_KEY);
    return { id, username: r.username, full_name: r.full_name, role: r.role, signed_at: r.signed_at, fingerprint: r.fingerprint, revoked_at: r.revoked_at, revoked_by, revoke_reason, state, text: STATE_TEXT[state] };
  }));
}

export const signatures = new Hono<AppBindings>();

/** Every signature on one record, newest first, each re-checked now. */
signatures.get('/:type/:id', async (c) => {
  const type = c.req.param('type');
  if (!isSignedEntity(type)) return c.json({ error: 'Unknown record type' }, 404);
  const id = c.req.param('id');
  const loaded = await signedContent(c.env, type, id);
  if (!loaded || !c.get('user').countries.includes(loaded.country)) return c.json({ error: 'Not found' }, 404);
  const { results } = await c.env.DB.prepare('SELECT * FROM signatures WHERE entity_type = ? AND entity_id = ? ORDER BY signed_at DESC').bind(type, id).all<Row>();
  return c.json({ signatures: await describe(c.env, results, loaded.content) });
});
