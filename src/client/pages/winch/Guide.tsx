import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { fmt, type RuleKey, type RuleSet } from '../../../shared/winchData';
import { BRAIDED_FIELDS, BRAIDED_LABEL, GUIDE_DEFAULTS, braidedText, type LineKind, type SpeedRow, type WinchGuide } from '../../../shared/winchGuide';
import type { KnowledgeDoc } from '../../../shared/knowledge';
import { api } from '../../api';
import { Banner, Button, cx, inputClass, inputSized } from '../../components/ui';
import { fileUrl } from '../knowledge/common';
import { supportUrl } from '../knowledge/Support';
import { th, td } from './Report';

// The winch guidelines on the Closure tab (6z.42): read by everyone, changed by an admin for everyone. Slickline wire
// shows the Speed Guidelines by service and the Jarring Guidelines; braided line the seasoning rules for new and
// seasoned line. The SOP-04 document and its attached guidelines are linked from the Knowledge Hub.

export interface GuideData { guide: WinchGuide; saved: boolean; updatedAt: string | null; updatedBy: string | null; canEdit: boolean }
export const useGuide = () => useQuery({ queryKey: ['winch-guide'], queryFn: () => api<GuideData>('/winch/guide'), staleTime: 5 * 60_000 });

const small = 'h-(--layout-control-sm) text-sm';

/** SOP-04 and the guideline documents attached to it, from the Knowledge Hub. */
function SourceLinks() {
  const lib = useQuery({ queryKey: ['knowledge'], queryFn: () => api<{ docs: KnowledgeDoc[] }>('/knowledge'), retry: false, staleTime: 5 * 60_000 });
  const docs = (lib.data?.docs ?? []).filter((d) => /sop-?0?4\b/i.test(d.doc_no ?? '') || /winch (operation|control)/i.test(d.title));
  if (!docs.length) return null;
  const link = 'inline-flex items-center gap-1 font-semibold text-accent-text underline';
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {docs.map((d) => (
        <span key={d.id} className="contents">
          {d.file && <a className={link} href={fileUrl(d.id, d.file, d.file.content_type === 'application/pdf')} target="_blank" rel="noreferrer"><BookOpen aria-hidden className="size-3" />{d.doc_no ? `${d.doc_no} ` : ''}{d.title}</a>}
          {(d.support ?? []).filter((f) => /speed|jar|placard|guideline/i.test(f.file_name)).map((f) => (
            <a key={f.id} className={link} href={supportUrl(d.id, f, f.content_type === 'application/pdf')} target="_blank" rel="noreferrer"><BookOpen aria-hidden className="size-3" />{f.file_name.replace(/\.[a-z]+$/i, '').replace(/[_]+/g, ' ')}</a>
          ))}
        </span>
      ))}
    </p>
  );
}

/** The guidelines for the line in use, and the editor for admins. */
export function GuidePanel({ kind, data }: { kind: LineKind; data: GuideData }) {
  const [editing, setEditing] = useState(false);
  const g = data.guide;
  const w = g.wire;
  return (
    <div className="space-y-3">
      <SourceLinks />
      {kind === 'wire' ? (
        <>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[40rem] text-xs">
              <caption className="sr-only">Slickline wire recommended speeds by service, ft/min</caption>
              <thead><tr>{['Services', `0–${fmt(w.surfaceDepth)} ft`, 'RIH', 'POOH', `Restrictions ±${fmt(w.restrictionBand)} ft`].map((h) => <th key={h} scope="col" className={cx(th, 'px-2')}>{h}</th>)}</tr></thead>
              <tbody>
                {w.groups.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className={cx(td, 'px-2')}><span className="font-semibold">{r.name}</span><span className="block text-text-muted">{r.services.join(', ') || 'No services listed'}</span></td>
                    {[r.surface, r.rih, r.pooh, r.restriction].map((v, i) => <td key={i} className={cx(td, 'px-2 font-mono')}>{fmt(v)}</td>)}
                  </tr>
                ))}
                <tr className="border-t border-border bg-warning-subtle/40">
                  <td className={cx(td, 'px-2')}><span className="font-semibold">Any service not listed</span><span className="block text-text-muted">Default speeds, flagged on the run: confirm the plan and speeds with the Service Manager and write them in the JRA</span></td>
                  {[w.fallback.surface, w.fallback.rih, w.fallback.pooh, w.fallback.restriction].map((v, i) => <td key={i} className={cx(td, 'px-2 font-mono')}>{fmt(v)}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <ul className="grid gap-x-6 gap-y-1 text-xs text-text-muted sm:grid-cols-2">
            <li>Running in: normal tension over {w.rihFactor} × static tension; pulling out: under {w.poohFactor} × static.</li>
            <li>Jarring up: never over the MAT, or {w.matPct}% of the wire's breaking strength.</li>
            <li>Heavy jarring: over {fmt(w.heavyLb)} lbs needs a new program and an MoC. Spang jar limit {fmt(w.spangLimit)} lbs.</li>
            <li>{w.maxCycles} cycles of {w.cycleMin} minutes with {w.restMin} minutes of rest between them; jarring down loses at most {w.jarDownLossPct}% of the normal tension.</li>
          </ul>
        </>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[36rem] text-xs">
            <caption className="sr-only">Braided line seasoning rules</caption>
            <thead><tr>{['Rule', 'New line (seasoning)', `Seasoned line (${g.braided.seasonedRuns}+ runs)`].map((h) => <th key={h} scope="col" className={cx(th, 'px-2')}>{h}</th>)}</tr></thead>
            <tbody>{BRAIDED_FIELDS.filter((f) => f.key !== 'detect').map((f) => (
              <tr key={f.key} className="border-t border-border">
                <td className={cx(td, 'px-2 font-semibold')}>{BRAIDED_LABEL[f.key]}</td>
                <td className={cx(td, 'px-2 text-text-muted')}>{braidedText(g.braided.newLine, f.key)}</td>
                <td className={cx(td, 'px-2 text-text-muted')}>{braidedText(g.braided.seasoned, f.key)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-text-subtle">
          {data.saved ? `Set by ${data.updatedBy ?? 'an admin'}${data.updatedAt ? ` on ${data.updatedAt.slice(0, 10)}` : ''}.` : 'The values from the guideline documents.'} {data.canEdit ? 'You can change them for everyone.' : 'Only an admin can change them.'}
        </p>
        {data.canEdit && !editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil aria-hidden className="size-3.5" />Change the guidelines</Button>}
      </div>
      {editing && <GuideEditor start={g} onDone={() => setEditing(false)} />}
    </div>
  );
}

const numIn = (label: string, value: number, onChange: (v: number) => void, w = 'w-20', step?: number) => (
  <input aria-label={label} className={inputSized(`${w} ${small}`)} type="number" min={0} step={step} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
);

/** Admins: every guideline value, saved for everyone. */
function GuideEditor({ start, onDone }: { start: WinchGuide; onDone: () => void }) {
  const qc = useQueryClient();
  const [g, setG] = useState<WinchGuide>(() => structuredClone(start));
  const save = useMutation({
    mutationFn: () => api<GuideData>('/winch/guide', { method: 'PUT', body: JSON.stringify({ guide: g }) }),
    onSuccess: (d) => { qc.setQueryData(['winch-guide'], d); onDone(); },
  });
  const w = g.wire;
  const setW = (patch: Partial<typeof w>) => setG({ ...g, wire: { ...w, ...patch } });
  const setRow = (i: number, patch: Partial<SpeedRow>) => setW({ groups: w.groups.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const setRule = (which: 'seasoned' | 'newLine', key: RuleKey, f: string, v: number, tier?: [number, number]) => {
    const next = structuredClone(g);
    const R = next.braided[which] as RuleSet;
    if (tier) R.nearSurface.tiers[tier[0]][tier[1]] = v;
    else (R[key] as unknown as Record<string, number>)[f] = v;
    setG(next);
  };
  const lbl = 'flex items-center gap-1 text-xs text-text-muted';
  return (
    <div className="space-y-5 rounded-md border border-border-strong bg-surface-2 p-3">
      <section>
        <h4 className="mb-2 text-sm font-semibold">Slickline wire: speeds by service (ft/min)</h4>
        <ul className="space-y-3">
          {w.groups.map((r, i) => (
            <li key={r.id} className="grid gap-2 rounded-sm border border-border bg-surface p-2 lg:grid-cols-[1fr_auto]">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-text-muted">Row name
                  <input className={cx(inputClass, 'mt-0.5')} value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
                </label>
                <label className="text-xs text-text-muted">Services, separated by commas
                  <input className={cx(inputClass, 'mt-0.5')} value={r.services.join(', ')} onChange={(e) => setRow(i, { services: e.target.value.split(',').map((x) => x.trimStart()) })}
                    onBlur={() => setRow(i, { services: r.services.map((x) => x.trim()).filter(Boolean) })} />
                </label>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <span className={lbl}>0–{fmt(w.surfaceDepth)} ft {numIn(`${r.name}: near surface`, r.surface, (v) => setRow(i, { surface: v }))}</span>
                <span className={lbl}>RIH {numIn(`${r.name}: RIH`, r.rih, (v) => setRow(i, { rih: v }))}</span>
                <span className={lbl}>POOH {numIn(`${r.name}: POOH`, r.pooh, (v) => setRow(i, { pooh: v }))}</span>
                <span className={lbl}>Restrictions {numIn(`${r.name}: restrictions`, r.restriction, (v) => setRow(i, { restriction: v }))}</span>
                <Button size="sm" variant="ghost" aria-label={`Remove ${r.name}`} onClick={() => setW({ groups: w.groups.filter((_, k) => k !== i) })}><Trash2 aria-hidden className="size-3.5" /></Button>
              </div>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setW({ groups: [...w.groups, { id: `g${Date.now().toString(36)}`, name: 'New row', services: [], ...w.fallback }] })}>
          <Plus aria-hidden className="size-3.5" />Add a row of services</Button>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          <span className="text-xs font-semibold">Any service not listed:</span>
          <span className={lbl}>near surface {numIn('Default: near surface', w.fallback.surface, (v) => setW({ fallback: { ...w.fallback, surface: v } }))}</span>
          <span className={lbl}>RIH {numIn('Default: RIH', w.fallback.rih, (v) => setW({ fallback: { ...w.fallback, rih: v } }))}</span>
          <span className={lbl}>POOH {numIn('Default: POOH', w.fallback.pooh, (v) => setW({ fallback: { ...w.fallback, pooh: v } }))}</span>
          <span className={lbl}>restrictions {numIn('Default: restrictions', w.fallback.restriction, (v) => setW({ fallback: { ...w.fallback, restriction: v } }))}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          <span className={lbl}>Near surface: shallower than {numIn('Near surface depth (ft)', w.surfaceDepth, (v) => setW({ surfaceDepth: v }))} ft</span>
          <span className={lbl}>Restrictions: {numIn('Restriction distance (ft)', w.restrictionBand, (v) => setW({ restrictionBand: v }))} ft either side</span>
          <span className={lbl}>RIH tension over {numIn('RIH tension factor', w.rihFactor, (v) => setW({ rihFactor: v }), 'w-16', 0.05)} × static</span>
          <span className={lbl}>POOH tension under {numIn('POOH tension factor', w.poohFactor, (v) => setW({ poohFactor: v }), 'w-16', 0.05)} × static</span>
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold">Jarring</h4>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <span className={lbl}>Jar up at most {numIn('Jar up at most (% of breaking strength)', w.matPct, (v) => setW({ matPct: v }), 'w-16')} % of breaking strength</span>
          <span className={lbl}>Heavy jarring over {numIn('Heavy jarring (lbs)', w.heavyLb, (v) => setW({ heavyLb: v }))} lbs</span>
          <span className={lbl}>Spang jar limit {numIn('Spang jar limit (lbs)', w.spangLimit, (v) => setW({ spangLimit: v }))} lbs</span>
          <span className={lbl}>Jar down loses at most {numIn('Jar down loss (%)', w.jarDownLossPct, (v) => setW({ jarDownLossPct: v }), 'w-16')} %</span>
          <span className={lbl}>Cycle at most {numIn('Cycle (min)', w.cycleMin, (v) => setW({ cycleMin: v }), 'w-16')} min</span>
          <span className={lbl}>Rest at least {numIn('Rest (min)', w.restMin, (v) => setW({ restMin: v }), 'w-16')} min</span>
          <span className={lbl}>At most {numIn('Cycles at one place', w.maxCycles, (v) => setW({ maxCycles: v }), 'w-16')} cycles at one place</span>
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold">Braided line</h4>
        <p className={cx(lbl, 'mb-2')}>Seasoned after {numIn('Runs before the line is seasoned', g.braided.seasonedRuns, (v) => setG({ ...g, braided: { ...g.braided, seasonedRuns: Math.round(v) } }), 'w-16')} runs</p>
        <div className="grid gap-4 lg:grid-cols-2">
          {(['newLine', 'seasoned'] as const).map((which) => (
            <div key={which} className="rounded-sm border border-border bg-surface p-2">
              <p className="mb-1 text-xs font-semibold">{which === 'newLine' ? 'New line (seasoning)' : 'Seasoned line'}</p>
              <RuleFields R={g.braided[which]} onChange={(key, f, v, tier) => setRule(which, key, f, v, tier)} />
            </div>
          ))}
        </div>
      </section>

      <details>
        <summary className="cursor-pointer text-sm font-semibold">How jarring and speed findings are found</summary>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {([['stationaryFt', 'Held in place: within', 'ft'], ['windowSec', 'over', 's'], ['upMinLb', 'Jar up: over normal by', 'lbs'], ['upPct', 'or', '%'], ['downPct', 'Jar down: under normal by', '%'],
            ['gapSec', 'One cycle: hits within', 's'], ['minSec', 'Speed: lasting', 's'], ['tensionSec', 'Tension: lasting', 's'], ['mergeSec', 'merged within', 's']] as const).map(([k, l, u]) => (
            <span key={k} className={lbl}>{l} {numIn(`${l} (${u})`, g.detect[k], (v) => setG({ ...g, detect: { ...g.detect, [k]: v } }))} {u}</span>
          ))}
        </div>
      </details>

      {save.isError && <Banner tone="danger">{(save.error as Error).message}</Banner>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setG(structuredClone(GUIDE_DEFAULTS))}><RotateCcw aria-hidden className="size-3.5" />Back to the document values</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save for everyone'}</Button>
      </div>
    </div>
  );
}

/** The editable values of a braided-line rule set. */
export function RuleFields({ R, onChange, only }: { R: RuleSet; onChange: (key: RuleKey, f: string, v: number, tier?: [number, number]) => void; only?: RuleKey[] }) {
  return (
    <ul className="divide-y divide-border">
      {BRAIDED_FIELDS.filter((f) => !only || only.includes(f.key)).map((rf) => (
        <li key={rf.key} className="py-1.5">
          <p className="text-xs font-semibold">{BRAIDED_LABEL[rf.key]}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {rf.fields === 'tiers'
              ? R.nearSurface.tiers.map(([d, v], i) => (
                <span key={i} className="flex items-center gap-1 text-xs text-text-muted">
                  within {numIn(`Tier ${i + 1} depth (ft)`, d, (x) => onChange('nearSurface', '', x, [i, 0]))} ft:
                  {numIn(`Tier ${i + 1} max speed (fpm)`, v, (x) => onChange('nearSurface', '', x, [i, 1]))} fpm
                </span>
              ))
              : rf.fields.map((f) => (
                <span key={f.f} className="flex items-center gap-1 text-xs text-text-muted">
                  {f.label} {numIn(`${BRAIDED_LABEL[rf.key]}: ${f.label} (${f.unit})`, (R[rf.key] as unknown as Record<string, number>)[f.f], (x) => onChange(rf.key, f.f, x), 'w-24')} {f.unit}
                </span>
              ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
