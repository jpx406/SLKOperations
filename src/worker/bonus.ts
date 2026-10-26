import { Hono } from 'hono';
import { cleanLines, defaultLines, money, poolFor, type CrewMember, type CrewRole, type Rule } from '../shared/bonus';
import { filterSql, parseFilters } from '../shared/filters';
import type { AppBindings, AuthedUser, Env } from './env';
import { getJob } from './jobs';
import { revokeStatement, signStatement } from './signatures';

// Bonus (Administrator Manual 1 and 3). Every route here sits behind the bonus tab's rights (see permissions.ts).
// The distribution on Closure is for Admin and SDM roles only, on completed jobs; approval locks it.

const audit = (env: Env, user: AuthedUser, action: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, 'bonus', id, summary.slice(0, 1000));

const DISTRIBUTORS = ['admin', 'sdm', 'deputy_sdm'];
const ROLES: CrewRole[] = ['slickline_supervisor', 'slickline_operator', 'assistant_operator', 'helper'];

async function rulesFor(env: Env, country: string) {
  const [rules, splits] = await env.DB.batch([
    env.DB.prepare('SELECT job_type_name, basis, amount_cents, pct, currency, active FROM bonus_rules WHERE country = ?').bind(country),
    env.DB.prepare('SELECT crew_role, share_pct FROM bonus_role_splits WHERE country = ?').bind(country),
  ]);
  return { rules: rules.results as unknown as Rule[], splits: Object.fromEntries((splits.results as { crew_role: CrewRole; share_pct: number }[]).map((s) => [s.crew_role, s.share_pct])) as Partial<Record<CrewRole, number>> };
}

export const bonus = new Hono<AppBindings>();

// ---- rules and default splits (admin) ----

bonus.get('/rules', async (c) => {
  const countries = JSON.stringify(c.get('user').countries);
  const [rules, splits, types] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM bonus_rules WHERE country IN (SELECT value FROM json_each(?)) ORDER BY country, job_type_name').bind(countries),
    c.env.DB.prepare('SELECT * FROM bonus_role_splits WHERE country IN (SELECT value FROM json_each(?))').bind(countries),
    c.env.DB.prepare('SELECT DISTINCT country, name FROM wg_job_types WHERE wg_active = 1 AND country IN (SELECT value FROM json_each(?)) ORDER BY name').bind(countries),
  ]);
  return c.json({ rules: rules.results, splits: splits.results, jobTypes: types.results });
});

bonus.put('/rules', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const country = String(b.country ?? '');
  if (!user.countries.includes(country)) return c.json({ error: 'Pick one of your countries' }, 400);
  const name = String(b.job_type_name ?? '');
  if (!(await c.env.DB.prepare('SELECT 1 FROM wg_job_types WHERE name = ? AND country = ? LIMIT 1').bind(name, country).first())) return c.json({ error: 'That job type is not in WIREGUARD for this country' }, 400);
  const basis = String(b.basis ?? '');
  if (!['per_job', 'per_run', 'pct_revenue'].includes(basis)) return c.json({ error: 'Pick how the pool is worked out' }, 400);
  const amount = basis === 'pct_revenue' ? null : Number(b.amount_cents);
  const pct = basis === 'pct_revenue' ? Number(b.pct) : null;
  if (amount !== null && (!Number.isInteger(amount) || amount < 0)) return c.json({ error: 'Give the amount' }, 400);
  if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) return c.json({ error: 'The share of revenue must be 0 to 100 %' }, 400);
  const active = b.active === false || b.active === 0 ? 0 : 1;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO bonus_rules (id, country, job_type_name, basis, amount_cents, pct, active, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT (country, job_type_name) DO UPDATE SET basis = ?4, amount_cents = ?5, pct = ?6, active = ?7, updated_by = ?8, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).bind(crypto.randomUUID(), country, name, basis, amount, pct, active, user.username),
    audit(c.env, user, 'edit', `${country}:${name}`, `Bonus rule ${name} (${country}): ${basis} ${basis === 'pct_revenue' ? `${pct}%` : money(amount)}${active ? '' : ', switched off'}`),
  ]);
  return c.json({ ok: true });
});

bonus.put('/splits', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<{ country?: string; splits?: Record<string, unknown> }>().catch(() => ({} as { country?: string; splits?: Record<string, unknown> }));
  const country = String(b.country ?? '');
  if (!user.countries.includes(country)) return c.json({ error: 'Pick one of your countries' }, 400);
  const v = ROLES.map((r) => Number(b.splits?.[r] ?? 0));
  if (v.some((x) => !Number.isFinite(x) || x < 0 || x > 100)) return c.json({ error: 'Each share must be 0 to 100 %' }, 400);
  if (Math.abs(v.reduce((a, x) => a + x, 0) - 100) > 0.01) return c.json({ error: 'The shares must add up to 100 %' }, 400);
  await c.env.DB.batch([
    ...ROLES.map((r, i) => c.env.DB.prepare(
      `INSERT INTO bonus_role_splits (country, crew_role, share_pct, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT (country, crew_role) DO UPDATE SET share_pct = ?3, updated_by = ?4, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).bind(country, r, v[i], user.username)),
    audit(c.env, user, 'edit', country, `Default bonus split (${country}): ${ROLES.map((r, i) => `${r} ${v[i]}%`).join(', ')}`),
  ]);
  return c.json({ ok: true });
});

// ---- distribution on Closure ----

async function jobBonus(env: Env, user: AuthedUser, id: string) {
  const job = await getJob(env, user, id);
  if (!job) return null;
  const { rules, splits } = await rulesFor(env, job.country);
  const pool = poolFor(job, rules);
  const [crew, lines] = await env.DB.batch([
    env.DB.prepare('SELECT c.employee_id, c.crew_role, e.full_name, e.eid FROM job_crew c JOIN employees e ON e.id = c.employee_id WHERE c.job_id = ? ORDER BY c.crew_role, c.slot').bind(id),
    env.DB.prepare('SELECT b.*, e.full_name FROM job_bonus_lines b JOIN employees e ON e.id = b.employee_id WHERE b.job_id = ? ORDER BY b.amount_cents DESC').bind(id),
  ]);
  const crewList = crew.results as unknown as (CrewMember & { eid: string })[];
  const saved = lines.results as Record<string, unknown>[];
  return {
    job: { id: job.id, ticket_no: job.ticket_no, status: job.status, services: job.services, runs_ok: job.runs_ok, revenue_cents: job.revenue_cents, country: job.country },
    pool, crew: crewList, splits,
    lines: saved.length ? saved : defaultLines(crewList, splits, pool.cents).map((l) => ({ ...l, full_name: crewList.find((m) => m.employee_id === l.employee_id)?.full_name, status: 'proposed' })),
    status: saved.length ? (saved.every((l) => l.status === 'approved') ? 'approved' : 'draft') : 'proposed',
  };
}

bonus.get('/jobs/:id', async (c) => {
  const user = c.get('user');
  if (!DISTRIBUTORS.includes(user.role)) return c.json({ error: 'Only Admin and SDM accounts see the bonus distribution' }, 403);
  const r = await jobBonus(c.env, user, c.req.param('id'));
  return r ? c.json(r) : c.json({ error: 'Job not found' }, 404);
});

bonus.put('/jobs/:id', async (c) => {
  const user = c.get('user');
  if (!DISTRIBUTORS.includes(user.role)) return c.json({ error: 'Only Admin and SDM accounts distribute bonus' }, 403);
  const cur = await jobBonus(c.env, user, c.req.param('id'));
  if (!cur) return c.json({ error: 'Job not found' }, 404);
  if (cur.job.status !== 'completed') return c.json({ error: 'Bonus is distributed once the job is completed' }, 409);
  if (cur.status === 'approved') return c.json({ error: 'Approved. An admin must reopen it before changes.' }, 409);
  const { lines } = await c.req.json<{ lines?: unknown }>().catch(() => ({ lines: null }));
  const r = cleanLines(lines, cur.pool.cents, new Set(cur.crew.map((m) => m.employee_id)));
  if ('error' in r) return c.json({ error: r.error }, 400);
  const currency = cur.pool.rule?.currency ?? 'USD';
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM job_bonus_lines WHERE job_id = ?').bind(cur.job.id),
    ...r.lines.map((l) => c.env.DB.prepare('INSERT INTO job_bonus_lines (id, job_id, employee_id, crew_role, share_pct, amount_cents, currency, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), cur.job.id, l.employee_id, l.crew_role, l.share_pct, l.amount_cents, currency, user.username)),
    audit(c.env, user, 'edit', cur.job.id, `Bonus distribution saved: ${r.lines.length} line(s), ${money(r.lines.reduce((a, l) => a + l.amount_cents, 0), currency)} of ${money(cur.pool.cents, currency)}`),
  ]);
  return c.json({ ok: true, bonus: await jobBonus(c.env, user, cur.job.id) });
});

bonus.post('/jobs/:id/approve', async (c) => {
  const user = c.get('user');
  if (!DISTRIBUTORS.includes(user.role)) return c.json({ error: 'Only Admin and SDM accounts approve bonus' }, 403);
  const cur = await jobBonus(c.env, user, c.req.param('id'));
  if (!cur) return c.json({ error: 'Job not found' }, 404);
  if (cur.status !== 'draft') return c.json({ error: cur.status === 'approved' ? 'Already approved' : 'Save the distribution first' }, 409);
  const at = new Date().toISOString();
  await c.env.DB.batch([
    await signStatement(c.env, user, 'bonus', cur.job.id),
    c.env.DB.prepare(`UPDATE job_bonus_lines SET status = 'approved', approved_by = ?, approved_at = ? WHERE job_id = ?`).bind(user.username, at, cur.job.id),
    audit(c.env, user, 'approve', cur.job.id, `Bonus approved for ticket ${cur.job.ticket_no ?? '—'}`),
  ]);
  return c.json({ ok: true, bonus: await jobBonus(c.env, user, cur.job.id) });
});

/** Admin only. Statements already emailed stay recorded; the manual warns corrections can affect them. */
bonus.post('/jobs/:id/reopen', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Only an admin reopens an approved distribution' }, 403);
  const cur = await jobBonus(c.env, user, c.req.param('id'));
  if (!cur) return c.json({ error: 'Job not found' }, 404);
  const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
  if (!String(reason ?? '').trim()) return c.json({ error: 'Say why it is reopened' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE job_bonus_lines SET status = 'draft', approved_by = NULL, approved_at = NULL WHERE job_id = ?`).bind(cur.job.id),
    revokeStatement(c.env, user, 'bonus', cur.job.id, String(reason)),
    audit(c.env, user, 'reopen', cur.job.id, `Bonus reopened for ticket ${cur.job.ticket_no ?? '—'}: ${String(reason).slice(0, 300)}`),
  ]);
  return c.json({ ok: true, bonus: await jobBonus(c.env, user, cur.job.id) });
});

// ---- report and analysis ----

function scope(c: { req: { url: string; query: (k: string) => string | undefined }; get: (k: 'user') => AuthedUser }) {
  const f = parseFilters(new URL(c.req.url).searchParams);
  delete f.status;
  const { where, binds } = filterSql(f);
  return { where: ['j.deleted_at IS NULL', 'j.country IN (SELECT value FROM json_each(?))', ...where], binds: [JSON.stringify(c.get('user').countries), ...binds] };
}

/** Bonus lines with their job, for the Report (per person) and the Analysis (trends). */
bonus.get('/lines', async (c) => {
  const s = scope(c);
  const approvedOnly = c.req.query('approved') !== '0';
  if (approvedOnly) s.where.push(`b.status = 'approved'`);
  const { results } = await c.env.DB.prepare(
    `SELECT b.employee_id, e.full_name, e.eid, b.crew_role, b.amount_cents, b.currency, b.status, b.statement_sent_at,
            j.id AS job_id, j.ticket_no, j.start_date, j.well, j.field, j.location, j.revenue_cents,
            (SELECT group_concat(job_type_name, char(31)) FROM job_services x WHERE x.job_id = j.id) AS services
     FROM job_bonus_lines b JOIN jobs j ON j.id = b.job_id JOIN employees e ON e.id = b.employee_id
     WHERE ${s.where.join(' AND ')} ORDER BY j.start_date DESC LIMIT 20000`,
  ).bind(...s.binds).all();
  return c.json((results as Record<string, unknown>[]).map((r) => ({ ...r, services: r.services ? String(r.services).split('\u001f') : [] })));
});

/** Revenue of completed jobs in the same filters, for Bonus % of Revenue. */
bonus.get('/revenue', async (c) => {
  const s = scope(c);
  const r = await c.env.DB.prepare(`SELECT coalesce(sum(j.revenue_cents), 0) AS revenue, count(*) AS jobs, sum(CASE WHEN j.revenue_cents IS NULL THEN 1 ELSE 0 END) AS missing FROM jobs j WHERE ${s.where.join(' AND ')} AND j.status = 'completed'`)
    .bind(...s.binds).first<{ revenue: number; jobs: number; missing: number }>();
  return c.json(r);
});

/** Emails each person their approved bonus in the current filters (Administrator Manual 1.1 Email Statements). */
bonus.post('/statements', async (c) => {
  const user = c.get('user');
  const s = scope(c);
  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.employee_id, e.full_name, e.contact_email, b.amount_cents, b.currency, j.ticket_no, j.start_date
     FROM job_bonus_lines b JOIN jobs j ON j.id = b.job_id JOIN employees e ON e.id = b.employee_id
     WHERE ${s.where.join(' AND ')} AND b.status = 'approved' ORDER BY e.full_name, j.start_date`,
  ).bind(...s.binds).all<{ id: string; employee_id: string; full_name: string; contact_email: string | null; amount_cents: number; currency: string; ticket_no: string | null; start_date: string | null }>();
  const byPerson = new Map<string, typeof results>();
  for (const r of results) byPerson.set(r.employee_id, [...(byPerson.get(r.employee_id) ?? []), r]);
  let sent = 0;
  const noEmail: string[] = [];
  const at = new Date().toISOString();
  for (const lines of byPerson.values()) {
    const p = lines[0];
    if (!p.contact_email) { noEmail.push(p.full_name); continue; }
    if (!c.env.EMAIL) break;
    const total = lines.reduce((a, l) => a + l.amount_cents, 0);
    const text = [`Dear ${p.full_name},`, '', 'Your approved bonus for the selected period:', '', ...lines.map((l) => `${l.start_date ?? '—'} · ticket ${l.ticket_no ?? '—'} · ${money(l.amount_cents, l.currency)}`), '', `Total: ${money(total, p.currency)}`, '', 'Questions go to your SDM.'].join('\n');
    await c.env.EMAIL.send({ to: p.contact_email, from: { email: c.env.EMAIL_FROM ?? 'slkops@nesrapp.com', name: 'SLK Operations' }, subject: 'Your bonus statement', text, html: `<pre style="font-family:Arial,sans-serif">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>` });
    await c.env.DB.prepare('UPDATE job_bonus_lines SET statement_sent_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(at, JSON.stringify(lines.map((l) => l.id))).run();
    sent++;
  }
  await audit(c.env, user, 'send', 'statements', `Bonus statements: ${sent} sent, ${noEmail.length} without an email${c.env.EMAIL ? '' : ' (email sending not set up)'}`).run();
  return c.json({ sent, noEmail, people: byPerson.size, mailer: !!c.env.EMAIL });
});
