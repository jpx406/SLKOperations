import { Check, ListChecks, Plus, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { JOB_STATUSES, PHRASE_GROUPS, hasPhrase, togglePhrase, wireFinalOf, type Bha, type LogForm, type ScalarKey } from '../../shared/jobLogForm';
import { Button, Card, Field, cx, inputClass } from '../components/ui';

// The parts of the Job log added from the owner's NESR Slickline Service Report (6z.52): the full header, the
// description checklist, and the job status, wire details, BHA per run and note.

type Set = (patch: Partial<LogForm>) => void;

function Text({ f, k, label, ro, set, unit, placeholder }: { f: LogForm; k: ScalarKey; label: string; ro: boolean; set: Set; unit?: string; placeholder?: string }) {
  return (
    <Field id={`jl-${k}`} label={label} unit={unit}>
      <input id={`jl-${k}`} className={cx(inputClass, unit && 'pr-10')} disabled={ro} value={String(f[k] ?? '')} placeholder={placeholder} onChange={(e) => set({ [k]: e.target.value } as Partial<LogForm>)} />
    </Field>
  );
}

/** Two values side by side under one label: flowing (FL) and shut in (SI) pressures. */
function Pair({ f, a, b, label, ro, set }: { f: LogForm; a: ScalarKey; b: ScalarKey; label: string; ro: boolean; set: Set }) {
  return (
    <div>
      <p className="label-caps mb-1.5 text-text-muted">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        {([[a, 'FL'], [b, 'SI']] as const).map(([k, l]) => (
          <div key={k} className="relative">
            <input aria-label={`${label} ${l === 'FL' ? 'flowing' : 'shut in'}`} className={cx(inputClass, 'pl-9 pr-10')} inputMode="decimal" disabled={ro} value={String(f[k] ?? '')} onChange={(e) => set({ [k]: e.target.value } as Partial<LogForm>)} />
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-xs text-text-subtle">{l}</span>
            <span aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-xs text-text-subtle">psi</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HeaderCard({ f, ro, set }: { f: LogForm; ro: boolean; set: Set }) {
  const t = (k: ScalarKey, label: string, o: { unit?: string; placeholder?: string } = {}) => <Text key={k} f={f} k={k} label={label} ro={ro} set={set} {...o} />;
  return (
    <Card className="mb-4 p-4">
      <h2 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold">Header <span className="font-normal text-text-subtle">read from the job, can be changed</span></h2>
      <h3 className="label-caps mb-2 text-accent-text">Well</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {t('well', 'Well number')}
        <Field id="jl-date" label="Date"><input id="jl-date" type="date" className={inputClass} disabled={ro} value={f.date} onChange={(e) => set({ date: e.target.value })} /></Field>
        {t('jobType', 'Job type')}
        {t('rig', 'Rig / rigless / site')}
        {t('field', 'Field')}
        {t('customer', 'Client')}
        {t('ticket', 'Ticket no.')}
        {t('wellType', 'Well type', { placeholder: 'Gas, oil, water…' })}
        {t('tubingSize', 'Tubing size', { placeholder: '5 1/2"' })}
        {t('whConnection', 'W/H connection')}
        <Pair f={f} a="tubingFl" b="tubingSi" label="Tubing pressure" ro={ro} set={set} />
        <Pair f={f} a="casingFl" b="casingSi" label="Casing pressure" ro={ro} set={set} />
        <Pair f={f} a="arrFl" b="arrSi" label="Well status arrival" ro={ro} set={set} />
        <Pair f={f} a="depFl" b="depSi" label="Well status departure" ro={ro} set={set} />
        {t('locationCond', 'Location condition', { placeholder: 'Good' })}
      </div>
      <h3 className="label-caps mt-4 mb-2 text-accent-text">Crew and equipment</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {t('supervisor', 'SLK supervisor', { placeholder: 'Name - ID / Name - ID' })}
        {t('operator1', 'SLK operator', { placeholder: 'Name - ID' })}
        {t('operator2', 'SLK operator', { placeholder: 'Name - ID' })}
        {t('unit', 'SLK unit number')}
        {t('pickup', 'Pick up number')}
        {t('gauge1', 'Memory gauge S/N')}
        {t('gauge2', 'Memory gauge S/N')}
      </div>
    </Card>
  );
}

/** The description's checklist: tick the usual wording to add it, untick to take it out; the text stays free to edit. */
export function PhrasePicker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
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
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  const groups = PHRASE_GROUPS.map((g) => ({ ...g, phrases: g.phrases.filter((p) => p.toLowerCase().includes(q.toLowerCase())) })).filter((g) => g.phrases.length);
  return (
    <div ref={box}>
      <div ref={btn}><Button size="sm" variant="ghost" aria-label={`Choose wording for ${label}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}><ListChecks aria-hidden className="size-4" /></Button></div>
      {open && pos && (
        <div role="dialog" aria-label={`Wording for ${label}`} style={{ left: pos.left, top: pos.top, maxHeight: Math.min(440, pos.maxH) }} className="fixed z-50 flex w-[min(26rem,calc(100vw-2rem))] flex-col rounded-md border border-border-strong bg-surface p-2 shadow-lg">
          <input autoFocus aria-label="Filter the wording" className={cx(inputClass, 'mb-2')} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
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
            {!groups.length && <p className="px-1 py-2 text-xs text-text-muted">Nothing matches. Type it in the description instead.</p>}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
            <span className="text-xs text-text-subtle">Fill the ___ blanks in the description.</span>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}><Check aria-hidden className="size-3.5" />Done</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Job status, wire details, the BHA of each run and the note. */
export function JobDetailsCard({ f, ro, set, toolBha }: { f: LogForm; ro: boolean; set: Set; toolBha: Bha[] }) {
  const t = (k: ScalarKey, label: string, unit?: string) => <Text key={k} f={f} k={k} label={label} ro={ro} set={set} unit={unit} />;
  const setBha = (i: number, patch: Partial<Bha>) => set({ bha: f.bha.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const runsInLog = [...new Set(f.rows.map((r) => r.run).filter(Boolean))];
  const missing = runsInLog.filter((r) => !f.bha.some((b) => b.run === r));
  const final = wireFinalOf(f);
  return (
    <Card className="mb-4 p-4">
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
      <h3 className="label-caps mb-2 text-accent-text">Wire details</h3>
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
          {toolBha.length > 0 && <Button size="sm" variant="ghost" onClick={() => { if (!f.bha.some((b) => b.text.trim()) || window.confirm('Replace the BHA with the tool strings saved in Preparation?')) set({ bha: toolBha.map((b) => ({ ...b })) }); }}><RefreshCw aria-hidden className="size-3.5" />Read from the tool strings</Button>}
          {missing.length > 0 && <span className="text-xs text-warning">The log has run{missing.length > 1 ? 's' : ''} {missing.join(', ')} with no BHA.</span>}
        </div>
      )}
      <div className="mt-4">
        <Field id="jl-notes" label="Note"><textarea id="jl-notes" rows={3} className={cx(inputClass, 'h-auto resize-y py-2')} disabled={ro} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </Card>
  );
}
