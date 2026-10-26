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
