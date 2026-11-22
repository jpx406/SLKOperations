// Utilities (6z.47): the Rig Up Diagram, the Tool String Diagram and the Winch Report used on their own, not tied to
// a job. Each piece of work is a project with typed job details. Shared by the pages and the Worker.

import type { Row } from './diagram';

export type UtilKind = 'rigup' | 'toolstring' | 'winch';
export const UTIL_KINDS: UtilKind[] = ['rigup', 'toolstring', 'winch'];
export const UTIL_LABEL: Record<UtilKind, string> = { rigup: 'Rig Up Diagram', toolstring: 'Tool String Diagram', winch: 'Winch Report' };
export const UTIL_PATH: Record<UtilKind, string> = { rigup: '/utilities/rig-up', toolstring: '/utilities/tool-string', winch: '/utilities/winch' };
export const isUtilKind = (v: unknown): v is UtilKind => typeof v === 'string' && (UTIL_KINDS as string[]).includes(v);

/** The job details typed in a diagram project: what a job would give the sheet and its checks. */
export interface UtilFacts {
  client: string; ticket_no: string; drss_no: string; well: string; field: string; rig: string; unit_number: string; date: string;
  siwhp_psi: number | null; h2s_ppm: number | null; min_restriction_in: number | null; wire_in: number | null; md_ft: number | null;
}
export const EMPTY_FACTS: UtilFacts = {
  client: '', ticket_no: '', drss_no: '', well: '', field: '', rig: '', unit_number: '', date: '',
  siwhp_psi: null, h2s_ppm: null, min_restriction_in: null, wire_in: null, md_ft: null,
};
export const FACT_TEXT: { key: keyof UtilFacts; label: string }[] = [
  { key: 'client', label: 'Client' }, { key: 'ticket_no', label: 'Ticket' }, { key: 'drss_no', label: 'DRSS' }, { key: 'well', label: 'Well' },
  { key: 'field', label: 'Field' }, { key: 'rig', label: 'Rig' }, { key: 'unit_number', label: 'Unit' }, { key: 'date', label: 'Date' },
];
export const FACT_NUM: { key: keyof UtilFacts; label: string; unit: string }[] = [
  { key: 'siwhp_psi', label: 'SIWHP', unit: 'psi' }, { key: 'h2s_ppm', label: 'H2S', unit: 'ppm' }, { key: 'min_restriction_in', label: 'Min. restriction', unit: 'in' },
  { key: 'wire_in', label: 'Wire size', unit: 'in' }, { key: 'md_ft', label: 'Target depth', unit: 'ft' },
];

/** A diagram project's data: the details, the parts, the run number and the revision of the last PDF. */
export interface DiagramData { facts: UtilFacts; rows: Row[]; run: number; rev: number }

/** The details read back from saved data: anything missing or of the wrong type is blank. */
export function cleanFacts(o: unknown): UtilFacts {
  const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const out = { ...EMPTY_FACTS } as Record<string, unknown>;
  for (const f of FACT_TEXT) out[f.key] = typeof x[f.key] === 'string' ? (x[f.key] as string).slice(0, 120) : '';
  for (const f of FACT_NUM) { const v = x[f.key]; out[f.key] = typeof v === 'number' && Number.isFinite(v) ? v : null; }
  return out as unknown as UtilFacts;
}

/** A name for a copy: "Name (copy)", "Name (copy 2)"… */
export function copyName(name: string, taken: string[]): string {
  const base = name.replace(/ \(copy( \d+)?\)$/, '');
  let n = 1, out = `${base} (copy)`;
  while (taken.includes(out)) out = `${base} (copy ${++n})`;
  return out.slice(0, 120);
}
