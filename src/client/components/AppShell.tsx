import { Select } from './Select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, BookOpen, Boxes, Cable, CalendarCheck, ChartColumn, ChevronDown, ChevronRight, ClipboardList, Clock, Database, Fingerprint, Gauge, KeyRound, LogOut, Menu, PanelLeftClose, PanelLeftOpen, RefreshCw, ShieldCheck, Sun, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { visibleNav, type Group } from '../../shared/menus';
import { roleLabel } from '../../shared/roles';
import type { WgStatus } from '../../shared/types';
import { api, countryScope, setCountryScope } from '../api';
import { useMe } from '../auth';
import { useDisplay, type DensityChoice } from '../display';
import { AssistantLauncher, HelpButton } from './Help';
import { Button, cx, rovingKeys } from './ui';
import { Contacts, NesrLogo, Wordmark } from './Brand';
import { NewVersionBar, useNewVersion } from './NewVersionBar';
import { FaceIdDialog, FaceIdOffer } from './Passkeys';
import { useRoles } from '../rules';
import { APP_VERSION, VERSION_TEXT } from '../version';

/** Narrows every screen to one country for people who cover several. The server checks it against their countries. */
function CountrySwitch({ countries }: { countries: string[] }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(() => countryScope() ?? '');
  useEffect(() => { if (value && !countries.includes(value)) { setCountryScope(''); setValue(''); } }, [countries, value]);
  if (countries.length < 2) return null;
  return (
    <label className="flex items-center gap-1.5 text-xs text-text-muted">
      <span className="sr-only">Country shown</span>
      <Select className="h-(--layout-control-sm) rounded-sm border border-border-input bg-input px-2 text-sm text-text" value={value}
        onChange={(e) => { setCountryScope(e.target.value); setValue(e.target.value); qc.invalidateQueries(); }}>
        <option value="">All my countries</option>
        {countries.map((c) => <option key={c}>{c}</option>)}
      </Select>
    </label>
  );
}

function RiyadhClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  const time = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' });
  return (
    <span aria-hidden className="hidden items-center gap-1.5 font-mono text-xs text-text-muted lg:inline-flex">
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
  const label = !last ? 'not synced yet' : new Date(last).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' });
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <span className={cx('label-caps whitespace-nowrap', tone)} title={failed ? 'The last sync reported an error' : 'Last sync from WIREGUARD'}>
        <span className="hidden md:inline">WIREGUARD</span><span className="md:hidden" aria-hidden>WG</span><span className="sr-only md:hidden">WIREGUARD</span> · {label}
      </span>
      {canSync && (
        <Button size="sm" variant="ghost" onClick={() => sync.mutate()} loading={sync.isPending} aria-label="Sync from WIREGUARD now">
          {!sync.isPending && <RefreshCw aria-hidden className="size-3.5" />}
        </Button>
      )}
    </span>
  );
}

/**
 * Navigation on phones and tablets (owner request 2026-10-29, after an Apple HIG review): the group pills don't fit,
 * so a menu button names where you are ("Operation › Jobs") and opens every group and page as a two-level list,
 * like a sidebar. Desktop keeps the group row.
 */
function NavDrawer({ nav, current, onClose, status }: { nav: Group[]; current: string; onClose: () => void; status: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('[aria-current="page"], a')?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = overflow; prev?.focus(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-(--z-drawer) print:hidden">
      <button type="button" aria-label="Close the menu" tabIndex={-1} className="absolute inset-0 bg-bg/70" onClick={onClose} />
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Menu"
        className="absolute inset-y-0 left-0 flex w-[min(22rem,88vw)] flex-col border-r border-border bg-surface shadow-pop">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <NesrLogo className="h-7" />
          <Wordmark className="flex-1 text-base" />
          <Button size="sm" variant="ghost" aria-label="Close the menu" onClick={onClose}><X aria-hidden className="size-5" /></Button>
        </div>
        <div className="border-b border-border px-4 py-2">{status}</div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-2">
          {nav.map((g) => (
            <section key={g.label} className="mb-2">
              <h2 className="label-caps px-3 pt-2 pb-1 text-text-muted">{g.label}</h2>
              <ul>
                {g.pages.map((pg) => (
                  <li key={pg.path}>
                    <NavLink to={pg.path} onClick={onClose} end={g.pages.some((o) => o !== pg && o.path.startsWith(`${pg.path}/`))}
                      className={({ isActive }) => cx('flex min-h-11 items-center gap-2 rounded-md px-3 text-base font-semibold',
                        isActive ? 'bg-accent text-on-accent' : 'text-text hover:bg-surface-2')}>
                      <span className="flex-1">{pg.label}</span>
                      <ChevronRight aria-hidden className="size-4 opacity-50" />
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <p className="border-t border-border px-4 py-2 font-mono text-xs text-text-subtle">{current}</p>
      </div>
    </div>
  );
}

const GROUP_ICONS: Record<string, LucideIcon> = {
  Operation: ClipboardList, 'Service Quality': Gauge, Bonus: Award, 'SLK Activity Dashboard': ChartColumn, Attendance: CalendarCheck,
  Inventory: Boxes, Wires: Cable, 'Knowledge Hub': BookOpen, Administration: ShieldCheck,
};
const readStore = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeStore = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode: this visit only */ } };

/**
 * Desktop navigation (owner request 2026-10-29, Apple HIG review for desktop): a sidebar with the groups as
 * disclosures and their pages under them (sidebars.md: at most two levels, let people hide it). It shows from
 * 1280px up; narrower windows, or a hidden sidebar, fall back to the menu button and the section pills.
 */
function Sidebar({ nav, current, onHide }: { nav: Group[]; current?: Group; onHide: () => void }) {
  const [open, setOpen] = useState<string[]>(() => { try { return JSON.parse(readStore('slk-sidebar-open') ?? '[]'); } catch { return []; } });
  const toggle = (label: string, isOpen: boolean) => {
    const next = isOpen ? open.filter((l) => l !== label) : [...open, label];
    setOpen(next);
    writeStore('slk-sidebar-open', JSON.stringify(next));
  };
  const row = 'touch-row flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm';
  const rowState = (active: boolean) => (active ? 'bg-surface-3 font-semibold text-text shadow-[inset_3px_0_var(--color-accent-edge)]' : 'text-text-muted hover:bg-surface-2 hover:text-text');
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface xl:flex print:hidden">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <a href="/" aria-label="SLK Operations, home"><NesrLogo className="h-8" /></a>
        <span aria-hidden className="flex-1"><Wordmark className="text-sm leading-tight whitespace-nowrap" /></span>
        <Button size="sm" variant="ghost" className="-mr-2" aria-label="Hide sidebar" title="Hide sidebar" onClick={onHide}><PanelLeftClose aria-hidden className="size-4" /></Button>
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 pb-3">
        <ul className="space-y-0.5">
          {nav.map((g) => {
            const Icon = GROUP_ICONS[g.label] ?? ClipboardList;
            const here = g === current;
            if (g.pages.length === 1) {
              const p = g.pages[0];
              return (
                <li key={g.label}>
                  <NavLink to={p.path} className={({ isActive }) => cx(row, 'font-medium', rowState(isActive))}>
                    <Icon aria-hidden className="size-4 shrink-0" /><span className="truncate">{g.label}</span>
                  </NavLink>
                </li>
              );
            }
            const isOpen = here || open.includes(g.label);
            return (
              <li key={g.label}>
                {/* the section you are in stays open, so its name is a label, not a toggle */}
                {here ? (
                  <p className={cx(row, 'font-semibold text-text')}><Icon aria-hidden className="size-4 shrink-0 text-accent-text" /><span className="truncate">{g.label}</span></p>
                ) : (
                  <button type="button" aria-expanded={isOpen} onClick={() => toggle(g.label, isOpen)} className={cx(row, 'font-medium text-text-muted hover:bg-surface-2 hover:text-text')}>
                    <Icon aria-hidden className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{g.label}</span>
                    <ChevronRight aria-hidden className={cx('size-3.5 shrink-0 opacity-60 transition-transform', isOpen && 'rotate-90')} />
                  </button>
                )}
                {isOpen && (
                  <ul className="mt-0.5 mb-1.5 space-y-0.5">
                    {g.pages.map((p) => (
                      <li key={p.path}>
                        <NavLink to={p.path} end={g.pages.some((o) => o !== p && o.path.startsWith(`${p.path}/`))}
                          className={({ isActive }) => cx(row, 'pl-9', rowState(isActive))}>
                          <span className="truncate">{p.label}</span>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-border px-4 py-3">
        <Contacts className="text-label leading-snug text-text-subtle" />
        <p className="mt-1 font-mono text-label text-text-subtle" title={VERSION_TEXT}>v{APP_VERSION}</p>
      </div>
    </aside>
  );
}

export function AppShell() {
  const { data: me } = useMe();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api<{ wireguardUrl: string }>('/config'), staleTime: Infinity });
  const display = useDisplay();
  const nav = visibleNav(me?.menus ?? {});
  const loc = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const group = nav.find((g) => g.pages.some((p) => loc.pathname.startsWith(p.path))) ?? nav[0];
  const page = group?.pages.filter((p) => loc.pathname.startsWith(p.path)).sort((a, b) => b.path.length - a.path.length)[0];
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [loc.pathname]);
  // the desktop sidebar is shown unless someone hid it; `wide` is what applies from 1280px up when it is shown
  const [sidebar, setSidebar] = useState(() => readStore('slk-sidebar') !== 'hidden');
  const showSidebar = (on: boolean) => { setSidebar(on); writeStore('slk-sidebar', on ? null : 'hidden'); };
  const wide = (cls: string) => (sidebar ? cls : '');

  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    navigate('/signin', { replace: true });
  };

  const newVersion = useNewVersion();
  useRoles(); // names of added or renamed roles, for roleLabel() everywhere
  return (
    <div className="flex min-h-full">
      {sidebar && <Sidebar nav={nav} current={group} onHide={() => showSidebar(false)} />}
    <div className="flex min-w-0 flex-1 flex-col">
      <NewVersionBar show={newVersion} />
      <header className="border-b border-border bg-bg px-4 md:px-5 print:hidden">
        {/* one row from tablet width up; on phones the tools wrap under the name instead of being cut off */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
          <div className={cx('flex shrink-0 items-center gap-2.5', wide('xl:hidden'))}>
            <Button size="sm" variant="ghost" className="-ml-2 xl:hidden" aria-label="Menu" aria-expanded={drawer} onClick={() => setDrawer(true)}><Menu aria-hidden className="size-5" /></Button>
            {!sidebar && <Button size="sm" variant="ghost" className="-ml-2 hidden xl:inline-flex" aria-label="Show sidebar" title="Show sidebar" onClick={() => showSidebar(true)}><PanelLeftOpen aria-hidden className="size-5" /></Button>}
            <a href="/" aria-label="SLK Operations, home"><NesrLogo className="h-7 sm:h-9" /></a>
            <div className="hidden flex-col min-[30rem]:flex">
              <span aria-hidden><Wordmark className="text-base leading-tight sm:text-lg" /></span>
              <Contacts className="hidden text-label leading-tight lg:block" />
            </div>
          </div>
          <span className={cx('hidden font-mono text-xs text-text-subtle md:inline', wide('xl:hidden'))} title={VERSION_TEXT}>v{APP_VERSION}</span>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {me && <span className="hidden sm:inline-flex"><CountrySwitch countries={me.allCountries ?? me.countries} /></span>}
            <span className="hidden sm:inline-flex"><SyncStatus canSync={!!me?.menus.schedule?.edit} /></span>
            <RiyadhClock />
            <HelpButton />
            <AssistantLauncher />
            {me && <AccountMenu name={me.fullName} role={roleLabel(me.role)} admin={me.role === 'admin'} countries={me.allCountries ?? me.countries} passwordUrl={config.data?.wireguardUrl} display={display} onSignOut={signOut} />}
          </div>
        </div>
        {/* phones and tablets: where you are, and the menu with every group and page */}
        <div className={cx('-mt-1 flex items-center gap-2 pb-2.5', wide('xl:hidden'))}>
          <button type="button" onClick={() => setDrawer(true)} aria-label={`Menu: ${group?.label ?? ''}${page ? `, ${page.label}` : ''}`}
            className="inline-flex h-(--layout-control-sm) min-w-0 items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-sm font-semibold">
            <span className="truncate">{group?.label}</span>
            {page && group && group.pages.length > 1 && <><ChevronRight aria-hidden className="size-3.5 shrink-0 text-text-muted" /><span className="truncate text-text-muted">{page.label}</span></>}
            <ChevronDown aria-hidden className="size-4 shrink-0" />
          </button>
          <span className="ml-auto sm:hidden"><SyncStatus canSync={!!me?.menus.schedule?.edit} /></span>
        </div>
      </header>
      {group && group.pages.length > 1 && (
        <nav aria-label="Section" className={cx('sticky top-0 z-(--z-sticky) flex gap-2 overflow-x-auto border-b border-border bg-bg px-4 py-2.5 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] md:px-5 lg:[mask-image:none] print:hidden', wide('xl:hidden'))}>
          {group.pages.map((p) => (
            <NavLink key={p.path} to={p.path} end={group.pages.some((o) => o !== p && o.path.startsWith(`${p.path}/`))}
              className={({ isActive }) => cx('inline-flex h-(--layout-control-sm) shrink-0 items-center rounded-pill border px-3.5 text-sm font-semibold',
                isActive ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>
              {p.label}
            </NavLink>
          ))}
        </nav>
      )}
      <main id="main" className="flex-1 px-4 py-5 md:px-5">
        {/* printed pages carry the mark and the product name */}
        <div aria-hidden className="mb-4 hidden items-center gap-3 border-b border-border pb-3 print:flex">
          <NesrLogo className="h-10" print />
          <Wordmark className="text-lg" />
        </div>
        {drawer && <NavDrawer nav={nav} current={`Signed in as ${me?.fullName ?? ''}`} onClose={() => setDrawer(false)}
          status={<span className="flex items-center justify-between gap-2"><SyncStatus canSync={!!me?.menus.schedule?.edit} />{me && <CountrySwitch countries={me.allCountries ?? me.countries} />}</span>} />}
        {me && <FaceIdOffer username={me.username} />}
        <Outlet />
      </main>
    </div>
    </div>
  );
}

/** Account and display settings: who is signed in, password, Sunlight mode, touch controls, Data (admins), sign out. */
function AccountMenu({ name, role, admin, countries, passwordUrl, display, onSignOut }: {
  name: string; role: string; admin: boolean; countries: string[]; passwordUrl?: string; display: ReturnType<typeof useDisplay>; onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const [faceId, setFaceId] = useState(false);
  const item = 'flex w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm font-semibold hover:bg-surface-2 h-(--layout-control-sm)';
  const DENSITY: [DensityChoice, string][] = [['auto', 'Auto'], ['touch', 'On'], ['desk', 'Off']];
  return (
    <div ref={box} className="relative">
      <Button size="sm" variant="ghost" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)} aria-label={`Account and display: ${name}`}>
        <span className="hidden max-w-40 truncate xl:inline">{name}</span>
        <span className="label-caps rounded-sm bg-success-subtle px-1.5 py-0.5 text-success">{role}</span>
        <ChevronDown aria-hidden className="size-4" />
      </Button>
      {open && (
        <div className="absolute right-0 z-(--z-drawer) mt-1.5 w-72 rounded-lg border border-border bg-surface p-2 shadow-pop">
          <p className="px-2.5 pb-2 pt-1 text-sm"><span className="block font-semibold">{name}</span><span className="text-xs text-text-muted">{role}</span></p>
          {/* on phones the country switch lives here instead of in the header */}
          {countries.length > 1 && <div className="border-t border-border px-2.5 py-2 sm:hidden"><CountrySwitch countries={countries} /></div>}
          <div className="border-t border-border py-1.5">
            <button type="button" role="switch" aria-checked={display.theme === 'light'} className={item} onClick={display.toggleTheme}>
              <Sun aria-hidden className="size-4" /><span className="flex-1">Sunlight mode</span>
              <span className={cx('label-caps rounded-sm px-1.5 py-0.5', display.theme === 'light' ? 'bg-accent text-on-accent' : 'bg-surface-3 text-text-muted')}>{display.theme === 'light' ? 'On' : 'Off'}</span>
            </button>
            <div className="px-2.5 py-1.5">
              <p id="touch-label" className="mb-1.5 text-sm font-semibold">Large touch controls</p>
              <div role="radiogroup" aria-labelledby="touch-label" onKeyDown={rovingKeys} className="flex overflow-hidden rounded-md border border-border-strong">
                {DENSITY.map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={display.density === v} tabIndex={display.density === v ? 0 : -1} onClick={() => display.setDensity(v)}
                    className={cx('h-(--layout-control-sm) flex-1 text-xs font-semibold', display.density === v ? 'bg-accent text-on-accent' : 'text-text-muted hover:bg-surface-2')}>{l}</button>
                ))}
              </div>
              <p className="mt-1 text-xs text-text-subtle">Auto: on for touch screens, off with a mouse.</p>
            </div>
          </div>
          <div className="border-t border-border pt-1.5">
            <button type="button" className={item} onClick={() => { setOpen(false); setFaceId(true); }}><Fingerprint aria-hidden className="size-4" />Set up Face ID / fingerprint &amp; QR sign-in</button>
            {passwordUrl && <a className={item} href={passwordUrl} target="_blank" rel="noreferrer"><KeyRound aria-hidden className="size-4" />Change password in WIREGUARD</a>}
            {admin && <NavLink to="/admin/data" className={item} onClick={() => setOpen(false)}><Database aria-hidden className="size-4" />Data export &amp; import</NavLink>}
            <button type="button" className={item} onClick={onSignOut}><LogOut aria-hidden className="size-4" />Sign out</button>
          </div>
        </div>
      )}
      {faceId && <FaceIdDialog onClose={() => setFaceId(false)} />}
    </div>
  );
}
