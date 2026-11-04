// Rig Up Diagram (QAF14009) and Slickline String Diagram (QAF14010): the parts catalogue, the rows of a job's diagrams,
// their totals and checks, the revision rule and the part drawings. Shared by the API, the editor and the PDF.
// Owner decisions 2026-11-04: one rig up per job and one tool string per run; the job's SDM reviews; the barrier
// table (Pressure Standard §9.2.8) is not applied; the catalogue is kept here, seeded from the catalogues; each
// diagram starts at Rev 0 and the next change after a PDF raises the revision.

import type { ToolPart } from './toolstring';

export type Family = 'pce' | 'tool';
export type DiagramKind = 'rigup' | 'toolstring';
export const FAMILY_OF: Record<DiagramKind, Family> = { rigup: 'pce', toolstring: 'tool' };

/** Part types, in stack order (rank 1 is the top). The rank puts a new part where it belongs. */
export const PART_KINDS = {
  // pressure control, top to bottom (SOP-01 §10, Elmar slickline rig-up)
  stuffing_box: { family: 'pce', label: 'Stuffing box / liquid seal', rank: 1 },
  grease_head: { family: 'pce', label: 'Grease injection head', rank: 1 },
  ball_check: { family: 'pce', label: 'Ball check valve', rank: 2 },
  chem_sub: { family: 'pce', label: 'Chemical injection sub', rank: 3 },
  tool_catcher: { family: 'pce', label: 'Tool catcher', rank: 4 },
  lubricator: { family: 'pce', label: 'Lubricator', rank: 5 },
  tool_trap: { family: 'pce', label: 'Tool trap', rank: 6 },
  quick_test_sub: { family: 'pce', label: 'Quick test sub', rank: 7 },
  bleed_sub: { family: 'pce', label: 'Bleed-off sub', rank: 8 },
  wireline_valve: { family: 'pce', label: 'Wireline valve (BOP)', rank: 9 },
  pump_in_sub: { family: 'pce', label: 'Pump-in sub', rank: 10 },
  pce_crossover: { family: 'pce', label: 'WHE crossover', rank: 11 },
  wellhead_adapter: { family: 'pce', label: 'Wellhead adapter', rank: 12 },
  tree: { family: 'pce', label: 'Christmas tree', rank: 13 },
  // tool string, top to bottom (SOP-01 §7.16.9)
  rope_socket: { family: 'tool', label: 'Rope socket', rank: 1 },
  swivel: { family: 'tool', label: 'Swivel joint', rank: 2 },
  stem: { family: 'tool', label: 'Stem', rank: 3 },
  roller_stem: { family: 'tool', label: 'Roller stem', rank: 3 },
  knuckle: { family: 'tool', label: 'Knuckle joint', rank: 4 },
  jar_mech: { family: 'tool', label: 'Spang / link jar', rank: 5 },
  jar_tubular: { family: 'tool', label: 'Tubular jar', rank: 5 },
  jar_hyd: { family: 'tool', label: 'Hydraulic jar', rank: 5 },
  jar_spring: { family: 'tool', label: 'Spring jar', rank: 5 },
  accelerator: { family: 'tool', label: 'Accelerator', rank: 5 },
  tool_crossover: { family: 'tool', label: 'Crossover', rank: 6 },
  gauge_cutter: { family: 'tool', label: 'Gauge cutter', rank: 7 },
  pulling_tool: { family: 'tool', label: 'Pulling / running / shifting tool', rank: 7 },
  impression_block: { family: 'tool', label: 'Impression block', rank: 7 },
  blind_box: { family: 'tool', label: 'Blind box', rank: 7 },
  bailer: { family: 'tool', label: 'Bailer', rank: 7 },
  wire_finder: { family: 'tool', label: 'Wireline finder / grab', rank: 7 },
  plug_prong: { family: 'tool', label: 'Plug / prong', rank: 7 },
  service_tool: { family: 'tool', label: 'Other service tool', rank: 7 },
} as const satisfies Record<string, { family: Family; label: string; rank: number }>;
export type PartKind = keyof typeof PART_KINDS;
export const kindsOf = (family: Family) => (Object.keys(PART_KINDS) as PartKind[]).filter((k) => PART_KINDS[k].family === family);

export const RATINGS = [3000, 5000, 10000, 15000, 20000] as const;
export const SERVICES = { std: 'Standard', h2s: 'H₂S (NACE MR0175)' } as const;
export type Service = keyof typeof SERVICES;

/** Connections from the QAF14009/14010 pick lists; anything else can be typed. */
export const CONNECTIONS: Record<Family, string[]> = {
  pce: ['Sheave', '4.75"-4x2 (3.750")', '5.5"-4 (4.750")', '5.75"-4 (4.000")', '6.125"-4x2 (4.750")', '6.5"-4 (5.188")', '7.875"-4x2 (6.125")',
    '8.25"-4 (6.188")', '8.38"-4 (5.250")', '8.25"-4x2 (6.750")', '9.5"-4 (7.250")', '2 9/16" (RBX153) 10K', '2 9/16" (R27) 5K'],
  tool: ['Wire', '1.5" QLS', '1.875" QLS', '2.25" QLS', '2.5" QLS', '5/8"-11', '15/16"-10', '1 1/16"-10', '1 9/16"-10'],
};

/** A catalogue part. A diagram row is a copy of one, so later catalogue edits never change a filed diagram. */
export interface Part {
  id: string; family: Family; kind: PartKind; name: string;
  rating_psi: number | null; service: Service | null; id_in: number | null;
  od_in: number | null; fn_in: number | null; top_conn: string | null; bottom_conn: string | null;
  length_ft: number | null; weight_lb: number | null; stroke_ft: number | null; rams: number | null;
  source: string | null; active: number;
}

export interface Row {
  part_id: string | null; kind: PartKind; name: string;
  rating_psi: number | null; service: Service | null; id_in: number | null;
  od_in: number | null; fn_in: number | null; top_conn: string | null; bottom_conn: string | null;
  length_ft: number | null; weight_lb: number | null; stroke_ft: number | null; rams: number | null;
}

export const MAX_ROWS = 30;
const NUM_FIELDS = ['rating_psi', 'id_in', 'od_in', 'fn_in', 'length_ft', 'weight_lb', 'stroke_ft', 'rams'] as const;
const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown, max = 60) => { const s = String(v ?? '').trim().slice(0, max); return s || null; };
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Checks one part's values (a catalogue part or a diagram row). Returns the cleaned values or an error. */
function cleanValues(p: Record<string, unknown>, family: Family, where: string): { values: Omit<Row, 'part_id'> } | { error: string } {
  const kind = String(p.kind ?? '') as PartKind;
  if (!PART_KINDS[kind] || PART_KINDS[kind].family !== family) return { error: `${where}: pick a ${family === 'pce' ? 'pressure control' : 'tool'} type` };
  const name = str(p.name, 80);
  if (!name) return { error: `${where} needs a description` };
  const n = Object.fromEntries(NUM_FIELDS.map((k) => [k, num(p[k])])) as Record<(typeof NUM_FIELDS)[number], number | null>;
  if (NUM_FIELDS.some((k) => n[k] !== null && n[k]! < 0)) return { error: `${where}: sizes can't be negative` };
  if (n.rating_psi !== null && !RATINGS.includes(n.rating_psi as (typeof RATINGS)[number])) return { error: `${where}: rating must be 3,000 to 20,000 psi` };
  if (n.od_in !== null && n.od_in > 12) return { error: `${where}: OD over 12 in is not a slickline tool` };
  if (n.id_in !== null && n.id_in > 12) return { error: `${where}: ID over 12 in` };
  if (n.length_ft !== null && n.length_ft > 60) return { error: `${where}: length over 60 ft` };
  if (n.rams !== null && (!Number.isInteger(n.rams) || n.rams < 1 || n.rams > 4)) return { error: `${where}: 1 to 4 rams` };
  const service = p.service === 'std' || p.service === 'h2s' ? p.service : null;
  return { values: { kind, name, service, top_conn: str(p.top_conn), bottom_conn: str(p.bottom_conn), ...n } };
}

/** Cleans a catalogue part from the Database form. */
export function cleanPart(b: Record<string, unknown>): { values: Omit<Part, 'id' | 'active'> } | { error: string } {
  const family = b.family === 'tool' ? 'tool' : b.family === 'pce' ? 'pce' : null;
  if (!family) return { error: 'Pick pressure control or tool' };
  const r = cleanValues(b, family, 'The part');
  if ('error' in r) return r;
  return { values: { family, ...r.values, source: str(b.source, 80) } };
}

/** Cleans a diagram's rows: known shape, numbers or null, at most MAX_ROWS rows. */
export function cleanRows(input: unknown, family: Family): { rows: Row[] } | { error: string } {
  if (!Array.isArray(input)) return { error: 'The diagram must be a list of parts' };
  if (input.length > MAX_ROWS) return { error: `A diagram has at most ${MAX_ROWS} parts` };
  const rows: Row[] = [];
  for (const [i, raw] of input.entries()) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const r = cleanValues(p, family, `Row ${i + 1}`);
    if ('error' in r) return r;
    rows.push({ part_id: str(p.part_id, 40), ...r.values });
  }
  return { rows };
}

/** A diagram row from a catalogue part. */
export const rowFromPart = (p: Part): Row => ({
  part_id: p.id, kind: p.kind, name: p.name, rating_psi: p.rating_psi, service: p.service, id_in: p.id_in, od_in: p.od_in, fn_in: p.fn_in,
  top_conn: p.top_conn, bottom_conn: p.bottom_conn, length_ft: p.length_ft, weight_lb: p.weight_lb, stroke_ft: p.stroke_ft, rams: p.rams,
});

/** Where a new part goes: below the last row of the same or an earlier stage of the stack. */
export function insertIndex(rows: Row[], kind: PartKind): number {
  const rank = PART_KINDS[kind].rank;
  for (let i = rows.length - 1; i >= 0; i--) if (PART_KINDS[rows[i].kind].rank <= rank) return i + 1;
  return 0;
}

// ---- connections ----

const norm = (c: string | null) => (c ?? '').toLowerCase().replace(/\s+/g, '').replace(/[″"]/g, '"');
export interface Joint { index: number; ok: boolean | null; above: string | null; below: string | null }
/** The make-up between each row and the next. ok is null when a side isn't known. */
export function joints(rows: Row[]): Joint[] {
  return rows.slice(0, -1).map((r, i) => {
    const above = r.bottom_conn, below = rows[i + 1].top_conn;
    return { index: i, above, below, ok: !above || !below ? null : norm(above) === norm(below) };
  });
}

/** A crossover that makes up the two rows either side of a bad joint. */
export function crossoverFor(above: Row, below: Row, family: Family): Row {
  const rating = above.rating_psi != null && below.rating_psi != null ? Math.min(above.rating_psi, below.rating_psi) : above.rating_psi ?? below.rating_psi;
  return {
    part_id: null, kind: family === 'pce' ? 'pce_crossover' : 'tool_crossover',
    name: `Crossover ${above.bottom_conn ?? '?'} × ${below.top_conn ?? '?'}`,
    rating_psi: family === 'pce' ? rating : null, service: family === 'pce' ? (above.service === 'h2s' && below.service === 'h2s' ? 'h2s' : above.service ?? below.service) : null,
    id_in: family === 'pce' ? minOf([above.id_in, below.id_in]) : null, od_in: family === 'tool' ? maxOf([above.od_in, below.od_in]) : null, fn_in: null,
    top_conn: above.bottom_conn, bottom_conn: below.top_conn, length_ft: null, weight_lb: null, stroke_ft: null, rams: null,
  };
}

const minOf = (v: (number | null)[]) => { const x = v.filter((n): n is number => n != null); return x.length ? Math.min(...x) : null; };
const maxOf = (v: (number | null)[]) => { const x = v.filter((n): n is number => n != null); return x.length ? Math.max(...x) : null; };
const sumOf = (v: (number | null)[]) => round(v.reduce<number>((a, n) => a + (n ?? 0), 0));
const isJar = (k: PartKind) => k.startsWith('jar_') || k === 'accelerator';

// ---- totals ----

export interface RigTotals { parts: number; length_ft: number; lubricator_ft: number; min_id_in: number | null; system_wp: number | null; missing_length: number }
/** Length is above the tree (the tree is the client's). System working pressure is the lowest-rated part (Pressure Standard §9.1). */
export function rigTotals(rows: Row[]): RigTotals {
  const ours = rows.filter((r) => r.kind !== 'tree');
  return {
    parts: rows.length,
    length_ft: sumOf(ours.map((r) => r.length_ft)),
    lubricator_ft: sumOf(ours.filter((r) => r.kind === 'lubricator').map((r) => r.length_ft)),
    min_id_in: minOf(ours.map((r) => r.id_in)),
    system_wp: minOf(ours.map((r) => r.rating_psi)),
    missing_length: ours.filter((r) => r.length_ft == null).length,
  };
}

export interface StringTotals { parts: number; length_ft: number; length_open_ft: number; max_od_in: number | null; weight_lb: number | null; weight_above_jar_lb: number | null; missing_weight: number }
/** Length with the jars open (QAF14010), and the weight above the first jar, which is what drives the jar (SOP-01 §7.6). */
export function stringTotals(rows: Row[]): StringTotals {
  const jar = rows.findIndex((r) => isJar(r.kind));
  const above = jar < 0 ? rows : rows.slice(0, jar);
  const length = sumOf(rows.map((r) => r.length_ft));
  return {
    parts: rows.length,
    length_ft: length,
    length_open_ft: round(length + sumOf(rows.filter((r) => isJar(r.kind)).map((r) => r.stroke_ft))),
    max_od_in: maxOf(rows.map((r) => r.od_in)),
    weight_lb: rows.some((r) => r.weight_lb != null) ? sumOf(rows.map((r) => r.weight_lb)) : null,
    weight_above_jar_lb: above.some((r) => r.weight_lb != null) ? sumOf(above.map((r) => r.weight_lb)) : null,
    missing_weight: rows.filter((r) => r.weight_lb == null).length,
  };
}

/** The old Preparation toolstring, kept in step with Run 1 so the report, package, checks and pre-job note keep working. */
export const legacyToolstring = (rows: Row[]): ToolPart[] => rows.slice(0, 20).map((r) => ({ component: r.name.slice(0, 60), od_in: r.od_in, length_ft: r.length_ft, weight_lb: r.weight_lb }));

// ---- checks ----

export interface Well { mpwhp_psi: number | null; h2s_ppm: number | null; min_id_in: number | null; wire_in: number | null }
export interface Check { level: 'danger' | 'warning' | 'ok'; text: string; cite: string }
const f = (n: number, d = 2) => n.toLocaleString('en-US', { maximumFractionDigits: d });

/**
 * Checks for one diagram. A rig up is checked with every run's tool string (the longest and the widest decide);
 * a tool string with the job's rig up. Not blocking: they show the risk, the SDM decides on review.
 */
export function diagramChecks(kind: DiagramKind, rig: Row[] | null, strings: Row[][], well: Well): Check[] {
  const out: Check[] = [];
  const add = (level: Check['level'], text: string, cite: string) => out.push({ level, text, cite });
  const rt = rig?.length ? rigTotals(rig) : null;
  const st = strings.filter((s) => s.length).map(stringTotals);
  const longest = st.length ? Math.max(...st.map((t) => t.length_open_ft)) : null;
  const widest = st.length ? maxOf(st.map((t) => t.max_od_in)) : null;
  const rows = kind === 'rigup' ? rig ?? [] : strings[0] ?? [];
  const what = kind === 'rigup' ? 'rig up' : 'tool string';

  // connections, this diagram
  const bad = joints(rows).filter((j) => j.ok === false);
  // the client's tree is often left without a connection; it is still checked once one is filled in
  const unknown = joints(rows).filter((j) => j.ok === null && rows[j.index + 1].kind !== 'tree').length;
  for (const j of bad) add('danger', `Rows ${j.index + 1}–${j.index + 2}: ${j.above} does not make up to ${j.below}. Add a crossover.`, 'Pressure Standard §7.5, §7.6');
  if (rows.length > 1 && !bad.length) add(unknown ? 'warning' : 'ok', unknown ? `${unknown} connection${unknown === 1 ? '' : 's'} not filled in, so not checked.` : 'Every connection makes up to the next part.', 'Pressure Standard §7.5');

  if (rt) {
    // rating
    if (well.mpwhp_psi == null) add('warning', 'No SIWHP on Preparation, so the pressure rating is not checked.', 'Pressure Standard §9.2.1');
    else {
      const need = Math.round(well.mpwhp_psi * 1.2);
      if (rt.system_wp == null) add('warning', 'No pressure ratings on the rig up parts.', 'Pressure Standard §9.1');
      else if (rt.system_wp >= need) add('ok', `Rig up rated ${f(rt.system_wp)} psi ≥ 1.2 × SIWHP (${f(need)} psi). Pressure test at the well to ${f(need)} psi.`, 'Pressure Standard §9.2.1, §9.2.3');
      else add('danger', `Rig up is only rated ${f(rt.system_wp)} psi (its lowest part). It needs ${f(need)} psi: 1.2 × SIWHP.`, 'Pressure Standard §9.1, §9.2.1');
    }
    // service
    if ((well.h2s_ppm ?? 0) > 0) {
      const std = (rig ?? []).filter((r) => r.kind !== 'tree' && r.service !== 'h2s');
      if (std.length) add('danger', `Sour well (${f(well.h2s_ppm!)} ppm H₂S): ${std.map((r) => r.name).slice(0, 3).join(', ')}${std.length > 3 ? ` and ${std.length - 3} more` : ''} ${std.length === 1 ? 'is' : 'are'} not H₂S service.`, 'Pressure Standard §6.2.2, NACE MR0175');
      else add('ok', 'Every part is H₂S service for a sour well.', 'Pressure Standard §6.2.2');
    }
    // required parts
    const has = (...k: PartKind[]) => (rig ?? []).some((r) => k.includes(r.kind));
    const missing = [!has('stuffing_box', 'grease_head') && 'stuffing box', !has('wireline_valve') && 'wireline valve', !has('tool_catcher') && 'tool catcher'].filter(Boolean);
    if (missing.length) add('warning', `No ${missing.join(', ')} in the rig up.`, 'SOP-01 §10, Pressure Standard §9.2.7');
    // bore against the widest tool
    if (rt.min_id_in != null && widest != null) {
      if (rt.min_id_in >= widest + 0.25) add('ok', `Smallest bore ${f(rt.min_id_in, 3)} in clears the widest tool ${f(widest, 3)} in + 0.25 in.`, 'Pressure Standard §9.2.4');
      else add('danger', `Smallest bore ${f(rt.min_id_in, 3)} in is less than the widest tool ${f(widest, 3)} in + 0.25 in.`, 'Pressure Standard §9.2.4');
    }
    // lubricator against the longest string
    if (longest != null && longest > 0) {
      if (!rt.lubricator_ft) add('warning', 'No lubricator length in the rig up.', 'Pressure Standard §9.2.5');
      else if (rt.lubricator_ft >= longest + 3) add('ok', `Lubricator ${f(rt.lubricator_ft)} ft ≥ longest tool string with jars open ${f(longest)} ft + 3 ft.`, 'Pressure Standard §9.2.5');
      else add('danger', `Lubricator ${f(rt.lubricator_ft)} ft is short: the longest tool string with jars open is ${f(longest)} ft, so it needs ${f(longest + 3)} ft.`, 'Pressure Standard §9.2.5');
    }
    if (kind === 'rigup' && rt.missing_length) add('warning', `${rt.missing_length} part${rt.missing_length === 1 ? ' has' : 's have'} no length, so the totals are short.`, 'QAF14009');
  } else if (kind === 'toolstring') add('warning', 'No rig up diagram yet, so the bore and lubricator are not checked.', 'Pressure Standard §9.2.4, §9.2.5');

  if (kind === 'toolstring' && rows.length) {
    const t = stringTotals(rows);
    if (well.min_id_in != null && t.max_od_in != null) {
      if (t.max_od_in < well.min_id_in) add('ok', `Widest tool ${f(t.max_od_in, 3)} in passes the ${f(well.min_id_in, 3)} in minimum restriction.`, 'SOP-01 §7.16.2');
      else add('danger', `Widest tool ${f(t.max_od_in, 3)} in does not pass the ${f(well.min_id_in, 3)} in minimum restriction.`, 'SOP-01 §7.16.2');
    }
    if (well.mpwhp_psi != null && well.wire_in != null) {
      const balance = Math.PI / 4 * well.wire_in ** 2 * well.mpwhp_psi, need = Math.round(balance + 40);
      if (t.weight_above_jar_lb == null) add('warning', `No weights entered, so the stem weight is not checked (needs about ${need} lb above the jar).`, 'SOP-01 §7.6, §7.16.6');
      else if (t.weight_above_jar_lb >= need) add('ok', `Weight above the jar ${f(t.weight_above_jar_lb)} lb ≥ balance ${f(balance, 0)} lb + 40 lb.`, 'SOP-01 §7.6, §7.16.6');
      else add('warning', `Weight above the jar ${f(t.weight_above_jar_lb)} lb is under balance ${f(balance, 0)} lb + 40 lb = ${need} lb. Add stem.`, 'SOP-01 §7.6, §7.16.6');
    }
  }
  if (!rows.length) add('warning', `The ${what} has no parts yet.`, kind === 'rigup' ? 'QAF14009' : 'QAF14010');
  const order = { danger: 0, warning: 1, ok: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// ---- revision and review ----

export type DiagramStatus = 'draft' | 'sent' | 'reviewed';
export interface DiagramState { rev: number; pdf_rev: number | null; status: DiagramStatus }

/**
 * After a save. Rev 0 until a PDF is made; the first change after a PDF of the current revision raises it by one.
 * Any change sends a sent or reviewed diagram back to draft: a review covers one revision.
 */
export function afterChange(cur: DiagramState, changed: boolean): DiagramState {
  if (!changed) return cur;
  return { rev: cur.pdf_rev != null && cur.pdf_rev >= cur.rev ? cur.rev + 1 : cur.rev, pdf_rev: cur.pdf_rev, status: 'draft' };
}

export const FORM = {
  rigup: { code: 'QAF14009', title: 'Rig Up Diagram' },
  toolstring: { code: 'QAF14010', title: 'Slickline String Diagram' },
} as const;

// ---- pictures from the workbooks ----

/**
 * Which workbook picture shows a row, and how wide it is drawn as a share of the assembly column. Pictures are
 * stretched to the row's height so the stack reads as one continuous string. Owner's classification 2026-11-04:
 * R6 tool trap, R15 WHE crossover, R19 quick test sub, R3 ported lubricator. Parts with no picture are drawn.
 */
export type PictureKey =
  | 'tree' | 'wellhead_adapter' | 'bop_single' | 'bop_dual' | 'pump_in_sub' | 'lubricator' | 'lubricator_ported' | 'tool_trap' | 'pce_crossover' | 'quick_test_sub' | 'stuffing_box'
  | 'rope_socket' | 'stem' | 'stem_big' | 'roller_stem' | 'knuckle' | 'spang_jar' | 'tubular_jar' | 'hydraulic_jar' | 'knuckle_jar' | 'tool_crossover'
  | 'gauge_cutter' | 'impression_block' | 'blind_box' | 'sample_bailer' | 'hydrostatic_bailer' | 'pump_bailer' | 'wire_grab'
  | 'gs' | 'otis_sb' | 'otis_rb' | 'b_shifting' | 'camco_jd' | 'running_tool' | 'otis_rx' | 'otis_plug' | 'prong' | 'eq_prong';

/** Width of each PCE picture as a share of the column, for a 4.75" quick union; bigger unions draw wider. */
const PCE_WIDTH: Partial<Record<PictureKey, number>> = {
  stuffing_box: 0.8, lubricator: 0.2, lubricator_ported: 0.27, tool_trap: 0.24, quick_test_sub: 0.2, pce_crossover: 0.3,
  bop_single: 0.95, bop_dual: 0.95, pump_in_sub: 0.42, wellhead_adapter: 0.6, tree: 0.95,
};
/** Tool pictures wider than their body (dogs, prongs, fingers). */
const TOOL_SPREAD: Partial<Record<PictureKey, number>> = { gs: 1.3, wire_grab: 1.5, otis_sb: 1.2, otis_rb: 1.2, b_shifting: 1.2, camco_jd: 1.2 };

export function pictureFor(r: Row): { key: PictureKey; width: number } | null {
  const n = r.name.toLowerCase();
  const pce = (key: PictureKey) => {
    const scale = key === 'tree' || key.startsWith('bop') ? 1 : Math.max(0.9, Math.min(1.35, (threadOd(r.bottom_conn) ?? threadOd(r.top_conn) ?? 4.75) / 4.75));
    return { key, width: Math.min(0.98, PCE_WIDTH[key]! * scale) };
  };
  const tool = (key: PictureKey) => ({ key, width: Math.min(0.9, ((r.od_in ?? 1.875) / 9) * (TOOL_SPREAD[key] ?? 1)) });
  switch (r.kind) {
    case 'stuffing_box': return pce('stuffing_box');
    case 'lubricator': return pce(/ported/.test(n) ? 'lubricator_ported' : 'lubricator');
    case 'tool_trap': return pce('tool_trap');
    case 'quick_test_sub': return pce('quick_test_sub');
    case 'wireline_valve': return pce((r.rams ?? 1) >= 2 ? 'bop_dual' : 'bop_single');
    case 'pump_in_sub': return pce('pump_in_sub');
    case 'pce_crossover': return pce('pce_crossover');
    case 'wellhead_adapter': return pce('wellhead_adapter');
    case 'tree': return pce('tree');
    case 'rope_socket': return tool('rope_socket');
    case 'swivel': return tool('knuckle');
    case 'stem': return tool((r.od_in ?? 0) >= 2.1 ? 'stem_big' : 'stem');
    case 'roller_stem': return tool('roller_stem');
    case 'knuckle': return tool(/jar/.test(n) ? 'knuckle_jar' : 'knuckle');
    case 'jar_mech': return tool('spang_jar');
    case 'jar_tubular': case 'jar_spring': return tool('tubular_jar');
    case 'jar_hyd': case 'accelerator': return tool('hydraulic_jar');
    case 'tool_crossover': return tool('tool_crossover');
    case 'gauge_cutter': return tool('gauge_cutter');
    case 'impression_block': return tool('impression_block');
    case 'blind_box': return tool('blind_box');
    case 'bailer': return tool(/hydrostatic/.test(n) ? 'hydrostatic_bailer' : /pump|sand/.test(n) ? 'pump_bailer' : 'sample_bailer');
    case 'wire_finder': return /grab/.test(n) ? tool('wire_grab') : null;
    case 'pulling_tool':
      return tool(/shifting/.test(n) ? 'b_shifting' : /camco|\bj[du]\b/.test(n) ? 'camco_jd' : /otis s\b|\bsb\b/.test(n) ? 'otis_sb' : /otis r\b|\brb\b/.test(n) ? 'otis_rb'
        : /\bx running|\brx\b/.test(n) ? 'otis_rx' : /running/.test(n) ? 'running_tool' : 'gs');
    case 'plug_prong': return tool(/prong/.test(n) ? (/equali/.test(n) ? 'eq_prong' : 'prong') : 'otis_plug');
    default: return null;
  }
}

// ---- drawings ----

/** Drawing primitives in a W × H box, y down. The editor turns them into SVG, the PDF into paths. */
export type Prim =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | { t: 'poly'; pts: [number, number][]; fill: string }
  | { t: 'circle'; cx: number; cy: number; r: number; fill: string | null; stroke: string }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number };

/** Body blue with the working-pressure colour band (Pressure Standard §8.2). */
export const BAND: Record<number, string> = { 3000: '#f2c94c', 5000: '#d0312d', 10000: '#111111', 15000: '#f4f4f4', 20000: '#7b4a26' };
const BLUE = '#2f6db0', STEEL = '#b7bfc8', STEEL_D = '#7d8792', DARK = '#5b6673', RED = '#c0392b', BROWN = '#8a5a2b', LIGHT = '#dfe4ea';

/** Thread OD in inches from a connection like 6.125"-4x2 (4.750"). */
export const threadOd = (c: string | null) => { const m = /^\s*([\d.]+)"/.exec(c ?? ''); return m ? Number(m[1]) : null; };

/** Draws one row. Widths follow the part's connection (PCE) or OD (tools), so the stack reads in proportion. */
export function drawPart(r: Row, family: Family, W: number, H: number): Prim[] {
  const g: Prim[] = [], cx = W / 2;
  const rect = (x: number, y: number, w: number, h: number, fill: string) => g.push({ t: 'rect', x, y, w, h, fill });
  const poly = (pts: [number, number][], fill: string) => g.push({ t: 'poly', pts, fill });
  if (family === 'pce') {
    const scale = Math.min(W / 11, 14);
    const body = Math.min(W * 0.62, (threadOd(r.bottom_conn) ?? threadOd(r.top_conn) ?? 4.75) * scale * 0.7);
    const band = r.rating_psi ? BAND[r.rating_psi] ?? DARK : null;
    const stripe = (y: number, w: number) => band && rect(cx - w / 2, y, w, H * 0.08, band);
    const nut = (y: number, w: number) => rect(cx - w / 2 - 3, y, w + 6, Math.max(3, H * 0.09), DARK);
    switch (r.kind) {
      case 'stuffing_box':
        rect(cx - body / 2, H * 0.3, body, H * 0.6, BLUE); g.push({ t: 'circle', cx, cy: H * 0.17, r: H * 0.14, fill: LIGHT, stroke: '#1b2430' }); stripe(H * 0.48, body); nut(H * 0.88, body * 0.8); break;
      case 'grease_head':
        rect(cx - body * 0.25, H * 0.02, body * 0.5, H * 0.88, BLUE);
        for (let i = 1; i < 5; i++) g.push({ t: 'line', x1: cx - body * 0.25, y1: H * 0.18 * i, x2: cx + body * 0.25, y2: H * 0.18 * i, stroke: '#9fc3ea', width: 1 });
        stripe(H * 0.5, body * 0.5); nut(H * 0.88, body * 0.7); break;
      case 'lubricator': {
        const w = Math.min(W * 0.5, ((r.id_in ?? 3) + 1.2) * scale * 0.7);
        rect(cx - w / 2, 0, w, H, STEEL); stripe(H * 0.42, w); nut(0, w); nut(H - Math.max(3, H * 0.09), w); break;
      }
      case 'tool_catcher': case 'tool_trap':
        rect(cx - body / 2, H * 0.1, body, H * 0.8, BLUE); rect(cx + body / 2, H * 0.35, Math.max(6, W * 0.06), H * 0.2, DARK); stripe(H * 0.42, body); nut(0, body * 0.7); nut(H * 0.91, body * 0.7); break;
      case 'wireline_valve': {
        const n = Math.max(1, Math.min(4, r.rams ?? 1)), bw = body * 0.9;
        rect(cx - bw / 2, 0, bw, H, BLUE);
        for (let i = 0; i < n; i++) {
          const y = H * (0.12 + i * (0.76 / n)), h = H * 0.62 / n;
          rect(cx - W * 0.44, y, W * 0.88, h, '#3d7fc6');
          rect(cx - W * 0.48, y + h * 0.3, W * 0.04, h * 0.4, '#d0312d'); rect(cx + W * 0.44, y + h * 0.3, W * 0.04, h * 0.4, '#d0312d');
        }
        stripe(H * 0.02, bw); break;
      }
      case 'pump_in_sub':
        rect(cx - body / 2, 0, body, H, BLUE); rect(cx + body / 2, H * 0.4, W * 0.22, H * 0.16, STEEL); rect(cx + body / 2 + W * 0.22, H * 0.3, Math.max(4, W * 0.04), H * 0.36, '#d0312d'); stripe(H * 0.12, body); break;
      case 'pce_crossover': {
        const t = Math.min(W * 0.6, (threadOd(r.top_conn) ?? 4.75) * scale * 0.7), b = Math.min(W * 0.6, (threadOd(r.bottom_conn) ?? 4.75) * scale * 0.7);
        poly([[cx - t / 2, 0], [cx + t / 2, 0], [cx + b / 2, H], [cx - b / 2, H]], BLUE); stripe(H * 0.46, Math.min(t, b)); break;
      }
      case 'wellhead_adapter':
        rect(cx - body / 2, 0, body, H * 0.68, BLUE); rect(cx - W * 0.38, H * 0.68, W * 0.76, H * 0.32, BROWN); stripe(H * 0.2, body); break;
      case 'tree':
        rect(cx - W * 0.12, 0, W * 0.24, H, RED); rect(cx - W * 0.46, H * 0.38, W * 0.92, H * 0.26, RED);
        for (const x of [cx - W * 0.34, cx + W * 0.34]) g.push({ t: 'circle', cx: x, cy: H * 0.51, r: H * 0.2, fill: null, stroke: '#7a1f1a' });
        g.push({ t: 'circle', cx, cy: H * 0.2, r: H * 0.14, fill: null, stroke: '#7a1f1a' }); break;
      default:
        rect(cx - body * 0.4, 0, body * 0.8, H, BLUE); stripe(H * 0.46, body * 0.8); nut(0, body * 0.6); nut(H * 0.91, body * 0.6);
    }
    return g;
  }
  const w = Math.min(W * 0.7, (r.od_in ?? 1.875) * Math.min(W / 6, 22));
  switch (r.kind) {
    case 'rope_socket':
      g.push({ t: 'line', x1: cx, y1: 0, x2: cx, y2: H * 0.06, stroke: '#555555', width: 2 });
      poly([[cx - w * 0.2, H * 0.06], [cx + w * 0.2, H * 0.06], [cx + w / 2, H * 0.42], [cx + w / 2, H], [cx - w / 2, H], [cx - w / 2, H * 0.42]], STEEL); break;
    case 'stem': rect(cx - w * 0.35, 0, w * 0.7, H * 0.12, STEEL_D); rect(cx - w / 2, H * 0.12, w, H * 0.88, STEEL); break;
    case 'roller_stem':
      rect(cx - w / 2, 0, w, H, STEEL);
      for (let i = 1; i < 4; i++) rect(cx - w * 0.62, H * 0.25 * i - 2, w * 1.24, 4, DARK); break;
    case 'knuckle': case 'swivel':
      rect(cx - w * 0.35, 0, w * 0.7, H * 0.32, STEEL); g.push({ t: 'circle', cx, cy: H * 0.5, r: w * 0.5, fill: STEEL, stroke: '#1b2430' }); rect(cx - w * 0.35, H * 0.68, w * 0.7, H * 0.32, STEEL); break;
    case 'jar_mech':
      rect(cx - w / 2, 0, w, H * 0.4, STEEL); rect(cx - w / 2, H * 0.4, w * 0.22, H * 0.38, STEEL); rect(cx + w * 0.28, H * 0.4, w * 0.22, H * 0.38, STEEL);
      rect(cx - w * 0.15, H * 0.3, w * 0.3, H * 0.5, STEEL_D); rect(cx - w / 2, H * 0.78, w, H * 0.22, STEEL); break;
    case 'jar_tubular': case 'jar_hyd': case 'jar_spring': case 'accelerator':
      rect(cx - w / 2, 0, w, H, STEEL);
      for (let i = 1; i < 6; i++) g.push({ t: 'line', x1: cx - w / 2, y1: H * i / 6, x2: cx + w / 2, y2: H * i / 6, stroke: STEEL_D, width: 1 }); break;
    case 'tool_crossover': poly([[cx - w / 2, 0], [cx + w / 2, 0], [cx + w * 0.32, H], [cx - w * 0.32, H]], STEEL); break;
    case 'gauge_cutter':
      rect(cx - w * 0.3, 0, w * 0.6, H * 0.6, STEEL); rect(cx - w / 2, H * 0.6, w, H * 0.3, STEEL);
      for (let i = 0; i < 6; i++) poly([[cx - w / 2 + i * w / 6, H * 0.9], [cx - w / 2 + (i + 0.5) * w / 6, H], [cx - w / 2 + (i + 1) * w / 6, H * 0.9]], STEEL_D); break;
    case 'impression_block': rect(cx - w * 0.3, 0, w * 0.6, H * 0.4, STEEL); rect(cx - w / 2, H * 0.4, w, H * 0.6, '#b9a27a'); break;
    case 'blind_box': rect(cx - w * 0.3, 0, w * 0.6, H * 0.4, STEEL); rect(cx - w / 2, H * 0.4, w, H * 0.6, STEEL_D); break;
    case 'bailer': rect(cx - w / 2, 0, w, H, STEEL); rect(cx - w * 0.3, H * 0.9, w * 0.6, H * 0.1, DARK); break;
    case 'pulling_tool': case 'plug_prong':
      rect(cx - w * 0.3, 0, w * 0.6, H * 0.4, STEEL); rect(cx - w / 2, H * 0.4, w, H * 0.45, STEEL);
      rect(cx - w / 2 - 3, H * 0.55, 4, H * 0.18, DARK); rect(cx + w / 2 - 1, H * 0.55, 4, H * 0.18, DARK); break;
    case 'wire_finder': rect(cx - w * 0.3, 0, w * 0.6, H * 0.5, STEEL); poly([[cx - w / 2, H * 0.5], [cx + w / 2, H * 0.5], [cx + w * 0.3, H], [cx - w * 0.3, H]], STEEL_D); break;
    default: rect(cx - w / 2, 0, w, H, STEEL);
  }
  return g;
}
