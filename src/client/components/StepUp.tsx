import { useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, Field, inputClass } from './ui';

// Step-up re-authentication for bonus and revenue figures (replaces the original's shared access code).
// The person re-enters their own WIREGUARD password; the server checks it with WIREGUARD and opens these pages for 30 minutes.

export const needsStepUp = (e: unknown) => e instanceof ApiError && e.status === 403 && !!e.body.stepUp;

export function StepUpPrompt({ onDone }: { onDone?: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api('/step-up', { method: 'POST', json: { password } });
      setPassword('');
      await qc.invalidateQueries();
      onDone?.();
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Card className="mx-auto max-w-md">
      <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-bold"><Lock aria-hidden className="size-5" />Restricted figures</h2>
      <p className="mb-4 text-sm text-text-muted">Bonus and revenue figures need your WIREGUARD password again. They stay open for 30 minutes.</p>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3">
        <Field id="stepup-pw" label="WIREGUARD password"><input id="stepup-pw" type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button type="submit" variant="primary" loading={busy} disabled={!password}>Unlock</Button>
      </form>
    </Card>
  );
}

/** Shows the prompt instead of the page while locked, and an UNLOCKED badge with the time left while open. */
export function StepUpGate({ locked, children }: { locked: boolean; children: ReactNode }) {
  if (locked) return <StepUpPrompt />;
  return <>{children}</>;
}

export function UnlockedBadge() {
  const { data: me } = useMe();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const left = Math.round(((me?.stepUpUntil ?? 0) - now) / 60_000);
  if (left <= 0) return null;
  return <span className="label-caps ml-3 inline-flex items-center gap-1 rounded-pill bg-success-subtle px-2 py-0.5 align-middle text-success"><LockOpen aria-hidden className="size-3" />Unlocked · {left} min</span>;
}
