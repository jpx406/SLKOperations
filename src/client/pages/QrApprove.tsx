import { startAuthentication } from '@simplewebauthn/browser';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Fingerprint, Laptop, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { api } from '../api';
import { NesrLogo, Wordmark } from '../components/Brand';
import { passkeyError, passkeysSupported } from '../components/Passkeys';
import { Banner, Button } from '../components/ui';

// The phone side of QR sign-in. Opened by scanning the code on a laptop: shows which computer is asking and the
// four-digit code it shows, then signs that computer in after Face ID / fingerprint on this phone.

type Info = { status: 'pending' | 'approved' | 'denied' | 'expired'; code?: string; device?: string; where?: string | null; expiresAt?: number };

export function QrApprove() {
  const { id = '' } = useParams();
  const info = useQuery({ queryKey: ['qr-info', id], queryFn: () => api<Info>(`/auth/qr/${encodeURIComponent(id)}/info`), refetchInterval: 5000 });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const approve = async () => {
    setBusy(true); setResult(null);
    try {
      const { options, challengeId } = await api<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON']; challengeId: string }>(`/auth/qr/${encodeURIComponent(id)}/options`, { method: 'POST', json: {} });
      const response = await startAuthentication({ optionsJSON: options });
      const r = await api<{ name: string }>(`/auth/qr/${encodeURIComponent(id)}/approve`, { method: 'POST', json: { challengeId, response } });
      setResult({ ok: true, text: `Done. The computer is signing in as ${r.name}. You can close this page.` });
    } catch (e) {
      setResult({ ok: false, text: passkeyError(e) });
    } finally { setBusy(false); }
  };
  const deny = async () => {
    await api(`/auth/qr/${encodeURIComponent(id)}/deny`, { method: 'POST', json: {} }).catch(() => undefined);
    setResult({ ok: false, text: 'Refused. The computer will not be signed in.' });
  };
  const d = info.data;
  return (
    <main className="grid min-h-full place-items-center px-4 py-8">
      <div className="w-full max-w-md rounded-lg border border-card-edge bg-surface p-6 shadow-pop">
        <div className="mb-5 flex flex-col items-center text-center">
          <NesrLogo className="mb-2 h-12" />
          <Wordmark className="text-2xl" />
          <h1 className="mt-2 font-mono text-sm tracking-[0.12em] text-text-muted uppercase">Sign in on another computer</h1>
        </div>
        {info.isPending && <p className="text-center text-sm text-text-muted">Checking the code…</p>}
        {info.isError && <Banner tone="danger">{info.error.message}</Banner>}
        {result ? (
          <div className="flex flex-col items-center gap-3 text-center">
            {result.ok ? <CheckCircle2 aria-hidden className="size-12 text-success" /> : <ShieldAlert aria-hidden className="size-12 text-danger" />}
            <p role="status" className="font-semibold">{result.text}</p>
          </div>
        ) : d && d.status !== 'pending' ? (
          <p className="text-center text-sm font-semibold text-text-muted">This code {d.status === 'denied' ? 'was refused' : d.status === 'approved' ? 'was already used' : 'has expired'}. Make a new one on the computer.</p>
        ) : d ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-md border border-border bg-surface-2 p-3">
              <Laptop aria-hidden className="mt-0.5 size-5 shrink-0" />
              <p className="text-sm">
                <span className="block font-semibold">{d.device}</span>
                {d.where && <span className="block text-text-muted">near {d.where}</span>}
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm">Check the computer shows this code:</p>
              <p className="font-mono text-4xl font-bold tracking-[0.3em]">{d.code}</p>
              <p className="mt-1 text-xs text-text-subtle">If it doesn't, or you didn't start this, press "This wasn't me".</p>
            </div>
            {passkeysSupported()
              ? <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={approve}><Fingerprint aria-hidden className="size-5" />Confirm with Face ID / fingerprint</Button>
              : <Banner tone="warning">This browser can't use Face ID. Open the code with the phone's camera app in Safari or Chrome.</Banner>}
            <Button variant="ghost" className="w-full" onClick={deny}>This wasn't me</Button>
            <p className="text-center text-xs text-text-subtle">Face ID must be set up on this phone first: sign in here with your password once, then use "Face ID / fingerprint" in your account menu.</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
