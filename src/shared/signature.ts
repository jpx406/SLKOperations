// Digital sign-off on approval (owner decision 2026-10-25: no drawn signatures; approving signs).
// When someone approves a JRA, a bonus distribution or a person's attendance month, the app records who, when, in
// which role, a SHA-256 fingerprint of exactly what was approved, and an HMAC seal over all of it made with the
// server's SIGNING_KEY. Showing a signature recomputes both: a changed record or an edited signature row shows up.

export const SIGNED = { jra: 'JRA', bonus: 'Bonus distribution', attendance: 'Attendance month' } as const;
export type SignedEntity = keyof typeof SIGNED;
export const isSignedEntity = (v: unknown): v is SignedEntity => typeof v === 'string' && v in SIGNED;

/** JSON with keys sorted at every level, so the same content always gives the same text. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();

export async function fingerprint(content: unknown): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(canonical(content))));
}

export interface SignatureFacts { entity_type: SignedEntity; entity_id: string; username: string; full_name: string; role: string; signed_at: string; fingerprint: string }

/** HMAC-SHA256 over the signature's facts. Without the key nobody can make a seal that verifies. */
export async function seal(key: string, f: SignatureFacts): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(canonical(f))));
}

export type SignatureState = 'valid' | 'changed' | 'tampered' | 'unsealed' | 'revoked';

/** Compares a stored signature with the record as it is now. */
export async function checkSignature(stored: SignatureFacts & { seal: string | null; revoked_at: string | null }, current: unknown, key: string | undefined): Promise<SignatureState> {
  if (stored.revoked_at) return 'revoked';
  const { seal: s, revoked_at: _r, ...facts } = stored;
  if (key && s && (await seal(key, facts)) !== s) return 'tampered';
  if ((await fingerprint(current)) !== stored.fingerprint) return 'changed';
  return key && s ? 'valid' : 'unsealed';
}

export const STATE_TEXT: Record<SignatureState, string> = {
  valid: 'Signature valid: the record is exactly as approved',
  changed: 'Changed after signing: the record no longer matches what was approved',
  tampered: 'Signature does not verify: the signature record was altered',
  unsealed: 'Signed, but not sealed (the server has no signing key); the fingerprint still matches',
  revoked: 'Signature withdrawn when the approval was reopened',
};
