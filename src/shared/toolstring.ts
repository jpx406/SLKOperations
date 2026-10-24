// Slickline toolstring and wire checks used by the Preparation stage (browser preview) and the API (saved values).

export const TOOLSTRING_COMPONENTS = [
  'Rope socket', 'Stem', 'Knuckle joint', 'Spang jar', 'Hydraulic jar', 'Tubular jar', 'Accelerator',
  'Running tool', 'Pulling tool', 'Gauge cutter', 'Bailer', 'Lead impression block', 'Memory gauge carrier', 'Other',
] as const;

export interface ToolPart { component: string; od_in?: number | null; length_ft?: number | null; weight_lb?: number | null }

export interface ToolTotals { length_ft: number | null; max_od_in: number | null; weight_lb: number | null; stem_weight_lb: number | null }

const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Cleans a toolstring coming from a form: known shape, numbers or null, at most 20 parts. Returns an error or the parts. */
export function parseToolstring(input: unknown): { parts: ToolPart[] } | { error: string } {
  if (!Array.isArray(input)) return { error: 'The toolstring must be a list' };
  if (input.length > 20) return { error: 'A toolstring has at most 20 parts' };
  const parts: ToolPart[] = [];
  for (const [i, raw] of input.entries()) {
    const p = raw as Record<string, unknown>;
    const component = String(p?.component ?? '').trim().slice(0, 60);
    if (!component) return { error: `Part ${i + 1} needs a component` };
    const od = num(p.od_in), len = num(p.length_ft), wt = num(p.weight_lb);
    if ([od, len, wt].some((v) => v !== null && v < 0)) return { error: `Part ${i + 1}: sizes can't be negative` };
    if (od !== null && od > 12) return { error: `Part ${i + 1}: OD over 12 in is not a slickline tool` };
    parts.push({ component, od_in: od, length_ft: len, weight_lb: wt });
  }
  return { parts };
}

export function toolTotals(parts: ToolPart[]): ToolTotals {
  if (!parts.length) return { length_ft: null, max_od_in: null, weight_lb: null, stem_weight_lb: null };
  const has = (k: keyof ToolPart) => parts.some((p) => num(p[k]) !== null);
  const sum = (k: keyof ToolPart) => round(parts.reduce((a, p) => a + (num(p[k]) ?? 0), 0));
  const stems = parts.filter((p) => /stem/i.test(p.component));
  return {
    length_ft: has('length_ft') ? sum('length_ft') : null,
    max_od_in: has('od_in') ? Math.max(...parts.map((p) => num(p.od_in) ?? 0)) : null,
    weight_lb: has('weight_lb') ? sum('weight_lb') : null,
    stem_weight_lb: stems.some((p) => num(p.weight_lb) !== null) ? round(stems.reduce((a, p) => a + (num(p.weight_lb) ?? 0), 0)) : null,
  };
}

export interface ToolCheck { level: 'danger' | 'warning'; text: string }

/**
 * Warnings shown under the toolstring. Not blocking: the crew decides, the screen makes the risk visible.
 * - largest OD must pass the well's minimum restriction and the pressure-control bore
 * - the toolstring must fit inside the lubricator
 */
export function toolChecks(t: ToolTotals, ctx: { minRestrictionIn?: number | null; pceBoreIn?: number | null; lubricatorFt?: number | null }): ToolCheck[] {
  const out: ToolCheck[] = [];
  if (t.max_od_in !== null && ctx.minRestrictionIn != null && t.max_od_in >= ctx.minRestrictionIn) {
    out.push({ level: 'danger', text: `Largest OD ${t.max_od_in} in does not pass the minimum restriction of ${ctx.minRestrictionIn} in` });
  }
  if (t.max_od_in !== null && ctx.pceBoreIn != null && t.max_od_in >= ctx.pceBoreIn) {
    out.push({ level: 'danger', text: `Largest OD ${t.max_od_in} in does not pass the pressure-control bore of ${ctx.pceBoreIn} in` });
  }
  if (t.length_ft !== null && ctx.lubricatorFt != null && t.length_ft > ctx.lubricatorFt) {
    out.push({ level: 'warning', text: `Toolstring ${t.length_ft} ft is longer than the ${ctx.lubricatorFt} ft lubricator` });
  }
  return out;
}

// ---- pre-job wire test (WIREGUARD's rule: wrap or torsion test before the job, tension test within N days) ----

export interface WireTest { test_type: string | null; result: string | null; test_date: string | null; approval_status?: string | null }

export interface WireTestStatus { ok: boolean; wrapOrTorsion: WireTest | null; tension: WireTest | null; reasons: string[] }

const passed = (t: WireTest) => !t.result || /pass|ok|accept/i.test(t.result);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Latest approved passing wrap or torsion test on or before the job start, and a tension test within `tensionDays`. */
export function preJobWireStatus(tests: WireTest[], jobStart: string, tensionDays = 30): WireTestStatus {
  const usable = tests.filter((t) => t.test_date && t.test_date <= jobStart && (t.approval_status ?? 'approved').toLowerCase() === 'approved' && passed(t))
    .sort((a, b) => (b.test_date! > a.test_date! ? 1 : -1));
  const wrapOrTorsion = usable.find((t) => /wrap|tors/i.test(t.test_type ?? '')) ?? null;
  const tension = usable.find((t) => /tension|break/i.test(t.test_type ?? '')) ?? null;
  const reasons: string[] = [];
  if (!wrapOrTorsion) reasons.push('No passing wrap or torsion test before the job');
  if (!tension) reasons.push('No passing tension test on record');
  else if (daysBetween(tension.test_date!, jobStart) > tensionDays) reasons.push(`Tension test is ${daysBetween(tension.test_date!, jobStart)} days old (limit ${tensionDays})`);
  return { ok: reasons.length === 0, wrapOrTorsion, tension, reasons };
}
