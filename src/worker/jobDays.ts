import { monthDays } from '../shared/attendance';
import type { Category } from '../shared/attendanceSheets';
import type { Env } from './env';

// Attendance from the jobs (owner request, 2026-10-26). For people in a category set to fill from jobs, every day
// they are crewed on an ongoing or completed job gets the category's code: start to end for a completed job,
// start to today for an ongoing one (even past its planned end). Each time the sheet is read (and nightly) the days are worked out again, so
// they follow the schedule, and a job that ends earlier or later than planned is rechecked once it's completed.
// Only cells the app filled are touched (updated_by = 'auto:job'): anything typed by hand stays, and a row that is
// reviewed or approved for the month is left alone. A crew member replaced or taken off the job (or who joined it
// late) counts only the days between their own start and end dates on the job.

export const AUTO_BY = 'auto:job';

const addDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export async function syncJobDays(env: Env, people: { id: string; country: string; attendance_sheet: string | null }[], cats: Category[], month: string, today: string) {
  const codeOf = new Map(cats.filter((c) => c.auto_from_jobs).map((c) => [c.key, c.job_code]));
  const list = people.filter((p) => p.attendance_sheet && codeOf.has(p.attendance_sheet));
  if (!list.length) return { added: 0, removed: 0 };
  const days = monthDays(month);
  const [first, last] = [days[0], days[days.length - 1]];
  const ids = JSON.stringify(list.map((p) => p.id));
  const [crew, entries, locks] = await env.DB.batch([
    env.DB.prepare(
      // a person who joined late (a replacement) or left early (removed or replaced) counts only their own days
      `SELECT * FROM (SELECT cr.employee_id, max(j.start_date, coalesce(cr.start_date, j.start_date)) AS start_date,
         min(CASE WHEN j.status = 'ongoing' THEN ?4 ELSE coalesce(j.end_date, j.start_date) END, coalesce(cr.end_date, '9999-12-31')) AS end_date, j.status FROM job_crew cr JOIN jobs j ON j.id = cr.job_id
       WHERE j.deleted_at IS NULL AND j.status IN ('ongoing', 'completed') AND j.start_date IS NOT NULL AND cr.employee_id IN (SELECT value FROM json_each(?3)))
       WHERE start_date <= ?2 AND end_date >= ?1 AND start_date <= end_date`,
    ).bind(first, last, ids, today),
    env.DB.prepare(`SELECT employee_id, day, updated_by FROM attendance_entries WHERE day BETWEEN ?1 AND ?2 AND employee_id IN (SELECT value FROM json_each(?3))`).bind(first, last, ids),
    env.DB.prepare(
      `SELECT employee_id FROM attendance_approvals WHERE month = ?1 AND employee_id IN (SELECT value FROM json_each(?2))
       UNION SELECT employee_id FROM attendance_reviews WHERE month = ?1 AND employee_id IN (SELECT value FROM json_each(?2))`,
    ).bind(month, ids),
  ]);
  const locked = new Set((locks.results as { employee_id: string }[]).map((r) => r.employee_id));
  const want = new Set<string>();
  for (const r of crew.results as { employee_id: string; start_date: string; end_date: string; status: string }[]) {
    if (locked.has(r.employee_id)) continue;
    const end = r.end_date < last ? r.end_date : last;
    for (let d = r.start_date < first ? first : r.start_date; d <= end; d = addDay(d)) want.add(`${r.employee_id}|${d}`);
  }
  const have = new Map((entries.results as { employee_id: string; day: string; updated_by: string | null }[]).map((e) => [`${e.employee_id}|${e.day}`, e.updated_by]));
  const person = new Map(list.map((p) => [p.id, p]));
  const at = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  let added = 0, removed = 0;
  for (const k of want) {
    if (have.has(k)) continue;
    const [id, day] = k.split('|');
    const p = person.get(id)!;
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO attendance_entries (id, country, employee_id, day, code, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), p.country, id, day, codeOf.get(p.attendance_sheet!)!, AUTO_BY, at));
    added++;
  }
  for (const [k, by] of have) {
    if (by !== AUTO_BY || want.has(k) || locked.has(k.split('|')[0])) continue;
    const [id, day] = k.split('|');
    stmts.push(env.DB.prepare('DELETE FROM attendance_entries WHERE employee_id = ? AND day = ? AND updated_by = ?').bind(id, day, AUTO_BY));
    removed++;
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return { added, removed };
}
