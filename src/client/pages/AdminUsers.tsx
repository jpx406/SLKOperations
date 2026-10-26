import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, Search, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { MENU_LABELS, menuClusters } from '../../shared/menus';
import { ROLE_LABEL } from '../../shared/roles';
import type { Role, WgStatus } from '../../shared/types';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass } from '../components/ui';

type Change = { menu_key: string; effect: 'grant' | 'deny'; can_edit: number };
interface UserRow {
  username: string; full_name: string; role: Role; wg_role: string | null; countries: string[];
  active: number; last_login_at: string | null; updated_by: string | null; updated_at: string;
  grants: Change[]; is_contact: boolean; effective: { menu_key: string; edit: boolean }[];
}
interface Matrix { roles: Role[]; menus: string[]; rows: { role: Role; menu_key: string; can_view: number; can_edit: number; can_delete: number }[] }
interface AuditRow { occurred_at: string; username: string; action: string; entity_type: string; entity_id: string; summary: string }

const ROLES = Object.keys(ROLE_LABEL) as Role[];
const menuLabel = (k: string) => MENU_LABELS[k] ?? k;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');

function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api<{ wireguardUrl: string }>('/config'), staleTime: Infinity });
}

export function AdminUsers() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'people';
  const tabs = [['people', 'People'], ['matrix', 'Role permissions'], ['sync', 'WIREGUARD sync'], ['history', 'Recent changes']] as const;
  return (
    <section aria-labelledby="admin-title">
      <PageTitle><span id="admin-title">Users &amp; roles</span></PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">
        Accounts and passwords live in WIREGUARD. Here you decide what each person can do in SLK Operations and which countries they see.
        Someone signing in for the first time gets a role based on their WIREGUARD role and the countries WIREGUARD shows them. You can change both.
      </p>
      <div role="tablist" aria-label="Users and roles" className="mb-4 flex flex-wrap gap-2">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k }, { replace: true })}
            className={cx('h-(--layout-control-sm) rounded-pill border px-3.5 text-sm font-semibold', tab === k ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'people' && <People />}
        {tab === 'matrix' && <RoleMatrix />}
        {tab === 'sync' && <SyncPanel />}
        {tab === 'history' && <History />}
      </div>
    </section>
  );
}

function People() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api<UserRow[]>('/admin/users') });
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const update = useMutation({
    mutationFn: ({ username, patch }: { username: string; patch: { role?: Role; active?: boolean } }) =>
      api(`/admin/users/${encodeURIComponent(username)}`, { method: 'PATCH', json: patch }),
    onSuccess: (_d, v) => { setNotice({ tone: 'success', text: `Saved ${v.username}` }); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e: ApiError) => { setNotice({ tone: 'danger', text: e.message }); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
  });

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (users.data ?? []).filter((u) =>
      (!s || `${u.username} ${u.full_name} ${ROLE_LABEL[u.role]}`.toLowerCase().includes(s))
      && (!roleFilter || u.role === roleFilter)
      && (!statusFilter || (statusFilter === 'on' ? !!u.active : !u.active)));
  }, [users.data, q, roleFilter, statusFilter]);
  const editingRow = users.data?.find((u) => u.username === editing) ?? null;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative block w-72 max-w-full">
          <span className="sr-only">Search people</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-subtle" />
          <input className={`${inputClass} pl-8`} placeholder="Name, NESR number or role" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label><span className="sr-only">Filter by role</span>
          <select className={`${inputClass} w-44`} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        <label><span className="sr-only">Filter by access</span>
          <select className={`${inputClass} w-36`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Access on and off</option><option value="on">Access on</option><option value="off">Access off</option>
          </select>
        </label>
        <Button variant="primary" onClick={() => setAdding(true)}><Plus aria-hidden className="size-4" />Add person</Button>
        {users.data && <span className="ml-auto font-mono text-xs text-text-muted">{shown.length} of {users.data.length}</span>}
      </div>
      {notice && <div className="mb-3"><Banner tone={notice.tone} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)} aria-label="Dismiss"><X aria-hidden className="size-4" /></Button>}>{notice.text}</Banner></div>}
      {adding && <AddPerson onDone={(msg) => { setAdding(false); if (msg) setNotice({ tone: 'success', text: msg }); }} />}
      {users.isPending && <Skeleton className="h-64" />}
      {users.isError && <Banner tone="danger">{users.error.message}</Banner>}
      {users.data && shown.length === 0 && <EmptyState title={q || roleFilter || statusFilter ? 'Nobody matches' : 'Nobody has signed in yet'}>{q || roleFilter || statusFilter ? 'Try another name, role or access filter.' : 'People appear here after their first sign-in, or when you add them.'}</EmptyState>}
      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[60rem] text-sm">
            <caption className="sr-only">People with access to SLK Operations</caption>
            <thead className="bg-surface-2">
              <tr className="label-caps text-left text-text-muted">
                {['Person', 'SLK Ops role', 'Countries', 'Tabs', 'Last sign-in', 'Access', ''].map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const self = u.username.toLowerCase() === me?.username.toLowerCase();
                const grants = u.grants.filter((g) => g.effect === 'grant').length;
                const denies = u.grants.filter((g) => g.effect === 'deny').length;
                return (
                  <tr key={u.username} className={cx('border-t border-border', !u.active && 'text-text-subtle')}>
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <div className="font-semibold">{u.full_name}{self && <span className="ml-2 text-xs text-text-subtle">(you)</span>}</div>
                      <div className="font-mono text-xs text-text-subtle">{u.username}{u.wg_role ? ` · WIREGUARD ${u.wg_role}` : ' · not signed in yet'}</div>
                    </th>
                    <td className="px-3 py-2">
                      <label className="sr-only" htmlFor={`role-${u.username}`}>Role for {u.full_name}</label>
                      <select id={`role-${u.username}`} className={`${inputClass} h-(--layout-control-sm) w-44`} value={u.role} disabled={self || update.isPending}
                        title={self ? 'You cannot change your own role' : undefined}
                        onChange={(e) => update.mutate({ username: u.username, patch: { role: e.target.value as Role } })}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-text-muted">{u.role === 'admin' ? 'All' : u.countries.join(', ') || <span className="text-danger">none</span>}</td>
                    <td className="px-3 py-2 text-text-muted">
                      {u.effective.length} tab{u.effective.length === 1 ? '' : 's'}
                      {(grants > 0 || denies > 0) && <span className="ml-1 text-xs">({grants > 0 ? `+${grants}` : ''}{grants > 0 && denies > 0 ? ' ' : ''}{denies > 0 ? `−${denies}` : ''})</span>}
                      {u.is_contact && <span className="ml-1 text-xs">· SLK contact</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-text-muted">{when(u.last_login_at)}</td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-2">
                        <input type="checkbox" checked={!!u.active} disabled={self || update.isPending}
                          onChange={(e) => update.mutate({ username: u.username, patch: { active: e.target.checked } })} />
                        <span>{u.active ? 'On' : 'Off'}</span>
                      </label>
                    </td>
                    <td className="px-3 py-2 text-right"><Button size="sm" onClick={() => setEditing(u.username)} aria-label={`Edit ${u.full_name}`}>Edit</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editingRow && <PersonDialog user={editingRow} self={editingRow.username.toLowerCase() === me?.username.toLowerCase()}
        onClose={(msg) => { setEditing(null); if (msg) setNotice({ tone: 'success', text: msg }); }} />}
    </>
  );
}

function CountryPicker({ value, onChange, idPrefix }: { value: string[]; onChange: (v: string[]) => void; idPrefix: string }) {
  const countries = useQuery({ queryKey: ['admin-countries'], queryFn: () => api<string[]>('/admin/countries') });
  if (countries.isPending) return <Skeleton className="h-9" />;
  return (
    <fieldset>
      <legend className="label-caps mb-1.5 text-text-muted">Countries</legend>
      <div className="flex flex-wrap gap-3">
        {(countries.data ?? []).map((c) => (
          <label key={c} className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" id={`${idPrefix}-${c}`} checked={value.includes(c)}
              onChange={(e) => onChange(e.target.checked ? [...value, c] : value.filter((x) => x !== c))} />
            {c}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AddPerson({ onDone }: { onDone: (msg?: string) => void }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [countries, setCountries] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api('/admin/users', { method: 'POST', json: { username, full_name: name, role, countries } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); onDone(`Added ${username.toUpperCase()}. They get this role and these countries at their first sign-in.`); },
    onError: (e: ApiError) => setError(e.message),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setError(null); add.mutate(); };
  return (
    <Card className="mb-4">
      <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Add a person">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field id="new-username" label="WIREGUARD username" hint="NESR- and the employee number">
            <input id="new-username" className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="NESR-12345" autoFocus />
          </Field>
          <Field id="new-name" label="Name"><input id="new-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field id="new-role" label="Role">
            <select id="new-role" className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </Field>
        </div>
        <CountryPicker value={countries} onChange={setCountries} idPrefix="new-c" />
        <p className="text-xs text-text-subtle">The WIREGUARD account itself (password, sign-in) is created in WIREGUARD.</p>
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={add.isPending} disabled={!username || !name}>Add</Button>
          <Button variant="ghost" onClick={() => onDone()}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

type Choice = 'default' | 'view' | 'edit' | 'remove';

function PersonDialog({ user, self, onClose }: { user: UserRow; self: boolean; onClose: (msg?: string) => void }) {
  const qc = useQueryClient();
  const config = useConfig();
  const matrix = useQuery({ queryKey: ['role-matrix'], queryFn: () => api<Matrix>('/admin/role-permissions') });
  const [countries, setCountries] = useState<string[]>(user.countries);
  const [choice, setChoice] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(user.grants.map((g) => [g.menu_key, g.effect === 'deny' ? 'remove' : g.can_edit ? 'edit' : 'view'])));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = (matrix.data?.menus ?? []).filter((k) => k !== 'users');
  const roleRight = (k: string) => {
    if (user.role === 'admin') return 'edit';
    const r = matrix.data?.rows.find((x) => x.role === user.role && x.menu_key === k);
    if (k === 'pre_job_notes' && user.is_contact) return 'edit (SLK contact)';
    return r?.can_edit ? 'edit' : r?.can_view ? 'view' : 'none';
  };
  const save = useMutation({
    mutationFn: async () => {
      if (user.role !== 'admin') await api(`/admin/users/${encodeURIComponent(user.username)}`, { method: 'PATCH', json: { countries } });
      await api(`/admin/users/${encodeURIComponent(user.username)}/grants`, {
        method: 'PUT',
        json: { grants: Object.entries(choice).filter(([, v]) => v !== 'default').map(([menu_key, v]) => ({ menu_key, effect: v === 'remove' ? 'deny' : 'grant', can_edit: v === 'edit' })) },
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); onClose(`Saved ${user.full_name}`); },
    onError: (e: ApiError) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api(`/admin/users/${encodeURIComponent(user.username)}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); onClose(`${user.full_name} was removed from SLK Ops`); },
    onError: (e: ApiError) => { setError(e.message); setConfirmRemove(false); },
  });

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="person-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-pop">
        <div className="mb-1 flex items-start gap-3">
          <h2 id="person-title" className="flex-1 font-display text-lg font-bold">{user.full_name} <span className="font-mono text-sm font-normal text-text-muted">{user.username}</span></h2>
          <Button size="sm" variant="ghost" onClick={() => onClose()} aria-label="Close"><X aria-hidden className="size-4" /></Button>
        </div>
        <p className="mb-4 text-sm text-text-muted">Role: {ROLE_LABEL[user.role]}. Changes apply on the person’s next click.</p>
        {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}

        {user.role === 'admin'
          ? <p id="admin-tabs-note" className="mb-4 text-sm text-text-muted">Admins see every country and every tab; tab changes do not apply to them.</p>
          : <div className="mb-5"><CountryPicker value={countries} onChange={setCountries} idPrefix={`c-${user.username}`} /></div>}

        <p className="label-caps mb-2 text-text-muted">Tabs: role default, extra access, or removed</p>
        {matrix.isPending && <Skeleton className="h-48" />}
        {matrix.data && menuClusters(keys).map((cl) => (
          <fieldset key={cl.label} className="mb-3 rounded-md border border-border">
            <legend className="label-caps px-2 text-text-subtle">{cl.label}</legend>
            <table className="w-full table-fixed text-sm">
              <caption className="sr-only">{cl.label} tabs for {user.full_name}</caption>
              <colgroup><col /><col className="w-24" /><col className="w-16" /><col className="w-16" /><col className="w-20" /></colgroup>
              <thead><tr className="text-left text-xs text-text-subtle"><th scope="col" className="px-2 py-1 font-normal">Tab</th>
                {(['default', 'view', 'edit', 'remove'] as Choice[]).map((c) => <th key={c} scope="col" className="px-1 py-1 text-center font-normal">{c === 'default' ? 'Role default' : c === 'view' ? '+ View' : c === 'edit' ? '+ Edit' : 'Remove'}</th>)}
              </tr></thead>
              <tbody>
                {cl.keys.map((k) => (
                  <tr key={k} className="border-t border-border">
                    <th scope="row" className="px-2 py-1.5 text-left font-normal">{menuLabel(k)} <span className="text-xs text-text-subtle">({roleRight(k)})</span></th>
                    {(['default', 'view', 'edit', 'remove'] as Choice[]).map((c) => (
                      <td key={c} className="text-center">
                        <input type="radio" name={`t-${k}`} aria-label={`${menuLabel(k)}: ${c}`} disabled={user.role === 'admin'}
                          checked={(choice[k] ?? 'default') === c} onChange={() => setChoice((s) => ({ ...s, [k]: c }))} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>
        ))}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()} disabled={user.role === 'admin' && !Object.keys(choice).length} aria-describedby={user.role === 'admin' ? 'admin-tabs-note' : undefined}>Save</Button>
          <Button variant="ghost" onClick={() => onClose()}>Cancel</Button>
          {config.data && (
            <a href={config.data.wireguardUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-text-muted underline hover:text-text">
              Password and account: WIREGUARD <ExternalLink aria-hidden className="size-3.5" />
            </a>
          )}
          {!self && (
            <span className="ml-auto">
              {!confirmRemove
                ? <Button variant="danger" onClick={() => setConfirmRemove(true)}>Remove from SLK Ops</Button>
                : <span className="inline-flex items-center gap-2"><span className="text-sm text-danger">Remove their SLK Ops access record?</span>
                    <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Yes, remove</Button>
                    <Button variant="ghost" onClick={() => setConfirmRemove(false)}>No</Button></span>}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function RoleMatrix() {
  const qc = useQueryClient();
  const m = useQuery({ queryKey: ['role-matrix'], queryFn: () => api<Matrix>('/admin/role-permissions') });
  const [role, setRole] = useState<Role>('sdm');
  const [error, setError] = useState<string | null>(null);
  const set = useMutation({
    mutationFn: (b: { menu_key: string; can_view: boolean; can_edit: boolean; can_delete: boolean }) =>
      api('/admin/role-permissions', { method: 'PUT', json: { role, ...b } }),
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ['role-matrix'] }); },
    onError: (e: ApiError) => setError(e.message),
  });
  if (m.isPending) return <Skeleton className="h-64" />;
  if (m.isError) return <Banner tone="danger">{m.error.message}</Banner>;
  const rights = (k: string) => m.data.rows.find((r) => r.role === role && r.menu_key === k) ?? { can_view: 0, can_edit: 0, can_delete: 0 };
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field id="matrix-role" label="Role">
          <select id="matrix-role" className={`${inputClass} w-56`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {m.data.roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
        <p className="pb-2 text-sm text-text-muted">Changes apply to everyone with this role at their next click. Admins always have every right.</p>
      </div>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      <table className="w-full text-sm">
        <caption className="sr-only">Rights of the {ROLE_LABEL[role]} role per tab</caption>
        <thead><tr className="label-caps text-left text-text-muted"><th scope="col" className="py-1">Tab</th><th scope="col">View</th><th scope="col">Edit</th><th scope="col">Delete</th></tr></thead>
        <tbody>
          {m.data.menus.filter((k) => k !== 'users').map((k) => {
            const r = rights(k);
            const put = (patch: Partial<{ can_view: boolean; can_edit: boolean; can_delete: boolean }>) => {
              const next = { can_view: !!r.can_view, can_edit: !!r.can_edit, can_delete: !!r.can_delete, ...patch };
              if (patch.can_view === false) { next.can_edit = false; next.can_delete = false; }
              set.mutate({ menu_key: k, ...next });
            };
            return (
              <tr key={k} className="border-t border-border">
                <th scope="row" className="py-1.5 text-left font-normal">{menuLabel(k)}</th>
                <td><input type="checkbox" aria-label={`${menuLabel(k)}: view`} checked={!!r.can_view} disabled={set.isPending} onChange={(e) => put({ can_view: e.target.checked })} /></td>
                <td><input type="checkbox" aria-label={`${menuLabel(k)}: edit`} checked={!!r.can_edit} disabled={set.isPending} onChange={(e) => put({ can_edit: e.target.checked })} /></td>
                <td><input type="checkbox" aria-label={`${menuLabel(k)}: delete`} checked={!!r.can_delete} disabled={set.isPending} onChange={(e) => put({ can_delete: e.target.checked })} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function SyncPanel() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ['wg-status'], queryFn: () => api<WgStatus>('/wg/status') });
  const run = useMutation({
    mutationFn: () => api<{ results: { resource: string; error?: string }[] }>('/wg/sync', { method: 'POST' }),
    onSettled: () => qc.invalidateQueries(),
  });
  if (s.isPending) return <Skeleton className="h-64" />;
  if (s.isError) return <Banner tone="danger">{s.error.message}</Banner>;
  const c = s.data.counts;
  const tiles: [string, number | string][] = [
    ['Units', c.units], ['Wires', c.wires], ['Drums', c.drums], ['Runs', c.runs], ['Runs awaiting approval', c.runs_pending],
    ['Shop wire-cut rows', c.cut_only_rows], ['Tests and maintenance', c.documents], ['Alerts', c.alerts],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={run.isPending} onClick={() => run.mutate()}>Sync everything now</Button>
        <span className="text-sm text-text-muted">
          WIREGUARD build <span className="font-mono">{c.wg_build ?? 'unknown'}</span> · countries visible to the sync account: {c.countries_seen.join(', ') || 'none'}
        </span>
      </div>
      {c.countries_seen.length < 2 && (
        <Banner tone="warning">The sync account sees {c.countries_seen.length === 1 ? 'only one country' : 'no country'}. If WIREGUARD has more, give that account every enabled country.</Banner>
      )}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, n]) => (
          <div key={label} className="rounded-md border border-border bg-surface p-3">
            <dt className="label-caps text-text-muted">{label}</dt>
            <dd className="mt-1 font-display text-kpi leading-none font-bold">{n}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">Last sync per WIREGUARD resource</caption>
          <thead className="bg-surface-2"><tr className="label-caps text-left text-text-muted"><th scope="col" className="px-3 py-2">Resource</th><th scope="col" className="px-3 py-2">Last finished</th><th scope="col" className="px-3 py-2">Rows</th><th scope="col" className="px-3 py-2">Note</th></tr></thead>
          <tbody>
            {s.data.resources.map((r) => (
              <tr key={r.resource} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-mono font-normal">{r.resource}</th>
                <td className="px-3 py-2 font-mono text-xs">{when(r.finished_at)}</td>
                <td className="px-3 py-2 font-mono">{r.rows_seen ?? '—'}</td>
                <td className={cx('px-3 py-2', r.error && !r.error.includes('skipped') ? 'text-danger' : 'text-text-muted')}>{r.error ?? 'ok'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function History() {
  const h = useQuery({ queryKey: ['admin-audit'], queryFn: () => api<AuditRow[]>('/admin/audit') });
  if (h.isPending) return <Skeleton className="h-64" />;
  if (h.isError) return <Banner tone="danger">{h.error.message}</Banner>;
  if (!h.data.length) return <EmptyState title="No changes yet" />;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
      {h.data.map((r, i) => (
        <li key={i} className="grid gap-1 px-3 py-2 md:grid-cols-[10rem_9rem_1fr]">
          <span className="font-mono text-xs text-text-muted">{when(r.occurred_at)}</span>
          <span className="font-mono text-xs">{r.username}</span>
          <span><span className="text-text-muted">{r.action} {r.entity_type.replace('_', ' ')} {r.entity_id} — </span>{r.summary}</span>
        </li>
      ))}
    </ul>
  );
}
