// Dates and times in Riyadh time (UTC+3, no daylight saving), the app's working clock. Used by the pages, the
// server and the PDFs, so "today", "this month" and every printed time agree wherever they are worked out.

const RIYADH = 'Asia/Riyadh';
const OFFSET_MS = 3 * 3600_000;

/** Today in Riyadh as YYYY-MM-DD. */
export const riyadhDay = (at: Date | number = Date.now()) => new Date(+at + OFFSET_MS).toISOString().slice(0, 10);

/** This month in Riyadh as YYYY-MM. */
export const riyadhMonth = (at: Date | number = Date.now()) => riyadhDay(at).slice(0, 7);

/** A moment as "27 Nov 2026, 14:05" in Riyadh time ("—" when empty). */
export const riyadhStamp = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { timeZone: RIYADH, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** The same with " Riyadh" after it, for printed documents. */
export const stampText = (iso: string) => `${riyadhStamp(iso)} Riyadh`;

/** A moment's date as "27 Nov 2026" in Riyadh time. */
export const riyadhDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: RIYADH, day: '2-digit', month: 'short', year: 'numeric' }) : '—';

