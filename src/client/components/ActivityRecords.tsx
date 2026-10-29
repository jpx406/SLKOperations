import { AlertTriangle, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Link2, Lock, LockOpen } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { tint } from '../../shared/accounts';
import { changedSinceLock, liveValue, shownValue, usesField, type SheetField } from '../../shared/salesSheets';
import { display, type Group } from '../../shared/sheetExport';
import { Editor, STAGE_PATH, type GridLine, type GridSection } from './SheetGrid';
import { Button, cx } from './ui';

// The Activity sheet on screen, laid out like its full-detail PDF (owner request 2026-10-28): one line per job with
// the basics, grouped by account. Unfolding a job shows every field in labelled group blocks (Job, Crew, Dates …),
// typed fields as inputs and job fields with a link to fix them in the job. The lock at the end of the line checks
// and locks it (closed lock) or, for an Admin, unlocks it (open lock).

const SUMMARY = ['revenue_month', 'account', 'entity', 'field_rig', 'well', 'job_type', 'job_status', 'unit'];

function FieldRow({ f, l, fields, canEdit, choices, onSave }: {
  f: SheetField; l: GridLine; fields: SheetField[]; canEdit: boolean; choices?: readonly string[]; onSave: (key: string, v: string) => void;
}) {
  const v = shownValue(f, l, fields);
  const editable = canEdit && !l.locked && (f.source === 'sheet' || f.source === 'both');
  const stage = f.stage && l.job_id ? `/operation/jobs/${l.job_id}/${STAGE_PATH[f.stage]}` : null;
  const empty = v === null || v === '';
  const overridden = f.source === 'both' && l.data[f.key] != null && l.data[f.key] !== '' && String(l.data[f.key]) !== String(l.app[f.key] ?? '');
  return (
    <div className={cx('grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-2 rounded px-1.5 py-0.5', f.formats && 'bg-warning-subtle/60')}
      title={[f.hint, f.formats ? 'Only some accounts keep this field' : ''].filter(Boolean).join('. ') || undefined}>
      <span className="truncate text-xs text-text-muted">{f.label}{f.source === 'calc' && <span className="ml-1 text-text-subtle">=</span>}</span>
      {editable ? (
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1 [&_input]:text-left">
            <Editor f={f} line={l} value={l.data[f.key] ?? (f.source === 'both' ? liveValue(f, { app: l.app, data: {} }, fields) : null)} choices={choices} onSave={(val) => onSave(f.key, val)} />
          </span>
          {overridden && <span title={`Changed here; the job says ${display(f, l.app[f.key] ?? null) || 'nothing'}`} className="size-1.5 shrink-0 rounded-full bg-accent" />}
        </span>
      ) : (
        <span className={cx('flex min-w-0 items-center gap-1 px-1 text-sm', f.source === 'calc' && 'font-semibold', (f.type === 'number' || f.type === 'money') && 'font-mono')}>
          <span className={cx('truncate', empty && 'text-text-subtle')} title={empty ? undefined : String(v)}>{empty ? '—' : display(f, v)}</span>
          {f.source === 'app' && stage && canEdit && !l.locked && (
            <Link to={stage} title={`${empty ? 'Missing: fill it' : 'Change it'} in the job (${f.stage})`}
              className={cx('touch-target inline-flex shrink-0 items-center justify-center hover:text-accent-text', empty ? 'text-warning' : 'text-text-subtle opacity-60 hover:opacity-100')}>
              <Link2 aria-hidden className="size-3.5" /><span className="sr-only">Open the job to change {f.label}</span>
            </Link>
          )}
        </span>
      )}
    </div>
  );
}

function Detail({ l, fields, groups, canEdit, choicesFor, onSave }: {
  l: GridLine; fields: SheetField[]; groups: readonly Group[]; canEdit: boolean;
  choicesFor?: (f: SheetField, l: GridLine) => readonly string[] | undefined; onSave: (l: GridLine, key: string, v: string) => void;
}) {
  const used = fields.filter((f) => usesField(f, l.format));
  const comment = used.find((f) => f.type === 'longtext');
  const blocks = groups.map((g) => ({ g, fs: used.filter((f) => f.group === g.key && f !== comment) })).filter((b) => b.fs.length);
  const changed = changedSinceLock(l, fields);
  return (
    <div className="px-3 pt-2 pb-3">
      {l.locked && (
        <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <Lock aria-hidden className="size-3.5 text-success" />Checked by {l.locked.name ?? l.locked.by} on {new Date(l.locked.at).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })} Riyadh. The values are frozen; an Admin can unlock the line.
          {changed.length > 0 && <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle aria-hidden className="size-3.5" />Changed in the job since: {changed.join(', ')}</span>}
        </p>
      )}
      <div className="gap-4 [column-fill:balance] sm:columns-2 lg:columns-3 2xl:columns-5">
        {blocks.map((b) => (
          <section key={b.g.key} aria-label={b.g.label} className="mb-3 break-inside-avoid">
            <h2 className="label-caps mb-1 border-b border-border pb-1 text-text-muted">{b.g.label}</h2>
            {b.fs.map((f) => <FieldRow key={f.key} f={f} l={l} fields={fields} canEdit={canEdit} choices={choicesFor?.(f, l)} onSave={(k, v) => onSave(l, k, v)} />)}
          </section>
        ))}
      </div>
      {comment && (
        <label className="mt-1 block">
          <span className="label-caps mb-1 block text-text-muted">{comment.label}</span>
          {canEdit && !l.locked ? (
            <textarea key={String(l.data[comment.key] ?? '')} rows={2} defaultValue={String(l.data[comment.key] ?? '')} maxLength={2000}
              className="w-full rounded border border-border bg-surface px-2 py-1 text-sm focus:border-accent focus:outline-none"
              onBlur={(e) => { if (e.target.value !== String(l.data[comment.key] ?? '')) onSave(l, comment.key, e.target.value); }} />
          ) : <p className="text-sm">{display(comment, shownValue(comment, l, fields)) || <span className="text-text-subtle">—</span>}</p>}
        </label>
      )}
    </div>
  );
}

export function ActivityRecords({ caption, fields, groups, sections, canEdit, canUnlock, choicesFor, onSave, onLock, onUnlock, selected, setSelected, open, setOpen, foldedSections, setFoldedSections, lead }: {
  caption: string;
  fields: SheetField[];
  groups: readonly Group[];
  sections: GridSection[];
  canEdit: boolean;
  canUnlock: boolean;
  choicesFor?: (f: SheetField, l: GridLine) => readonly string[] | undefined;
  onSave: (l: GridLine, key: string, value: string) => void;
  onLock: (ids: string[]) => void;
  onUnlock: (ids: string[]) => void;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  /** The jobs unfolded. */
  open: Set<string>;
  setOpen: (s: Set<string>) => void;
  foldedSections: Set<string>;
  setFoldedSections: (s: Set<string>) => void;
  lead: (l: GridLine) => ReactNode;
}) {
  const summary = SUMMARY.map((k) => fields.find((f) => f.key === k)!).filter(Boolean);
  const lines = sections.flatMap((s) => s.lines);
  const pickable = lines.filter((l) => !l.locked);
  const allPicked = pickable.length > 0 && pickable.every((l) => selected.has(l.id));
  const allOpen = lines.length > 0 && lines.every((l) => open.has(l.id));
  const toggle = (id: string) => { const n = new Set(open); if (n.has(id)) n.delete(id); else n.add(id); setOpen(n); };
  const cols = summary.length + 2;

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-end gap-1 print:hidden">
        <Button size="sm" variant="ghost" onClick={() => setOpen(allOpen ? new Set() : new Set(lines.map((l) => l.id)))}>
          {allOpen ? <ChevronsDownUp aria-hidden className="size-3.5" /> : <ChevronsUpDown aria-hidden className="size-3.5" />}{allOpen ? 'Fold all jobs' : 'Unfold all jobs'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setFoldedSections(new Set())}>Show all accounts</Button>
        <Button size="sm" variant="ghost" onClick={() => setFoldedSections(new Set(sections.map((s) => s.key)))}>Fold all accounts</Button>
      </div>
      <div className="relative max-h-[calc(100vh-12rem)] overflow-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[64rem] border-separate border-spacing-0 text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-20 bg-surface-2">
            <tr>
              <th scope="col" className="sticky left-0 z-30 w-60 border-b border-r border-border bg-surface-2 px-2 py-2 text-left">
                <span className="flex items-center gap-2">
                  {canEdit && <input type="checkbox" aria-label="Pick every job not yet checked" className="size-4" checked={allPicked} disabled={!pickable.length}
                    onChange={() => setSelected(allPicked ? new Set() : new Set(pickable.map((l) => l.id)))} />}
                  <span className="label-caps text-text-muted">Job</span>
                </span>
              </th>
              {summary.map((f) => <th key={f.key} scope="col" className="label-caps border-b border-border px-2 py-2 text-left whitespace-nowrap text-text-muted">{f.label}</th>)}
              <th scope="col" className="label-caps w-24 border-b border-border px-2 py-2 text-right text-text-muted">Review</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => {
              const folded = foldedSections.has(s.key);
              return (
                <Fragment key={s.key}>
                  <tr>
                    <th scope="rowgroup" colSpan={cols} className="border-b border-border p-0 text-left" style={{ backgroundColor: tint(s.color, 30) }}>
                      <div className="sticky left-0 flex w-max max-w-full flex-wrap items-center gap-2 px-2 py-1.5">
                        <button type="button" aria-expanded={!folded} aria-label={`${folded ? 'Show' : 'Fold'} ${s.title}`}
                          onClick={() => { const n = new Set(foldedSections); if (folded) n.delete(s.key); else n.add(s.key); setFoldedSections(n); }}
                          className="touch-row inline-flex items-center gap-1.5 font-display text-xs font-extrabold tracking-wide uppercase">
                          {folded ? <ChevronRight aria-hidden className="size-4" /> : <ChevronDown aria-hidden className="size-4" />}
                          <i aria-hidden className="inline-block size-3 rounded-full border border-black/10" style={{ backgroundColor: s.color }} />{s.title}
                        </button>
                        <span className="font-mono text-xs text-text-muted">{s.lines.length} job{s.lines.length === 1 ? '' : 's'} · {s.lines.filter((l) => l.locked).length} checked</span>
                        {s.aside}
                      </div>
                    </th>
                  </tr>
                  {!folded && s.lines.map((l) => {
                    const isOpen = open.has(l.id);
                    const bg = tint(s.color, l.locked ? 8 : 14);
                    const changed = changedSinceLock(l, fields).length > 0;
                    return (
                      <Fragment key={l.id}>
                        <tr style={{ backgroundColor: bg }} className={cx(l.locked && 'text-text-muted')}>
                          <th scope="row" className="sticky left-0 z-10 border-b border-r border-border px-2 py-1.5 text-left font-normal"
                            style={{ backgroundColor: bg ?? 'var(--color-surface)', boxShadow: s.color ? `inset 4px 0 ${s.color}` : undefined }}>
                            <div className="flex items-center gap-2 pl-1">
                              {canEdit && !l.locked && <input type="checkbox" aria-label={`Pick ${l.app.ticket ?? l.id}`} className="size-4" checked={selected.has(l.id)}
                                onChange={() => { const n = new Set(selected); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); setSelected(n); }} />}
                              {l.locked && <Lock aria-label="Checked and locked" className="size-4 shrink-0 text-success" />}
                              <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? 'Fold' : 'Unfold'} ${l.app.ticket ?? 'job'}`} onClick={() => toggle(l.id)}
                                className="touch-target inline-flex items-center justify-center rounded p-0.5 text-text-muted hover:bg-surface-2 hover:text-text">
                                {isOpen ? <ChevronDown aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4" />}
                              </button>
                              <div className="min-w-0 flex-1">{lead(l)}</div>
                              {changed && <span title="Changed in the job after it was checked"><AlertTriangle aria-label="Changed since checked" className="size-4 text-warning" /></span>}
                            </div>
                          </th>
                          {summary.map((f) => {
                            const v = shownValue(f, l, fields);
                            return (
                              <td key={f.key} onClick={() => toggle(l.id)} className={cx('max-w-72 cursor-pointer border-b border-border px-2 py-1.5', f.key === 'job_type' ? 'min-w-56' : 'whitespace-nowrap')}>
                                {v === null || v === '' ? <span className="text-text-subtle">—</span> : <span className="line-clamp-2">{display(f, v)}</span>}
                              </td>
                            );
                          })}
                          <td className="border-b border-border px-2 py-1.5 text-right">
                            {l.locked ? (
                              <Button size="sm" variant="ghost" disabled={!canUnlock} onClick={() => onUnlock([l.id])}
                                title={canUnlock ? 'Checked and locked. Unlock it (Admin)' : `Checked by ${l.locked.name ?? l.locked.by}. Only an Admin can unlock it`}>
                                <Lock aria-hidden className="size-4 text-success" /><span className="sr-only">Checked and locked{canUnlock ? ': unlock' : ''}</span>
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => onLock([l.id])} title="Not checked yet. Check it and lock it">
                                <LockOpen aria-hidden className="size-4" /><span className="sr-only">Check and lock</span>
                              </Button>
                            )}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr style={{ backgroundColor: tint(s.color, 5) }}>
                            <td colSpan={cols} className="border-b border-border p-0" style={{ boxShadow: s.color ? `inset 4px 0 ${s.color}` : undefined }}>
                              <div className="sticky left-0 max-w-[calc(100vw-4rem)]">
                                <Detail l={l} fields={fields} groups={groups} canEdit={canEdit} choicesFor={choicesFor} onSave={onSave} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
