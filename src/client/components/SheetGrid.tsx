import { AlertTriangle, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Link2, Lock, LockOpen, RotateCw } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { tint } from '../../shared/accounts';
import { changedSinceLock, liveValue, shownValue, usesField, type SheetField, type SheetLine, type Value } from '../../shared/salesSheets';
import { cellText, display, visibleColumns, type Col, type Group } from '../../shared/sheetExport';
import { Button, cx } from './ui';

// The grid of the Activity sheet and the Daily report. Columns come in groups (Job, Dates, Revenue …) that open
// and close, so the forty-odd columns of the old workbook fit on a screen: a closed group shows one summary column.
// Rows come in sections (an account, a client) that also fold. A value from the job is shown as it is and fixed in
// the job (the link icon opens the right stage); a value typed here is an input; a calculated one is greyed.
// A checked line is locked: its inputs close and it shows who checked it.

export type GridLine = SheetLine & { carried?: { from: string; keys: string[] } | null };

export interface GridSection { key: string; title: string; color?: string; lines: GridLine[]; aside?: ReactNode }

export const STAGE_PATH: Record<string, string> = { design: 'design', preparation: 'preparation', execution: 'execution', closure: 'closure', crew: 'preparation' };

export function useOpenGroups(storageKey: string, initial: string[]) {
  const [open, setOpen] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem(storageKey); if (s) return new Set(JSON.parse(s) as string[]); } catch { /* private mode */ }
    return new Set(initial);
  });
  const set = (next: Set<string>) => { setOpen(next); try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* private mode */ } };
  return [open, set] as const;
}

/** The column-group switches above a grid: each group opens or closes, or all at once. */
export function GroupSwitches({ groups, open, setOpen, available }: { groups: readonly Group[]; open: Set<string>; setOpen: (s: Set<string>) => void; available: Set<string> }) {
  const shown = groups.filter((g) => available.has(g.key));
  const all = shown.every((g) => open.has(g.key));
  return (
    <div className="flex flex-wrap items-center gap-1.5 print:hidden" role="group" aria-label="Column groups">
      <span className="label-caps mr-1 text-text-muted">Columns</span>
      {shown.map((g) => {
        const on = open.has(g.key);
        return (
          <button key={g.key} type="button" aria-pressed={on} title={`${on ? 'Fold' : 'Open'} ${g.label}: ${g.hint ?? ''}`}
            onClick={() => { const n = new Set(open); if (on) n.delete(g.key); else n.add(g.key); setOpen(n); }}
            className={cx('inline-flex h-(--layout-control-sm) items-center gap-1 rounded-pill border px-3 text-sm font-semibold', on ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>
            {on ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}{g.label}
          </button>
        );
      })}
      <Button size="sm" variant="ghost" onClick={() => setOpen(all ? new Set() : new Set(shown.map((g) => g.key)))}>
        {all ? <ChevronsDownUp aria-hidden className="size-3.5" /> : <ChevronsUpDown aria-hidden className="size-3.5" />}{all ? 'Fold all columns' : 'Open all columns'}
      </Button>
    </div>
  );
}

export function Editor({ f, line, value, choices, onSave }: { f: SheetField; line: GridLine; value: Value; choices?: readonly string[]; onSave: (v: string) => void }) {
  const label = `${f.label} for ${line.app.ticket ?? line.app.unit ?? line.id}`;
  const base = 'h-7 w-full min-w-0 rounded border border-transparent bg-transparent px-1 text-sm hover:border-border focus:border-accent focus:bg-surface focus:outline-none';
  const cur = value === null || value === undefined ? '' : String(value);
  if (f.type === 'choice' || f.type === 'yesno') {
    const opts = [...new Set([...(choices ?? f.choices ?? []), ...(cur ? [cur] : [])])];
    return (
      <select aria-label={label} className={cx(base, 'pr-0', !cur && 'text-text-subtle')} value={cur} onChange={(e) => onSave(e.target.value)}>
        <option value="">—</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  const type = f.type === 'date' ? 'date' : f.type === 'month' ? 'month' : f.type === 'number' || f.type === 'money' ? 'number' : 'text';
  // keyed by the stored value, so a save (or someone else's) resets the box
  return (
    <input key={cur} aria-label={label} type={type} defaultValue={cur} step={type === 'number' ? 'any' : undefined} min={type === 'number' ? 0 : undefined}
      className={cx(base, (f.type === 'number' || f.type === 'money') && 'text-right font-mono')} title={f.type === 'longtext' ? cur : undefined}
      onBlur={(e) => { if (e.target.value !== cur) onSave(e.target.value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { (e.target as HTMLInputElement).value = cur; (e.target as HTMLInputElement).blur(); } }} />
  );
}

export function SheetGrid({ caption, fields, groups, open, sections, lead, canEdit, canUnlock, choicesFor, onSave, onLock, onUnlock, selected, setSelected, foldedSections, setFoldedSections }: {
  caption: string;
  fields: SheetField[];
  groups: readonly Group[];
  open: Set<string>;
  sections: GridSection[];
  lead: { label: string; render: (l: GridLine) => ReactNode; width: string };
  canEdit: boolean;
  canUnlock: boolean;
  choicesFor?: (f: SheetField, l: GridLine) => readonly string[] | undefined;
  onSave: (l: GridLine, key: string, value: string) => void;
  onLock: (ids: string[]) => void;
  onUnlock: (ids: string[]) => void;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  foldedSections: Set<string>;
  setFoldedSections: (s: Set<string>) => void;
}) {
  const lines = sections.flatMap((s) => s.lines);
  const cols: Col[] = visibleColumns(fields, groups, lines, open);
  const groupRuns: { key: string; label: string; span: number }[] = [];
  for (const c of cols) {
    const last = groupRuns[groupRuns.length - 1];
    if (last?.key === c.group) last.span++;
    else groupRuns.push({ key: c.group, label: groups.find((g) => g.key === c.group)?.label ?? c.group, span: 1 });
  }
  const pickable = lines.filter((l) => !l.locked);
  const allPicked = pickable.length > 0 && pickable.every((l) => selected.has(l.id));

  return (
    <div className="relative max-h-[calc(100vh-14rem)] overflow-auto rounded-lg border border-border bg-surface print:max-h-none print:overflow-visible">
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-20 bg-surface-2">
          <tr>
            <th scope="col" rowSpan={2} className={cx('sticky left-0 z-30 border-b border-r border-border bg-surface-2 px-2 py-2 text-left align-bottom', lead.width)}>
              <span className="flex items-center gap-2">
                {canEdit && <input type="checkbox" aria-label="Pick every line not yet checked" className="size-4" checked={allPicked} disabled={!pickable.length}
                  onChange={() => setSelected(allPicked ? new Set() : new Set(pickable.map((l) => l.id)))} />}
                <span className="label-caps text-text-muted">{lead.label}</span>
              </span>
            </th>
            {groupRuns.map((g, i) => (
              <th key={`${g.key}-${i}`} scope="colgroup" colSpan={g.span} className="border-b border-l border-border px-2 py-1 text-left">
                <span className="label-caps text-text-subtle">{g.span > 1 || cols.find((c) => c.group === g.key && !c.summary) ? g.label : ''}</span>
              </th>
            ))}
          </tr>
          <tr>
            {cols.map((c, i) => (
              <th key={c.key} scope="col" title={c.summary ? `${c.label} is folded: open it above to see every column` : [c.field?.hint, c.highlight ? 'Only some accounts keep this column' : ''].filter(Boolean).join('. ') || undefined}
                className={cx('label-caps border-b border-border px-2 py-2 text-left whitespace-nowrap', c.highlight ? 'bg-warning-subtle text-warning' : 'text-text-muted', (i === 0 || cols[i - 1].group !== c.group) && 'border-l',
                  c.field && (c.field.type === 'number' || c.field.type === 'money') && 'text-right', c.summary && 'italic')}>
                {c.label}{c.field?.source === 'calc' && <span className="ml-1 font-normal normal-case text-text-subtle">=</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((s) => {
            const folded = foldedSections.has(s.key);
            const checked = s.lines.filter((l) => l.locked).length;
            return (
              <Fragment key={s.key}>
                <tr>
                  <th scope="rowgroup" colSpan={cols.length + 1} className="border-b border-border p-0 text-left" style={{ backgroundColor: tint(s.color, 30) }}>
                    <div className="sticky left-0 flex w-max max-w-[100vw] flex-wrap items-center gap-2 px-2 py-1.5">
                      <button type="button" aria-expanded={!folded} aria-label={`${folded ? 'Show' : 'Fold'} ${s.title}`} onClick={() => { const n = new Set(foldedSections); if (folded) n.delete(s.key); else n.add(s.key); setFoldedSections(n); }}
                        className="inline-flex items-center gap-1.5 rounded font-display text-xs font-extrabold tracking-wide uppercase">
                        {folded ? <ChevronRight aria-hidden className="size-4" /> : <ChevronDown aria-hidden className="size-4" />}
                        <i aria-hidden className="inline-block size-3 rounded-full border border-black/10" style={{ backgroundColor: s.color }} />{s.title}
                      </button>
                      <span className="font-mono text-xs text-text-muted">{s.lines.length} line{s.lines.length === 1 ? '' : 's'} · {checked} checked</span>
                      {s.aside}
                    </div>
                  </th>
                </tr>
                {!folded && s.lines.map((l) => {
                  const bg = tint(s.color, l.locked ? 8 : 14);
                  const changed = changedSinceLock(l, fields);
                  return (
                    <tr key={l.id} style={{ backgroundColor: bg }} className={cx('group', l.locked && 'text-text-muted')}>
                      <th scope="row" className={cx('sticky left-0 z-10 border-b border-r border-border px-2 py-1 text-left align-middle font-normal', lead.width)}
                        style={{ backgroundColor: bg ?? 'var(--color-surface)', boxShadow: s.color ? `inset 4px 0 ${s.color}` : undefined }}>
                        <div className="flex items-center gap-2 pl-1">
                          {canEdit && !l.locked && <input type="checkbox" aria-label={`Pick ${l.app.ticket ?? l.id}`} className="size-4" checked={selected.has(l.id)}
                            onChange={() => { const n = new Set(selected); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); setSelected(n); }} />}
                          {l.locked && <span title={`Checked by ${l.locked.name ?? l.locked.by} on ${new Date(l.locked.at).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })} Riyadh`}><Lock aria-label="Checked and locked" className="size-4 text-success" /></span>}
                          <div className="min-w-0 flex-1">{lead.render(l)}</div>
                          {changed.length > 0 && <span title={`Changed in the job since it was checked: ${changed.join(', ')}`}><AlertTriangle aria-label="Changed since checked" className="size-4 text-warning" /></span>}
                          {canEdit && !l.locked && <Button size="sm" variant="ghost" title="Mark this line checked and lock it" onClick={() => onLock([l.id])}><Lock aria-hidden className="size-3.5" /><span className="sr-only">Check and lock</span></Button>}
                          {canUnlock && l.locked && <Button size="sm" variant="ghost" title="Unlock this line (Admin)" onClick={() => onUnlock([l.id])}><LockOpen aria-hidden className="size-3.5" /><span className="sr-only">Unlock</span></Button>}
                        </div>
                      </th>
                      {cols.map((c, i) => {
                        const edge = (i === 0 || cols[i - 1].group !== c.group) && 'border-l';
                        const f = c.field;
                        if (!f) return <td key={c.key} className={cx('max-w-72 truncate border-b border-border px-2 py-1 text-xs text-text-muted', edge)} title={cellText(c, l, fields)}>{cellText(c, l, fields)}</td>;
                        if (!usesField(f, l.format)) return <td key={c.key} className={cx('border-b border-border bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--color-border)_6px_7px)] px-2 py-1 text-xs text-text-subtle', edge)}><span className="sr-only">not used for this account</span></td>;
                        const v = shownValue(f, l, fields);
                        const num = f.type === 'number' || f.type === 'money';
                        const editable = canEdit && !l.locked && (f.source === 'sheet' || f.source === 'both');
                        const overridden = f.source === 'both' && l.data[f.key] != null && l.data[f.key] !== '' && String(l.data[f.key]) !== String(l.app[f.key] ?? '');
                        const carried = l.carried?.keys.includes(f.key);
                        const stage = f.stage && l.job_id ? `/operation/jobs/${l.job_id}/${STAGE_PATH[f.stage]}` : null;
                        return (
                          <td key={c.key} className={cx('border-b border-border px-1 py-0.5 align-middle', edge, num && 'text-right font-mono', f.type === 'longtext' ? 'min-w-56' : f.type === 'text' || f.type === 'choice' ? 'min-w-32' : 'min-w-24')}>
                            {editable ? (
                              <div className="flex items-center gap-1">
                                <div className="min-w-0 flex-1"><Editor f={f} line={l} value={l.data[f.key] ?? (f.source === 'both' ? liveValue(f, { app: l.app, data: {} }, fields) : null)} choices={choicesFor?.(f, l)} onSave={(val) => onSave(l, f.key, val)} /></div>
                                {overridden && <span title={`Changed here; the app suggests ${display(f, l.app[f.key] ?? null) || 'nothing'}`} className="size-1.5 shrink-0 rounded-full bg-accent" />}
                                {carried && <span title={`Carried over from ${l.carried!.from}`}><RotateCw aria-label="Carried over" className="size-3 shrink-0 text-text-subtle" /></span>}
                              </div>
                            ) : (
                              <span className={cx('flex items-center gap-1 px-1 whitespace-nowrap', f.source === 'calc' && 'font-semibold text-text-muted', num && 'justify-end')}>
                                {v === null || v === '' ? <span className="text-text-subtle">—</span> : <span className={cx(f.type === 'longtext' && 'max-w-72 truncate')} title={String(v)}>{display(f, v)}</span>}
                                {f.source === 'app' && stage && !l.locked && canEdit && (
                                  <Link to={stage} title={`${v === null || v === '' ? 'Missing: fill it' : 'Change it'} in the job (${f.stage})`} className={cx('hover:text-accent-text hover:opacity-100 focus-visible:opacity-100', v === null || v === '' ? 'text-warning opacity-80' : 'text-text-subtle opacity-0 group-hover:opacity-60')}>
                                    <Link2 aria-hidden className="size-3" /><span className="sr-only">Open the job to change {f.label}</span>
                                  </Link>
                                )}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** What the cell styles mean, under the grid. */
export function SheetLegend() {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted print:hidden">
      <span className="inline-flex items-center gap-1"><Link2 aria-hidden className="size-3" />From the job: fix it in the job</span>
      <span className="inline-flex items-center gap-1"><i aria-hidden className="inline-block h-3 w-5 rounded border border-border bg-surface" />Typed here</span>
      <span className="inline-flex items-center gap-1"><span className="font-semibold">=</span>Calculated</span>
      <span className="inline-flex items-center gap-1"><i aria-hidden className="inline-block h-3 w-5 rounded bg-warning-subtle" />Only some accounts keep this column</span>
      <span className="inline-flex items-center gap-1"><i aria-hidden className="inline-block h-3 w-5 rounded bg-[repeating-linear-gradient(135deg,transparent_0_4px,var(--color-border)_4px_5px)]" />Not used by this line’s account</span>
      <span className="inline-flex items-center gap-1"><Lock aria-hidden className="size-3 text-success" />Checked and locked</span>
      <span className="inline-flex items-center gap-1"><AlertTriangle aria-hidden className="size-3 text-warning" />Changed in the job after it was checked</span>
    </p>
  );
}
