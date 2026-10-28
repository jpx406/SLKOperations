import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Lock, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { DAILY_FIELDS, DAILY_GROUPS, DAILY_STATUSES, shownValue, type SheetLine } from '../../shared/salesSheets';
import { sheetSpec, tablePdf, usedFields, visibleColumns } from '../../shared/sheetExport';
import { workbookSheets, type Cell, type SheetSpec } from '../../shared/xlsx';
import { api, formatDate } from '../api';
import { useMe } from '../auth';
import { useAccountColors } from '../components/Accounts';
import { saveFile } from '../components/charts';
import { GroupSwitches, SheetGrid, SheetLegend, useOpenGroups, type GridLine, type GridSection } from '../components/SheetGrid';
import { Banner, Button, Card, Skeleton, cx, inputSized } from '../components/ui';

// Sales dashboard → Daily report: every unit's line for a day (what it did, where, with whom), worked out from the
// jobs and the unit events, with what the app doesn't hold typed in (unit type, location type, remarks …). Typed
// values carry over to the next day like the copied Excel sheet did. Each line is checked and locked; the counts,
// the upcoming operations and the people on board sit around it.

interface Upcoming { id: string; ticket_no: string | null; location: string | null; rig: string | null; field: string | null; well: string | null; unit_number: string | null; start_date: string; services: string | null; conveyance: string | null }
interface DayRecord { upcoming?: { rig_well: string; date: string; remarks?: string; entity?: string }[]; pob?: Record<string, number | null>; notes?: string }
interface DailyData { day: string; lines: GridLine[]; record: DayRecord; upcoming: Upcoming[]; month: { day: string; lines: number; locked: number }[]; canUnlock: boolean }

const todayRiyadh = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const field = (k: string) => DAILY_FIELDS.find((f) => f.key === k)!;
const val = (l: SheetLine, k: string) => shownValue(field(k), l, DAILY_FIELDS);
const UNASSIGNED = 'No client';
const isRazor = (u: { services: string | null }) => /razor|punch/i.test(u.services ?? '');

function countBy(lines: SheetLine[], k: string, order: readonly string[] = []) {
  const m = new Map<string, number>(order.map((o) => [o, 0]));
  for (const l of lines) { const v = String(val(l, k) ?? '—'); m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m.entries()];
}

function summaryOf(lines: SheetLine[]) {
  const operating = lines.filter((l) => DAILY_STATUSES.find((s) => s.status === val(l, 'status'))?.operating).length;
  return {
    operating, total: lines.length,
    blocks: [
      { title: 'Status', rows: countBy(lines, 'status', DAILY_STATUSES.map((s) => s.status)) },
      { title: 'Location type', rows: countBy(lines, 'location_type') },
      { title: 'Client', rows: countBy(lines, 'client') },
      { title: 'Well type', rows: countBy(lines, 'well_type') },
    ],
  };
}

export function SalesDaily() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('day') ?? '') ? params.get('day')! : todayRiyadh();
  const setDay = (d: string) => { const n = new URLSearchParams(params); n.set('day', d || todayRiyadh()); setParams(n, { replace: true }); setSelected(new Set()); };
  const key = ['sales-daily', day];
  const q = useQuery({ queryKey: key, queryFn: () => api<DailyData>(`/sales/daily?day=${day}`) });
  const colorOf = useAccountColors();
  const [open, setOpen] = useOpenGroups('slk-sales-daily-groups', ['assignment', 'people', 'well', 'notes']);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<DayRecord>({});
  const [recDirty, setRecDirty] = useState(false);
  const canEdit = !!me?.menus.sales_dashboard?.edit;
  useEffect(() => { if (q.data) { setRec(q.data.record ?? {}); setRecDirty(false); } }, [q.data]);

  const lines = q.data?.lines ?? [];
  const sections: GridSection[] = useMemo(() => {
    const m = new Map<string, GridLine[]>();
    for (const l of lines) { const c = String(val(l, 'client') ?? '') || UNASSIGNED; m.set(c, [...(m.get(c) ?? []), l]); }
    return [...m.entries()].sort(([a], [b]) => (a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b)))
      .map(([client, ls]) => ({ key: client, title: client, color: colorOf(ls.find((l) => l.account)?.account), lines: ls }));
  }, [lines, colorOf]);
  const sum = summaryOf(lines);
  const checked = lines.filter((l) => l.locked).length;
  const monthDays = useMemo(() => {
    const first = `${day.slice(0, 7)}-01`;
    const out: string[] = [];
    for (let d = first; d.slice(0, 7) === day.slice(0, 7); d = addDays(d, 1)) out.push(d);
    return out;
  }, [day]);
  const progress = new Map((q.data?.month ?? []).map((m) => [m.day, m]));

  const refresh = () => qc.invalidateQueries({ queryKey: ['sales-daily'] });
  const run = async (fn: () => Promise<unknown>) => { setErr(null); setBusy(true); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); refresh(); } };
  const onSave = (l: GridLine, k: string, value: string) => {
    qc.setQueryData<DailyData>(key, (d) => d && { ...d, lines: d.lines.map((x) => (x.id === l.id ? { ...x, data: { ...x.data, [k]: value === '' ? null : value } } : x)) });
    run(() => api(`/sales/daily/${day}/${encodeURIComponent(l.id)}`, { method: 'PUT', json: { values: { [k]: value } } }));
  };
  const onLock = (ids: string[]) => {
    if (ids.length > 1 && !window.confirm(`Mark ${ids.length} units as checked for ${formatDate(day)} and lock them? Only an Admin can unlock a line.`)) return;
    run(async () => { await api(`/sales/daily/${day}/lock`, { method: 'POST', json: { units: ids } }); setSelected(new Set()); });
  };
  const onUnlock = (ids: string[]) => {
    const reason = window.prompt('Why unlock this line? The reason goes to the audit trail.');
    if (reason === null) return;
    run(() => api(`/sales/daily/${day}/unlock`, { method: 'POST', json: { units: ids, reason } }));
  };
  const editRec = (r: DayRecord) => { setRec(r); setRecDirty(true); };
  const saveRec = () => run(async () => { await api(`/sales/daily/${day}`, { method: 'PUT', json: rec }); setRecDirty(false); });

  const lead = [{ label: 'Unit', value: (l: SheetLine) => l.id as Cell, width: 14 }, { label: 'Job', value: (l: SheetLine) => (l.app.ticket as string | null) ?? null, width: 12 }];
  const extraSheets = (d: DailyData, r: DayRecord): SheetSpec[] => {
    const s = summaryOf(d.lines);
    const rows: Cell[][] = [];
    for (const b of s.blocks) { rows.push([b.title]); for (const [k, n] of b.rows) rows.push(['', k, n]); }
    rows.push(['Total @ operations', '', s.operating], ['Total units', '', s.total]);
    const pob = r.pob ?? {};
    rows.push(['People on board'], ['', 'Operators', pob.operators != null ? `${pob.operators} of ${pob.operators_of ?? '?'}` : null], ['', 'Supervisors', pob.supervisors != null ? `${pob.supervisors} of ${pob.supervisors_of ?? '?'}` : null]);
    const up: Cell[][] = [
      ...d.upcoming.map((u) => [u.start_date, [u.rig, u.well].filter(Boolean).join(' / '), u.services, u.location, u.unit_number, u.ticket_no, isRazor(u) ? 'Razor' : 'Job in SLK Ops']),
      ...(r.upcoming ?? []).map((u) => [u.date || null, u.rig_well, u.remarks ?? null, u.entity ?? null, null, null, 'Typed']),
    ];
    return [
      { name: `Counts ${d.day.slice(8)}`, header: ['Count', 'Value', 'Units'], rows, widths: [22, 26, 10] },
      { name: `Upcoming ${d.day.slice(8)}`, header: ['Date', 'Rig / well', 'Operation', 'Account / entity', 'Unit', 'Ticket', 'From'], rows: up, widths: [12, 26, 30, 16, 10, 12, 14] },
    ];
  };
  const daySheet = (d: DailyData) => {
    const m = new Map<string, SheetLine[]>();
    for (const l of d.lines) { const c = String(val(l, 'client') ?? '') || UNASSIGNED; m.set(c, [...(m.get(c) ?? []), l]); }
    return sheetSpec(`Daily report ${d.day.slice(8)} ${new Date(`${d.day}T00:00:00Z`).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`, lead, DAILY_FIELDS, DAILY_GROUPS, [...m.entries()].map(([title, ls]) => ({ title, lines: ls })), false);
  };
  const exportDay = () => { if (q.data) saveFile(`daily-report-${day}.xlsx`, workbookSheets([daySheet(q.data), ...extraSheets(q.data, rec)]), XLSX_TYPE); };
  const exportMonth = () => run(async () => {
    // one sheet per day, like the workbook: every day of the month up to today
    const last = monthDays.filter((d) => d <= todayRiyadh());
    const specs: SheetSpec[] = [];
    for (const d of last) specs.push(daySheet(await api<DailyData>(`/sales/daily?day=${d}`)));
    saveFile(`daily-report-${day.slice(0, 7)}.xlsx`, workbookSheets(specs), XLSX_TYPE);
  });
  const exportPdf = () => {
    if (!q.data) return;
    const s = summaryOf(lines);
    const pob = rec.pob ?? {};
    const bytes = tablePdf({
      title: `Slickline daily report · ${formatDate(day)}`,
      subtitle: `${s.total} units · ${s.operating} at operations · ${checked} checked · ${me?.countries.join(', ') ?? ''}`,
      lead: [{ label: 'Unit', value: (l) => l.id }, { label: 'Job', value: (l) => String(l.app.ticket ?? '') }],
      cols: visibleColumns(DAILY_FIELDS, DAILY_GROUPS, lines, open), fields: DAILY_FIELDS,
      sections: sections.map((x) => ({ title: x.title, lines: x.lines, color: x.color })),
      notes: [
        ...s.blocks.map((b) => ({ title: b.title, lines: [b.rows.filter(([, n]) => n).map(([k, n]) => `${k}: ${n}`).join('   ·   ') || '—'] })),
        { title: 'People on board', lines: [`Operators ${pob.operators ?? '—'} of ${pob.operators_of ?? '—'}   ·   Supervisors ${pob.supervisors ?? '—'} of ${pob.supervisors_of ?? '—'}`] },
        { title: 'Upcoming operations', lines: [...q.data.upcoming.map((u) => `${formatDate(u.start_date)}  ${[u.rig, u.well].filter(Boolean).join(' / ')}  ${u.services ?? ''}  (${u.location ?? '—'}${u.unit_number ? `, ${u.unit_number}` : ''})`),
          ...(rec.upcoming ?? []).map((u) => `${u.date ? formatDate(u.date) : '—'}  ${u.rig_well}  ${u.remarks ?? ''}  (${u.entity ?? ''})`)].slice(0, 40) },
      ],
      footer: `SLK Operations · Daily report ${day} · printed ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })} Riyadh by ${me?.fullName ?? ''}`,
    });
    saveFile(`daily-report-${day}.pdf`, bytes as BlobPart, 'application/pdf');
  };
  const available = new Set(usedFields(DAILY_FIELDS, lines).map((f) => f.group));
  const pob = rec.pob ?? {};
  const setPob = (k: string, v: string) => editRec({ ...rec, pob: { ...pob, [k]: v === '' ? null : Number(v) } });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <span className="label-caps mb-1 block text-text-muted">Day</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Day before" onClick={() => setDay(addDays(day, -1))}><ChevronLeft aria-hidden className="size-4" /></Button>
            <input type="date" aria-label="Day" className={inputSized('w-44')} value={day} onChange={(e) => setDay(e.target.value)} />
            <Button size="sm" variant="ghost" aria-label="Next day" onClick={() => setDay(addDays(day, 1))}><ChevronRight aria-hidden className="size-4" /></Button>
            {day !== todayRiyadh() && <Button size="sm" variant="ghost" onClick={() => setDay(todayRiyadh())}>Today</Button>}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit && <Button size="sm" variant="primary" disabled={!selected.size} loading={busy} onClick={() => onLock([...selected])}><Lock aria-hidden className="size-4" />Check & lock{selected.size ? ` (${selected.size})` : ''}</Button>}
          <Button size="sm" onClick={exportDay} disabled={!lines.length}><FileSpreadsheet aria-hidden className="size-4" />Excel (day)</Button>
          <Button size="sm" onClick={exportMonth} disabled={busy}><FileSpreadsheet aria-hidden className="size-4" />Excel (month)</Button>
          <Button size="sm" onClick={exportPdf} disabled={!lines.length}><FileText aria-hidden className="size-4" />PDF</Button>
        </div>
      </div>
      <nav aria-label="Days of the month" className="mb-3 flex flex-wrap gap-1 print:hidden">
        {monthDays.map((d) => {
          const p = progress.get(d);
          const full = p && d === day ? p.locked >= lines.length && lines.length > 0 : p ? p.locked > 0 && p.locked === p.lines : false;
          return (
            <button key={d} type="button" aria-current={d === day ? 'date' : undefined} onClick={() => setDay(d)} disabled={d > todayRiyadh()}
              title={p ? `${p.locked} of ${p.lines} saved lines checked` : 'Nothing typed or checked yet'}
              className={cx('flex h-9 w-9 flex-col items-center justify-center rounded border text-xs font-semibold disabled:opacity-40', d === day ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>
              {Number(d.slice(8))}
              <i aria-hidden className={cx('mt-0.5 block size-1.5 rounded-full', full ? 'bg-success' : p?.locked ? 'bg-warning' : p ? 'bg-border-strong' : 'bg-transparent')} />
            </button>
          );
        })}
      </nav>
      {err && <Banner tone="danger">{err}</Banner>}
      {q.isPending && <Skeleton className="h-64" />}
      {q.isError && <Banner tone="danger">{q.error.message}</Banner>}
      {q.data && (
        <>
          <div className="mb-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            <Card className="p-3">
              <p className="label-caps text-text-muted">Units</p>
              <p className="font-display text-2xl font-bold">{sum.operating}<span className="text-base font-medium text-text-muted"> / {sum.total}</span></p>
              <p className="text-xs text-text-muted">at operations · {checked} of {sum.total} checked</p>
            </Card>
            {sum.blocks.map((b) => (
              <Card key={b.title} className="p-3">
                <p className="label-caps mb-1 text-text-muted">{b.title}</p>
                <ul className="space-y-0.5 text-xs">{b.rows.filter(([, n]) => n > 0).map(([k, n]) => <li key={k} className="flex justify-between gap-2"><span className="truncate">{k}</span><span className="font-mono font-semibold">{n}</span></li>)}</ul>
              </Card>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <GroupSwitches groups={DAILY_GROUPS} open={open} setOpen={setOpen} available={available} />
            <span className="flex gap-1 print:hidden">
              <Button size="sm" variant="ghost" onClick={() => setFolded(new Set())}>Show all clients</Button>
              <Button size="sm" variant="ghost" onClick={() => setFolded(new Set(sections.map((s) => s.key)))}>Fold all clients</Button>
            </span>
          </div>
          <SheetGrid caption={`Daily report for ${formatDate(day)}, one line per unit, grouped by client`} fields={DAILY_FIELDS} groups={DAILY_GROUPS} open={open} sections={sections}
            lead={{ label: 'Unit', width: 'min-w-44', render: (l) => (
              <span className="block leading-tight">
                <span className="font-mono text-sm font-semibold">{l.id}</span>
                <span className="block truncate text-xs text-text-muted">
                  {l.job_id ? <Link to={`/operation/jobs/${l.job_id}/design`} className="text-accent-text underline-offset-2 hover:underline">{String(l.app.ticket ?? 'job')}</Link> : String(l.app.event ?? 'no job')}
                </span>
              </span>
            ) }}
            canEdit={canEdit} canUnlock={!!q.data.canUnlock} onSave={onSave} onLock={onLock} onUnlock={onUnlock}
            selected={selected} setSelected={setSelected} foldedSections={folded} setFoldedSections={setFolded} />
          <SheetLegend />

          <div className="mt-4 grid gap-3 lg:grid-cols-[2fr_1fr]">
            <Card className="p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-bold">Upcoming operations (next 3 weeks)</h3>
                {canEdit && <Button size="sm" variant="ghost" onClick={() => editRec({ ...rec, upcoming: [...(rec.upcoming ?? []), { rig_well: '', date: '', remarks: '', entity: 'NESR' }] })}><Plus aria-hidden className="size-3.5" />Add a rig with no job</Button>}
              </div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-text-muted">{['Date', 'Rig / well', 'Operation', 'Account', ''].map((h) => <th key={h} scope="col" className="label-caps py-1 pr-2 font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {q.data.upcoming.map((u) => (
                    <tr key={u.id} className="border-t border-border">
                      <td className="py-1 pr-2 font-mono text-xs">{formatDate(u.start_date)}</td>
                      <td className="py-1 pr-2"><Link to={`/operation/jobs/${u.id}/design`} className="text-accent-text underline-offset-2 hover:underline">{[u.rig, u.well].filter(Boolean).join(' / ') || u.ticket_no || 'job'}</Link></td>
                      <td className="py-1 pr-2">{u.services ?? '—'}{isRazor(u) && <span className="ml-1 rounded-pill border border-border px-1.5 text-xs">Razor</span>}</td>
                      <td className="py-1 pr-2 text-text-muted">{u.location ?? '—'}{u.unit_number ? ` · ${u.unit_number}` : ''}</td>
                      <td />
                    </tr>
                  ))}
                  {(rec.upcoming ?? []).map((u, i) => {
                    const set = (k: string, v: string) => editRec({ ...rec, upcoming: (rec.upcoming ?? []).map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
                    return (
                      <tr key={`typed-${i}`} className="border-t border-border">
                        <td className="py-1 pr-2"><input type="date" aria-label="Estimated date" disabled={!canEdit} className={inputSized('h-7 w-36 text-xs')} value={u.date} onChange={(e) => set('date', e.target.value)} /></td>
                        <td className="py-1 pr-2"><input aria-label="Rig / well" disabled={!canEdit} className={inputSized('h-7 text-xs')} value={u.rig_well} onChange={(e) => set('rig_well', e.target.value)} placeholder="AD-73 / THRY-921802" /></td>
                        <td className="py-1 pr-2"><input aria-label="Operation" disabled={!canEdit} className={inputSized('h-7 text-xs')} value={u.remarks ?? ''} onChange={(e) => set('remarks', e.target.value)} placeholder="Completion 4.5in" /></td>
                        <td className="py-1 pr-2"><select aria-label="Entity" disabled={!canEdit} className={inputSized('h-7 w-28 text-xs')} value={u.entity ?? 'NESR'} onChange={(e) => set('entity', e.target.value)}><option>NESR</option><option>SAPESCO</option></select></td>
                        <td className="py-1">{canEdit && <Button size="sm" variant="ghost" aria-label="Remove this line" onClick={() => editRec({ ...rec, upcoming: (rec.upcoming ?? []).filter((_, j) => j !== i) })}><Trash2 aria-hidden className="size-3.5" /></Button>}</td>
                      </tr>
                    );
                  })}
                  {!q.data.upcoming.length && !(rec.upcoming ?? []).length && <tr><td colSpan={5} className="py-2 text-text-subtle">No planned job starts in the next three weeks.</td></tr>}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-text-subtle">Planned jobs come from the schedule. Add a line for a rig that has no job yet (SAPESCO rigs, razor requests …).</p>
            </Card>
            <Card className="p-3">
              <h3 className="mb-2 font-display text-sm font-bold">People on board</h3>
              <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-2 text-sm">
                {[['operators', 'Operators'], ['supervisors', 'Supervisors']].map(([k, label]) => (
                  <div key={k} className="contents">
                    <span>{label}</span>
                    <input type="number" min={0} aria-label={`${label} on board`} disabled={!canEdit} className={inputSized('h-8 text-right font-mono')} value={pob[k] ?? ''} onChange={(e) => setPob(k, e.target.value)} />
                    <span className="text-text-muted">of</span>
                    <input type="number" min={0} aria-label={`${label} in total`} disabled={!canEdit} className={inputSized('h-8 text-right font-mono')} value={pob[`${k}_of`] ?? ''} onChange={(e) => setPob(`${k}_of`, e.target.value)} />
                  </div>
                ))}
              </div>
              <label className="mt-3 block text-sm"><span className="label-caps mb-1 block text-text-muted">Notes for the day</span>
                <textarea disabled={!canEdit} rows={3} className={inputSized('h-auto py-1.5')} value={rec.notes ?? ''} onChange={(e) => editRec({ ...rec, notes: e.target.value })} />
              </label>
              {canEdit && <Button className="mt-2" size="sm" variant={recDirty ? 'primary' : 'secondary'} disabled={!recDirty} loading={busy} onClick={saveRec}><Save aria-hidden className="size-3.5" />Save upcoming and people on board</Button>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
