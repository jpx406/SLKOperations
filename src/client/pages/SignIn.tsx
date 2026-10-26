import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Fingerprint, QrCode, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiError, api } from '../api';
import { NesrLogo, Wordmark } from '../components/Brand';
import { QrSignIn, passkeyError, passkeysSupported, signInWithPasskey } from '../components/Passkeys';
import { Banner, Button, inputClass } from '../components/ui';
import { VERSION_TEXT } from '../version';

// Sign in, laid out like NESR's other field apps: the mark and the name, username and password,
// Face ID / fingerprint, and "Sign in with your phone" (QR code) for a laptop without either.

/** "6316" and "nesr-6316" both mean NESR-6316. */
const normalise = (v: string) => {
  const t = v.trim();
  if (/^\d+$/.test(t)) return `NESR-${t}`;
  return t.replace(/^nesr-/i, 'NESR-');
};

export function SignIn() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [wg, setWg] = useState<string | null>(null);
  useEffect(() => { api<{ wireguardUrl: string }>('/public-config').then((r) => setWg(r.wireguardUrl)).catch(() => undefined); }, []);
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'password' | 'passkey' | null>(null);
  const [qr, setQr] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();

  const done = useCallback(() => {
    // drop the cached "signed out" answer so the app re-checks instead of bouncing back here
    qc.removeQueries({ queryKey: ['session'] });
    const next = params.get('next');
    navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/operation/schedule', { replace: true });
  }, [qc, params, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError(!username.trim() ? 'Enter your employee ID or username.' : 'Enter your password.');
      document.getElementById(!username.trim() ? 'username' : 'password')?.focus();
      return;
    }
    setError(null);
    setBusy('password');
    try {
      await api('/auth/login', { method: 'POST', json: { username: normalise(username), password } });
      done();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server');
    } finally {
      setBusy(null);
    }
  };

  const faceId = async () => {
    setError(null);
    setBusy('passkey');
    try { await signInWithPasskey(); done(); }
    catch (e) { setError(passkeyError(e)); }
    finally { setBusy(null); }
  };

  return (
    <main className="grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-card-edge bg-surface p-7 shadow-pop">
        <div className="mb-6 flex flex-col items-center text-center">
          <NesrLogo className="mb-3 h-16" />
          <h1><Wordmark className="text-3xl" /></h1>
          <p className="mt-2 font-mono text-sm tracking-[0.12em] text-text-muted uppercase">Slickline operations — sign in</p>
        </div>

        {qr ? (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="flex-1 font-display text-lg font-bold">Sign in with your phone</h2>
              <Button size="sm" variant="ghost" aria-label="Back to password sign-in" onClick={() => setQr(false)}><X aria-hidden className="size-4" /></Button>
            </div>
            <QrSignIn onSignedIn={done} />
          </div>
        ) : (
          <>
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              {error && <Banner tone="danger">{error}</Banner>}
              <div>
                <label htmlFor="username" className="mb-1.5 block text-sm font-semibold">Employee ID or username</label>
                <input id="username" className={inputClass} autoComplete="username webauthn" autoFocus required
                  value={username} onChange={(e) => setUsername(e.target.value)} placeholder="NESR-12345" />
              </div>
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-semibold">Password</label>
                <div className="flex items-center gap-2">
                  <input id="password" className={inputClass} type={show ? 'text' : 'password'} autoComplete="current-password" required
                    value={password} onChange={(e) => setPassword(e.target.value)} />
                  <Button variant="ghost" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                    {show ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
                  </Button>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" variant="primary" size="lg" className="min-w-32" loading={busy === 'password'}>Sign in</Button>
              </div>
            </form>

            <div className="mt-5 flex flex-col gap-2">
              {passkeysSupported() && (
                <Button size="lg" className="w-full" loading={busy === 'passkey'} onClick={faceId}>
                  <Fingerprint aria-hidden className="size-5" />Sign in with Face ID / fingerprint
                </Button>
              )}
              <Button size="lg" variant="ghost" className="w-full border border-border" onClick={() => { setError(null); setQr(true); }}>
                <QrCode aria-hidden className="size-5" />Sign in with your phone (QR code)
              </Button>
            </div>
          </>
        )}

        <p className="mt-5 text-center text-sm">
          <a className="text-accent-text underline hover:text-text" href={wg ?? undefined} target="_blank" rel="noreferrer">Forgot password?</a>
        </p>
        <p className="mt-5 text-center text-xs text-text-subtle">
          Accounts and passwords are managed in WIREGUARD.<br />{VERSION_TEXT}
        </p>
      </div>
    </main>
  );
}
