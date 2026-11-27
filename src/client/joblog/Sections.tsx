import { useQueryClient } from '@tanstack/react-query';
import { Check, ListChecks, Lock, Pencil, Plus, RefreshCw, Settings2, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { JOB_STATUSES, LOG_OPTION_KINDS, hasPhrase, phraseGroups, togglePhrase, wireFinalOf, type Bha, type JobField, type LogForm, type LogOption, type LogOptionKind, type ScalarKey } from '../../shared/jobLogForm';
import { api } from '../api';
import { Select } from '../components/Select';
import { Banner, Button, Card, Field, cx, inputClass } from '../components/ui';
import { Dialog } from '../pages/knowledge/common';
import { useConfirm, useDialogFocus } from '../components/Dialog';

// The parts of the Job log added from the owner's NESR Slickline Service Report (6z.52): the full header, the
// description checklist, and the job status, wire details, BHA per run and note.
// 6z.53: what the job has is read from the job and locked here; the rest is picked from lists people can add to,
// gauges and pick ups from the equipment list in Assets Inventory, and the wording list can be managed.

type Set = (patch: Partial<LogForm>) => void;

export interface LogOptions {
  country: string;
  custom: LogOption[];
  base: Partial<Record<LogOptionKind, string[]>>;
  equipment: { gauges: { value: string; label: string }[]; pickups: { value: string; label: string }[] };
}
/** What the header needs besides the form: the job's values, the lists, and whether lists can be changed. */
export interface HeaderCtx { locked: Partial<Record<JobField, string>>; options: LogOptions | null; canEdit: boolean; jobId: string; crew: string[] }

const valuesOf = (o: LogOptions | null, kind: LogOptionKind) =>
  [...new Set([...(o?.base[kind] ?? []), ...(o?.custom ?? []).filter((x) => x.kind === kind).map((x) => x.value)])];

function useOptionSaver(ctx: { jobId: string; options: LogOptions | null }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await qc.invalidateQueries({ queryKey: ['joblog', ctx.jobId] }); return true; } catch (e) { setError((e as Error).message); return false; }
  };
  return {
    error,
    add: (kind: LogOptionKind, value: string, grp = '') => run(() => api('/log-options', { method: 'POST', json: { country: ctx.options?.country, kind, grp, value } })),
    change: (id: string, body: { value?: string; grp?: string; active?: boolean }) => run(() => api(`/log-options/${id}`, { method: 'PATCH', json: body })),
  };
}

/** A header field: locked when the job has it, else typed or picked from the list, with a way to add what was typed. */
function Pick({ f, k, label, ro, set, ctx, kind, unit, placeholder }: { f: LogForm; k: ScalarKey; label: string; ro: boolean; set: Set; ctx: HeaderCtx; kind?: LogOptionKind; unit?: string; placeholder?: string }) {
  const saver = useOptionSaver(ctx);
  const lockedValue = (ctx.locked as Record<string, string | undefined>)[k];
  const id = `jl-${k}`;
  if (lockedValue) {
    return (
      <Field id={id} label={label} unit={unit} hint={<span className="inline-flex items-center gap-1"><Lock aria-hidden className="size-3" />From the job</span>}>
        <input id={id} className={cx(inputClass, 'bg-surface-2', unit && 'pr-10')} readOnly aria-readonly value={lockedValue} />
      </Field>
    );
  }
  const list = kind ? (kind === 'supervisor' || kind === 'operator1' || kind === 'operator2' ? [...new Set([...ctx.crew, ...valuesOf(ctx.options, kind)])] : valuesOf(ctx.options, kind)) : [];
  const v = String(f[k] ?? '');
  const canAdd = !ro && ctx.canEdit && !!kind && !!ctx.options && !!v.trim() && !list.some((x) => x.toLowerCase() === v.trim().toLowerCase());
  return (
    <Field id={id} label={label} unit={unit} error={saver.error} hint={canAdd ? undefined : kind && !ro ? 'Pick from the list or type' : undefined}>
      <input id={id} list={kind ? `${id}-list` : undefined} className={cx(inputClass, unit && 'pr-10', canAdd && 'pr-24')} disabled={ro} value={v} placeholder={placeholder} onChange={(e) => set({ [k]: e.target.value } as Partial<LogForm>)} />
      {kind && <datalist id={`${id}-list`}>{list.map((o) => <option key={o} value={o} />)}</datalist>}
      {canAdd && <button type="button" className="absolute top-1/2 right-1.5 inline-flex h-7 -translate-y-1/2 items-center gap-1 rounded-sm bg-surface-3 px-2 text-xs font-semibold hover:bg-surface-2" onClick={() => void saver.add(kind!, v.trim())}><Plus aria-hidden className="size-3" />Add to list</button>}
    </Field>
  );
}

/** Equipment picked from Assets Inventory → Equipment. A value saved before stays shown. */
function EquipmentPick({ f, k, label, ro, set, items, type }: { f: LogForm; k: ScalarKey; label: string; ro: boolean; set: Set; items: { value: string; label: string }[]; type: string }) {
  const v = String(f[k] ?? '');
  const all = v && !items.some((i) => i.value === v) ? [{ value: v, label: `${v} (not on the list)` }, ...items] : items;
  return (
    <Field id={`jl-${k}`} label={label} hint={!items.length ? <>No {type.toLowerCase()} on the list yet: add them in <Link className="underline" to="/operation/database?tab=equipment">Assets Inventory → Equipment</Link>.</> : undefined}>
      <Select id={`jl-${k}`} className={inputClass} disabled={ro} value={v} onChange={(e) => set({ [k]: e.target.value } as Partial<LogForm>)}>
        <option value="">—</option>
        {all.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
      </Select>
    </Field>
  );
}

/** Two values side by side under one label: flowing (FL) and shut in (SI) pressures. */
function Pair({ f, a, b, label, ro, set, locked }: { f: LogForm; a: ScalarKey; b: ScalarKey; label: string; ro: boolean; set: Set; locked?: Partial<Record<string, string>> }) {
  return (
    <div>
      <p className="label-caps mb-1.5 text-text-muted">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        {([[a, 'FL'], [b, 'SI']] as const).map(([k, l]) => {
          const lv = locked?.[k];
          return (
            <div key={k} className="relative">
              <input aria-label={`${label} ${l === 'FL' ? 'flowing' : 'shut in'}`} title={lv ? 'From the job (SIWHP)' : undefined} className={cx(inputClass, 'pl-9 pr-10', lv && 'bg-surface-2')} inputMode="decimal" disabled={ro && !lv} readOnly={!!lv} value={lv ?? String(f[k] ?? '')} onChange={(e) => set({ [k]: e.target.value } as Partial<LogForm>)} />
              <span aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-xs text-text-subtle">{l}</span>
              <span aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-xs text-text-subtle">psi</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function HeaderCard({ f, ro, set, ctx }: { f: LogForm; ro: boolean; set: Set; ctx: HeaderCtx }) {
  const p = (k: ScalarKey, label: string, kind?: LogOptionKind, o: { unit?: string; placeholder?: string } = {}) => <Pick key={k} f={f} k={k} label={label} ro={ro} set={set} ctx={ctx} kind={kind} {...o} />;
  const eq = ctx.options?.equipment ?? { gauges: [], pickups: [] };
  const lockedN = Object.keys(ctx.locked).filter((k) => !k.startsWith('wire')).length;
  return (
    <Card className="mb-4 p-4">
      <h2 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold">Header <span className="font-normal text-text-subtle">{lockedN ? 'fields with a lock come from the job; change them on the job' : 'read from the job'} · the rest from the lists or typed</span></h2>
      <h3 className="label-caps mb-2 text-accent-text">Well</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {p('well', 'Well number', 'well')}
        {ctx.locked.date ? p('date', 'Date') : <Field id="jl-date" label="Date"><input id="jl-date" type="date" className={inputClass} disabled={ro} value={f.date} onChange={(e) => set({ date: e.target.value })} /></Field>}
        {p('jobType', 'Job type', 'jobType')}
        {p('rig', 'Rig / rigless / site', 'rig')}
        {p('field', 'Field', 'field')}
        {p('customer', 'Client', 'customer')}
        {p('ticket', 'Ticket no.')}
        {p('wellType', 'Well type', 'wellType')}
        {p('tubingSize', 'Tubing size', 'tubingSize')}
        {p('whConnection', 'W/H connection', 'whConnection')}
        <Pair f={f} a="tubingFl" b="tubingSi" label="Tubing pressure" ro={ro} set={set} locked={ctx.locked} />
        <Pair f={f} a="casingFl" b="casingSi" label="Casing pressure" ro={ro} set={set} />
        <Pair f={f} a="arrFl" b="arrSi" label="Well status arrival" ro={ro} set={set} />
        <Pair f={f} a="depFl" b="depSi" label="Well status departure" ro={ro} set={set} />
        {p('locationCond', 'Location condition', 'locationCond')}
      </div>
      <h3 className="label-caps mt-4 mb-2 text-accent-text">Crew and equipment</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {p('supervisor', 'SLK supervisor', 'supervisor', { placeholder: 'Name - ID' })}
        {p('operator1', 'SLK operator', 'operator1', { placeholder: 'Name - ID' })}
        {p('operator2', 'SLK operator', 'operator2', { placeholder: 'Name - ID' })}
        {p('unit', 'SLK unit number', 'unit')}
        <EquipmentPick f={f} k="pickup" label="Pick up number" ro={ro} set={set} items={eq.pickups} type="Pick ups" />
        <EquipmentPick f={f} k="gauge1" label="Memory gauge S/N" ro={ro} set={set} items={eq.gauges} type="Memory gauges" />
        <EquipmentPick f={f} k="gauge2" label="Memory gauge S/N" ro={ro} set={set} items={eq.gauges.filter((g) => g.value !== f.gauge1)} type="Memory gauges" />
      </div>
    </Card>
  );
}

/** The description's checklist: tick the usual wording to add it, untick to take it out; the text stays free to edit. */
export function PhrasePicker({ value, onChange, label, ctx }: { value: string; onChange: (v: string) => void; label: string; ctx: HeaderCtx }) {
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLDivElement>(null);
  // a fixed layer placed by the button, so the table's scroll box does not cut it off
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(416, window.innerWidth - 32), below = window.innerHeight - r.bottom - 12, above = r.top - 12;
      const left = Math.max(16, Math.min(r.right - w, window.innerWidth - w - 16));
      setPos(below >= 320 || below >= above ? { left, top: r.bottom + 4, maxH: below } : { left, top: Math.max(8, r.top - 4 - Math.min(440, above)), maxH: above });
    };
    place();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => { document.removeEventListener('mousedown', off); };
  }, [open]);
  const all = phraseGroups((ctx.options?.custom ?? []).filter((o) => o.kind === 'phrase'));
  const groups = all.map((g) => ({ ...g, phrases: g.phrases.filter((p) => p.toLowerCase().includes(q.toLowerCase())) })).filter((g) => g.phrases.length);
  return (
    <div ref={box}>
      <div ref={btn}><Button size="sm" variant="ghost" aria-label={`Choose wording for ${label}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}><ListChecks aria-hidden className="size-4" /></Button></div>
      {open && pos && (
        <PopoverPanel onClose={() => setOpen(false)} label={`Wording for ${label}`} style={{ left: pos.left, top: pos.top, maxHeight: Math.min(440, pos.maxH) }} className="fixed z-50 flex w-[min(26rem,calc(100vw-2rem))] flex-col rounded-md border border-border-strong bg-surface p-2 shadow-lg">
          <input aria-label="Filter the wording" className={cx(inputClass, 'mb-2')} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {groups.map((g) => (
              <fieldset key={g.group} className="mb-2">
                <legend className="label-caps mb-1 text-text-muted">{g.group}</legend>
                {g.phrases.map((p) => {
                  const on = hasPhrase(value, p);
                  return (
                    <label key={p} className={cx('flex cursor-pointer items-start gap-2 rounded-sm px-1.5 py-1 text-xs hover:bg-surface-2', on && 'bg-surface-3 font-semibold')}>
                      <input type="checkbox" className="mt-0.5" checked={on} onChange={() => onChange(togglePhrase(value, p))} />
                      <span>{p}</span>
                    </label>
                  );
                })}
              </fieldset>
            ))}
            {!groups.length && <p className="px-1 py-2 text-xs text-text-muted">{all.length ? 'Nothing matches. Type it in the description instead.' : 'No wording yet.'}</p>}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
            {ctx.canEdit && ctx.options ? <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setManage(true); }}><Settings2 aria-hidden className="size-3.5" />Manage the list</Button>
              : <span className="text-xs text-text-subtle">Fill the ___ blanks in the description.</span>}
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}><Check aria-hidden className="size-3.5" />Done</Button>
          </div>
        </PopoverPanel>
      )}
      {manage && <ManageWording ctx={ctx} onClose={() => setManage(false)} />}
    </div>
  );
}

/** The wording popover's panel: focus moves in, Tab stays inside, Escape closes it. */
function PopoverPanel({ onClose, label, style, className, children }: { onClose: () => void; label: string; style: CSSProperties; className: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel, onClose);
  return <div ref={panel} data-dialog-panel role="dialog" aria-label={label} style={style} className={className}>{children}</div>;
}

/** Add, change and remove the wording offered in the checklist, for everyone in the country. */
function ManageWording({ ctx, onClose }: { ctx: HeaderCtx; onClose: () => void }) {
  const saver = useOptionSaver(ctx);
  const phrases = (ctx.options?.custom ?? []).filter((o) => o.kind === 'phrase');
  const groups = phraseGroups(phrases).map((g) => g.group);
  const [grp, setGrp] = useState(groups[0] ?? 'Other');
  const [newGrp, setNewGrp] = useState('');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: string; value: string; grp: string } | null>(null);
  const add = async () => { if (await saver.add('phrase', text.trim(), grp === '+' ? newGrp.trim() : grp)) { setText(''); if (grp === '+' && newGrp.trim()) { setGrp(newGrp.trim()); setNewGrp(''); } } };
  const [ask, confirmDialog] = useConfirm();
  return (
    <Dialog title={`${LOG_OPTION_KINDS.phrase} · ${ctx.options?.country ?? ''}`} onClose={onClose} wide>
      {confirmDialog}
      <p className="mb-3 text-sm text-text-muted">The checklist by each work description. Changes are for everyone in {ctx.options?.country}. Use ___ for a blank to fill in. Logs that already used a wording keep their text.</p>
      {saver.error && <div className="mb-3"><Banner tone="danger">{saver.error}</Banner></div>}
      <div className="mb-4 grid gap-2 rounded-md border border-border bg-surface-2 p-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
        <Field id="jl-ph-grp" label="Group">
          <Select id="jl-ph-grp" className={inputClass} value={grp} onChange={(e) => setGrp(e.target.value)}>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            <option value="+">New group…</option>
          </Select>
        </Field>
        <Field id="jl-ph-text" label="Wording"><input id="jl-ph-text" className={inputClass} value={text} placeholder="e.g. RIH W/ ___ AND SET AT ___ FT DF." onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) void add(); }} /></Field>
        <Button variant="primary" disabled={!text.trim() || (grp === '+' && !newGrp.trim())} onClick={() => void add()}><Plus aria-hidden className="size-4" />Add</Button>
        {grp === '+' && <div className="sm:col-span-3"><Field id="jl-ph-newgrp" label="New group name"><input id="jl-ph-newgrp" className={inputClass} value={newGrp} onChange={(e) => setNewGrp(e.target.value)} /></Field></div>}
      </div>
      {phraseGroups(phrases).map((g) => (
        <section key={g.group} className="mb-3">
          <h3 className="label-caps mb-1 text-accent-text">{g.group}</h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {phrases.filter((o) => o.grp === g.group).map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-sm">
                {editing?.id === o.id ? (
                  <>
                    <Select aria-label="Group" className={cx(inputClass, 'w-44')} value={editing.grp} onChange={(e) => setEditing({ ...editing, grp: e.target.value })}>
                      {groups.map((x) => <option key={x} value={x}>{x}</option>)}
                    </Select>
                    <input aria-label="Wording" autoFocus className={cx(inputClass, 'min-w-48 flex-1')} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} />
                    <Button size="sm" variant="primary" disabled={!editing.value.trim()} onClick={async () => { if (await saver.change(o.id, { value: editing.value, grp: editing.grp })) setEditing(null); }}><Check aria-hidden className="size-3.5" />Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1">{o.value}</span>
                    <Button size="sm" variant="ghost" aria-label={`Change ${o.value}`} onClick={() => setEditing({ id: o.id, value: o.value, grp: o.grp })}><Pencil aria-hidden className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="text-danger" aria-label={`Remove ${o.value}`} onClick={async () => { if (await ask({ title: `Remove “${o.value}” from the list?`, body: 'Logs that already used it keep their text.', confirm: 'Remove wording', danger: true })) void saver.change(o.id, { active: false }); }}><Trash2 aria-hidden className="size-3.5" /></Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!phrases.length && <p className="text-sm text-text-muted">The list is empty. Add the first wording above.</p>}
    </Dialog>
  );
}

/** Job status, wire details (from the job), the BHA of each run and the note. */
export function JobDetailsCard({ f, ro, set, toolBha, locked }: { f: LogForm; ro: boolean; set: Set; toolBha: Bha[]; locked: Partial<Record<JobField, string>> }) {
  const t = (k: ScalarKey, label: string, unit?: string) => {
    const lv = (locked as Record<string, string | undefined>)[k];
    return (
      <Field key={k} id={`jl-${k}`} label={label} unit={unit} hint={lv ? <span className="inline-flex items-center gap-1"><Lock aria-hidden className="size-3" />From the job</span> : undefined}>
        <input id={`jl-${k}`} className={cx(inputClass, unit && 'pr-10', lv && 'bg-surface-2')} disabled={ro && !lv} readOnly={!!lv} value={lv ?? String(f[k] ?? '')} onChange={(e) => set({ [k]: e.target.value } as Partial<LogForm>)} />
      </Field>
    );
  };
  const setBha = (i: number, patch: Partial<Bha>) => set({ bha: f.bha.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const runsInLog = [...new Set(f.rows.map((r) => r.run).filter(Boolean))];
  const missing = runsInLog.filter((r) => !f.bha.some((b) => b.run === r));
  const final = wireFinalOf({ ...f, ...locked });
  const [ask, confirmDialog] = useConfirm();
  return (
    <Card className="mb-4 p-4">
      {confirmDialog}
      <h2 className="mb-3 text-sm font-semibold">Job status, wire and BHA</h2>
      <fieldset className="mb-4">
        <legend className="label-caps mb-1.5 text-text-muted">Job status</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(JOB_STATUSES) as [keyof typeof JOB_STATUSES, string][]).map(([k, l]) => (
            <label key={k} className={cx('inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm', f.status === k ? 'border-accent-text bg-surface-3 font-semibold' : 'border-border bg-surface')}>
              <input type="radio" name="jl-status" disabled={ro} checked={f.status === k} onChange={() => set({ status: k })} />{l}
            </label>
          ))}
        </div>
      </fieldset>
      <h3 className="label-caps mb-2 flex flex-wrap items-center gap-2 text-accent-text">Wire details <span className="font-sans text-xs font-normal tracking-normal text-text-subtle normal-case">the wire on the job (WIREGUARD), the max pull and the wire cut from Execution</span></h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {t('wireType', 'Type')}
        {t('wireSize', 'Size')}
        {t('wireInitial', 'Initial length', 'ft')}
        {t('wireMaxPull', 'Max. pull', 'lb')}
        {t('wireHrs', 'Hrs in hole')}
        {t('wireCut', 'Wire cut', 'ft')}
        <Field id="jl-wireFinal" label="Final length" unit="ft">
          <input id="jl-wireFinal" className={cx(inputClass, 'pr-10')} disabled={ro} value={f.wireFinal} placeholder={final ? `${final} (worked out)` : ''} onChange={(e) => set({ wireFinal: e.target.value })} />
        </Field>
      </div>
      <h3 className="label-caps mt-4 mb-2 flex flex-wrap items-center gap-2 text-accent-text">
        BHA per run <span className="font-sans text-xs font-normal tracking-normal text-text-subtle normal-case">read from each run’s tool string, can be changed</span>
      </h3>
      <div className="grid gap-2">
        {f.bha.map((b, i) => (
          <div key={i} className="flex items-start gap-2">
            <label className="flex w-24 shrink-0 items-center gap-1 text-sm font-semibold">Run
              <input aria-label={`BHA ${i + 1} run number`} inputMode="numeric" className={cx(inputClass, 'w-12 px-2')} disabled={ro} value={b.run} onChange={(e) => setBha(i, { run: e.target.value.replace(/[^\d]/g, '').slice(0, 3) })} />
            </label>
            <textarea aria-label={`Run ${b.run || i + 1} BHA`} rows={2} className={cx(inputClass, 'h-auto min-h-10 flex-1 resize-y py-1.5')} disabled={ro} value={b.text} placeholder="Rope socket + stem + knuckle joint + jar + …" onChange={(e) => setBha(i, { text: e.target.value })} />
            {!ro && <Button size="sm" variant="ghost" className="text-danger" aria-label={`Remove run ${b.run || i + 1} BHA`} onClick={() => set({ bha: f.bha.filter((_, j) => j !== i) })}><X aria-hidden className="size-3.5" /></Button>}
          </div>
        ))}
        {!f.bha.length && <p className="text-sm text-text-muted">No BHA yet. The tool strings saved in Preparation fill it, or add a run.</p>}
      </div>
      {!ro && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => set({ bha: [...f.bha, { run: String(Math.max(0, ...f.bha.map((b) => Number(b.run) || 0)) + 1), text: '' }] })}><Plus aria-hidden className="size-3.5" />Add run</Button>
          {toolBha.length > 0 && <Button size="sm" variant="ghost" onClick={async () => { if (!f.bha.some((b) => b.text.trim()) || await ask({ title: 'Replace the BHA with the tool strings saved in Preparation?', body: 'The BHA typed here is replaced.', confirm: 'Replace the BHA' })) set({ bha: toolBha.map((b) => ({ ...b })) }); }}><RefreshCw aria-hidden className="size-3.5" />Read from the tool strings</Button>}
          {missing.length > 0 && <span className="text-xs text-warning">The log has run{missing.length > 1 ? 's' : ''} {missing.join(', ')} with no BHA.</span>}
        </div>
      )}
      <div className="mt-4">
        <Field id="jl-notes" label="Note"><textarea id="jl-notes" rows={3} className={cx(inputClass, 'h-auto resize-y py-2')} disabled={ro} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </Card>
  );
}
