import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Palette, X } from 'lucide-react';
import { useState } from 'react';
import { ACCOUNT_PALETTE, NO_ACCOUNT } from '../../shared/accounts';
import { api } from '../api';
import { useMe } from '../auth';
import { useFilters } from './FilterBar';
import { Button, cx } from './ui';

// The account colours and the legend shown on top of the schedule, the job board and the job log. The legend is
// also the quickest account filter: click an account to show only its jobs, click again (or All) to clear.

export function useAccountColors() {
  const q = useQuery({ queryKey: ['account-colors'], queryFn: () => api<{ account: string; color: string }[]>('/account-colors'), staleTime: 5 * 60_000 });
  const map = new Map((q.data ?? []).map((r) => [r.account, r.color]));
  return (account: string | null | undefined) => (account ? map.get(account.trim()) : undefined);
}

export function AccountLegend({ counts, noun = 'jobs' }: { counts: Map<string, number>; noun?: string }) {
  const colorOf = useAccountColors();
  const [filters, setFilter] = useFilters();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const picked = filters.account ?? [];
  const names = [...new Set([...counts.keys(), ...picked])].sort((a, b) => (a === NO_ACCOUNT ? 1 : b === NO_ACCOUNT ? -1 : a.localeCompare(b)));
  if (!names.length) return null;
  const toggle = (a: string) => setFilter('account', picked.includes(a) ? picked.filter((x) => x !== a) : [...picked, a]);
  const canColor = !!me?.menus.database?.edit;
  const recolor = async (account: string, color: string) => {
    await api(`/account-colors/${encodeURIComponent(account)}`, { method: 'PUT', json: { color } });
    qc.invalidateQueries({ queryKey: ['account-colors'] });
  };
  return (
    <div className="mb-3 rounded-lg border border-card-edge bg-surface px-3 py-2.5 print:border-0 print:px-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="label-caps mr-1 text-text-muted">By account</span>
        <button type="button" aria-pressed={!picked.length} onClick={() => setFilter('account', [])}
          className={cx('h-(--layout-control-sm) rounded-pill border px-3 text-sm font-semibold print:hidden', !picked.length ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>
          All
        </button>
        {names.filter((a) => a !== NO_ACCOUNT).map((a) => {
          const on = picked.includes(a);
          const color = colorOf(a);
          return (
            <button key={a} type="button" aria-pressed={on} onClick={() => toggle(a)} title={on ? `Show every account again` : `Show only ${a}`}
              className={cx('inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-pill border px-3 text-sm font-semibold text-text', on ? 'border-text ring-1 ring-text' : 'border-border hover:border-border-strong', picked.length > 0 && !on && 'opacity-60')}
              style={{ backgroundColor: color ? `color-mix(in oklab, ${color} 30%, var(--color-surface))` : undefined }}>
              <i aria-hidden className="inline-block size-3 rounded-full border border-black/10" style={{ backgroundColor: color }} />
              {a}<span className="font-mono text-xs font-medium text-text-muted">{counts.get(a) ?? 0}</span>
            </button>
          );
        })}
        {counts.has(NO_ACCOUNT) && <span className="inline-flex items-center gap-1.5 px-2 text-sm text-text-muted"><i aria-hidden className="inline-block size-3 rounded-full border border-border bg-surface-2" />{NO_ACCOUNT} <span className="font-mono text-xs">{counts.get(NO_ACCOUNT)}</span></span>}
        <span className="ml-auto text-xs text-text-subtle print:hidden">Grouped and coloured by account. Click one to show only its {noun}.</span>
        {canColor && <Button size="sm" variant="ghost" aria-expanded={editing} onClick={() => setEditing(!editing)} className="print:hidden"><Palette aria-hidden className="size-3.5" />Colours</Button>}
      </div>
      {editing && (
        <div className="mt-2 space-y-1.5 border-t border-border pt-2 print:hidden">
          <div className="flex items-center"><p className="flex-1 text-xs text-text-muted">Pick another colour for an account. New accounts get the next free colour when their first job is created.</p>
            <Button size="sm" variant="ghost" aria-label="Close colours" onClick={() => setEditing(false)}><X aria-hidden className="size-3.5" /></Button></div>
          {names.filter((a) => a !== NO_ACCOUNT).map((a) => (
            <div key={a} className="flex flex-wrap items-center gap-1.5">
              <span className="w-32 truncate text-sm font-semibold">{a}</span>
              <span role="radiogroup" aria-label={`Colour for ${a}`} className="flex flex-wrap gap-1">
                {ACCOUNT_PALETTE.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={colorOf(a) === c} aria-label={c} onClick={() => recolor(a, c)}
                    className={cx('size-6 rounded-full border', colorOf(a) === c ? 'border-text ring-2 ring-text' : 'border-black/10')} style={{ backgroundColor: c }} />
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
