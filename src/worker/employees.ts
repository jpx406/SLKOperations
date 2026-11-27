// The people list behind Attendance, job crews and the SLK Contacts list. People are edited in Users & Roles
// (admin only, admin.ts); this checks the fields that are sent.

const CREW_ROLES = ['slickline_supervisor', 'slickline_operator', 'assistant_operator', 'helper', 'trainee', 'other'];
const ROTATIONS = ['60/30', '28/28', '42/21', '35/35', '5/2'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USERNAME = /^NESR-\d+$/i;

type Body = Record<string, unknown>;
const t = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

/** Cleans the fields that were sent. Returns the values or an error. */
export function cleanEmployee(b: Body, creating: boolean): { values: Record<string, unknown> } | { error: string } {
  const v: Record<string, unknown> = {};
  const need = (k: string, label: string, max: number) => {
    if (creating || k in b) { v[k] = t(b[k], max); if (!v[k]) return `${label} is needed`; }
    return null;
  };
  const err = need('eid', 'EID', 20) ?? need('full_name', 'Name', 120) ?? need('title', 'Job title', 80);
  if (err) return { error: err };
  if ('eid' in v && !/^[A-Za-z0-9-]+$/.test(String(v.eid))) return { error: 'EID takes letters, digits and dashes only' };
  if ('account' in b) v.account = t(b.account, 20) || 'SLK';
  if ('crew_role' in b) { const r = t(b.crew_role, 40); if (r && !CREW_ROLES.includes(r)) return { error: 'Unknown crew role' }; v.crew_role = r || null; }
  if ('rotation' in b) { const r = t(b.rotation, 10) || '60/30'; if (!ROTATIONS.includes(r)) return { error: 'Unknown rotation' }; v.rotation = r; }
  if ('reports_to_id' in b) v.reports_to_id = t(b.reports_to_id, 64) || null;
  if ('wg_username' in b) { const u = t(b.wg_username, 40).toUpperCase(); if (u && !USERNAME.test(u)) return { error: 'WIREGUARD username looks like NESR-12345' }; v.wg_username = u || null; }
  if ('contact_email' in b) { const e = t(b.contact_email, 120); if (e && !EMAIL.test(e)) return { error: 'That email address looks wrong' }; v.contact_email = e || null; }
  if ('contact_mobile' in b) { const m = t(b.contact_mobile, 30); if (m && !/^[+0-9 ()-]{6,30}$/.test(m)) return { error: 'Mobile takes digits, spaces and + only' }; v.contact_mobile = m || null; }
  // a person moved by hand to another attendance category (checked against the categories by the caller)
  if ('attendance_category' in b && b.attendance_category) { const k = t(b.attendance_category, 40); if (!/^[a-z0-9_]+$/.test(k)) return { error: 'Unknown attendance category' }; v.attendance_category = k; }
  for (const k of ['is_slk_contact', 'active', 'self_updated'] as const) if (k in b) v[k] = b[k] === true || b[k] === 1 ? 1 : 0;
  return { values: v };
}
