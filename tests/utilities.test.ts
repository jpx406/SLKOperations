import { describe, expect, it } from 'vitest';
import { EMPTY_FACTS, UTIL_PATH, cleanFacts, copyName, isUtilKind } from '../src/shared/utilities';
import { MENU_LABELS, NAV } from '../src/shared/menus';
import { MENU_KEYS, readAllowed, ruleFor } from '../src/worker/permissions';

// 6z.47: Utilities, the rig up, tool string and winch tools as projects without a job

const right = (view: boolean, edit = false) => ({ utilities: { view, edit, delete: false } });

describe('Utilities projects', () => {
  it('reads the typed job details back, blank where missing or of the wrong type', () => {
    expect(cleanFacts(null)).toEqual(EMPTY_FACTS);
    const f = cleanFacts({ well: 'W-801', siwhp_psi: 2500, h2s_ppm: 'x', wire_in: 0.125, client: 5 });
    expect(f).toMatchObject({ well: 'W-801', siwhp_psi: 2500, h2s_ppm: null, wire_in: 0.125, client: '' });
  });
  it('names a copy without clashing', () => {
    expect(copyName('Rig up 801', [])).toBe('Rig up 801 (copy)');
    expect(copyName('Rig up 801', ['Rig up 801 (copy)'])).toBe('Rig up 801 (copy 2)');
    expect(copyName('Rig up 801 (copy)', ['Rig up 801 (copy)'])).toBe('Rig up 801 (copy 2)');
  });
  it('has three tools under a Utilities menu after Service Quality', () => {
    const labels = NAV.map((g) => g.label);
    expect(labels.indexOf('Utilities')).toBe(labels.indexOf('Service Quality') + 1);
    expect(NAV.find((g) => g.label === 'Utilities')!.pages.map((p) => [p.label, p.path])).toEqual([
      ['Rig Up Diagram', UTIL_PATH.rigup], ['Tool String Diagram', UTIL_PATH.toolstring], ['Winch Report', UTIL_PATH.winch],
    ]);
    expect(isUtilKind('winch')).toBe(true);
    expect(isUtilKind('job')).toBe(false);
    expect(MENU_KEYS).toContain('utilities');
    expect(MENU_LABELS.utilities).toMatch(/without a job/);
  });
  it('opens with the Utilities right, changes with its edit right', () => {
    expect(readAllowed('/api/utilities', right(true))).toBe(true);
    expect(readAllowed('/api/utilities/abc/files/def', right(true))).toBe(true);
    expect(readAllowed('/api/utilities/abc', right(false))).toBe(false);
    expect(readAllowed('/api/diagrams/parts', right(true))).toBe(true);
    for (const [m, p] of [['POST', '/api/utilities'], ['POST', '/api/utilities/abc/duplicate'], ['POST', '/api/utilities/abc/files'], ['POST', '/api/utilities/abc/pdf'], ['PUT', '/api/utilities/abc'], ['PUT', '/api/utilities/abc/state'], ['DELETE', '/api/utilities/abc']] as const) {
      expect(ruleFor(m, p)).toMatchObject({ menu: 'utilities', action: 'edit' });
    }
  });
});
