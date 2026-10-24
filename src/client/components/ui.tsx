import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertCircle, AlertTriangle, Check, Info, Loader2, Lock } from 'lucide-react';
import type { JobStatus } from '../../shared/types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'bg-surface-2 text-text border border-border-strong hover:bg-surface-3',
  ghost: 'bg-transparent text-text-muted hover:text-text hover:bg-surface-2',
  danger: 'bg-transparent text-danger border border-danger hover:bg-danger-subtle',
};
const SIZE = { sm: 'h-8 px-3 text-xs', md: 'h-9 px-3.5 text-sm', lg: 'h-11 px-4.5 text-base font-display font-bold' };

export function Button({ variant = 'secondary', size = 'md', loading, children, className, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap transition-colors duration-(--motion-fast)',
        'disabled:opacity-50 disabled:cursor-not-allowed', VARIANT[variant], SIZE[size], className)}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

const STATUS_STYLE: Record<JobStatus, string> = {
  planned: 'text-info bg-info-subtle border-info/40',
  ongoing: 'text-warning bg-warning-subtle border-warning/40',
  completed: 'text-success bg-success-subtle border-success/40',
  canceled: 'text-neutral bg-neutral-subtle border-neutral/40 line-through',
};

export function StatusPill({ status }: { status: JobStatus }) {
  return <span className={cx('label-caps inline-flex h-5.5 items-center rounded-pill border px-2', STATUS_STYLE[status])}>{status}</span>;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="label-caps inline-flex rounded-xs bg-info-subtle px-1.5 text-info">{children}</span>;
}

export function ProgressBar({ value, label, done }: { value: number; label: string; done?: boolean }) {
  return (
    <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} ${value} percent`}
      className="h-1 overflow-hidden rounded-sm bg-surface-3">
      <div className={cx('h-full', done || value >= 100 ? 'bg-success' : 'bg-accent')} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

const BANNER = {
  info: { cls: 'bg-info-subtle text-info border-info', Icon: Info, role: 'status' as const },
  warning: { cls: 'bg-warning-subtle text-warning border-warning', Icon: AlertTriangle, role: 'status' as const },
  danger: { cls: 'bg-danger-subtle text-danger border-danger', Icon: AlertCircle, role: 'alert' as const },
  success: { cls: 'bg-success-subtle text-success border-success', Icon: Check, role: 'status' as const },
};

export function Banner({ tone = 'info', children, action }: { tone?: keyof typeof BANNER; children: ReactNode; action?: ReactNode }) {
  const { cls, Icon, role } = BANNER[tone];
  return (
    <div role={role} className={cx('flex items-center gap-2.5 rounded-md border-l-3 px-3 py-2.5 text-sm', cls)}>
      <Icon aria-hidden className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-lg border border-border bg-surface p-4 shadow-card', className)}>{children}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-pulse rounded-md bg-surface-2', className)} />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-12 text-center">
      <p className="font-display text-lg font-bold">{title}</p>
      {children && <p className="max-w-md text-sm text-text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LockHint({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-2 px-3 py-2 text-sm text-text-subtle">
      <Lock aria-hidden className="size-3.5" />
      {children}
    </div>
  );
}

export function PageTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-display text-xl font-extrabold uppercase">{children}</h1>
      {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
    </div>
  );
}

const inputBase = 'w-full h-9 rounded-sm border border-border-input bg-input px-3 text-base text-text placeholder:text-text-subtle hover:border-border-strong focus:border-focus disabled:opacity-60 disabled:cursor-not-allowed aria-[invalid=true]:border-danger';

export function Field({ id, label, badge, hint, error, unit, children, required }: {
  id: string; label: string; badge?: string; hint?: ReactNode; error?: string | null; unit?: string; children: ReactNode; required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="label-caps mb-1.5 flex items-center gap-1.5 text-text-muted">
        {label}
        {badge && <Badge>{badge}</Badge>}
        {required && <span aria-hidden className="text-danger">*</span>}
      </label>
      <div className="relative">
        {children}
        {unit && <span aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-xs text-text-subtle">{unit}</span>}
      </div>
      {error ? <p id={`${id}-err`} className="mt-1 flex items-center gap-1 text-xs text-danger"><AlertCircle aria-hidden className="size-3" />{error}</p>
        : hint ? <p id={`${id}-hint`} className="mt-1 text-xs text-text-subtle">{hint}</p> : null}
    </div>
  );
}

export const inputClass = inputBase;
