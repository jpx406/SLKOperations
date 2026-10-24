export class ApiError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) { super(message); }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('slk:signed-out'));
    throw new ApiError(res.status, (body.error as string) ?? `Request failed (${res.status})`, body);
  }
  return body as T;
}

// Job dates and times are entered in the site's local time. Saudi Arabia and Bahrain are UTC+3 with no DST.
const OFFSET_MIN = 180;

export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(Date.parse(iso) + OFFSET_MIN * 60_000);
  return d.toISOString().slice(0, 16);
}

export function localInputToIso(v: string): string | null {
  if (!v) return null;
  return new Date(`${v}:00+03:00`).toISOString();
}

export function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
