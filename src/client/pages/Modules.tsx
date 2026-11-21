import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, BookOpen, ChevronRight, ExternalLink, LayoutDashboard, Lock, LogOut, TrendingUp, Waypoints } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { visibleNav } from '../../shared/menus';
import { MODULES, isModuleKey, moduleAccess, wireguardAccess, type ModuleKey } from '../../shared/modules';
import { api } from '../api';
import { useMe } from '../auth';
import { NesrLogo, Wordmark } from '../components/Brand';
import { Button, Skeleton, cx } from '../components/ui';

// After signing in (6z.33): pick the SLK Operations Hub, the Knowledge Hub, Competency, Career Development (6z.40) or WIREGUARD (6z.38).
// 6z.39: only the modules the person may open are shown (no greyed-out tiles); with the Knowledge Hub alone it opens
// straight away. The WIREGUARD tile first checks the person's WIREGUARD account is on. The pick is kept for this
// browser tab; the NESR mark at the top of any page comes back here.

const KEY = 'slk-module';
export function pickedModule(): ModuleKey | null {
  try { const v = sessionStorage.getItem(KEY); return isModuleKey(v) ? v : null; } catch { return null; }
}
export function pickModule(m: ModuleKey) { try { sessionStorage.setItem(KEY, m); } catch { /* private mode: the page decides */ } }

const ICON: Record<ModuleKey, typeof BookOpen> = { slk: LayoutDashboard, knowledge: BookOpen, competency: Award, career: TrendingUp };
const TILE = 'group flex h-full w-full flex-col rounded-lg border p-4 text-left shadow-card';
const TILE_ON = 'border-card-edge bg-surface hover:border-accent-text focus-visible:border-accent-text';
const TILE_OFF = 'cursor-not-allowed border-dashed border-border-strong bg-surface-2';

type WgAccount = 'yes' | 'no' | 'unknown';

export function ModulePicker() {
  const { data: me, isPending } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const wgOk = !!me && wireguardAccess(me.menus);
  const config = useQuery({ queryKey: ['config'], queryFn: () => api<{ wireguardUrl: string }>('/config'), staleTime: Infinity, enabled: wgOk });
  const account = useQuery({ queryKey: ['wg-account'], queryFn: () => api<{ status: WgAccount }>('/wg/account'), enabled: wgOk, staleTime: 60_000 });
  const shown = me ? MODULES.filter((m) => moduleAccess(me.menus)[m.key]) : [];

  const open = (m: ModuleKey, replace = false) => {
    if (!me) return;
    pickModule(m);
    // the hub opens on the first page the person may see (the schedule for most)
    // 6z.44: the dashboard is now the first menu, but the hub still opens on the Schedule when the person has it
    const pages = visibleNav(me.menus).flatMap((g) => g.pages);
    const home = m === 'slk' ? (pages.find((p) => p.path === '/operation/schedule') ?? pages[0])?.path ?? '/operation/schedule' : MODULES.find((x) => x.key === m)!.home;
    navigate(home, { replace });
  };
  // nothing to choose: someone who only reads the Knowledge Hub goes straight there
  const only = !wgOk && shown.length === 1 ? shown[0].key : null;
  useEffect(() => { if (only) open(only, true); }, [only]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isPending || !me || only) return <div className="p-6" aria-busy="true"><Skeleton className="mx-auto h-96 max-w-3xl" /></div>;
  const signOut = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => undefined); qc.clear(); navigate('/signin', { replace: true }); };
  return (
    <main id="main" className="mx-auto flex min-h-full max-w-4xl flex-col px-4 py-8 md:py-14">
      <div className="mb-8 flex items-center gap-3">
        <NesrLogo className="h-10 sm:h-12" />
        <Wordmark className="text-lg sm:text-2xl" />
      </div>
      <h1 className="font-display text-xl font-bold">Welcome, {me.fullName.split(' ')[0]}</h1>
      <p className="mt-1 text-sm text-text-muted">Choose where to go. You can come back here from the NESR mark at the top of any page.</p>
      <ul className={cx('mt-6 grid grid-cols-1 gap-3', shown.length + (wgOk ? 1 : 0) > 1 && 'md:grid-cols-2')}>
        {shown.map((m) => {
          const Icon = ICON[m.key];
          return (
            <li key={m.key}>
              <button type="button" onClick={() => open(m.key)} aria-describedby={`mod-${m.key}`} className={cx(TILE, TILE_ON)}>
                <span className="flex items-center gap-2">
                  <span className="grid size-10 place-items-center rounded-md bg-accent text-on-accent"><Icon aria-hidden className="size-5" /></span>
                  <span className="flex-1 font-display text-base font-bold">{m.label}</span>
                  <ChevronRight aria-hidden className="size-5 text-text-muted group-hover:text-text" />
                </span>
                <span id={`mod-${m.key}`} className="mt-2 text-sm text-text-muted">{m.blurb}</span>
              </button>
            </li>
          );
        })}
        {wgOk && <li><WireguardTile url={config.data?.wireguardUrl} status={account.isPending ? null : account.data?.status ?? 'unknown'} /></li>}
      </ul>
      <div className="mt-8 flex items-center gap-2 text-sm text-text-muted">
        Signed in as {me.fullName}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={signOut}><LogOut aria-hidden className="size-4" />Sign out</Button>
      </div>
    </main>
  );
}

/** WIREGUARD opens only when the person's account there is on; null while it is being checked. */
function WireguardTile({ url, status }: { url: string | undefined; status: WgAccount | null }) {
  const head = (ok: boolean) => (
    <span className="flex items-center gap-2">
      <span className={cx('grid size-10 place-items-center rounded-md', ok ? 'bg-accent text-on-accent' : 'bg-surface-3 text-text-subtle')}><Waypoints aria-hidden className="size-5" /></span>
      <span className="flex-1 font-display text-base font-bold">WIREGUARD</span>
      {ok ? <ExternalLink aria-hidden className="size-5 text-text-muted group-hover:text-text" /> : <Lock aria-hidden className="size-4 text-text-subtle" />}
    </span>
  );
  if (status === 'no') {
    return (
      <div className={cx(TILE, TILE_OFF)} aria-describedby="mod-wireguard">
        {head(false)}
        <span id="mod-wireguard" className="mt-2 text-sm text-text-muted">Wire records, runs, drums and units.
          <span className="mt-2 block font-semibold text-text">Your WIREGUARD account is switched off or missing. Ask an administrator.</span></span>
      </div>
    );
  }
  const ready = status !== null && !!url;
  return (
    <a href={ready ? url : undefined} target="_blank" rel="noreferrer" aria-disabled={!ready} aria-describedby="mod-wireguard"
      className={cx(TILE, TILE_ON, !ready && 'pointer-events-none opacity-70')}>
      {head(true)}
      <span id="mod-wireguard" className="mt-2 text-sm text-text-muted">
        Wire records, runs, drums and units. Opens WIREGUARD in a new tab, where you sign in with the same account.
        {status === null && <span className="mt-2 block">Checking your WIREGUARD account…</span>}
        {status === 'unknown' && <span className="mt-2 block">WIREGUARD could not be checked just now; it may still open.</span>}
      </span>
    </a>
  );
}
