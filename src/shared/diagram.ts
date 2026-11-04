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

// ---- drawings ----

/**
 * Drawing primitives in a W × H box, y down. The editor turns them into SVG, the PDF into paths.
 * A rect with fill null is an outline only; with outline true it gets the dark edge too.
 */
export type Prim =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: string | null; outline?: boolean }
  | { t: 'poly'; pts: [number, number][]; fill: string }
  | { t: 'circle'; cx: number; cy: number; r: number; fill: string | null; stroke: string }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number }
  | { t: 'text'; x: number; y: number; s: string; size: number };

/** Thread OD in inches from a connection like 6.125"-4x2 (4.750"). */
export const threadOd = (c: string | null) => { const m = /^\s*([\d.]+)"/.exec(c ?? ''); return m ? Number(m[1]) : null; };

// Owner request 2026-11-04 (after WirelineMaster): plain steel, no colours, every part at one scale so none looks
// oversized. Bodies are shaded cylinders (vertical bands), so they read as round in SVG and in the PDF alike.
const EDGE = '#3b434d';
// chrome, lit from the front-left like the Elmar renderings: dark rim, bright narrow highlight, soft falloff
const STEEL = ['#4f5761', '#8f98a2', '#dfe4e9', '#ffffff', '#aeb6be', '#68707a'];
const COLLAR = ['#3e454e', '#666e78', '#9aa2ab', '#c4cad0', '#7d858f', '#525a63'];
const BANDS = [0.07, 0.18, 0.12, 0.1, 0.33, 0.2];
/** Inches across the assembly column: the same for every part of a family, so sizes compare truly. */
const SPAN: Record<Family, number> = { pce: 16.5, tool: 4.2 };

export function drawPart(r: Row, family: Family, W: number, H: number): Prim[] {
  const g: Prim[] = [], cx = W / 2, k = W / SPAN[family];
  const rect = (x: number, y: number, w: number, h: number, fill: string | null, outline = false) => g.push({ t: 'rect', x, y, w, h, fill, outline });
  const poly = (pts: [number, number][], fill = STEEL[2]) => g.push({ t: 'poly', pts, fill });
  const line = (x1: number, y1: number, x2: number, y2: number, width = 0.6, stroke = EDGE) => g.push({ t: 'line', x1, y1, x2, y2, stroke, width });
  const circle = (x: number, y: number, rr: number, fill: string | null = null) => g.push({ t: 'circle', cx: x, cy: y, r: rr, fill, stroke: EDGE });
  /** A shaded cylinder d inches across, centred on x (vertical) or y (horizontal). */
  const cyl = (y: number, d: number, h: number, tone = STEEL, x = cx) => {
    const w = Math.min(d * k, W), x0 = x - w / 2;
    let at = x0;
    BANDS.forEach((f, i) => { rect(at, y, w * f + 0.3, h, tone[i]); at += w * f; });
    rect(x0, y, w, h, null, true);
  };
  const hcyl = (x: number, y: number, len: number, d: number, tone = STEEL) => {
    const h = d * k, y0 = y - h / 2;
    let at = y0;
    BANDS.forEach((f, i) => { rect(x, at, len, h * f + 0.3, tone[i]); at += h * f; });
    rect(x, y0, len, h, null, true);
  };
  const taper = (y: number, d1: number, d2: number, h: number) => {
    const a = (d1 * k) / 2, b = (d2 * k) / 2;
    poly([[cx - a, y], [cx + a, y], [cx + b, y + h], [cx - b, y + h]]);
  };

  if (family === 'pce') {
    // After the Elmar WPCE string (catalogue section 3): each part has a threaded male pin on top and a knurled union
    // nut at the bottom, so the nut of one part sits over the pin of the next and the string reads continuous.
    const thread = (c: string | null, fallback: number) => threadOd(c) ?? fallback;
    const top = thread(r.top_conn, thread(r.bottom_conn, 4.75)), bot = thread(r.bottom_conn, top);
    const pinH = Math.min(H * 0.14, 1.8 * k), nutH = Math.min(H * 0.22, 3 * k);
    /** A square block: flat lit face with darker edges. */
    const block = (y: number, d: number, h: number, x = cx) => {
      const w = d * k, x0 = x - w / 2;
      // flat faces: a lit front face between two darker side faces, with a soft sheen
      rect(x0, y, w * 0.12, h, STEEL[0]); rect(x0 + w * 0.12, y, w * 0.76, h, STEEL[2]); rect(x0 + w * 0.3, y, w * 0.16, h, '#eef1f4'); rect(x0 + w * 0.88, y, w * 0.12, h, STEEL[5]);
      line(x0 + w * 0.12, y, x0 + w * 0.12, y + h, 0.4, STEEL[0]); line(x0 + w * 0.88, y, x0 + w * 0.88, y + h, 0.4, STEEL[0]);
      rect(x0, y, w, h, null, true);
    };
    /** The male quick-union pin with its thread. */
    const pin = (d: number) => {
      cyl(0, d - 0.35, pinH);
      for (let yy = 1.2; yy < pinH - 0.5; yy += Math.max(1.1, pinH / 6)) line(cx - ((d - 0.35) * k) / 2, yy, cx + ((d - 0.35) * k) / 2, yy, 0.3, STEEL[0]);
    };
    /** The union nut (collar) at the bottom: a chamfered shoulder and the ringed nut, as on the Elmar collars. */
    const nut = (d: number) => {
      const y = H - nutH, w = (d + 1.4) * k, lip = Math.min(nutH * 0.18, 0.5 * k);
      cyl(y, d + 0.6, lip, COLLAR);
      cyl(y + lip, d + 1.4, nutH - lip, COLLAR);
      for (const f of [0.3, 0.5, 0.7, 0.88]) line(cx - w / 2, y + lip + (nutH - lip) * f, cx + w / 2, y + lip + (nutH - lip) * f, 0.4, COLLAR[0]);
    };
    /** A side port: a short stub with a needle valve and T handle. */
    const needle = (y: number, from: number, side = 1) => {
      const x = from, len = 1.4 * k;
      hcyl(side > 0 ? x : x - len, y, len, 0.7);
      const vx = side > 0 ? x + len : x - len - 0.9 * k;
      block(y - 0.55 * k, 0.9, 1.1 * k, vx + 0.45 * k);
      line(vx + 0.45 * k, y - 0.55 * k, vx + 0.45 * k, y - 1.5 * k, 0.8);
      line(vx - 0.2 * k, y - 1.5 * k, vx + 1.1 * k, y - 1.5 * k, 1);
    };
    const mid0 = pinH, mid1 = H - nutH, midH = mid1 - mid0;
    switch (r.kind) {
      case 'stuffing_box': {
        // after the Elmar lightweight stuffing box: a large spoked sheave on a curved bracket, the line coming off its
        // left side into the packing housing, packing nut ring, body and hydraulic port, union nut below
        const rr = Math.min(3.6 * k, H * 0.3), scx = cx + rr * 0.95, scy = rr + 0.5;
        const bodyTop = scy + rr * 0.35, bodyH = H - nutH - bodyTop;
        cyl(bodyTop, 1.9, bodyH * 0.38);
        cyl(bodyTop + bodyH * 0.38, 3.2, bodyH * 0.14, COLLAR);
        cyl(bodyTop + bodyH * 0.52, 2.8, bodyH * 0.48);
        hcyl(cx - 1.9 * k / 2 - 0.8 * k, bodyTop + bodyH * 0.2, 0.8 * k, 0.45, COLLAR);
        // bracket: from the packing nut ring up and over to the sheave hub
        poly([[cx + 1.2 * k, bodyTop + bodyH * 0.4], [cx + 1.9 * k, bodyTop + bodyH * 0.4], [scx + 0.5 * k, scy + 0.3 * k], [scx - 0.4 * k, scy + 0.3 * k]], STEEL[2]);
        circle(scx, scy, rr, STEEL[1]); circle(scx, scy, rr * 0.86, STEEL[3]);
        for (let a = 0; a < 8; a++) { const t = (a * Math.PI) / 4; line(scx + Math.cos(t) * rr * 0.22, scy + Math.sin(t) * rr * 0.22, scx + Math.cos(t) * rr * 0.84, scy + Math.sin(t) * rr * 0.84, 0.7, STEEL[0]); }
        circle(scx, scy, rr * 0.22, STEEL[2]); circle(scx, scy, rr * 0.08, STEEL[0]);
        line(cx, scy, cx, bodyTop, 0.9, '#2b3138');
        nut(bot); break;
      }
      case 'grease_head': {
        cyl(0, 1.6, midH * 0.55 + mid0);
        for (let i = 1; i < 6; i++) line(cx - 0.8 * k, (mid0 + midH * 0.55) * i / 6, cx + 0.8 * k, (mid0 + midH * 0.55) * i / 6, 0.4, STEEL[0]);
        block(mid0 + midH * 0.55, top + 0.4, midH * 0.45);
        needle(mid0 + midH * 0.75, cx + ((top + 0.4) * k) / 2);
        nut(bot); break;
      }
      case 'lubricator': {
        pin(top);
        cyl(mid0, (r.id_in ?? 3) + 0.45, midH);
        if (/ported/i.test(r.name)) needle(mid0 + midH * 0.8, cx + (((r.id_in ?? 3) + 0.45) * k) / 2);
        nut(bot); break;
      }
      case 'tool_catcher': {
        pin(top);
        cyl(mid0, top + 0.4, midH * 0.4);
        block(mid0 + midH * 0.4, top + 1, midH * 0.6);
        // hydraulic release piston on the side
        hcyl(cx + ((top + 1) * k) / 2, mid0 + midH * 0.7, 1.6 * k, 1.1);
        cyl(mid0 + midH * 0.7 - 0.8 * k, 0.4, 1.6 * k, COLLAR, cx + ((top + 1) * k) / 2 + 1.8 * k);
        nut(bot); break;
      }
      case 'tool_trap': {
        pin(top);
        cyl(mid0, top + 0.2, midH * 0.2);
        block(mid0 + midH * 0.2, top + 1.6, midH * 0.6);
        // hydraulic actuator on the left, external flapper handle on the right
        block(mid0 + midH * 0.3, 1.6, midH * 0.3, cx - ((top + 1.6) * k) / 2 - 0.8 * k);
        line(cx + ((top + 1.6) * k) / 2, mid0 + midH * 0.5, cx + ((top + 1.6) * k) / 2 + 2.6 * k, mid0 + midH * 0.5, 1.4);
        line(cx + ((top + 1.6) * k) / 2 + 2.6 * k, mid0 + midH * 0.5, cx + ((top + 1.6) * k) / 2 + 2.6 * k, mid0 + midH * 0.95, 1.4);
        cyl(mid0 + midH * 0.8, top + 0.2, midH * 0.2);
        nut(bot); break;
      }
      case 'ball_check': case 'chem_sub': case 'bleed_sub': case 'quick_test_sub': {
        pin(top);
        const d = r.kind === 'ball_check' ? top + 0.8 : top + 0.3;
        cyl(mid0, d, midH);
        if (r.kind === 'ball_check') { line(cx - (d * k) / 2, mid0 + midH * 0.5, cx + (d * k) / 2, mid0 + midH * 0.5, 0.4, STEEL[0]); }
        else needle(mid0 + midH * 0.55, cx + (d * k) / 2);
        nut(bot); break;
      }
      case 'wireline_valve': {
        // after the Elmar lightweight wireline valve: round body, a ram housing ring per ram with bonnets out to
        // both sides, big end caps and indicator rods, manifold block on the face
        const n = Math.max(1, Math.min(4, r.rams ?? 1)), bd = top + 0.6, hd = top + 1.4;
        pin(top);
        cyl(mid0, bd, midH);
        for (let i = 0; i < n; i++) {
          const y = mid0 + (midH * (i + 0.5)) / n, rd = Math.min(2.3, (midH / n / k) * 0.72);
          cyl(y - (rd * k) / 2 - 0.3 * k, hd, rd * k + 0.6 * k);
          const x0 = cx - (hd * k) / 2, x1 = cx + (hd * k) / 2, neck = 0.4 * k, arm = 2.7 * k, cap = 0.8 * k;
          for (const [xa, dir] of [[x0, -1], [x1, 1]] as const) {
            const at = (off: number, len: number) => (dir < 0 ? xa - off - len : xa + off);
            hcyl(at(0, neck), y, neck, rd * 0.7);
            hcyl(at(neck, arm), y, arm, rd);
            hcyl(at(neck + arm, cap), y, cap, rd + 0.4, COLLAR);
            line(dir < 0 ? xa - neck - arm - cap : xa + neck + arm + cap, y, dir < 0 ? xa - neck - arm - cap - 0.3 * k : xa + neck + arm + cap + 0.3 * k, y, 0.9);
          }
        }
        if (n > 1) block(mid0 + midH * 0.1, 1.2, midH * 0.8);
        nut(bot); break;
      }
      case 'pump_in_sub': {
        pin(top);
        block(mid0, top + 1.2, midH);
        const sx = cx + ((top + 1.2) * k) / 2, sy = mid0 + midH * 0.5;
        cyl(sy - 1.7 * k, 0.6, 3.4 * k, COLLAR, sx + 0.3 * k);
        hcyl(sx + 0.6 * k, sy, 1.6 * k, 2.4);
        // 1502 hammer union with lugs
        hcyl(sx + 2.2 * k, sy, 1.1 * k, 3.6, COLLAR);
        for (const s of [-1, 1]) rect(sx + 2.45 * k, sy + s * 1.8 * k - (s < 0 ? 0.9 * k : 0), 0.6 * k, 0.9 * k, COLLAR[2], true);
        nut(bot); break;
      }
      case 'pce_crossover': {
        pin(top);
        cyl(mid0, top + 0.2, midH * 0.35);
        taper(mid0 + midH * 0.35, top + 0.2, bot + 0.4, midH * 0.3);
        g.push({ t: 'poly', pts: [[cx - ((top + 0.2) * k) / 2, mid0 + midH * 0.35], [cx + ((top + 0.2) * k) / 2, mid0 + midH * 0.35], [cx + ((bot + 0.4) * k) / 2, mid0 + midH * 0.65], [cx - ((bot + 0.4) * k) / 2, mid0 + midH * 0.65]], fill: STEEL[3] });
        cyl(mid0 + midH * 0.65, bot + 0.4, midH * 0.35);
        nut(bot); break;
      }
      case 'wellhead_adapter': {
        // after the Elmar adapter flange: long threaded neck, smooth neck, fillet into a thick flange with bolt holes
        const fy = mid0 + midH * 0.5, fh = H - fy, fw = 10;
        const neckH = midH * 0.32 + mid0;
        cyl(0, top - 0.3, neckH);
        for (let yy = 1.2; yy < neckH - 0.5; yy += Math.max(1.1, neckH / 9)) line(cx - ((top - 0.3) * k) / 2, yy, cx + ((top - 0.3) * k) / 2, yy, 0.3, STEEL[0]);
        cyl(neckH, top + 0.2, fy - neckH - 0.6 * k);
        taper(fy - 0.6 * k, top + 0.2, top + 2, 0.6 * k);
        cyl(fy, fw, fh, COLLAR);
        for (const s of [-1, 1]) for (const off of [2.7, 4.1]) rect(cx + s * off * k - 0.3 * k, fy + fh * 0.2, 0.6 * k, fh * 0.6, '#2b3138');
        break;
      }
      case 'tree': {
        // swab valve, flow cross with wing valves, master valve; handwheels drawn edge-on
        const valve = (y: number, h: number) => { block(y, 5, h); line(cx - 2.5 * k, y + h / 2, cx - 4.2 * k, y + h / 2, 1.2); rect(cx - 4.6 * k, y + h / 2 - 1.8 * k, 0.45 * k, 3.6 * k, COLLAR[1], true); };
        const f = Math.min(1.2 * k, H * 0.05), ch = H * 0.26, v = (H - 4 * f - ch) / 2;
        const fl = (y: number) => cyl(y, 7, f, COLLAR);
        fl(0); valve(f, v); fl(f + v);
        const cy = 2 * f + v;
        block(cy, 5.5, ch);
        for (const s of [-1, 1]) {
          const x0 = s < 0 ? cx - 2.75 * k - 4.4 * k : cx + 2.75 * k;
          hcyl(x0, cy + ch / 2, 4.4 * k, 2.6);
          const wx = s < 0 ? cx - 2.75 * k - 4.4 * k + 1.2 * k : cx + 2.75 * k + 3.2 * k;
          line(wx - 0.05 * k, cy + ch / 2 - 1.3 * k, wx - 0.05 * k, cy + ch / 2 - 2.6 * k, 1.2);
          rect(wx - 1.6 * k, cy + ch / 2 - 3 * k, 3.2 * k, 0.45 * k, COLLAR[1], true);
        }
        fl(cy + ch); valve(cy + ch + f, v); fl(H - f);
        break;
      }
      default:
        pin(top); cyl(mid0, top + 0.3, midH); nut(bot);
    }
    return g;
  }

  // tool string: one scale, the body from the OD, the fishing neck from F/N
  const od = Math.min(r.od_in ?? 1.875, 5.5), fn = Math.min(r.fn_in ?? od * 0.75, od);
  const neckH = Math.max(3, H * 0.1);
  const neck = () => { cyl(0, fn * 0.75, neckH * 0.6); cyl(neckH * 0.6, fn, neckH * 0.4, COLLAR); };
  const pin = (h = neckH * 0.7) => cyl(H - h, od * 0.55, h);
  switch (r.kind) {
    case 'rope_socket':
      line(cx, 0, cx, H * 0.12, 1, '#2b3138');
      taper(H * 0.12, od * 0.45, od, H * 0.3); g.push({ t: 'poly', pts: [[cx - (od * 0.45 * k) / 2, H * 0.12], [cx + (od * 0.45 * k) / 2, H * 0.12], [cx + (od * k) / 2, H * 0.42], [cx - (od * k) / 2, H * 0.42]], fill: STEEL[3] });
      cyl(H * 0.42, od, H * 0.58 - neckH * 0.7); pin(); break;
    case 'stem':
      neck(); cyl(neckH, od, H - neckH - neckH * 0.7); pin(); break;
    case 'roller_stem':
      neck(); cyl(neckH, od * 0.9, H - neckH - neckH * 0.7);
      for (let i = 1; i < 4; i++) { const y = neckH + ((H - 2 * neckH) * i) / 4; cyl(y - 2.5, od * 1.25, 5, COLLAR); }
      pin(); break;
    case 'knuckle': case 'swivel': {
      neck(); cyl(neckH, od, H * 0.36 - neckH);
      const rr = Math.min((od * k) / 2, H * 0.16);
      circle(cx, H * 0.5, rr, STEEL[2]);
      cyl(H * 0.62, od, H * 0.38 - neckH * 0.7); pin(); break;
    }
    case 'jar_mech': {
      neck(); cyl(neckH, od, H * 0.22);
      const lw = od * 0.28;
      cyl(neckH + H * 0.22, lw, H * 0.44, STEEL, cx - ((od - lw) * k) / 2); cyl(neckH + H * 0.22, lw, H * 0.44, STEEL, cx + ((od - lw) * k) / 2);
      cyl(neckH + H * 0.12, od * 0.36, H * 0.5, COLLAR);
      cyl(neckH + H * 0.66, od, H - neckH - H * 0.66 - neckH * 0.7); pin(); break;
    }
    case 'jar_tubular': case 'jar_hyd': case 'jar_spring': case 'accelerator':
      neck(); cyl(neckH, od * 0.6, H * 0.18);
      cyl(neckH + H * 0.18, od, H - neckH - H * 0.18 - neckH * 0.7);
      for (const f of [0.45, 0.7]) line(cx - (od * k) / 2, H * f, cx + (od * k) / 2, H * f, 0.5);
      pin(); break;
    case 'tool_crossover': {
      const a = threadOd(r.top_conn) ?? od, b = threadOd(r.bottom_conn) ?? od * 0.7;
      cyl(0, Math.min(a, od), H * 0.25); taper(H * 0.25, Math.min(a, od), Math.min(b, od), H * 0.5); cyl(H * 0.75, Math.min(b, od), H * 0.25); break;
    }
    case 'gauge_cutter': {
      neck(); cyl(neckH, fn * 0.9, H * 0.42 - neckH);
      cyl(H * 0.42, od, H * 0.42);
      const w = od * k, teeth = 6;
      for (let i = 0; i < teeth; i++) poly([[cx - w / 2 + (i * w) / teeth, H * 0.84], [cx - w / 2 + ((i + 0.5) * w) / teeth, H], [cx - w / 2 + ((i + 1) * w) / teeth, H * 0.84]], STEEL[1]);
      break;
    }
    case 'impression_block':
      neck(); cyl(neckH, fn * 0.9, H * 0.3); cyl(neckH + H * 0.3, od, H - neckH - H * 0.3 - 4); rect(cx - (od * k) / 2, H - 4, od * k, 4, '#4d555f', true); break;
    case 'blind_box':
      neck(); cyl(neckH, fn * 0.9, H * 0.3); cyl(neckH + H * 0.3, od, H - neckH - H * 0.3, COLLAR); break;
    case 'bailer':
      neck(); cyl(neckH, od, H - neckH - H * 0.12); taper(H * 0.88, od, od * 0.6, H * 0.12); break;
    case 'wire_finder':
      neck(); cyl(neckH, fn * 0.9, H * 0.4 - neckH);
      for (const s of [-1, -0.33, 0.33, 1]) line(cx + (s * od * k) / 2.4, H * 0.4, cx + (s * od * k) / 2, H, 1.1);
      cyl(H * 0.36, od * 0.9, H * 0.1, COLLAR); break;
    case 'pulling_tool': case 'plug_prong': {
      neck(); cyl(neckH, od * 0.8, H * 0.3);
      cyl(neckH + H * 0.3, od, H * 0.34);
      for (const s of [-1, 1]) rect(cx + (s * (od * k)) / 2 - (s > 0 ? 0 : 3), neckH + H * 0.36, 3, H * 0.16, COLLAR[1], true);
      if (r.kind === 'plug_prong' && /prong/i.test(r.name)) { cyl(neckH + H * 0.64, od * 0.35, H * 0.26); taper(H * 0.9, od * 0.35, 0.05, H * 0.1); }
      else cyl(neckH + H * 0.64, od * 0.7, H - neckH - H * 0.64);
      break;
    }
    default:
      neck(); cyl(neckH, od, H - neckH - neckH * 0.7); pin();
  }
  return g;
}

// ---- the assembly as one drawing ----

/**
 * How tall a part is drawn, in the same inches as its width. Long parts are shortened (a 10 ft lubricator is not
 * drawn 30 times its width) but keep their order of size; short parts keep room for their features.
 */
export function drawnLength(r: Row, family: Family): number {
  if (family === 'pce') {
    const len = r.length_ft ?? ({ lubricator: 8, wireline_valve: 3, tree: 4, stuffing_box: 2.5, grease_head: 6 } as Partial<Record<PartKind, number>>)[r.kind] ?? 1.5;
    const min = r.kind === 'wireline_valve' ? 4 + 4 * Math.max(1, Math.min(4, r.rams ?? 1)) : r.kind === 'tree' ? 26 : r.kind === 'stuffing_box' ? 15 : r.kind === 'wellhead_adapter' ? 7 : r.kind === 'pump_in_sub' ? 8 : r.kind === 'tool_trap' ? 8 : 5.5;
    return Math.max(min, 3.5 + len * 2);
  }
  const len = r.length_ft ?? (r.kind.startsWith('jar_') ? 5 : r.kind === 'stem' || r.kind === 'roller_stem' ? 3 : 1.5);
  const min = r.kind === 'jar_mech' ? 10 : r.kind === 'knuckle' || r.kind === 'swivel' ? 5 : 4;
  return Math.max(min, len * 12 * 0.36);
}

export type Mark = { index: number; y0: number; y1: number };

/**
 * The whole stack in a W × H box: one scale for width and length, shrunk until it fits, so no part is stretched
 * and nothing runs off the page. Each part is tagged with its row number on the left.
 */
export function layoutStack(rows: Row[], family: Family, W: number, H: number): { prims: Prim[]; marks: Mark[]; height: number } {
  if (!rows.length) return { prims: [], marks: [], height: 0 };
  const tag = 14;
  const lens = rows.map((r) => drawnLength(r, family));
  const total = lens.reduce((a, b) => a + b, 0);
  const s = Math.min((W - tag - 2) / SPAN[family], H / total);
  const dw = SPAN[family] * s, x0 = tag + (W - tag - dw) / 2;
  const prims: Prim[] = [], marks: Mark[] = [];
  let y = 0;
  rows.forEach((r, i) => {
    const h = lens[i] * s;
    for (const p of drawPart(r, family, dw, h)) prims.push(shift(p, x0, y));
    marks.push({ index: i, y0: y, y1: y + h });
    y += h;
  });
  // row tags: a numbered circle with a leader to the part
  marks.forEach((m) => {
    const cy = (m.y0 + m.y1) / 2, rr = Math.min(6, Math.max(4, (m.y1 - m.y0) / 2 - 0.5));
    prims.push({ t: 'line', x1: rr * 2 + 1, y1: cy, x2: x0 + dw * 0.32, y2: cy, stroke: '#9aa3ad', width: 0.4 });
    prims.push({ t: 'circle', cx: rr + 1, cy, r: rr, fill: '#ffffff', stroke: '#3b434d' });
    prims.push({ t: 'text', x: rr + 1, y: cy, s: String(m.index + 1), size: rr * 1.25 });
  });
  return { prims, marks, height: y };
}

const shift = (p: Prim, dx: number, dy: number): Prim => {
  switch (p.t) {
    case 'rect': return { ...p, x: p.x + dx, y: p.y + dy };
    case 'poly': return { ...p, pts: p.pts.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
    case 'circle': return { ...p, cx: p.cx + dx, cy: p.cy + dy };
    case 'text': return { ...p, x: p.x + dx, y: p.y + dy };
    default: return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy };
  }
};
