import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { VERSION_TEXT } from '../version';
import { Button, cx } from './ui';

// The NESR mark: white on the dark theme, dark on Sunlight and on paper. Both are in the page so switching
// themes never waits on an image.
export function NesrLogo({ className, print }: { className?: string; print?: boolean }) {
  const img = 'h-full w-auto';
  return (
    <span className={cx('inline-flex shrink-0', className)}>
      <img src="/brand/nesr-white-160.png" srcSet="/brand/nesr-white-160.png 1x, /brand/nesr-white-320.png 2x" alt="NESR"
        className={cx(img, 'in-data-[theme=light]:hidden', print && 'print:hidden')} />
      <img src="/brand/nesr-dark-160.png" srcSet="/brand/nesr-dark-160.png 1x, /brand/nesr-dark-320.png 2x" alt="NESR"
        className={cx(img, 'hidden in-data-[theme=light]:block', print && 'print:block')} />
    </span>
  );
}

/** "SLK Operations Hub" with SLK highlighted: lime on the dark theme, dark on a lime marker in Sunlight (lime text bleaches in glare). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('font-display font-extrabold uppercase tracking-wide', className)}>
      <span className="text-accent-text in-data-[theme=light]:rounded-xs in-data-[theme=light]:bg-accent in-data-[theme=light]:px-1 in-data-[theme=light]:text-on-accent">SLK</span>{' '}
      <span className="text-text">Operations Hub</span>
    </span>
  );
}

export const CONTACTS = [
  { name: 'Juan Lopez', email: 'jceron@nesr.com' },
  { name: 'Mohamed Manna', email: 'mmana@nesr.com' },
] as const;

export const PRODUCT = 'SLK Operations Hub';
export const TAGLINE = 'Slickline jobs, quality & reporting';

/**
 * The app's title block (owner request 2026-10-29, after WIREGUARD's header): the NESR mark at the height of the
 * name and the line under it, so the two read as one lock-up. Authors and version live in About, not here.
 */
export function BrandHeader({ className }: { className?: string }) {
  return (
    <a href="/" aria-label={`${PRODUCT}, home`} className={cx('flex min-w-0 items-center gap-3', className)}>
      <NesrLogo className="h-8 sm:h-11" />
      <span aria-hidden className="flex min-w-0 flex-col">
        <Wordmark className="text-base leading-tight whitespace-nowrap sm:text-xl" />
        <span className="label-caps mt-0.5 hidden truncate text-text-muted sm:block">{TAGLINE}</span>
      </span>
    </a>
  );
}

/** About SLK Operations Hub: a small window with the version, the authors and what the app is, like every app's About box. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('button')?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('keydown', esc); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-(--z-modal) grid place-items-center p-4 print:hidden">
      <button type="button" aria-label="Close About" tabIndex={-1} className="absolute inset-0 bg-bg/70" onClick={onClose} />
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="about-title"
        className="relative w-fit max-w-[min(24rem,100%)] rounded-lg border border-border bg-surface p-5 text-center shadow-pop">
        <Button size="sm" variant="ghost" className="absolute top-2 right-2" aria-label="Close" onClick={onClose}><X aria-hidden className="size-4" /></Button>
        <NesrLogo className="mx-auto mt-2 h-14" />
        <h2 id="about-title" className="mt-3"><span className="sr-only">About </span><Wordmark className="text-xl" /></h2>
        <p className="label-caps mt-1 text-text-muted">{TAGLINE}</p>
        <p className="mt-3 font-mono text-xs text-text-muted">{VERSION_TEXT}</p>
        <p className="mt-4 text-sm text-text-muted">NESR slickline operations: schedule and jobs, quality, attendance, inventory, wires, bonus and the activity dashboard. Wires, runs, units and sign-in come from WIREGUARD.</p>
        <div className="mt-4 border-t border-border pt-3 text-sm">
          <p className="label-caps mb-1.5 text-text-muted">Authors</p>
          <ul className="space-y-0.5">
            {CONTACTS.map((c) => <li key={c.email}><span className="font-semibold">{c.name}</span> · <a className="underline hover:text-text" href={`mailto:${c.email}`}>{c.email}</a></li>)}
          </ul>
        </div>
        <p className="mt-4 text-xs text-text-subtle">© {new Date().getFullYear()} NESR · for internal use</p>
      </div>
    </div>
  );
}
