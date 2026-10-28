import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Link2, Lock, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { NO_ACCOUNT, byAccount } from '../../shared/accounts';
import { ACTIVITY_FIELDS, ACTIVITY_GROUPS, FORMATS, FORMAT_KEYS, changedSinceLock, monthLabel, shownValue, ticketStatusesFor, type FormatKey, type SheetLine } from '../../shared/salesSheets';
import { recordPdf, sheetSpec } from '../../shared/sheetExport';
import { workbookSheets } from '../../shared/xlsx';
import { api } from '../api';
import { useMe } from '../auth';
import { AccountLegend, useAccountColors } from '../components/Accounts';
import { KpiTile, saveFile } from '../components/charts';
import { useFilters } from '../components/FilterBar';
import { ActivityRecords } from '../components/ActivityRecords';
import type { GridLine, GridSection } from '../components/SheetGrid';
import { Banner, Button, EmptyState, Skeleton, cx, inputSized } from '../components/ui';

// Sales dashboard → Activity sheet: the billing line of every job in a revenue month, grouped by account, to fill
// what the job doesn't hold (DMR status, ticket follow-up, partial billing …), check line by line and lock.

interface ActivityData { month: string; formats: Record<string, string>; lines: SheetLine[]; canUnlock: boolean }

const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).slice(0, 7);
const shiftMonth = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHOW = [['all', 'All lines'], ['open', 'To check'], ['checked', 'Checked'], ['changed', 'Changed since checked']] as const;
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const sumOf = (lines: SheetLine[], key: string) => lines.reduce((a, l) => a + (Number(shownValue(ACTIVITY_FIELDS.find((f) => f.key === key)!, l, ACTIVITY_FIELDS)) || 0), 0);

export function SalesActivity() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [filters] = useFilters();
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : thisMonth();
  const setMonth = (m: string) => { const n = new URLSearchParams(params); n.set('month', m || thisMonth()); setParams(n, { replace: true }); };
  const show = (params.get('show') ?? 'all') as (typeof SHOW)[number][0];
  const setShow = (s: string) => { const n = new URLSearchParams(params); if (s === 'all') n.delete('show'); else n.set('show', s); setParams(n, { replace: true }); };
  const key = ['sales-activity', month];
  const q = useQuery({ queryKey: key, queryFn: () => api<ActivityData>(`/sales/activity?month=${month}`) });
  const picked = filters.account ?? [];
  const colorOf = useAccountColors();
  const [openJobs, setOpenJobs] = useState<Set<string>>(new Set());
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [find, setFind] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = !!me?.menus.sales_dashboard?.edit;

  const all = q.data?.lines ?? [];
  const lines = useMemo(() => {
    const t = find.trim().toLowerCase();
    return all.filter((l) => {
      if (picked.length && !picked.includes(l.account ?? NO_ACCOUNT)) return false;
      if (show === 'open' && l.locked) return false;
      if (show === 'checked' && !l.locked) return false;
      if (show === 'changed' && !changedSinceLock(l, ACTIVITY_FIELDS).length) return false;
      if (!t) return true;
      return [l.app.ticket, l.app.well, l.app.field_rig, l.app.unit, l.app.drss_no, l.app.dmr_no, l.app.service_order_no, l.app.supervisor].some((v) => String(v ?? '').toLowerCase().includes(t));
    });
  }, [all, show, find, picked]);
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const l of all) m.set(l.account ?? NO_ACCOUNT, (m.get(l.account ?? NO_ACCOUNT) ?? 0) + 1); return m; }, [all]);

  const sections: GridSection[] = byAccount(lines, (l) => l.account).map((g) => {
    const fmt = g.items[0]?.format ?? 'standard';
    return {
      key: g.account, title: g.account, color: colorOf(g.account), lines: g.items,
      aside: (
        <span className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-text-muted">Net {money(sumOf(g.items, 'net'))}</span>
          {canEdit && g.account !== NO_ACCOUNT ? (
            <label className="flex items-center gap-1 text-text-muted">Format
              <select className="h-6 rounded border border-border bg-surface px-1 text-xs text-text" value={fmt} onChange={(e) => setFormat(g.account, e.target.value as FormatKey)}>
                {FORMAT_KEYS.map((k) => <option key={k} value={k}>{FORMATS[k].label}</option>)}
              </select>
            </label>
          ) : <span className="text-text-muted">Format {FORMATS[fmt].label}</span>}
        </span>
      ),
    };
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['sales-activity'] });
  const run = async (fn: () => Promise<unknown>) => { setErr(null); setBusy(true); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); refresh(); } };
  const onSave = (l: GridLine, field: string, value: string) => {
    // shown at once; the reload after the save brings back what was stored
    qc.setQueryData<ActivityData>(key, (d) => d && { ...d, lines: d.lines.map((x) => (x.id === l.id ? { ...x, data: { ...x.data, [field]: value === '' ? null : value } } : x)) });
    run(() => api(`/sales/activity/${l.id}`, { method: 'PUT', json: { values: { [field]: value } } }));
  };
  const onLock = (ids: string[]) => {
    if (ids.length > 1 && !window.confirm(`Mark ${ids.length} lines as checked and lock them? Only an Admin can unlock a line.`)) return;
    run(async () => { await api('/sales/activity/lock', { method: 'POST', json: { job_ids: ids } }); setSelected(new Set()); });
  };
  const onUnlock = (ids: string[]) => {
    const reason = window.prompt('Why unlock this line? The reason goes to the audit trail.');
    if (reason === null) return;
    run(() => api('/sales/activity/unlock', { method: 'POST', json: { job_ids: ids, reason } }));
  };
  const setFormat = (account: string, format: FormatKey) => run(() => api('/sales/formats', { method: 'PUT', json: { account, format } }));

  const exportXlsx = () => {
    const lead = [{ label: 'Line', value: (l: SheetLine) => (l.app.ticket as string | null) ?? l.id, width: 14 }];
    const groups = byAccount(lines, (l) => l.account);
    const specs = [
      sheetSpec('All accounts', lead, ACTIVITY_FIELDS, ACTIVITY_GROUPS, groups.map((g) => ({ title: g.account, lines: g.items })), true),
      ...groups.map((g) => sheetSpec(g.account, lead, ACTIVITY_FIELDS, ACTIVITY_GROUPS, [{ title: g.account, lines: g.items }], true)),
    ];
    saveFile(`activity-sheet-${month}.xlsx`, workbookSheets(specs), XLSX_TYPE);
  };
  // Both sizes print the full detail: every field of each job in labelled group blocks (A4 four columns, A3 five).
  const exportPdf = (paper: 'A4' | 'A3') => {
    const subtitle = `${lines.length} lines · ${lines.filter((l) => l.locked).length} checked · net revenue ${money(sumOf(lines, 'net'))} · ${me?.countries.join(', ') ?? ''}`;
    const footer = `SLK Operations · Activity sheet ${monthLabel(month)} · printed ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })} Riyadh by ${me?.fullName ?? ''}`;
    const secs = sections.map((s) => ({ title: s.title, lines: s.lines, color: s.color, total: `Net ${money(sumOf(s.lines, 'net'))}` }));
    const bytes = recordPdf({ title: `Activity sheet · ${monthLabel(month)}`, subtitle, footer, sections: secs, fields: ACTIVITY_FIELDS, groups: ACTIVITY_GROUPS, paper,
        heading: (l) => {
          const net = shownValue(ACTIVITY_FIELDS.find((f) => f.key === 'net')!, l, ACTIVITY_FIELDS);
          return { name: String(l.app.ticket ?? 'No ticket'), facts: [l.app.well, l.app.unit, l.app.field_rig, l.app.job_status, l.app.entity].map((v) => (v == null ? '' : String(v))),
            amount: net == null ? undefined : `${Number(net).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${l.app.currency ?? ''}`.trim() };
        } });
    saveFile(`activity-sheet-${month}-${paper}.pdf`, bytes as BlobPart, 'application/pdf');
  };

  const gross = sumOf(lines, 'gross'), net = sumOf(lines, 'net');
  const checked = lines.filter((l) => l.locked).length;
  const noRevenue = lines.filter((l) => l.app.job_status === 'Completed' && shownValue(ACTIVITY_FIELDS.find((f) => f.key === 'gross')!, l, ACTIVITY_FIELDS) === null).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <span className="label-caps mb-1 block text-text-muted">Revenue month</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft aria-hidden className="size-4" /></Button>
            <input type="month" aria-label="Revenue month" className={inputSized('w-40')} value={month} onChange={(e) => setMonth(e.target.value)} />
            <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight aria-hidden className="size-4" /></Button>
          </div>
        </div>
        <label className="relative block w-64"><span className="label-caps mb-1 block text-text-muted">Find a line</span>
          <Search aria-hidden className="pointer-events-none absolute bottom-2.5 left-2.5 size-3.5 text-text-subtle" />
          <input className={inputSized('pl-8')} placeholder="Ticket, well, DMR, SO, unit…" value={find} onChange={(e) => setFind(e.target.value)} />
        </label>
        <div role="radiogroup" aria-label="Lines to show" className="flex flex-wrap gap-1">
          {SHOW.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={show === k} onClick={() => setShow(k)}
            className={cx('h-(--layout-control-sm) rounded-pill border px-3 text-sm font-semibold', show === k ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>{l}</button>)}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit && <Button size="sm" variant="primary" disabled={!selected.size} loading={busy} onClick={() => onLock([...selected])}><Lock aria-hidden className="size-4" />Check & lock{selected.size ? ` (${selected.size})` : ''}</Button>}
          <Button size="sm" onClick={exportXlsx} disabled={!lines.length}><FileSpreadsheet aria-hidden className="size-4" />Excel</Button>
          <Button size="sm" onClick={() => exportPdf('A4')} disabled={!lines.length} title="A4 landscape: every field of each job, grouped (Job, Crew, Dates, Hours, Ticket, Revenue …)"><FileText aria-hidden className="size-4" />PDF A4</Button>
          <Button size="sm" onClick={() => exportPdf('A3')} disabled={!lines.length} title="A3 landscape: the same layout, larger"><FileText aria-hidden className="size-4" />PDF A3</Button>
        </div>
      </div>
      <AccountLegend counts={counts} noun="lines" />
      {err && <Banner tone="danger">{err}</Banner>}
      {q.isPending && <Skeleton className="h-64" />}
      {q.isError && <Banner tone="danger">{q.error.message}</Banner>}
      {q.data && (
        <>
          <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <KpiTile label="Lines" value={lines.length} note={monthLabel(month)} />
            <KpiTile label="Checked" value={`${checked}/${lines.length}`} note={lines.length ? `${Math.round((checked / lines.length) * 100)}% locked` : undefined} />
            <KpiTile label="Gross revenue" value={money(gross)} />
            <KpiTile label="Net revenue" value={money(net)} note={gross !== net ? `${money(gross - net)} billed earlier` : undefined} />
            <KpiTile label="Completed, no revenue" value={noRevenue} note={noRevenue ? 'Add it on the job’s Closure' : undefined} />
          </dl>
          {!all.length ? (
            <EmptyState title={`No jobs in ${monthLabel(month)}`}>A job counts in the month it ends (or starts, when it has no end date), unless its line says another revenue month.</EmptyState>
          ) : !lines.length ? <EmptyState title="No line matches" /> : (
            <>
              <ActivityRecords caption={`Activity sheet for ${monthLabel(month)}, one line per job, grouped by account. Unfold a job to see and edit every field.`}
                fields={ACTIVITY_FIELDS} groups={ACTIVITY_GROUPS} sections={sections} canEdit={canEdit} canUnlock={!!q.data.canUnlock}
                choicesFor={(f, l) => (f.key === 'ticket_status' ? ticketStatusesFor(l.format) : undefined)}
                onSave={onSave} onLock={onLock} onUnlock={onUnlock} selected={selected} setSelected={setSelected}
                open={openJobs} setOpen={setOpenJobs} foldedSections={folded} setFoldedSections={setFolded}
                lead={(l) => (
                  <span className="block leading-tight">
                    <Link to={`/operation/jobs/${l.job_id}/design`} className="font-mono text-sm font-semibold text-accent-text underline-offset-2 hover:underline">{String(l.app.ticket ?? 'no ticket')}</Link>
                    <span className="block truncate text-xs text-text-muted">{[l.app.well, l.app.unit].filter(Boolean).join(' · ') || '—'}</span>
                  </span>
                )} />
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted print:hidden">
                <span>Click a job to unfold every field; click again to fold it.</span>
                <span className="inline-flex items-center gap-1"><Link2 aria-hidden className="size-3" />From the job: fix it in the job</span>
                <span className="inline-flex items-center gap-1"><i aria-hidden className="inline-block h-3 w-5 rounded bg-warning-subtle" />Only some accounts keep this field</span>
                <span className="inline-flex items-center gap-1"><Lock aria-hidden className="size-3 text-success" />Checked and locked</span>
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
