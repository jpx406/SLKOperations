import type { Role } from './types';

// Who approves, signs or fills each part of a job, and the attendance categories (owner request, 2026-10-26).
// Every rule has a default (what the app did before); Users & Roles → Approvals can change the roles of any rule,
// and the change is stored in approval_rules. Admin is always allowed and isn't listed.
// JRA approval levels come from the JRA forms themselves (each form names its levels, like "Cell Leader" or
// "Ops or Technical Manager"), so each level found on a form gets its own rule.

export type RuleGroup = 'Job' | 'JRA' | 'Closure checklist' | 'Job forms' | 'Bonus' | 'Attendance';
export interface RuleDef { key: string; group: RuleGroup; label: string; help?: string; defaults: Role[] }

const MANAGERS: Role[] = ['sdm', 'deputy_sdm', 'operations_manager'];
const PLANNERS: Role[] = ['sales', ...MANAGERS, 'sqm'];
const FIELD_CREW: Role[] = ['slickline_supervisor', 'slickline_operator', 'foreman', ...MANAGERS, 'sqm'];
const PREP: Role[] = [...new Set([...PLANNERS, ...FIELD_CREW])];
const QUALITY: Role[] = ['sqm', ...MANAGERS];

export const STATIC_RULES: RuleDef[] = [
  { key: 'job.sdm', group: 'Job', label: 'Can be the job’s SDM', help: 'Listed in the SDM picker on Design', defaults: MANAGERS },
  { key: 'job.design', group: 'Job', label: 'Design: the request', help: 'Field ticket, DRSS, DMR, run details, dates, account, area, rig, well, conveyance, status', defaults: PLANNERS },
  { key: 'job.design_sdm', group: 'Job', label: 'Design: SDM, unit, end date and program in place', defaults: MANAGERS },
  { key: 'job.prep', group: 'Job', label: 'Preparation: well, wire, pressure control, toolstring', defaults: PREP },
  { key: 'job.exec', group: 'Job', label: 'Execution: times, runs, depths, NPT and service details', defaults: FIELD_CREW },
  { key: 'job.op_hours', group: 'Job', label: 'Override the operating hours', defaults: ['sdm', 'operations_manager'] },
  { key: 'jra.decide', group: 'JRA', label: 'Approve or reject any JRA', help: 'On top of the person the JRA was sent to', defaults: ['operations_manager'] },
  { key: 'closure.signoff', group: 'Closure checklist', label: 'Sign-off: job log, field ticket, job package, wellsite audit, WIREGUARD runs', defaults: FIELD_CREW },
  { key: 'closure.failure', group: 'Closure checklist', label: 'Failure follow-up: 8 Min. Facts, reports, GEARS, failure description', defaults: QUALITY },
  { key: 'closure.service', group: 'Closure checklist', label: 'Service order and bonus remarks', defaults: ['sdm', 'operations_manager'] },
  { key: 'closure.revenue', group: 'Closure checklist', label: 'Ticket value (revenue)', defaults: ['sdm', 'sales'] },
  { key: 'closure.man_hours', group: 'Closure checklist', label: 'Override the man-hours and travel km', help: 'Worked out by the app: operating hours × people assigned, and distance to location × 2', defaults: ['sdm', 'deputy_sdm'] },
  { key: 'forms.approve', group: 'Job forms', label: 'Approve job checklists and the job package', help: 'The job’s own SDM always can. Approved forms are filed as PDFs; only an admin reopens one.', defaults: ['sdm', 'deputy_sdm'] },
  { key: 'bonus.approve', group: 'Bonus', label: 'Distribute and approve the crew bonus on Closure', defaults: ['sdm', 'deputy_sdm'] },
  { key: 'bonus.reopen', group: 'Bonus', label: 'Reopen an approved bonus distribution', defaults: [] },
];

export const jraLevelKey = (label: string) => `jra.level:${label.trim().toLowerCase()}`;

/** A sensible first guess for who approves a JRA level, from its name; the admin adjusts it in Approvals. */
export function jraLevelDefaults(label: string): Role[] {
  const l = label.toLowerCase();
  const out: Role[] = [];
  if (/cell|leader|supervisor|foreman/.test(l)) out.push('foreman', 'slickline_supervisor');
  if (/\bsdm\b|service delivery/.test(l)) out.push('sdm', 'deputy_sdm');
  if (/ops|operations/.test(l)) out.push('operations_manager');
  if (/technical|quality|sqm/.test(l)) out.push('sqm');
  if (/country|director/.test(l)) out.push('director', 'operations_manager');
  return out.length ? [...new Set(out)] : ['sdm', 'deputy_sdm', 'operations_manager'];
}

export function jraLevelRule(label: string): RuleDef {
  return { key: jraLevelKey(label), group: 'JRA', label: `JRA at level “${label}”: who it can be sent to and who approves it`, defaults: jraLevelDefaults(label) };
}

export type Rules = Record<string, Role[]>;

/** The rules in force: stored overrides on top of the defaults, for the static rules, the JRA levels given and any
 *  other rules passed in (the attendance categories bring theirs, see attendanceSheets.categoryRules). */
export function resolveRules(stored: { key: string; roles: string }[], jraLevels: string[] = [], extra: RuleDef[] = []): Rules {
  const out: Rules = {};
  for (const r of [...STATIC_RULES, ...jraLevels.map(jraLevelRule), ...extra]) out[r.key] = r.defaults;
  for (const s of stored) {
    try { const v = JSON.parse(s.roles); if (Array.isArray(v)) out[s.key] = v.filter((x) => typeof x === 'string'); } catch { /* keep the default */ }
  }
  return out;
}

/** Whether a role may do what a rule covers. Admin always may. Without loaded rules, the defaults apply. */
export function allowed(rules: Rules | null | undefined, key: string, role: Role): boolean {
  if (role === 'admin') return true;
  const list = rules?.[key] ?? STATIC_RULES.find((r) => r.key === key)?.defaults ?? (key.startsWith('jra.level:') ? jraLevelDefaults(key.slice(10)) : []);
  return list.includes(role);
}
