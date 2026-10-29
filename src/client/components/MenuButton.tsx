import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, cx } from './ui';

// A pull-down button: one button that opens a short list of related actions (Export → Excel, PDF A4, PDF A3), so a
// toolbar keeps one control per job instead of a row of look-alike buttons that wraps on a phone.

export interface MenuItem { label: string; icon?: ReactNode; onSelect: () => void; disabled?: boolean; hint?: string }

export function MenuButton({ label, icon, items, align = 'end', disabled }: { label: string; icon?: ReactNode; items: MenuItem[]; align?: 'start' | 'end'; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    box.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
  };
  return (
    <div ref={box} className="relative" onKeyDown={move}>
      <Button size="sm" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
        {icon}{label}<ChevronDown aria-hidden className="size-3.5" />
      </Button>
      {open && (
        <div role="menu" aria-label={label} className={cx('absolute top-full z-(--z-drawer) mt-1 min-w-48 rounded-md border border-border bg-surface p-1 shadow-pop', align === 'end' ? 'right-0' : 'left-0')}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" disabled={it.disabled} title={it.hint}
              onClick={() => { setOpen(false); it.onSelect(); }}
              className="flex h-(--layout-control-sm) w-full items-center gap-2 rounded-sm px-2.5 text-left text-sm font-semibold hover:bg-surface-2 focus:bg-surface-2 focus:outline-none disabled:opacity-50">
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
