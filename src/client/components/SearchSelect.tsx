import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cx, inputClass } from './ui';

// A dropdown that reads from a list (rigs, units, people, roles, lookups ...), with a search box at the top of the
// list, as in the WL Operations Hub. Keyboard: Enter or Arrow Down opens it, arrows move, Enter picks, Escape
// closes. Lists of a handful of fixed choices (Yes / No) stay native selects.

export interface Option { value: string; label: string; hint?: string; disabled?: boolean }

export function SearchSelect({ id, value, onChange, options, placeholder = '— Select —', searchPlaceholder, disabled, className, allowEmpty = true, emptyLabel, ariaLabel, ariaDescribedBy, invalid }: {
  id?: string; value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string; searchPlaceholder?: string;
  disabled?: boolean; className?: string; allowEmpty?: boolean; emptyLabel?: string; ariaLabel?: string; ariaDescribedBy?: string; invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hits = options.filter((o) => !s || `${o.label} ${o.hint ?? ''} ${o.value}`.toLowerCase().includes(s));
    return allowEmpty && !s ? [{ value: '', label: emptyLabel ?? placeholder }, ...hits] : hits;
  }, [q, options, allowEmpty, emptyLabel, placeholder]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  useEffect(() => { if (open) { setQ(''); setActive(Math.max(0, shown.findIndex((o) => o.value === value))); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const pick = (o: Option | undefined) => { if (!o || o.disabled) return; onChange(o.value); setOpen(false); box.current?.querySelector<HTMLButtonElement>('button')?.focus(); };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
  };

  return (
    <div ref={box} className={cx('relative', className)}>
      <button type="button" id={id} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy} aria-invalid={invalid || undefined}
        onClick={() => setOpen(!open)} onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); } }}
        className={cx(inputClass, 'flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60')}>
        <span className={cx('truncate', !current && 'text-text-subtle')}>{current?.label ?? placeholder}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-text-muted" />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full min-w-56 overflow-hidden rounded-md border border-border-strong bg-surface shadow-pop">
          <input autoFocus aria-label={searchPlaceholder ?? 'Search'} aria-controls={listId} aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            role="combobox" aria-expanded aria-autocomplete="list"
            className="h-(--layout-control-md) w-full border-b border-border bg-surface px-3 text-sm outline-none placeholder:text-text-subtle"
            placeholder={searchPlaceholder ?? 'Search…'} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={keys} />
          <ul ref={list} id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {shown.map((o, i) => (
              <li key={o.value || '__empty'} id={`${listId}-${i}`} data-i={i} role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
                onPointerDown={(e) => e.preventDefault()} onClick={() => pick(o)} onMouseMove={() => setActive(i)}
                className={cx('flex min-h-9 cursor-pointer items-center gap-2 px-3 py-1.5 text-sm in-data-[density=touch]:min-h-11', i === active && 'bg-surface-2',
                  o.disabled && 'cursor-default opacity-50', !o.value && 'text-text-subtle')}>
                <span className="min-w-0 flex-1 truncate">{o.label}{o.hint && <span className="ml-2 text-xs text-text-subtle">{o.hint}</span>}</span>
                {o.value === value && o.value !== '' && <Check aria-hidden className="size-4 shrink-0 text-accent-text" />}
              </li>
            ))}
            {!shown.length && <li className="px-3 py-2 text-sm text-text-subtle">Nothing matches “{q}”</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
