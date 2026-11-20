// Users & Roles housekeeping (6z.38): what keeps a person from being deleted, and the reconciliation of the three
// lists of people: People (SLK Ops Users & Roles), Competency users, and WIREGUARD's accounts. WIREGUARD is only
// read: a fix changes SLK Ops or Competency, never WIREGUARD.

/** The Competency dataset lists that hold a person's records, each row carrying the person's register ID as empId. */
export const COMPETENCY_RECORD_LISTS = ['experience', 'training', 'certs', 'assessments', 'examResults', 'progress', 'cdpProgress'] as const;

/** How many Competency records a person has in the dataset, by any of their IDs (username, employee record). */
export function competencyRecords(dataset: unknown, ids: string[]): { records: number; inRegister: boolean } {
  const want = new Set(ids.filter(Boolean).map((x) => x.toLowerCase()));
  const d = (dataset && typeof dataset === 'object' ? dataset : {}) as Record<string, unknown>;
  const hit = (v: unknown) => typeof v === 'string' && want.has(v.toLowerCase());
  let records = 0;
  for (const k of COMPETENCY_RECORD_LISTS) {
    const list = d[k];
    if (Array.isArray(list)) records += list.filter((r) => r && typeof r === 'object' && hit((r as { empId?: unknown }).empId)).length;
  }
  const emps = Array.isArray(d.employees) ? d.employees : [];
  return { records, inRegister: emps.some((e) => e && typeof e === 'object' && hit((e as { id?: unknown }).id)) };
}

export interface PersonRecords {
  /** WIREGUARD still has an account for the person; null when WIREGUARD could not be reached. */
  wireguard: boolean | null;
  competency: { profile: boolean; records: number; inRegister: boolean };
  slk: { crew: number; attendance: number; signatures: number; bonus: number };
}

/** Why the person can't be deleted (then they can only be deactivated). Empty means they can be deleted. */
export function deleteBlockers(r: PersonRecords): string[] {
  const out: string[] = [];
  if (r.wireguard === null) out.push('WIREGUARD could not be reached to check for an account. Try again later.');
  if (r.wireguard) out.push('They have an account in WIREGUARD');
  if (r.competency.profile) out.push('They are set up as a Competency user');
  if (r.competency.records) out.push(`They have ${r.competency.records} Competency record${r.competency.records === 1 ? '' : 's'}`);
  else if (r.competency.inRegister) out.push('They are in the Competency employee register');
  if (r.slk.crew) out.push(`They are on the crew of ${r.slk.crew} job${r.slk.crew === 1 ? '' : 's'}`);
  if (r.slk.attendance) out.push(`They have ${r.slk.attendance} attendance day${r.slk.attendance === 1 ? '' : 's'}`);
  if (r.slk.bonus) out.push(`They have ${r.slk.bonus} bonus line${r.slk.bonus === 1 ? '' : 's'}`);
  if (r.slk.signatures) out.push(`They signed ${r.slk.signatures} document${r.slk.signatures === 1 ? '' : 's'}`);
  return out;
}

// ---- reconciliation ------------------------------------------------------------------------------------------------

export interface ReconPerson { username: string; full_name: string; email: string | null; employee_eid: string | null; active: number; wg_active: number | null }
export interface ReconWgUser { username: string; full_name?: string | null; email?: string | null; employee_id?: string | null; active?: number | boolean | null }
export interface ReconProfile { username: string; employee_id: string | null; status: string }
export interface ReconRegister { id: string; name?: string | null }

export type FixAction = 'add_from_wg' | 'deactivate' | 'use_wg_details' | 'remove_profile' | 'competency_inactive' | 'add_profile';
export const FIX_LABEL: Record<FixAction, string> = {
  add_from_wg: 'Add to People',
  deactivate: 'Deactivate in SLK Ops',
  use_wg_details: 'Use the WIREGUARD details',
  remove_profile: 'Remove from Competency',
  competency_inactive: 'Mark inactive in Competency',
  add_profile: 'Add to Competency as Viewer',
};

export interface ReconIssue {
  kind: 'wg_missing' | 'not_in_wg' | 'wg_inactive' | 'details' | 'competency_orphan' | 'competency_status' | 'no_competency' | 'register_extra';
  /** problem: the lists disagree in a way that matters; note: worth a look. */
  level: 'problem' | 'note';
  username: string;
  name: string;
  detail: string;
  fix: FixAction | null;
}

const wgOn = (u: ReconWgUser) => (u.active === undefined || u.active === null ? true : !!Number(u.active));
const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Compares People, WIREGUARD and Competency. `wg` is null when WIREGUARD could not be read (its checks are skipped).
 * Each issue names one person and at most one fix.
 */
export function reconcileUsers(people: ReconPerson[], wg: ReconWgUser[] | null, profiles: ReconProfile[], register: ReconRegister[]): ReconIssue[] {
  const out: ReconIssue[] = [];
  const byUser = new Map(people.map((p) => [p.username.toLowerCase(), p]));
  const profileOf = new Map(profiles.map((p) => [p.username.toLowerCase(), p]));
  if (wg) {
    const wgBy = new Map(wg.map((u) => [u.username.toLowerCase(), u]));
    for (const u of wg) {
      if (!byUser.has(u.username.toLowerCase())) {
        out.push({ kind: 'wg_missing', level: wgOn(u) ? 'problem' : 'note', username: u.username, name: (u.full_name ?? '').trim() || u.username,
          detail: wgOn(u) ? 'In WIREGUARD but not in People' : 'In WIREGUARD (switched off there) but not in People', fix: wgOn(u) ? 'add_from_wg' : null });
      }
    }
    for (const p of people) {
      const w = wgBy.get(p.username.toLowerCase());
      if (!w) {
        if (p.active) out.push({ kind: 'not_in_wg', level: 'problem', username: p.username, name: p.full_name, detail: 'Active in People but has no WIREGUARD account, so they cannot sign in with a password', fix: 'deactivate' });
        continue;
      }
      if (!wgOn(w) && p.active) out.push({ kind: 'wg_inactive', level: 'problem', username: p.username, name: p.full_name, detail: 'Switched off in WIREGUARD but active in People', fix: 'deactivate' });
      const diffs = [
        w.full_name && norm(w.full_name) !== norm(p.full_name) ? `name "${p.full_name}" here, "${w.full_name.trim()}" in WIREGUARD` : null,
        w.email && norm(w.email) !== norm(p.email) ? `email ${p.email || '(none)'} here, ${w.email} in WIREGUARD` : null,
        w.employee_id && norm(w.employee_id) !== norm(p.employee_eid) ? `employee ID ${p.employee_eid || '(none)'} here, ${w.employee_id} in WIREGUARD` : null,
      ].filter((x): x is string => !!x);
      if (diffs.length) out.push({ kind: 'details', level: 'problem', username: p.username, name: p.full_name, detail: `Different details: ${diffs.join('; ')}`, fix: 'use_wg_details' });
    }
  }
  for (const pr of profiles) {
    const p = byUser.get(pr.username.toLowerCase());
    if (!p) { out.push({ kind: 'competency_orphan', level: 'problem', username: pr.username, name: pr.username, detail: 'A Competency user with no SLK Ops user', fix: 'remove_profile' }); continue; }
    const w = wg?.find((u) => u.username.toLowerCase() === p.username.toLowerCase());
    const off = !p.active || p.wg_active === 0 || (!!w && !wgOn(w));
    if (off && pr.status === 'Active') out.push({ kind: 'competency_status', level: 'problem', username: p.username, name: p.full_name, detail: 'Deactivated in SLK Ops or WIREGUARD but Active in Competency', fix: 'competency_inactive' });
  }
  for (const p of people) {
    if (p.active && p.wg_active !== 0 && !profileOf.has(p.username.toLowerCase())) {
      out.push({ kind: 'no_competency', level: 'note', username: p.username, name: p.full_name, detail: 'Active in SLK Ops but not set up in Competency', fix: 'add_profile' });
    }
  }
  const known = new Set<string>();
  for (const pr of profiles) { known.add(pr.username.toLowerCase()); if (pr.employee_id) known.add(pr.employee_id.toLowerCase()); }
  // a register entry for a SLK Ops user is covered by "Not in Competency" (adding them links it)
  for (const p of people) known.add(p.username.toLowerCase());
  for (const e of register) {
    if (e.id && !known.has(e.id.toLowerCase())) {
      out.push({ kind: 'register_extra', level: 'note', username: e.id, name: (e.name ?? '').trim() || e.id, detail: 'In the Competency employee register but not linked to a Competency user. Link or remove them in Competency.', fix: null });
    }
  }
  const order = { problem: 0, note: 1 };
  return out.sort((a, b) => order[a.level] - order[b.level] || a.name.localeCompare(b.name));
}
