// Equipment Database (S24): what SLK Ops keeps itself. Units, wires and job types stay in WIREGUARD.
// Pure checks shared by the API and the screen.

export const LIST_KINDS = {
  conveyance: 'Conveyance', well_type: 'Well type', casing_type: 'Casing / tubing', casing_od: 'Casing OD', casing_grade: 'Casing grade',
  fluid_type: 'Fluid type', plug_type: 'Plug type', lock_type: 'Lock type', nipple_profile: 'Nipple profile', jar_type: 'Jar type',
  rope_socket_type: 'Rope socket', pressure_rating: 'Pressure rating', lubricator_size: 'Lubricator size', stuffing_box_type: 'Stuffing box',
  grease_panel_type: 'Grease panel type', failure_category: 'Failure category', sdm_other: 'Other SDM names',
} as const;
export type ListKind = keyof typeof LIST_KINDS;

export const PCE_KINDS = {
  pce_set: 'PCE set', lubricator: 'Lubricator', wireline_valve_bop: 'Wireline valve / BOP', stuffing_box: 'Stuffing box',
  grease_injection_head: 'Grease injection head', tool_trap: 'Tool trap', tool_catcher: 'Tool catcher', pump_in_sub: 'Pump-in sub',
} as const;
export const PCE_RATINGS = [5000, 10000, 15000] as const;

export interface PceInput {
  country?: unknown; label?: unknown; kind?: unknown; bore_in?: unknown; rating_psi?: unknown; length_ft?: unknown;
  last_pressure_test_on?: unknown; is_rental?: unknown; active?: unknown;
}

const blank = (v: unknown) => v === undefined || v === null || v === '';
const text = (v: unknown, max = 60) => String(v ?? '').trim().slice(0, max);

/** Cleans a PCE create (all required fields) or edit (only what is sent). Returns the values or an error. */
export function cleanPce(b: PceInput, creating: boolean): { values: Record<string, unknown> } | { error: string } {
  const v: Record<string, unknown> = {};
  if (creating || 'label' in b) {
    v.label = text(b.label);
    if (!v.label) return { error: 'Give the equipment a label' };
  }
  if (creating || 'kind' in b) {
    v.kind = blank(b.kind) ? 'pce_set' : String(b.kind);
    if (!(String(v.kind) in PCE_KINDS)) return { error: 'Unknown equipment type' };
  }
  if (creating || 'bore_in' in b) {
    const n = Number(b.bore_in);
    if (blank(b.bore_in) || !Number.isFinite(n) || n <= 0 || n > 12) return { error: 'Bore must be between 0 and 12 in' };
    v.bore_in = n;
  }
  if ('rating_psi' in b) {
    if (blank(b.rating_psi)) v.rating_psi = null;
    else if (!PCE_RATINGS.includes(Number(b.rating_psi) as (typeof PCE_RATINGS)[number])) return { error: 'Rating must be 5,000, 10,000 or 15,000 psi' };
    else v.rating_psi = Number(b.rating_psi);
  }
  if ('length_ft' in b) {
    const n = Number(b.length_ft);
    if (blank(b.length_ft)) v.length_ft = null;
    else if (!Number.isFinite(n) || n <= 0 || n > 200) return { error: 'Length must be between 0 and 200 ft' };
    else v.length_ft = n;
  }
  if ('last_pressure_test_on' in b) {
    if (blank(b.last_pressure_test_on)) v.last_pressure_test_on = null;
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.last_pressure_test_on))) return { error: 'Pressure test date must be YYYY-MM-DD' };
    else v.last_pressure_test_on = String(b.last_pressure_test_on);
  }
  for (const k of ['is_rental', 'active'] as const) if (k in b) v[k] = b[k] === true || b[k] === 1 || b[k] === '1' ? 1 : 0;
  return { values: v };
}

/** Days since the last pressure test, and whether it is overdue (default every 180 days). */
export function pressureTestDue(lastOn: string | null, today: string, everyDays = 180): { days: number | null; overdue: boolean } {
  if (!lastOn) return { days: null, overdue: true };
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastOn}T00:00:00Z`)) / 86_400_000);
  return { days, overdue: days > everyDays };
}

export function cleanListValue(kind: unknown, value: unknown): { kind: ListKind; value: string } | { error: string } {
  if (!(String(kind) in LIST_KINDS)) return { error: 'Unknown list' };
  const v = text(value, 80);
  if (!v) return { error: 'Type a value' };
  return { kind: kind as ListKind, value: v };
}

export const SERVICE_FLAGS = ['is_plug', 'is_fishing', 'is_memory', 'is_perforation', 'is_explosive'] as const;
export const FLAG_LABEL: Record<(typeof SERVICE_FLAGS)[number], string> = {
  is_plug: 'Plug / lock', is_fishing: 'Fishing', is_memory: 'Memory survey', is_perforation: 'Perforation', is_explosive: 'Explosives',
};
