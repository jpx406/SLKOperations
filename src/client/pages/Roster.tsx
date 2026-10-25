import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass, inputSized } from '../components/ui';

// Headcount Roster (S44): the people list behind Attendance and job crews, and the SLK Contacts list
// that opens Pre-Job Notes (Administrator Manual 6 and 8.2).

interface Person {
  id: string; country: string; eid: string; full_name: string; title: string; account: string; crew_role: string | null; reports_to_id: string | null;
  reports_to_name: string | null; rotation: string; wg_username: string | null; is_slk_contact: number; contact_email: string | null; contact_mobile: string | null;
  active: number; jobs: number;
}
const CREW_ROLE: Record<string, string> = {
  slickline_supervisor: 'Slickline supervisor', slickline_operator: 'Slickline operator', assistant_operator: 'Assistant operator', helper: 'Helper', trainee: 'Trainee', other: 'Other',
};

export function Roster() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'contacts' ? 'contacts' : 'people';
  const { data: me } = useMe();
  const rights = { edit: !!me?.menus.headcount_roster?.edit, remove: !!me?.menus.headcount_roster?.delete };
  const list = useQuery({ queryKey: ['roster'], queryFn: () => api<Person[]>('/roster') });
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Person | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rows = (list.data ?? []).filter((p) => (tab === 'people' || p.is_slk_contact) && (!q || `${p.full_name} ${p.eid} ${p.title}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <section aria-labelledby="roster-title">
      <PageTitle aside={rights.edit && <Button variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Add person</Button>}><span id="roster-title">Headcount roster</span></PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">One list for attendance, job crews and the SLK Contacts list. A change here shows in Attendance and the crew pickers straight away.
        SLK contacts can open Pre-Job Notes; they need their WIREGUARD username so the access follows their sign-in.</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Roster views" className="flex gap-1.5">
          {[['people', 'All people'], ['contacts', 'SLK contacts']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams(k === 'people' ? {} : { tab: k }, { replace: true })}
              className={cx('h-8 rounded-pill border px-3.5 text-sm font-semibold', tab === k ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>{l}</button>
          ))}
        </div>
        <label className="relative ml-auto"><span className="sr-only">Search name, EID or title</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle" />
          <input className={inputSized('h-8 w-56 pl-8')} placeholder="Name, EID, title" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {notice && <div className="mb-3"><Banner tone="success">{notice}</Banner></div>}
      {list.isPending && <Skeleton className="h-64" />}
      {list.isError && <Banner tone="danger">{list.error.message}</Banner>}
      {list.data && !rows.length && <EmptyState title={tab === 'contacts' ? 'No SLK contacts yet' : 'Nobody on the roster yet'}>{tab === 'contacts' ? 'Open a person and tick “SLK contact”.' : 'Add the people who work in your countries.'}</EmptyState>}
      {rows.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-surface-2"><tr className="text-left text-xs text-text-muted">
              {(tab === 'contacts' ? ['Name', 'EID', 'Title', 'WIREGUARD user', 'Email', 'Mobile', ''] : ['Name', 'EID', 'Title', 'Account', 'Crew role', 'Reports to', 'Rotation', 'Jobs', 'Status', '']).map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={cx('border-t border-border', !p.active && 'text-text-subtle')}>
                  <th scope="row" className="px-3 py-2 text-left font-semibold">{p.full_name}{p.is_slk_contact && tab === 'people' ? <span className="ml-2 text-xs font-normal text-info">SLK contact</span> : null}<span className="block text-xs font-normal text-text-subtle">{p.country}</span></th>
                  <td className="px-3 py-2 font-mono text-xs">{p.eid}</td>
                  <td className="px-3 py-2">{p.title}</td>
                  {tab === 'contacts' ? (
                    <><td className="px-3 py-2 font-mono text-xs">{p.wg_username ?? '—'}</td><td className="px-3 py-2">{p.contact_email ?? '—'}</td><td className="px-3 py-2 font-mono text-xs">{p.contact_mobile ?? '—'}</td></>
                  ) : (
                    <>
                      <td className="px-3 py-2">{p.account}</td><td className="px-3 py-2">{p.crew_role ? CREW_ROLE[p.crew_role] : '—'}</td>
                      <td className="px-3 py-2">{p.reports_to_name ?? '—'}</td><td className="px-3 py-2 font-mono text-xs">{p.rotation}</td>
                      <td className="px-3 py-2 font-mono text-xs">{p.jobs}</td><td className="px-3 py-2 text-xs">{p.active ? 'Active' : 'Switched off'}</td>
                    </>
                  )}
                  <td className="px-3 py-2 text-right">{rights.edit && <Button size="sm" onClick={() => setEditing(p)} aria-label={`Edit ${p.full_name}`}><Pencil aria-hidden className="size-3.5" />Edit</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {editing && <PersonDialog row={editing === 'new' ? null : editing} people={list.data ?? []} canRemove={rights.remove}
        onClose={(msg) => { setEditing(null); setNotice(msg ?? null); }} contact={tab === 'contacts'} />}
    </section>
  );
}

function PersonDialog({ row, people, canRemove, onClose, contact }: { row: Person | null; people: Person[]; canRemove: boolean; onClose: (msg?: string) => void; contact: boolean }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [f, setF] = useState({
    country: row?.country ?? me?.countries[0] ?? '', eid: row?.eid ?? '', full_name: row?.full_name ?? '', title: row?.title ?? '', account: row?.account ?? 'SLK',
    crew_role: row?.crew_role ?? '', reports_to_id: row?.reports_to_id ?? '', rotation: row?.rotation ?? '60/30', wg_username: row?.wg_username ?? '',
    is_slk_contact: row ? !!row.is_slk_contact : contact, contact_email: row?.contact_email ?? '', contact_mobile: row?.contact_mobile ?? '', active: row ? !!row.active : true,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((c) => ({ ...c, [k]: v }));
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ['roster'] }); qc.invalidateQueries({ queryKey: ['employees'] }); qc.invalidateQueries({ queryKey: ['attendance'] }); onClose(msg); };
  const save = useMutation({
    mutationFn: () => { const { country, ...rest } = f; return row ? api(`/roster/${row.id}`, { method: 'PATCH', json: rest }) : api('/roster', { method: 'POST', json: { country, ...rest } }); },
    onSuccess: () => done(`Saved ${f.full_name}`), onError: (e: ApiError) => setError(e.message),
  });
  const remove = useMutation({ mutationFn: () => api(`/roster/${row!.id}`, { method: 'DELETE' }), onSuccess: () => done(`Removed ${f.full_name}`), onError: (e: ApiError) => { setError(e.message); setConfirm(false); } });
  const managers = people.filter((p) => p.id !== row?.id && p.active && p.country === f.country);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="person-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <form className="max-h-full w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-pop" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="mb-3 flex items-start gap-3"><h2 id="person-title" className="flex-1 font-display text-lg font-bold">{row ? `Edit ${row.full_name}` : 'Add a person'}</h2>
          <Button size="sm" variant="ghost" aria-label="Close" onClick={() => onClose()}><X aria-hidden className="size-4" /></Button></div>
        {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {!row && (me?.countries.length ?? 0) > 1 && <Field id="p-country" label="Country"><select id="p-country" className={inputClass} value={f.country} onChange={(e) => set('country', e.target.value)}>{me?.countries.map((c) => <option key={c}>{c}</option>)}</select></Field>}
          <Field id="p-eid" label="EID" required><input id="p-eid" className={inputClass} value={f.eid} onChange={(e) => set('eid', e.target.value)} /></Field>
          <Field id="p-name" label="Full name" required><input id="p-name" className={inputClass} value={f.full_name} onChange={(e) => set('full_name', e.target.value)} /></Field>
          <Field id="p-title" label="Job title" required><input id="p-title" className={inputClass} value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
          <Field id="p-account" label="Account"><input id="p-account" className={inputClass} value={f.account} onChange={(e) => set('account', e.target.value)} /></Field>
          <Field id="p-role" label="Crew role" hint="Puts the person first in that crew picker"><select id="p-role" className={inputClass} value={f.crew_role} onChange={(e) => set('crew_role', e.target.value)}><option value="">Not on crews</option>{Object.entries(CREW_ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field id="p-reports" label="Reports to" hint="Groups the attendance sheet"><select id="p-reports" className={inputClass} value={f.reports_to_id} onChange={(e) => set('reports_to_id', e.target.value)}><option value="">Nobody</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select></Field>
          <Field id="p-rot" label="Rotation"><select id="p-rot" className={inputClass} value={f.rotation} onChange={(e) => set('rotation', e.target.value)}>{['60/30', '28/28', '42/21', '35/35', '5/2'].map((r) => <option key={r}>{r}</option>)}</select></Field>
          <Field id="p-wg" label="WIREGUARD username" hint="Links attendance and contact access to their sign-in"><input id="p-wg" className={inputClass} placeholder="NESR-12345" value={f.wg_username} onChange={(e) => set('wg_username', e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.is_slk_contact} onChange={(e) => set('is_slk_contact', e.target.checked)} />SLK contact (opens Pre-Job Notes and appears in its contact lists)</label>
          {f.is_slk_contact && (
            <>
              <Field id="p-email" label="Contact email"><input id="p-email" type="email" className={inputClass} value={f.contact_email} onChange={(e) => set('contact_email', e.target.value)} /></Field>
              <Field id="p-mobile" label="Contact mobile"><input id="p-mobile" className={inputClass} value={f.contact_mobile} onChange={(e) => set('contact_mobile', e.target.value)} /></Field>
            </>
          )}
          {row && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />Active (on the attendance sheet and crew pickers)</label>}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" loading={save.isPending}>Save</Button><Button onClick={() => onClose()}>Cancel</Button>
          {row && canRemove && !row.jobs && (confirm
            ? <Button variant="danger" className="ml-auto" loading={remove.isPending} onClick={() => remove.mutate()}>Confirm remove</Button>
            : <Button variant="danger" className="ml-auto" onClick={() => setConfirm(true)}>Remove</Button>)}
        </div>
        {row && row.jobs > 0 && <p className="mt-2 text-xs text-text-subtle">On {row.jobs} job crew{row.jobs === 1 ? '' : 's'}, so they can be switched off but not removed.</p>}
      </form>
    </div>
  );
}
