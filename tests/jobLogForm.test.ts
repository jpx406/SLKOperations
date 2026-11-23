import { describe, expect, it } from 'vitest';
import { autoHours, changeSummary, coerceForm, dayOf, eventCount, exportRows, hours, mergeForms, newForm, newRow, rowsAsEvents, sortRows, type LogForm } from '../src/shared/jobLogForm';
import { fromEvents } from '../src/shared/jobEvents';
import { readAllowed, ruleFor } from '../src/worker/permissions';

// 6z.51: the Job log · Sequence of Events form from the owner's package, with run and depth for slickline

const row = (id: string, date: string, time: string, desc: string, run = '', depth = '') => newRow({ id, date, time, desc, run, depth });
const form = (rows: ReturnType<typeof newRow>[], o: Partial<LogForm> = {}): LogForm => ({ ...newForm({ ticket: 'T-1', well: 'W-801', startDate: '2026-11-22' }), rows, ...o });

describe('job log form', () => {
  it('fills the header from the job and starts with one empty row', () => {
    const f = newForm({ ticket: 'T-1', well: 'W-801', customer: 'Saudi Aramco', jobType: 'Drift, Plug', rig: 'R-12', startDate: '2026-11-22', engineers: ['A. Supervisor'] });
    expect(f).toMatchObject({ ticket: 'T-1', well: 'W-801', customer: 'Saudi Aramco', jobType: 'Drift, Plug', rig: 'R-12', date: '2026-11-22', engNames: ['A. Supervisor'] });
    expect(f.rows).toHaveLength(1);
    expect(eventCount(f)).toBe(0);
    expect(dayOf('2026-11-22')).toBe('Sunday');
  });

  it('works out day and night crew hours from the first to the last event, a typed number winning', () => {
    const f = form([row('a', '2026-11-22', '16:00', 'Arrived'), row('b', '2026-11-22', '21:30', 'Rigged down')]);
    expect(autoHours(f)).toEqual({ day: 2, night: 3.5, total: 5.5 });
    expect(hours({ ...f, dayHrs: '3' })).toMatchObject({ day: 3, night: 3.5, total: 6.5, autoDay: false });
    expect(autoHours(form([row('a', '2026-11-22', '16:00', 'Arrived')]))).toEqual({ day: null, night: null, total: null });
  });

  it('says what changed between versions', () => {
    const a = form([row('a', '2026-11-22', '06:00', 'Arrived')]);
    expect(changeSummary(null, a)).toBe('Initial version');
    const b = { ...a, well: 'W-802', rows: [...a.rows, row('b', '2026-11-22', '07:00', 'RIH', '1', '0')] };
    expect(changeSummary(a, b)).toBe('Well changed · +1 row');
    expect(changeSummary(b, { ...b, engSig: { img: null, text: 'A. Supervisor', by: 'x', at: '' } })).toBe('crew signed');
    expect(changeSummary(a, a)).toBe('No content change');
  });

  it('merges two people’s saves: rows by id, header fields mine when I changed them', () => {
    const base = form([row('a', '2026-11-22', '06:00', 'Arrived'), row('b', '2026-11-22', '07:00', 'RIH')]);
    const mine = { ...base, rig: 'R-99', rows: [...base.rows, row('c', '2026-11-22', '09:00', 'POOH')] };
    const theirs = { ...base, well: 'W-900', rows: [base.rows[0], { ...base.rows[1], depth: '9450' }] };
    const m = mergeForms(base, mine, theirs);
    expect(m.rig).toBe('R-99');
    expect(m.well).toBe('W-900');
    expect(m.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(m.rows[1].depth).toBe('9450');
    // a row I deleted that they left alone stays deleted
    const mine2 = { ...base, rows: [base.rows[0]] };
    expect(mergeForms(base, mine2, base).rows.map((r) => r.id)).toEqual(['a']);
  });

  it('reads anything back into a whole form, keeping only real signatures', () => {
    const f = coerceForm({ well: 'W-1', rows: [{ id: 'x', date: '2026-11-22', time: '07:00', desc: 'RIH', run: 2, depth: 100 }], engSig: { img: 'javascript:alert(1)' }, fmSig: { text: ' Client Rep ' }, engNames: 'A, B' });
    expect(f.rows[0]).toMatchObject({ id: 'x', run: '2', depth: '100', remark: '' });
    expect(f.engSig).toBeNull();
    expect(f.fmSig?.text).toBe('Client Rep');
    expect(f.engNames).toEqual(['A', 'B']);
  });

  it('sorts, numbers and exports rows, and feeds Execution from them', () => {
    const f = form([row('b', '2026-11-22', '07:55', 'Tagged bottom', '1', '9450'), row('a', '2026-11-22', '05:00', 'Arrived on location'), row('e', '', '', '')]);
    expect(sortRows(f.rows).map((r) => r.id)).toEqual(['a', 'b', 'e']);
    expect(exportRows(f).map((r) => [r.n, r.time, r.run, r.depth])).toEqual([[1, '05:00', '', ''], [2, '07:55', '1', '9,450']]);
    const ev = rowsAsEvents(f);
    expect(ev[0].occurred_at).toBe('2026-11-22T02:00:00.000Z');
    expect(fromEvents(ev)).toMatchObject({ arrived_at: '2026-11-22T02:00:00.000Z', runs: 1, max_depth_ft: 9450, tag_depth_ft: 9450 });
  });
});

describe('job log access', () => {
  const jobs = { jobs: { view: true, edit: true, delete: false } };
  it('reads with Jobs, saves with the Jobs edit right', () => {
    expect(readAllowed('/api/joblog/abc', jobs)).toBe(true);
    expect(readAllowed('/api/joblog/abc/versions', jobs)).toBe(true);
    expect(readAllowed('/api/joblog/abc', {})).toBe(false);
    expect(ruleFor('PUT', '/api/joblog/abc')).toMatchObject({ menu: 'jobs', action: 'edit' });
  });
});
