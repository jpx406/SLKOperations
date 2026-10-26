import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { FILTER_DIMS, MONTHS, activeFilterCount, parseFilters, type FilterKey, type Filters } from '../../shared/filters';
import { api } from '../api';
import { Button, cx, inputClass } from './ui';

// The standard filter bar (S08, S10, S13–S15). Filters live in the address, so a filtered view can be bookmarked or shared.

type Option = { value: string; label: string };
export type FilterOptions = Partial<Record<FilterKey, Option[]>>;

const STATUS_OPTIONS: Option[] = [
  { value: 'planned', label: 'Planned' }, { value: 'ongoing', label: 'Ongoing' }, { value: 'completed', label: 'Completed' }, { value: 'canceled', label: 'Canceled' },
];
const MONTH_OPTIONS: Option[] = MONTHS.map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }));

/** Reads and writes the filters in the URL. */
export function useFilters(): [Filters, (k: FilterKey, v: string[]) => void, () => void] {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const set = (k: FilterKey, v: string[]) => {
    const n = new URLSearchParams(params);
    n.delete(k);
    for (const x of v) n.append(k, x);
    setParams(n, { replace: true });
  };
  const clear = () => {
    const n = new URLSearchParams(params);
    for (const d of [...FILTER_DIMS.map((x) => x.key), 'status']) n.delete(d);
    setParams(n, { replace: true });
  };
  return [filters, set, clear];
}

/**
 * `panel` is the WL Hub layout: a card of labelled dropdowns (label above, "All" below) with Clear at the end.
 * `dims` limits the dimensions shown (the schedule has no year or month: it shows one month).
 */
export function FilterBar({ optionsPath, withStatus = true, variant = 'row', dims, children }: {
  optionsPath: string; withStatus?: boolean; variant?: 'row' | 'panel'; dims?: FilterKey[]; children?: React.ReactNode;
}) {
  const [filters, set, clear] = useFilters();
  const options = useQuery({ queryKey: ['filter-options', optionsPath], queryFn: () => api<FilterOptions>(optionsPath), staleTime: 60_000 });
  const opts = (k: FilterKey): Option[] => (k === 'month' ? MONTH_OPTIONS : k === 'status' ? STATUS_OPTIONS : options.data?.[k] ?? []);
  const n = activeFilterCount(filters);
  const shown = FILTER_DIMS.filter((d) => !dims || dims.includes(d.key));
  if (variant === 'panel') {
    return (
      <div role="group" aria-label="Filters" className="mb-4 rounded-lg border border-card-edge bg-surface p-4 shadow-card print:hidden">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]">
          {children}
          {withStatus && <MultiSelect stacked label="Job status" options={opts('status')} value={filters.status ?? []} onChange={(v) => set('status', v)} />}
          {shown.map((d) => <MultiSelect stacked key={d.key} label={d.label} options={opts(d.key)} value={filters[d.key] ?? []} onChange={(v) => set(d.key, v)} />)}
          <div className="flex items-end">
            <Button variant="ghost" disabled={!n} onClick={clear}><X aria-hidden className="size-4" />Clear{n > 1 ? ` ${n}` : ''}</Button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div role="group" aria-label="Filters" className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
      {withStatus && <MultiSelect label="Status" options={opts('status')} value={filters.status ?? []} onChange={(v) => set('status', v)} />}
      {shown.map((d) => <MultiSelect key={d.key} label={d.label} options={opts(d.key)} value={filters[d.key] ?? []} onChange={(v) => set(d.key, v)} />)}
      {n > 0 && <Button size="sm" variant="ghost" onClick={clear}><X aria-hidden className="size-3.5" />Clear {n === 1 ? 'filter' : `${n} filters`}</Button>}
    </div>
  );
}

/** A dropdown of checkboxes. Nothing ticked means "all". */
export function MultiSelect({ label, options, value, onChange, stacked, emptyText = 'All' }: { label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void; stacked?: boolean; emptyText?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const summary = !value.length ? emptyText : value.length === 1 ? options.find((o) => o.value === value[0])?.label ?? value[0] : `${value.length} selected`;
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div ref={box} className="relative" onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}>
      {stacked ? (
        <>
          <span id={`${id}-l`} className="label-caps mb-1 block text-text-muted">{label}</span>
          <button type="button" aria-expanded={open} aria-controls={id} aria-labelledby={`${id}-l ${id}-v`} onClick={() => setOpen(!open)}
            className={cx('flex h-(--layout-control-md) w-full items-center justify-between gap-1.5 rounded-md border bg-input px-3 text-sm', value.length ? 'border-accent-edge font-semibold text-text' : 'border-border-input text-text')}>
            <span id={`${id}-v`} className="truncate">{summary}</span><ChevronDown aria-hidden className="size-4 shrink-0 text-text-muted" />
          </button>
        </>
      ) : (
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
          className={cx('inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-md border px-2.5 text-xs', value.length ? 'border-accent-edge bg-surface-2 text-text' : 'border-border-strong text-text-muted hover:text-text')}>
          <span className="font-semibold">{label}</span><span className="max-w-32 truncate">{summary}</span><ChevronDown aria-hidden className="size-3.5" />
        </button>
      )}
      {open && (
        <div id={id} role="group" aria-label={label} className={cx('absolute left-0 z-40 w-64 rounded-md border border-border bg-surface p-2 shadow-pop', stacked ? 'top-full mt-1' : 'top-9')}>
          {options.length > 0 && <input aria-label={`Search ${label.toLowerCase()}`} autoFocus className={cx(inputClass, 'mb-2 h-(--layout-control-sm)')} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />}
          {!options.length && <p className="px-1 py-2 text-xs text-text-subtle">No values in your jobs yet.</p>}
          <ul className="max-h-64 overflow-y-auto">
            {shown.map((o) => (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-2">
                  <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
                  <span className="flex-1 truncate">{o.label}</span>
                  {value.includes(o.value) && <Check aria-hidden className="size-3.5 text-accent-text" />}
                </label>
              </li>
            ))}
          </ul>
          {value.length > 0 && <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => onChange([])}>Show all</Button>}
        </div>
      )}
    </div>
  );
}
