import { describe, expect, it } from 'vitest';
import { NAV, menuClusters, visibleNav } from '../src/shared/menus';
import { applyModules, currentModule, moduleAccess, moduleNav, moduleOfPath } from '../src/shared/modules';
import { MENU_KEYS, effectiveMenus } from '../src/worker/permissions';

const R = (view = true, edit = false) => ({ view, edit, delete: false });
const row = (menu_key: string, can_edit = 0) => ({ menu_key, can_view: 1, can_edit, can_delete: 0 });

describe('modules after sign-in (6z.33)', () => {
  it('the SLK Operations Hub right opens all three modules, and the Knowledge Hub and Competency with it', () => {
    const m = applyModules({ slk_ops: R(), jobs: R(true, true) });
    expect(moduleAccess(m)).toEqual({ slk: true, knowledge: true, competency: true });
    expect(m.knowledge_hub).toEqual(R());
    expect(m.competency).toEqual(R());
    expect(m.jobs).toEqual(R(true, true));
    // an edit right it already had is kept
    expect(applyModules({ slk_ops: R(), knowledge_hub: R(true, true) }).knowledge_hub.edit).toBe(true);
  });

  it('without it, only the Knowledge Hub and Competency stay open, also on the server', () => {
    const menus = applyModules(effectiveMenus([row('knowledge_hub', 1), row('jobs', 1), row('schedule'), row('ai_assistant')], [], false));
    expect(Object.keys(menus).sort()).toEqual(['ai_assistant', 'knowledge_hub']);
    expect(moduleAccess(menus)).toEqual({ slk: false, knowledge: true, competency: false });
    expect(moduleAccess(applyModules(effectiveMenus([row('competency')], [], false)))).toEqual({ slk: false, knowledge: false, competency: true });
    // a person-level grant of the hub opens it for that person; a removal closes it
    expect(moduleAccess(applyModules(effectiveMenus([row('knowledge_hub')], [{ menu_key: 'slk_ops', effect: 'grant', can_edit: 0 }], false))).slk).toBe(true);
    expect(moduleAccess(applyModules(effectiveMenus([row('slk_ops'), row('jobs')], [{ menu_key: 'slk_ops', effect: 'deny', can_edit: 0 }], false)))).toEqual({ slk: false, knowledge: false, competency: false });
  });

  it('each module shows only its own menu; the hub shows everything', () => {
    const all = visibleNav(Object.fromEntries(MENU_KEYS.map((k) => [k, R()])));
    expect(moduleNav(all, 'slk')).toBe(all);
    expect(moduleNav(all, 'knowledge').flatMap((g) => g.pages.map((p) => p.path))).toEqual(['/knowledge']);
    expect(moduleNav(all, 'competency')).toEqual([{ label: 'Competency', pages: [NAV.flatMap((g) => g.pages).find((p) => p.key === 'competency')] }]);
  });

  it('the module follows the page opened from a link, and a picked module while its pages are open', () => {
    const all = { slk: true, knowledge: true, competency: true };
    expect(moduleOfPath('/knowledge')).toBe('knowledge');
    expect(moduleOfPath('/competency')).toBe('competency');
    expect(moduleOfPath('/quality/competency')).toBe('competency');
    expect(moduleOfPath('/operation/jobs/x')).toBe('slk');
    expect(currentModule('knowledge', '/knowledge', all)).toBe('knowledge');
    expect(currentModule('knowledge', '/operation/jobs', all)).toBe('slk');
    expect(currentModule('slk', '/knowledge', all)).toBe('slk');
    expect(currentModule(null, '/knowledge', all)).toBe('knowledge');
    expect(currentModule(null, '/knowledge', { slk: false, knowledge: true, competency: false })).toBe('knowledge');
  });

  it('Users & Roles lists the module right first', () => {
    expect(menuClusters(MENU_KEYS)[0]).toEqual({ label: 'Modules', keys: ['slk_ops'] });
    expect(menuClusters(MENU_KEYS).flatMap((c) => c.keys).filter((k) => k === 'slk_ops')).toHaveLength(1);
  });
});
