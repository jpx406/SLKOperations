import { useQuery } from '@tanstack/react-query';
import { FileWarning, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import type { SignatureState, SignedEntity } from '../../shared/signature';
import { api } from '../api';
import { cx } from './ui';

// The digital signature an approval left on a record, re-checked by the server each time it is shown.

interface Sig { id: string; full_name: string; username: string; role: string; signed_at: string; fingerprint: string; revoked_at: string | null; revoked_by: string | null; revoke_reason: string | null; state: SignatureState; text: string }

const TONE: Record<SignatureState, string> = { valid: 'text-success', unsealed: 'text-success', changed: 'text-danger', tampered: 'text-danger', revoked: 'text-text-subtle' };
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function SignatureBadge({ type, id, className }: { type: SignedEntity; id: string; className?: string }) {
  const q = useQuery({ queryKey: ['signatures', type, id], queryFn: () => api<{ signatures: Sig[] }>(`/signatures/${type}/${encodeURIComponent(id)}`) });
  const list = q.data?.signatures ?? [];
  const current = list.find((s) => !s.revoked_at);
  if (!q.data) return null;
  if (!current) return list.length ? <p className={cx('text-xs text-text-subtle', className)}>Earlier signature withdrawn{list[0].revoke_reason ? `: ${list[0].revoke_reason}` : ''}.</p> : null;
  const Icon = current.state === 'valid' || current.state === 'unsealed' ? ShieldCheck : current.state === 'revoked' ? ShieldOff : FileWarning;
  return (
    <div className={cx('text-xs', className)}>
      <p className={cx('flex items-center gap-1.5 font-semibold', TONE[current.state])}>
        <Icon aria-hidden className="size-4" />Digitally signed by {current.full_name} ({current.role}) · {when(current.signed_at)}
      </p>
      <p className="mt-0.5 text-text-muted">{current.text} · fingerprint <span className="font-mono" title={current.fingerprint}>{current.fingerprint.slice(0, 12)}</span></p>
      {list.length > 1 && (
        <details className="mt-1 text-text-subtle"><summary className="cursor-pointer">Earlier signatures ({list.length - 1})</summary>
          <ul className="mt-1 space-y-0.5">{list.filter((s) => s !== current).map((s) => <li key={s.id}>{s.full_name} · {when(s.signed_at)} · withdrawn {s.revoked_at ? when(s.revoked_at) : ''}{s.revoke_reason ? ` (${s.revoke_reason})` : ''}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

/** A small "signed" link that loads and shows the signature only when opened (for tables with many rows). */
export function SignedToggle({ type, id }: { type: SignedEntity; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button type="button" aria-expanded={open} className="text-xs text-text-muted underline" onClick={() => setOpen(!open)}>signed</button>
      {open && <div className="absolute right-0 z-30 mt-1 w-80 rounded-md border border-border bg-surface p-2 shadow-lg"><SignatureBadge type={type} id={id} /></div>}
    </span>
  );
}
