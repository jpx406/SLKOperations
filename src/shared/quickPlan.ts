// Opportunities (S25, called Quick Plan until 6z.55): cards for jobs that aren't tickets yet, moved across columns as
// they firm up, then turned into a planned job. A promoted card stays on the board, linked to its job, until someone
// clears it.

export const QP_COLUMNS = [
  { key: 'idea', label: 'Idea' },
  { key: 'likely', label: 'Likely' },
  { key: 'confirmed', label: 'Confirmed' },
] as const;
export type QpColumn = (typeof QP_COLUMNS)[number]['key'];
export const isColumn = (v: unknown): v is QpColumn => QP_COLUMNS.some((c) => c.key === v);

export interface QpCard {
  id: string; country: string; title: string; notes: string | null; target_date: string | null; unit_number: string | null;
  services: string[]; client: string | null; field: string | null; well: string | null; temperature_f: number | null; pressure_psi: number | null;
  column_key: QpColumn; sort: number; promoted_job_id: string | null; created_by: string | null; created_at: string;
  ticket_no?: string | null; created_by_name?: string | null; files?: number;
}

/** What a card stores (the unit is no longer asked for). */
export type QpFields = Pick<QpCard, 'title' | 'notes' | 'target_date' | 'services' | 'client' | 'field' | 'well' | 'temperature_f' | 'pressure_psi'>;

export const MAX_SERVICES = 15;

const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
function num(v: unknown, label: string, min: number, max: number): { value: number | null } | { error: string } {
  if (v === undefined || v === null || v === '') return { value: null };
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < min || n > max) return { error: `${label} must be a number from ${min} to ${max}` };
  return { value: Math.round(n * 10) / 10 };
}

export function checkCard(b: Record<string, unknown>): { error: string } | { card: QpFields } {
  const client = line(b.client, 80);
  const field = line(b.field, 80);
  const well = line(b.well, 80);
  // without a title the card is named after its client and well
  const title = line(b.title, 160) || [client, well].filter(Boolean).join(' · ');
  if (!title) return { error: 'Give the card a title, or pick the client or well' };
  const date = typeof b.target_date === 'string' ? b.target_date.trim() : '';
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'The target date must be a date' };
  const services = Array.isArray(b.services) ? [...new Set(b.services.map((s) => line(s, 80)).filter(Boolean))] : [];
  if (services.length > MAX_SERVICES) return { error: `Up to ${MAX_SERVICES} services per card` };
  const temp = num(b.temperature_f, 'Temperature', -50, 700);
  if ('error' in temp) return temp;
  const press = num(b.pressure_psi, 'Pressure', 0, 30000);
  if ('error' in press) return press;
  const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 2000) : '';
  return { card: { title, notes: notes || null, target_date: date || null, services, client: client || null, field: field || null, well: well || null, temperature_f: temp.value, pressure_psi: press.value } };
}

/** A stored card row as the page reads it: the services column holds JSON. */
export function readServices(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  try { const x = JSON.parse(String(v ?? '[]')); return Array.isArray(x) ? x.map(String) : []; } catch { return []; }
}

/** Where a moved card lands: its new column and position, with the others in that column renumbered 0..n. */
export function reorder(cards: Pick<QpCard, 'id' | 'column_key' | 'sort'>[], id: string, to: QpColumn, index: number): { id: string; column_key: QpColumn; sort: number }[] {
  const target = cards.filter((c) => c.column_key === to && c.id !== id).sort((a, b) => a.sort - b.sort).map((c) => c.id);
  target.splice(Math.max(0, Math.min(index, target.length)), 0, id);
  return target.map((cid, i) => ({ id: cid, column_key: to, sort: i }));
}
