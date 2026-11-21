// The three modules a person opens after signing in (6z.33): the whole SLK Operations Hub, the Knowledge Hub on its
// own, or Competency on its own. Who opens which is set on roles in Users & Roles: the "SLK Operations Hub" right
// opens everything (and with it the other two), the Knowledge Hub and Competency rights open those alone.
// 6z.38: each person can also have their own modules set in Users & Roles (SLK Operations Hub, WIREGUARD,
// Competency), which win over the role; everyone reads the Knowledge Hub, and their role may give them more there.
// 6z.40: Career Development (the Career Development Plan, out of Competency) is a module of its own, with its own
// right, on the same data and users as Competency.

import type { Group } from './menus';

export type ModuleKey = 'slk' | 'knowledge' | 'competency' | 'career';
/** The role right that opens the whole SLK Operations Hub. */
export const SLK_RIGHT = 'slk_ops';
/** The rights a module of its own needs; without the SLK right only these stay. */
const MODULE_RIGHTS: Record<Exclude<ModuleKey, 'slk'>, string> = { knowledge: 'knowledge_hub', competency: 'competency', career: 'career_development' };
/** The right that opens Career Development. */
export const CAREER_RIGHT = 'career_development';
/** Rights that go with any module: the help assistant answers questions on every screen. */
const ALWAYS = ['ai_assistant'];

export const MODULES: { key: ModuleKey; label: string; blurb: string; home: string }[] = [
  { key: 'slk', label: 'SLK Operations Hub', blurb: 'Schedule, jobs from design to closure, quality, attendance, inventory, wires and bonus. Includes the Knowledge Hub, Competency and Career Development.', home: '/operation/schedule' },
  { key: 'knowledge', label: 'Knowledge Hub', blurb: 'Lessons and best practices, SOPs, work instructions, forms, client procedures and reference manuals.', home: '/knowledge' },
  { key: 'competency', label: 'Competency', blurb: 'Experience per person and service, from completed jobs: Basic, Intermediate, Advance and Expert levels.', home: '/competency' },
  { key: 'career', label: 'Career Development', blurb: 'The Career Development Plan: each person\u2019s progress through the steps, the step requirements and the promotion tracker.', home: '/career' },
];

type Rights = Record<string, { view: boolean; edit: boolean; delete: boolean }>;

/** The modules a person can be given one by one. Not set means the role decides. */
export const USER_MODULES = [
  { key: 'slk', label: 'SLK Operations Hub' },
  { key: 'wireguard', label: 'WIREGUARD' },
  { key: 'competency', label: 'Competency' },
  { key: 'career', label: 'Career Development' },
] as const;
export type UserModuleKey = (typeof USER_MODULES)[number]['key'];
export type UserModules = Partial<Record<UserModuleKey, boolean>>;
/** The right that shows the WIREGUARD tile on the module page (WIREGUARD's own sign-in still decides inside it). */
export const WG_RIGHT = 'wireguard';

/** A person's modules as stored (JSON), keeping only true or false for the known keys. */
export function parseUserModules(raw: unknown): UserModules {
  let v: unknown = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { return {}; } }
  if (!v || typeof v !== 'object') return {};
  const out: UserModules = {};
  for (const m of USER_MODULES) { const x = (v as Record<string, unknown>)[m.key]; if (typeof x === 'boolean') out[m.key] = x; }
  return out;
}

const viewOf = (r: Rights[string] | undefined) => ({ view: true, edit: r?.edit ?? false, delete: r?.delete ?? false });

/**
 * Rights after the modules are applied: with the SLK right, the Knowledge Hub and Competency open too (at least to
 * read); without it, only the Knowledge Hub and Competency rights stay, so the rest of the app is closed on the server.
 */
export function applyModules(menus: Rights, modules: UserModules = {}): Rights {
  const given = { ...menus };
  // the person's own modules win over the role
  if (modules.slk === true) given[SLK_RIGHT] = viewOf(given[SLK_RIGHT]);
  if (modules.slk === false) delete given[SLK_RIGHT];
  if (modules.competency === true) given.competency = viewOf(given.competency);
  if (modules.career === true) given[CAREER_RIGHT] = viewOf(given[CAREER_RIGHT]);
  let out: Rights;
  if (given[SLK_RIGHT]?.view) {
    out = { ...given };
    for (const k of Object.values(MODULE_RIGHTS)) out[k] = viewOf(out[k]);
  } else {
    out = Object.fromEntries(Object.entries(given).filter(([k]) => (Object.values(MODULE_RIGHTS) as string[]).includes(k) || ALWAYS.includes(k)));
  }
  if (modules.competency === false) delete out.competency;
  if (modules.career === false) delete out[CAREER_RIGHT];
  // everyone reads the Knowledge Hub; an edit or delete right from the role stays
  out.knowledge_hub = viewOf(out.knowledge_hub);
  // WIREGUARD: the person's choice, else whoever opens the whole hub
  if (modules.wireguard ?? !!out[SLK_RIGHT]?.view) out[WG_RIGHT] = { view: true, edit: false, delete: false };
  else delete out[WG_RIGHT];
  return out;
}

/** Which modules a person may open. */
export function moduleAccess(menus: Record<string, { view: boolean }>): Record<ModuleKey, boolean> {
  const slk = !!menus[SLK_RIGHT]?.view;
  return { slk, knowledge: true, competency: !!menus.competency?.view, career: !!menus[CAREER_RIGHT]?.view };
}

/** Whether the WIREGUARD tile opens for the person. */
export const wireguardAccess = (menus: Record<string, { view: boolean }>) => !!menus[WG_RIGHT]?.view;

/** The module a page belongs to when it is opened from a link: the Knowledge Hub, Competency, or the rest. */
export function moduleOfPath(path: string): ModuleKey {
  if (path === '/knowledge' || path.startsWith('/knowledge/')) return 'knowledge';
  if (path === '/competency' || path.startsWith('/competency/') || path.startsWith('/quality/competency')) return 'competency';
  if (path === '/career' || path.startsWith('/career/')) return 'career';
  return 'slk';
}

/** The menu shown in a module: everything in the SLK Operations Hub, only its own page in the other two. */
export function moduleNav(nav: Group[], m: ModuleKey): Group[] {
  if (m === 'slk') return nav;
  const key = MODULE_RIGHTS[m];
  return nav.map((g) => ({ ...g, pages: g.pages.filter((p) => p.key === key) })).filter((g) => g.pages.length)
    .map((g) => (m === 'competency' ? { ...g, label: 'Competency' } : m === 'career' ? { ...g, label: 'Career Development' } : g));
}

/** The module to show: the one picked, while the page belongs to it; else the page's own, or the whole hub. */
export function currentModule(picked: ModuleKey | null, path: string, access: Record<ModuleKey, boolean>): ModuleKey {
  const own = moduleOfPath(path);
  if (picked && access[picked] && (picked === 'slk' || picked === own)) return picked;
  if (access.slk && own === 'slk') return 'slk';
  return access[own] ? own : access.slk ? 'slk' : own;
}

export const isModuleKey = (v: unknown): v is ModuleKey => v === 'slk' || v === 'knowledge' || v === 'competency' || v === 'career';
