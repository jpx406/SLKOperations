import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, LogOut, Moon, RefreshCw, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { visibleNav } from '../../shared/menus';
import { ROLE_LABEL } from '../../shared/roles';
import type { WgStatus } from '../../shared/types';
import { api } from '../api';
import { useMe } from '../auth';
import { Button, cx } from './ui';

function useTheme() {
  const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'));
  useEffect(() => {
    if (theme === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('slk-theme', theme); } catch { /* private mode */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))] as const;
}

function RiyadhClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  const time = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' });
  return (
    <span aria-hidden className="hidden items-center gap-1.5 font-mono text-xs text-text-muted md:inline-flex">
      <Clock className="size-3.5" /> {time} Riyadh
    </span>
  );
}

function SyncStatus({ canSync }: { canSync: boolean }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['wg-status'], queryFn: () => api<WgStatus>('/wg/status'), refetchInterval: 60_000 });
  const sync = useMutation({
    mutationFn: () => api('/wg/sync', { method: 'POST' }),
    onSettled: () => qc.invalidateQueries(),
  });
  const rows = status.data?.resources ?? [];
  const last = rows.map((r) => r.finished_at).filter(Boolean).sort().at(-1);
  const failed = rows.some((r) => r.error && !r.error.includes('skipped'));
  const ageMin = last ? (Date.now() - Date.parse(last)) / 60_000 : Infinity;
  const tone = failed ? 'text-danger' : ageMin > 30 ? 'text-warning' : 'text-success';
  const label = !last ? 'WIREGUARD · not synced yet'
    : `WIREGUARD · ${new Date(last).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' })}`;
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <span className={cx('label-caps', tone)} title={failed ? 'The last sync reported an error' : 'Last sync from WIREGUARD'}>{label}</span>
      {canSync && (
        <Button size="sm" variant="ghost" onClick={() => sync.mutate()} loading={sync.isPending} aria-label="Sync from WIREGUARD now">
          {!sync.isPending && <RefreshCw aria-hidden className="size-3.5" />}
        </Button>
      )}
    </span>
  );
}

export function AppShell() {
  const { data: me } = useMe();
  const [theme, toggleTheme] = useTheme();
  const nav = visibleNav(me?.menus ?? {});
  const loc = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const group = nav.find((g) => g.pages.some((p) => loc.pathname.startsWith(p.path))) ?? nav[0];

  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    navigate('/signin', { replace: true });
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border bg-bg px-4 md:px-5 print:hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
          <a href="/" className="font-display text-lg font-extrabold uppercase tracking-wide">
            SLK <span className="text-text-muted">Operations</span>
          </a>
          <span className="font-mono text-xs text-text-subtle">v0.1</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SyncStatus canSync={!!me?.menus.schedule?.edit} />
            <RiyadhClock />
            <span className="hidden text-sm sm:inline">{me?.fullName}</span>
            {me && <span className="label-caps rounded-sm bg-success-subtle px-2 py-0.5 text-success">{ROLE_LABEL[me.role]}</span>}
            <Button size="sm" variant="ghost" onClick={toggleTheme} aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}>
              {theme === 'light' ? <Moon aria-hidden className="size-4" /> : <Sun aria-hidden className="size-4" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={signOut}><LogOut aria-hidden className="size-4" />Sign out</Button>
          </div>
        </div>
        <nav aria-label="Main" className="-mb-px flex gap-1.5 overflow-x-auto pb-3">
          {nav.map((g) => (
            <NavLink key={g.label} to={g.pages[0].path}
              aria-current={g === group ? 'page' : undefined}
              className={cx('inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-sm font-semibold',
                g === group ? 'border-border-strong bg-surface-3' : 'border-border hover:bg-surface-2')}>
              {g.label}
            </NavLink>
          ))}
        </nav>
      </header>
      {group && group.pages.length > 1 && (
        <nav aria-label="Section" className="flex gap-2 overflow-x-auto border-b border-border px-4 py-2.5 md:px-5 print:hidden">
          {group.pages.map((p) => (
            <NavLink key={p.path} to={p.path}
              className={({ isActive }) => cx('inline-flex h-8 shrink-0 items-center rounded-pill border px-3.5 text-sm font-semibold',
                isActive ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>
              {p.label}
            </NavLink>
          ))}
        </nav>
      )}
      <main id="main" className="flex-1 px-4 py-5 md:px-5">
        <Outlet />
      </main>
    </div>
  );
}
