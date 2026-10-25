import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { TOOLSTRING_COMPONENTS, preJobWireStatus, toolChecks, toolTotals, type ToolPart } from '../../shared/toolstring';
import type { CrewMember, Employee, Job, JobCrew, Lookups, WireOptions } from '../../shared/types';
import { api } from '../api';
import { Banner, Button, LockHint, cx, inputClass, inputSized } from './ui';

// Pieces of the job editor that hold more than one field: wire panel, toolstring builder, crew, gated detail sections.

export function SectionTitle({ children, aside }: { children: string; aside?: React.ReactNode }) {
  return (
    <div className="mt-6 mb-3 flex items-center gap-3 border-b border-border pb-1.5 first:mt-0">
      <h2 className="label-caps text-text-muted">{children}</h2>
      {aside && <div className="ml-auto text-xs text-text-subtle">{aside}</div>}
    </div>
  );
}

/** Drums on the job's unit from WIREGUARD; picking one sets drum and wire together. Shows the pre-job test status. */
export function WirePanel({ job, canEdit, onPick }: { job: Job; canEdit: boolean; onPick: (drum: string | null, wire: string | null) => void }) {
  const q = useQuery({ queryKey: ['wire-options', job.id, job.unit_number], queryFn: () => api<WireOptions>(`/jobs/${job.id}/wire-options`), enabled: !!job.unit_number });
  if (!job.unit_number) return <LockHint>Pick the slickline unit on Design to see its drums and wires.</LockHint>;
  if (q.isPending) return <p className="text-sm text-text-muted">Loading drums from WIREGUARD…</p>;
  if (q.isError) return <Banner tone="danger">{q.error.message}</Banner>;
  const { drums, tests, tensionDays } = q.data;
  if (!drums.length) return <Banner tone="warning">WIREGUARD has no drums on unit {job.unit_number}. Assign a drum there, then sync.</Banner>;
  const start = job.start_date ?? new Date().toISOString().slice(0, 10);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2" role="radiogroup" aria-label="Drum and wire">
      {drums.map((d) => {
        const on = job.drum_no === d.drum_no;
        const status = d.wire_serial_number ? preJobWireStatus(tests.filter((t) => t.wire_serial_number === d.wire_serial_number), start, tensionDays) : null;
        const usable = !!d.wire_serial_number && /active/i.test(d.status ?? 'active');
        return (
          <button key={d.drum_no} type="button" role="radio" aria-checked={on} disabled={!canEdit || !usable}
            onClick={() => (on ? onPick(null, null) : onPick(d.drum_no, d.wire_serial_number))}
            className={cx('rounded-md border p-3 text-left disabled:cursor-not-allowed', on ? 'border-accent bg-surface-2' : 'border-border hover:border-border-strong', !usable && 'opacity-60')}>
            <span className="flex items-center gap-2">
              <span className="font-display text-base font-bold">{d.drum_no}</span>
              <span className="text-xs text-text-muted">{d.drum_position ?? 'Drum'}</span>
              {on && <span className="ml-auto text-xs font-semibold text-accent">Selected</span>}
            </span>
            {d.wire_serial_number ? (
              <>
                <span className="mt-1 block font-mono text-xs">{d.wire_serial_number} · {d.wire_grade ?? '—'} · {d.wire_size ?? '—'} in</span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  {d.remaining_length_ft != null ? `${Math.round(d.remaining_length_ft).toLocaleString()} ft left` : 'length unknown'}
                  {d.rated_mbl_lb != null && ` · MBL ${Math.round(d.rated_mbl_lb).toLocaleString()} lb`}
                  {!usable && ` · ${d.status}`}
                </span>
                {status && (
                  <span className={cx('mt-1.5 block text-xs font-semibold', status.ok ? 'text-success' : 'text-warning')}>
                    {status.ok ? `Pre-job tests OK (tension ${status.tension?.test_date})` : status.reasons.join(' · ')}
                  </span>
                )}
              </>
            ) : <span className="mt-1 block text-xs text-text-subtle">No wire spooled</span>}
          </button>
        );
      })}
    </div>
  );
}

const BLANK: ToolPart = { component: 'Stem', od_in: null, length_ft: null, weight_lb: null };

/** Edits the toolstring top to bottom and shows totals and checks as you type. Saves the whole list on each change. */
export function ToolstringBuilder({ value, canEdit, onChange, ctx }: {
  value: ToolPart[]; canEdit: boolean; onChange: (parts: ToolPart[]) => void;
  ctx: { minRestrictionIn: number | null; pceBoreIn: number | null; lubricatorFt: number | null };
}) {
  const rows = value;
  const set = onChange;
  const edit = (i: number, k: keyof ToolPart, v: string) =>
    set(rows.map((r, j) => (j !== i ? r : { ...r, [k]: k === 'component' ? v : v === '' ? null : Number(v) })));
  const t = toolTotals(rows);
  const checks = toolChecks(t, ctx);
  return (
    <div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Toolstring, rope socket at the top</caption>
            <thead><tr className="text-left text-xs text-text-muted">
              <th className="w-8 py-1 font-semibold">#</th><th className="py-1 font-semibold">Component</th>
              <th className="w-24 py-1 font-semibold">OD in</th><th className="w-24 py-1 font-semibold">Length ft</th><th className="w-24 py-1 font-semibold">Weight lb</th><th className="w-10" />
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1.5 font-mono text-xs text-text-subtle">{i + 1}</td>
                  <td className="py-1.5 pr-2">
                    <select aria-label={`Part ${i + 1} component`} className={inputClass} disabled={!canEdit} value={r.component} onChange={(e) => edit(i, 'component', e.target.value)}>
                      {[...new Set([...TOOLSTRING_COMPONENTS, r.component])].map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  {(['od_in', 'length_ft', 'weight_lb'] as const).map((k) => (
                    <td key={k} className="py-1.5 pr-2">
                      <input aria-label={`Part ${i + 1} ${k.replace('_', ' ')}`} className={inputClass} type="number" min={0} step="any" inputMode="decimal"
                        disabled={!canEdit} value={r[k] ?? ''} onChange={(e) => edit(i, k, e.target.value)} />
                    </td>
                  ))}
                  <td className="py-1.5">
                    <Button variant="ghost" size="sm" aria-label={`Remove part ${i + 1}`} disabled={!canEdit} onClick={() => set(rows.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={!canEdit || rows.length >= 20} onClick={() => set([...rows, rows.length ? BLANK : { ...BLANK, component: 'Rope socket' }])}>
          <Plus aria-hidden className="size-4" />Add part
        </Button>
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-live="polite">
          <Tot k="Length" v={t.length_ft} u="ft" /><Tot k="Max OD" v={t.max_od_in} u="in" /><Tot k="Weight" v={t.weight_lb} u="lb" /><Tot k="Stem" v={t.stem_weight_lb} u="lb" />
        </dl>
      </div>
      {checks.length > 0 && <div className="mt-3 space-y-2">{checks.map((c) => <Banner key={c.text} tone={c.level}>{c.text}</Banner>)}</div>}
    </div>
  );
}

const Tot = ({ k, v, u }: { k: string; v: number | null; u: string }) => (
  <div className="flex gap-1"><dt className="text-text-muted">{k}</dt><dd className="font-mono font-semibold">{v ?? '—'}{v != null && ` ${u}`}</dd></div>
);

const ROLES: { role: CrewMember['crew_role']; head: keyof JobCrew['headcount']; label: string }[] = [
  { role: 'slickline_supervisor', head: 'supervisors', label: 'Supervisors' },
  { role: 'slickline_operator', head: 'operators', label: 'Operators' },
  { role: 'assistant_operator', head: 'assistant_operators', label: 'Assistant operators' },
  { role: 'helper', head: 'helpers', label: 'Helpers' },
];

/** Planned head count per role and the named crew picked from this country's roster. */
export function CrewPanel({ job, canEdit }: { job: Job; canEdit: boolean }) {
  const qc = useQueryClient();
  const crewQ = useQuery({ queryKey: ['crew', job.id], queryFn: () => api<JobCrew>(`/jobs/${job.id}/crew`) });
  const empQ = useQuery({ queryKey: ['employees', job.country], queryFn: () => api<Employee[]>(`/employees?country=${job.country}`), staleTime: 5 * 60_000 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (crewQ.isPending) return <p className="text-sm text-text-muted">Loading crew…</p>;
  if (crewQ.isError) return <Banner tone="danger">{crewQ.error.message}</Banner>;
  const { headcount, crew, caps } = crewQ.data;
  const run = async (path: string, json: unknown) => {
    setBusy(true); setError(null);
    try {
      await api(`/jobs/${job.id}/${path}`, { method: 'PUT', json });
      await qc.invalidateQueries({ queryKey: ['crew', job.id] });
      qc.invalidateQueries({ queryKey: ['job', job.id] });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const taken = new Set(crew.map((m) => m.employee_id));
  const people = empQ.data ?? [];
  return (
    <div aria-busy={busy}>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {ROLES.map(({ role, head, label }) => {
          const members = crew.filter((m) => m.crew_role === role);
          const short = headcount[head] > members.length;
          return (
            <fieldset key={role} className="rounded-md border border-border p-3">
              <legend className="px-1 text-xs font-semibold">{label}</legend>
              <label className="flex items-center gap-2 text-xs text-text-muted">
                Planned
                <input type="number" min={0} max={caps[head]} className={inputSized('h-8 w-16')} disabled={!canEdit || busy} value={headcount[head]}
                  onChange={(e) => run('headcount', { ...headcount, [head]: Math.min(caps[head], Math.max(0, Number(e.target.value) || 0)) })} />
                <span className="text-text-subtle">of {caps[head]}</span>
              </label>
              <ul className="mt-2 space-y-1">
                {members.map((m) => (
                  <li key={m.employee_id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{m.full_name}</span><span className="font-mono text-xs text-text-subtle">{m.eid}</span>
                    <Button variant="ghost" size="sm" aria-label={`Remove ${m.full_name}`} disabled={!canEdit || busy}
                      onClick={() => run('crew', { crew: crew.filter((x) => x.employee_id !== m.employee_id) })}><Trash2 aria-hidden className="size-3.5" /></Button>
                  </li>
                ))}
              </ul>
              {members.length < caps[head] && (
                <select aria-label={`Add to ${label.toLowerCase()}`} className={cx(inputClass, 'mt-2 h-8')} disabled={!canEdit || busy} value=""
                  onChange={(e) => e.target.value && run('crew', { crew: [...crew.map(({ employee_id, crew_role }) => ({ employee_id, crew_role })), { employee_id: e.target.value, crew_role: role }] })}>
                  <option value="">Add person…</option>
                  {people.filter((p) => !taken.has(p.id)).sort((a, b) => Number(b.crew_role === role) - Number(a.crew_role === role))
                    .map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.title}</option>)}
                </select>
              )}
              {short && <p className="mt-1.5 text-xs text-warning">{headcount[head] - members.length} still to name</p>}
            </fieldset>
          );
        })}
      </div>
      {empQ.data && !people.length && <p className="mt-2 text-xs text-text-subtle">No one on the {job.country} roster yet. People are added in Attendance.</p>}
    </div>
  );
}

/** Service flags for the job's services, from the job-type profiles. */
export function serviceFlags(job: Job | null, lookups: Lookups | undefined) {
  const on = new Set(job?.services ?? []);
  const rows = (lookups?.serviceProfiles ?? []).filter((p) => on.has(p.job_type_name));
  return {
    is_plug: rows.some((r) => r.is_plug), is_fishing: rows.some((r) => r.is_fishing),
    is_memory: rows.some((r) => r.is_memory), is_perforation: rows.some((r) => r.is_perforation),
    is_explosive: rows.some((r) => r.is_explosive),
  };
}

/** A small set of named values stored as one JSON object (survey, fishing, perforation details). */
export function DetailsSection({ value, fields, canEdit, onChange, idPrefix }: {
  value: Record<string, unknown>; canEdit: boolean; idPrefix: string; onChange: (v: Record<string, unknown>) => void;
  fields: { key: string; label: string; type?: 'number' | 'text' | 'date'; unit?: string }[];
}) {
  const v = value;
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        return (
          <div key={f.key}>
            <label htmlFor={id} className="label-caps mb-1.5 block text-text-muted">{f.label}{f.unit && <span className="ml-1 normal-case text-text-subtle">({f.unit})</span>}</label>
            <input id={id} className={inputClass} type={f.type ?? 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined} min={f.type === 'number' ? 0 : undefined}
              disabled={!canEdit} value={String(v[f.key] ?? '')}
              onChange={(e) => {
                const raw = e.target.value;
                const next = { ...v, [f.key]: raw === '' ? null : f.type === 'number' ? Number(raw) : raw };
                if (raw === '') delete next[f.key];
                onChange(next);
              }} />
          </div>
        );
      })}
    </div>
  );
}
