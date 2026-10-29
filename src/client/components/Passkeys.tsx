import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, QrCode, RefreshCw, Smartphone, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { renderSVG } from 'uqr';
import { ApiError, api } from '../api';
import { Banner, Button, cx } from './ui';

// Face ID / fingerprint on the client: sign in, the laptop's QR panel, and the person's own devices.
// The server side and the reasoning are in src/worker/passkeys.ts.

export const passkeysSupported = () => typeof window !== 'undefined' && browserSupportsWebAuthn();

/** What went wrong, in words, from a WebAuthn browser error or an API error. */
export function passkeyError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return 'Face ID was cancelled, or this device has no Face ID sign-in for SLK Operations Hub yet. Sign in with your password, then set it up from your account menu.';
  if (name === 'InvalidStateError') return 'This device is already set up for Face ID sign-in.';
  if (name === 'SecurityError') return 'Face ID only works on the SLK Operations Hub address (https).';
  return (e as Error)?.message ?? 'Face ID did not work';
}

/** Signs in with any passkey this device has (or a synced one); resolves with the username. */
export async function signInWithPasskey(): Promise<string> {
  const { options, challengeId } = await api<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON']; challengeId: string }>('/auth/passkey/options', { method: 'POST', json: {} });
  const response = await startAuthentication({ optionsJSON: options });
  const r = await api<{ username: string }>('/auth/passkey/verify', { method: 'POST', json: { challengeId, response } });
  return r.username;
}

type QrStart = { id: string; poll: string; code: string; url: string; expiresIn: number };

/**
 * The laptop side of QR sign-in: shows the QR code and the four-digit code, and waits for the phone.
 * `onSignedIn` runs once the phone has confirmed with Face ID and the session cookie is set.
 */
export function QrSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [qr, setQr] = useState<QrStart | null>(null);
  const [state, setState] = useState<'loading' | 'waiting' | 'expired' | 'denied' | 'error'>('loading');
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(0);
  const start = async () => {
    setState('loading'); setError(null);
    try {
      const r = await api<QrStart>('/auth/qr/start', { method: 'POST', json: {} });
      started.current = Date.now();
      setQr(r); setLeft(r.expiresIn); setState('waiting');
    } catch (e) { setError((e as Error).message); setState('error'); }
  };
  useEffect(() => { void start(); }, []);
  useEffect(() => {
    if (state !== 'waiting' || !qr) return;
    let stop = false;
    const tick = async () => {
      const remaining = qr.expiresIn - Math.floor((Date.now() - started.current) / 1000);
      setLeft(Math.max(0, remaining));
      if (remaining <= 0) { setState('expired'); return; }
      try {
        const r = await api<{ status: string }>(`/auth/qr/${qr.id}/status`, { headers: { 'x-qr-poll': qr.poll } });
        if (stop) return;
        if (r.status === 'approved') onSignedIn();
        else if (r.status === 'denied') setState('denied');
        else if (r.status === 'expired') setState('expired');
      } catch { /* a missed poll is retried on the next tick */ }
    };
    const t = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [state, qr, onSignedIn]);
  const svg = qr ? renderSVG(qr.url, { border: 2, ecc: 'M', whiteColor: '#ffffff', blackColor: '#0b121a' }) : '';
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="text-sm text-text-muted">Scan with the phone where you use Face ID for SLK Operations Hub, then confirm on the phone.</p>
      {state === 'loading' && <div className="size-52 animate-pulse rounded-md bg-surface-2" />}
      {qr && state === 'waiting' && (
        <>
          {/* our own SVG from uqr, not user content */}
          <div className="size-52 overflow-hidden rounded-md border border-border bg-white p-1 [&>svg]:size-full" role="img" aria-label="QR code to sign in with your phone" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="text-sm">The phone will show this code. Check it matches:</p>
          <p className="font-mono text-3xl font-bold tracking-[0.3em]" aria-label={`Code ${qr.code.split('').join(' ')}`}>{qr.code}</p>
          <p className="font-mono text-xs text-text-subtle" aria-live="off">Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</p>
        </>
      )}
      {(state === 'expired' || state === 'denied' || state === 'error') && (
        <div className="flex flex-col items-center gap-2">
          <p className={cx('text-sm font-semibold', state === 'denied' ? 'text-danger' : 'text-text-muted')}>
            {state === 'expired' ? 'The code expired.' : state === 'denied' ? 'The sign-in was refused on the phone.' : `Could not make a code: ${error}`}
          </p>
          <Button onClick={start}><RefreshCw aria-hidden className="size-4" />New code</Button>
        </div>
      )}
    </div>
  );
}

type Device = { id: string; device_name: string | null; backed_up: number; created_at: string; last_used_at: string | null };

/** The person's own Face ID devices: set up this one, see the others, remove any. */
export function MyPasskeys() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['passkeys'], queryFn: () => api<{ allowed: boolean; devices: Device[] }>('/passkeys') });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const add = async () => {
    setBusy(true); setMsg(null);
    try {
      const options = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/passkeys/register-options', { method: 'POST', json: {} });
      const response = await startRegistration({ optionsJSON: options });
      const r = await api<{ device: string }>('/passkeys/register', { method: 'POST', json: { response } });
      setMsg({ tone: 'success', text: `Face ID / fingerprint sign-in is set up on ${r.device}. Next time, use "Sign in with Face ID / fingerprint".` });
      await qc.invalidateQueries({ queryKey: ['passkeys'] });
    } catch (e) {
      setMsg({ tone: 'danger', text: passkeyError(e) });
    } finally { setBusy(false); }
  };
  const remove = async (d: Device) => {
    try { await api(`/passkeys/${encodeURIComponent(d.id)}`, { method: 'DELETE' }); await qc.invalidateQueries({ queryKey: ['passkeys'] }); }
    catch (e) { setMsg({ tone: 'danger', text: (e as Error).message }); }
  };
  if (q.isPending) return <p className="text-sm text-text-muted">Loading…</p>;
  if (q.isError) return <Banner tone="danger">{q.error.message}</Banner>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">
        Sign in with Face ID, Touch ID, a fingerprint or Windows Hello instead of your password. Set it up once on each phone or computer you use.
        On a computer without it, use "Sign in with your phone (QR code)" on the sign-in page.
      </p>
      {!q.data.allowed && <Banner tone="warning">Face ID sign-in is switched off for your account. An administrator can turn it on in Users & Roles.</Banner>}
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      {q.data.devices.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {q.data.devices.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Smartphone aria-hidden className="size-4 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{d.device_name ?? 'Device'}{d.backed_up ? <span className="ml-2 text-xs font-normal text-text-subtle">synced</span> : null}</span>
                <span className="block text-xs text-text-subtle">Set up {d.created_at.slice(0, 10)} · {d.last_used_at ? `last used ${d.last_used_at.slice(0, 10)}` : 'not used yet'}</span>
              </span>
              <Button size="sm" variant="ghost" aria-label={`Remove ${d.device_name ?? 'device'}`} onClick={() => remove(d)}><Trash2 aria-hidden className="size-4" /></Button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-text-subtle">No device set up yet.</p>}
      {passkeysSupported()
        ? <Button variant="primary" loading={busy} disabled={!q.data.allowed} onClick={add}><Fingerprint aria-hidden className="size-4" />Set up on this device</Button>
        : <p className="text-sm text-text-subtle">This browser can't do Face ID / fingerprint sign-in.</p>}
    </div>
  );
}

/** The Face ID / fingerprint dialog: the person's devices, set up this one, and how QR sign-in works. */
export function FaceIdDialog({ onClose }: { onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="faceid-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-pop">
        <div className="mb-3 flex items-start gap-3">
          <h2 id="faceid-title" className="flex-1 font-display text-lg font-bold">Face ID / fingerprint and QR sign-in</h2>
          <Button size="sm" variant="ghost" aria-label="Close" onClick={onClose} autoFocus><X aria-hidden className="size-4" /></Button>
        </div>
        <MyPasskeys />
        <div className="mt-4 rounded-md border border-border bg-surface-2 p-3 text-sm">
          <p className="mb-1 flex items-center gap-2 font-semibold"><QrCode aria-hidden className="size-4" />Signing in on a laptop with your phone</p>
          <ol className="list-decimal space-y-0.5 pl-5 text-text-muted">
            <li>Set up Face ID on your phone first (open SLK Operations Hub on the phone, sign in, then use this menu).</li>
            <li>On the laptop’s sign-in page, choose “Sign in with your phone (QR code)”.</li>
            <li>Scan the code with the phone’s camera and approve with Face ID. The laptop signs in by itself.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

const OFFER_KEY = (username: string) => `slk-faceid-offer-${username}`;

/** After a password sign-in on a device that can do it, offers once to set up Face ID / fingerprint (Not now waits 14 days). */
export function FaceIdOffer({ username }: { username: string }) {
  const q = useQuery({ queryKey: ['passkeys'], queryFn: () => api<{ allowed: boolean; devices: Device[] }>('/passkeys'), staleTime: 5 * 60_000 });
  const [hidden, setHidden] = useState(() => {
    try { const v = localStorage.getItem(OFFER_KEY(username)); return v === 'never' || (!!v && Date.now() < Number(v)); } catch { return false; }
  });
  const [open, setOpen] = useState(false);
  const later = (never: boolean) => {
    try { localStorage.setItem(OFFER_KEY(username), never ? 'never' : String(Date.now() + 14 * 86_400_000)); } catch { /* private mode */ }
    setHidden(true);
  };
  // set up from the dialog: the offer has done its job
  useEffect(() => { if (q.data && q.data.devices.length > 0 && open) later(true); }, [q.data, open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!passkeysSupported() || hidden || !q.data?.allowed || q.data.devices.length > 0) return open ? <FaceIdDialog onClose={() => setOpen(false)} /> : null;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-accent/40 bg-surface px-4 py-3 print:hidden">
        <Fingerprint aria-hidden className="size-6 shrink-0 text-accent-text" />
        <p className="min-w-0 flex-1 text-sm"><span className="font-semibold">Sign in faster next time.</span> Use Face ID, Touch ID, a fingerprint or Windows Hello on this device instead of your password. You can also sign a laptop in by scanning a QR code with your phone.</p>
        <span className="flex gap-2">
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}><Fingerprint aria-hidden className="size-4" />Set up now</Button>
          <Button size="sm" variant="ghost" onClick={() => later(false)}>Not now</Button>
          <Button size="sm" variant="ghost" onClick={() => later(true)}>Don’t ask again</Button>
        </span>
      </div>
      {open && <FaceIdDialog onClose={() => setOpen(false)} />}
    </>
  );
}
