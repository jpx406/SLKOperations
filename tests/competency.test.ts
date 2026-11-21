import { describe, expect, it } from 'vitest';
import { sheetRows, XLSX } from '../src/client/competency/sheet';
import { INLINE_MAX, isKey } from '../src/worker/competency';
import { isOpenWrite, readAllowed, ruleFor } from '../src/worker/permissions';
import { workbook } from '../src/shared/xlsx';
// the module itself (JSX), for its slickline catalog and the SLK seed
import { _constants, _slk } from '../src/client/competency/App.jsx';

// 6z.34: the NESR Competency Framework System, converted to slickline, as the Competency module of SLK Ops

describe('Competency storage on SLK Ops', () => {
  it('takes the module’s own keys and backup timestamps, nothing that walks a path', () => {
    expect(isKey('nesr_wl_competency_team_v1')).toBe(true);
    expect(isKey('nesr_wl_backup_2026-11-19T14:08:31.364Z')).toBe(true);
    expect(isKey('../x')).toBe(false);
    expect(isKey('a/b')).toBe(false);
    expect(isKey('')).toBe(false);
    expect(isKey('x'.repeat(201))).toBe(false);
    expect(INLINE_MAX).toBe(256 * 1024);
  });

  it('anyone with the Competency tab reads and keeps their own keys; the route checks edit for shared ones', () => {
    const view = { competency: { view: true, edit: false, delete: false } };
    for (const p of ['/api/competency/kv', '/api/competency/kv-list', '/api/competency/slk-seed']) expect(readAllowed(p, view)).toBe(true);
    expect(readAllowed('/api/competency/kv', { jobs: { view: true, edit: true, delete: false } })).toBe(false);
    // 6z.40: Competency and Career Development share the store, so the route checks either right
    expect(isOpenWrite('PUT', '/api/competency/kv')).toBe(true);
    expect(isOpenWrite('DELETE', '/api/competency/kv')).toBe(true);
    expect(readAllowed('/api/competency/kv', { career_development: { view: true, edit: false, delete: false } })).toBe(true);
    expect(ruleFor('POST', '/api/competency/kv')).toBeUndefined();
  });
});

describe('Excel imports without SheetJS', () => {
  it('reads the first sheet as rows, numbers as numbers and gaps as null', async () => {
    const bytes = workbook('Tracker', ['emp_id', 'name', 'position_desc', 'hire'], [['NESR-1', 'A One', 'Slickline Operator', 45000], ['NESR-2', null, 'Assistant Operator', null]]);
    const rows = await sheetRows(bytes);
    expect(rows[0]).toEqual(['emp_id', 'name', 'position_desc', 'hire']);
    expect(rows[1]).toEqual(['NESR-1', 'A One', 'Slickline Operator', 45000]);
    expect(rows[2][0]).toBe('NESR-2');
    expect(rows[2][1] ?? null).toBeNull();
    const wb = await XLSX.read(bytes.buffer);
    expect(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])).toEqual(rows);
  });
});

describe('the slickline catalog', () => {
  it('has slickline training, certifications and elements, none of the wireline logging tools', () => {
    const all = [..._constants.TRAIN, ..._constants.CERTS, ..._constants.CORE, ..._constants.ADV, ..._slk.CATALOG_SRC.flatMap(([, els]: [string, string[]]) => els)].join(' | ');
    expect(all).toMatch(/Slickline Operations/);
    expect(all).toMatch(/Pressure Control Equipment Rig Up/);
    expect(all).toMatch(/Flow Control \(Plugs, Locks, SSSV\)/);
    expect(all).not.toMatch(/Wireline|Mono Cable|PNL|MTD|Sonic|Litho|WHE/);
    expect(_slk.SERVICE_SRC.length).toBeGreaterThan(10);
    expect(_slk.L.position).toEqual(expect.arrayContaining(['Trainee', 'Assistant Operator', 'Slickline Operator', 'Slickline Supervisor']));
    expect(_slk.L.position.join(' ')).not.toMatch(/Engineer/);
  });

  it('a new dataset starts from SLK’s people, services and countries', () => {
    const s = _slk.slkSeedState({
      employees: [
        { id: 'NESR-90003', name: 'Test Admin', country: 'Saudi Arabia', crew_role: null, title: 'Admin', email: 'a@x' },
        { id: 'NESR-1', name: 'Sup One', country: 'Bahrain', crew_role: 'slickline_supervisor', title: 'Supervisor', email: null },
        { id: 'NESR-2', name: 'Help Two', country: 'Bahrain', crew_role: 'helper', title: 'Helper', email: null },
      ],
      services: [['Gauge Cutter', 'Well Access and Clean-out'], ['Memory Gauges', 'Surveys and Diagnostics']],
      countries: ['Bahrain', 'Saudi Arabia'],
    });
    expect(s.employees.map((e: { id: string; position: string; segment: string; status: string }) => [e.id, e.position, e.segment, e.status])).toEqual([
      ['NESR-90003', 'Operator', 'SLK', 'Active'], ['NESR-1', 'Slickline Supervisor', 'SLK', 'Active'], ['NESR-2', 'Trainee', 'SLK', 'Active'],
    ]);
    expect(s.employees[1].step).toBe('Step 4 (SV > SSV)');
    expect(s.services).toEqual([{ name: 'Gauge Cutter', domain: 'Well Access and Clean-out', elements: [] }, { name: 'Memory Gauges', domain: 'Surveys and Diagnostics', elements: [] }]);
    expect(s.countries).toEqual(['Bahrain', 'Saudi Arabia']);
    // no wireline examples in a real start
    expect(s.training).toEqual([]);
    expect(s.experience).toEqual([]);
    expect(s.cdpSteps.map((x: { name: string }) => x.name)).toEqual(['Trainee → Assistant Operator', 'Assistant Operator → Slickline Operator', 'Slickline Operator → Slickline Supervisor', 'Slickline Supervisor → Senior Supervisor']);
  });
});
