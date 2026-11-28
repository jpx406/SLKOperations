import { Select } from '../components/Select';
import { riyadhShort } from '../../shared/dates';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudDownload, ExternalLink, FileDown, FileUp, Fingerprint, Plus, RefreshCw, Search, Smartphone, Trash2, UserCheck, UserX, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { MENU_LABELS, menuClusters } from '../../shared/menus';
import { roleLabel } from '../../shared/roles';
import { useRoles, useRules, type RoleRow } from '../rules';
import { SearchSelect, type Option } from '../components/SearchSelect';
import { MultiSelect } from '../components/FilterBar';
import type { RuleGroup } from '../../shared/approvalRules';
import { FILL_SCOPE_LABEL, type Category, type FillScope } from '../../shared/attendanceSheets';
import { CODES, CODE_LIST } from '../../shared/attendance';
import type { Role, WgStatus } from '../../shared/types';
import { COMPETENCY_GRADES, COMPETENCY_POSITIONS, COMPETENCY_SEGMENTS, COMPETENCY_SHEET_HEADER, COMPETENCY_SHEET_WIDTHS, COMPETENCY_STATUSES, profileRowsFromSheet, type CompetencyProfile, type CompetencyRoleDef, type SheetProfileRow } from '../../shared/competencyUsers';
import { workbook, type Cell } from '../../shared/xlsx';
import { USER_MODULES, type UserModuleKey, type UserModules } from '../../shared/modules';
import { FIX_LABEL, type FixAction, type ReconIssue } from '../../shared/userAdmin';
import { sheetRows } from '../competency/sheet';
import { saveFile } from '../components/charts';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass, inputSized } from '../components/ui';
import { Dialog, useConfirm } from '../components/Dialog';

type Change = { menu_key: string; effect: 'grant' | 'deny'; can_edit: number };
interface UserRow {
  username: string; full_name: string; role: Role; wg_role: string | null; countries: string[];
  active: number; last_login_at: string | null; updated_by: string | null; updated_at: string;
  grants: Change[]; is_contact: boolean; effective: { menu_key: string; edit: boolean }[];
  email: string | null; employee_eid: string | null; wg_active: number | null; wg_country: string | null; wg_field: string | null; wg_synced_at: string | null;
  passkey_allowed: number; passkeys: number;
  employee_id: string | null; job_title: string | null; account: string | null; crew_role: string | null; sheet_override: string | null;
  reports_to_id: string | null; self_updated: number | null; is_slk_contact: number | null; contact_mobile: string | null; attendance_country: string | null;
  role_sheet: string | null;
  modules: UserModules;
}
interface Matrix { roles: Role[]; menus: string[]; rows: { role: Role; menu_key: string; can_view: number; can_edit: number; can_delete: number }[] }
interface AuditRow { occurred_at: string; username: string; action: string; entity_type: string; entity_id: string; summary: string }

const menuLabel = (k: string) => MENU_LABELS[k] ?? k;
const when = (iso: string | null) => riyadhShort(iso, 'never');

function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api<{ wireguardUrl: string }>('/config'), staleTime: Infinity });
}

export function AdminUsers() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'people';
  const tabs = [['people', 'Users'], ['roles', 'Roles'], ['matrix', 'Role permissions'], ['competency', 'Competency users'], ['approvals', 'Approvals'], ['attendance', 'Attendance categories'], ['reconcile', 'Reconciliation'], ['sync', 'WIREGUARD sync'], ['history', 'Recent changes']] as const;
  return (
    <section aria-labelledby="admin-title">
      <PageTitle><span id="admin-title">Users &amp; roles</span></PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">
        Accounts and passwords live in WIREGUARD. Here you decide what each person can do in SLK Operations Hub and which countries they see.
        Someone signing in for the first time gets a role based on their WIREGUARD role and the countries WIREGUARD shows them. You can change both.
      </p>
      <div role="tablist" aria-label="Users and roles" className="mb-4 flex flex-wrap gap-2">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k }, { replace: true })}
            className={cx('h-(--layout-control-sm) rounded-pill border px-3.5 text-sm font-semibold', tab === k ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'people' && <People />}
        {tab === 'roles' && <RolesPanel />}
        {tab === 'matrix' && <RoleMatrix />}
        {tab === 'competency' && <CompetencyUsers />}
        {tab === 'approvals' && <ApprovalsPanel />}
        {tab === 'attendance' && <AttendanceCategories />}
        {tab === 'reconcile' && <Reconciliation />}
        {tab === 'sync' && <SyncPanel />}
        {tab === 'history' && <History />}
      </div>
    </section>
  );
}

/** The roles as dropdown options. */
function useRoleOptions(): Option[] {
  const roles = useRoles();
  return (roles.data ?? []).map((r) => ({ value: r.key, label: r.label, hint: r.from_wireguard ? 'WIREGUARD' : undefined }));
}

function People() {
  const qc = useQueryClient();
  const roleOptions = useRoleOptions();
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
    onSuccess: (_d, v) => {
      const who = users.data?.find((u) => u.username === v.username)?.full_name ?? v.username;
      setNotice({ tone: 'success', text: v.patch.active === undefined ? `Saved ${who}` : v.patch.active ? `${who} is active again: they can sign in.` : `${who} is deactivated: they can't sign in, and Competency shows them as Inactive.` });
      qc.invalidateQueries({ queryKey: ['admin-users'] }); qc.invalidateQueries({ queryKey: ['competency-users'] });
    },
    onError: (e: ApiError) => { setNotice({ tone: 'danger', text: e.message }); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
  });

  const importWg = useMutation({
    mutationFn: () => api<{ total: number; added: number; updated: number; inactive: number }>('/admin/access/wg-import', { method: 'POST', json: {} }),
    onSuccess: (r) => { setNotice({ tone: 'success', text: `Imported ${r.total} WIREGUARD users: ${r.added} new, ${r.updated} updated${r.inactive ? `, ${r.inactive} inactive in WIREGUARD` : ''}. New people got the role their WIREGUARD role maps to; everyone else kept their SLK Ops role and countries.` }); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e: ApiError) => setNotice({ tone: 'danger', text: `WIREGUARD import failed: ${e.message}` }),
  });

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (users.data ?? []).filter((u) =>
      (!s || `${u.username} ${u.full_name} ${roleLabel(u.role)} ${u.email ?? ''} ${u.employee_eid ?? ''}`.toLowerCase().includes(s))
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
          <input className={`${inputClass} pl-8`} placeholder="Name, NESR number, email or role" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <SearchSelect className="w-52" ariaLabel="Filter by role" value={roleFilter} onChange={setRoleFilter} options={roleOptions} placeholder="All roles" emptyLabel="All roles" searchPlaceholder="Search roles…" />
        <label><span className="sr-only">Filter by status</span>
          <Select className={`${inputClass} w-36`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Active and inactive</option><option value="on">Active</option><option value="off">Inactive</option>
          </Select>
        </label>
        <Button variant="primary" onClick={() => setAdding(true)}><Plus aria-hidden className="size-4" />Add person</Button>
        {me?.menus.users?.edit && <Button loading={importWg.isPending} onClick={() => importWg.mutate()}><CloudDownload aria-hidden className="size-4" />Import from WIREGUARD</Button>}
        {users.data && <span className="ml-auto font-mono text-xs text-text-muted">{shown.length} of {users.data.length}</span>}
      </div>
      {notice && <div className="mb-3"><Banner tone={notice.tone} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)} aria-label="Dismiss"><X aria-hidden className="size-4" /></Button>}>{notice.text}</Banner></div>}
      {adding && <AddPerson onDone={(msg) => { setAdding(false); if (msg) setNotice({ tone: 'success', text: msg }); }} />}
      {users.isPending && <Skeleton className="h-64" />}
      {users.isError && <Banner tone="danger">{users.error.message}</Banner>}
      {users.data && shown.length === 0 && <EmptyState title={q || roleFilter || statusFilter ? 'Nobody matches' : 'Nobody has signed in yet'}>{q || roleFilter || statusFilter ? 'Try another name, role or status filter.' : 'People appear here after their first sign-in, or when you add them.'}</EmptyState>}
      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[60rem] text-sm">
            <caption className="sr-only">People with access to SLK Operations Hub</caption>
            <thead className="bg-surface-2">
              <tr className="label-caps text-left text-text-muted">
                {['Person', 'SLK Ops role', 'Countries', 'Attendance', 'Tabs', 'Face ID', 'Last sign-in', 'Status', ''].map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}
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
                      <div className="font-mono text-xs text-text-subtle">{u.username}{u.employee_eid ? ` · ID ${u.employee_eid}` : ''}{u.wg_role ? ` · WIREGUARD ${u.wg_role}` : ' · not in WIREGUARD yet'}</div>
                      {u.email && <div className="text-xs text-text-muted">{u.email}</div>}
                      {u.wg_active === 0 && <div className="text-xs font-semibold text-danger">Inactive in WIREGUARD</div>}
                    </th>
                    <td className="px-3 py-2">
                      <SearchSelect className="w-48" ariaLabel={`Role for ${u.full_name}${self ? ' (you cannot change your own role)' : ''}`} value={u.role} allowEmpty={false}
                        disabled={self || update.isPending} options={roleOptions} searchPlaceholder="Search roles…"
                        onChange={(v) => update.mutate({ username: u.username, patch: { role: v as Role } })} />
                    </td>
                    <td className="px-3 py-2 text-text-muted">{u.role === 'admin' ? 'All' : u.countries.join(', ') || <span className="text-danger">none</span>}</td>
                    <td className="px-3 py-2 text-xs text-text-muted">
                      {sheetOfUser(u) === 'none' ? <span className="text-text-subtle">Not on attendance</span> : <>{catLabel(sheetOfUser(u))}{u.sheet_override && <span className="ml-1 text-warning">(moved)</span>}</>}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      {u.effective.length} tab{u.effective.length === 1 ? '' : 's'}
                      {(grants > 0 || denies > 0) && <span className="ml-1 text-xs">({grants > 0 ? `+${grants}` : ''}{grants > 0 && denies > 0 ? ' ' : ''}{denies > 0 ? `−${denies}` : ''})</span>}
                      {u.is_contact && <span className="ml-1 text-xs">· SLK contact</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-muted">
                      {!u.passkey_allowed ? <span className="font-semibold text-warning">Off</span>
                        : u.passkeys ? <span className="inline-flex items-center gap-1"><Fingerprint aria-hidden className="size-3.5 text-success" />{u.passkeys} device{u.passkeys === 1 ? '' : 's'}</span>
                        : 'Not set up'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-text-muted">{when(u.last_login_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge active={!!u.active} />
                        {!self && (
                          <button type="button" disabled={update.isPending} onClick={() => update.mutate({ username: u.username, patch: { active: !u.active } })}
                            className="text-xs font-semibold text-text-muted underline hover:text-text disabled:opacity-50"
                            aria-label={`${u.active ? 'Deactivate' : 'Activate'} ${u.full_name}`}>
                            {u.active ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                      </div>
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
  const roleOptionsAdd = useRoleOptions();
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
            <SearchSelect id="new-role" value={role} allowEmpty={false} onChange={(v) => setRole(v as Role)} options={roleOptionsAdd} searchPlaceholder="Search roles…" />
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
  const [deleting, setDeleting] = useState(false);
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
  const setActive = useMutation({
    mutationFn: (active: boolean) => api(`/admin/users/${encodeURIComponent(user.username)}`, { method: 'PATCH', json: { active } }),
    onSuccess: (_d, active) => { qc.invalidateQueries({ queryKey: ['admin-users'] }); qc.invalidateQueries({ queryKey: ['competency-users'] }); onClose(active ? `${user.full_name} is active again` : `${user.full_name} is deactivated`); },
    onError: (e: ApiError) => setError(e.message),
  });

  return (
    <Dialog title={<>{user.full_name} <span className="font-mono text-sm font-normal text-text-muted">{user.username}</span></>} onClose={() => onClose()} size="lg">
        <p className="mb-4 text-sm text-text-muted">SLK Ops role: {roleLabel(user.role)}. Changes apply on the person’s next click.</p>
        {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
          <span className="label-caps text-text-muted">Status</span>
          <StatusBadge active={!!user.active} />
          <span className="min-w-0 flex-1 basis-48 text-xs text-text-subtle">{user.active ? 'Can sign in and use the modules below.' : 'Cannot sign in. Their records stay.'}</span>
          {!self && (user.active
            ? <Button size="sm" loading={setActive.isPending} onClick={() => setActive.mutate(false)}><UserX aria-hidden className="size-4" />Deactivate</Button>
            : <Button size="sm" variant="primary" loading={setActive.isPending} onClick={() => setActive.mutate(true)}><UserCheck aria-hidden className="size-4" />Activate</Button>)}
        </div>
        <PersonModules user={user} />
        <WgDetails user={user} />
        <PersonAttendance user={user} />
        <PersonPasskeys user={user} self={self} />
        <PersonCompetency username={user.username} name={user.full_name} />

        <p className="label-caps mb-2 text-text-muted">SLK Ops app: countries and tabs</p>

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
          {!self && !deleting && <Button className="ml-auto" variant="danger" onClick={() => setDeleting(true)}><Trash2 aria-hidden className="size-4" />Delete user</Button>}
        </div>
        {!self && deleting && <DeleteUser user={user} onCancel={() => setDeleting(false)} onDeactivate={() => setActive.mutate(false)} deactivating={setActive.isPending}
          onDeleted={() => { qc.invalidateQueries({ queryKey: ['admin-users'] }); onClose(`${user.full_name} was deleted`); }} />}
    </Dialog>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={cx('inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-semibold', active ? 'bg-success-subtle text-success' : 'bg-surface-3 text-text-muted')}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

type ModuleChoice = 'default' | 'on' | 'off';
const MODULE_RIGHT: Record<UserModuleKey, string> = { slk: 'slk_ops', wireguard: 'wireguard', competency: 'competency', career: 'career_development' };

/** The modules the person may open: SLK Operations Hub, WIREGUARD, Competency (6z.38). The Knowledge Hub is open to all. */
function PersonModules({ user }: { user: UserRow }) {
  const qc = useQueryClient();
  const initial = () => Object.fromEntries(USER_MODULES.map((m) => [m.key, user.modules?.[m.key] === undefined ? 'default' : user.modules[m.key] ? 'on' : 'off'])) as Record<UserModuleKey, ModuleChoice>;
  const [pick, setPick] = useState<Record<UserModuleKey, ModuleChoice>>(initial);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const changed = USER_MODULES.some((m) => pick[m.key] !== initial()[m.key]);
  const opens = (k: UserModuleKey) => user.effective.some((e) => e.menu_key === MODULE_RIGHT[k]);
  const save = useMutation({
    mutationFn: () => api(`/admin/users/${encodeURIComponent(user.username)}/modules`, { method: 'PUT', json: { modules: Object.fromEntries(USER_MODULES.map((m) => [m.key, pick[m.key] === 'default' ? null : pick[m.key] === 'on'])) } }),
    onSuccess: () => { setMsg({ tone: 'success', text: 'Modules saved' }); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e: ApiError) => setMsg({ tone: 'danger', text: e.message }),
  });
  return (
    <fieldset className="mb-4 rounded-md border border-border p-3">
      <legend className="label-caps px-1 text-text-muted">Modules</legend>
      {user.role === 'admin'
        ? <p className="text-sm text-text-muted">Admins open every module.</p>
        : <>
          <p className="mb-2 text-xs text-text-subtle">Everyone reads the Knowledge Hub; their role may let them do more there. Role default follows the SLK Ops role (WIREGUARD, Competency and Career Development come with the SLK Operations Hub).</p>
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2">
            {USER_MODULES.map((m) => (
              <label key={m.key} className="flex flex-col gap-1 text-sm">
                <span className="font-semibold">{m.label} <span className={cx('text-xs font-normal', opens(m.key) ? 'text-success' : 'text-text-subtle')}>({opens(m.key) ? 'opens now' : 'closed now'})</span></span>
                <Select className={inputClass} value={pick[m.key]} onChange={(e) => setPick((s) => ({ ...s, [m.key]: e.target.value as ModuleChoice }))}>
                  <option value="default">Role default</option><option value="on">Allowed</option><option value="off">Not allowed</option>
                </Select>
              </label>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>Save modules</Button>
            {msg && <span className={cx('text-sm', msg.tone === 'danger' ? 'text-danger' : 'text-success')} role="status">{msg.text}</span>}
          </div>
        </>}
    </fieldset>
  );
}

interface RecordsReply { blockers: string[] }

/** Delete for good: only someone with no records anywhere, confirmed with the admin's own password (6z.38). */
function DeleteUser({ user, onCancel, onDeleted, onDeactivate, deactivating }: { user: UserRow; onCancel: () => void; onDeleted: () => void; onDeactivate: () => void; deactivating: boolean }) {
  const check = useQuery({ queryKey: ['user-records', user.username], queryFn: () => api<RecordsReply>(`/admin/users/${encodeURIComponent(user.username)}/records`), gcTime: 0 });
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const del = useMutation({
    mutationFn: () => api(`/admin/users/${encodeURIComponent(user.username)}/delete`, { method: 'POST', json: { password } }),
    onSuccess: onDeleted,
    onError: (e: ApiError) => { setError(e.message); setPassword(''); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setError(null); del.mutate(); };
  return (
    <div className="mt-4 rounded-md border border-danger/40 bg-danger-subtle/40 p-3 text-sm" role="region" aria-label={`Delete ${user.full_name}`}>
      <p className="font-semibold">Delete {user.full_name}?</p>
      {check.isPending && <p className="mt-1 text-text-muted">Checking WIREGUARD, Competency and SLK Ops for their records…</p>}
      {check.isError && <p className="mt-1 text-danger">{check.error.message}</p>}
      {check.data && check.data.blockers.length > 0 && (
        <>
          <p className="mt-1">They can't be deleted, only deactivated:</p>
          <ul className="mt-1 list-disc pl-5 text-text-muted">{check.data.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {user.active ? <Button size="sm" loading={deactivating} onClick={onDeactivate}><UserX aria-hidden className="size-4" />Deactivate instead</Button> : <span className="text-text-muted">They are already inactive.</span>}
            <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </>
      )}
      {check.data && check.data.blockers.length === 0 && (
        <form onSubmit={submit} className="mt-2 flex flex-col gap-2">
          <p className="text-text-muted">They have no records in WIREGUARD, Competency or SLK Ops. Deleting can't be undone.</p>
          <Field id="del-password" label="Your WIREGUARD password" hint="To confirm it is you">
            <input id="del-password" type="password" autoComplete="current-password" className={`${inputClass} max-w-xs`} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
          {error && <Banner tone="danger">{error}</Banner>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="danger" loading={del.isPending} disabled={!password}>Delete for good</Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}

interface ReconReply { issues: ReconIssue[]; counts: { people: number; wireguard: number | null; competency: number; register: number }; wgError: string | null }
const ISSUE_TITLE: Record<ReconIssue['kind'], string> = {
  wg_missing: 'Missing from People', not_in_wg: 'Not in WIREGUARD', wg_inactive: 'Switched off in WIREGUARD', details: 'Different details',
  competency_orphan: 'Competency user without a SLK Ops user', competency_status: 'Still active in Competency', no_competency: 'Not in Competency',
  register_extra: 'Only in the Competency register',
};

/** People, Competency users and WIREGUARD compared, with a fix for each difference (6z.38). WIREGUARD is never changed. */
function Reconciliation() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-reconcile'], queryFn: () => api<ReconReply>('/admin/reconcile') });
  const [show, setShow] = useState<'problem' | 'all'>('problem');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const fix = useMutation({
    mutationFn: (i: ReconIssue) => api<{ done: string }>('/admin/reconcile/fix', { method: 'POST', json: { username: i.username, fix: i.fix } }),
    onSuccess: (r) => { setMsg({ tone: 'success', text: r.done }); },
    onError: (e: ApiError) => setMsg({ tone: 'danger', text: e.message }),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['admin-reconcile'] }); qc.invalidateQueries({ queryKey: ['admin-users'] }); qc.invalidateQueries({ queryKey: ['competency-users'] }); },
  });
  const issues = (q.data?.issues ?? []).filter((i) => show === 'all' || i.level === 'problem');
  const problems = (q.data?.issues ?? []).filter((i) => i.level === 'problem').length;
  const notes = (q.data?.issues ?? []).length - problems;
  return (
    <>
      <p className="mb-3 max-w-3xl text-sm text-text-muted">
        People, Competency users and WIREGUARD should list the same people. This compares the three and offers a fix for each difference.
        Fixes change SLK Ops and Competency only: WIREGUARD is read, never changed, so a person missing there is added in WIREGUARD itself.
      </p>
      {q.data && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-md border border-border px-2.5 py-1">People <b className="font-mono">{q.data.counts.people}</b></span>
          <span className="rounded-md border border-border px-2.5 py-1">WIREGUARD <b className="font-mono">{q.data.counts.wireguard ?? '—'}</b></span>
          <span className="rounded-md border border-border px-2.5 py-1">Competency users <b className="font-mono">{q.data.counts.competency}</b></span>
          <span className="rounded-md border border-border px-2.5 py-1">Competency register <b className="font-mono">{q.data.counts.register}</b></span>
          <label className="ml-auto"><span className="sr-only">Show</span>
            <Select className={`${inputClass} w-56`} value={show} onChange={(e) => setShow(e.target.value as 'problem' | 'all')}>
              <option value="problem">Differences ({problems})</option><option value="all">Differences and notes ({problems + notes})</option>
            </Select>
          </label>
          <Button size="sm" loading={q.isFetching} onClick={() => q.refetch()}><RefreshCw aria-hidden className="size-4" />Check again</Button>
        </div>
      )}
      {q.data?.wgError && <div className="mb-3"><Banner tone="warning">WIREGUARD could not be read, so it is left out of this check: {q.data.wgError}</Banner></div>}
      {msg && <div className="mb-3"><Banner tone={msg.tone} action={<Button size="sm" variant="ghost" onClick={() => setMsg(null)} aria-label="Dismiss"><X aria-hidden className="size-4" /></Button>}>{msg.text}</Banner></div>}
      {q.isPending && <Skeleton className="h-64" />}
      {q.isError && <Banner tone="danger">{q.error.message}</Banner>}
      {q.data && issues.length === 0 && <EmptyState title={show === 'problem' ? 'The three lists agree' : 'Nothing to show'}>{show === 'problem' && notes ? `${notes} note${notes === 1 ? '' : 's'} to look at under Differences and notes.` : 'Everyone is in People, Competency and WIREGUARD with the same details.'}</EmptyState>}
      {issues.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {issues.map((i) => (
            <li key={`${i.kind}-${i.username}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <div className="min-w-0 flex-1 basis-64">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{i.name}</span>
                  <span className="font-mono text-xs text-text-subtle">{i.username}</span>
                  <span className={cx('rounded-pill px-2 py-0.5 text-xs font-semibold', i.level === 'problem' ? 'bg-warning-subtle text-warning' : 'bg-surface-3 text-text-muted')}>{ISSUE_TITLE[i.kind]}</span>
                </div>
                <p className="text-sm text-text-muted">{i.detail}</p>
              </div>
              {i.fix && <Button size="sm" loading={fix.isPending && fix.variables === i} onClick={() => fix.mutate(i)}>{FIX_LABEL[i.fix as FixAction]}</Button>}
            </li>
          ))}
        </ul>
      )}
    </>
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
          <SearchSelect id="matrix-role" className="w-64" value={role} allowEmpty={false} onChange={(v) => setRole(v as Role)} searchPlaceholder="Search roles…"
            options={m.data.roles.map((r) => ({ value: r, label: roleLabel(r) }))} />
        </Field>
        <p className="pb-2 text-sm text-text-muted">Changes apply to everyone with this role at their next click. Admins always have every right.</p>
      </div>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      <table className="w-full text-sm">
        <caption className="sr-only">Rights of the {roleLabel(role)} role per tab</caption>
        <thead><tr className="label-caps text-left text-text-muted"><th scope="col" className="py-1">Tab</th><th scope="col">View</th><th scope="col">Edit</th><th scope="col">Delete</th></tr></thead>
        <tbody>
          {/* the module right first (6z.33): it decides which modules the role opens after signing in */}
          {['slk_ops', ...m.data.menus.filter((k) => k !== 'users' && k !== 'slk_ops')].filter((k) => m.data.menus.includes(k)).map((k) => {
            const r = rights(k);
            const put = (patch: Partial<{ can_view: boolean; can_edit: boolean; can_delete: boolean }>) => {
              const next = { can_view: !!r.can_view, can_edit: !!r.can_edit, can_delete: !!r.can_delete, ...patch };
              if (patch.can_view === false) { next.can_edit = false; next.can_delete = false; }
              set.mutate({ menu_key: k, ...next });
            };
            return (
              k === 'slk_ops' ? (
                <tr key={k} className="bg-surface-2">
                  <th scope="row" className="px-2 py-2 text-left font-normal">
                    <span className="font-semibold">Opens the SLK Operations Hub</span>
                    <span className="block text-xs text-text-muted">After signing in, people pick a module. With this ticked the role opens the whole hub, and the Knowledge Hub and Competency with it. Without it, the role opens only the Knowledge Hub and Competency, if ticked below; the other modules are greyed out.</span>
                  </th>
                  <td className="align-top pt-2"><input type="checkbox" aria-label="Opens the SLK Operations Hub" checked={!!r.can_view} disabled={set.isPending} onChange={(e) => put({ can_view: e.target.checked })} /></td>
                  <td /><td />
                </tr>
              ) : (
              <tr key={k} className="border-t border-border">
                <th scope="row" className="py-1.5 text-left font-normal">{menuLabel(k)}</th>
                <td><input type="checkbox" aria-label={`${menuLabel(k)}: view`} checked={!!r.can_view} disabled={set.isPending} onChange={(e) => put({ can_view: e.target.checked })} /></td>
                <td><input type="checkbox" aria-label={`${menuLabel(k)}: edit`} checked={!!r.can_edit} disabled={set.isPending} onChange={(e) => put({ can_edit: e.target.checked })} /></td>
                <td><input type="checkbox" aria-label={`${menuLabel(k)}: delete`} checked={!!r.can_delete} disabled={set.isPending} onChange={(e) => put({ can_delete: e.target.checked })} /></td>
              </tr>
              )
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
    <>
    <p className="mb-2 text-sm text-text-muted">The latest 100 changes to people, roles and sign-ins. <Link className="font-semibold text-accent-text hover:underline" to="/admin/audit?area=users&area=auth">Open the full audit trail</Link> to search everything.</p>
    <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
      {h.data.map((r, i) => (
        <li key={i} className="grid gap-1 px-3 py-2 md:grid-cols-[10rem_9rem_1fr]">
          <span className="font-mono text-xs text-text-muted">{when(r.occurred_at)}</span>
          <span className="font-mono text-xs">{r.username}</span>
          <span><span className="text-text-muted">{r.action} {r.entity_type.replace('_', ' ')} {r.entity_id} — </span>{r.summary}</span>
        </li>
      ))}
    </ul>
    </>
  );
}

/** What WIREGUARD knows about the person, from the last import. */
function WgDetails({ user }: { user: UserRow }) {
  if (!user.wg_synced_at) return <p className="mb-4 text-xs text-text-subtle">Not imported from WIREGUARD yet. Use "Import from WIREGUARD" on the People list.</p>;
  const rows: [string, string | null][] = [
    ['Employee ID', user.employee_eid], ['Email', user.email], ['WIREGUARD role', user.wg_role], ['Country', user.wg_country], ['Field', user.wg_field],
    ['WIREGUARD account', user.wg_active === 0 ? 'Inactive' : 'Active'],
  ];
  return (
    <div className="mb-5 rounded-md border border-border p-3">
      <p className="label-caps mb-2 text-text-muted">From WIREGUARD · imported {when(user.wg_synced_at)}</p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="text-text-muted">{k}:</dt><dd className={cx('font-semibold', k === 'WIREGUARD account' && v === 'Inactive' && 'text-danger')}>{v ?? '—'}</dd></div>)}
      </dl>
    </div>
  );
}

type AdminDevice = { id: string; device_name: string | null; backed_up: number; created_at: string; last_used_at: string | null };

/** The person's Face ID / fingerprint sign-in: allowed or not, and the devices set up, each removable. */
function PersonPasskeys({ user, self }: { user: UserRow; self: boolean }) {
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ['admin-passkeys', user.username], queryFn: () => api<AdminDevice[]>(`/admin/access/passkeys?username=${encodeURIComponent(user.username)}`) });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-passkeys', user.username] }); qc.invalidateQueries({ queryKey: ['admin-users'] }); };
  const allow = useMutation({
    mutationFn: (allowed: boolean) => api('/admin/access/passkey-allowed', { method: 'PUT', json: { username: user.username, allowed } }),
    onSuccess: refresh, onError: (e: ApiError) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/access/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: refresh, onError: (e: ApiError) => setError(e.message),
  });
  const [ask, confirmDialog] = useConfirm();
  return (
    <div className="mb-5 rounded-md border border-border p-3">
      {confirmDialog}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <p className="label-caps flex-1 text-text-muted">Face ID / fingerprint sign-in</p>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={!!user.passkey_allowed} disabled={allow.isPending} onChange={(e) => allow.mutate(e.target.checked)} />
          Allowed
        </label>
      </div>
      {error && <div className="mb-2"><Banner tone="danger">{error}</Banner></div>}
      {!user.passkey_allowed && <p className="mb-2 text-xs text-warning">Switched off: {self ? 'you' : 'they'} must sign in with the WIREGUARD password, and new devices can't be set up.</p>}
      {devices.isPending ? <p className="text-sm text-text-muted">Loading…</p> : devices.data && devices.data.length > 0 ? (
        <ul className="divide-y divide-border">
          {devices.data.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-1.5 text-sm">
              <Smartphone aria-hidden className="size-4 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{d.device_name ?? 'Device'}{d.backed_up ? <span className="ml-2 text-xs font-normal text-text-subtle">synced</span> : null}</span>
                <span className="block text-xs text-text-subtle">Set up {d.created_at.slice(0, 10)} · {d.last_used_at ? `last used ${when(d.last_used_at)}` : 'not used yet'}</span>
              </span>
              <Button size="sm" variant="ghost" aria-label={`Remove ${d.device_name ?? 'device'}`} loading={remove.isPending && remove.variables === d.id} onClick={async () => { if (await ask({ title: `Remove ${d.device_name ?? 'this device'}?`, body: `${user.full_name} can no longer sign in with Face ID / fingerprint on it until it is set up again.`, confirm: 'Remove device', danger: true })) remove.mutate(d.id); }}><Trash2 aria-hidden className="size-4" /></Button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-text-subtle">No device set up. {self ? 'You' : 'They'} can set one up from the account menu after signing in with the password.</p>}
    </div>
  );
}

const sheetOfUser = (u: UserRow): string => u.sheet_override ?? u.role_sheet ?? 'none';
type CategoryRow = Category & { roles: number; moved: number };
/** The attendance categories (Users & Roles → Attendance categories), shared by the tabs on this page. */
function useCategories() {
  return useQuery({ queryKey: ['attendance-sheets'], queryFn: () => api<CategoryRow[]>('/admin/attendance-sheets'), staleTime: 30_000 });
}
let CAT_LABELS = new Map<string, string>();
const catLabel = (k: string) => CAT_LABELS.get(k) ?? k;
const CREW_ROLE: Record<string, string> = {
  slickline_supervisor: 'Slickline supervisor', slickline_operator: 'Slickline operator', assistant_operator: 'Assistant operator', helper: 'Helper', trainee: 'Trainee', other: 'Other',
};

/** Attendance categories: the categories themselves (add, rename, settings, delete), then which one each role is in. */
function AttendanceCategories() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const cats = useCategories();
  const q = useQuery({ queryKey: ['attendance-categories-roles'], queryFn: () => api<{ role: Role; sheet: string }[]>('/admin/attendance-categories') });
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api<UserRow[]>('/admin/users') });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => ['attendance-sheets', 'attendance-categories-roles', 'admin-users', 'attendance', 'rules'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const save = useMutation({
    mutationFn: (v: { role: Role; sheet: string }) => api('/admin/attendance-categories', { method: 'PUT', json: v }),
    onSuccess: refresh, onError: (e: ApiError) => setError(e.message),
  });
  const count = (r: Role) => (users.data ?? []).filter((u) => u.role === r && u.active).length;
  const canEdit = !!me?.menus.users?.edit;
  CAT_LABELS = new Map((cats.data ?? []).map((c) => [c.key, c.label]));
  const choices: [string, string][] = [...(cats.data ?? []).map((c) => [c.key, c.label] as [string, string]), ['none', 'Not on attendance']];
  return (
    <div className="max-w-5xl">
      <CategoryManager cats={cats.data} canEdit={canEdit} canDelete={!!me?.menus.users?.delete} onChanged={refresh} />
      <h2 className="label-caps mt-6 mb-2 text-text-muted">Which category each role is in</h2>
      <p className="mb-3 text-sm text-text-muted">
        Everyone in Users &amp; Roles is in the category their role is assigned to here. Move one person to another category from their Edit page.
        Who fills, reviews and approves each category is set under Approvals.
      </p>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      {q.isPending ? <Skeleton className="h-64" /> : q.isError ? <Banner tone="danger">{q.error.message}</Banner> : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Attendance category for each role</caption>
            <thead className="bg-surface-2"><tr className="label-caps text-left text-text-muted">
              <th scope="col" className="px-3 py-2">Role</th><th scope="col" className="px-3 py-2">People</th><th scope="col" className="px-3 py-2">Attendance category</th>
            </tr></thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.role} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 text-left font-semibold">{roleLabel(r.role)}</th>
                  <td className="px-3 py-2 font-mono text-xs text-text-muted">{count(r.role)}</td>
                  <td className="px-3 py-2">
                    <Select search aria-label={`Attendance category for ${roleLabel(r.role)}`} className={cx(inputClass, 'w-72')} value={r.sheet} disabled={!canEdit || save.isPending}
                      onChange={(e) => { setError(null); save.mutate({ role: r.role, sheet: e.target.value }); }}>
                      {choices.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const SCOPES: [FillScope, string][] = [['crew', 'Their foreman (crew)'], ['any', 'Fill roles, everyone'], ['self', 'Each person (self)']];

/** Add, rename, reorder, set up and delete attendance categories. */
function CategoryManager({ cats, canEdit, canDelete, onChanged }: { cats: CategoryRow[] | undefined; canEdit: boolean; canDelete: boolean; onChanged: () => void }) {
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [add, setAdd] = useState({ label: '', fill_scope: 'any' as FillScope, two_step: false, auto_from_jobs: false, job_code: 'JBFS' });
  const [names, setNames] = useState<Record<string, string>>({});
  const fail = (e: ApiError) => setMsg({ tone: 'danger', text: e.message });
  const create = useMutation({ mutationFn: () => api('/admin/attendance-sheets', { method: 'POST', json: add }), onSuccess: () => { setMsg({ tone: 'success', text: `Added ${add.label}. Assign roles to it below, and set who fills and approves it under Approvals.` }); setAdd({ ...add, label: '' }); onChanged(); }, onError: fail });
  const patch = useMutation({ mutationFn: (v: { key: string } & Partial<Category>) => { const { key, ...body } = v; return api(`/admin/attendance-sheets/${key}`, { method: 'PATCH', json: { ...body, two_step: body.two_step === undefined ? undefined : !!body.two_step, auto_from_jobs: body.auto_from_jobs === undefined ? undefined : !!body.auto_from_jobs } }); }, onSuccess: () => { setMsg(null); onChanged(); }, onError: fail });
  const remove = useMutation({ mutationFn: (c: CategoryRow) => api(`/admin/attendance-sheets/${c.key}`, { method: 'DELETE' }), onSuccess: (_d, c) => { setMsg({ tone: 'success', text: `Deleted ${c.label}` }); onChanged(); }, onError: fail });
  const [ask, confirmDialog] = useConfirm();
  if (!cats) return <Skeleton className="h-48" />;
  return (
    <div>
      {confirmDialog}
      <h2 className="label-caps mb-2 text-text-muted">Categories</h2>
      {msg && <div className="mb-3"><Banner tone={msg.tone} action={<Button size="sm" variant="ghost" aria-label="Dismiss" onClick={() => setMsg(null)}><X aria-hidden className="size-4" /></Button>}>{msg.text}</Banner></div>}
      <div className="flex flex-col gap-3">
        {cats.map((c) => {
          const renaming = c.key in names;
          const inUse = c.roles + c.moved;
          return (
            <Card key={c.key} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                {renaming ? (
                  <>
                    <input aria-label={`New name for ${c.label}`} autoFocus className={cx(inputClass, 'w-72')} value={names[c.key]} onChange={(e) => setNames({ ...names, [c.key]: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') { patch.mutate({ key: c.key, label: names[c.key] }); setNames((n) => { const x = { ...n }; delete x[c.key]; return x; }); } }} />
                    <Button size="sm" variant="primary" onClick={() => { patch.mutate({ key: c.key, label: names[c.key] }); setNames((n) => { const x = { ...n }; delete x[c.key]; return x; }); }}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setNames((n) => { const x = { ...n }; delete x[c.key]; return x; })}>Cancel</Button>
                  </>
                ) : <h3 className="font-display text-lg font-bold text-accent-text">{c.label}</h3>}
                <span className="font-mono text-xs text-text-subtle">{c.key}</span>
                <span className="text-xs text-text-muted">· {c.roles} role{c.roles === 1 ? '' : 's'}{c.moved ? `, ${c.moved} moved by hand` : ''}</span>
                <span className="ml-auto flex items-center gap-1">
                  {canEdit && !renaming && <Button size="sm" onClick={() => setNames({ ...names, [c.key]: c.label })}>Rename</Button>}
                  {canDelete && (
                    <Button size="sm" variant="ghost" aria-label={`Delete ${c.label}`} disabled={inUse > 0 || remove.isPending} title={inUse ? 'Still used: assign its roles and people to another category first' : undefined}
                      onClick={async () => { if (await ask({ title: `Delete the ${c.label} category?`, body: 'Its approvals go with it.', confirm: 'Delete category', danger: true })) remove.mutate(c); }}><Trash2 aria-hidden className="size-4" /></Button>
                  )}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <Field id={`cat-scope-${c.key}`} label="Filled by" hint={FILL_SCOPE_LABEL[c.fill_scope]}>
                  <Select id={`cat-scope-${c.key}`} search={false} className={inputClass} value={c.fill_scope} disabled={!canEdit} onChange={(e) => patch.mutate({ key: c.key, fill_scope: e.target.value as FillScope })}>
                    {SCOPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                </Field>
                <Field id={`cat-steps-${c.key}`} label="Approval">
                  <Select id={`cat-steps-${c.key}`} search={false} className={inputClass} value={c.two_step ? '2' : '1'} disabled={!canEdit} onChange={(e) => patch.mutate({ key: c.key, two_step: e.target.value === '2' ? 1 : 0 })}>
                    <option value="1">One step</option><option value="2">Two steps (review, then final approval)</option>
                  </Select>
                </Field>
                <Field id={`cat-jobs-${c.key}`} label="Days from jobs" hint={c.auto_from_jobs ? 'Days on assigned jobs fill in by themselves; ongoing jobs up to today' : undefined}>
                  <Select id={`cat-jobs-${c.key}`} search={false} className={inputClass} value={c.auto_from_jobs ? '1' : '0'} disabled={!canEdit} onChange={(e) => patch.mutate({ key: c.key, auto_from_jobs: e.target.value === '1' ? 1 : 0 })}>
                    <option value="1">Yes, from the schedule</option><option value="0">No, filled by hand</option>
                  </Select>
                </Field>
                <Field id={`cat-code-${c.key}`} label="Code for job days">
                  <Select id={`cat-code-${c.key}`} search className={inputClass} value={c.job_code} disabled={!canEdit || !c.auto_from_jobs} onChange={(e) => patch.mutate({ key: c.key, job_code: e.target.value })}>
                    {CODE_LIST.map((k) => <option key={k} value={k}>{k} · {CODES[k]}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                <label htmlFor={`cat-sort-${c.key}`}>Order</label>
                <input id={`cat-sort-${c.key}`} type="number" min={0} className={inputSized('w-20')} defaultValue={c.sort} disabled={!canEdit}
                  onBlur={(e) => { if (Number(e.target.value) !== c.sort) patch.mutate({ key: c.key, sort: Number(e.target.value) }); }} />
              </div>
            </Card>
          );
        })}
      </div>
      {canEdit && (
        <Card className="mt-3 p-4">
          <h3 className="label-caps mb-2 text-text-muted">Add a category</h3>
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
            <Field id="cat-new-label" label="Name"><input id="cat-new-label" className={inputClass} value={add.label} onChange={(e) => setAdd({ ...add, label: e.target.value })} placeholder="e.g. Drivers" /></Field>
            <Field id="cat-new-scope" label="Filled by">
              <Select id="cat-new-scope" search={false} className={inputClass} value={add.fill_scope} onChange={(e) => setAdd({ ...add, fill_scope: e.target.value as FillScope })}>{SCOPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            </Field>
            <Field id="cat-new-steps" label="Approval">
              <Select id="cat-new-steps" search={false} className={inputClass} value={add.two_step ? '2' : '1'} onChange={(e) => setAdd({ ...add, two_step: e.target.value === '2' })}><option value="1">One step</option><option value="2">Two steps</option></Select>
            </Field>
            <Field id="cat-new-jobs" label="Days from jobs">
              <Select id="cat-new-jobs" search={false} className={inputClass} value={add.auto_from_jobs ? '1' : '0'} onChange={(e) => setAdd({ ...add, auto_from_jobs: e.target.value === '1' })}><option value="0">No</option><option value="1">Yes</option></Select>
            </Field>
            <Button variant="primary" loading={create.isPending} onClick={() => { setMsg(null); if (!add.label.trim()) { setMsg({ tone: 'danger', text: 'Name the category' }); return; } create.mutate(); }}><Plus aria-hidden className="size-4" />Add category</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** One person's attendance and crew details (these used to be the Headcount Roster). */
function PersonAttendance({ user }: { user: UserRow }) {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api<UserRow[]>('/admin/users') });
  const [f, setF] = useState({
    title: user.job_title ?? '', account: user.account ?? 'SLK', crew_role: user.crew_role ?? '', attendance_sheet: user.sheet_override ?? '',
    reports_to_id: user.reports_to_id ?? '', self_updated: !!user.self_updated, is_slk_contact: !!user.is_slk_contact, contact_mobile: user.contact_mobile ?? '',
  });
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const save = useMutation({
    mutationFn: () => api(`/admin/users/${encodeURIComponent(user.username)}/attendance`, { method: 'PUT', json: f }),
    onSuccess: () => { setMsg({ tone: 'success', text: 'Attendance details saved' }); qc.invalidateQueries({ queryKey: ['admin-users'] }); qc.invalidateQueries({ queryKey: ['attendance'] }); qc.invalidateQueries({ queryKey: ['employees'] }); },
    onError: (e: ApiError) => setMsg({ tone: 'danger', text: e.message }),
  });
  const cats = useCategories(); // before the early return: hooks run in the same order every time
  if (!user.employee_id) return <p className="mb-5 text-xs text-text-subtle">Not on attendance yet: give {user.full_name} a country first.</p>;
  const sheet = f.attendance_sheet || user.role_sheet || 'none';
  const catName = (k: string | null) => cats.data?.find((c) => c.key === k)?.label ?? (k && k !== 'none' ? k : 'not on attendance');
  // foremen in the same country, for the Operators & Helpers sheet
  const foremen = (users.data ?? []).filter((u) => u.role === 'foreman' && u.active && u.employee_id && u.employee_id !== user.employee_id && u.attendance_country === user.attendance_country);
  const set = (k: keyof typeof f, v: string | boolean) => { setMsg(null); setF((c) => ({ ...c, [k]: v })); };
  const id = (k: string) => `att-${k}-${user.username}`;
  return (
    <div className="mb-5 rounded-md border border-border p-3">
      <p className="label-caps mb-2 text-text-muted">Attendance and crew · {user.attendance_country}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={id('sheet')} label="Attendance category" hint={sheet === 'none' ? 'Not on attendance' : `In ${catName(sheet)}; who fills and approves it is under Approvals`}>
          <Select id={id('sheet')} className={inputClass} value={f.attendance_sheet} onChange={(e) => set('attendance_sheet', e.target.value)}>
            <option value="">From the role ({catName(user.role_sheet)})</option>
            {(cats.data ?? []).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </Select>
        </Field>
        <Field id={id('foreman')} label="Foreman" hint="Fills this person’s attendance when their category is filled by the crew’s foreman">
          <Select id={id('foreman')} search className={inputClass} value={f.reports_to_id} onChange={(e) => set('reports_to_id', e.target.value)}>
            <option value="">{foremen.length ? 'Nobody' : 'No foreman in this country yet'}</option>
            {foremen.map((m) => <option key={m.employee_id!} value={m.employee_id!}>{m.full_name}</option>)}
          </Select>
        </Field>
        <Field id={id('title')} label="Job title"><input id={id('title')} className={inputClass} value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field id={id('account')} label="Account"><input id={id('account')} className={inputClass} value={f.account} onChange={(e) => set('account', e.target.value)} /></Field>
        <Field id={id('crew')} label="Crew role" hint="Puts the person first in that job crew picker">
          <Select id={id('crew')} className={inputClass} value={f.crew_role} onChange={(e) => set('crew_role', e.target.value)}>
            <option value="">Not on crews</option>{Object.entries(CREW_ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field id={id('mobile')} label="Mobile"><input id={id('mobile')} className={inputClass} value={f.contact_mobile} onChange={(e) => set('contact_mobile', e.target.value)} placeholder="+966 …" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={f.self_updated} onChange={(e) => set('self_updated', e.target.checked)} />Fills own attendance (SELF)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={f.is_slk_contact} onChange={(e) => set('is_slk_contact', e.target.checked)} />SLK contact (Pre-Job Notes)</label>
      </div>
      {msg && <div className="mt-2"><Banner tone={msg.tone}>{msg.text}</Banner></div>}
      <Button className="mt-3" size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save attendance details</Button>
    </div>
  );
}

/** Roles: the list, renaming, adding (optionally copying another role's tabs) and deleting. WIREGUARD roles stay. */
function RolesPanel() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const roles = useRoles();
  const options = useRoleOptions();
  const [f, setF] = useState({ label: '', description: '', copy_from: '' });
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const done = (text: string) => { setMsg({ tone: 'success', text }); qc.invalidateQueries({ queryKey: ['roles'] }); qc.invalidateQueries({ queryKey: ['role-matrix'] }); qc.invalidateQueries({ queryKey: ['rules'] }); qc.invalidateQueries({ queryKey: ['attendance-categories-roles'] }); };
  const fail = (e: ApiError) => setMsg({ tone: 'danger', text: e.message });
  const add = useMutation({ mutationFn: () => api<{ key: string }>('/admin/roles', { method: 'POST', json: f }), onSuccess: () => { done(`Added ${f.label}. Set its tabs in Role permissions and its approvals in Approvals.`); setF({ label: '', description: '', copy_from: '' }); }, onError: fail });
  const rename = useMutation({ mutationFn: (r: RoleRow) => api(`/admin/roles/${r.key}`, { method: 'PATCH', json: { label: edit[r.key] } }), onSuccess: (_d, r) => { done(`Renamed to ${edit[r.key]}`); setEdit((c) => { const n = { ...c }; delete n[r.key]; return n; }); }, onError: fail });
  const remove = useMutation({ mutationFn: (r: RoleRow) => api(`/admin/roles/${r.key}`, { method: 'DELETE' }), onSuccess: (_d, r) => done(`Deleted ${r.label}`), onError: fail });
  const canEdit = !!me?.menus.users?.edit;
  const canDelete = !!me?.menus.users?.delete;
  const [ask, confirmDialog] = useConfirm();
  return (
    <div className="max-w-5xl">
      {confirmDialog}
      <p className="mb-3 text-sm text-text-muted">
        The roles people can hold in SLK Operations Hub. Roles marked WIREGUARD are what people get from their WIREGUARD role when they first sign in, so they can be renamed but not deleted.
        A role still held by someone can't be deleted either: give those people another role first.
      </p>
      {msg && <div className="mb-3"><Banner tone={msg.tone} action={<Button size="sm" variant="ghost" aria-label="Dismiss" onClick={() => setMsg(null)}><X aria-hidden className="size-4" /></Button>}>{msg.text}</Banner></div>}
      {canEdit && (
        <Card className="mb-4">
          <h2 className="label-caps mb-2 text-text-muted">Add a role</h2>
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1.4fr_1fr_auto]">
            <Field id="new-role-label" label="Name"><input id="new-role-label" className={inputClass} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. Field Engineer" /></Field>
            <Field id="new-role-desc" label="Description"><input id="new-role-desc" className={inputClass} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <Field id="new-role-copy" label="Start with the tabs of">
              <SearchSelect id="new-role-copy" value={f.copy_from} onChange={(v) => setF({ ...f, copy_from: v })} options={options} placeholder="No tabs" emptyLabel="No tabs" searchPlaceholder="Search roles…" />
            </Field>
            <Button variant="primary" loading={add.isPending} onClick={() => { setMsg(null); if (!f.label.trim()) { setMsg({ tone: 'danger', text: 'Name the role' }); return; } add.mutate(); }}><Plus aria-hidden className="size-4" />Add role</Button>
          </div>
        </Card>
      )}
      {roles.isPending ? <Skeleton className="h-64" /> : roles.isError ? <Banner tone="danger">{roles.error.message}</Banner> : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">SLK Operations Hub roles</caption>
            <thead className="bg-surface-2"><tr className="label-caps text-left text-text-muted">
              {['Role', 'Source', 'People', ''].map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}
            </tr></thead>
            <tbody>
              {roles.data.map((r) => {
                const editing = r.key in edit;
                const why = r.from_wireguard ? 'Comes from WIREGUARD' : r.users ? `${r.users} ${r.users === 1 ? 'person has' : 'people have'} it` : null;
                return (
                  <tr key={r.key} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      {editing ? (
                        <span className="flex items-center gap-2">
                          <input aria-label={`New name for ${r.label}`} className={cx(inputClass, 'w-56')} value={edit[r.key]} autoFocus onChange={(e) => setEdit({ ...edit, [r.key]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') rename.mutate(r); if (e.key === 'Escape') setEdit((c) => { const n = { ...c }; delete n[r.key]; return n; }); }} />
                          <Button size="sm" variant="primary" loading={rename.isPending} onClick={() => rename.mutate(r)}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEdit((c) => { const n = { ...c }; delete n[r.key]; return n; })}>Cancel</Button>
                        </span>
                      ) : (
                        <><span className="font-semibold">{r.label}</span><span className="ml-2 font-mono text-xs text-text-subtle">{r.key}</span>{r.description && <span className="block text-xs text-text-muted">{r.description}</span>}</>
                      )}
                    </th>
                    <td className="px-3 py-2 text-xs">
                      {r.from_wireguard ? <span className="label-caps rounded-xs border border-info px-1.5 text-info">WIREGUARD</span> : r.builtin ? <span className="text-text-muted">SLK Ops</span> : <span className="text-text-muted">Added here</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-text-muted">{r.active_users}{r.users > r.active_users ? ` (+${r.users - r.active_users} off)` : ''}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {canEdit && !editing && <Button size="sm" onClick={() => setEdit({ ...edit, [r.key]: r.label })}>Rename</Button>}
                      {canDelete && (
                        <Button size="sm" variant="ghost" className="ml-1" disabled={!!why || remove.isPending} aria-label={`Delete ${r.label}`} title={why ?? undefined}
                          onClick={async () => { if (await ask({ title: `Delete the ${r.label} role?`, body: 'Its tabs, attendance category and approvals go with it.', confirm: 'Delete role', danger: true })) remove.mutate(r); }}>
                          <Trash2 aria-hidden className="size-4" />
                        </Button>
                      )}
                      {why && canDelete && <span className="ml-1 text-xs text-text-subtle">{why}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const GROUPS: { key: RuleGroup; title: string; note: string }[] = [
  { key: 'Job', title: 'Job', note: 'Who fills each stage of a job, and who can be its SDM.' },
  { key: 'JRA', title: 'JRA approvals', note: 'Each approval level and MOC / exemption approver named on your JRA forms. The JRA is sent to someone holding one of these roles.' },
  { key: 'Closure checklist', title: 'Closure checklist', note: 'Who signs each item on the job’s Closure.' },
  { key: 'Job forms', title: 'Job forms', note: 'Who approves the checklists and the job package (Administration → Form templates). Each approval is stamped with its time and filed as a PDF.' },
  { key: 'Bonus', title: 'Bonus', note: 'Crew bonus distribution on Closure.' },
  { key: 'Attendance', title: 'Attendance', note: 'Who fills and who approves each attendance sheet.' },
];

/** Approvals: the roles allowed for every approval and checklist item. Admin is always allowed. */
function ApprovalsPanel() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const rules = useRules();
  const roles = useRoles();
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const canEdit = !!me?.menus.users?.edit;
  type RulesData = NonNullable<ReturnType<typeof useRules>['data']>;
  const set = useMutation({
    mutationFn: (v: { key: string; roles: string[] }) => api('/admin/rules', { method: 'PUT', json: v }),
    // the tick changes at once; a refused change is put back
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['rules'] });
      const before = qc.getQueryData<RulesData>(['rules']);
      if (before) qc.setQueryData<RulesData>(['rules'], { ...before, rules: { ...before.rules, [v.key]: v.roles } });
      return { before };
    },
    onSuccess: () => { setMsg(null); qc.invalidateQueries({ queryKey: ['rules'] }); qc.invalidateQueries({ queryKey: ['attendance'] }); },
    onError: (e: ApiError, _v, ctx) => { if (ctx?.before) qc.setQueryData(['rules'], ctx.before); setMsg({ tone: 'danger', text: e.message }); },
  });
  const reset = useMutation({
    mutationFn: (key: string) => api(`/admin/rules/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
    onError: (e: ApiError) => setMsg({ tone: 'danger', text: e.message }),
  });
  const options = (roles.data ?? []).filter((r) => r.key !== 'admin').map((r) => ({ value: r.key, label: r.label }));
  if (rules.isPending || roles.isPending) return <Skeleton className="h-96" />;
  if (rules.isError) return <Banner tone="danger">{rules.error.message}</Banner>;
  const s = q.trim().toLowerCase();
  const defs = rules.data.defs.filter((d) => !s || `${d.label} ${d.help ?? ''} ${(rules.data.rules[d.key] ?? []).map(roleLabel).join(' ')}`.toLowerCase().includes(s));
  return (
    <div className="max-w-5xl">
      <p className="mb-3 text-sm text-text-muted">
        Pick the roles for each approval and checklist item. Changes apply at once, on the server as well as on screen. Admin is always allowed.
        “Default” is what SLK Operations Hub did before; Reset puts it back.
      </p>
      <label className="relative mb-4 block w-80 max-w-full"><span className="sr-only">Search approvals</span>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-subtle" />
        <input className={cx(inputClass, 'pl-9')} placeholder="Search an approval or a role…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {msg && <div className="mb-3"><Banner tone={msg.tone}>{msg.text}</Banner></div>}
      <div className="flex flex-col gap-4">
        {GROUPS.map((g) => {
          const list = defs.filter((d) => d.group === g.key);
          if (!list.length) return null;
          return (
            <Card key={g.key} className="p-0!">
              <div className="border-b border-border px-4 py-3">
                <h2 className="font-display text-lg font-bold text-accent-text">{g.title}</h2>
                <p className="text-xs text-text-muted">{g.note}</p>
              </div>
              <ul className="divide-y divide-border">
                {list.map((d) => {
                  const value = rules.data.rules[d.key] ?? d.defaults;
                  return (
                    <li key={d.key} className="grid grid-cols-1 items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_22rem]">
                      <div className="min-w-0">
                        <p className="font-semibold">{d.label}</p>
                        {d.help && <p className="text-xs text-text-muted">{d.help}</p>}
                        <p className="mt-0.5 text-xs text-text-subtle">
                          {d.changed ? <>Changed{d.updated_by ? ` by ${d.updated_by}` : ''} · default: {d.defaults.map(roleLabel).join(', ') || 'Admin only'}</> : 'Default'}
                          {d.changed && canEdit && <button type="button" className="ml-2 underline hover:text-text" onClick={() => reset.mutate(d.key)}>Reset</button>}
                        </p>
                      </div>
                      <div>
                        {canEdit
                          ? <MultiSelect label="Roles" stacked emptyText="Admin only" options={options} value={value} onChange={(v) => set.mutate({ key: d.key, roles: v })} />
                          : <p className="text-sm">{value.map(roleLabel).join(', ') || 'Admin only'}</p>}
                        <p className="mt-1 text-xs text-text-muted">{value.length ? `Admin, ${value.map(roleLabel).join(', ')}` : 'Admin only'}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---- Competency users (6z.35) ----------------------------------------------------------------------------------------
// The Competency role is separate from the SLK Ops role: the SLK Ops role (and the Role permissions tab) opens the
// app's tabs; the Competency role decides what the person can see and do inside the Competency system. The rest is
// what the Competency employee register needs about them, copied into it whenever Competency opens.

interface CompetencyRow extends CompetencyProfile { name: string; email: string | null; country: string; active: number }
interface CompetencyUsersReply { roles: CompetencyRoleDef[]; profiles: CompetencyRow[] }
const useCompetencyUsers = () => useQuery({ queryKey: ['competency-users'], queryFn: () => api<CompetencyUsersReply>('/competency/users') });

function PersonCompetency({ username, name, onSaved }: { username: string; name: string; onSaved?: (msg: string) => void }) {
  const qc = useQueryClient();
  const q = useCompetencyUsers();
  const cur = q.data?.profiles.find((p) => p.username.toLowerCase() === username.toLowerCase());
  const blank = { role: 'Viewer', employee_id: '', position: '', grade: '', segment: 'SLK', location: '', hire_date: '', mentor: '', status: 'Active' };
  const [f, setF] = useState<typeof blank | null>(null);
  const v = f ?? (cur ? { role: cur.role, employee_id: cur.employee_id ?? '', position: cur.position ?? '', grade: cur.grade ? String(cur.grade) : '', segment: cur.segment, location: cur.location ?? '',
    hire_date: cur.hire_date ?? '', mentor: cur.mentor ?? '', status: cur.status } : blank);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const set = (k: keyof typeof blank, val: string) => { setMsg(null); setF({ ...v, [k]: val }); };
  const done = (text: string) => { setMsg({ tone: 'success', text }); setF(null); qc.invalidateQueries({ queryKey: ['competency-users'] }); onSaved?.(text); };
  const save = useMutation({
    mutationFn: () => api(`/competency/users/${encodeURIComponent(username)}`, { method: 'PUT', json: { ...v, grade: v.grade ? Number(v.grade) : null } }),
    onSuccess: () => done(`Competency profile saved for ${name}`),
    onError: (e: ApiError) => setMsg({ tone: 'danger', text: e.message }),
  });
  const isAdmin = useMe().data?.role === 'admin';
  const [deleting, setDeleting] = useState(false);
  if (q.isPending) return <Skeleton className="mb-5 h-40" />;
  if (q.isError) return <div className="mb-5"><Banner tone="danger">{q.error.message}</Banner></div>;
  const roles = q.data.roles;
  const edits = roles.find((r) => r.name === v.role)?.edit;
  const id = (k: string) => `comp-${k}-${username}`;
  return (
    <div className="mb-5 rounded-md border border-border border-l-4 border-l-accent-text p-3">
      <p className="label-caps mb-1 text-text-muted">Competency system {cur ? '' : '· not a user yet'}</p>
      <p className="mb-3 text-xs text-text-subtle">Separate from the SLK Ops role: that one opens the app’s tabs, this one decides what {name} can see and do in Competency. Copied into the Competency employee register when Competency opens.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={id('role')} label="Competency role" hint={edits ? 'Can change Competency data' : 'Reads only'}>
          <Select id={id('role')} className={inputClass} value={v.role} onChange={(e) => set('role', e.target.value)}>{roles.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}</Select>
        </Field>
        <Field id={id('emp')} label="Employee record" hint="Their ID in the Competency employee register">
          <input id={id('emp')} className={inputClass} value={v.employee_id} placeholder={username} onChange={(e) => set('employee_id', e.target.value)} />
        </Field>
        <Field id={id('pos')} label="Position">
          <Select id={id('pos')} className={inputClass} value={v.position} onChange={(e) => set('position', e.target.value)}><option value="">Not set</option>{COMPETENCY_POSITIONS.map((p) => <option key={p}>{p}</option>)}</Select>
        </Field>
        <Field id={id('grade')} label="Grade">
          <Select id={id('grade')} className={inputClass} value={v.grade} onChange={(e) => set('grade', e.target.value)}><option value="">Not set</option>{COMPETENCY_GRADES.map((g) => <option key={g} value={g}>G{g}</option>)}</Select>
        </Field>
        <Field id={id('seg')} label="Segment">
          <Select id={id('seg')} className={inputClass} value={v.segment} onChange={(e) => set('segment', e.target.value)}>{COMPETENCY_SEGMENTS.map((x) => <option key={x}>{x}</option>)}</Select>
        </Field>
        <Field id={id('loc')} label="Location"><input id={id('loc')} className={inputClass} value={v.location} placeholder="e.g. DMM" onChange={(e) => set('location', e.target.value)} /></Field>
        <Field id={id('hire')} label="Hire date"><input id={id('hire')} type="date" className={inputClass} value={v.hire_date} onChange={(e) => set('hire_date', e.target.value)} /></Field>
        <Field id={id('mentor')} label="Mentor" hint="Their employee record ID">
          <input id={id('mentor')} className={inputClass} value={v.mentor} list={id('mentors')} onChange={(e) => set('mentor', e.target.value)} />
          <datalist id={id('mentors')}>{q.data.profiles.filter((p) => p.username !== username).map((p) => <option key={p.username} value={p.employee_id || p.username}>{p.name}</option>)}</datalist>
        </Field>
        <Field id={id('status')} label="Status">
          <Select id={id('status')} className={inputClass} value={v.status} onChange={(e) => set('status', e.target.value)}>{COMPETENCY_STATUSES.map((x) => <option key={x}>{x}</option>)}</Select>
        </Field>
      </div>
      {msg && <div className="mt-2"><Banner tone={msg.tone}>{msg.text}</Banner></div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{cur ? 'Save Competency profile' : 'Make a Competency user'}</Button>
        {cur && isAdmin && !deleting && <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}><Trash2 aria-hidden className="size-4" />Delete Competency user</Button>}
      </div>
      {cur && isAdmin && deleting && <DeleteCompetencyUser username={username} name={name} onCancel={() => setDeleting(false)} onDeleted={() => { setDeleting(false); done(`${name} is no longer a Competency user`); }} />}
    </div>
  );
}

/** Delete a Competency user: admins only, confirmed with their own WIREGUARD password. Their Competency records stay. */
function DeleteCompetencyUser({ username, name, onCancel, onDeleted }: { username: string; name: string; onCancel: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const del = useMutation({
    mutationFn: () => api(`/competency/users/${encodeURIComponent(username)}`, { method: 'DELETE', json: { password } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['competency-users'] }); onDeleted(); },
    onError: (e: ApiError) => { setError(e.message); setPassword(''); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setError(null); del.mutate(); };
  const pid = `comp-del-password-${username}`;
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2 rounded-md border border-danger/40 bg-danger-subtle/40 p-3 text-sm" aria-label={`Delete ${name} from Competency`}>
      <p className="font-semibold">Delete {name} from Competency?</p>
      <p className="text-text-muted">Their Competency role and profile are removed. Their records in the Competency register stay, and so does their SLK Ops account.</p>
      <Field id={pid} label="Your WIREGUARD password" hint="To confirm it is you">
        <input id={pid} type="password" autoComplete="current-password" className={`${inputClass} max-w-xs`} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </Field>
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="danger" loading={del.isPending} disabled={!password}>Delete</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

/** Users & Roles › Competency users: everyone set up for the Competency system, and adding someone. */
function CompetencyUsers() {
  const q = useCompetencyUsers();
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api<UserRow[]>('/admin/users') });
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const isAdmin = useMe().data?.role === 'admin';
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <Banner tone="danger">{q.error.message}</Banner>;
  const listed = new Set(q.data.profiles.map((p) => p.username.toLowerCase()));
  const candidates = (users.data ?? []).filter((u) => u.active && !listed.has(u.username.toLowerCase()));
  const pick = candidates.find((u) => u.username === adding);
  return (
    <Card>
      <p className="mb-3 max-w-3xl text-sm text-text-muted">Who uses the Competency system and as what. Each is a SLK Ops user: their SLK Ops role opens the app, their Competency role here decides what they can do in Competency (the roles themselves are defined in Competency › Administration › Users &amp; Roles). Changes reach Competency the next time it opens.</p>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field id="comp-add" label="Add a person">
          <SearchSelect id="comp-add" className="w-72" value={adding} onChange={setAdding} searchPlaceholder="Search people…" placeholder="Pick a SLK Ops user"
            options={candidates.map((u) => ({ value: u.username, label: u.full_name, hint: u.username }))} />
        </Field>
      </div>
      <CompetencyExcel profiles={q.data.profiles} users={users.data ?? []} />
      {pick && <PersonCompetency username={pick.username} name={pick.full_name} onSaved={() => setAdding('')} />}
      {!q.data.profiles.length ? <EmptyState title="No Competency users yet">Add the first person above, or open someone under Users and fill in their Competency section.</EmptyState> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-sm">
            <thead><tr className="label-caps text-left text-text-muted">{['Name', 'Competency role', 'Position', 'Grade', 'Employee record', 'Status', ''].map((h) => <th key={h} scope="col" className="py-1 pr-3">{h}</th>)}</tr></thead>
            <tbody>
              {q.data.profiles.map((p) => (
                <tr key={p.username} className="border-t border-border align-top">
                  <td className="py-2 pr-3"><span className="font-semibold">{p.name}</span> <span className="font-mono text-xs text-text-subtle">{p.username}</span>{!p.active && <span className="ml-1 text-xs text-warning">SLK Ops access off</span>}</td>
                  <td className="py-2 pr-3">{p.role}{p.can_edit ? '' : <span className="ml-1 text-xs text-text-subtle">(reads)</span>}</td>
                  <td className="py-2 pr-3">{p.position ?? '—'}</td>
                  <td className="py-2 pr-3">{p.grade ? `G${p.grade}` : '—'}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{p.employee_id || p.username}</td>
                  <td className="py-2 pr-3">{p.status}</td>
                  <td className="whitespace-nowrap py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => { setDeleting(null); setOpen(open === p.username ? null : p.username); }}>{open === p.username ? 'Close' : 'Edit'}</Button>
                    {isAdmin && <Button size="sm" variant="ghost" aria-label={`Delete ${p.name} from Competency`} onClick={() => { setOpen(null); setNotice(null); setDeleting(deleting === p.username ? null : p.username); }}><Trash2 aria-hidden className="size-4" />Delete</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {deleting && <DeleteCompetencyUser key={deleting} username={deleting} name={q.data.profiles.find((p) => p.username === deleting)?.name ?? deleting} onCancel={() => setDeleting(null)}
            onDeleted={() => { setNotice(`${q.data.profiles.find((p) => p.username === deleting)?.name ?? deleting} is no longer a Competency user`); setDeleting(null); }} />}
          {notice && <div className="mt-3"><Banner tone="success">{notice}</Banner></div>}
          {open && <div className="mt-3"><PersonCompetency username={open} name={q.data.profiles.find((p) => p.username === open)?.name ?? open} /></div>}
        </div>
      )}
    </Card>
  );
}

/** Download and upload the Competency users as Excel (6z.36). Employee ID is the key: nobody is added twice. */
function CompetencyExcel({ profiles, users }: { profiles: CompetencyRow[]; users: UserRow[] }) {
  const qc = useQueryClient();
  const [plan, setPlan] = useState<(ImportReply & { rows: SheetProfileRow[]; file: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const download = () => {
    const set = new Set(profiles.map((p) => p.username.toLowerCase()));
    // the people set up first, then every other active SLK Ops user with the Competency columns left blank to fill in
    const rows: Cell[][] = [
      ...profiles.map((p) => [p.username, p.name, p.role, p.employee_id ?? '', p.position ?? '', p.grade ?? '', p.segment, p.location ?? '', p.hire_date ?? '', p.mentor ?? '', p.status]),
      ...users.filter((u) => u.active && !set.has(u.username.toLowerCase())).map((u) => [u.username, u.full_name, '', '', '', '', 'SLK', '', '', '', 'Active']),
    ];
    saveFile(`competency-users-${new Date().toISOString().slice(0, 10)}.xlsx`, workbook('Competency users', [...COMPETENCY_SHEET_HEADER], rows, COMPETENCY_SHEET_WIDTHS),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  const read = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setMsg(null); setPlan(null);
    try {
      const parsed = profileRowsFromSheet(await sheetRows(await file.arrayBuffer()));
      if ('error' in parsed) { setMsg({ tone: 'danger', text: parsed.error }); return; }
      const reply = await api<ImportReply>('/competency/users/import', { method: 'POST', json: { rows: parsed.rows } });
      setPlan({ ...reply, rows: parsed.rows, file: file.name });
    } catch (e) { setMsg({ tone: 'danger', text: e instanceof ApiError ? e.message : `That file could not be read as Excel (.xlsx): ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const r = await api<ImportReply>('/competency/users/import', { method: 'POST', json: { rows: plan.rows, apply: true } });
      setMsg({ tone: 'success', text: `${r.add.length} added and ${r.update.length} updated${r.skip.length ? `, ${r.skip.length} left out` : ''}. Competency picks them up the next time it opens.` });
      setPlan(null);
      qc.invalidateQueries({ queryKey: ['competency-users'] });
    } catch (e) { setMsg({ tone: 'danger', text: (e as ApiError).message }); }
    finally { setBusy(false); }
  };
  return (
    <div className="mb-4 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={download}><FileDown aria-hidden className="size-4" />Download Excel</Button>
        <label className={cx('inline-flex h-(--layout-control-sm) cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold hover:bg-surface-2', busy && 'pointer-events-none opacity-60')}>
          <FileUp aria-hidden className="size-4" />{busy && !plan ? 'Reading…' : 'Upload Excel'}
          <input type="file" accept=".xlsx" className="sr-only" disabled={busy} onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <p className="min-w-0 flex-1 basis-64 text-xs text-text-subtle">The download lists the people set up, then everyone else in SLK Ops with the Competency columns blank. Fill in or change rows and upload it: Employee ID (the SLK Ops username) is the key, so someone already set up is updated, never added twice.</p>
      </div>
      {msg && <div className="mt-2"><Banner tone={msg.tone}>{msg.text}</Banner></div>}
      {plan && (
        <div className="mt-3 rounded-md bg-surface-2 p-3 text-sm">
          <p className="font-semibold">{plan.file}: {plan.add.length} to add, {plan.update.length} to update{plan.skip.length ? `, ${plan.skip.length} left out` : ''}</p>
          {(plan.add.length > 0 || plan.update.length > 0) && (
            <p className="mt-1 text-xs text-text-muted">
              {plan.add.length > 0 && <>Add: {plan.add.map((a) => a.username).join(', ')}. </>}
              {plan.update.length > 0 && <>Update: {plan.update.map((a) => a.username).join(', ')}.</>}
            </p>
          )}
          {plan.skip.length > 0 && (
            <ul className="mt-2 max-h-48 list-disc overflow-y-auto pl-5 text-xs text-text-muted">
              {plan.skip.map((s) => <li key={`${s.row}-${s.id}`}>Row {s.row}{s.id ? ` (${s.id})` : ''}: {s.reason}</li>)}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" loading={busy} disabled={!plan.add.length && !plan.update.length} onClick={apply}>Apply {plan.add.length + plan.update.length} rows</Button>
            <Button size="sm" variant="ghost" onClick={() => setPlan(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
interface ImportReply { add: { row: number; username: string }[]; update: { row: number; username: string }[]; skip: { row: number; id: string; reason: string }[]; applied: boolean }
