// Quick Plan (S25): cards for jobs that aren't tickets yet, moved across columns as they firm up, then turned into a
// planned job. A promoted card stays on the board, linked to its job, until someone clears it.

export const QP_COLUMNS = [
  { key: 'idea', label: 'Idea' },
  { key: 'likely', label: 'Likely' },
  { key: 'confirmed', label: 'Confirmed' },
] as const;
export type QpColumn = (typeof QP_COLUMNS)[number]['key'];
export const isColumn = (v: unknown): v is QpColumn => QP_COLUMNS.some((c) => c.key === v);

export interface QpCard { id: string; country: string; title: string; notes: string | null; target_date: string | null; unit_number: string | null; column_key: QpColumn; sort: number; promoted_job_id: string | null; created_by: string | null; created_at: string; ticket_no?: string | null }

export function checkCard(b: { title?: unknown; notes?: unknown; target_date?: unknown; unit_number?: unknown }): { error: string } | { card: Pick<QpCard, 'title' | 'notes' | 'target_date' | 'unit_number'> } {
  const title = typeof b.title === 'string' ? b.title.trim().slice(0, 160) : '';
  if (!title) return { error: 'Give the card a title (client, well or job)' };
  const date = typeof b.target_date === 'string' ? b.target_date.trim() : '';
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'The target date must be a date' };
  const unit = typeof b.unit_number === 'string' ? b.unit_number.trim().slice(0, 40) : '';
  const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 2000) : '';
  return { card: { title, notes: notes || null, target_date: date || null, unit_number: unit || null } };
}

/** Where a moved card lands: its new column and position, with the others in that column renumbered 0..n. */
export function reorder(cards: Pick<QpCard, 'id' | 'column_key' | 'sort'>[], id: string, to: QpColumn, index: number): { id: string; column_key: QpColumn; sort: number }[] {
  const target = cards.filter((c) => c.column_key === to && c.id !== id).sort((a, b) => a.sort - b.sort).map((c) => c.id);
  target.splice(Math.max(0, Math.min(index, target.length)), 0, id);
  return target.map((cid, i) => ({ id: cid, column_key: to, sort: i }));
}
