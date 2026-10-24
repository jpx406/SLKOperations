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

export function FilterBar({ optionsPath, withStatus = true }: { optionsPath: string; withStatus?: boolean }) {
  const [filters, set, clear] = useFilters();
  const options = useQuery({ queryKey: ['filter-options', optionsPath], queryFn: () => api<FilterOptions>(optionsPath), staleTime: 60_000 });
  const opts = (k: FilterKey): Option[] => (k === 'month' ? MONTH_OPTIONS : k === 'status' ? STATUS_OPTIONS : options.data?.[k] ?? []);
  const n = activeFilterCount(filters);
  return (
    <div role="group" aria-label="Filters" className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
      {withStatus && <MultiSelect label="Status" options={opts('status')} value={filters.status ?? []} onChange={(v) => set('status', v)} />}
      {FILTER_DIMS.map((d) => <MultiSelect key={d.key} label={d.label} options={opts(d.key)} value={filters[d.key] ?? []} onChange={(v) => set(d.key, v)} />)}
      {n > 0 && <Button size="sm" variant="ghost" onClick={clear}><X aria-hidden className="size-3.5" />Clear {n === 1 ? 'filter' : `${n} filters`}</Button>}
    </div>
  );
}

/** A dropdown of checkboxes. Nothing ticked means "all". */
export function MultiSelect({ label, options, value, onChange }: { label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void }) {
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
  const summary = !value.length ? 'All' : value.length === 1 ? options.find((o) => o.value === value[0])?.label ?? value[0] : `${value.length} selected`;
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div ref={box} className="relative" onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
        className={cx('inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs', value.length ? 'border-accent bg-surface-2 text-text' : 'border-border-strong text-text-muted hover:text-text')}>
        <span className="font-semibold">{label}</span><span className="max-w-32 truncate">{summary}</span><ChevronDown aria-hidden className="size-3.5" />
      </button>
      {open && (
        <div id={id} role="group" aria-label={label} className="absolute top-9 left-0 z-40 w-64 rounded-md border border-border bg-surface p-2 shadow-pop">
          {options.length > 8 && <input aria-label={`Search ${label.toLowerCase()}`} autoFocus className={cx(inputClass, 'mb-2 h-8')} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />}
          {!options.length && <p className="px-1 py-2 text-xs text-text-subtle">No values in your jobs yet.</p>}
          <ul className="max-h-64 overflow-y-auto">
            {shown.map((o) => (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-2">
                  <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
                  <span className="flex-1 truncate">{o.label}</span>
                  {value.includes(o.value) && <Check aria-hidden className="size-3.5 text-accent" />}
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
