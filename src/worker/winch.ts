import { Hono } from 'hono';
import { GUIDE_DEFAULTS, checkGuide, lineKind, type WinchLine } from '../shared/winchGuide';
import type { AppBindings } from './env';
import { getJob } from './jobs';

// Winch guidelines (6z.42): the Speed and Jarring Guidelines for slickline wire and the seasoning rules for braided
// line, kept once for everyone. Anyone who opens jobs reads them; only an admin changes them. Stored as one JSON value
// beside the other Knowledge Hub settings, since the guidelines are SOP-04 documents.

const KEY = 'winch-guide';
export const winch = new Hono<AppBindings>();

winch.get('/guide', async (c) => {
  const row = await c.env.DB.prepare(`SELECT s.value, s.updated_at, coalesce(u.full_name, s.updated_by) AS by FROM knowledge_settings s
    LEFT JOIN user_roles u ON u.username = s.updated_by WHERE s.key = ?`).bind(KEY).first<{ value: string; updated_at: string; by: string | null }>();
  let guide = GUIDE_DEFAULTS;
  if (row) { try { guide = checkGuide(JSON.parse(row.value)) ?? GUIDE_DEFAULTS; } catch { /* keep the defaults */ } }
  return c.json({ guide, saved: !!row, updatedAt: row?.updated_at ?? null, updatedBy: row?.by ?? null, canEdit: c.get('user').role === 'admin' });
});

winch.put('/guide', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: 'Only an admin can change the winch guidelines' }, 403);
  const body = await c.req.json().catch(() => null);
  const guide = checkGuide((body as { guide?: unknown } | null)?.guide);
  if (!guide) return c.json({ error: 'Send the guidelines as { guide }' }, 400);
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO knowledge_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(KEY, JSON.stringify(guide), user.username, now),
    c.env.DB.prepare('INSERT INTO audit_log (id, username, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), user.username, 'edit', 'winch_guide', KEY, `winch guidelines: ${guide.wire.groups.length} speed rows, braided seasoned after ${guide.braided.seasonedRuns} runs`),
  ]);
  return c.json({ guide, saved: true, updatedAt: now, updatedBy: user.fullName, canEdit: true });
});

/**
 * The winch check kept with the job (6z.43): the card's choices as JSON, saved as they change. Anyone who can open
 * the job reads it; saving needs the right to edit jobs.
 */
winch.get('/state/:jobId', async (c) => {
  const job = await getJob(c.env, c.get('user'), c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const row = await c.env.DB.prepare(`SELECT w.state, w.updated_at, coalesce(u.full_name, w.updated_by) AS by FROM winch_checks w
    LEFT JOIN user_roles u ON u.username = w.updated_by WHERE w.job_id = ?`).bind(job.id).first<{ state: string; updated_at: string; by: string | null }>();
  let state: unknown = null;
  if (row) { try { state = JSON.parse(row.state); } catch { /* unreadable: start again */ } }
  return c.json({ state, updatedAt: row?.updated_at ?? null, updatedBy: row?.by ?? null, canEdit: !!c.get('user').menus.jobs?.edit });
});

winch.put('/state/:jobId', async (c) => {
  const user = c.get('user');
  const job = await getJob(c.env, user, c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const text = await c.req.text();
  if (text.length > 400_000) return c.json({ error: 'The winch check is too large to save' }, 413);
  let state: unknown;
  try { state = JSON.parse(text); } catch { return c.json({ error: 'Send the winch check as JSON' }, 400); }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return c.json({ error: 'Send the winch check as an object' }, 400);
  const now = new Date().toISOString();
  await c.env.DB.prepare(`INSERT INTO winch_checks (job_id, state, updated_by, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (job_id) DO UPDATE SET state = excluded.state, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(job.id, JSON.stringify(state), user.username, now).run();
  return c.json({ ok: true, updatedAt: now, updatedBy: user.fullName });
});

/** The job's wire from WIREGUARD: size and grade (wire or braided line), breaking strength and runs on it up to the job. */
winch.get('/line/:jobId', async (c) => {
  const job = await getJob(c.env, c.get('user'), c.req.param('jobId'));
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const serial = job.wire_serial_number ?? null;
  if (!serial) return c.json({ serial: null, grade: null, size: null, mbl: null, runs: null, kind: null } satisfies WinchLine);
  const [w, r] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT wire_grade, wire_size, rated_mbl_lb FROM wg_wires WHERE wire_serial_number = ?').bind(serial),
    c.env.DB.prepare(`SELECT count(*) AS n FROM wg_runs WHERE wire_serial_number = ? AND wg_active = 1 AND is_cut_only = 0 AND job_date <= ?`)
      .bind(serial, (job.start_date ?? new Date().toISOString()).slice(0, 10)),
  ]);
  const wire = w.results[0] as { wire_grade: string | null; wire_size: string | null; rated_mbl_lb: number | null } | undefined;
  const runs = (r.results[0] as { n: number } | undefined)?.n ?? 0;
  return c.json({
    serial, grade: wire?.wire_grade ?? null, size: wire?.wire_size ?? null, mbl: wire?.rated_mbl_lb ?? null,
    runs: wire ? runs : null, kind: wire ? lineKind(wire.wire_size, wire.wire_grade) : null,
  } satisfies WinchLine);
});
