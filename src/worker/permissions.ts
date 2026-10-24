import type { MenuRight, Role } from '../shared/types';
import type { Env } from './env';

export const MENU_KEYS = [
  'schedule', 'jobs', 'job_log', 'pre_job_notes', 'database', 'failure_roster', 'eight_min_facts', 'quick_plan',
  'reconciliation', 'statistics', 'npt_analysis', 'utilization', 'competency', 'attendance',
  'inventory_explosive', 'inventory_hardware', 'inventory_mcr', 'wires', 'knowledge_hub', 'users', 'audit', 'ai_assistant',
  'bonus', 'sales_dashboard', 'headcount_roster', 'ai_agent',
] as const;

export async function loadMenus(env: Env, role: Role, username: string): Promise<Record<string, MenuRight>> {
  const menus: Record<string, MenuRight> = {};
  // admins keep every right: removals never apply to them
  if (role === 'admin') {
    for (const k of MENU_KEYS) menus[k] = { view: true, edit: true, delete: true };
    return menus;
  }
  const [perms, grants, contact] = await env.DB.batch([
    env.DB.prepare('SELECT menu_key, can_view, can_edit, can_delete FROM role_permissions WHERE role = ?').bind(role),
    env.DB.prepare('SELECT menu_key, effect, can_edit FROM tab_grants WHERE username = ?').bind(username),
    env.DB.prepare('SELECT 1 FROM employees WHERE wg_username = ? AND is_slk_contact = 1 AND active = 1 LIMIT 1').bind(username),
  ]);
  return effectiveMenus(
    perms.results as { menu_key: string; can_view: number; can_edit: number; can_delete: number }[],
    grants.results as { menu_key: string; effect: 'grant' | 'deny'; can_edit: number }[],
    contact.results.length > 0,
  );
}

/**
 * Role rights + per-person grants − per-person removals (Admin Manual 5.1).
 * Being on the active SLK Contacts list opens Pre-Job Notes (Admin Manual 8.2). A removal wins over both.
 */
export function effectiveMenus(
  perms: { menu_key: string; can_view: number; can_edit: number; can_delete: number }[],
  grants: { menu_key: string; effect: 'grant' | 'deny'; can_edit: number }[],
  isContact: boolean,
): Record<string, MenuRight> {
  const menus: Record<string, MenuRight> = {};
  for (const r of perms) menus[r.menu_key] = { view: !!r.can_view, edit: !!r.can_edit, delete: !!r.can_delete };
  if (isContact) menus.pre_job_notes = { view: true, edit: true, delete: menus.pre_job_notes?.delete ?? false };
  for (const g of grants.filter((x) => x.effect === 'grant')) {
    const cur = menus[g.menu_key] ?? { view: false, edit: false, delete: false };
    menus[g.menu_key] = { view: true, edit: cur.edit || !!g.can_edit, delete: cur.delete };
  }
  for (const g of grants.filter((x) => x.effect === 'deny')) delete menus[g.menu_key];
  return menus;
}

// Every write route and the right it needs. A write with no rule is refused (deny by default),
// the same central-table approach as WIREGUARD's SOX Phase 1 WRITE_RULES.
export const WRITE_RULES: { method: string; re: RegExp; menu: string; action: keyof MenuRight }[] = [
  { method: 'POST', re: /^\/api\/jobs$/, menu: 'jobs', action: 'edit' },
  { method: 'PATCH', re: /^\/api\/jobs\/[^/]+$/, menu: 'jobs', action: 'edit' },
  { method: 'PUT', re: /^\/api\/jobs\/[^/]+\/services$/, menu: 'jobs', action: 'edit' },
  { method: 'PUT', re: /^\/api\/jobs\/[^/]+\/(headcount|crew)$/, menu: 'jobs', action: 'edit' },
  { method: 'POST', re: /^\/api\/jobs\/[^/]+\/move$/, menu: 'schedule', action: 'edit' },
  { method: 'POST', re: /^\/api\/unit-events$/, menu: 'schedule', action: 'edit' },
  { method: 'PATCH', re: /^\/api\/unit-events\/[^/]+$/, menu: 'schedule', action: 'edit' },
  { method: 'DELETE', re: /^\/api\/unit-events\/[^/]+$/, menu: 'schedule', action: 'edit' },
  { method: 'DELETE', re: /^\/api\/jobs\/[^/]+$/, menu: 'jobs', action: 'delete' },
  { method: 'POST', re: /^\/api\/wg\/sync$/, menu: 'schedule', action: 'edit' },
  { method: 'POST', re: /^\/api\/admin\/users$/, menu: 'users', action: 'edit' },
  { method: 'PATCH', re: /^\/api\/admin\/users\/[^/]+$/, menu: 'users', action: 'edit' },
  { method: 'DELETE', re: /^\/api\/admin\/users\/[^/]+$/, menu: 'users', action: 'delete' },
  { method: 'PUT', re: /^\/api\/admin\/users\/[^/]+\/grants$/, menu: 'users', action: 'edit' },
  { method: 'PUT', re: /^\/api\/admin\/role-permissions$/, menu: 'users', action: 'edit' },
  { method: 'POST', re: /^\/api\/database\/(pce|grease-panels|lists)$/, menu: 'database', action: 'edit' },
  { method: 'PATCH', re: /^\/api\/database\/(pce|grease-panels|lists)\/[^/]+$/, menu: 'database', action: 'edit' },
  { method: 'DELETE', re: /^\/api\/database\/(pce|grease-panels)\/[^/]+$/, menu: 'database', action: 'delete' },
  { method: 'PUT', re: /^\/api\/database\/service-profiles$/, menu: 'database', action: 'edit' },
  { method: 'POST', re: /^\/api\/recon\/run$/, menu: 'reconciliation', action: 'edit' },
  { method: 'PATCH', re: /^\/api\/recon\/findings\/[^/]+$/, menu: 'reconciliation', action: 'edit' },
  { method: 'POST', re: /^\/api\/recon\/links$/, menu: 'reconciliation', action: 'edit' },
  { method: 'DELETE', re: /^\/api\/recon\/links\/[^/]+$/, menu: 'reconciliation', action: 'edit' },
];

// Every read route and the tabs that open it (any one is enough). A read with no rule is refused,
// so removing a tab from someone really closes its data, not just its menu entry.
export const READ_RULES: { re: RegExp; menus: string[] | 'any' }[] = [
  { re: /^\/api\/(me|session|config|lookups|sdms|wg\/status)$/, menus: 'any' },
  { re: /^\/api\/schedule$/, menus: ['schedule'] },
  { re: /^\/api\/jobs(\/[^/]+)?$/, menus: ['jobs', 'schedule'] },
  { re: /^\/api\/jobs\/[^/]+\/(crew|wire-options)$/, menus: ['jobs'] },
  { re: /^\/api\/employees$/, menus: ['jobs', 'attendance', 'headcount_roster'] },
  { re: /^\/api\/recon\//, menus: ['reconciliation'] },
  { re: /^\/api\/database$/, menus: ['database'] },
  { re: /^\/api\/admin\//, menus: ['users'] },
];

export function readAllowed(path: string, menus: Record<string, MenuRight>): boolean {
  const rule = READ_RULES.find((r) => r.re.test(path));
  if (!rule) return false;
  return rule.menus === 'any' || rule.menus.some((m) => menus[m]?.view);
}

// Writes that only need a session (or not even that).
export const OPEN_WRITES: { method: string; re: RegExp }[] = [
  { method: 'POST', re: /^\/api\/auth\/login$/ },
  { method: 'POST', re: /^\/api\/auth\/logout$/ },
];

export function ruleFor(method: string, path: string) {
  return WRITE_RULES.find((r) => r.method === method && r.re.test(path));
}

export function isOpenWrite(method: string, path: string) {
  return OPEN_WRITES.some((r) => r.method === method && r.re.test(path));
}
