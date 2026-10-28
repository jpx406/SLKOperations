import { Select } from './Select';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Plus, Trash2, UserMinus, X } from 'lucide-react';
import { useState } from 'react';
import { TOOLSTRING_COMPONENTS, preJobWireStatus, toolChecks, toolTotals, type ToolPart } from '../../shared/toolstring';
import type { CrewMember, Employee, Job, JobCrew, Lookups, WireOptions } from '../../shared/types';
import { api } from '../api';
import { Banner, Button, LockHint, cx, inputClass, inputSized, radioTab, rovingKeys } from './ui';

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
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2" role="radiogroup" aria-label="Drum and wire" onKeyDown={rovingKeys}>
      {drums.map((d, di) => {
        const on = job.drum_no === d.drum_no;
        const status = d.wire_serial_number ? preJobWireStatus(tests.filter((t) => t.wire_serial_number === d.wire_serial_number), start, tensionDays) : null;
        const usable = !!d.wire_serial_number && /active/i.test(d.status ?? 'active');
        return (
          <button key={d.drum_no} type="button" role="radio" aria-checked={on} tabIndex={radioTab(on, di === 0, drums.some((x) => x.drum_no === job.drum_no))} disabled={!canEdit || !usable}
            onClick={() => (on ? onPick(null, null) : onPick(d.drum_no, d.wire_serial_number))}
            className={cx('rounded-md border p-3 text-left disabled:cursor-not-allowed', on ? 'border-accent-edge bg-surface-2' : 'border-border hover:border-border-strong', !usable && 'opacity-60')}>
            <span className="flex items-center gap-2">
              <span className="font-display text-base font-bold">{d.drum_no}</span>
              <span className="text-xs text-text-muted">{d.drum_position ?? 'Drum'}</span>
              {on && <span className="ml-auto text-xs font-semibold text-accent-text">Selected</span>}
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
                    <Select aria-label={`Part ${i + 1} component`} className={inputClass} disabled={!canEdit} value={r.component} onChange={(e) => edit(i, 'component', e.target.value)}>
                      {[...new Set([...TOOLSTRING_COMPONENTS, r.component])].map((c) => <option key={c}>{c}</option>)}
                    </Select>
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

/**
 * Planned head count per role and the named crew picked from this country's roster. Once the job has started, a
 * person is replaced or taken off from a date rather than deleted, so their days stay on the attendance sheet.
 */
export function CrewPanel({ job, canEdit }: { job: Job; canEdit: boolean }) {
  const qc = useQueryClient();
  const crewQ = useQuery({ queryKey: ['crew', job.id], queryFn: () => api<JobCrew>(`/jobs/${job.id}/crew`) });
  const empQ = useQuery({ queryKey: ['employees', job.country], queryFn: () => api<Employee[]>(`/employees?country=${job.country}`), staleTime: 5 * 60_000 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [change, setChange] = useState<{ kind: 'replace' | 'remove'; member: CrewMember } | null>(null);
  if (crewQ.isPending) return <p className="text-sm text-text-muted">Loading crew…</p>;
  if (crewQ.isError) return <Banner tone="danger">{crewQ.error.message}</Banner>;
  const { headcount, crew, caps } = crewQ.data;
  const current = crew.filter((m) => !m.end_date);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['crew', job.id] });
    qc.invalidateQueries({ queryKey: ['job', job.id] });
    qc.invalidateQueries({ queryKey: ['attendance'] });
  };
  const run = async (path: string, json: unknown, method: 'PUT' | 'POST' = 'PUT') => {
    setBusy(true); setError(null);
    try { await api(`/jobs/${job.id}/${path}`, { method, json }); await refresh(); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  };
  const plan = (list: CrewMember[]) => run('crew', { crew: list.map(({ employee_id, crew_role }) => ({ employee_id, crew_role })) });
  // a job under way keeps who worked on it: changes need a date
  const started = job.status === 'ongoing' || job.status === 'completed';
  const taken = new Set(crew.map((m) => m.employee_id));
  const people = empQ.data ?? [];
  return (
    <div aria-busy={busy}>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {ROLES.map(({ role, head, label }) => {
          const members = current.filter((m) => m.crew_role === role);
          const gone = crew.filter((m) => m.crew_role === role && m.end_date);
          const short = headcount[head] > members.length;
          return (
            <fieldset key={role} className="border-t border-border pt-3">
              <legend className="px-1 text-xs font-semibold">{label}</legend>
              <label className="flex items-center gap-2 text-xs text-text-muted">
                Planned
                <input type="number" min={0} max={caps[head]} className={inputSized('h-(--layout-control-sm) w-16')} disabled={!canEdit || busy} value={headcount[head]}
                  onChange={(e) => run('headcount', { ...headcount, [head]: Math.min(caps[head], Math.max(0, Number(e.target.value) || 0)) })} />
                <span className="text-text-subtle">of {caps[head]}</span>
              </label>
              <ul className="mt-2 space-y-1">
                {members.map((m) => (
                  <li key={m.employee_id} className="text-sm">
                    <div className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate">{m.full_name}</span><span className="font-mono text-xs text-text-subtle">{m.eid}</span>
                      <Button variant="ghost" size="sm" aria-label={`Replace ${m.full_name}`} title="Replace from a date" disabled={!canEdit || busy}
                        onClick={() => setChange({ kind: 'replace', member: m })}><ArrowLeftRight aria-hidden className="size-3.5" /></Button>
                      <Button variant="ghost" size="sm" aria-label={`Remove ${m.full_name}`} title={started ? 'Take off the job from a date' : 'Take off the plan'} disabled={!canEdit || busy}
                        onClick={() => (started ? setChange({ kind: 'remove', member: m }) : plan(current.filter((x) => x.employee_id !== m.employee_id)))}><UserMinus aria-hidden className="size-3.5" /></Button>
                    </div>
                    {m.replaces_name && <p className="text-xs text-text-subtle">From {m.start_date}, replacing {m.replaces_name}</p>}
                  </li>
                ))}
              </ul>
              {members.length < caps[head] && (
                <Select aria-label={`Add to ${label.toLowerCase()}`} className={cx(inputClass, 'mt-2 h-(--layout-control-sm)')} disabled={!canEdit || busy} value=""
                  onChange={(e) => e.target.value && plan([...current, { employee_id: e.target.value, crew_role: role }])}>
                  <option value="">Add person…</option>
                  {people.filter((p) => !taken.has(p.id)).sort((a, b) => Number(b.crew_role === role) - Number(a.crew_role === role))
                    .map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.title}</option>)}
                </Select>
              )}
              {short && <p className="mt-1.5 text-xs text-warning">{headcount[head] - members.length} still to name</p>}
              {gone.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-dashed border-border pt-2" aria-label={`${label} who left the job`}>
                  {gone.map((m) => (
                    <li key={m.employee_id} className="text-xs text-text-muted">
                      <div className="flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate line-through decoration-text-subtle">{m.full_name}</span>
                        <Button variant="ghost" size="sm" disabled={!canEdit || busy} onClick={() => run(`crew/${m.employee_id}/restore`, {}, 'POST')}>Undo</Button>
                      </div>
                      <p>Last day {m.end_date}{m.replaced_by_name ? `, replaced by ${m.replaced_by_name}` : ', taken off the job'}{m.change_note ? ` · ${m.change_note}` : ''}{m.changed_by ? ` · by ${m.changed_by}` : ''}</p>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          );
        })}
      </div>
      {empQ.data && !people.length && <p className="mt-2 text-xs text-text-subtle">No one on the {job.country} roster yet. People are added in Users & Roles.</p>}
      {change && (
        <CrewChange job={job} kind={change.kind} member={change.member} people={people.filter((p) => !taken.has(p.id))} busy={busy}
          onClose={() => setChange(null)}
          onSave={async (b) => { if (await run(`crew/${change.member.employee_id}/${change.kind}`, b, 'POST')) setChange(null); }} />
      )}
    </div>
  );
}

const todayRiyadh = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

/** Replace a person from a date, or take them off the job after a last day. Attendance follows the dates. */
function CrewChange({ job, kind, member, people, busy, onClose, onSave }: {
  job: Job; kind: 'replace' | 'remove'; member: CrewMember; people: Employee[]; busy: boolean;
  onClose: () => void; onSave: (b: { date: string; employee_id?: string; handover?: boolean; note?: string }) => void;
}) {
  const first = member.start_date ?? job.start_date ?? '';
  const last = job.status === 'completed' ? job.end_date ?? '' : '';
  const clamp = (d: string) => (first && d < first ? first : last && d > last ? last : d);
  const [date, setDate] = useState(clamp(todayRiyadh()));
  const [who, setWho] = useState('');
  const [handover, setHandover] = useState(false);
  const [note, setNote] = useState('');
  const replace = kind === 'replace';
  const ok = !!date && (!replace || !!who);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="crew-change-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="w-full max-w-md rounded-lg border border-card-edge bg-surface p-5 shadow-pop">
        <div className="mb-3 flex items-start gap-3">
          <h2 id="crew-change-title" className="flex-1 font-display text-lg font-bold">{replace ? `Replace ${member.full_name}` : `Take ${member.full_name} off the job`}</h2>
          <Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}><X aria-hidden className="size-4" /></Button>
        </div>
        <div className="space-y-4">
          {replace && (
            <div>
              <label htmlFor="crew-who" className="label-caps mb-1.5 block text-text-muted">Replacement</label>
              <Select id="crew-who" search className={inputClass} value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Pick a person…</option>
                {[...people].sort((a, b) => Number(b.crew_role === member.crew_role) - Number(a.crew_role === member.crew_role))
                  .map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.title}</option>)}
              </Select>
            </div>
          )}
          <div>
            <label htmlFor="crew-date" className="label-caps mb-1.5 block text-text-muted">{replace ? 'Date of the change' : 'Last day on the job'}</label>
            <input id="crew-date" type="date" className={inputClass} value={date} min={first || undefined} max={last || undefined} onChange={(e) => setDate(e.target.value)} />
            <p className="mt-1 text-xs text-text-subtle">
              {replace
                ? `The replacement's attendance starts this day. ${member.full_name} ${handover ? 'also works this day' : 'works until the day before'}.`
                : `${member.full_name}'s attendance from this job stops after this day.`}
            </p>
          </div>
          {replace && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={handover} onChange={(e) => setHandover(e.target.checked)} />Both on the job that day (handover)</label>}
          <div>
            <label htmlFor="crew-note" className="label-caps mb-1.5 block text-text-muted">Reason <span className="normal-case text-text-subtle">(optional)</span></label>
            <input id="crew-note" className={inputClass} maxLength={300} value={note} placeholder="e.g. crew change, sick leave, rotation" onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ok} onClick={() => onSave({ date, note, ...(replace ? { employee_id: who, handover } : {}) })}>
            {replace ? 'Replace' : 'Take off the job'}
          </Button>
        </div>
      </div>
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

/**
 * Safety flags at the top of Preparation, gathered from the sections below it (which still show each one in place):
 * the selected wire's pre-job tests, the toolstring against the well and the pressure control, sour gas, and the
 * pressure rating against the shut-in pressure.
 */
export function PrepChecks({ job, values, toolstring, ctx }: {
  job: Job; values: Record<string, string | undefined>; toolstring: ToolPart[];
  ctx: { minRestrictionIn: number | null; pceBoreIn: number | null; lubricatorFt: number | null };
}) {
  const q = useQuery({ queryKey: ['wire-options', job.id, job.unit_number], queryFn: () => api<WireOptions>(`/jobs/${job.id}/wire-options`), enabled: !!job.unit_number });
  const n = (f: string) => (values[f] ? Number(values[f]) : null);
  const flags: { level: 'danger' | 'warning'; text: string }[] = [];
  const wire = values.wire_serial_number;
  if (!wire) flags.push({ level: 'warning', text: 'No drum and wire picked yet' });
  else if (q.data) {
    const s = preJobWireStatus(q.data.tests.filter((t) => t.wire_serial_number === wire), job.start_date ?? new Date().toISOString().slice(0, 10), q.data.tensionDays);
    for (const r of s.reasons) flags.push({ level: 'danger', text: `Wire ${wire}: ${r}` });
  }
  flags.push(...toolChecks(toolTotals(toolstring), ctx));
  const h2s = n('h2s_ppm'), co2 = n('co2_pct'), siwhp = n('siwhp_psi'), rating = n('pressure_rating_psi');
  if (h2s != null && h2s > 0) flags.push({ level: 'warning', text: `Sour well: H₂S ${h2s} ppm. H₂S-rated wire, PCE and gas detection` });
  if (co2 != null && co2 > 0) flags.push({ level: 'warning', text: `CO₂ ${co2}%` });
  if (siwhp != null && rating != null && siwhp >= rating) flags.push({ level: 'danger', text: `SIWHP ${siwhp.toLocaleString()} psi is at or above the ${rating.toLocaleString()} psi pressure rating` });
  const danger = flags.some((f) => f.level === 'danger');
  return (
    <section aria-labelledby="prep-checks" className="mb-5">
      <h2 id="prep-checks" className={cx('label-caps mb-2', danger ? 'text-danger' : flags.length ? 'text-warning' : 'text-success')}>
        Safety checks · {flags.length ? `${flags.length} to look at` : 'nothing flagged'}
      </h2>
      {flags.length > 0 ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {flags.map((f) => (
            <li key={f.text} className={cx('flex items-start gap-2 font-semibold', f.level === 'danger' ? 'text-danger' : 'text-warning')}>
              <span className="label-caps mt-0.5 shrink-0">{f.level === 'danger' ? 'Stop' : 'Check'}</span>{f.text}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-text-muted">Wire tests, toolstring fit, sour gas and pressure rating are all clear for what's entered so far.</p>}
    </section>
  );
}
