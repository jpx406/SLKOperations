import { describe, expect, it } from 'vitest';
import { ACCOUNT_PALETTE, NO_ACCOUNT, byAccount, nextColor } from '../src/shared/accounts';
import { filterPatch, stageOfField } from '../src/shared/fieldPolicy';
import { checklistProgress, cleanTemplate, linesToTemplate } from '../src/shared/forms';
import { menuClusters } from '../src/shared/menus';
import { canEditStage } from '../src/shared/stages';
import { MENU_KEYS, effectiveMenus, ruleFor } from '../src/worker/permissions';

describe('account colours', () => {
  it('gives each new account the next free colour, then goes round again', () => {
    expect(nextColor([])).toBe(ACCOUNT_PALETTE[0]);
    expect(nextColor([ACCOUNT_PALETTE[0], ACCOUNT_PALETTE[2]])).toBe(ACCOUNT_PALETTE[1]);
    expect(nextColor([...ACCOUNT_PALETTE, ACCOUNT_PALETTE[0]])).toBe(ACCOUNT_PALETTE[13 % ACCOUNT_PALETTE.length]);
  });
  it('groups by account in name order, jobs without one last', () => {
    const g = byAccount([{ l: 'SAWCOD' }, { l: null }, { l: 'D&WO' }, { l: 'SAWCOD' }], (x) => x.l);
    expect(g.map((x) => [x.account, x.items.length])).toEqual([['D&WO', 1], ['SAWCOD', 2], [NO_ACCOUNT, 1]]);
  });
});

describe('job stage rights', () => {
  const perms = (rows: [string, number, number][]) => rows.map(([menu_key, v, e]) => ({ menu_key, can_view: v, can_edit: e, can_delete: 0 }));
  it('follow Jobs for a role nobody has set them for', () => {
    const m = effectiveMenus(perms([['jobs', 1, 1]]), [], false);
    expect(m.job_execution).toEqual({ view: true, edit: true, delete: false });
  });
  it('can close one stage while the others stay open', () => {
    const m = effectiveMenus(perms([['jobs', 1, 1], ['job_closure', 1, 0]]), [], false);
    expect(canEditStage(m, 'closure')).toBe(false);
    expect(canEditStage(m, 'design')).toBe(true);
    const { allowed, dropped } = filterPatch('admin', { ticket_no: '1', service_order: 'SO-1' }, null, m);
    expect(allowed).toEqual({ ticket_no: '1' });
    expect(dropped).toEqual(['service_order']);
  });
  it('know each field’s stage and sit under Jobs in Users & Roles', () => {
    expect([stageOfField('ticket_no'), stageOfField('well_type'), stageOfField('rig_up_at'), stageOfField('revenue_cents')]).toEqual(['design', 'preparation', 'execution', 'closure']);
    const op = menuClusters([...MENU_KEYS]).find((c) => c.label === 'Operation')!;
    expect(op.keys.slice(op.keys.indexOf('jobs'), op.keys.indexOf('jobs') + 5)).toEqual(['jobs', 'job_design', 'job_preparation', 'job_execution', 'job_closure']);
  });
  it('gate the crew changes like planning the crew', () => {
    expect(ruleFor('POST', '/api/jobs/j1/crew/e1/replace')).toMatchObject({ menu: 'jobs', action: 'edit' });
    expect(ruleFor('DELETE', '/api/form-templates/t1')).toMatchObject({ menu: 'form_templates', action: 'delete' });
  });
});

describe('form templates', () => {
  it('checks and tidies a checklist', () => {
    const r = cleanTemplate({ name: ' Rig-up  checklist ', stage: 'execution', sections: { A: 'Site' }, questions: [{ text: 'Is the area barriered?' }, { text: 'Wind checked?', section: 'Z', options: ['yes', 'no'] }] });
    if ('error' in r) throw new Error(r.error);
    expect(r.template).toMatchObject({ name: 'Rig-up checklist', kind: 'checklist', stage: 'execution', code: 'RIG-UP-CHECKLIST', revision: '1' });
    expect(r.template.questions.map((q) => [q.id, q.section, q.options])).toEqual([['A1', 'A', undefined], ['A2', 'A', ['yes', 'no']]]);
  });
  it('refuses a template without a stage, questions or (for a JRA) approval levels', () => {
    expect(cleanTemplate({ name: 'X', questions: [{ text: 'Q?' }] })).toEqual({ error: 'Pick the job stage the template belongs to' });
    expect(cleanTemplate({ name: 'X', stage: 'design', questions: [] })).toEqual({ error: 'Add at least one question' });
    expect(cleanTemplate({ name: 'X', kind: 'jra', stage: 'design', questions: [{ text: 'Q?' }] })).toHaveProperty('error');
  });
  it('drafts a checklist from a document’s lines', () => {
    const t = linesToTemplate(['Rig-down checklist', 'Pressure', 'No | Item | Yes | No', '1 | Is the well isolated? | | ', '2. Is the lubricator bled off? | Yes | No', 'Housekeeping', 'Is the site clean?', 'Signature: ____'], 'rigdown.docx');
    expect(t.name).toBe('Rig-down checklist');
    expect(t.sections).toEqual({ A: 'Pressure', B: 'Housekeeping' });
    expect(t.questions.map((q) => `${q.id} ${q.text}`)).toEqual(['A1 Is the well isolated?', 'A2 Is the lubricator bled off?', 'B1 Is the site clean?']);
  });
  it('counts the required questions still open', () => {
    const t = { questions: [{ id: 'A1', required: true }, { id: 'A2', required: false }, { id: 'A3', required: true }] } as Parameters<typeof checklistProgress>[0];
    expect(checklistProgress(t, { A1: 'yes' })).toEqual({ answered: 1, total: 3, missing: ['A3'] });
  });
});
