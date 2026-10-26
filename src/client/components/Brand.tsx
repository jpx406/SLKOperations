import { cx } from './ui';

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

/** "SLK Operations" with SLK highlighted: lime on the dark theme, dark on a lime marker in Sunlight (lime text bleaches in glare). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('font-display font-extrabold uppercase tracking-wide', className)}>
      <span className="text-accent-text in-data-[theme=light]:rounded-xs in-data-[theme=light]:bg-accent in-data-[theme=light]:px-1 in-data-[theme=light]:text-on-accent">SLK</span>{' '}
      <span className="text-text">Operations</span>
    </span>
  );
}

export const CONTACTS = [
  { name: 'Juan Lopez', email: 'jceron@nesr.com' },
  { name: 'Mohamed Manna', email: 'mmana@nesr.com' },
] as const;

/** Who to contact about SLK Operations, under the name. */
export function Contacts({ className }: { className?: string }) {
  return (
    <p className={cx('text-xs text-text-muted', className)}>
      {CONTACTS.map((c, i) => (
        <span key={c.email}>{i > 0 && ' / '}{c.name} (<a className="underline hover:text-text" href={`mailto:${c.email}`}>{c.email}</a>)</span>
      ))}
    </p>
  );
}
