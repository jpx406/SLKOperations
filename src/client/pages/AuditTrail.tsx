import { useInfiniteQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, LogIn, Search, ShieldAlert, Users, Activity, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AUDIT_AREAS, actionLabel, isWarning, type AuditArea } from '../../shared/audit';
import { workbook } from '../../shared/xlsx';
import { api } from '../api';
import { saveFile } from '../components/charts';
import { Select } from '../components/Select';
import { Banner, Button, EmptyState, PageTitle, Skeleton, cx, inputSized } from '../components/ui';

// Administration → Audit trail (owner request 2026-10-28): every change made in SLK Operations Hub and every sign-in
// event (signed in, failed, signed out, timed out, refused), newest first, filtered by dates, person, area, action
// and text, and exported. Filters live in the address, so a view can be bookmarked or shared.

type Row = {
  id: string; occurred_at: string; username: string | null; full_name: string | null; action: string; entity_type: string; entity_id: string | null;
  summary: string | null; ip: string | null; user_agent: string | null; ticket_no: string | null; area: AuditArea;
};
type Page = {
  rows: Row[]; next: string | null;
  facets: { users: { k: string; label: string; n: number }[]; actions: { k: string; n: number }[]; areas: Record<string, number> };
  stats: { total: number; logins: number; failed: number; changes: number; people: number };
};

const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
const ago = (n: number) => day(new Date(Date.now() - n * 86_400_000));
const RANGES: [string, string, () => [string, string]][] = [
  ['today', 'Today', () => [ago(0), ago(0)]], ['7d', '7 days', () => [ago(6), ago(0)]], ['30d', '30 days', () => [ago(29), ago(0)]], ['90d', '90 days', () => [ago(89), ago(0)]],
];
const stamp = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
/** A short name for the browser, from its user agent. */
const browser = (ua: string | null) => {
  if (!ua) return null;
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return [b, os].filter(Boolean).join(' on ');
};

export function AuditTrail() {
  const [params, setParams] = useSearchParams();
  const range = params.get('range') ?? (params.get('from') ? 'custom' : '7d');
  const [from, to] = range === 'custom' ? [params.get('from') ?? ago(6), params.get('to') ?? ago(0)] : (RANGES.find((r) => r[0] === range) ?? RANGES[1])[2]();
  const users = params.getAll('user'), areas = params.getAll('area'), actions = params.getAll('action');
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDeferredValue(text.trim());
  const set = (k: string, v: string[] | string | null) => {
    const n = new URLSearchParams(params);
    n.delete(k);
    for (const x of Array.isArray(v) ? v : v ? [v] : []) n.append(k, x);
    setParams(n, { replace: true });
  };
  const query = new URLSearchParams([['from', from], ['to', to], ...users.map((u) => ['user', u]), ...areas.map((a) => ['area', a]), ...actions.map((a) => ['action', a]), ...(q ? [['q', q]] : [])]).toString();
  const list = useInfiniteQuery({
    queryKey: ['audit', query],
    queryFn: ({ pageParam }) => api<Page>(`/audit?${query}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '' as string, getNextPageParam: (p) => p.next ?? undefined,
  });
  const first = list.data?.pages[0];
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];
  const filtered = users.length + areas.length + actions.length > 0 || !!q;
  const [exporting, setExporting] = useState(false);
  const exportAll = async (kind: 'xlsx' | 'csv') => {
    setExporting(true);
    try {
      const all = (await api<Page>(`/audit?${query}&limit=5000`)).rows;
      const header = ['When (Riyadh)', 'User', 'Username', 'Area', 'Action', 'Record', 'Details', 'IP address', 'Browser'];
      const data = all.map((r) => [stamp(r.occurred_at), r.full_name ?? '', r.username ?? '', AUDIT_AREAS[r.area].label, actionLabel(r.action), r.ticket_no ?? r.entity_id ?? '', r.summary ?? '', r.ip ?? '', browser(r.user_agent) ?? '']);
      const name = `slkops-audit-${from}-to-${to}`;
      if (kind === 'xlsx') saveFile(`${name}.xlsx`, workbook('Audit trail', header, data, [20, 22, 14, 16, 16, 16, 70, 16, 20]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      else saveFile(`${name}.csv`, new TextEncoder().encode([header, ...data].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n')), 'text/csv;charset=utf-8');
    } finally { setExporting(false); }
  };

  return (
    <section aria-labelledby="audit-title">
      <PageTitle aside={
        <>
          <Button variant="primary" loading={exporting} disabled={!rows.length} onClick={() => exportAll('xlsx')}><FileSpreadsheet aria-hidden className="size-4" />XLSX</Button>
          <Button disabled={!rows.length || exporting} onClick={() => exportAll('csv')}><Download aria-hidden className="size-4" />CSV</Button>
        </>
      }><span id="audit-title">Audit trail</span></PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">Every change made in SLK Operations Hub and every sign-in, newest first. Times are Riyadh time. Exports hold up to 5,000 entries of the current filters.</p>

      {first && (
        <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {([
            [Activity, 'Entries', first.stats.total, null],
            [LogIn, 'Sign-ins', first.stats.logins, () => set('action', ['login'])],
            [ShieldAlert, 'Failed sign-ins', first.stats.failed, () => set('action', ['login_failed'])],
            [Users, 'People', first.stats.people, null],
          ] as const).map(([Icon, label, n, go]) => (
            <div key={label} className={cx('rounded-lg border border-card-edge bg-surface p-3', label === 'Failed sign-ins' && n > 0 && 'border-danger/60')}>
              <dt className="label-caps flex items-center gap-1.5 text-text-muted"><Icon aria-hidden className="size-3.5" />{label}</dt>
              <dd className="mt-1 flex items-baseline gap-2 font-display text-kpi leading-none font-bold">{(n ?? 0).toLocaleString()}
                {go && n > 0 && <button type="button" className="font-sans text-xs font-semibold text-accent-text hover:underline" onClick={go}>Show</button>}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mb-4 space-y-2 rounded-lg border border-card-edge bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Dates" className="flex flex-wrap gap-1.5">
            {[...RANGES.map(([k, l]) => [k, l]), ['custom', 'Dates…']].map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={range === k} onClick={() => { const n = new URLSearchParams(params); n.set('range', k); if (k !== 'custom') { n.delete('from'); n.delete('to'); } else { n.set('from', from); n.set('to', to); } setParams(n, { replace: true }); }}
                className={cx('h-(--layout-control-sm) rounded-pill border px-3 text-sm font-semibold', range === k ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>{l}</button>
            ))}
          </div>
          {range === 'custom' && (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <input type="date" aria-label="From" className={inputSized('h-(--layout-control-sm) w-40')} value={from} max={to} onChange={(e) => set('from', e.target.value)} />
              <span className="text-text-muted">to</span>
              <input type="date" aria-label="To" className={inputSized('h-(--layout-control-sm) w-40')} value={to} min={from} onChange={(e) => set('to', e.target.value)} />
            </span>
          )}
          <label className="relative ml-auto block">
            <span className="sr-only">Search the trail</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-subtle" />
            <input className={inputSized('w-72 pl-9')} placeholder="Ticket, name, what changed…" value={text} onChange={(e) => { setText(e.target.value); set('q', e.target.value.trim() || null); }} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2" role="group" aria-label="Area">
          <span className="label-caps mr-1 text-text-muted">Area</span>
          {(Object.keys(AUDIT_AREAS) as AuditArea[]).filter((a) => first?.facets.areas[a] || areas.includes(a)).map((a) => {
            const on = areas.includes(a);
            return (
              <button key={a} type="button" aria-pressed={on} onClick={() => set('area', on ? areas.filter((x) => x !== a) : [...areas, a])}
                className={cx('inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-pill border px-3 text-sm font-semibold', on ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>
                {AUDIT_AREAS[a].label}<span className="font-mono text-xs font-medium opacity-80">{first?.facets.areas[a] ?? 0}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <label className="inline-flex items-center gap-2 text-sm"><span className="text-text-muted">Person</span>
            <Select search className={inputSized('w-64')} value={users[0] ?? ''} onChange={(e) => set('user', e.target.value || null)}>
              <option value="">Everyone</option>
              {(first?.facets.users ?? []).map((u) => <option key={u.k} value={u.k}>{u.label} · {u.k} ({u.n})</option>)}
            </Select>
          </label>
          <label className="inline-flex items-center gap-2 text-sm"><span className="text-text-muted">Action</span>
            <Select search className={inputSized('w-56')} value={actions[0] ?? ''} onChange={(e) => set('action', e.target.value || null)}>
              <option value="">All actions</option>
              {(first?.facets.actions ?? []).map((a) => <option key={a.k} value={a.k}>{actionLabel(a.k)} ({a.n})</option>)}
            </Select>
          </label>
          {filtered && <Button size="sm" variant="ghost" onClick={() => { setText(''); const n = new URLSearchParams(); n.set('range', range); if (range === 'custom') { n.set('from', from); n.set('to', to); } setParams(n, { replace: true }); }}><X aria-hidden className="size-3.5" />Clear filters</Button>}
          <span className="ml-auto font-mono text-xs text-text-muted">{rows.length.toLocaleString()} shown{list.hasNextPage ? ' · more below' : ''}</span>
        </div>
      </div>

      {list.isPending && <Skeleton className="h-96" />}
      {list.isError && <Banner tone="danger">{list.error.message}</Banner>}
      {list.data && !rows.length && <EmptyState title="Nothing in the trail for these filters">Try a longer date range, or clear the filters.</EmptyState>}
      {rows.length > 0 && (
        <div className="overflow-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-sm">
            <caption className="sr-only">Audit trail, newest first</caption>
            <thead className="sticky top-0 z-10 bg-surface-2">
              <tr>{['When', 'Who', 'Area', 'Action', 'Record', 'Details'].map((h) => <th key={h} scope="col" className="label-caps border-b border-border px-3 py-2.5 text-left text-text-muted">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-surface-2">
                  <td className="border-b border-border px-3 py-2 font-mono text-xs whitespace-nowrap text-text-muted">{stamp(r.occurred_at)}</td>
                  <td className="border-b border-border px-3 py-2">
                    <button type="button" className="text-left font-semibold hover:underline" title="Show only this person" onClick={() => r.username && set('user', r.username)}>{r.full_name ?? r.username ?? '—'}</button>
                    {r.full_name && r.username && r.full_name !== r.username && <span className="block font-mono text-xs text-text-subtle">{r.username}</span>}
                  </td>
                  <td className="border-b border-border px-3 py-2 whitespace-nowrap text-text-muted">{AUDIT_AREAS[r.area].label}</td>
                  <td className="border-b border-border px-3 py-2 whitespace-nowrap">
                    <span className={cx('label-caps rounded-pill px-2 py-0.5', isWarning(r.action) ? 'bg-danger-subtle text-danger' : r.action === 'login' ? 'bg-success-subtle text-success' : 'bg-neutral-subtle text-text-muted')}>{actionLabel(r.action)}</span>
                  </td>
                  <td className="border-b border-border px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {r.entity_type === 'job' && r.entity_id ? <Link className="font-semibold text-accent-text hover:underline" to={`/operation/jobs/${r.entity_id}/design`}>{r.ticket_no ?? 'job'}</Link>
                      : r.entity_type === 'auth' ? null : <span className="text-text-subtle" title={r.entity_id ?? undefined}>{r.entity_type.replace(/_/g, ' ')}</span>}
                  </td>
                  <td className="border-b border-border px-3 py-2">
                    <span className="break-words">{r.summary ?? ''}</span>
                    {(r.ip || r.user_agent) && <span className="block text-xs text-text-subtle">{[r.ip && `IP ${r.ip}`, browser(r.user_agent)].filter(Boolean).join(' · ')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.hasNextPage && <div className="mt-3 flex justify-center"><Button loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Load older entries</Button></div>}
    </section>
  );
}
