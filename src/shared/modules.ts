// The three modules a person opens after signing in (6z.33): the whole SLK Operations Hub, the Knowledge Hub on its
// own, or Competency on its own. Who opens which is set on roles in Users & Roles: the "SLK Operations Hub" right
// opens everything (and with it the other two), the Knowledge Hub and Competency rights open those alone.

import type { Group } from './menus';

export type ModuleKey = 'slk' | 'knowledge' | 'competency';
/** The role right that opens the whole SLK Operations Hub. */
export const SLK_RIGHT = 'slk_ops';
/** The rights a module of its own needs; without the SLK right only these stay. */
const MODULE_RIGHTS: Record<Exclude<ModuleKey, 'slk'>, string> = { knowledge: 'knowledge_hub', competency: 'competency' };
/** Rights that go with any module: the help assistant answers questions on every screen. */
const ALWAYS = ['ai_assistant'];

export const MODULES: { key: ModuleKey; label: string; blurb: string; home: string }[] = [
  { key: 'slk', label: 'SLK Operations Hub', blurb: 'Schedule, jobs from design to closure, quality, attendance, inventory, wires and bonus. Includes the Knowledge Hub and Competency.', home: '/operation/schedule' },
  { key: 'knowledge', label: 'Knowledge Hub', blurb: 'Lessons and best practices, SOPs, work instructions, forms, client procedures and reference manuals.', home: '/knowledge' },
  { key: 'competency', label: 'Competency', blurb: 'Experience per person and service, from completed jobs: Basic, Intermediate, Advance and Expert levels.', home: '/competency' },
];

type Rights = Record<string, { view: boolean; edit: boolean; delete: boolean }>;

/**
 * Rights after the modules are applied: with the SLK right, the Knowledge Hub and Competency open too (at least to
 * read); without it, only the Knowledge Hub and Competency rights stay, so the rest of the app is closed on the server.
 */
export function applyModules(menus: Rights): Rights {
  if (menus[SLK_RIGHT]?.view) {
    const out = { ...menus };
    for (const k of Object.values(MODULE_RIGHTS)) out[k] = { view: true, edit: out[k]?.edit ?? false, delete: out[k]?.delete ?? false };
    return out;
  }
  return Object.fromEntries(Object.entries(menus).filter(([k]) => (Object.values(MODULE_RIGHTS) as string[]).includes(k) || ALWAYS.includes(k)));
}

/** Which modules a person may open. */
export function moduleAccess(menus: Record<string, { view: boolean }>): Record<ModuleKey, boolean> {
  const slk = !!menus[SLK_RIGHT]?.view;
  return { slk, knowledge: slk || !!menus.knowledge_hub?.view, competency: slk || !!menus.competency?.view };
}

/** The module a page belongs to when it is opened from a link: the Knowledge Hub, Competency, or the rest. */
export function moduleOfPath(path: string): ModuleKey {
  if (path === '/knowledge' || path.startsWith('/knowledge/')) return 'knowledge';
  if (path === '/competency' || path.startsWith('/competency/') || path.startsWith('/quality/competency')) return 'competency';
  return 'slk';
}

/** The menu shown in a module: everything in the SLK Operations Hub, only its own page in the other two. */
export function moduleNav(nav: Group[], m: ModuleKey): Group[] {
  if (m === 'slk') return nav;
  const key = MODULE_RIGHTS[m];
  return nav.map((g) => ({ ...g, pages: g.pages.filter((p) => p.key === key) })).filter((g) => g.pages.length)
    .map((g) => (m === 'competency' ? { ...g, label: 'Competency' } : g));
}

/** The module to show: the one picked, while the page belongs to it; else the page's own, or the whole hub. */
export function currentModule(picked: ModuleKey | null, path: string, access: Record<ModuleKey, boolean>): ModuleKey {
  const own = moduleOfPath(path);
  if (picked && access[picked] && (picked === 'slk' || picked === own)) return picked;
  if (access.slk && own === 'slk') return 'slk';
  return access[own] ? own : access.slk ? 'slk' : own;
}

export const isModuleKey = (v: unknown): v is ModuleKey => v === 'slk' || v === 'knowledge' || v === 'competency';
