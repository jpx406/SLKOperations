// Minimal stand-in for SLK Operations Hub's API helper. Point API_BASE at where you mount createDiagramsRouter
// (the page calls `${API_BASE}/diagrams/...`), or replace these with your app's own fetch helper.
export const API_BASE = '/api';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) { super(message); }
}

/** SLK sends the picked country in a header; return null if your app has no such scope. */
export function countryScope(): string | null {
  return null;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, (body.error as string) ?? `Request failed (${res.status})`, body);
  return body as T;
}

export function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
