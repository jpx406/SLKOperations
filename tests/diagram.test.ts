import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  afterChange, cleanPart, cleanRows, crossoverFor, diagramChecks, drawPart, insertIndex, joints, legacyToolstring, rigTotals, stringTotals,
  type Row, type Well,
} from '../src/shared/diagram';
import { diagramPdf } from '../src/shared/diagramPdf';

const A = '4.75"-4x2 (3.750")', B = '6.125"-4x2 (4.750")';
const row = (o: Partial<Row>): Row => ({
  part_id: null, kind: 'lubricator', name: 'Part', rating_psi: 10000, service: 'h2s', id_in: 3, od_in: null, fn_in: null,
  top_conn: A, bottom_conn: A, length_ft: 10, weight_lb: null, stroke_ft: null, rams: null, ...o,
});
const tool = (o: Partial<Row>): Row => row({ kind: 'stem', rating_psi: null, service: null, id_in: null, od_in: 1.875, fn_in: 1.75, top_conn: '1.875" QLS', bottom_conn: '1.875" QLS', length_ft: 5, weight_lb: 47, ...o });

const rig: Row[] = [
  row({ kind: 'stuffing_box', name: 'Stuffing Box', id_in: null, top_conn: 'Sheave', length_ft: 2.5 }),
  row({ kind: 'tool_catcher', name: 'Tool Catcher', length_ft: 1.5 }),
  row({ name: 'Lubricator 3" x 10 ft' }), row({ name: 'Lubricator 3" x 10 ft' }),
  row({ kind: 'pce_crossover', name: 'Xover', bottom_conn: B, length_ft: 2 }),
  row({ kind: 'wireline_valve', name: 'Dual Ram BOP', id_in: 4, top_conn: B, bottom_conn: B, length_ft: 4.5, rams: 2 }),
  row({ kind: 'tree', name: 'Tree', rating_psi: null, service: null, top_conn: null, bottom_conn: null, length_ft: 1.5 }),
];
const string: Row[] = [
  tool({ kind: 'rope_socket', name: 'Rope socket', top_conn: 'Wire', length_ft: 0.5, weight_lb: 8 }),
  tool({ name: 'Stem 5 ft' }), tool({ name: 'Stem 3 ft', length_ft: 3, weight_lb: 28 }),
  tool({ kind: 'jar_mech', name: 'Spang jar', length_ft: 5, stroke_ft: 1.67, weight_lb: 30 }),
  tool({ kind: 'tool_crossover', name: 'Xover', bottom_conn: '1 1/16"-10', length_ft: 0.33, weight_lb: 2 }),
  tool({ kind: 'gauge_cutter', name: 'Gauge cutter', od_in: 2.312, top_conn: '1 1/16"-10', bottom_conn: null, length_ft: 1.5, weight_lb: 6 }),
];
const well: Well = { mpwhp_psi: 6000, h2s_ppm: 120, min_id_in: 2.313, wire_in: 0.125 };
const levels = (c: { level: string; text: string }[], re: RegExp) => c.filter((x) => re.test(x.text)).map((x) => x.level);

describe('diagram rows', () => {
  it('cleans rows and refuses bad ones', () => {
    expect(cleanRows([{ kind: 'stem', name: ' Stem ', od_in: '1.875', length_ft: '' }], 'tool')).toEqual({
      rows: [expect.objectContaining({ kind: 'stem', name: 'Stem', od_in: 1.875, length_ft: null, part_id: null })],
    });
    expect(cleanRows([{ kind: 'lubricator', name: 'Lub' }], 'tool')).toEqual({ error: expect.stringMatching(/tool type/) });
    expect(cleanRows([{ kind: 'stem', name: '' }], 'tool')).toEqual({ error: 'Row 1 needs a description' });
    expect(cleanRows([{ kind: 'lubricator', name: 'L', rating_psi: 7500 }], 'pce')).toEqual({ error: expect.stringMatching(/rating/) });
    expect(cleanRows([{ kind: 'stem', name: 'S', od_in: -1 }], 'tool')).toEqual({ error: expect.stringMatching(/negative/) });
    expect(cleanRows(Array(31).fill({ kind: 'stem', name: 'S' }), 'tool')).toEqual({ error: expect.stringMatching(/at most 30/) });
    expect(cleanPart({ family: 'pce', kind: 'wireline_valve', name: 'BOP', rams: 5 })).toEqual({ error: expect.stringMatching(/rams/) });
  });

  it('puts a new part where it belongs in the stack', () => {
    expect(insertIndex(rig, 'ball_check')).toBe(1);
    expect(insertIndex(rig, 'lubricator')).toBe(4);
    expect(insertIndex(rig, 'wellhead_adapter')).toBe(6);
    expect(insertIndex([], 'stem')).toBe(0);
    expect(insertIndex(string, 'knuckle')).toBe(3);
  });

  it('finds connections that do not make up and builds the crossover', () => {
    const bad = [row({}), row({ top_conn: B, bottom_conn: B })];
    expect(joints(bad)).toEqual([{ index: 0, ok: false, above: A, below: B }]);
    expect(joints([row({}), row({ top_conn: '4.75" -4x2 (3.750")' })])[0].ok).toBe(true);
    expect(joints([row({ bottom_conn: null }), row({})])[0].ok).toBeNull();
    const x = crossoverFor(bad[0], bad[1], 'pce');
    expect(x).toMatchObject({ kind: 'pce_crossover', top_conn: A, bottom_conn: B, rating_psi: 10000, service: 'h2s', id_in: 3 });
    expect(joints([bad[0], x, bad[1]]).every((j) => j.ok)).toBe(true);
  });
});

describe('totals', () => {
  it('rig up: length above the tree, lubricator, smallest bore and the lowest rating', () => {
    expect(rigTotals(rig)).toEqual({ parts: 7, length_ft: 30.5, lubricator_ft: 20, min_id_in: 3, system_wp: 10000, missing_length: 0 });
  });
  it('tool string: jars open, widest tool and the weight above the first jar', () => {
    expect(stringTotals(string)).toEqual({ parts: 6, length_ft: 15.33, length_open_ft: 17, max_od_in: 2.312, weight_lb: 121, weight_above_jar_lb: 83, missing_weight: 0 });
  });
  it('keeps the old Preparation toolstring in step', () => {
    expect(legacyToolstring(string)[5]).toEqual({ component: 'Gauge cutter', od_in: 2.312, length_ft: 1.5, weight_lb: 6 });
  });
});

describe('checks', () => {
  it('passes a sound rig up', () => {
    const c = diagramChecks('rigup', rig, [string], well);
    expect(c.filter((x) => x.level === 'danger')).toEqual([]);
    expect(levels(c, /1.2 × SIWHP/)).toEqual(['ok']);
    expect(c.find((x) => /Pressure test/.test(x.text))?.text).toMatch(/7,200 psi/);
  });
  it('flags the rating, H2S service, bore and a short lubricator', () => {
    const weak = rig.map((r) => (r.kind === 'tool_catcher' ? { ...r, rating_psi: 5000, service: 'std' as const } : r));
    const c = diagramChecks('rigup', weak, [[...string, tool({ name: 'Long stem', length_ft: 10 })]], { ...well, min_id_in: null });
    expect(levels(c, /only rated 5,000/)).toEqual(['danger']);
    expect(levels(c, /not H₂S service/)).toEqual(['danger']);
    expect(levels(c, /Lubricator 20 ft is short/)).toEqual(['danger']);
    const wide = diagramChecks('rigup', rig, [[tool({ od_in: 2.9 })]], well);
    expect(levels(wide, /less than the widest tool/)).toEqual(['danger']);
  });
  it('does not apply the barrier table, only the required parts', () => {
    const single = rig.map((r) => (r.kind === 'wireline_valve' ? { ...r, rams: 1 } : r));
    expect(diagramChecks('rigup', single, [string], { ...well, mpwhp_psi: 9000 }).some((x) => /ram|barrier/i.test(x.text))).toBe(false);
    const bare = rig.filter((r) => r.kind !== 'tool_catcher');
    expect(levels(diagramChecks('rigup', bare, [], well), /No tool catcher/)).toEqual(['warning']);
  });
  it('tool string: tubing restriction, stem weight, connections and a missing rig up', () => {
    const c = diagramChecks('toolstring', null, [string], well);
    expect(levels(c, /minimum restriction/)).toEqual(['ok']);
    expect(levels(c, /Weight above the jar 83 lb/)).toEqual(['warning']);
    expect(levels(diagramChecks('toolstring', rig, [string], { ...well, mpwhp_psi: 1000 }), /Weight above the jar 83 lb/)).toEqual(['ok']);
    expect(levels(c, /No rig up diagram/)).toEqual(['warning']);
    const tight = diagramChecks('toolstring', rig, [string], { ...well, min_id_in: 2.25 });
    expect(levels(tight, /does not pass/)).toEqual(['danger']);
    const heavy = diagramChecks('toolstring', rig, [string], { ...well, mpwhp_psi: 5000 });
    expect(levels(heavy, /Add stem/)).toEqual(['warning']);
    const broken = diagramChecks('toolstring', rig, [[string[0], tool({ top_conn: '1.5" QLS' })]], well);
    expect(levels(broken, /does not make up/)).toEqual(['danger']);
  });
});

describe('revision', () => {
  it('stays at Rev 0 until a PDF, then the next change raises it once', () => {
    let s = afterChange({ rev: 0, pdf_rev: null, status: 'draft' }, true);
    expect(s).toEqual({ rev: 0, pdf_rev: null, status: 'draft' });
    s = { ...s, pdf_rev: 0, status: 'reviewed' };
    expect(afterChange(s, false)).toEqual(s);
    s = afterChange(s, true);
    expect(s).toEqual({ rev: 1, pdf_rev: 0, status: 'draft' });
    expect(afterChange(s, true).rev).toBe(1);
    expect(afterChange({ ...s, pdf_rev: 1 }, true).rev).toBe(2);
  });
});

describe('drawing and PDF', () => {
  it('draws every part inside its box', () => {
    for (const r of [...rig, ...string]) {
      const fam = r.rating_psi != null || r.kind === 'tree' ? 'pce' : 'tool';
      for (const p of drawPart(r, fam, 120, 40)) {
        const xs = p.t === 'rect' ? [p.x, p.x + p.w] : p.t === 'poly' ? p.pts.map(([x]) => x) : p.t === 'circle' ? [p.cx - p.r, p.cx + p.r] : [p.x1, p.x2];
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1);
        expect(Math.max(...xs)).toBeLessThanOrEqual(121);
      }
    }
  });
  it('writes a one-page QAF PDF with the revision', () => {
    const bytes = diagramPdf({
      kind: 'rigup', run_no: 0, rev: 2, rows: rig,
      job: { client: 'Saudi Aramco', well: 'HRDH-1234', field: 'Haradh', rig: 'SL-07', unit_number: 'SL-07', date: '2026-11-04', ticket_no: 'T-1', drss_no: null },
      prepared: { by: 'Juan Lopez', at: '2026-11-04T08:00:00Z' }, reviewed: null,
    });
    const s = new TextDecoder('latin1').decode(bytes);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s).toMatch(/\/Count 1/);
    expect(s).toMatch(/QAF14009 Rev 2/);
    expect(s).toMatch(/Not reviewed/);
  });
});

describe('catalogue seed', () => {
  const sql = readFileSync('replica/migrations/0019_rig_up_diagrams.sql', 'utf8');
  it('every seeded part is valid', () => {
    const rows = [...sql.matchAll(/^\s+\('(part-[^']+)', '(pce|tool)', '([a-z_]+)', '((?:[^']|'')+)'/gm)];
    expect(rows.length).toBe(79);
    for (const [, , family, kind, name] of rows) expect(cleanPart({ family, kind, name: name.replace(/''/g, "'") })).toHaveProperty('values');
  });
});

describe('pictures', () => {
  it('every picture a part can use exists for the screen and the PDF', async () => {
    const { existsSync } = await import('node:fs');
    const { pictureFor, kindsOf } = await import('../src/shared/diagram');
    const { PICTURE_JPEGS } = await import('../src/shared/diagramPictures');
    const names = ['Lubricator - Ported 3"', 'GS Pulling Tool', 'B Shifting Tool', 'Camco JD Pulling Tool', 'Otis S Pulling Tool', 'X Running Tool', 'Equalising Prong', 'Otis XX Plug', 'Hydrostatic Bailer', 'Sand Bailer', 'Wireline Grab', 'Knuckle Jar'];
    for (const kind of [...kindsOf('pce'), ...kindsOf('tool')]) for (const name of ['Part', ...names]) for (const rams of [1, 2]) {
      const p = pictureFor(row({ kind, name, rams, od_in: 2.5 }));
      if (!p) continue;
      expect(existsSync(`public/diagram-parts/${p.key}.png`)).toBe(true);
      expect(PICTURE_JPEGS[p.key].base64.length).toBeGreaterThan(100);
      expect(p.width).toBeGreaterThan(0);
      expect(p.width).toBeLessThanOrEqual(0.98);
    }
    expect(pictureFor(row({ kind: 'wireline_valve', rams: 2 }))?.key).toBe('bop_dual');
    expect(pictureFor(row({ kind: 'lubricator', name: 'Lubricator - Lightweight - Ported 3" x 10 ft' }))?.key).toBe('lubricator_ported');
    expect(pictureFor(row({ kind: 'tool_catcher' }))).toBeNull();
  });
});
