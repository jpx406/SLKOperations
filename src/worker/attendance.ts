import { Hono } from 'hono';
import { EMAIL_RE, MONTH_RE, approvalEmail, groupLabel, isCode, monthDays, rowSummary, type Code } from '../shared/attendance';
import type { AppBindings, AuthedUser, Env } from './env';
import { revokeStatement, signStatement } from './signatures';

// Attendance (S17). People with the Attendance edit right see and edit the whole sheet for their countries;
// everyone else with the tab sees only their own row (linked through employees.wg_username), read-only.
// An approved month is locked for that person until it is unapproved.

const audit = (env: Env, user: AuthedUser, action: string, entity: string, id: string, summary: string) =>
  env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.username, action, entity, id, summary.slice(0, 1000));

const fullView = (user: AuthedUser) => !!user.menus.attendance?.edit;

export const attendance = new Hono<AppBindings>();

attendance.get('/', async (c) => {
  const user = c.get('user');
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7);
  if (!MONTH_RE.test(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);
  const days = monthDays(month);
  const [first, last] = [days[0], days[days.length - 1]];
  const countries = JSON.stringify(user.countries);
  // ?5 = 1 opens the whole sheet, otherwise only the caller's own row. Every statement binds the same five values.
  const who = `e.country IN (SELECT value FROM json_each(?1)) AND (?5 = 1 OR lower(e.wg_username) = lower(?4))`;
  const all = fullView(user) ? 1 : 0;
  const [people, entries, approvals, holidays, assigned] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT e.id, e.country, e.eid, e.full_name, e.title, e.account, e.crew_role, e.reports_to_id, m.full_name AS group_name
       FROM employees e LEFT JOIN employees m ON m.id = e.reports_to_id
       WHERE e.active = 1 AND ${who} ORDER BY coalesce(m.full_name, 'zzz'), e.full_name`,
    ).bind(countries, first, last, user.username, all),
    c.env.DB.prepare(
      `SELECT a.employee_id, a.day, a.code FROM attendance_entries a JOIN employees e ON e.id = a.employee_id
       WHERE a.day BETWEEN ?2 AND ?3 AND ${who}`,
    ).bind(countries, first, last, user.username, all),
    c.env.DB.prepare(
      `SELECT p.employee_id, p.approved_by, p.approved_at FROM attendance_approvals p JOIN employees e ON e.id = p.employee_id
       WHERE p.month = ?2 AND ${who}`,
    ).bind(countries, month, null, user.username, all),
    c.env.DB.prepare(`SELECT id, country, day, name FROM holidays WHERE country IN (SELECT value FROM json_each(?1)) AND day BETWEEN ?2 AND ?3 ORDER BY day`)
      .bind(countries, first, last),
    c.env.DB.prepare(
      `SELECT cr.employee_id, j.id AS job_id, j.ticket_no, j.start_date, j.end_date FROM job_crew cr JOIN jobs j ON j.id = cr.job_id JOIN employees e ON e.id = cr.employee_id
       WHERE j.deleted_at IS NULL AND j.status <> 'canceled' AND j.start_date <= ?3 AND coalesce(j.end_date, j.start_date) >= ?2 AND ${who}`,
    ).bind(countries, first, last, user.username, all),
  ]);
  return c.json({
    month, days, full: fullView(user), people: people.results, entries: entries.results, approvals: approvals.results,
    holidays: holidays.results, assignments: assigned.results,
  });
});

/** Saves a set of cell changes; a null code clears the cell. All or nothing. */
attendance.put('/', async (c) => {
  const user = c.get('user');
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
  const [people, locked] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT id, country FROM employees WHERE id IN (SELECT value FROM json_each(?)) AND country IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(ids), JSON.stringify(user.countries)),
    c.env.DB.prepare(`SELECT employee_id FROM attendance_approvals WHERE month = ? AND employee_id IN (SELECT value FROM json_each(?))`).bind(month, JSON.stringify(ids)),
  ]);
  const country = new Map((people.results as { id: string; country: string }[]).map((p) => [p.id, p.country]));
  if (country.size !== ids.length) return c.json({ error: 'Some people are not in your countries' }, 403);
  if (locked.results.length) return c.json({ error: 'Some rows are approved for this month. Unapprove them first.' }, 409);
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

attendance.post('/approve', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<{ employee_id?: string; month?: string; approved?: boolean }>().catch(() => ({} as { employee_id?: string; month?: string; approved?: boolean }));
  if (!MONTH_RE.test(String(b.month ?? ''))) return c.json({ error: 'month must be YYYY-MM' }, 400);
  const e = await c.env.DB.prepare('SELECT id, full_name, country FROM employees WHERE id = ?').bind(b.employee_id ?? '').first<{ id: string; full_name: string; country: string }>();
  if (!e || !user.countries.includes(e.country)) return c.json({ error: 'Person not found' }, 404);
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

/** Emails the category's approver that the month is ready, with each person's totals. */
attendance.post('/notify', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<{ month?: string; country?: string; name?: string }>().catch(() => ({} as { month?: string; country?: string; name?: string }));
  const month = String(b.month ?? '');
  if (!MONTH_RE.test(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);
  if (!b.country || !user.countries.includes(b.country)) return c.json({ error: 'Pick one of your countries' }, 400);
  const cat = await c.env.DB.prepare('SELECT approver_email FROM attendance_categories WHERE country = ? AND name = ?').bind(b.country, b.name ?? '').first<{ approver_email: string | null }>();
  if (!cat?.approver_email) return c.json({ error: 'This category has no approver email yet. The Ops Manager sets it under Manage categories.' }, 400);
  if (!c.env.EMAIL) return c.json({ error: 'Email sending isn’t set up on the server yet' }, 503);
  const days = monthDays(month);
  const [people, entries, approvals] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT e.id, e.eid, e.full_name, m.full_name AS group_name FROM employees e LEFT JOIN employees m ON m.id = e.reports_to_id WHERE e.active = 1 AND e.country = ? ORDER BY e.full_name`).bind(b.country),
    c.env.DB.prepare(`SELECT a.employee_id, a.day, a.code FROM attendance_entries a JOIN employees e ON e.id = a.employee_id WHERE e.country = ? AND a.day BETWEEN ? AND ?`).bind(b.country, days[0], days[days.length - 1]),
    c.env.DB.prepare(`SELECT p.employee_id FROM attendance_approvals p JOIN employees e ON e.id = p.employee_id WHERE e.country = ? AND p.month = ?`).bind(b.country, month),
  ]);
  const inGroup = (people.results as { id: string; eid: string; full_name: string; group_name: string | null }[]).filter((p) => groupLabel(p.group_name) === b.name);
  if (!inGroup.length) return c.json({ error: 'Nobody is in that category this month' }, 400);
  const codes = new Map((entries.results as { employee_id: string; day: string; code: Code }[]).map((e) => [`${e.employee_id}|${e.day}`, e.code]));
  const done = new Set((approvals.results as { employee_id: string }[]).map((a) => a.employee_id));
  const mail = approvalEmail({
    category: b.name!, month, by: user.fullName, url: `${c.env.APP_URL}/attendance?month=${month}`,
    people: inGroup.map((p) => ({ name: p.full_name, eid: p.eid, approved: done.has(p.id), ...rowSummary(days.map((d) => codes.get(`${p.id}|${d}`))) })),
  });
  await c.env.EMAIL.send({ to: cat.approver_email, from: { email: c.env.EMAIL_FROM ?? 'slkops@nesrapp.com', name: 'SLK Operations' }, subject: mail.subject, html: mail.html, text: mail.text });
  await audit(c.env, user, 'notify', 'attendance_categories', `${b.country}|${b.name}`, `${month} ${b.name}: sent to ${cat.approver_email}`).run();
  return c.json({ ok: true, to: cat.approver_email });
});
