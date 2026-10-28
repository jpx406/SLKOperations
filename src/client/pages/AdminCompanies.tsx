import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, formatDate } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, EmptyState, PageTitle, Skeleton, cx, inputSized } from '../components/ui';

// Administration → Companies (owner request 2026-10-28): the companies a job is run by, picked on Design and carried
// to the SLK Activity Dashboard's Activity sheet and Daily report. Add, rename, reorder, switch off or remove one; a
// company already on jobs can only be switched off.

interface Company { id: string; name: string; active: number; sort: number; updated_at: string; updated_by: string | null; jobs: number }

export function AdminCompanies() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['companies'], queryFn: () => api<Company[]>('/companies') });
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = !!me?.menus.companies?.edit;
  const canDelete = !!me?.menus.companies?.delete;
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null); setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['lookups'] });
    }
  };
  const list = q.data ?? [];
  const put = (c: Company, body: Partial<{ name: string; active: boolean; sort: number }>) => run(() => api(`/companies/${c.id}`, { method: 'PUT', json: body }));
  const swap = (i: number, j: number) => run(async () => {
    const [a, b] = [list[i], list[j]];
    await api(`/companies/${a.id}`, { method: 'PUT', json: { sort: b.sort === a.sort ? b.sort + (j > i ? 1 : -1) : b.sort } });
    await api(`/companies/${b.id}`, { method: 'PUT', json: { sort: a.sort } });
  });

  return (
    <section aria-labelledby="co-title">
      <PageTitle><span id="co-title">Companies</span></PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">The company that runs each job, picked on the job’s Design stage. It shows on the SLK Activity Dashboard (Activity sheet and Daily report). Renaming a company renames it on its jobs too; a company already on jobs can be switched off but not removed.</p>
      {err && <div className="mb-3"><Banner tone="danger">{err}</Banner></div>}
      {canEdit && (
        <form className="mb-4 flex max-w-xl gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) run(async () => { await api('/companies', { method: 'POST', json: { name } }); setName(''); }); }}>
          <label className="flex-1"><span className="sr-only">New company name</span>
            <input className={inputSized('')} placeholder="New company, e.g. NESR Bahrain" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}><Plus aria-hidden className="size-4" />Add</Button>
        </form>
      )}
      {q.isPending && <Skeleton className="h-40" />}
      {q.isError && <Banner tone="danger">{q.error.message}</Banner>}
      {q.data && !list.length && <EmptyState title="No companies yet">Add NESR, SAPESCO or any other company that runs jobs.</EmptyState>}
      {list.length > 0 && (
        <Card className="max-w-3xl overflow-x-auto p-0">
          <table className="w-full text-sm">
            <caption className="sr-only">Companies, in the order the job’s Design stage offers them</caption>
            <thead className="bg-surface-2"><tr className="text-left">{['Order', 'Company', 'Offered on jobs', 'Jobs', 'Last change', ''].map((h) => <th key={h} scope="col" className="label-caps px-3 py-2 text-text-muted">{h}</th>)}</tr></thead>
            <tbody>
              {list.map((c, i) => (
                <tr key={c.id} className={cx('border-t border-border', !c.active && 'text-text-muted')}>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <Button size="sm" variant="ghost" aria-label={`Move ${c.name} up`} disabled={!canEdit || i === 0 || busy} onClick={() => swap(i, i - 1)}><ArrowUp aria-hidden className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" aria-label={`Move ${c.name} down`} disabled={!canEdit || i === list.length - 1 || busy} onClick={() => swap(i, i + 1)}><ArrowDown aria-hidden className="size-3.5" /></Button>
                  </td>
                  <td className="px-3 py-1.5">
                    <input key={c.name} aria-label={`Name of ${c.name}`} disabled={!canEdit} defaultValue={c.name} maxLength={60} className={inputSized('h-8 w-56 font-semibold')}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) { if (!c.jobs || window.confirm(`Rename ${c.name} to ${v} on its ${c.jobs} job${c.jobs === 1 ? '' : 's'} too?`)) put(c, { name: v }); else e.target.value = c.name; } }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                  </td>
                  <td className="px-3 py-1.5">
                    <label className="inline-flex items-center gap-2"><input type="checkbox" className="size-4" checked={!!c.active} disabled={!canEdit || busy} onChange={(e) => put(c, { active: e.target.checked })} />{c.active ? 'Yes' : 'Switched off'}</label>
                  </td>
                  <td className="px-3 py-1.5 font-mono">{c.jobs}</td>
                  <td className="px-3 py-1.5 text-xs text-text-muted">{formatDate(c.updated_at.slice(0, 10))}{c.updated_by ? ` · ${c.updated_by}` : ''}</td>
                  <td className="px-3 py-1.5 text-right">
                    {canDelete && <Button size="sm" variant="ghost" aria-label={`Remove ${c.name}`} disabled={busy || c.jobs > 0} title={c.jobs ? 'On jobs: switch it off instead' : 'Remove'}
                      onClick={() => { if (window.confirm(`Remove ${c.name}? The audit trail keeps a record.`)) run(() => api(`/companies/${c.id}`, { method: 'DELETE' })); }}><Trash2 aria-hidden className="size-4" /></Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}
