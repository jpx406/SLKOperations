import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiError, api } from '../api';
import { Banner, Button, Field, inputClass } from '../components/ui';

export function SignIn() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/auth/login', { method: 'POST', json: { username, password } });
      // drop the cached "signed out" answer so the app re-checks instead of bouncing back here
      qc.removeQueries({ queryKey: ['session'] });
      const next = params.get('next');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/operation/schedule', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-pop">
        <p className="font-display text-xl font-extrabold uppercase">SLK <span className="text-text-muted">Operations</span></p>
        <p className="mt-1 mb-5 text-sm text-text-muted">
          Use your WIREGUARD username and password. Accounts and passwords are managed in WIREGUARD.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {error && <Banner tone="danger">{error}</Banner>}
          <Field id="username" label="Username" hint="NESR- followed by your employee number">
            <input id="username" className={inputClass} autoComplete="username" autoFocus required
              value={username} onChange={(e) => setUsername(e.target.value)} placeholder="NESR-12345" />
          </Field>
          <Field id="password" label="Password">
            <input id="password" className={`${inputClass} pr-10`} type={show ? 'text' : 'password'} autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-1 text-text-subtle hover:text-text">
              {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
            </button>
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!username || !password}>Sign in</Button>
        </form>
      </div>
    </main>
  );
}
