import { FileSpreadsheet, Printer } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';
import type { Bucket } from '../../shared/stats';
import { workbook } from '../../shared/xlsx';
import { Button, Card, cx } from './ui';

// Charts for the Service Quality screens: plain HTML bars (no chart library), each with a hidden data table
// for screen readers, its own Print and XLSX, and clickable bars for drill-down.

type B = Omit<Bucket, 'value'> & { value: number | null };

export function saveFile(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Prints only one element: marks it, prints, then clears the mark. */
export function printOnly(el: HTMLElement | null) {
  if (!el) return window.print();
  el.classList.add('print-target');
  document.body.classList.add('print-one');
  const done = () => { el.classList.remove('print-target'); document.body.classList.remove('print-one'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

const fmt = (v: number | null, unit?: string) => (v == null ? '—' : `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ''}`);

export function BarChart({ title, buckets, unit, horizontal, selected, onSelect, note, max: fixedMax, limit = horizontal ? 12 : 24 }: {
  title: string; buckets: B[]; unit?: string; horizontal?: boolean; selected?: string | null; onSelect?: (b: B) => void; note?: ReactNode; max?: number; limit?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const shown = buckets.slice(0, limit);
  const max = fixedMax ?? Math.max(1, ...shown.map((b) => b.value ?? 0));
  const exportXlsx = () => saveFile(`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.xlsx`,
    workbook(title.slice(0, 31), [horizontal ? 'Group' : 'Month', `${title}${unit ? ` (${unit})` : ''}`, 'Jobs'], buckets.map((b) => [b.label, b.value, b.ids.length]), [24, 18, 8]),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return (
    <div ref={ref}>
      <Card className="h-full">
        <div className="mb-3 flex items-start gap-2">
          <h2 id={id} className="flex-1 text-sm font-semibold">{title}</h2>
          <span className="flex gap-1 print:hidden">
            <Button size="sm" variant="ghost" aria-label={`Print ${title}`} onClick={() => printOnly(ref.current)}><Printer aria-hidden className="size-3.5" /></Button>
            <Button size="sm" variant="ghost" aria-label={`${title} as XLSX`} onClick={exportXlsx} disabled={!buckets.length}><FileSpreadsheet aria-hidden className="size-3.5" /></Button>
          </span>
        </div>
        {!shown.length ? <p className="py-8 text-center text-xs text-text-subtle">No data in this selection.</p> : horizontal ? (
          <ul aria-labelledby={id} className="space-y-1.5">
            {shown.map((b) => (
              <li key={b.key}>
                <button type="button" disabled={!onSelect} aria-pressed={selected === b.key} onClick={() => onSelect?.(b)}
                  className={cx('grid w-full grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-2 text-left text-xs', onSelect && 'hover:text-text', selected && selected !== b.key && 'opacity-50')}>
                  <span className="truncate text-text-muted" title={b.label}>{b.label}</span>
                  <span className="h-3.5 rounded-xs bg-surface-2"><span className="block h-full rounded-xs bg-accent" style={{ width: `${((b.value ?? 0) / max) * 100}%` }} /></span>
                  <span className="font-mono">{fmt(b.value, unit)}</span>
                </button>
              </li>
            ))}
            {buckets.length > shown.length && <li className="text-xs text-text-subtle">+ {buckets.length - shown.length} more in the XLSX</li>}
          </ul>
        ) : (
          <div aria-labelledby={id} role="list" className="flex h-40 items-end gap-1 overflow-x-auto">
            {shown.map((b) => (
              <button key={b.key} type="button" role="listitem" disabled={!onSelect} aria-pressed={selected === b.key}
                aria-label={`${b.label}: ${fmt(b.value, unit)}, ${b.ids.length} job${b.ids.length === 1 ? '' : 's'}`} onClick={() => onSelect?.(b)}
                className={cx('group flex h-full min-w-9 flex-1 flex-col items-center justify-end gap-1', selected && selected !== b.key && 'opacity-40')}>
                <span className="font-mono text-label text-text-muted">{b.value == null ? '' : fmt(b.value)}</span>
                <span className={cx('w-full max-w-10 rounded-t-xs bg-accent', onSelect && 'group-hover:bg-accent-hover', b.value == null && 'bg-transparent')} style={{ height: `${Math.max(b.value ? 2 : 0, ((b.value ?? 0) / max) * 100)}%` }} />
                <span className="text-label whitespace-nowrap text-text-muted">{b.label}</span>
              </button>
            ))}
          </div>
        )}
        {note && <p className="mt-2 text-xs text-text-subtle">{note}</p>}
        <table className="sr-only">
          <caption>{title}</caption>
          <thead><tr><th scope="col">Group</th><th scope="col">{unit ? `Value (${unit})` : 'Value'}</th><th scope="col">Jobs</th></tr></thead>
          <tbody>{buckets.map((b) => <tr key={b.key}><th scope="row">{b.label}</th><td>{fmt(b.value, unit)}</td><td>{b.ids.length} jobs</td></tr>)}</tbody>
        </table>
      </Card>
    </div>
  );
}

/** Half-circle gauge for a percentage, with an optional target tick. */
export function Gauge({ label, value, target, sub }: { label: string; value: number | null; target?: number; sub?: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const arc = (p: number) => { const a = Math.PI * (1 - p / 100); return [50 + 40 * Math.cos(a), 50 - 40 * Math.sin(a)]; };
  const [x, y] = arc(v);
  const tone = value == null ? 'text-text-subtle' : target != null ? (v >= target ? 'text-success' : 'text-warning') : v >= 90 ? 'text-success' : v >= 75 ? 'text-warning' : 'text-danger';
  // the colour has a word next to it, so the state reads without telling amber from green
  const state = value == null ? null : target != null ? (v >= target ? 'on target' : 'below target') : v >= 90 ? 'good' : v >= 75 ? 'watch' : 'low';
  return (
    <figure className="flex flex-col items-center" aria-label={`${label}: ${value == null ? 'no data' : `${value}%`}${target != null ? `, target ${target}%` : ''}${state ? `, ${state}` : ''}`}>
      <svg viewBox="0 0 100 58" className="w-full max-w-40" aria-hidden>
        <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="var(--color-surface-2)" strokeWidth="9" strokeLinecap="round" />
        {value != null && v > 0 && <path d={`M10 50 A40 40 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke="currentColor" className={tone} strokeWidth="9" strokeLinecap="round" />}
        {target != null && (() => { const [tx, ty] = arc(target); const [ox, oy] = [50 + (tx - 50) * 1.28, 50 + (ty - 50) * 1.28]; return <line x1={tx} y1={ty} x2={ox} y2={oy} stroke="var(--color-text-muted)" strokeWidth="1.5" />; })()}
        <text x="50" y="49" textAnchor="middle" className="fill-current font-mono" fontSize="14" fontWeight="700">{value == null ? '—' : `${Math.round(value)}%`}</text>
      </svg>
      <figcaption className="mt-1 max-w-40 truncate text-center text-xs font-semibold" title={label}>{label}</figcaption>
      {state && <span aria-hidden className={cx('label-caps', tone)}>{state}</span>}
      {sub && <span className="text-label text-text-subtle">{sub}</span>}
    </figure>
  );
}

export function KpiTile({ label, value, unit, note }: { label: string; value: string | number | null; unit?: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <dt className="label-caps text-text-muted">{label}</dt>
      <dd className="mt-1 font-display text-kpi leading-none font-bold">{value ?? '—'}{value != null && unit && <span className="ml-1 text-sm font-semibold text-text-muted">{unit}</span>}</dd>
      {note && <dd className="mt-1 text-xs text-text-subtle">{note}</dd>}
    </div>
  );
}
