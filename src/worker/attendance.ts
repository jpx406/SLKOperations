import { Hono } from 'hono';
import { EMAIL_RE, MONTH_RE, approvalEmail, isCode, monthDays, rowSummary, type Code } from '../shared/attendance';
import { approveKey, canApprove, canFill, canReview, canSee, reviewKey, type Category, type SheetRow } from '../shared/attendanceSheets';
import { roleLabel } from '../shared/roles';
import type { Rules } from '../shared/approvalRules';
import type { AppBindings, AuthedUser, Env } from './env';
import { AUTO_BY, syncJobDays } from './jobDays';
import { syncPeople } from './people';
import { loadCategories, loadRules } from './rules';
import { revokeStatement, signStatement } from './signatures';

// Attendance (S17), by category and role (shared/attendanceSheets.ts, Users & Roles → Attendance categories and
// → Approvals). Each person sees the rows they fill, review or approve and their own; managers see everything.
// Days on assigned jobs fill in by themselves for categories set that way (jobDays.ts). A category with two steps
// is reviewed first and then approved; a reviewed or approved row is locked until it is taken back.
// Saves, reviews and approvals are checked row by row on the server.

const audit = (env: Env, user: AuthedUser, action: string, entity: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, entity, id, summary.slice(0, 1000));

type Person = SheetRow & { id: string; country: string; eid: string; full_name: string; title: string; account: string; crew_role: string | null; reports_to_id: string | null; reports_to_name: string | null; user_role: string };

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
const names = (rules: Rules, key: string) => (rules[key] ?? []).map(roleLabel).join(' or ') || 'an Admin';

/**
 * The people on attendance in the caller's countries: everyone active in Users & Roles (mirrored into employees by
 * syncPeople), in the category their role is assigned to, unless moved by hand. Roles assigned to "none", and
 * categories that no longer exist, are left off.
 */
async function roster(env: Env, countries: string[], ids?: string[]) {
  await syncPeople(env);
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.country, e.eid, e.full_name, e.title, e.account, e.crew_role, e.reports_to_id, e.wg_username, e.self_updated,
            coalesce(e.attendance_category, rs.sheet) AS attendance_sheet, u.role AS user_role,
            m.full_name AS reports_to_name, m.wg_username AS reports_to_username
     FROM employees e
     JOIN user_roles u ON lower(u.username) = lower(e.wg_username) AND u.active = 1
     LEFT JOIN attendance_role_sheets rs ON rs.role = u.role
     LEFT JOIN employees m ON m.id = e.reports_to_id
     WHERE e.active = 1 AND coalesce(e.attendance_category, rs.sheet) IN (SELECT key FROM attendance_sheets)
       AND e.country IN (SELECT value FROM json_each(?1)) ${ids ? 'AND e.id IN (SELECT value FROM json_each(?2))' : ''}
     ORDER BY e.full_name`,
  ).bind(...(ids ? [JSON.stringify(countries), JSON.stringify(ids)] : [JSON.stringify(countries)])).all<Person>();
  return results;
}

export const attendance = new Hono<AppBindings>();

attendance.get('/', async (c) => {
  const user = c.get('user');
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7);
  if (!MONTH_RE.test(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);
  const days = monthDays(month);
  const [first, last] = [days[0], days[days.length - 1]];
  const [everyone, rules, cats] = await Promise.all([roster(c.env, user.countries), loadRules(c.env), loadCategories(c.env)]);
  const people = everyone.filter((p) => canSee(user, p, rules, cats));
  // days on assigned jobs, worked out again from the schedule before the sheet is read
  await syncJobDays(c.env, people, cats, month, today());
  const ids = JSON.stringify(people.map((p) => p.id));
  const [entries, approvals, reviews, holidays, assigned, updaters] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT employee_id, day, code, updated_by = '${AUTO_BY}' AS auto FROM attendance_entries WHERE day BETWEEN ?2 AND ?3 AND employee_id IN (SELECT value FROM json_each(?1))`).bind(ids, first, last),
    c.env.DB.prepare(`SELECT p.employee_id, coalesce(u.full_name, p.approved_by) AS approved_by, p.approved_at FROM attendance_approvals p LEFT JOIN user_roles u ON u.username = p.approved_by
      WHERE p.month = ?2 AND p.employee_id IN (SELECT value FROM json_each(?1))`).bind(ids, month),
    c.env.DB.prepare(`SELECT r.employee_id, coalesce(u.full_name, r.reviewed_by) AS reviewed_by, r.reviewed_at FROM attendance_reviews r LEFT JOIN user_roles u ON u.username = r.reviewed_by
      WHERE r.month = ?2 AND r.employee_id IN (SELECT value FROM json_each(?1))`).bind(ids, month),
    c.env.DB.prepare(`SELECT id, country, day, name FROM holidays WHERE country IN (SELECT value FROM json_each(?1)) AND day BETWEEN ?2 AND ?3 ORDER BY day`)
      .bind(JSON.stringify(user.countries), first, last),
    c.env.DB.prepare(
      // the days each person is on the job: the job's dates, narrowed when they joined late or left early
      `SELECT * FROM (SELECT cr.employee_id, j.id AS job_id, j.ticket_no, j.well, max(j.start_date, coalesce(cr.start_date, j.start_date)) AS start_date,
         min(coalesce(j.end_date, j.start_date), coalesce(cr.end_date, '9999-12-31')) AS end_date FROM job_crew cr JOIN jobs j ON j.id = cr.job_id
       WHERE j.deleted_at IS NULL AND j.status <> 'canceled' AND j.start_date IS NOT NULL AND cr.employee_id IN (SELECT value FROM json_each(?1)))
       WHERE start_date <= ?3 AND end_date >= ?2 AND start_date <= end_date`,
    ).bind(ids, first, last),
    // who last saved each row this month, by name where SLK Ops knows them
    c.env.DB.prepare(
      `SELECT a.employee_id, CASE WHEN a.updated_by = '${AUTO_BY}' THEN 'From jobs' ELSE coalesce(u.full_name, a.updated_by) END AS updated_by FROM attendance_entries a LEFT JOIN user_roles u ON u.username = a.updated_by
       WHERE a.day BETWEEN ?2 AND ?3 AND a.employee_id IN (SELECT value FROM json_each(?1))
         AND a.updated_at = (SELECT max(b.updated_at) FROM attendance_entries b WHERE b.employee_id = a.employee_id AND b.day BETWEEN ?2 AND ?3)`,
    ).bind(ids, first, last),
  ]);
  const lastBy = new Map((updaters.results as { employee_id: string; updated_by: string }[]).map((r) => [r.employee_id, r.updated_by]));
  // what each category's steps are called, from the rules in force
  const categories = cats.map((k) => ({ ...k, fill_by: k.fill_scope === 'self' ? 'Self' : names(rules, `attendance.${k.key}.fill`), review_by: k.two_step ? names(rules, reviewKey(k.key)) : null, approve_by: names(rules, approveKey(k.key)) }));
  return c.json({
    month, days, full: people.length > people.filter((p) => p.wg_username?.toLowerCase() === user.username.toLowerCase()).length,
    categories,
    people: people.map((p) => ({ ...p, sheet: p.attendance_sheet, can_fill: canFill(user, p, rules, cats), can_review: canReview(user, p, rules, cats), can_approve: canApprove(user, p, rules, cats), updated_by: lastBy.get(p.id) ?? null })),
    entries: entries.results, approvals: approvals.results, reviews: reviews.results, holidays: holidays.results, assignments: assigned.results,
  });
});

/** Saves a set of cell changes; a null code clears the cell. All or nothing. */
attendance.put('/', async (c) => {
  const user = c.get('user');
  if (!user.menus.attendance?.view) return c.json({ error: 'Your access does not include Attendance' }, 403);
  const b = await c.req.json<{ month?: string; changes?: { employee_id: string; day: string; code: string | null }[] }>().catch(() => ({} as { month?: string; changes?: [] }));
  const month = String(b.month ?? '');
  if (!MONTH_RE.test(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);
  const changes = b.changes ?? [];
  if (!changes.length) return c.json({ error: 'Nothing to save' }, 400);
  if (changes.length > 5000) return c.json({ error: 'Too many changes at once; save in parts' }, 400);
  const days = new Set(monthDays(month));
  for (const ch of changes) {
    if (!days.has(ch.day)) return c.json({ error: `${ch.day} is not in ${month}` }, 400);
    if (ch.code !== null && !isCode(ch.code)) return c.json({ error: `Unknown code ${String(ch.code)}` }, 400);
  }
  const ids = [...new Set(changes.map((ch) => ch.employee_id))];
  const people = await roster(c.env, user.countries, ids);
  if (people.length !== ids.length) return c.json({ error: 'Some people are not in your countries' }, 403);
  const [rules, cats] = await Promise.all([loadRules(c.env), loadCategories(c.env)]);
  const refused = people.filter((p) => !canFill(user, p, rules, cats));
  if (refused.length) {
    const p = refused[0];
    const cat = cats.find((k) => k.key === p.attendance_sheet);
    return c.json({ error: `${p.full_name} is in ${cat?.label ?? 'another category'}, filled by ${cat?.fill_scope === 'self' ? 'the person themselves' : names(rules, `attendance.${p.attendance_sheet}.fill`)}. Your role can't fill that row.` }, 403);
  }
  const locked = await c.env.DB.prepare(`SELECT employee_id FROM attendance_approvals WHERE month = ?1 AND employee_id IN (SELECT value FROM json_each(?2))
    UNION SELECT employee_id FROM attendance_reviews WHERE month = ?1 AND employee_id IN (SELECT value FROM json_each(?2))`).bind(month, JSON.stringify(ids)).all();
  const country = new Map(people.map((p) => [p.id, p.country]));
  if (locked.results.length) return c.json({ error: 'Some rows are reviewed or approved for this month. Take that back first.' }, 409);
  const at = new Date().toISOString();
  await c.env.DB.batch([
    ...changes.map((ch) => (ch.code === null
      ? c.env.DB.prepare('DELETE FROM attendance_entries WHERE employee_id = ? AND day = ?').bind(ch.employee_id, ch.day)
      : c.env.DB.prepare(
        `INSERT INTO attendance_entries (id, country, employee_id, day, code, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (employee_id, day) DO UPDATE SET code = ?5, updated_by = ?6, updated_at = ?7`,
      ).bind(crypto.randomUUID(), country.get(ch.employee_id), ch.employee_id, ch.day, ch.code, user.username, at))),
    audit(c.env, user, 'edit', 'attendance', month, `${changes.length} cell(s) for ${ids.length} person(s)`),
  ]);
  return c.json({ ok: true, saved: changes.length });
});

/** First approval of a two-step category. Taking it back is refused once the month is approved. */
attendance.post('/review', async (c) => {
  const user = c.get('user');
  if (!user.menus.attendance?.view) return c.json({ error: 'Your access does not include Attendance' }, 403);
  const b = await c.req.json<{ employee_id?: string; month?: string; reviewed?: boolean }>().catch(() => ({} as { employee_id?: string; month?: string; reviewed?: boolean }));
  if (!MONTH_RE.test(String(b.month ?? ''))) return c.json({ error: 'month must be YYYY-MM' }, 400);
  const [e] = await roster(c.env, user.countries, [String(b.employee_id ?? '')]);
  if (!e) return c.json({ error: 'Person not found' }, 404);
  const [rules, cats] = await Promise.all([loadRules(c.env), loadCategories(c.env)]);
  if (!canReview(user, e, rules, cats)) return c.json({ error: `${e.full_name}'s month is reviewed by ${names(rules, reviewKey(e.attendance_sheet ?? ''))}.` }, 403);
  const approved = await c.env.DB.prepare('SELECT 1 FROM attendance_approvals WHERE employee_id = ? AND month = ?').bind(e.id, b.month).first();
  if (approved) return c.json({ error: 'The month is already approved. Unapprove it first.' }, 409);
  await c.env.DB.batch([
    b.reviewed === false
      ? c.env.DB.prepare('DELETE FROM attendance_reviews WHERE employee_id = ? AND month = ?').bind(e.id, b.month)
      : c.env.DB.prepare(`INSERT INTO attendance_reviews (id, employee_id, month, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (employee_id, month) DO NOTHING`).bind(crypto.randomUUID(), e.id, b.month, user.username, new Date().toISOString()),
    audit(c.env, user, b.reviewed === false ? 'unreview' : 'review', 'attendance', e.id, `${e.full_name} ${b.month}`),
  ]);
  return c.json({ ok: true });
});

attendance.post('/approve', async (c) => {
  const user = c.get('user');
  if (!user.menus.attendance?.view) return c.json({ error: 'Your access does not include Attendance' }, 403);
  const b = await c.req.json<{ employee_id?: string; month?: string; approved?: boolean }>().catch(() => ({} as { employee_id?: string; month?: string; approved?: boolean }));
  if (!MONTH_RE.test(String(b.month ?? ''))) return c.json({ error: 'month must be YYYY-MM' }, 400);
  const [e] = await roster(c.env, user.countries, [String(b.employee_id ?? '')]);
  if (!e) return c.json({ error: 'Person not found' }, 404);
  const [rules, cats] = await Promise.all([loadRules(c.env), loadCategories(c.env)]);
  const cat = cats.find((k) => k.key === e.attendance_sheet);
  if (!canApprove(user, e, rules, cats)) return c.json({ error: `${e.full_name}'s month is approved by ${names(rules, approveKey(e.attendance_sheet ?? ''))}.` }, 403);
  if (b.approved !== false && cat?.two_step) {
    const reviewed = await c.env.DB.prepare('SELECT 1 FROM attendance_reviews WHERE employee_id = ? AND month = ?').bind(e.id, b.month).first();
    if (!reviewed) return c.json({ error: `${e.full_name}'s month needs the review by ${names(rules, reviewKey(cat.key))} first.` }, 409);
  }
  const already = await c.env.DB.prepare('SELECT 1 FROM attendance_approvals WHERE employee_id = ? AND month = ?').bind(e.id, b.month).first();
  const key = `${e.id}|${b.month}`;
  const signing = b.approved === false ? (already ? [revokeStatement(c.env, user, 'attendance', key, 'unapproved')] : []) : already ? [] : [await signStatement(c.env, user, 'attendance', key)];
  await c.env.DB.batch([
    ...signing,
    b.approved === false
      ? c.env.DB.prepare('DELETE FROM attendance_approvals WHERE employee_id = ? AND month = ?').bind(e.id, b.month)
      : c.env.DB.prepare(`INSERT INTO attendance_approvals (id, employee_id, month, approved_by, approved_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (employee_id, month) DO NOTHING`).bind(crypto.randomUUID(), e.id, b.month, user.username, new Date().toISOString()),
    audit(c.env, user, b.approved === false ? 'unapprove' : 'approve', 'attendance', e.id, `${e.full_name} ${b.month}`),
  ]);
  return c.json({ ok: true });
});

attendance.post('/holidays', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<{ country?: string; day?: string; name?: string }>().catch(() => ({} as { country?: string; day?: string; name?: string }));
  if (!b.country || !user.countries.includes(b.country)) return c.json({ error: 'Pick one of your countries' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.day ?? ''))) return c.json({ error: 'Pick the date' }, 400);
  const name = String(b.name ?? '').trim().slice(0, 80);
  if (!name) return c.json({ error: 'Name the holiday' }, 400);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO holidays (id, country, day, name) VALUES (?, ?, ?, ?)').bind(id, b.country, b.day, name),
      audit(c.env, user, 'create', 'holidays', id, `${b.country} ${b.day} ${name}`),
    ]);
  } catch {
    return c.json({ error: `${b.country} already has a holiday on ${b.day}` }, 400);
  }
  return c.json({ ok: true, id }, 201);
});

attendance.delete('/holidays/:id', async (c) => {
  const user = c.get('user');
  const h = await c.env.DB.prepare('SELECT id, country, day, name FROM holidays WHERE id = ?').bind(c.req.param('id')).first<{ id: string; country: string; day: string; name: string }>();
  if (!h || !user.countries.includes(h.country)) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM holidays WHERE id = ?').bind(h.id), audit(c.env, user, 'delete', 'holidays', h.id, `${h.country} ${h.day} ${h.name}`)]);
  return c.json({ ok: true });
});

// ---- categories: an approver email per reporting-line group (set by the Ops Manager) ----

const categoryManager = (user: AuthedUser) => user.role === 'admin' || user.role === 'operations_manager';

attendance.get('/categories', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare('SELECT id, country, name, approver_email FROM attendance_categories WHERE country IN (SELECT value FROM json_each(?)) ORDER BY country, name')
    .bind(JSON.stringify(user.countries)).all();
  return c.json({ categories: results, canManage: categoryManager(user) });
});

attendance.put('/categories', async (c) => {
  const user = c.get('user');
  if (!categoryManager(user)) return c.json({ error: 'Only the Ops Manager sets category approvers' }, 403);
  const b = await c.req.json<{ country?: string; name?: string; approver_email?: string | null }>().catch(() => ({} as { country?: string; name?: string; approver_email?: string | null }));
  if (!b.country || !user.countries.includes(b.country)) return c.json({ error: 'Pick one of your countries' }, 400);
  const name = String(b.name ?? '').trim().slice(0, 120);
  if (!name) return c.json({ error: 'Name the category' }, 400);
  const email = String(b.approver_email ?? '').trim().toLowerCase();
  if (email && !EMAIL_RE.test(email)) return c.json({ error: 'That isn’t an email address' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO attendance_categories (id, country, name, approver_email) VALUES (?, ?, ?, ?)
      ON CONFLICT (country, name) DO UPDATE SET approver_email = excluded.approver_email`).bind(crypto.randomUUID(), b.country, name, email || null),
    audit(c.env, user, 'update', 'attendance_categories', `${b.country}|${name}`, `${b.country} ${name}: approver ${email || 'none'}`),
  ]);
  return c.json({ ok: true });
});

/** Emails the next step's people (reviewers while rows wait for review, otherwise the approvers) in that country,
 *  emails from WIREGUARD, with each person's totals. An override address set under Approver emails is added. */
attendance.post('/notify', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<{ month?: string; country?: string; sheet?: string }>().catch(() => ({} as { month?: string; country?: string; sheet?: string }));
  const month = String(b.month ?? '');
  if (!MONTH_RE.test(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);
  if (!b.country || !user.countries.includes(b.country)) return c.json({ error: 'Pick one of your countries' }, 400);
  const [rules, cats] = await Promise.all([loadRules(c.env), loadCategories(c.env)]);
  const cat: Category | undefined = cats.find((k) => k.key === b.sheet);
  if (!cat) return c.json({ error: 'Unknown category' }, 400);
  if (!c.env.EMAIL) return c.json({ error: 'Email sending isn’t set up on the server yet' }, 503);
  const days = monthDays(month);
  const people = (await roster(c.env, [b.country])).filter((p) => p.attendance_sheet === cat.key && canFill(user, p, rules, cats));
  if (!people.length) return c.json({ error: 'You have nobody in that category this month' }, 400);
  const ids = JSON.stringify(people.map((p) => p.id));
  const [entries, approvals, reviews] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT employee_id, day, code FROM attendance_entries WHERE employee_id IN (SELECT value FROM json_each(?)) AND day BETWEEN ? AND ?`).bind(ids, days[0], days[days.length - 1]),
    c.env.DB.prepare(`SELECT employee_id FROM attendance_approvals WHERE employee_id IN (SELECT value FROM json_each(?)) AND month = ?`).bind(ids, month),
    c.env.DB.prepare(`SELECT employee_id FROM attendance_reviews WHERE employee_id IN (SELECT value FROM json_each(?)) AND month = ?`).bind(ids, month),
  ]);
  const reviewed = new Set((reviews.results as { employee_id: string }[]).map((a) => a.employee_id));
  const step = cat.two_step && people.some((p) => !reviewed.has(p.id)) ? reviewKey(cat.key) : approveKey(cat.key);
  const [approvers, override] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT DISTINCT lower(email) AS email FROM user_roles WHERE active = 1 AND email IS NOT NULL AND role IN (SELECT value FROM json_each(?1))
      AND (role = 'admin' OR EXISTS (SELECT 1 FROM json_each(user_roles.countries) WHERE value = ?2))`).bind(JSON.stringify(rules[step] ?? []), b.country),
    c.env.DB.prepare('SELECT approver_email FROM attendance_categories WHERE country = ? AND name = ?').bind(b.country, cat.label),
  ]);
  const extra = (override.results[0] as { approver_email: string | null } | undefined)?.approver_email;
  const to = [...new Set([...(approvers.results as { email: string }[]).map((r) => r.email), ...(extra ? [extra] : [])])];
  if (!to.length) return c.json({ error: `Nobody who is ${names(rules, step)} in ${b.country} has an email yet. Import users from WIREGUARD, or set an approver email.` }, 400);
  const codes = new Map((entries.results as { employee_id: string; day: string; code: Code }[]).map((e) => [`${e.employee_id}|${e.day}`, e.code]));
  const done = new Set((approvals.results as { employee_id: string }[]).map((a) => a.employee_id));
  const mail = approvalEmail({
    category: cat.label, month, by: user.fullName, url: `${c.env.APP_URL}/attendance?month=${month}`,
    people: people.map((p) => ({ name: p.full_name, eid: p.eid, approved: done.has(p.id), ...rowSummary(days.map((d) => codes.get(`${p.id}|${d}`))) })),
  });
  for (const addr of to) await c.env.EMAIL.send({ to: addr, from: { email: c.env.EMAIL_FROM ?? 'slkops@nesrapp.com', name: 'SLK Operations' }, subject: mail.subject, html: mail.html, text: mail.text });
  await audit(c.env, user, 'notify', 'attendance_categories', `${b.country}|${cat.key}`, `${month} ${cat.label} (${step.endsWith('review') ? 'review' : 'approval'}): sent to ${to.join(', ')}`).run();
  return c.json({ ok: true, to: to.join(', ') });
});

/** Nightly: the current month's days from jobs for everyone, so the sheet is ready before anyone opens it. */
export async function nightlyJobDays(env: Env) {
  const countries = (await env.DB.prepare('SELECT DISTINCT country FROM wg_units WHERE wg_active = 1').all<{ country: string }>()).results.map((r) => r.country);
  const [people, cats] = await Promise.all([roster(env, countries), loadCategories(env)]);
  return syncJobDays(env, people, cats, today().slice(0, 7), today());
}
