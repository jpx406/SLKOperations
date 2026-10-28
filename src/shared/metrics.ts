// Job metrics, identical to the job_metrics view in 0001_init.sql so the browser can preview while typing.

export function opHours(rigUpAt: string | null, rigDownAt: string | null, override: number | null): number | null {
  if (override != null) return override;
  if (!rigUpAt || !rigDownAt) return null;
  const ms = Date.parse(rigDownAt) - Date.parse(rigUpAt);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** (1 − NPT ÷ op hours) × 100, one decimal, never below 0. */
export function jobEfficiency(op: number | null, nptHours: number): number | null {
  if (op == null || op <= 0) return null;
  return Math.max(0, Math.round((1 - nptHours / op) * 1000) / 10);
}

export function runEfficiency(ok: number | null, failed: number | null): number | null {
  const total = (ok ?? 0) + (failed ?? 0);
  if (!total) return null;
  return Math.round(((ok ?? 0) / total) * 1000) / 10;
}

/** People counted for man-hours: the named crew still on the job, else the planned head count. */
export function peopleAssigned(crew: { end_date?: string | null }[], headcount?: { supervisors: number; operators: number; assistant_operators: number; helpers: number } | null): number {
  const named = crew.filter((p) => !p.end_date).length;
  return named || (headcount ? headcount.supervisors + headcount.operators + headcount.assistant_operators + headcount.helpers : 0);
}

/** Man-hours on Closure: operating hours × people assigned, unless the SDM typed a figure. */
export function manHours(op: number | null, people: number, override: number | null): number | null {
  if (override != null) return override;
  return op != null && people > 0 ? Math.round(op * people * 100) / 100 : null;
}

/** Travel on Closure: the distance to the location there and back, unless the SDM typed a figure. */
export function travelKm(kmToLocation: number | null, override: number | null): number | null {
  if (override != null) return override;
  return kmToLocation != null ? Math.round(kmToLocation * 2 * 10) / 10 : null;
}
