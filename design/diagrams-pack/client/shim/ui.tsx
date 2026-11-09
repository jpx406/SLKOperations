// Minimal stand-ins for the SLK Operations Hub UI kit the Diagrams page uses. Replace the imports in Diagrams.tsx with
// your own components when your app has them; keep the same props.
import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const inputClass =
  'h-(--layout-control-sm) w-full rounded-md border border-border-input bg-input px-2.5 text-sm text-text placeholder:text-text-subtle focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-60';

const VARIANT = {
  primary: 'border-accent bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'border-border-strong bg-surface-2 text-text hover:bg-surface-3',
  ghost: 'border-transparent bg-transparent text-text-muted hover:bg-surface-2 hover:text-text',
  danger: 'border-danger-solid bg-danger-solid text-on-danger',
} as const;

export function Button({ variant = 'secondary', size = 'md', loading, children, className, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANT; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button type="button" {...rest} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-md border font-semibold disabled:opacity-50', size === 'sm' ? 'h-(--layout-control-sm) px-2.5 text-xs' : 'h-10 px-4 text-sm', VARIANT[variant], className)}>
      {loading ? <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {children}
    </button>
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}

const BANNER = {
  info: 'border-info/40 bg-info-subtle text-text',
  success: 'border-success/40 bg-success-subtle text-text',
  warning: 'border-warning/40 bg-warning-subtle text-text',
  danger: 'border-danger/40 bg-danger-subtle text-text',
} as const;

export function Banner({ tone = 'info', children, action }: { tone?: keyof typeof BANNER; children: ReactNode; action?: ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm', BANNER[tone])}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export const Card = ({ children, className }: { children: ReactNode; className?: string }) =>
  <div className={cx('rounded-lg border border-border bg-surface', className)}>{children}</div>;

export const Skeleton = ({ className }: { className?: string }) =>
  <div aria-hidden className={cx('animate-pulse rounded-lg bg-surface-2', className)} />;
