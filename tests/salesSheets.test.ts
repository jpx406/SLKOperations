import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_FIELDS, ACTIVITY_GROUPS, DAILY_FIELDS, changedSinceLock, cleanValue, clientFor, dailyStatus, formatOf, liveValue, shownValue, snapshotOf,
  usesField, type SheetLine,
} from '../src/shared/salesSheets';
import { cellText, groupSummary, sheetSpec, tablePdf, visibleColumns } from '../src/shared/sheetExport';
import { workbookSheets } from '../src/shared/xlsx';
import { unzip } from '../src/shared/xlsxRead';

const f = (k: string) => ACTIVITY_FIELDS.find((x) => x.key === k)!;
const line = (over: Partial<SheetLine> = {}): SheetLine => ({
  id: 'j1', job_id: 'j1', account: 'SAWCOD', format: 'sawcod',
  app: { ticket: 'DV-1', revenue_month: '2026-10', op_hours: 4, gross: 1000, currency: 'USD', arrived_at: '2026-10-01T06:00:00Z', finished_at: '2026-10-01T12:00:00Z', crew_count: 3, field_rig: 'RIG-1', well: 'W-1' },
  data: { standby_hours: 2, partial: 250 }, locked: null, snapshot: null, ...over,
});

describe('account formats', () => {
  it('picks the format from the account name, D&WO before UNC', () => {
    expect(formatOf('SAWCOD')).toBe('sawcod');
    expect(formatOf('NAWCO')).toBe('nawcod');
    expect(formatOf('D&WO UNC')).toBe('dwo');
    expect(formatOf('Unconventional')).toBe('unc');
    expect(formatOf('LSTK')).toBe('lstk');
    expect(formatOf('Other')).toBe('standard');
  });
  it('lets Sales override the format of an account', () => {
    expect(formatOf('Other', { Other: 'wireline' })).toBe('wireline');
    expect(formatOf('Other', { Other: 'bogus' })).toBe('standard');
  });
  it('keeps account-only columns to their accounts', () => {
    expect(usesField(f('org_code'), 'sawcod')).toBe(true);
    expect(usesField(f('org_code'), 'dwo')).toBe(false);
    expect(usesField(f('dmr_status'), 'lstk')).toBe(true);
  });
  it('suggests the daily client from the account', () => {
    expect(clientFor('D&WO')).toBe('NESR D&WO');
    expect(clientFor('D&WO', true)).toBe('NESR Offshore');
    expect(clientFor('Unconventional')).toBe('FRAC UNC');
    expect(clientFor('Other')).toBeNull();
  });
});

describe('values', () => {
  it('works out total time and net revenue, and reads man-hours from the job', () => {
    const l = line();
    expect(liveValue(f('total_hours'), l, ACTIVITY_FIELDS)).toBe(6);
    expect(liveValue(f('man_hours'), { ...l, app: { ...l.app, man_hours: 12 } }, ACTIVITY_FIELDS)).toBe(12);
    expect(liveValue(f('net'), l, ACTIVITY_FIELDS)).toBe(750);
  });
  it('uses a typed revenue month over the one from the job', () => {
    expect(liveValue(f('revenue_month'), line(), ACTIVITY_FIELDS)).toBe('2026-10');
    expect(liveValue(f('revenue_month'), line({ data: { revenue_month: '2026-11' } }), ACTIVITY_FIELDS)).toBe('2026-11');
  });
  it('checks typed values and refuses app fields', () => {
    expect(cleanValue(f('standby_hours'), '1,250.5')).toEqual({ value: 1250.5 });
    expect(cleanValue(f('standby_hours'), '-1')).toHaveProperty('error');
    expect(cleanValue(f('dmr_status'), 'Approved')).toEqual({ value: 'Approved' });
    expect(cleanValue(f('dmr_status'), 'Maybe')).toHaveProperty('error');
    expect(cleanValue(f('mob_on'), '2026-10-40')).toHaveProperty('error');
    expect(cleanValue(f('gross'), 5)).toHaveProperty('error');
    expect(cleanValue(f('comments'), '')).toEqual({ value: null });
  });
  it('freezes a locked line and tells what changed in the job since', () => {
    const l = line();
    const locked = { ...l, locked: { by: 'a', name: 'A', at: '2026-10-28T00:00:00Z' }, snapshot: snapshotOf(l, ACTIVITY_FIELDS) };
    expect(changedSinceLock(locked, ACTIVITY_FIELDS)).toEqual([]);
    const later = { ...locked, app: { ...locked.app, gross: 2000 } };
    expect(shownValue(f('net'), later, ACTIVITY_FIELDS)).toBe(750);
    expect(changedSinceLock(later, ACTIVITY_FIELDS)).toEqual(['Gross revenue', 'Net revenue']);
  });
});

describe('daily status', () => {
  it('comes from the job, else maintenance or loan, else base', () => {
    expect(dailyStatus('2026-10-28', { status: 'ongoing', start_date: '2026-10-20' }, null)).toBe('On-going');
    expect(dailyStatus('2026-10-28', { status: 'planned', start_date: '2026-10-28' }, null)).toBe('Mob.');
    expect(dailyStatus('2026-10-28', { status: 'planned', start_date: '2026-10-27' }, null)).toBe('Booked');
    expect(dailyStatus('2026-10-28', null, { kind: 'maintenance', starts_on: '2026-10-28', ends_on: '2026-10-29' })).toBe('Preventive < 2 days');
    expect(dailyStatus('2026-10-28', null, { kind: 'maintenance', starts_on: '2026-10-25', ends_on: '2026-10-29' })).toBe('Repair 3~5 days');
    expect(dailyStatus('2026-10-28', null, { kind: 'maintenance', starts_on: '2026-10-20', ends_on: '2026-10-29' })).toBe('Major Repairs > 6 days');
    expect(dailyStatus('2026-10-28', null, { kind: 'loan', starts_on: '2026-10-20', ends_on: '9999-12-31' })).toBe('Transfer / on loan');
    expect(dailyStatus('2026-10-28', null, null)).toBe('Base - Available');
  });
  it('derives utilisation from the status', () => {
    const u = DAILY_FIELDS.find((x) => x.key === 'utilization')!;
    expect(liveValue(u, { app: { status: 'Base - Available' }, data: { status: 'Repair 3~5 days' } }, DAILY_FIELDS)).toBe('Repairs');
  });
});

describe('columns and files', () => {
  it('shows a folded group as one summary column and hides columns no line uses', () => {
    const cols = visibleColumns(ACTIVITY_FIELDS, ACTIVITY_GROUPS, [{ format: 'dwo' }], new Set(['account']));
    expect(cols.filter((c) => c.summary).map((c) => c.label)).toContain('Revenue');
    const keys = cols.map((c) => c.key);
    expect(keys).toContain('land_offshore');
    expect(keys).not.toContain('org_code');
    expect(cols.find((c) => c.key === 'land_offshore')?.highlight).toBe(true);
  });
  it('writes n/a for a column the line’s account does not keep, and short summaries', () => {
    const l = line({ format: 'dwo' });
    const cols = visibleColumns(ACTIVITY_FIELDS, ACTIVITY_GROUPS, [{ format: 'sawcod' }, { format: 'dwo' }], new Set(['account', 'revenue']));
    expect(cellText(cols.find((c) => c.key === 'org_code')!, l, ACTIVITY_FIELDS)).toBe('n/a');
    expect(groupSummary('hours', l, ACTIVITY_FIELDS)).toBe('6 h');
    expect(groupSummary('job', l, ACTIVITY_FIELDS)).toBe('RIG-1 · W-1');
  });
  it('builds a workbook with a sheet per account and a group row', async () => {
    const lead = [{ label: 'Line', value: (x: SheetLine) => x.id, width: 12 }];
    const a = sheetSpec('All accounts', lead, ACTIVITY_FIELDS, ACTIVITY_GROUPS, [{ title: 'SAWCOD', lines: [line()] }, { title: 'D&WO', lines: [line({ id: 'j2', format: 'dwo' })] }], true);
    const b = sheetSpec('SAWCOD', lead, ACTIVITY_FIELDS, ACTIVITY_GROUPS, [{ title: 'SAWCOD', lines: [line()] }], true);
    expect(a.header).toContain('Org code');
    expect(a.header).toContain('Land / offshore');
    expect(b.header).not.toContain('Land / offshore');
    expect(a.rows[0]).toEqual(['SAWCOD (1)']);
    const files = await unzip(workbookSheets([a, b, { ...b, name: 'SAWCOD' }]));
    const wb = new TextDecoder().decode(files.get('xl/workbook.xml'));
    expect(wb).toContain('name="All accounts"');
    expect(wb).toContain('name="SAWCOD (2)"');
    expect(new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml'))).toContain('<mergeCell ');
  });
  it('prints a landscape PDF that continues wide tables on more pages', () => {
    const lines = Array.from({ length: 40 }, (_, i) => line({ id: `j${i}` }));
    const cols = visibleColumns(ACTIVITY_FIELDS, ACTIVITY_GROUPS, lines, new Set(ACTIVITY_GROUPS.map((g) => g.key)));
    const pdf = new TextDecoder('latin1').decode(tablePdf({ title: 'Activity', subtitle: 's', lead: [{ label: 'Line', value: (l) => l.id }], cols, fields: ACTIVITY_FIELDS, sections: [{ title: 'SAWCOD', lines }], footer: 'f' }));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/MediaBox [0 0 841.89 595.28]');
    expect((pdf.match(/\/Type \/Page \/Parent/g) ?? []).length).toBeGreaterThan(1);
  });
});

describe('man-hours and travel on Closure', () => {
  it('multiply operating hours by the people assigned, and the distance by two, unless overridden', async () => {
    const { manHours, peopleAssigned, travelKm } = await import('../src/shared/metrics');
    expect(peopleAssigned([{ end_date: null }, { end_date: null }, { end_date: '2026-10-02' }], null)).toBe(2);
    expect(peopleAssigned([], { supervisors: 1, operators: 2, assistant_operators: 0, helpers: 1 })).toBe(4);
    expect(manHours(6.5, 3, null)).toBe(19.5);
    expect(manHours(6.5, 0, null)).toBeNull();
    expect(manHours(null, 3, 40)).toBe(40);
    expect(travelKm(125, null)).toBe(250);
    expect(travelKm(125, 300)).toBe(300);
    expect(travelKm(null, null)).toBeNull();
  });
});
