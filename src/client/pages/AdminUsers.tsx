import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { NAV } from '../../shared/menus';
import { ROLE_LABEL } from '../../shared/roles';
import type { Role, WgStatus } from '../../shared/types';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass } from '../components/ui';

interface UserRow {
  username: string; full_name: string; role: Role; wg_role: string | null; countries: string[];
  active: number; last_login_at: string | null; updated_by: string | null; updated_at: string;
  grants: { menu_key: string; can_edit: number }[];
}
interface Matrix { roles: Role[]; menus: string[]; rows: { role: Role; menu_key: string; can_view: number; can_edit: number; can_delete: number }[] }
interface AuditRow { occurred_at: string; username: string; action: string; entity_type: string; entity_id: string; summary: string }

const ROLES = Object.keys(ROLE_LABEL) as Role[];
const MENU_LABEL: Record<string, string> = Object.fromEntries(NAV.flatMap((g) => g.pages.map((p) => [p.key, p.label])));
MENU_LABEL.audit = 'Audit trail';
MENU_LABEL.ai_assistant = 'AI assistant';
const menuLabel = (k: string) => MENU_LABEL[k] ?? k;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');

export function AdminUsers() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'people';
  const tabs = [['people', 'People'], ['matrix', 'Role permissions'], ['sync', 'WIREGUARD sync'], ['history', 'Recent changes']] as const;
  return (
    <section aria-labelledby="admin-title">
      <PageTitle><span id="admin-title">Users &amp; roles</span></PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">
        Accounts and passwords live in WIREGUARD. Here you decide what each person can do in SLK Operations.
        Someone signing in for the first time gets a role based on their WIREGUARD role, which you can change.
      </p>
      <div role="tablist" aria-label="Users and roles" className="mb-4 flex flex-wrap gap-2">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k }, { replace: true })}
            className={cx('h-8 rounded-pill border px-3.5 text-sm font-semibold', tab === k ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>
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
  const [editing, setEditing] = useState<UserRow | null>(null);
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
    return (users.data ?? []).filter((u) => !s || `${u.username} ${u.full_name} ${ROLE_LABEL[u.role]}`.toLowerCase().includes(s));
  }, [users.data, q]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative block w-72 max-w-full">
          <span className="sr-only">Search people</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-subtle" />
          <input className={`${inputClass} pl-8`} placeholder="Name, NESR number or role" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Button variant="primary" onClick={() => setAdding(true)}><Plus aria-hidden className="size-4" />Add person</Button>
      </div>
      {notice && <div className="mb-3"><Banner tone={notice.tone} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)} aria-label="Dismiss"><X aria-hidden className="size-4" /></Button>}>{notice.text}</Banner></div>}
      {adding && <AddPerson onDone={(msg) => { setAdding(false); if (msg) setNotice({ tone: 'success', text: msg }); }} />}
      {users.isPending && <Skeleton className="h-64" />}
      {users.isError && <Banner tone="danger">{users.error.message}</Banner>}
      {users.data && shown.length === 0 && <EmptyState title={q ? 'Nobody matches' : 'Nobody has signed in yet'}>{q ? 'Try another name or number.' : 'People appear here after their first sign-in, or when you add them.'}</EmptyState>}
      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[56rem] text-sm">
            <caption className="sr-only">People with access to SLK Operations</caption>
            <thead className="bg-surface-2">
              <tr className="label-caps text-left text-text-muted">
                <th scope="col" className="px-3 py-2">Person</th>
                <th scope="col" className="px-3 py-2">SLK Ops role</th>
                <th scope="col" className="px-3 py-2">WIREGUARD role</th>
                <th scope="col" className="px-3 py-2">Countries</th>
                <th scope="col" className="px-3 py-2">Extra tabs</th>
                <th scope="col" className="px-3 py-2">Last sign-in</th>
                <th scope="col" className="px-3 py-2">Access</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const self = u.username.toLowerCase() === me?.username.toLowerCase();
                return (
                  <tr key={u.username} className={cx('border-t border-border', !u.active && 'text-text-subtle')}>
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <div className="font-semibold">{u.full_name}{self && <span className="ml-2 text-xs text-text-subtle">(you)</span>}</div>
                      <div className="font-mono text-xs text-text-subtle">{u.username}</div>
                    </th>
                    <td className="px-3 py-2">
                      <label className="sr-only" htmlFor={`role-${u.username}`}>Role for {u.full_name}</label>
                      <select id={`role-${u.username}`} className={`${inputClass} h-8 w-44`} value={u.role} disabled={self || update.isPending}
                        title={self ? 'You cannot change your own role' : undefined}
                        onChange={(e) => update.mutate({ username: u.username, patch: { role: e.target.value as Role } })}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-text-muted">{u.wg_role ?? <span className="text-text-subtle">not signed in yet</span>}</td>
                    <td className="px-3 py-2 text-text-muted">{u.countries.join(', ') || '—'}</td>
                    <td className="px-3 py-2">
                      <button className="text-left text-sm underline decoration-border-strong underline-offset-2 hover:decoration-text" onClick={() => setEditing(u)}>
                        {u.grants.length ? u.grants.map((g) => menuLabel(g.menu_key) + (g.can_edit ? ' (edit)' : '')).join(', ') : 'None — add'}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-text-muted">{when(u.last_login_at)}</td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-2">
                        <input type="checkbox" checked={!!u.active} disabled={self || update.isPending}
                          onChange={(e) => update.mutate({ username: u.username, patch: { active: e.target.checked } })} />
                        <span>{u.active ? 'On' : 'Off'}</span>
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <GrantsEditor user={editing} onClose={(msg) => { setEditing(null); if (msg) setNotice({ tone: 'success', text: msg }); }} />}
    </>
  );
}

function AddPerson({ onDone }: { onDone: (msg?: string) => void }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api('/admin/users', { method: 'POST', json: { username, full_name: name, role } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); onDone(`Added ${username.toUpperCase()}. They get this role at their first sign-in.`); },
    onError: (e: ApiError) => setError(e.message),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setError(null); add.mutate(); };
  return (
    <Card className="mb-4">
      <form onSubmit={submit} className="grid grid-cols-1 items-end gap-4 md:grid-cols-[1fr_1fr_14rem_auto]" aria-label="Add a person">
        <Field id="new-username" label="WIREGUARD username" hint="NESR- and the employee number">
          <input id="new-username" className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="NESR-12345" autoFocus />
        </Field>
        <Field id="new-name" label="Name"><input id="new-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field id="new-role" label="Role">
          <select id="new-role" className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={add.isPending} disabled={!username || !name}>Add</Button>
          <Button variant="ghost" onClick={() => onDone()}>Cancel</Button>
        </div>
        {error && <div className="md:col-span-4"><Banner tone="danger">{error}</Banner></div>}
      </form>
    </Card>
  );
}

function GrantsEditor({ user, onClose }: { user: UserRow; onClose: (msg?: string) => void }) {
  const qc = useQueryClient();
  const menus = Object.keys(MENU_LABEL).filter((k) => k !== 'users');
  const [sel, setSel] = useState<Record<string, 'none' | 'view' | 'edit'>>(() =>
    Object.fromEntries(menus.map((m) => {
      const g = user.grants.find((x) => x.menu_key === m);
      return [m, g ? (g.can_edit ? 'edit' : 'view') : 'none'];
    })));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api(`/admin/users/${encodeURIComponent(user.username)}/grants`, {
      method: 'PUT',
      json: { grants: Object.entries(sel).filter(([, v]) => v !== 'none').map(([menu_key, v]) => ({ menu_key, can_edit: v === 'edit' })) },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); onClose(`Extra tabs saved for ${user.full_name}`); },
    onError: (e: ApiError) => setError(e.message),
  });
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="grants-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-pop">
        <h2 id="grants-title" className="font-display text-lg font-bold">Extra tabs for {user.full_name}</h2>
        <p className="mt-1 mb-4 text-sm text-text-muted">These add to what the {ROLE_LABEL[user.role]} role already allows. They never take rights away.</p>
        {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
        <table className="w-full text-sm">
          <caption className="sr-only">Extra access per tab</caption>
          <thead><tr className="label-caps text-left text-text-muted"><th scope="col" className="py-1">Tab</th><th scope="col">None</th><th scope="col">View</th><th scope="col">Edit</th></tr></thead>
          <tbody>
            {menus.map((m) => (
              <tr key={m} className="border-t border-border">
                <th scope="row" className="py-1.5 text-left font-normal">{menuLabel(m)}</th>
                {(['none', 'view', 'edit'] as const).map((v) => (
                  <td key={v}>
                    <input type="radio" name={`g-${m}`} aria-label={`${menuLabel(m)}: ${v}`} checked={sel[m] === v} onChange={() => setSel((s) => ({ ...s, [m]: v }))} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onClose()}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()} autoFocus>Save</Button>
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
