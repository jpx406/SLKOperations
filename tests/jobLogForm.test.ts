import { describe, expect, it } from 'vitest';
import { PHRASE_GROUPS, applyJob, cleanLogOption, jobValues, phraseGroups, setRowTo } from '../src/shared/jobLogForm';
import { autoHours, bhaFromStrings, changeSummary, coerceForm, dayOf, eventCount, exportRows, hasPhrase, hours, mandatoryProblems, mergeForms, newForm, newRow, rowKind, rowsAsEvents, sortRows, togglePhrase, wireFinalOf, type LogForm } from '../src/shared/jobLogForm';
import { fromEvents } from '../src/shared/jobEvents';
import { readAllowed, ruleFor } from '../src/worker/permissions';

// 6z.51: the Job log · Sequence of Events form from the owner's package, with run and depth for slickline

const row = (id: string, date: string, time: string, desc: string, run = '', depth = '') => newRow({ id, date, time, desc, run, depth });
const form = (rows: ReturnType<typeof newRow>[], o: Partial<LogForm> = {}): LogForm => ({ ...newForm({ ticket: 'T-1', well: 'W-801', startDate: '2026-11-22' }), rows, ...o });

describe('job log form', () => {
  it('fills the header from the job and starts with the arrival, rig up and rig down lines', () => {
    const f = newForm({ ticket: 'T-1', well: 'W-801', customer: 'Saudi Aramco', jobType: 'Drift, Plug', rig: 'R-12', startDate: '2026-11-22', engineers: ['A. Supervisor'] });
    expect(f).toMatchObject({ ticket: 'T-1', well: 'W-801', customer: 'Saudi Aramco', jobType: 'Drift, Plug', rig: 'R-12', date: '2026-11-22', engNames: ['A. Supervisor'] });
    expect(f.rows.map((r) => rowKind(r.desc))).toEqual(['arrival', 'rigup', 'rigdown']);
    expect(eventCount(f)).toBe(3);
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
    // the copies keep the order of the form; To is the next line's From unless typed
    const g = { ...f, rows: sortRows(f.rows) };
    expect(exportRows(g).map((r) => [r.n, r.time, r.to, r.run, r.depth])).toEqual([[1, '05:00', '07:55', '', ''], [2, '07:55', '', '1', '9,450']]);
    const ev = rowsAsEvents(f);
    expect(ev[0].occurred_at).toBe('2026-11-22T02:00:00.000Z');
    expect(fromEvents(ev)).toMatchObject({ arrived_at: '2026-11-22T02:00:00.000Z', runs: 1, max_depth_ft: 9450, tag_depth_ft: 9450 });
  });
});

describe('job log as the Slickline Service Report (6z.52)', () => {
  it('needs the arrival first, then a rig up and a rig down line, each with a time, before signing', () => {
    const ok = form([row('a', '2026-11-22', '18:20', 'ARRIVED ON LOCATION.'), row('b', '2026-11-22', '19:00', 'RU SLK PCE ON SURFACE. COC BOP OKAY.'), row('c', '2026-11-22', '21:20', 'RIH W/4.423" GC AND SOFT TAGGED AT 10,447FT DF.', '1', '10447'), row('d', '2026-11-23', '06:45', 'COMPLETELY RD SLK EQUIPMENT AND SECURED WELL')]);
    expect(mandatoryProblems(ok)).toEqual([]);
    expect(mandatoryProblems({ ...ok, rows: ok.rows.slice(1) })[0]).toMatch(/first line must be the arrival/);
    expect(mandatoryProblems({ ...ok, rows: [ok.rows[0], ok.rows[2], ok.rows[3]] })).toEqual(['Add a rig up line after the arrival.']);
    expect(mandatoryProblems({ ...ok, rows: [ok.rows[0], ok.rows[3], ok.rows[1]] })).toEqual(['The rig down line must come after the rig up line.']);
    expect(mandatoryProblems(newForm({ startDate: '2026-11-22' })).every((p) => /its time/.test(p))).toBe(true);
    // "ru" inside a word is not a rig up; "RU" and "rigged up" are
    expect(rowKind('Waited for truck')).toBeNull();
    expect(rowKind('Rigged up lubricator')).toBe('rigup');
  });

  it('ticks the usual wording into a description and takes it out again, the text staying free', () => {
    const p = 'PRESSURE-TESTED SLK PCE TO ___ PSI FOR ___ MINS OK.';
    let d = togglePhrase('', 'RAISED PTW.');
    d = togglePhrase(d, p);
    expect(d).toBe('RAISED PTW. PRESSURE-TESTED SLK PCE TO ___ PSI FOR ___ MINS OK.');
    d = d.replace('___ PSI', '7500 PSI').replace('___ MINS', '15 MINS');
    expect(hasPhrase(d, p)).toBe(true);
    expect(togglePhrase(d, p)).toBe('RAISED PTW.');
  });

  it('reads each run’s BHA from its tool string and works out the final wire length', () => {
    expect(bhaFromStrings([{ run: 2, names: ['Rope socket', 'Stem', 'EMGs'] }, { run: 1, names: ['Rope socket', 'Gauge cutter'] }, { run: 3, names: [] }]))
      .toEqual([{ run: '1', text: 'Rope socket + Gauge cutter' }, { run: '2', text: 'Rope socket + Stem + EMGs' }]);
    const f = newForm({ wireInitial: '18000', wireCut: '150', bha: [{ run: '1', text: 'Rope socket' }] });
    expect(wireFinalOf(f)).toBe('17850');
    expect(f.bha).toEqual([{ run: '1', text: 'Rope socket' }]);
    // a log saved before 6z.52 gets the new fields from the job
    const old = coerceForm({ well: 'W-1', rows: [{ id: 'x', date: '2026-11-22', time: '07:00', desc: 'Arrived' }] }, { field: 'THRY', unit: 'SL 52', bha: [{ run: '1', text: 'GC' }] });
    expect(old).toMatchObject({ well: 'W-1', field: 'THRY', unit: 'SL 52', status: '', bha: [{ run: '1', text: 'GC' }] });
    expect(old.rows[0].to).toBe('');
  });

  it('counts a line’s To in the crew hours, across midnight', () => {
    const f = form([{ ...row('a', '2026-11-22', '17:00', 'ARRIVED ON LOCATION.'), to: '01:00' }]);
    expect(autoHours(f)).toEqual({ day: 1, night: 7, total: 8 });
  });
});

describe('job log header from the job and its pick lists (6z.53)', () => {
  it('reads every field the job has from the job, over what was saved, and leaves the rest', () => {
    const job = { well: 'THRY-9510', field: 'THRY', startDate: '2026-11-22T00:00:00Z', siwhp: '1200', wireCut: '150', wireMaxPull: '', unit: null };
    expect(jobValues(job)).toEqual({ well: 'THRY-9510', field: 'THRY', date: '2026-11-22', tubingSi: '1200', wireCut: '150' });
    const saved = coerceForm({ well: '', field: 'old', unit: 'SL 52', locationCond: 'Good', rows: [] }, job);
    expect(saved).toMatchObject({ well: 'THRY-9510', field: 'THRY', unit: 'SL 52', locationCond: 'Good', wireCut: '150', date: '2026-11-22' });
    expect(applyJob(newForm(), null).well).toBe('');
  });

  it('makes a line’s To the next line’s From; a To picked from the From changes only that line', () => {
    const rows = [row('a', '2026-11-22', '18:20', 'ARRIVED ON LOCATION.'), row('b', '2026-11-22', '19:30', 'RU SLK PCE ON WELL.'), row('c', '2026-11-22', '21:00', 'RIH')];
    let r = setRowTo(rows, 'a', '18:20', false);
    expect(r.map((x) => [x.time, x.to])).toEqual([['18:20', '18:20'], ['19:30', ''], ['21:00', '']]);
    r = setRowTo(r, 'a', '19:00');
    expect(r.map((x) => [x.time, x.to])).toEqual([['18:20', '19:00'], ['19:00', ''], ['21:00', '']]);
    r = setRowTo(r, 'c', '23:00');   // the last line: nothing after it
    expect(r[2].to).toBe('23:00');
    expect(setRowTo(r, 'b', '')[2].time).toBe('21:00');   // clearing a To leaves the next From
  });

  it('cleans pick list values and groups the wording', () => {
    expect(cleanLogOption('tubingSize', 'x', '  4 1/2"  ')).toEqual({ kind: 'tubingSize', grp: '', value: '4 1/2"' });
    expect(cleanLogOption('phrase', '', 'RAISED PTW.')).toEqual({ kind: 'phrase', grp: 'Other', value: 'RAISED PTW.' });
    expect(cleanLogOption('nope', '', 'x')).toEqual({ error: 'Unknown list' });
    expect(cleanLogOption('field', '', '   ')).toEqual({ error: 'Type a value' });
    const flat = PHRASE_GROUPS.flatMap((g) => g.phrases.map((value) => ({ grp: g.group, value })));
    expect(phraseGroups(flat)).toEqual(PHRASE_GROUPS);
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
