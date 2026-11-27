import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button, Card, cx } from './ui';

// The app's one dialog (6z.71). Opening moves keyboard focus into it, Tab stays inside, Escape closes it from
// anywhere on the page, and closing returns focus to whatever opened it.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus handling for a dialog panel: use it on a custom dialog that keeps its own markup (a drawer, a full-screen
 * view). `initial` picks what gets focus first; otherwise the first field, else the first button, else the panel.
 */
export function useDialogFocus(panel: RefObject<HTMLElement | null>, onClose: () => void, initial?: RefObject<HTMLElement | null>) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = panel.current;
    if (el) {
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const field = items.find((x) => /^(INPUT|SELECT|TEXTAREA)$/.test(x.tagName));
      const first = initial?.current ?? field ?? items.find((x) => x.getAttribute('aria-label') !== 'Close') ?? items[0];
      if (first) first.focus(); else { el.tabIndex = -1; el.focus(); }
    }
    const onKey = (e: KeyboardEvent) => {
      // the topmost dialog answers: a dialog opened from inside another one closes first
      const open = document.querySelectorAll('[data-dialog-panel]');
      if (open.length && open[open.length - 1] !== panel.current) return;
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) { e.preventDefault(); return; }
      const [a, z] = [items[0], items[items.length - 1]];
      if (e.shiftKey && (document.activeElement === a || !panel.current.contains(document.activeElement))) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && (document.activeElement === z || !panel.current.contains(document.activeElement))) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // back to the button that opened it, if it is still on the page
      if (before && document.contains(before)) before.focus();
    };
  }, [panel, initial]);
}

const WIDTH = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

export function Dialog({ title, onClose, children, size = 'md', wide, alert, initialFocus, className, hideClose }: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: keyof typeof WIDTH;
  /** Same as size="lg" (kept for older callers). */
  wide?: boolean;
  /** A confirmation that needs an answer: role="alertdialog". */
  alert?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
  hideClose?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useDialogFocus(panel, onClose, initialFocus);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !alert) onClose(); }}>
      <div ref={panel} data-dialog-panel role={alert ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={`${id}-t`} className={cx('w-full', WIDTH[wide ? 'lg' : size])}>
        <Card className={cx('max-h-[90vh] overflow-y-auto', className)}>
          <div className="mb-3 flex items-start gap-3">
            <h2 id={`${id}-t`} className="min-w-0 flex-1 font-display text-lg font-bold">{title}</h2>
            {!hideClose && <Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}><X aria-hidden className="size-4" /></Button>}
          </div>
          {children}
        </Card>
      </div>
    </div>
  );
}

export interface ConfirmOptions {
  title: string;
  /** What will happen, in a sentence or two. */
  body?: ReactNode;
  /** The button that goes ahead: say what it does ("Remove run 2"). */
  confirm: string;
  /** Red button for something that deletes or can't be undone. */
  danger?: boolean;
}

/** Asks before doing something that can't easily be undone. */
export function ConfirmDialog({ title, body, confirm, danger, busy, onConfirm, onCancel }: ConfirmOptions & { busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog title={title} onClose={onCancel} size="sm" alert initialFocus={cancel} hideClose>
      {body && <div className="mb-4 text-sm text-text-muted">{body}</div>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button ref={cancel} onClick={onCancel}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>{confirm}</Button>
      </div>
    </Dialog>
  );
}

/**
 * `const [ask, confirmDialog] = useConfirm()` then `if (await ask({ title, confirm, danger: true })) …`, with
 * `{confirmDialog}` placed anywhere in the component. Replaces window.confirm with the app's own dialog.
 */
export function useConfirm(): [(o: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [open, setOpen] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setOpen({ ...o, resolve })), []);
  const done = (ok: boolean) => { open?.resolve(ok); setOpen(null); };
  const node = open ? <ConfirmDialog {...open} onConfirm={() => done(true)} onCancel={() => done(false)} /> : null;
  return [ask, node];
}
