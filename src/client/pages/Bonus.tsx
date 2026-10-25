import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Mail, Printer, RotateCcw, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { BASIS_LABEL, ROLE_LABEL, bonusShare, money, type Basis, type CrewRole, type Line } from '../../shared/bonus';
import { filtersToQuery } from '../../shared/filters';
import { workbook } from '../../shared/xlsx';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { BarChart, KpiTile, saveFile } from '../components/charts';
import { FilterBar, useFilters } from '../components/FilterBar';
import { StepUpGate, UnlockedBadge, needsStepUp } from '../components/StepUp';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputSized } from '../components/ui';

// Bonus (Administrator Manual 1 and 3): Report (per person), Analysis (trends and % of revenue), Rules (admin),
// and the distribution on a job's Closure stage. All behind step-up re-authentication.

interface BLine { employee_id: string; full_name: string; eid: string; crew_role: CrewRole | null; amount_cents: number; currency: string; status: string; statement_sent_at: string | null; job_id: string; ticket_no: string | null; start_date: string | null; well: string | null; field: string | null; location: string | null; revenue_cents: number | null; services: string[] }
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function useLines(approved: boolean) {
  const [filters] = useFilters();
  const qs = [filtersToQuery(filters), approved ? '' : 'approved=0'].filter(Boolean).join('&');
  return { q: useQuery({ queryKey: ['bonus-lines', qs], queryFn: () => api<BLine[]>(`/bonus/lines?${qs}`), retry: (n, e) => !needsStepUp(e) && n < 2 }), filters };
}

export function BonusReport() {
  const [approved, setApproved] = useState(true);
  const [q2, setQ2] = useState('');
  const { q, filters } = useLines(approved);
  const { data: me } = useMe();
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const people = useMemo(() => {
    const m = new Map<string, { id: string; name: string; eid: string; role: CrewRole | null; jobs: Set<string>; total: number; currency: string; draft: number }>();
    for (const l of q.data ?? []) {
      const p = m.get(l.employee_id) ?? { id: l.employee_id, name: l.full_name, eid: l.eid, role: l.crew_role, jobs: new Set(), total: 0, currency: l.currency, draft: 0 };
      p.jobs.add(l.job_id); p.total += l.amount_cents; if (l.status !== 'approved') p.draft += l.amount_cents;
      m.set(l.employee_id, p);
    }
    return [...m.values()].filter((p) => !q2 || `${p.name} ${p.eid}`.toLowerCase().includes(q2.toLowerCase())).sort((a, b) => b.total - a.total);
  }, [q.data, q2]);
  const exportXlsx = () => saveFile(`bonus-report-${new Date().toISOString().slice(0, 10)}.xlsx`, workbook('Bonus report', ['Name', 'EID', 'Role', 'Jobs', 'Total bonus', 'Currency', 'Not yet approved'],
    people.map((p) => [p.name, p.eid, p.role ? ROLE_LABEL[p.role] : '', p.jobs.size, p.total / 100, p.currency, p.draft / 100]), [24, 10, 18, 7, 12, 8, 14]), XLSX);
  const statements = async () => {
    if (!window.confirm(`Email each person their approved bonus for the current filters (${people.length} people)?`)) return;
    try {
      const r = await api<{ sent: number; noEmail: string[]; mailer: boolean }>(`/bonus/statements?${filtersToQuery(filters)}`, { method: 'POST' });
      setNotice({ tone: r.mailer ? 'success' : 'warning', text: r.mailer ? `${r.sent} statement${r.sent === 1 ? '' : 's'} sent.${r.noEmail.length ? ` No email on the roster for ${r.noEmail.join(', ')}.` : ''}` : 'Email sending isn’t switched on yet (Cloudflare Email Service). Nothing was sent.' });
    } catch (e) { setNotice({ tone: 'danger', text: (e as ApiError).message }); }
  };
  return (
    <section aria-labelledby="br-title">
      <PageTitle aside={!needsStepUp(q.error) && (
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button size="sm" onClick={() => window.print()} disabled={!people.length}><Printer aria-hidden className="size-4" />Download report</Button>
          <Button size="sm" onClick={exportXlsx} disabled={!people.length}><FileSpreadsheet aria-hidden className="size-4" />XLSX</Button>
          {me?.menus.bonus?.edit && <Button size="sm" onClick={statements} disabled={!people.length || !approved}><Mail aria-hidden className="size-4" />Email statements</Button>}
        </div>
      )}><span id="br-title">Bonus report</span><UnlockedBadge /></PageTitle>
      <StepUpGate locked={needsStepUp(q.error)}>
        <FilterBar optionsPath="/filter-options" withStatus={false} />
        <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />Approved bonuses only</label>
          <input aria-label="Search name or EID" className={inputSized('h-8 w-56')} placeholder="Name or EID" value={q2} onChange={(e) => setQ2(e.target.value)} />
          {me?.menus.bonus?.edit && <Link to="/bonus/rules" className="ml-auto text-sm underline">Bonus rules</Link>}
        </div>
        {notice && <div className="mb-3"><Banner tone={notice.tone}>{notice.text}</Banner></div>}
        {q.isPending && <Skeleton className="h-64" />}
        {q.isError && !needsStepUp(q.error) && <Banner tone="danger">{q.error.message}</Banner>}
        {q.data && !people.length && <EmptyState title="No bonus in this selection">Bonus appears once a job’s distribution is approved on its Closure stage.</EmptyState>}
        {people.length > 0 && (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-surface-2"><tr className="text-left text-xs text-text-muted">{['Name', 'EID', 'Role', 'Jobs', 'Total bonus'].map((h) => <th key={h} scope="col" className={cx('px-3 py-2 font-semibold', (h === 'Jobs' || h === 'Total bonus') && 'text-right')}>{h}</th>)}</tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 text-left font-semibold">{p.name}</th><td className="px-3 py-2 font-mono text-xs">{p.eid}</td>
                    <td className="px-3 py-2">{p.role ? ROLE_LABEL[p.role] : '—'}</td><td className="px-3 py-2 text-right font-mono">{p.jobs.size}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{money(p.total, p.currency)}{p.draft > 0 && <span className="block text-xs font-normal text-warning">{money(p.draft, p.currency)} not approved</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t-2 border-border font-semibold"><td className="px-3 py-2" colSpan={4}>Total · {people.length} people</td><td className="px-3 py-2 text-right font-mono">{money(people.reduce((a, p) => a + p.total, 0), people[0]?.currency)}</td></tr></tfoot>
            </table>
          </Card>
        )}
      </StepUpGate>
    </section>
  );
}

export function BonusAnalysis() {
  const { q, filters } = useLines(true);
  const rev = useQuery({ queryKey: ['bonus-revenue', filtersToQuery(filters)], queryFn: () => api<{ revenue: number; jobs: number; missing: number }>(`/bonus/revenue?${filtersToQuery(filters)}`), retry: (n, e) => !needsStepUp(e) && n < 2 });
  const lines = q.data ?? [];
  const total = lines.reduce((a, l) => a + l.amount_cents, 0);
  const jobs = new Set(lines.map((l) => l.job_id));
  // % of revenue compares bonus with the revenue of the same jobs, not of every job in the filters
  const jobRevenue = [...jobs].reduce((a, id) => a + (lines.find((l) => l.job_id === id)?.revenue_cents ?? 0), 0);
  const share = bonusShare(total, jobRevenue);
  const group = (key: (l: BLine) => string[]) => {
    const m = new Map<string, number>();
    for (const l of lines) for (const k of key(l)) m.set(k, (m.get(k) ?? 0) + l.amount_cents / 100);
    return [...m.entries()].map(([k, v]) => ({ key: k, label: k, value: Math.round(v * 100) / 100, ids: [] as string[] })).sort((a, b) => b.value - a.value);
  };
  const byMonth = group((l) => [l.start_date?.slice(0, 7) ?? 'no date']).sort((a, b) => a.key.localeCompare(b.key)).map((b) => ({ ...b, label: b.key === 'no date' ? b.key : `${MONTHS[Number(b.key.slice(5, 7)) - 1]} ${b.key.slice(2, 4)}` }));
  return (
    <section aria-labelledby="ba-title">
      <PageTitle><span id="ba-title">Bonus analysis</span><UnlockedBadge /></PageTitle>
      <StepUpGate locked={needsStepUp(q.error) || needsStepUp(rev.error)}>
        <FilterBar optionsPath="/filter-options" withStatus={false} />
        {q.isPending && <Skeleton className="h-64" />}
        {q.data && (
          <>
            <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiTile label="Total bonus paid" value={money(total, lines[0]?.currency)} note="approved only" />
              <KpiTile label="Jobs with bonus" value={jobs.size} />
              <KpiTile label="Bonus % of revenue" value={share.pct} unit={share.pct === null ? undefined : '%'} note={`target under ${share.target}%${share.ok === false ? ' · over target' : ''}`} />
              <KpiTile label="Revenue of completed jobs" value={rev.data ? money(rev.data.revenue) : '—'} note={rev.data?.missing ? `${rev.data.missing} completed job${rev.data.missing === 1 ? '' : 's'} without revenue` : undefined} />
            </dl>
            {share.ok === false && <div className="mb-4"><Banner tone="warning">Bonus is {share.pct}% of the revenue of the same jobs, above the {share.target}% target.</Banner></div>}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <BarChart title="Bonus paid per month" buckets={byMonth} unit="USD" />
              <BarChart title="Bonus by person" horizontal buckets={group((l) => [l.full_name])} unit="USD" />
              <BarChart title="Bonus by service" horizontal buckets={group((l) => (l.services.length ? [l.services[0]] : ['no service']))} unit="USD" note="By the job’s main service, the one whose rule set the pool." />
              <BarChart title="Bonus by role" horizontal buckets={group((l) => [l.crew_role ? ROLE_LABEL[l.crew_role] : 'no role'])} unit="USD" />
            </div>
          </>
        )}
      </StepUpGate>
    </section>
  );
}

interface RulesData { rules: { country: string; job_type_name: string; basis: Basis; amount_cents: number | null; pct: number | null; active: number; updated_by: string | null }[]; splits: { country: string; crew_role: CrewRole; share_pct: number }[]; jobTypes: { country: string; name: string }[] }

export function BonusRules() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['bonus-rules'], queryFn: () => api<RulesData>('/bonus/rules'), retry: (n, e) => !needsStepUp(e) && n < 2 });
  const [country, setCountry] = useState('');
  const c = country || me?.countries[0] || '';
  const [error, setError] = useState<string | null>(null);
  const [splits, setSplits] = useState<Record<string, string>>({});
  useEffect(() => { if (q.data) setSplits(Object.fromEntries((['slickline_supervisor', 'slickline_operator', 'assistant_operator', 'helper'] as CrewRole[]).map((r) => [r, String(q.data!.splits.find((s) => s.country === c && s.crew_role === r)?.share_pct ?? '')]))); }, [q.data, c]);
  const save = async (path: string, json: unknown) => {
    setError(null);
    try { await api(`/bonus/${path}`, { method: 'PUT', json }); qc.invalidateQueries({ queryKey: ['bonus-rules'] }); } catch (e) { setError((e as ApiError).message); }
  };
  const types = (q.data?.jobTypes ?? []).filter((t) => t.country === c);
  const sum = Object.values(splits).reduce((a, v) => a + (Number(v) || 0), 0);
  return (
    <section aria-labelledby="rules-title">
      <PageTitle aside={(me?.countries.length ?? 0) > 1 && <select aria-label="Country" className={inputSized('h-8 w-44')} value={c} onChange={(e) => setCountry(e.target.value)}>{me?.countries.map((x) => <option key={x}>{x}</option>)}</select>}>
        <span id="rules-title">Bonus rules</span><UnlockedBadge />
      </PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">A job’s pool comes from the rule of its main service (the first one picked with a rule): a fixed amount per job, an amount per successful run, or a share of the job’s revenue. The pool is then split by role, and the SDM can adjust it on Closure before approving.</p>
      <StepUpGate locked={needsStepUp(q.error)}>
        {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
        {q.isPending && <Skeleton className="h-64" />}
        {q.data && (
          <>
            <Card className="mb-4">
              <h2 className="label-caps mb-3 text-text-muted">Default split by role ({c})</h2>
              <div className="flex flex-wrap items-end gap-3">
                {(Object.keys(ROLE_LABEL) as CrewRole[]).map((r) => (
                  <Field key={r} id={`sp-${r}`} label={ROLE_LABEL[r]} unit="%"><input id={`sp-${r}`} type="number" min={0} max={100} className={inputSized('w-28 pr-8')} value={splits[r] ?? ''} onChange={(e) => setSplits({ ...splits, [r]: e.target.value })} /></Field>
                ))}
                <span className={cx('pb-2 font-mono text-sm', Math.abs(sum - 100) > 0.01 ? 'text-warning' : 'text-success')}>{sum}%</span>
                <Button onClick={() => save('splits', { country: c, splits: Object.fromEntries(Object.entries(splits).map(([k, v]) => [k, Number(v) || 0])) })} disabled={Math.abs(sum - 100) > 0.01}>Save split</Button>
              </div>
            </Card>
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[48rem] text-sm">
                <thead className="bg-surface-2"><tr className="text-left text-xs text-text-muted">{['WIREGUARD job type', 'How the pool is worked out', 'Amount or share', 'Active', ''].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                <tbody>{types.map((t) => <RuleRow key={t.name} country={c} name={t.name} rule={q.data!.rules.find((r) => r.country === c && r.job_type_name === t.name)} onSave={(json) => save('rules', json)} />)}</tbody>
              </table>
            </Card>
          </>
        )}
      </StepUpGate>
    </section>
  );
}

function RuleRow({ country, name, rule, onSave }: { country: string; name: string; rule?: RulesData['rules'][number]; onSave: (json: unknown) => void }) {
  const [basis, setBasis] = useState<Basis>(rule?.basis ?? 'per_job');
  const [value, setValue] = useState(rule ? String(rule.basis === 'pct_revenue' ? rule.pct : (rule.amount_cents ?? 0) / 100) : '');
  const [active, setActive] = useState(rule ? !!rule.active : true);
  const dirty = !rule || basis !== rule.basis || active !== !!rule.active || value !== String(rule.basis === 'pct_revenue' ? rule.pct : (rule.amount_cents ?? 0) / 100);
  return (
    <tr className="border-t border-border">
      <th scope="row" className="px-3 py-2 text-left font-normal">{name}{!rule && <span className="ml-2 text-xs text-text-subtle">no rule</span>}</th>
      <td className="px-3 py-2"><select aria-label={`Basis for ${name}`} className={inputSized('h-8 w-52')} value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>{(Object.keys(BASIS_LABEL) as Basis[]).map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}</select></td>
      <td className="px-3 py-2"><span className="relative inline-block"><input aria-label={`Amount for ${name}`} type="number" min={0} step="any" className={inputSized('h-8 w-32 pr-12')} value={value} onChange={(e) => setValue(e.target.value)} />
        <span aria-hidden className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 font-mono text-xs text-text-subtle">{basis === 'pct_revenue' ? '%' : 'USD'}</span></span></td>
      <td className="px-3 py-2"><input type="checkbox" aria-label={`${name} active`} checked={active} onChange={(e) => setActive(e.target.checked)} /></td>
      <td className="px-3 py-2 text-right"><Button size="sm" disabled={!dirty || value === ''} onClick={() => onSave({ country, job_type_name: name, basis, active, ...(basis === 'pct_revenue' ? { pct: Number(value) } : { amount_cents: Math.round(Number(value) * 100) }) })}>Save</Button></td>
    </tr>
  );
}

interface JobBonus {
  job: { id: string; ticket_no: string | null; status: string; services: string[]; runs_ok: number | null; revenue_cents: number | null };
  pool: { cents: number; rule: { job_type_name: string; basis: Basis; amount_cents: number | null; pct: number | null; currency: string } | null; note: string | null };
  crew: { employee_id: string; full_name: string; crew_role: CrewRole }[];
  lines: (Line & { full_name?: string; status?: string; approved_by?: string | null; statement_sent_at?: string | null })[];
  status: 'proposed' | 'draft' | 'approved';
}

/** Crew Assignment & Bonus Distribution on Closure (Administrator Manual 3). Admin and SDM roles only. */
export function BonusDistribution({ jobId }: { jobId: string }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const allowed = !!me && ['admin', 'sdm', 'deputy_sdm'].includes(me.role);
  const q = useQuery({ queryKey: ['job-bonus', jobId], queryFn: () => api<JobBonus>(`/bonus/jobs/${jobId}`), enabled: allowed, retry: (n, e) => !needsStepUp(e) && n < 2 });
  const [lines, setLines] = useState<{ employee_id: string; crew_role: CrewRole | null; share_pct: string; amount: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setLines(q.data.lines.map((l) => ({ employee_id: l.employee_id, crew_role: l.crew_role, share_pct: l.share_pct == null ? '' : String(l.share_pct), amount: String(l.amount_cents / 100) }))); }, [q.data]);
  if (!allowed) return null;
  if (needsStepUp(q.error)) return <div className="mt-2"><Banner tone="info" action={<Link className="text-sm font-semibold underline" to="/bonus/report">Unlock</Link>}>The bonus distribution needs your password again (restricted figures).</Banner></div>;
  if (q.isPending) return <Skeleton className="h-24" />;
  if (q.isError) return <Banner tone="danger">{q.error.message}</Banner>;
  const d = q.data;
  const cur = d.pool.rule?.currency ?? 'USD';
  const locked = d.status === 'approved' || d.job.status !== 'completed';
  const total = lines.reduce((a, l) => a + Math.round((Number(l.amount) || 0) * 100), 0);
  const name = (id: string) => d.crew.find((m) => m.employee_id === id)?.full_name ?? id;
  const act = async (path: string, init: { method: string; json?: unknown }) => {
    setBusy(true); setError(null);
    try { await api(`/bonus/jobs/${jobId}${path}`, init); await qc.invalidateQueries({ queryKey: ['job-bonus', jobId] }); qc.invalidateQueries({ queryKey: ['bonus-lines'] }); }
    catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <div>
      <p className="mb-2 text-sm">
        Pool <b className="font-mono">{money(d.pool.cents, cur)}</b>
        {d.pool.rule ? <span className="text-text-muted"> from {d.pool.rule.job_type_name}: {BASIS_LABEL[d.pool.rule.basis].toLowerCase()} {d.pool.rule.basis === 'pct_revenue' ? `${d.pool.rule.pct}%` : money(d.pool.rule.amount_cents, cur)}</span> : null}
        {d.pool.note && <span className="ml-1 text-warning">· {d.pool.note}</span>}
      </p>
      {d.job.status !== 'completed' && <p className="mb-2 text-xs text-text-subtle">Opens once the job is completed.</p>}
      {d.status === 'approved' && <div className="mb-2"><Banner tone="success">Approved by {d.lines[0]?.approved_by}. {me?.role === 'admin' ? 'Reopening affects the Bonus Report and statements already sent.' : 'Only an admin can reopen it.'}</Banner></div>}
      {error && <div className="mb-2"><Banner tone="danger">{error}</Banner></div>}
      {!d.crew.length ? <p className="text-sm text-text-subtle">Name the crew on Preparation first.</p> : (
        <table className="w-full max-w-2xl text-sm">
          <thead><tr className="text-left text-xs text-text-muted"><th scope="col" className="py-1">Crew member</th><th scope="col" className="py-1">Role</th><th scope="col" className="py-1">Share %</th><th scope="col" className="py-1">Amount ({cur})</th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.employee_id} className="border-t border-border">
                <td className="py-1.5">{name(l.employee_id)}</td><td className="py-1.5 text-text-muted">{l.crew_role ? ROLE_LABEL[l.crew_role] : '—'}</td>
                <td className="py-1.5"><input aria-label={`Share for ${name(l.employee_id)}`} type="number" min={0} max={100} step="any" disabled={locked} className={inputSized('h-8 w-24')} value={l.share_pct}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, share_pct: e.target.value, amount: e.target.value === '' ? x.amount : String(Math.round(d.pool.cents * Number(e.target.value) / 100) / 100) } : x)))} /></td>
                <td className="py-1.5"><input aria-label={`Amount for ${name(l.employee_id)}`} type="number" min={0} step="0.01" disabled={locked} className={inputSized('h-8 w-32')} value={l.amount}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value, share_pct: '' } : x)))} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-border"><td className="py-1.5 font-semibold" colSpan={3}>Total</td><td className={cx('py-1.5 font-mono font-semibold', total > d.pool.cents && 'text-danger')}>{money(total, cur)}</td></tr></tfoot>
        </table>
      )}
      {!locked && d.crew.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button loading={busy} onClick={() => act('', { method: 'PUT', json: { lines: lines.map((l) => ({ employee_id: l.employee_id, crew_role: l.crew_role, share_pct: l.share_pct === '' ? null : Number(l.share_pct), amount_cents: Math.round((Number(l.amount) || 0) * 100) })) } })}>Save distribution</Button>
          <Button variant="primary" loading={busy} disabled={d.status !== 'draft'} onClick={() => { if (window.confirm('Approve this distribution? It goes to the Bonus Report; corrections later need an admin.')) void act('/approve', { method: 'POST' }); }}><ShieldCheck aria-hidden className="size-4" />Approve</Button>
          {d.status === 'proposed' && <span className="self-center text-xs text-text-subtle">Proposed from the default split. Save it before approving.</span>}
        </div>
      )}
      {d.status === 'approved' && me?.role === 'admin' && (
        <Button className="mt-3" variant="ghost" loading={busy} onClick={() => { const reason = window.prompt('Why is it reopened?'); if (reason) void act('/reopen', { method: 'POST', json: { reason } }); }}><RotateCcw aria-hidden className="size-4" />Reopen</Button>
      )}
    </div>
  );
}
