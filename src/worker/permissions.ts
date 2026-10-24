import type { MenuRight, Role } from '../shared/types';
import type { Env } from './env';

export const MENU_KEYS = [
  'schedule', 'jobs', 'job_log', 'pre_job_notes', 'database', 'failure_roster', 'eight_min_facts', 'quick_plan',
  'reconciliation', 'statistics', 'npt_analysis', 'utilization', 'competency', 'attendance',
  'inventory_explosive', 'inventory_hardware', 'inventory_mcr', 'wires', 'knowledge_hub', 'users', 'audit', 'ai_assistant',
] as const;

export async function loadMenus(env: Env, role: Role, username: string): Promise<Record<string, MenuRight>> {
  const menus: Record<string, MenuRight> = {};
  if (role === 'admin') {
    for (const k of MENU_KEYS) menus[k] = { view: true, edit: true, delete: true };
    return menus;
  }
  const [perms, grants] = await env.DB.batch([
    env.DB.prepare('SELECT menu_key, can_view, can_edit, can_delete FROM role_permissions WHERE role = ?').bind(role),
    env.DB.prepare('SELECT menu_key, can_edit FROM tab_grants WHERE username = ?').bind(username),
  ]);
  for (const r of perms.results as { menu_key: string; can_view: number; can_edit: number; can_delete: number }[]) {
    menus[r.menu_key] = { view: !!r.can_view, edit: !!r.can_edit, delete: !!r.can_delete };
  }
  for (const g of grants.results as { menu_key: string; can_edit: number }[]) {
    const cur = menus[g.menu_key] ?? { view: false, edit: false, delete: false };
    menus[g.menu_key] = { view: true, edit: cur.edit || !!g.can_edit, delete: cur.delete };
  }
  return menus;
}

// Every write route and the right it needs. A write with no rule is refused (deny by default),
// the same central-table approach as WIREGUARD's SOX Phase 1 WRITE_RULES.
export const WRITE_RULES: { method: string; re: RegExp; menu: string; action: keyof MenuRight }[] = [
  { method: 'POST', re: /^\/api\/jobs$/, menu: 'jobs', action: 'edit' },
  { method: 'PATCH', re: /^\/api\/jobs\/[^/]+$/, menu: 'jobs', action: 'edit' },
  { method: 'PUT', re: /^\/api\/jobs\/[^/]+\/services$/, menu: 'jobs', action: 'edit' },
  { method: 'DELETE', re: /^\/api\/jobs\/[^/]+$/, menu: 'jobs', action: 'delete' },
  { method: 'POST', re: /^\/api\/wg\/sync$/, menu: 'schedule', action: 'edit' },
];

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
