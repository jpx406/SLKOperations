import type { Env } from './env';

// Users & Roles is the list of people (the Headcount Roster page is gone). Attendance, job crews and the SLK
// contacts still read the employees table, so every SLK Ops user is mirrored there, linked by employees.wg_username:
// added when they appear, name, email and active kept in step. Job title, account, crew role, foreman, SELF and
// SLK contact are edited on the person in Users & Roles and live on the employees row.

/** Country of a user's attendance row: their WIREGUARD country, else their first SLK Ops country, else (an admin
 *  who sees every country) the first country WIREGUARD has units in. */
const COUNTRY = `coalesce(nullif(u.wg_country, ''), json_extract(u.countries, '$[0]'), (SELECT min(country) FROM wg_units WHERE wg_active = 1))`;

export async function syncPeople(env: Env) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO employees (id, country, eid, full_name, title, account, wg_username, active, contact_email)
       SELECT lower(hex(randomblob(16))), ${COUNTRY}, coalesce(nullif(u.employee_eid, ''), u.username), u.full_name,
              coalesce(nullif(u.wg_role, ''), 'Staff'), 'SLK', u.username, u.active, u.email
       FROM user_roles u
       WHERE ${COUNTRY} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM employees e WHERE lower(e.wg_username) = lower(u.username))`,
    ),
    env.DB.prepare(
      `UPDATE employees SET
         full_name = (SELECT u.full_name FROM user_roles u WHERE lower(u.username) = lower(employees.wg_username)),
         active = (SELECT CASE WHEN u.active = 1 AND coalesce(u.wg_active, 1) = 1 THEN 1 ELSE 0 END FROM user_roles u WHERE lower(u.username) = lower(employees.wg_username)),
         contact_email = coalesce(contact_email, (SELECT u.email FROM user_roles u WHERE lower(u.username) = lower(employees.wg_username)))
       WHERE wg_username IS NOT NULL AND EXISTS (SELECT 1 FROM user_roles u WHERE lower(u.username) = lower(employees.wg_username))`,
    ),
  ]);
}

/** The employees row of a user, made if missing. */
export async function personOf(env: Env, username: string) {
  await syncPeople(env);
  return env.DB.prepare('SELECT * FROM employees WHERE lower(wg_username) = lower(?)').bind(username).first<{ id: string; country: string; full_name: string }>();
}
