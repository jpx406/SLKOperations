import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { monthLabel } from '../../shared/people';
import { preJobWireStatus } from '../../shared/toolstring';
import * as K from '../../shared/wireKpis';
import { api, formatDate } from '../api';
import { useMe } from '../auth';
import { BarChart, KpiTile } from '../components/charts';
import { Banner, Card, EmptyState, PageTitle, Skeleton, cx, inputSized } from '../components/ui';

// Wires (D3): the register (replaces the WL Hub's Cable Summary), the wire detail (replaces Cable Book) and
// Wire KPIs, all read-only from WIREGUARD. Changes are made in WIREGUARD.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
interface Raw { wires: Row[]; drums: Row[]; jobs: Row[]; documents: Row[]; notifications: Row[]; settings: K.Settings; build: string | null; verifiedBuild: string; parityCurrent: boolean }

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

function useWireData() {
  const q = useQuery({ queryKey: ['wire-data'], queryFn: () => api<Raw>('/wires/data'), staleTime: 5 * 60_000 });
  // WIREGUARD's dashboard reads camelCase objects; convert once, the way it does
  const data = useMemo(() => (q.data ? {
    wires: K.keysToCamel(q.data.wires) as Row[], drums: K.keysToCamel(q.data.drums) as Row[], jobs: K.keysToCamel(q.data.jobs) as Row[],
    maint: K.keysToCamel(q.data.documents) as Row[], notifications: K.keysToCamel(q.data.notifications) as Row[],
  } : null), [q.data]);
  return { q, data };
}
function useWgUrl() {
  return useQuery({ queryKey: ['config'], queryFn: () => api<{ wireguardUrl: string }>('/config'), staleTime: Infinity }).data?.wireguardUrl;
}
const unitOf = (drums: Row[]) => { const m = new Map(drums.map((d) => [d.drumNo, d.slicklineUnit ?? null])); return (drumNo: string) => m.get(drumNo) ?? null; };
const OpenInWg = ({ path = '' }: { path?: string }) => {
  const url = useWgUrl();
  return url ? <a className="inline-flex items-center gap-1 text-sm underline" href={`${url}${path}`} target="_blank" rel="noreferrer">Open in WIREGUARD<ExternalLink aria-hidden className="size-3.5" /></a> : null;
};

export function WiresRegister() {
  const { q, data } = useWireData();
  const navigate = useNavigate();
  const [f, setF] = useState({ q: '', unit: '', status: 'live' });
  const rows = useMemo(() => {
    if (!data || !q.data) return [];
    const p = K.params(q.data.settings);
    const unit = unitOf(data.drums);
    const lim = p.sop('retire_runs_limit', 220);
    return data.wires.map((w) => {
      const sn = String(w.wireSerialNumber);
      const tests = data.maint.filter((d) => d.docType === 'wire_maintenance_entry' && String(d.wireSerialNumber) === sn).sort((a, b) => String(b.testDate).localeCompare(String(a.testDate)));
      const drum = data.drums.find((d) => d.drumNo === w.drumNo);
      return {
        w, sn, unit: unit(w.drumNo), remaining: K.wireRemaining(w, data.jobs), runs: K.wireRunCount(w, data.jobs), life: Math.round((K.wireRunCount(w, data.jobs) / lim) * 1000) / 10,
        test: tests[0] ?? null, mpi: drum ? K.mpiStatus(drum, data.maint, today(), p).state : null,
        alerts: data.notifications.filter((n) => !n.resolvedAt && String(n.wireSerialNumber ?? '') === sn).length,
        low: K.wireRemaining(w, data.jobs) < p.sop('low_length_warning_ft', 2000),
      };
    });
  }, [data, q.data]);
  const units = [...new Set(rows.map((r) => r.unit).filter(Boolean))].sort() as string[];
  const shown = rows.filter((r) => (f.status === 'all' || (f.status === 'live' ? K.LIVE(r.w) : !K.LIVE(r.w)))
    && (!f.unit || r.unit === f.unit) && (!f.q || `${r.sn} ${r.w.wireGrade ?? ''} ${r.w.drumNo ?? ''}`.toLowerCase().includes(f.q.toLowerCase())))
    .sort((a, b) => a.remaining - b.remaining);
  return (
    <section aria-labelledby="wires-title">
      <PageTitle aside={<OpenInWg />}><span id="wires-title">Wires</span></PageTitle>
      <p className="-mt-3 mb-4 text-sm text-text-muted">Read-only from WIREGUARD, refreshed with every sync. Add, test, cut or retire wires in WIREGUARD.</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative"><span className="sr-only">Search serial, grade or drum</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle" />
          <input className={inputSized('h-(--layout-control-sm) w-56 pl-8')} placeholder="Serial, grade, drum" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        </label>
        <select aria-label="Unit" className={inputSized('h-(--layout-control-sm) w-36')} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}><option value="">All units</option>{units.map((u) => <option key={u}>{u}</option>)}</select>
        <select aria-label="Status" className={inputSized('h-(--layout-control-sm) w-40')} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="live">In service</option><option value="retired">Retired</option><option value="all">All wires</option></select>
        <span className="ml-auto text-xs text-text-muted">{shown.length} wire{shown.length === 1 ? '' : 's'} · lowest remaining length first</span>
      </div>
      {q.isPending && <Skeleton className="h-96" />}
      {q.isError && <Banner tone="danger">{q.error.message}</Banner>}
      {q.data && !shown.length && <EmptyState title="No wires match">Wires come from WIREGUARD with the sync.</EmptyState>}
      {shown.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[64rem] text-sm">
            <thead className="bg-surface-2"><tr className="text-left text-xs text-text-muted">
              {['Serial', 'Grade · size', 'Drum', 'Unit', 'Status', 'Remaining', 'Runs · life', 'Latest test', 'Drum MPI', 'Alerts'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.sn} tabIndex={0} className="cursor-pointer border-t border-border hover:bg-surface-2" onClick={() => navigate(`/wires/${encodeURIComponent(r.sn)}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/wires/${encodeURIComponent(r.sn)}`); }}>
                  <th scope="row" className="px-3 py-2 text-left font-mono font-semibold">{r.sn}</th>
                  <td className="px-3 py-2">{r.w.wireGrade ?? '—'} · {r.w.wireSize ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.w.drumNo ?? '—'}</td><td className="px-3 py-2 font-mono text-xs">{r.unit ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">{r.w.status ?? '—'}</td>
                  <td className={cx('px-3 py-2 font-mono', r.low && 'font-semibold text-warning')}>{Math.round(r.remaining).toLocaleString()} ft</td>
                  <td className={cx('px-3 py-2 font-mono text-xs', r.life >= 80 && 'text-danger')}>{r.runs} · {r.life}%</td>
                  <td className="px-3 py-2 text-xs">{r.test ? <><span className={cx(r.test.result === 'Pass' ? 'text-success' : 'text-danger')}>{r.test.testType} {r.test.result}</span> · {formatDate(String(r.test.testDate).slice(0, 10))}</> : <span className="text-text-subtle">none</span>}</td>
                  <td className={cx('px-3 py-2 text-xs', r.mpi && ['expired', 'failed'].includes(r.mpi) && 'font-semibold text-danger', r.mpi === 'expiring' && 'text-warning', (!r.mpi || r.mpi === 'none') && 'text-text-subtle')}>{!r.mpi || r.mpi === 'none' ? 'none on file' : r.mpi}</td>
                  <td className={cx('px-3 py-2 text-xs', r.alerts > 0 && 'font-semibold text-warning')}>{r.alerts ? `${r.alerts} alert${r.alerts === 1 ? '' : 's'}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}

export function WireDetail() {
  const { serial = '' } = useParams();
  const { q, data } = useWireData();
  const view = useMemo(() => {
    if (!data || !q.data) return null;
    const w = data.wires.find((x) => String(x.wireSerialNumber) === serial);
    if (!w) return null;
    const p = K.params(q.data.settings);
    const deriv = K.derive(data.jobs, data.maint, data.wires, p);
    const runs = data.jobs.filter((j) => String(j.wireSerialNumber) === serial).sort((a, b) => String(b.jobDate).localeCompare(String(a.jobDate)) || K.num(b.runNumber) - K.num(a.runNumber));
    const tests = data.maint.filter((d) => String(d.wireSerialNumber) === serial).sort((a, b) => String(b.testDate).localeCompare(String(a.testDate)));
    // counters after the latest run, walked in order with the derivation's rule: a cut-back resets them
    const since = { trips: 0, jars: 0, mins: 0 };
    for (const j of [...runs].reverse()) {
      if (!K.isCutOnly(j)) { since.trips += 1; since.jars += K.num(j.jarringImpactCount); since.mins += K.num(j.jarringMinutes); }
      if (K.num(j.wireCutFeet) > 0) { since.trips = 0; since.jars = 0; since.mins = 0; }
    }
    const lim = p.sop('retire_runs_limit', 220);
    const runCount = K.wireRunCount(w, data.jobs);
    const pre = preJobWireStatus(tests.filter((t) => t.docType === 'wire_maintenance_entry').map((t) => ({ test_type: t.testType === 'Torsional' ? 'Torsion' : t.testType, result: t.result, test_date: String(t.testDate).slice(0, 10), approval_status: t.approvalStatus })), today(), p.kpi('C1', 'tension_window_days'));
    return {
      w, runs, tests, deriv, since, runCount, life: Math.round((runCount / lim) * 1000) / 10, lim,
      hours: runs.reduce((s, j) => s + K.num(j.hoursWorking), 0), remaining: K.wireRemaining(w, data.jobs), used: runCount > 0,
      limitPct: Math.round((runCount > 0 ? p.sop('tension_limit_used_wire_percent', 0.5) : p.sop('tension_limit_new_wire_percent', 0.6)) * 100),
      pre, unit: unitOf(data.drums)(w.drumNo), alerts: data.notifications.filter((n) => String(n.wireSerialNumber ?? '') === serial),
      tripLimit: p.sop('cutback_trips_limit', 3), jarLimit: p.sop('jar_limit', 25), jarMinLimit: p.sop('jar_minutes_limit', 30),
    };
  }, [data, q.data, serial]);
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <Banner tone="danger">{q.error.message}</Banner>;
  if (!view) return <Banner tone="warning" action={<Link className="underline" to="/wires">All wires</Link>}>Wire {serial} isn’t in your countries’ WIREGUARD data.</Banner>;
  const v = view;
  return (
    <section aria-labelledby="wire-title">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/wires" className="inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-xs font-semibold hover:bg-surface-3"><ArrowLeft aria-hidden className="size-4" />Wires</Link>
        <h1 id="wire-title" className="font-display text-xl font-extrabold uppercase">Wire {serial}</h1>
        <span className="text-sm text-text-muted">{v.w.wireGrade} · {v.w.wireSize} in · {v.w.status}</span>
        <span className="ml-auto"><OpenInWg /></span>
      </div>
      <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Remaining" value={Math.round(v.remaining).toLocaleString()} unit="ft" note={`spooled ${K.num(v.w.spooledLength).toLocaleString()} ft`} />
        <KpiTile label="Drum · unit" value={v.w.drumNo ?? '—'} note={v.unit ?? 'no unit'} />
        <KpiTile label="Life consumed" value={v.life} unit="%" note={`${v.runCount} of ${v.lim} runs`} />
        <KpiTile label="Since last cut" value={`${v.since.trips} trips`} note={`${v.since.jars} impacts · ${v.since.mins} min jarring (limits ${v.tripLimit} / ${v.jarLimit} / ${v.jarMinLimit})`} />
        <KpiTile label="Hours worked" value={Math.round(v.hours).toLocaleString()} unit="h" />
        <KpiTile label="Tension limit" value={v.limitPct} unit="% MBL" note={`${v.used ? 'used wire' : 'new wire'} · MBL ${K.num(v.w.ratedMBL).toLocaleString()} lb`} />
      </dl>
      <div className="mb-4"><Banner tone={v.pre.ok ? 'success' : 'warning'}>{v.pre.ok ? `Pre-job tests in order for today (tension test ${v.pre.tension?.test_date}).` : `Pre-job tests: ${v.pre.reasons.join(' · ')}.`}</Banner></div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Card className="overflow-x-auto p-0">
          <h2 className="label-caps px-4 pt-3 text-text-muted">Runs ({v.runs.length})</h2>
          <table className="mt-2 w-full min-w-[52rem] text-xs">
            <thead><tr className="text-left text-text-muted">{['Date', 'DRSS', 'Job', 'Depth ft', 'Max tension', 'MBL %', 'Jarring', 'Cut ft', 'Remaining', 'Rules'].map((h) => <th key={h} scope="col" className="px-3 py-1.5 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {v.runs.slice(0, 200).map((j) => {
                const d = v.deriv[j.id];
                const broken = d ? [!d.tripCompliant && 'trips', !d.jarCompliant && 'jarring', d.tensionCompliant === false && 'tension', d.preJobCompliant === false && 'pre-job test'].filter(Boolean) : [];
                return (
                  <tr key={j.id} className={cx('border-t border-border', K.isCutOnly(j) && 'text-text-subtle')}>
                    <td className="px-3 py-1.5 font-mono whitespace-nowrap">{String(j.jobDate).slice(0, 10)}</td><td className="px-3 py-1.5 font-mono">{j.drssNumber ?? '—'}</td>
                    <td className="px-3 py-1.5">{K.isCutOnly(j) ? 'Shop cut' : j.jobName ?? '—'}</td><td className="px-3 py-1.5 font-mono">{K.num(j.maxDepth) || '—'}</td>
                    <td className="px-3 py-1.5 font-mono">{K.num(j.maxTension) || '—'}</td>
                    <td className={cx('px-3 py-1.5 font-mono', d?.tensionCompliant === false && 'font-semibold text-danger')}>{d?.utilisation != null ? `${Math.round(d.utilisation * 1000) / 10}` : '—'}</td>
                    <td className="px-3 py-1.5 font-mono">{K.num(j.jarringImpactCount) || K.num(j.jarringMinutes) ? `${K.num(j.jarringImpactCount)} / ${K.num(j.jarringMinutes)}m` : '—'}</td>
                    <td className="px-3 py-1.5 font-mono">{K.num(j.wireCutFeet) || '—'}</td><td className="px-3 py-1.5 font-mono">{K.num(j.remainingLengthFeet) ? Math.round(K.num(j.remainingLengthFeet)).toLocaleString() : '—'}</td>
                    <td className={cx('px-3 py-1.5', broken.length > 0 && 'text-warning')}>{K.isCutOnly(j) ? '' : broken.length ? broken.join(', ') : '✓'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {v.runs.length > 200 && <p className="px-4 py-2 text-xs text-text-subtle">Latest 200 shown. The full history is in WIREGUARD.</p>}
        </Card>
        <div className="space-y-4">
          <Card>
            <h2 className="label-caps mb-2 text-text-muted">Tests and inspections ({v.tests.length})</h2>
            {!v.tests.length ? <p className="text-sm text-text-subtle">None recorded.</p> : (
              <ul className="divide-y divide-border text-sm">{v.tests.slice(0, 30).map((t, i) => (
                <li key={t.id ?? i} className="flex flex-wrap gap-x-2 py-1.5"><span className="font-mono text-xs">{String(t.testDate).slice(0, 10)}</span><span>{t.testType ?? (t.docType === 'drum_mpi' ? 'Drum MPI' : t.docType)}</span>
                  <span className={cx('font-semibold', t.result === 'Pass' ? 'text-success' : t.result ? 'text-danger' : 'text-text-subtle')}>{t.result ?? 'pending'}</span>
                  {t.expiryDate && <span className="text-xs text-text-muted">expires {String(t.expiryDate).slice(0, 10)}</span>}{String(t.approvalStatus ?? '').toLowerCase() === 'pending' && <span className="text-xs text-warning">awaiting approval</span>}</li>
              ))}</ul>
            )}
          </Card>
          <Card>
            <h2 className="label-caps mb-2 text-text-muted">Alerts</h2>
            {!v.alerts.length ? <p className="text-sm text-text-subtle">None.</p> : <ul className="space-y-1 text-sm">{v.alerts.map((n, i) => <li key={n.id ?? i} className={cx(n.resolvedAt && 'text-text-subtle line-through')}><span className="font-mono text-xs">{String(n.occurredAt ?? '').slice(0, 10)}</span> {n.message}</li>)}</ul>}
          </Card>
        </div>
      </div>
    </section>
  );
}

export function WireKpis() {
  const { q, data } = useWireData();
  const { data: me } = useMe();
  const wgUrl = useWgUrl();
  const [f, setF] = useState({ year: '', month: '', unit: '', field: '', wire: '' });
  const [w14, setW14] = useState<K.W14Metric>('remaining');
  const ctx = useMemo(() => {
    if (!data || !q.data) return null;
    const unit = unitOf(data.drums);
    const filtered = data.jobs.filter((j) => {
      const p = K.dateParts(j.jobDate);
      return (!f.year || p?.y === f.year) && (!f.month || p?.m === f.month) && (!f.unit || unit(j.drumNo) === f.unit) && (!f.field || j.fieldName === f.field) && (!f.wire || String(j.wireSerialNumber) === f.wire);
    });
    return K.context(data, filtered, q.data.settings, today());
  }, [data, q.data, f]);
  const opts = useMemo(() => {
    if (!data) return { years: [] as string[], units: [] as string[], fields: [] as string[], wires: [] as string[] };
    const unit = unitOf(data.drums);
    return {
      years: [...new Set(data.jobs.map((j) => K.dateParts(j.jobDate)?.y).filter(Boolean))].sort().reverse() as string[],
      units: [...new Set(data.jobs.map((j) => unit(j.drumNo)).filter(Boolean))].sort() as string[],
      fields: [...new Set(data.jobs.map((j) => j.fieldName).filter(Boolean))].sort() as string[],
      wires: [...new Set(data.jobs.map((j) => String(j.wireSerialNumber ?? '')).filter(Boolean))].sort(),
    };
  }, [data]);
  const on = (id: string) => !ctx || ctx.p.enabled(id);
  // the latest 24 months; older ones stay in WIREGUARD's dashboard
  const monthly = (rows: { key: string; value: number }[]) => rows.slice(-24).map((r) => ({ key: r.key, label: monthLabel(r.key), value: r.value, ids: [] as string[] }));
  const wireF: K.WireFilter = f.wire ? { wires: [f.wire] } : {};
  return (
    <section aria-labelledby="wk-title">
      <PageTitle aside={wgUrl && <a className="inline-flex items-center gap-1 text-sm underline" href={wgUrl} target="_blank" rel="noreferrer">Open the full WIREGUARD dashboard<ExternalLink aria-hidden className="size-3.5" /></a>}>
        <span id="wk-title">Wire KPIs</span>
      </PageTitle>
      <p className="-mt-3 mb-3 text-sm text-text-muted">WIREGUARD’s own KPIs, with the same codes and parameters, worked out from the synced runs, tests and alerts.</p>
      {q.data && !q.data.parityCurrent && me?.role === 'admin' && (
        <div className="mb-3"><Banner tone="warning">WIREGUARD updated (build {q.data.build}) — KPI parity not yet re-checked against this build. Last verified: {q.data.verifiedBuild}.</Banner></div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <select aria-label="Year" className={inputSized('h-(--layout-control-sm) w-28')} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}><option value="">All years</option>{opts.years.map((y) => <option key={y}>{y}</option>)}</select>
        <select aria-label="Month" className={inputSized('h-(--layout-control-sm) w-28')} value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })}><option value="">All months</option>{Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => <option key={m} value={m}>{monthLabel(`2000-${m}`).slice(0, 3)}</option>)}</select>
        <select aria-label="Unit" className={inputSized('h-(--layout-control-sm) w-32')} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}><option value="">All units</option>{opts.units.map((u) => <option key={u}>{u}</option>)}</select>
        <select aria-label="Field" className={inputSized('h-(--layout-control-sm) w-40')} value={f.field} onChange={(e) => setF({ ...f, field: e.target.value })}><option value="">All fields</option>{opts.fields.map((u) => <option key={u}>{u}</option>)}</select>
        <select aria-label="Wire" className={inputSized('h-(--layout-control-sm) w-36')} value={f.wire} onChange={(e) => setF({ ...f, wire: e.target.value })}><option value="">All wires</option>{opts.wires.map((u) => <option key={u}>{u}</option>)}</select>
      </div>
      {q.isPending && <Skeleton className="h-96" />}
      {q.isError && <Banner tone="danger">{q.error.message}</Banner>}
      {ctx && (() => {
        const g1 = K.kpiG1(ctx), g2 = K.kpiG2(ctx), g3 = K.kpiG3(ctx), g4 = K.kpiG4(ctx), g5 = K.kpiG5(ctx), g6 = K.kpiG6(ctx), c12 = K.kpiC12(ctx);
        const c1 = K.kpiC1(ctx), c2 = K.kpiC2(ctx), c3 = K.kpiC3(ctx), c4 = K.kpiC4(ctx), c5 = K.kpiC5(ctx), c6 = K.kpiC6(ctx);
        const j7 = K.kpiJ7(ctx), j9 = K.kpiJ9(ctx), m5 = K.kpiM5(ctx, wireF), w14r = K.kpiW14(ctx, w14, wireF), w1 = K.kpiW1(ctx);
        const tag = (id: string) => <span className="ml-1 font-mono text-label text-text-subtle">{id}</span>;
        const pct = (v: number | null) => (v === null ? '—' : v);
        const bands = [0, 20, 40, 50, 60, 80].map((lo, i, a) => ({ key: String(lo), label: i === a.length - 1 ? `${lo}%+` : `${lo}–${a[i + 1]}%`, value: j7.points.filter((p) => p.pct >= lo && (i === a.length - 1 || p.pct < a[i + 1])).length, ids: [] as string[] }));
        return (
          <>
            <h2 className="label-caps mb-2 text-text-muted">General</h2>
            <dl className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              {on('G1') && <KpiTile label="Runs logged · G1" value={g1.runs.toLocaleString()} note={g1.pending ? `${g1.pending} awaiting approval` : 'all approved'} />}
              {on('G2') && <KpiTile label="Hours worked · G2" value={Math.round(g2.hours).toLocaleString()} unit="h" note={`avg ${Math.round(g2.perRun * 10) / 10} h per run`} />}
              {on('G3') && <KpiTile label="Wire cut · G3" value={Math.round(g3.cut).toLocaleString()} unit="ft" note={`across ${g3.wires} wires${g3.shop ? ` · ${Math.round(g3.shop)} ft in the shop` : ''}`} />}
              {on('G4') && <KpiTile label="Active wires · G4" value={g4.active} note={`${g4.registry} in the registry · ${g4.drums} drums`} />}
              {on('G5') && <KpiTile label="Open alerts · G5" value={g5.open} note={`${g5.crit} critical · ${g5.warn} warning · ${g5.data} suspicious`} />}
              {on('G6') && <KpiTile label="Awaiting approval · G6" value={g6.pending} note={g6.pending ? `${g6.runs} runs · ${g6.maint} maintenance · oldest ${g6.oldestDays} d` : 'nothing waiting'} />}
              {on('C12') && <KpiTile label="Compliance score · C12" value={c12.score === null ? '—' : c12.score} unit="%" note={`target ${c12.target}%`} />}
            </dl>
            <h2 className="label-caps mb-2 text-text-muted">Compliance</h2>
            <dl className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {on('C1') && <KpiTile label="Pre-job test · C1" value={pct(c1.pct)} unit={c1.pct === null ? undefined : '%'} note={`${c1.ok} of ${c1.den} runs`} />}
              {on('C2') && <KpiTile label="Cut-back on trips · C2" value={pct(c2.pct)} unit={c2.pct === null ? undefined : '%'} note={`${c2.breaches} breaching runs`} />}
              {on('C3') && <KpiTile label="Cut-back on jarring · C3" value={pct(c3.pct)} unit={c3.pct === null ? undefined : '%'} note={`${c3.breaches} breaching runs`} />}
              {on('C4') && <KpiTile label="Tension within limit · C4" value={pct(c4.pct)} unit={c4.pct === null ? undefined : '%'} note={c4.unmeasured ? `${c4.unmeasured} runs can’t be judged` : `${c4.den} runs judged`} />}
              {on('C5') && <KpiTile label="Discard rule · C5" value={c5.count} note={c5.count ? c5.wires.slice(0, 4).join(', ') : `no active wire past ${c5.odLim}% OD or ${c5.runLim} runs`} />}
              {on('C6') && <KpiTile label="MPI currency · C6" value={pct(c6.pct)} unit={c6.pct === null ? undefined : '%'} note={`${c6.ok} of ${c6.den} drums${c6.expiring ? ` · ${c6.expiring} expiring` : ''}`} />}
            </dl>
            {on('C1') && Object.keys(c1.why).length > 0 && <p className="mb-3 text-xs text-text-muted">Why runs failed the pre-job test (C1): {Object.entries(c1.why).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} × ${k}`).join(' · ')}</p>}
            <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {on('C1') && <BarChart title="Pre-job test compliance by month (C1)" buckets={monthly(c1.monthly)} unit="%" max={100} />}
              {on('C2') && <BarChart title="Cut-back on trips by month (C2)" buckets={monthly(c2.monthly)} unit="%" max={100} />}
              {on('C3') && <BarChart title="Cut-back on jarring by month (C3)" buckets={monthly(c3.monthly)} unit="%" max={100} />}
              {on('C4') && <BarChart title="Tension within limit by month (C4)" buckets={monthly(c4.monthly)} unit="%" max={100} />}
            </div>
            <h2 className="label-caps mb-2 text-text-muted">Jobs, maintenance and integrity</h2>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {on('J7') && <BarChart title="Tension utilisation per run (J7)" buckets={bands} note={<>{j7.points.length} runs with tension and MBL; <b className={cx(j7.over > 0 && 'text-danger')}>{j7.over}</b> over their limit ({j7.limNew}% new wire, {j7.limUsed}% used wire). Bands are % of rated MBL.</>} />}
              {on('J9') && <BarChart title="Runs over the tension limit by month (J9)" buckets={monthly(j9.monthly)} note={`${j9.over} of ${j9.measurable} measurable runs (${j9.pct ?? '—'}%).`} />}
              {on('M5') && <BarChart title="Time since last passing test (M5)" horizontal buckets={m5.bins.map((b) => ({ key: b.label, label: b.label, value: b.value, ids: [] }))}
                note={<>{m5.over} of {m5.live} wires in service are past the {m5.window}-day window{m5.worst.length ? `: ${m5.worst.map((x) => `${x.wire} (${x.days === null ? 'never' : `${x.days} d`})`).join(', ')}` : ''}.</>} />}
              {on('W14') && (
                <Card>
                  <div className="mb-3 flex items-center gap-2"><h3 className="flex-1 text-sm font-semibold">Wires needing attention first{tag('W14')}</h3>
                    <select aria-label="W14 measure" className={inputSized('h-(--layout-control-sm) w-48')} value={w14} onChange={(e) => setW14(e.target.value as K.W14Metric)}><option value="remaining">Remaining length</option><option value="od">OD reduction</option><option value="runs">Cumulative runs</option></select></div>
                  <ul className="space-y-1 text-sm">{w14r.items.map((i) => <li key={i.label} className="flex gap-2"><Link className="flex-1 font-mono underline" to={`/wires/${encodeURIComponent(i.label)}`}>{i.label}</Link>
                    <span className={cx('font-mono', w14 === 'remaining' && i.value < w14r.lowLength && 'text-warning')}>{Math.round(i.value * 10) / 10}{w14r.unit && ` ${w14r.unit}`}</span></li>)}</ul>
                  {w14 === 'remaining' && <p className="mt-2 text-xs text-text-subtle">Lowest first. Low-length warning at {w14r.lowLength.toLocaleString()} ft.</p>}
                </Card>
              )}
              {on('W1') && <BarChart title="Life consumed (W1)" horizontal buckets={w1.items.map((i) => ({ key: i.label, label: i.label, value: i.value, ids: [] }))} unit="%" max={100}
                note={`Cumulative runs ÷ ${w1.limit}-run retirement limit (warning at ${w1.warning}). Fleet: ${w1.bands.map((b) => `${b.label} ${b.value}`).join(' · ')}.`} />}
            </div>
          </>
        );
      })()}
    </section>
  );
}
