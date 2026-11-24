import { useQuery } from '@tanstack/react-query';
import { Lock, Plus, ShieldAlert, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { _risk, type CompetencyHost } from '../competency/App';
import { api } from '../api';
import { Select } from '../components/Select';
import { Banner, Button, Card, EmptyState, Field, Skeleton, cx, inputClass } from '../components/ui';

// The Risk Tool and Crew Check (6z.54), moved from the Competency Framework's Tools tab: the same rules (High-Profile
// evaluation, NESR-7000-SOP-01 §5.4.4 Figure 21; the complexity calculator; the competence risk matrix; qualified
// people with the certification lockout; crew compliance), read from the Competency data. Nothing is saved here.

/* eslint-disable @typescript-eslint/no-explicit-any */
type State = any;
type Derived = any;
type Zone = 'BLUE' | 'GREEN' | 'YELLOW' | 'RED' | 'BLACK';

const { LEVEL_LABEL, ZONES, ZONE_PL, IMPACT_ROWS, HP_RATES, HP_ZONES, HP_FACTORS, HP_AUTO_COMPLEX, HP_AUTO_SQ } = _risk;

// the risk colours used on the JRA
const ZONE_CLS: Record<Zone, string> = {
  BLUE: 'bg-sev-light text-on-sev', GREEN: 'bg-sev-negligible text-on-sev', YELLOW: 'bg-sev-serious text-on-sev', RED: 'bg-sev-catastrophic text-on-sev', BLACK: 'bg-text text-bg',
};
const HP_CLS = { G: 'bg-sev-negligible text-on-sev', Y: 'bg-sev-serious text-on-sev', R: 'bg-sev-catastrophic text-on-sev' } as const;
const HP_LABEL = { G: 'Normal profile', Y: 'Elevated profile', R: 'High profile' } as const;
const LEVEL_CLS = ['bg-neutral-subtle text-text-muted', 'bg-danger-subtle text-danger', 'bg-warning-subtle text-warning', 'bg-success-subtle text-success'];
const SUB_OPTS: [string, string][] = [['0', '0 · Depth under 15,000 ft'], ['1', '1 · Depth over 15,000 ft'], ['2', '2 · Offshore operations']];
const IMPACT_OPTS: [number, string][] = [[1, '1 · Light'], [2, '2 · Serious'], [3, '3 · Major'], [4, '4 · Catastrophic'], [5, '5 · Multi-catastrophic']];
const REQ_NUM: Record<Zone, number> = { BLUE: 0, GREEN: 0, YELLOW: 1, RED: 2, BLACK: 3 };

const Level = ({ v, label }: { v: number | null; label?: ReactNode }) =>
  <span className={cx('inline-flex min-w-8 justify-center rounded-sm px-1.5 py-0.5 font-mono text-xs font-bold', v == null ? 'text-text-subtle' : LEVEL_CLS[Math.max(0, Math.min(3, v))])}>{label ?? (v ?? '—')}</span>;

function Step({ n, title, sub, children }: { n?: string; title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <Card className="mb-4 p-4">
      <h2 className="flex flex-wrap items-baseline gap-2 text-sm font-semibold">{n && <span className="label-caps text-accent-text">{n}</span>}{title}</h2>
      {sub && <p className="mt-1 mb-3 max-w-4xl text-xs text-text-muted">{sub}</p>}
      {!sub && <div className="mb-3" />}
      {children}
    </Card>
  );
}

function Checks({ items, value, onChange, tone }: { items: string[]; value: string[]; onChange: (v: string[]) => void; tone?: 'danger' }) {
  return (
    <div className="grid gap-1">
      {items.map((f) => (
        <label key={f} className={cx('flex cursor-pointer items-start gap-2 rounded-sm px-1.5 py-1 text-sm hover:bg-surface-2', value.includes(f) && (tone === 'danger' ? 'bg-danger-subtle' : 'bg-surface-3'))}>
          <input type="checkbox" className="mt-1" checked={value.includes(f)} onChange={() => onChange(value.includes(f) ? value.filter((x) => x !== f) : [...value, f])} />
          <span>{f}</span>
        </label>
      ))}
    </div>
  );
}

/** Elements grouped by their catalogue unit. */
function ElementSelect({ id, state, value, onChange, exclude = [], label }: { id: string; state: State; value: string; onChange: (v: string) => void; exclude?: string[]; label: string }) {
  const units: string[] = [];
  (state.catalog as { unit: string; element: string }[]).forEach((r) => { if (r.element && !units.includes(r.unit)) units.push(r.unit); });
  return (
    <select id={id} aria-label={label} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose an element…</option>
      {units.map((u) => (
        <optgroup key={u} label={u}>
          {(state.catalog as { unit: string; element: string }[]).filter((r) => r.unit === u && r.element).map((r) => <option key={r.element} value={r.element} disabled={exclude.includes(r.element) && r.element !== value}>{r.element}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

const TABS = [['risk', 'Risk profile'], ['crew', 'Crew check']] as const;

export default function JobRiskTool() {
  const seed = useQuery({ queryKey: ['competency-seed'], queryFn: () => api<CompetencyHost['seed']>('/competency/slk-seed'), staleTime: Infinity });
  const people = useQuery({ queryKey: ['competency-users'], queryFn: () => api<{ profiles: NonNullable<CompetencyHost['people']> }>('/competency/users') });
  const data = useQuery({ queryKey: ['competency-risk-data'], queryFn: () => api<{ value: string | null }>('/competency/risk-data') });
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('risk');
  // the Competency data as the module reads it: the saved team dataset (or SLK's people when there is none), with the people from Users & Roles
  const state = useMemo(() => {
    if (!seed.data || !people.data || !data.data) return null;
    let s: State;
    if (data.data.value) {
      const { meta: _meta, ...saved } = JSON.parse(data.data.value) as Record<string, unknown>;
      s = _risk.normalizeReq({ ...JSON.parse(JSON.stringify(_risk.EMPTY)), ...saved });
    } else s = _risk.slkSeedState(seed.data);
    return people.data.profiles.length ? _risk.syncSlkPeople(s, people.data.profiles) : s;
  }, [seed.data, people.data, data.data]);
  const d = useMemo(() => (state ? _risk.deriveState(state) : null), [state]);
  const err = seed.error ?? people.error ?? data.error;
  if (err) return <Banner tone="danger">{err.message}</Banner>;
  if (!state || !d) return <Skeleton className="h-96" />;
  return (
    <>
      <div role="tablist" aria-label="Job Risk Profile sections" className="mb-4 flex flex-wrap gap-2">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx('h-(--layout-control-sm) rounded-pill border px-3.5 text-sm font-semibold', tab === k ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>
            {label}
          </button>
        ))}
      </div>
      {!data.data?.value && <div className="mb-4"><Banner tone="info">No Competency data has been saved yet: everyone shows at L0 until assessments are recorded in the Competency Framework.</Banner></div>}
      <div role="tabpanel" aria-label={TABS.find(([k]) => k === tab)?.[1]}>
        {tab === 'risk' ? <RiskProfile state={state} d={d} /> : <CrewCheck state={state} d={d} />}
      </div>
    </>
  );
}

function RiskProfile({ state, d }: { state: State; d: Derived }) {
  // Step 1: High-Profile evaluation (drives the surface environment)
  const [factors, setFactors] = useState<string[]>([]);
  const [rate, setRate] = useState(1);
  const [autoC, setAutoC] = useState<string[]>([]);
  const [autoS, setAutoS] = useState<string[]>([]);
  const hpRow = Math.max(1, Math.min(5, factors.length));
  const hpAuto = autoC.length + autoS.length > 0;
  const hp = (hpAuto ? 'R' : HP_ZONES[hpRow - 1][rate]) as 'G' | 'Y' | 'R';
  // Step 2: complexity
  const [sub, setSub] = useState('0');
  const [impact, setImpact] = useState(3);
  const surf = { G: 1, Y: 2, R: 3 }[hp];
  const cxBase = Math.round(((surf + +sub + impact) / 10) * 5 * 100) / 100;
  const floor = impact >= 3 && cxBase < 3;
  const cxv = floor ? 3 : cxBase;
  const col = Math.min(5, Math.max(1, Math.ceil(cxv)));
  const zone = ZONES[`${impact},${col}`] as Zone;
  const reqNum = REQ_NUM[zone];
  // qualified people
  const [elems, setElems] = useState<string[]>([]);
  const [pick, setPick] = useState('');
  const active = (state.employees as any[]).filter((e) => e.id && e.status === 'Active');
  const lockoutFor = (e: any) => _risk.certsForRole(state, e.role || 'Viewer').map((cert) => ({ cert, code: _risk.certStatusCode(_risk.computeCertStatus(state, e.id, cert)) })).filter((c) => c.code < 3);
  const rows = elems.length ? active.map((e) => {
    const per = elems.map((el) => ({ el, lvl: d.maxProf(e.id, el) as number, p: (d.prof as any[]).find((x) => x.empId === e.id && x.element === el) }));
    return { e, per, minMargin: Math.min(...per.map((x) => x.lvl - reqNum)), flags: per.filter((x) => x.p && x.p.retention !== 'On track' && !x.p.retention.startsWith('No ')).map((x) => ({ el: x.el, txt: x.p.retention as string })), lockout: lockoutFor(e) };
  }).filter((x) => x.per.every((y) => y.lvl >= reqNum)) : [];
  const qualified = rows.filter((x) => !x.lockout.some((l) => l.code === 0))
    .sort((a, b) => Number(a.lockout.length > 0) - Number(b.lockout.length > 0) || b.minMargin - a.minMargin || String(a.e.id).localeCompare(String(b.e.id)));
  const lockedOut = rows.filter((x) => x.lockout.some((l) => l.code === 0));
  const add = () => { if (pick && !elems.includes(pick)) setElems([...elems, pick]); setPick(''); };

  return (
    <>
      <Step n="Step 1" title="High-profile job evaluation" sub="Tick the job factors that apply and pick the rig day rate (rigless work: the under $100k band). The matrix classifies the job as Normal, Elevated or High profile; any condition on the right makes it High profile on its own. NESR-7000-SOP-01 §5.4.4, Figure 21.">
        <div className="grid gap-5 lg:grid-cols-3">
          <div>
            <p className="label-caps mb-1.5 text-text-muted">Job factors · {factors.length} ticked</p>
            <Checks items={HP_FACTORS} value={factors} onChange={setFactors} />
            <div className="mt-3 max-w-xs">
              <Field id="jrp-rate" label="Rig day rate">
                <Select id="jrp-rate" className={inputClass} value={String(rate)} onChange={(e) => setRate(+e.target.value)}>
                  {HP_RATES.map((r, i) => <option key={r} value={i}>{r}</option>)}
                </Select>
              </Field>
            </div>
          </div>
          <div>
            <p className="label-caps mb-1.5 text-text-muted">High-profile matrix</p>
            <div className="overflow-x-auto">
              <table className="border-separate border-spacing-1">
                <caption className="sr-only">High-profile matrix: job factors by rig day rate</caption>
                <tbody>
                  {[5, 4, 3, 2, 1].map((rf) => (
                    <tr key={rf}>
                      <th scope="row" className="pr-1 text-right font-mono text-xs font-normal text-text-subtle">{rf === 5 ? '≥5' : rf}</th>
                      {HP_RATES.map((r, ci) => {
                        const z = HP_ZONES[rf - 1][ci], on = !hpAuto && rf === hpRow && ci === rate;
                        return <td key={r} className="p-0"><button type="button" aria-label={`${rf} factors, ${r}: ${HP_LABEL[z]}`} onClick={() => setRate(ci)} className={cx('block h-8 w-12 rounded-sm', HP_CLS[z], on && 'ring-3 ring-text ring-offset-1 ring-offset-surface')} /></td>;
                      })}
                    </tr>
                  ))}
                  <tr><td />{HP_RATES.map((r, ci) => <td key={r} className={cx('pt-0.5 text-center font-mono text-[0.625rem]', ci === rate ? 'font-bold text-text' : 'text-text-subtle')}>{r}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-text-subtle">Rows: number of job factors · columns: rig day rate (tap to pick)</p>
            <div className={cx('mt-3 inline-block rounded-md px-4 py-2', HP_CLS[hp])}>
              <p className="text-xs opacity-80">Job classification{hpAuto ? ' · set by a condition' : ''}</p>
              <p className="font-display text-xl font-bold uppercase">{HP_LABEL[hp]}</p>
            </div>
            {hp === 'R' && <p className="mt-2 max-w-sm text-xs text-text-muted">Flag the job as High profile. A non-routine or last-minute job needs an urgent planning meeting (FSM, EIC where it applies, SQC, Maintenance, SQ and Sales or Operations managers).</p>}
          </div>
          <div>
            <p className="label-caps mb-1.5 text-danger">High profile on its own · complexity · {autoC.length}</p>
            <Checks items={HP_AUTO_COMPLEX} value={autoC} onChange={setAutoC} tone="danger" />
            <p className="label-caps mt-3 mb-1.5 text-danger">High profile on its own · SQ and exposure · {autoS.length}</p>
            <Checks items={HP_AUTO_SQ} value={autoS} onChange={setAutoS} tone="danger" />
          </div>
        </div>
      </Step>

      <Step n="Step 2" title="Job complexity" sub="Slickline complexity = (surface + sub-surface + potential impact) / 10 × 5, so the worst case scores 5.0. A potential impact of Major (3) or above is never below 3.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div>
            <p className="label-caps mb-1.5 text-text-muted">Surface (from step 1)</p>
            <div className={cx('flex h-10 items-center gap-2 rounded-md px-3', HP_CLS[hp])}><span className="font-mono text-lg font-bold">{surf}</span><span className="text-sm font-semibold">{HP_LABEL[hp]}</span></div>
          </div>
          <Field id="jrp-sub" label="Sub-surface">
            <Select id="jrp-sub" className={inputClass} value={sub} onChange={(e) => setSub(e.target.value)}>{SUB_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </Field>
          <Field id="jrp-impact" label="Potential impact" hint="Well integrity barrier work is always 5.">
            <Select id="jrp-impact" className={inputClass} value={String(impact)} onChange={(e) => setImpact(+e.target.value)}>{IMPACT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </Field>
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
            <p className="text-xs text-text-muted">Slickline complexity</p>
            <p className="font-mono text-xl font-bold">{cxv.toFixed(2)} <span className="text-xs font-normal text-text-muted">→ column {col}</span></p>
            <p className="font-mono text-[0.6875rem] text-text-subtle">({surf} + {sub} + {impact}) / 10 × 5{floor ? ` = ${cxBase.toFixed(2)}, raised to 3.00` : ''}</p>
          </div>
          <div className={cx('rounded-md px-3 py-2', ZONE_CLS[zone])}>
            <p className="text-xs opacity-80">{zone} zone · proficiency needed</p>
            <p className="font-display text-lg font-bold">{ZONE_PL[zone]}</p>
          </div>
        </div>
      </Step>

      <Step title="Competence risk matrix" sub="The outlined cell is this job: potential impact (row) by complexity (column). Figures 2 and 5.">
        <div className="overflow-x-auto">
          <table className="min-w-[34rem] border-separate border-spacing-1 text-sm">
            <caption className="sr-only">Competence risk matrix</caption>
            <thead><tr><th scope="col" className="px-2 text-left font-mono text-label font-semibold tracking-wide text-text-muted uppercase">Impact \ complexity</th>{[1, 2, 3, 4, 5].map((c) => <th key={c} scope="col" className="font-mono text-label text-text-muted">{c}</th>)}</tr></thead>
            <tbody>{IMPACT_ROWS.map((label, ri) => (
              <tr key={label}>
                <th scope="row" className="rounded-sm bg-surface-2 px-2 py-2 text-left font-semibold whitespace-nowrap">{label}</th>
                {[1, 2, 3, 4, 5].map((ci) => {
                  const z = ZONES[`${ri + 1},${ci}`] as Zone, on = ri + 1 === impact && ci === col;
                  return <td key={ci} className={cx('min-w-16 rounded-sm py-2.5 text-center font-mono font-bold', ZONE_CLS[z], on && 'ring-3 ring-text ring-offset-1 ring-offset-surface')} aria-current={on || undefined}>{-((ri + 1) * ci)}</td>;
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Step>

      <Step title="Who can be assigned" sub={`Add the elements the job needs. The list shows active people holding ${LEVEL_LABEL[reqNum]} or above (the ${zone} zone) on every one, from the Competency proficiency figures, so expired levels are already dropped.`}>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="w-full sm:w-96"><Field id="jrp-elem" label="Element or service the job needs"><ElementSelect id="jrp-elem" label="Element or service the job needs" state={state} value={pick} onChange={setPick} exclude={elems} /></Field></div>
          <Button onClick={add} disabled={!pick}><Plus aria-hidden className="size-4" />Add</Button>
          <div className="rounded-md border border-border bg-surface-2 px-3 py-1.5"><p className="text-xs text-text-muted">Level needed</p><p className="text-sm font-semibold">{LEVEL_LABEL[reqNum]}</p></div>
          {elems.length > 0 && <div className="rounded-md border border-border bg-surface-2 px-3 py-1.5"><p className="text-xs text-text-muted">Qualified on all {elems.length}</p><p className="font-mono text-sm font-bold">{qualified.length}</p></div>}
        </div>
        {elems.length > 0 && (
          <ul className="mb-3 flex flex-wrap gap-1.5">
            {elems.map((el) => <li key={el} className="inline-flex items-center gap-1 rounded-pill bg-surface-3 py-0.5 pr-1 pl-2.5 text-sm">{el}<button type="button" aria-label={`Remove ${el}`} className="rounded-pill p-0.5 text-text-subtle hover:text-text" onClick={() => setElems(elems.filter((x) => x !== el))}><X aria-hidden className="size-3.5" /></button></li>)}
          </ul>
        )}
        {lockedOut.length > 0 && (
          <div className="mb-3"><Banner tone="danger">
            <span className="inline-flex items-center gap-1 font-semibold"><Lock aria-hidden className="size-3.5" />Certification lockout: {lockedOut.length} otherwise qualified {lockedOut.length === 1 ? 'person is' : 'people are'} held back.</span> They hold the level but a certification their role needs is not done or has expired. Fix it in the Competency Framework before assigning them.
            <ul className="mt-1">{lockedOut.map(({ e, lockout }) => <li key={e.id}><b>{e.id} · {e.name}</b>: {lockout.filter((l) => l.code === 0).map((l) => l.cert.name).join(', ')}</li>)}</ul>
          </Banner></div>
        )}
        {!elems.length ? <p className="text-sm text-text-muted">Add one or more elements to list who can be assigned.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: `${44 + elems.length * 7}rem` }}>
              <thead className="bg-surface-2"><tr className="text-left text-xs text-text-muted">{['Employee', 'Name', 'Position', 'Location', ...elems, 'Margin', 'Retention', 'Certifications'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {qualified.map(({ e, per, minMargin, flags, lockout }) => (
                  <tr key={e.id} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 text-left font-mono text-xs font-semibold whitespace-nowrap">{e.id}</th>
                    <td className="px-3 py-2">{e.name || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{e.position}{e.grade ? ` · G${e.grade}` : ''}</td>
                    <td className="px-3 py-2">{e.location}</td>
                    {per.map(({ el, lvl, p }) => <td key={el} className="px-3 py-2 text-center" title={p ? p.retention : 'No records: L0'}><Level v={lvl} label={p?.expired ? `${lvl} (${p.level}h)` : lvl} /></td>)}
                    <td className={cx('px-3 py-2 text-xs font-semibold whitespace-nowrap', minMargin > 0 && 'text-success')}>{minMargin > 0 ? `+${minMargin} above` : 'Meets it'}</td>
                    <td className="px-3 py-2 text-xs">{flags.length ? flags.map((f) => <div key={f.el}><b>{f.el}:</b> <span className={f.txt.startsWith('EXPIRED') ? 'text-danger' : 'text-warning'}>{f.txt}</span></div>) : <span className="font-semibold text-success">Clear</span>}</td>
                    <td className="px-3 py-2 text-xs">{lockout.length ? <span className="inline-flex items-center gap-1 font-semibold text-warning" title={lockout.map((l) => l.cert.name).join(', ')}><ShieldAlert aria-hidden className="size-3.5" />{lockout.length} expiring soon</span> : <span className="font-semibold text-success">Clear</span>}</td>
                  </tr>
                ))}
                {!qualified.length && <tr className="border-t border-border"><td colSpan={7 + elems.length} className="px-3 py-3 text-sm text-text-muted">No active person holds {LEVEL_LABEL[reqNum]} on every element with valid certifications. Crewing the job needs an exemption agreed with Segment Management, or split cover across the crew (see Crew check).</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Step>
    </>
  );
}

interface CrewRow { element: string; req: number }

function CrewCheck({ state, d }: { state: State; d: Derived }) {
  const [shift, setShift] = useState<'Single-Shift' | 'Multi-Shift'>('Single-Shift');
  const [eng1, setEng1] = useState('');
  const [eng2, setEng2] = useState('');
  const [rows, setRows] = useState<CrewRow[]>([]);
  const [pick, setPick] = useState('');
  const [pickReq, setPickReq] = useState('1');
  const people = (state.employees as any[]).filter((e) => e.id);
  const multi = shift === 'Multi-Shift';
  const lv = (emp: string, el: string) => (emp ? (d.maxProf(emp, el) as number) : null);
  // single shift: operator 1 holds the level; multi shift: one holds it and the other is at most one level below
  const checked = rows.map((r) => {
    const l1 = lv(eng1, r.element), l2 = lv(eng2, r.element);
    const a = l1 ?? -1, b = l2 ?? -1;
    const ok = r.element ? (multi ? Math.max(a, b) >= r.req && Math.min(a, b) >= r.req - 1 : a >= r.req) : null;
    return { ...r, l1, l2, ok };
  });
  const gaps = checked.filter((r) => r.ok === false).length;
  const setRow = (i: number, patch: Partial<CrewRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rows.map((r) => r.element);
  const person = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <Field id={id} label={label}>
      <Select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {people.map((e) => <option key={e.id} value={e.id}>{e.name ? `${e.name} · ${e.id}` : e.id}</option>)}
      </Select>
    </Field>
  );
  return (
    <>
      <Step n="1" title="Elements the job needs" sub="The job's competency profile: every element with the level it needs.">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full sm:w-96"><Field id="jrp-crew-elem" label="Element or service"><ElementSelect id="jrp-crew-elem" label="Element or service" state={state} value={pick} onChange={setPick} exclude={chosen} /></Field></div>
          <div className="w-28"><Field id="jrp-crew-req" label="Level needed"><Select id="jrp-crew-req" className={inputClass} value={pickReq} onChange={(e) => setPickReq(e.target.value)}>{[0, 1, 2, 3].map((n) => <option key={n} value={n}>L{n}</option>)}</Select></Field></div>
          <Button disabled={!pick} onClick={() => { setRows([...rows, { element: pick, req: +pickReq }]); setPick(''); }}><Plus aria-hidden className="size-4" />Add to the profile</Button>
        </div>
      </Step>
      <Step n="2" title="Crew and shift">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <Field id="jrp-shift" label="Shift">
            <Select id="jrp-shift" className={inputClass} value={shift} onChange={(e) => { const v = e.target.value as typeof shift; setShift(v); if (v === 'Single-Shift') setEng2(''); }}>
              <option value="Single-Shift">Single shift</option><option value="Multi-Shift">Multi shift</option>
            </Select>
          </Field>
          {person('jrp-eng1', 'Operator 1', eng1, setEng1)}
          {multi ? person('jrp-eng2', 'Operator 2', eng2, setEng2) : <p className="text-xs text-text-muted">Single shift: one operator covers the whole profile.</p>}
          {checked.length > 0 && (
            <div className={cx('rounded-md px-3 py-2', gaps ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success')}>
              <p className="text-xs opacity-80">Crew</p>
              <p className="font-display text-lg font-bold uppercase">{gaps ? `${gaps} gap${gaps === 1 ? '' : 's'}` : 'Compliant'}</p>
            </div>
          )}
        </div>
      </Step>
      <Step n="3" title="Compliance" sub={multi ? 'Multi shift: compliant when one operator holds the level and the other is no more than one level below.' : 'Single shift: compliant when operator 1 holds the level.'}>
        {!rows.length ? <EmptyState title="No elements yet">Add the elements the job needs in step 1.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-surface-2"><tr className="text-left text-xs text-text-muted">{['Element or service', 'Level needed', 'Operator 1', ...(multi ? ['Operator 2'] : []), 'Crew', ''].map((h, i) => <th key={i} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
              <tbody>{checked.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-1.5"><ElementSelect id={`jrp-row-${i}`} label={`Row ${i + 1} element`} state={state} value={r.element} onChange={(v) => setRow(i, { element: v })} exclude={chosen} /></td>
                  <td className="w-28 px-3 py-1.5"><Select aria-label={`Row ${i + 1} level needed`} className={inputClass} value={String(r.req)} onChange={(e) => setRow(i, { req: +e.target.value })}>{[0, 1, 2, 3].map((n) => <option key={n} value={n}>L{n}</option>)}</Select></td>
                  <td className="px-3 py-1.5 text-center"><Level v={r.l1} /></td>
                  {multi && <td className="px-3 py-1.5 text-center"><Level v={r.l2} /></td>}
                  <td className="px-3 py-1.5">{r.ok === null ? '—' : <span className={cx('label-caps inline-flex rounded-pill px-2 py-0.5', r.ok ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger')}>{r.ok ? 'OK' : 'Gap · exemption needed'}</span>}</td>
                  <td className="px-3 py-1.5 text-right"><Button size="sm" variant="ghost" className="text-danger" aria-label={`Remove ${r.element || `row ${i + 1}`}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><X aria-hidden className="size-3.5" /></Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Step>
    </>
  );
}
