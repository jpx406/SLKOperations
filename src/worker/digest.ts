import { buildDigest, type DigestFinding, type Recipient } from '../shared/digest';
import type { Env } from './env';

// Sends the reconciliation digest after the nightly run. Uses the EMAIL binding (Cloudflare Email Service) when it is
// configured and the sender domain is onboarded; without it the run is recorded and nothing is sent.

export async function digestInputs(env: Env) {
  const [people, findings] = await env.DB.batch([
    env.DB.prepare(
      `SELECT u.username, u.full_name, u.role, u.countries, e.contact_email AS email FROM user_roles u
       LEFT JOIN employees e ON lower(e.wg_username) = lower(u.username) AND e.active = 1
       WHERE u.active = 1 AND u.role IN ('sdm','deputy_sdm','operations_manager','admin')`,
    ),
    env.DB.prepare(
      `SELECT f.id, f.check_code, f.severity, f.country, f.first_seen_at, json_extract(f.detail, '$.summary') AS summary,
              j.ticket_no, coalesce(j.unit_number, json_extract(f.detail, '$.unit')) AS unit_number, j.sdm_username
       FROM recon_findings f LEFT JOIN jobs j ON j.id = f.job_id WHERE f.status = 'open'`,
    ),
  ]);
  const recipients = (people.results as (Omit<Recipient, 'countries'> & { countries: string })[]).map((p) => ({ ...p, countries: JSON.parse(p.countries || '[]') as string[] }));
  return { recipients, findings: findings.results as unknown as DigestFinding[] };
}

export async function sendDigests(env: Env, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const { recipients, findings } = await digestInputs(env);
  let sent = 0, skipped = 0, noEmail = 0;
  for (const r of recipients) {
    const d = buildDigest(r, findings, env.APP_URL, since);
    if (!d) { skipped++; continue; }
    if (!r.email) { noEmail++; continue; }
    if (!env.EMAIL) { skipped++; continue; }
    try {
      await env.EMAIL.send({ to: r.email, from: { email: env.EMAIL_FROM ?? 'slkops@nesrapp.com', name: 'SLK Operations' }, subject: d.subject, html: d.html, text: d.text });
      sent++;
    } catch (e) {
      console.error('digest not sent', r.username, (e as Error).message);
      skipped++;
    }
  }
  await env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), 'nightly', 'digest', 'reconciliation', null, `digest: ${sent} sent, ${noEmail} without an email on the roster, ${skipped} skipped${env.EMAIL ? '' : ' (no EMAIL binding)'}`).run();
  return { sent, noEmail, skipped, mailer: !!env.EMAIL };
}
