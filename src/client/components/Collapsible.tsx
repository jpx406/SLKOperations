import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './ui';

/** How complete a section is: done of total, or a word when there is nothing to count. */
export interface Completeness { done: number; total: number; note?: string }

/**
 * A job section that stays closed until opened (6z.49), with how complete it is on its heading, so a stage shows
 * what is left at a glance. A native details element: keyboard and screen readers open it as usual.
 */
export function Collapsible({ title, aside, status, open, children, id }: {
  title: string; aside?: ReactNode; status?: Completeness | null; open?: boolean; children: ReactNode; id?: string;
}) {
  const complete = status ? status.done >= status.total : false;
  return (
    <details id={id} open={open} className="group mt-5 rounded-md border border-border first:mt-0 open:pb-3">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-md px-3 py-2.5 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 shrink-0 text-text-subtle transition-transform group-open:rotate-90" />
        <h2 className="label-caps text-text-muted">{title}</h2>
        {status && (
          <span className={cx('rounded-pill px-2 py-0.5 font-mono text-label font-bold', complete ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning')}>
            {complete ? 'Complete' : status.note ?? `${status.done} of ${status.total} filled`}
          </span>
        )}
        {aside && <span className="ml-auto text-right text-xs text-text-subtle">{aside}</span>}
      </summary>
      <div className="px-3 pt-2">{children}</div>
    </details>
  );
}
