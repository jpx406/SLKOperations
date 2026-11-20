import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, BookOpen, ChevronRight, ExternalLink, LayoutDashboard, Lock, LogOut, Waypoints } from 'lucide-react';
import { useNavigate } from 'react-router';
import { visibleNav } from '../../shared/menus';
import { MODULES, isModuleKey, moduleAccess, wireguardAccess, type ModuleKey } from '../../shared/modules';
import { api } from '../api';
import { useMe } from '../auth';
import { NesrLogo, Wordmark } from '../components/Brand';
import { Button, Skeleton, cx } from '../components/ui';

// After signing in (6z.33): pick the SLK Operations Hub, the Knowledge Hub or Competency. A module the person's role
// doesn't open is greyed out. 6z.38: WIREGUARD has a tile too (it opens the WIREGUARD app), and everyone opens the Knowledge Hub. The pick is kept for this browser tab; the NESR mark at the top of any page comes back here.

const KEY = 'slk-module';
export function pickedModule(): ModuleKey | null {
  try { const v = sessionStorage.getItem(KEY); return isModuleKey(v) ? v : null; } catch { return null; }
}
export function pickModule(m: ModuleKey) { try { sessionStorage.setItem(KEY, m); } catch { /* private mode: the page decides */ } }

const ICON: Record<ModuleKey, typeof BookOpen> = { slk: LayoutDashboard, knowledge: BookOpen, competency: Award };

export function ModulePicker() {
  const { data: me, isPending } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api<{ wireguardUrl: string }>('/config'), staleTime: Infinity, enabled: !!me });
  if (isPending || !me) return <div className="p-6" aria-busy="true"><Skeleton className="mx-auto h-96 max-w-3xl" /></div>;
  const access = moduleAccess(me.menus);
  const wgOk = wireguardAccess(me.menus);
  const tile = (ok: boolean) => cx('group flex h-full w-full flex-col rounded-lg border p-4 text-left shadow-card',
    ok ? 'border-card-edge bg-surface hover:border-accent-text focus-visible:border-accent-text' : 'cursor-not-allowed border-dashed border-border-strong bg-surface-2 opacity-60');
  const noAccess = <span className="mt-2 block font-semibold text-text">No access: ask an admin to allow it in Users &amp; Roles.</span>;
  const open = (m: ModuleKey) => {
    pickModule(m);
    // the hub opens on the first page the person may see (the schedule for most)
    const home = m === 'slk' ? visibleNav(me.menus)[0]?.pages[0]?.path ?? '/operation/schedule' : MODULES.find((x) => x.key === m)!.home;
    navigate(home);
  };
  const signOut = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => undefined); qc.clear(); navigate('/signin', { replace: true }); };
  return (
    <main id="main" className="mx-auto flex min-h-full max-w-4xl flex-col px-4 py-8 md:py-14">
      <div className="mb-8 flex items-center gap-3">
        <NesrLogo className="h-10 sm:h-12" />
        <Wordmark className="text-lg sm:text-2xl" />
      </div>
      <h1 className="font-display text-xl font-bold">Welcome, {me.fullName.split(' ')[0]}</h1>
      <p className="mt-1 text-sm text-text-muted">Choose where to go. You can come back here from the NESR mark at the top of any page.</p>
      <ul className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        {MODULES.map((m) => {
          const ok = access[m.key];
          const Icon = ICON[m.key];
          return (
            <li key={m.key}>
              <button type="button" disabled={!ok} onClick={() => open(m.key)} aria-describedby={`mod-${m.key}`}
                className={tile(ok)}>
                <span className="flex items-center gap-2">
                  <span className={cx('grid size-10 place-items-center rounded-md', ok ? 'bg-accent text-on-accent' : 'bg-surface-3 text-text-subtle')}><Icon aria-hidden className="size-5" /></span>
                  <span className="flex-1 font-display text-base font-bold">{m.label}</span>
                  {ok ? <ChevronRight aria-hidden className="size-5 text-text-muted group-hover:text-text" /> : <Lock aria-hidden className="size-4 text-text-subtle" />}
                </span>
                <span id={`mod-${m.key}`} className="mt-2 text-sm text-text-muted">
                  {m.blurb}
                  {!ok && noAccess}
                </span>
              </button>
            </li>
          );
        })}
        <li>
          {wgOk && config.data
            ? <a href={config.data.wireguardUrl} target="_blank" rel="noreferrer" className={tile(true)} aria-describedby="mod-wireguard">
                <WgHead ok />
                <span id="mod-wireguard" className="mt-2 text-sm text-text-muted">Wire records, runs, drums and units. Opens WIREGUARD in a new tab, where you sign in with the same account.</span>
              </a>
            : <button type="button" disabled className={tile(false)} aria-describedby="mod-wireguard">
                <WgHead ok={false} />
                <span id="mod-wireguard" className="mt-2 text-sm text-text-muted">Wire records, runs, drums and units, in the WIREGUARD app.{!wgOk && noAccess}</span>
              </button>}
        </li>
      </ul>
      <div className="mt-8 flex items-center gap-2 text-sm text-text-muted">
        Signed in as {me.fullName}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={signOut}><LogOut aria-hidden className="size-4" />Sign out</Button>
      </div>
    </main>
  );
}

function WgHead({ ok }: { ok: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cx('grid size-10 place-items-center rounded-md', ok ? 'bg-accent text-on-accent' : 'bg-surface-3 text-text-subtle')}><Waypoints aria-hidden className="size-5" /></span>
      <span className="flex-1 font-display text-base font-bold">WIREGUARD</span>
      {ok ? <ExternalLink aria-hidden className="size-5 text-text-muted group-hover:text-text" /> : <Lock aria-hidden className="size-4 text-text-subtle" />}
    </span>
  );
}
