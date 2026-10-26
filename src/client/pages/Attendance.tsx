import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check, Download, FileSpreadsheet, Mail, MousePointerClick, Save, Search, Tags, Trash2, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CODES, CODE_LIST, LEAVE, assignmentsOn, isWeekend, rowSummary, type Assignment, type Code } from '../../shared/attendance';
import { SHEETS, SHEET_KEYS, type SheetKey } from '../../shared/attendanceSheets';
import { ROLE_LABEL } from '../../shared/roles';
import type { Role } from '../../shared/types';
import { workbook } from '../../shared/xlsx';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { saveFile } from '../components/charts';
import { SignedToggle } from '../components/Signature';
import { Banner, Button, Card, EmptyState, Field, Skeleton, cx, inputClass, inputSized, rovingKeys } from '../components/ui';

// Attendance (S17), laid out like the WL Operations Hub sheet: one card per sheet, one row per person, one column
// per day. Who fills and who approves each sheet follows the roles (shared/attendanceSheets.ts):
//   Operators & Helpers — the Foreman fills their crew, the SDM approves
//   Support Staff (Shop) — the Maintenance Supervisor fills, the Maintenance Manager approves
//   Management — each person (or an Admin) fills, the Operations Manager approves
// Click a cell to pick a code, or switch on Multi-Select, pick cells (Shift-click for a range) and apply one code.
// Nothing is stored until Save.

interface Person {
  id: string; country: string; eid: string; full_name: string; title: string; account: string; crew_role: string | null;
  reports_to_id: string | null; reports_to_name: string | null; wg_username: string | null; self_updated: number;
  sheet: SheetKey; can_fill: boolean; can_approve: boolean; updated_by: string | null; user_role: Role;
}
interface Sheet {
  month: string; days: string[]; full: boolean; people: Person[]; entries: { employee_id: string; day: string; code: Code }[];
  approvals: { employee_id: string; approved_by: string; approved_at: string }[]; holidays: { id: string; country: string; day: string; name: string }[]; assignments: Assignment[];
}

const CODE_TONE: Partial<Record<Code, string>> = {
  P: 'text-success', TR: 'text-info', A: 'text-danger', JBFS: 'text-accent-text', JO: 'text-accent-text', FA: 'text-accent-text', JBOF: 'text-accent-text', JBOFS: 'text-accent-text',
};
const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).slice(0, 7);
const cellKey = (p: string, d: string) => `${p}|${d}`;
const weekday = (d: string) => 'SMTWTFS'[new Date(`${d}T00:00:00Z`).getUTCDay()];
const filledBy = (p: Person) => (p.self_updated || p.sheet === 'management' ? 'Self' : SHEETS[p.sheet].filledBy);

type FilterKey = 'role' | 'reports' | 'account' | 'updated' | 'filler' | 'title';
const FILTERS: [FilterKey, string, (p: Person) => string][] = [
  ['role', 'Role', (p) => ROLE_LABEL[p.user_role] ?? p.user_role], ['reports', 'Foreman / reports to', (p) => p.reports_to_name ?? '—'],
  ['account', 'Account assignment', (p) => p.account], ['updated', 'Updated by', (p) => p.updated_by ?? '—'], ['filler', 'Filled by', filledBy], ['title', 'Title', (p) => p.title],
];
type Status = '' | 'tofill' | 'waiting' | 'approved';
const STATUS: [Status, string][] = [['', 'All'], ['tofill', 'Still to fill'], ['waiting', 'Waiting approval'], ['approved', 'Approved']];
const MINE_KEY = 'slk-att-mine';

export function Attendance() {
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : thisMonth();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const sheetQ = useQuery({ queryKey: ['attendance', month], queryFn: () => api<Sheet>(`/attendance?month=${month}`) });
  const sheet = sheetQ.data;
  const anyFill = !!sheet?.people.some((p) => p.can_fill);
  const manager = !!me?.menus.attendance?.edit;

  const [pending, setPending] = useState<Record<string, Code | null>>({});
  const [multi, setMulti] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<{ p: number; d: number } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [rowOn, setRowOn] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Partial<Record<FilterKey, string>>>({});
  // quick filters for fast entry: one sheet, a status, and "only rows I fill" (remembered on this device)
  const [sheetPick, setSheetPick] = useState<SheetKey | ''>('');
  const [status, setStatus] = useState<Status>('');
  const [mine, setMine] = useState(() => { try { return localStorage.getItem(MINE_KEY) === '1'; } catch { return false; } });
  const toggleMine = () => { const v = !mine; setMine(v); try { localStorage.setItem(MINE_KEY, v ? '1' : '0'); } catch { /* not remembered */ } };
  const [fillCode, setFillCode] = useState<Code | ''>('');
  const [fillOpts, setFillOpts] = useState({ skipOff: true, toToday: true });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [holidaysOpen, setHolidaysOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const cats = useQuery({ queryKey: ['attendance-categories'], queryFn: () => api<CategoryData>('/attendance/categories'), enabled: manager });
  const [busyGroup, setBusyGroup] = useState<string | null>(null);

  useEffect(() => { setPending({}); setPicked(new Set()); setAnchor(null); }, [month]);
  useEffect(() => {
    if (!Object.keys(pending).length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);

  const saved = useMemo(() => new Map((sheet?.entries ?? []).map((e) => [cellKey(e.employee_id, e.day), e.code])), [sheet]);
  const approved = useMemo(() => new Map((sheet?.approvals ?? []).map((a) => [a.employee_id, a])), [sheet]);
  const holidays = useMemo(() => new Map((sheet?.holidays ?? []).map((h) => [`${h.country}|${h.day}`, h.name])), [sheet]);
  const code = (p: string, d: string): Code | undefined => { const k = cellKey(p, d); return k in pending ? pending[k] ?? undefined : saved.get(k); };

  const all = sheet?.people ?? [];
  const days = sheet?.days ?? [];
  const blanks = (p: Person) => days.filter((d) => !code(p.id, d)).length;
  const people = all.filter((p) =>
    (!q || `${p.eid} ${p.full_name} ${p.title}`.toLowerCase().includes(q.toLowerCase()))
    && FILTERS.every(([k, , get]) => !filter[k] || get(p) === filter[k])
    && (!sheetPick || p.sheet === sheetPick)
    && (!mine || p.can_fill)
    && (!status || (status === 'approved' ? approved.has(p.id) : status === 'waiting' ? !approved.has(p.id) && blanks(p) === 0 : !approved.has(p.id) && blanks(p) > 0)));
  // one card per sheet; Operators & Helpers split by foreman crew inside the card
  const groups = useMemo(() => SHEET_KEYS.map((k) => ({
    key: k,
    crews: k === 'field'
      ? [...new Map(people.filter((p) => p.sheet === k).map((p) => [p.reports_to_name ?? '', null])).keys()].sort((a, b) => (a ? (b ? a.localeCompare(b) : -1) : 1))
        .map((boss) => ({ boss, list: people.filter((p) => p.sheet === k && (p.reports_to_name ?? '') === boss) }))
      : [{ boss: null as string | null, list: people.filter((p) => p.sheet === k) }],
  })).filter((g) => g.crews.some((c) => c.list.length)), [people]);
  const flat = groups.flatMap((g) => g.crews.flatMap((c) => c.list));
  const nPending = Object.keys(pending).length;
  const byId = useMemo(() => new Map(all.map((p) => [p.id, p])), [all]);
  const editable = (p: Person) => p.can_fill && !approved.has(p.id);

  const setCodes = (keys: string[], c: Code | null) => {
    setPending((cur) => {
      const n = { ...cur };
      for (const k of keys) {
        const p = byId.get(k.split('|')[0]);
        if (!p || !editable(p)) continue;
        if ((saved.get(k) ?? null) === c) delete n[k]; else n[k] = c;
      }
      return n;
    });
  };
  const clickCell = (pi: number, di: number, shift: boolean) => {
    const p = flat[pi], d = days[di], k = cellKey(p.id, d);
    setRowOn(p.id);
    if (!editable(p)) return;
    if (!multi) { setMenu(menu === k ? null : k); return; }
    setPicked((cur) => {
      const n = new Set(cur);
      if (shift && anchor) {
        for (let a = Math.min(anchor.p, pi); a <= Math.max(anchor.p, pi); a++) for (let b = Math.min(anchor.d, di); b <= Math.max(anchor.d, di); b++) n.add(cellKey(flat[a].id, days[b]));
      } else if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
    if (!shift) setAnchor({ p: pi, d: di });
  };

  /** Puts one code in every empty day of the rows on screen that you fill (pending until Save). */
  const fillEmpty = () => {
    if (!fillCode) return;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
    const keys = flat.filter((p) => editable(p)).flatMap((p) => days
      .filter((d) => !code(p.id, d) && !(fillOpts.toToday && d > today) && !(fillOpts.skipOff && (isWeekend(d) || holidays.has(`${p.country}|${d}`))))
      .map((d) => cellKey(p.id, d)));
    if (!keys.length) { setNotice({ tone: 'success', text: 'No empty days to fill in the rows shown.' }); return; }
    setCodes(keys, fillCode);
    setNotice({ tone: 'success', text: `${keys.length} empty day${keys.length === 1 ? '' : 's'} set to ${fillCode} (${CODES[fillCode]}). Check them, then Save.` });
  };

  const save = async () => {
    setSaving(true); setNotice(null);
    try {
      const changes = Object.entries(pending).map(([k, c]) => { const [employee_id, day] = k.split('|'); return { employee_id, day, code: c }; });
      const r = await api<{ saved: number }>('/attendance', { method: 'PUT', json: { month, changes } });
      setPending({}); setPicked(new Set());
      await qc.invalidateQueries({ queryKey: ['attendance', month] });
      setNotice({ tone: 'success', text: `Saved ${r.saved} cell${r.saved === 1 ? '' : 's'}.` });
    } catch (e) { setNotice({ tone: 'danger', text: (e as ApiError).message }); } finally { setSaving(false); }
  };
  const approve = async (list: Person[], yes: boolean) => {
    setNotice(null);
    try {
      for (const p of list) await api('/attendance/approve', { method: 'POST', json: { employee_id: p.id, month, approved: yes } });
      await qc.invalidateQueries({ queryKey: ['attendance', month] });
      if (list.length > 1) setNotice({ tone: 'success', text: `Approved ${list.length} people.` });
    } catch (e) { setNotice({ tone: 'danger', text: (e as ApiError).message }); qc.invalidateQueries({ queryKey: ['attendance', month] }); }
  };
  const notify = async (key: SheetKey, country: string) => {
    setBusyGroup(key); setNotice(null);
    try { const r = await api<{ to: string }>('/attendance/notify', { method: 'POST', json: { month, country, sheet: key } }); setNotice({ tone: 'success', text: `Sent ${SHEETS[key].label} for approval to ${r.to}.` }); }
    catch (e) { setNotice({ tone: 'danger', text: (e as ApiError).message }); } finally { setBusyGroup(null); }
  };

  const table = (list: Person[]) => ({
    header: ['EID', 'Name', 'Title', 'Account', 'Sheet', 'Reports to', ...days.map((d) => d.slice(8)), 'Present', 'Field', 'Leave', 'Approved by'],
    rows: list.map((p) => {
      const cs = days.map((d) => code(p.id, d));
      const s = rowSummary(cs);
      return [p.eid, p.full_name, p.title, p.account, SHEETS[p.sheet].label, p.reports_to_name ?? '', ...cs.map((c) => c ?? ''), s.present, s.field, s.leave, approved.get(p.id)?.approved_by ?? ''];
    }),
  });
  const exportXlsx = (list: Person[], name: string) => {
    const t = table(list);
    saveFile(`attendance-${month}-${name}.xlsx`, workbook(`Attendance ${month}`, t.header, t.rows, [9, 24, 20, 8, 18, 20, ...days.map(() => 5), 8, 7, 7, 14]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  const exportHtml = () => {
    const t = table(flat);
    const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const html = `<!doctype html><meta charset="utf-8"><title>Attendance ${month}</title><style>body{font:12px sans-serif}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:2px 4px;text-align:center}td:nth-child(2){text-align:left}</style>
<h1>Attendance ${month}</h1><table><tr>${t.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>
<p>${CODE_LIST.map((c) => `${c} = ${CODES[c]}`).join(' · ')}</p>`;
    saveFile(`attendance-${month}.html`, html, 'text/html;charset=utf-8');
  };
  const options = (get: (p: Person) => string) => [...new Set(all.map(get))].sort();
  const changeMonth = (v: string) => { if (nPending && !window.confirm('Leave this month without saving your changes?')) return; const n = new URLSearchParams(params); n.set('month', v || thisMonth()); setParams(n, { replace: true }); };

  return (
    <section aria-labelledby="att-title">
      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3">
        <h1 id="att-title" className="mr-2 font-display text-3xl font-extrabold tracking-wide uppercase">Attendance sheet</h1>
        <label className="block"><span className="label-caps mb-1 block text-text-muted">Month</span>
          <input type="month" className={inputSized('w-44 font-mono')} value={month} onChange={(e) => changeMonth(e.target.value)} />
        </label>
        {sheet?.full && FILTERS.map(([k, label, get]) => (
          <label key={k} className="block"><span className="label-caps mb-1 block text-text-muted">{label}</span>
            <select className={inputSized('w-36')} value={filter[k] ?? ''} onChange={(e) => setFilter({ ...filter, [k]: e.target.value || undefined })}>
              <option value="">All</option>{options(get).map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        {sheet?.full && (
          <label className="block"><span className="label-caps mb-1 block text-text-muted">Search EID / name / title</span>
            <span className="relative block">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-subtle" />
              <input className={inputSized('w-72 pl-9')} placeholder="e.g. 20096, Fahad, Field Engineer" value={q} onChange={(e) => setQ(e.target.value)} />
            </span>
          </label>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {anyFill && (
            <Button variant={multi ? 'primary' : 'secondary'} aria-pressed={multi} onClick={() => { setMulti(!multi); setPicked(new Set()); setMenu(null); }}>
              <MousePointerClick aria-hidden className="size-4" />Multi-Select {multi ? 'ON' : 'OFF'}
            </Button>
          )}
          {anyFill && <Button variant="primary" onClick={save} loading={saving} disabled={!nPending}><Save aria-hidden className="size-4" />Save{nPending ? ` (${nPending})` : ''}</Button>}
          <Button variant="primary" onClick={() => exportXlsx(flat, 'all-sheets')} disabled={!flat.length}><Download aria-hidden className="size-4" />XLSX (all sheets)</Button>
          <Button onClick={exportHtml} disabled={!flat.length}><Download aria-hidden className="size-4" />HTML</Button>
          {manager && <Button onClick={() => setHolidaysOpen(true)}><CalendarDays aria-hidden className="size-4" />Holidays</Button>}
          {manager && cats.data?.canManage && <Button onClick={() => setCategoriesOpen(true)}><Tags aria-hidden className="size-4" />Approver emails</Button>}
        </span>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-card-edge bg-surface p-3">
        <div role="radiogroup" aria-label="Sheet" onKeyDown={rovingKeys} className="flex flex-wrap gap-1.5">
          {([['', 'All sheets'], ...SHEET_KEYS.map((k) => [k, SHEETS[k].label])] as [SheetKey | '', string][]).map(([k, l]) => (
            <button key={k || 'all'} type="button" role="radio" aria-checked={sheetPick === k} tabIndex={sheetPick === k ? 0 : -1} onClick={() => setSheetPick(k)}
              className={cx('h-(--layout-control-sm) rounded-pill border px-3 text-sm font-semibold', sheetPick === k ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>{l}</button>
          ))}
        </div>
        <label className="ml-2 inline-flex items-center gap-2 text-sm"><span className="text-text-muted">Status</span>
          <select className={inputSized('w-44')} value={status} onChange={(e) => setStatus(e.target.value as Status)}>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        {anyFill && (
          <button type="button" role="switch" aria-checked={mine} onClick={toggleMine}
            className={cx('inline-flex h-(--layout-control-sm) items-center gap-2 rounded-pill border px-3 text-sm font-semibold', mine ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>
            Only rows I fill
          </button>
        )}
        {(sheetPick || status || mine || q || Object.values(filter).some(Boolean)) && (
          <Button size="sm" variant="ghost" onClick={() => { setSheetPick(''); setStatus(''); setQ(''); setFilter({}); if (mine) toggleMine(); }}><X aria-hidden className="size-3.5" />Clear filters</Button>
        )}
        <span className="ml-auto font-mono text-xs text-text-muted">{flat.length} of {all.length} people</span>
        {anyFill && (
          <div className="flex w-full flex-wrap items-center gap-2 border-t border-border pt-2">
            <span className="text-sm font-semibold">Fill empty days with</span>
            <select aria-label="Code for the empty days" className={inputSized('w-56')} value={fillCode} onChange={(e) => setFillCode(e.target.value as Code | '')}>
              <option value="">Pick a code…</option>{CODE_LIST.map((c) => <option key={c} value={c}>{c} · {CODES[c]}</option>)}
            </select>
            <label className="inline-flex items-center gap-1.5 text-sm text-text-muted"><input type="checkbox" checked={fillOpts.skipOff} onChange={(e) => setFillOpts({ ...fillOpts, skipOff: e.target.checked })} />skip weekends and holidays</label>
            <label className="inline-flex items-center gap-1.5 text-sm text-text-muted"><input type="checkbox" checked={fillOpts.toToday} onChange={(e) => setFillOpts({ ...fillOpts, toToday: e.target.checked })} />only up to today</label>
            <Button size="sm" disabled={!fillCode} onClick={fillEmpty}>Fill the rows shown</Button>
            <span className="text-xs text-text-subtle">Only rows you fill and haven't been approved. Nothing is stored until Save.</span>
          </div>
        )}
      </div>

      {multi && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-muted">{picked.size} cell{picked.size === 1 ? '' : 's'} picked · Shift-click for a range</span>
          <select aria-label="Apply code to the selected cells" className={inputSized('w-56')} value="" disabled={!picked.size}
            onChange={(e) => { if (!e.target.value) return; setCodes([...picked], e.target.value === 'clear' ? null : (e.target.value as Code)); setPicked(new Set()); }}>
            <option value="">Apply code…</option>{CODE_LIST.map((c) => <option key={c} value={c}>{c} · {CODES[c]}</option>)}<option value="clear">Clear cells</option>
          </select>
        </div>
      )}

      {notice && <div className="mb-3"><Banner tone={notice.tone} action={<Button size="sm" variant="ghost" aria-label="Dismiss" onClick={() => setNotice(null)}><X aria-hidden className="size-4" /></Button>}>{notice.text}</Banner></div>}

      <Card className="mb-4 text-sm">
        <p className="leading-relaxed text-text-muted"><b className="text-accent-text">Codes:</b> {CODE_LIST.map((c, i) => <span key={c}>{i > 0 && ' · '}<b className={cx('font-mono', CODE_TONE[c] ?? 'text-text')}>{c}</b> = {CODES[c]}</span>)}</p>
        <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-text-muted">
          <span><span className="mr-1.5 inline-block size-3 rounded-xs bg-surface-3 align-middle" />Weekend (Fri/Sat)</span>
          <span><span className="hatch-blocked mr-1.5 inline-block size-3 rounded-xs align-middle" />National holiday</span>
          <span><span className="mr-1.5 inline-block size-3 rounded-xs border-2 border-danger align-middle" />On leave while assigned to a job — hover the cell for details, SDM should review</span>
          <span><span className="mr-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" />Crewed on a job that day</span>
        </p>
        <p className="mt-2 text-text-muted"><span className="mr-1.5 inline-block size-2 rounded-full bg-success align-middle" />Click a person's EID or name to highlight their whole row. Click again to clear.</p>
        <p className="mt-2 text-text-muted">
          {SHEET_KEYS.map((k, i) => <span key={k}>{i > 0 && ' · '}<b className="text-text">{SHEETS[k].label}</b>: filled by {SHEETS[k].filledBy}, approved by {SHEETS[k].approvedBy}</span>)}
        </p>
      </Card>

      {sheetQ.isPending && <Skeleton className="h-96" />}
      {sheetQ.isError && <Banner tone="danger">{sheetQ.error.message}</Banner>}
      {sheet && !all.length && <EmptyState title={manager ? 'Nobody on attendance yet' : 'You’re not on attendance'}>{manager ? 'People come from Users & Roles, on the sheet their role is assigned to (Users & Roles → Attendance categories).' : 'Your role isn’t on an attendance sheet. Ask an administrator.'}</EmptyState>}
      {sheet && all.length > 0 && !flat.length && <EmptyState title="Nobody matches" action={<Button onClick={() => { setQ(''); setFilter({}); }}>Clear filters</Button>}>Try another name, EID or filter.</EmptyState>}

      <div className="flex flex-col gap-4">
        {groups.map((g) => {
          const meta = SHEETS[g.key];
          const list = g.crews.flatMap((c) => c.list);
          const toApprove = list.filter((p) => p.can_approve && !approved.has(p.id));
          const fills = list.some((p) => p.can_fill);
          const unsaved = list.some((p) => days.some((d) => cellKey(p.id, d) in pending));
          return (
            <Card key={g.key} className="p-0!">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4 pb-3">
                <h2 className="font-display text-xl font-extrabold text-accent-text">{meta.label} <span className="font-sans font-semibold text-text-muted">— {meta.filledBy} → {meta.approvedBy}</span></h2>
                <span className="text-sm text-text-muted">{list.length} employee{list.length === 1 ? '' : 's'}</span>
                <span className="ml-auto flex flex-wrap gap-2">
                  {fills && <Button size="sm" loading={busyGroup === g.key} onClick={() => notify(g.key, list[0].country)}><Mail aria-hidden className="size-3.5" />Notify {meta.approvedBy}</Button>}
                  {toApprove.length > 0 && <Button size="sm" variant="primary" disabled={unsaved} title={unsaved ? 'Save first' : undefined} onClick={() => approve(toApprove, true)}><Check aria-hidden className="size-3.5" />Approve all ({toApprove.length})</Button>}
                  <Button size="sm" onClick={() => exportXlsx(list, g.key)}><FileSpreadsheet aria-hidden className="size-3.5" />XLSX — this group</Button>
                </span>
              </div>
              <div className="max-h-[70vh] overflow-auto border-t border-border">
                <table className="border-separate border-spacing-0 text-xs">
                  <caption className="sr-only">{meta.label} attendance for {month}, filled by {meta.filledBy} and approved by {meta.approvedBy}.</caption>
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-surface-2 text-accent-text">
                      <th scope="col" className="label-caps sticky left-0 z-30 w-20 min-w-20 bg-surface-2 px-2 py-2 text-left">EID</th>
                      <th scope="col" className="label-caps sticky left-20 z-30 min-w-44 bg-surface-2 px-2 py-2 text-left">Name</th>
                      <th scope="col" className="label-caps min-w-44 px-2 py-2 text-left">Title</th>
                      <th scope="col" className="label-caps px-2 py-2 text-left">Acct</th>
                      {days.map((d) => {
                        const hol = (list[0] && holidays.get(`${list[0].country}|${d}`)) || null;
                        return <th key={d} scope="col" title={hol ?? undefined} className={cx('w-9 min-w-9 px-0 py-1 text-center font-mono', isWeekend(d) && 'bg-surface-3', hol && 'text-warning')}>
                          <span className="block text-label font-normal text-text-subtle">{weekday(d)}</span>{Number(d.slice(8))}
                        </th>;
                      })}
                      <th scope="col" className="label-caps px-2 py-2 text-left">Summary</th>
                      <th scope="col" className="label-caps px-2 py-2 text-left">Approval</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.crews.map((crew) => (
                      <Fragment key={crew.boss ?? 'all'}>
                        {g.key === 'field' && g.crews.length > 1 && (
                          <tr><th colSpan={days.length + 6} scope="colgroup" className="sticky left-0 bg-bg px-2 py-1.5 text-left text-xs font-semibold text-text-muted">
                            {crew.boss ? `Crew of ${crew.boss}` : 'No foreman set in Users & Roles'} · {crew.list.length}
                          </th></tr>
                        )}
                        {crew.list.map((p) => {
                          const pi = flat.indexOf(p);
                          const appr = approved.get(p.id);
                          const s = rowSummary(days.map((d) => code(p.id, d)));
                          const on = rowOn === p.id;
                          const self = p.wg_username && me && p.wg_username.toLowerCase() === me.username.toLowerCase();
                          return (
                            <tr key={p.id} className={cx(on && 'bg-accent/10')}>
                              <th scope="row" className={cx('sticky left-0 z-10 border-b border-border px-2 py-1.5 text-left font-mono font-normal', on ? 'bg-surface-3' : 'bg-surface')}>
                                <button type="button" className="hover:underline" aria-pressed={on} onClick={() => setRowOn(on ? null : p.id)}>{p.eid}</button>
                              </th>
                              <td className={cx('sticky left-20 z-10 border-b border-border px-2 py-1.5 font-semibold whitespace-nowrap', on ? 'bg-surface-3' : 'bg-surface')}>
                                <button type="button" className="text-left hover:underline" aria-pressed={on} onClick={() => setRowOn(on ? null : p.id)}>{p.full_name}</button>
                                {self && <span className="ml-1.5 text-label font-normal text-text-subtle">(you)</span>}
                              </td>
                              <td className="border-b border-border px-2 py-1.5 whitespace-nowrap text-text-muted">
                                {p.title}{(p.self_updated || p.sheet === 'management') ? <span className="label-caps ml-1.5 rounded-pill border border-pill-completed-border bg-pill-completed-bg px-1.5 text-pill-completed-fg">Self</span> : null}
                              </td>
                              <td className="border-b border-border px-2 py-1.5 font-semibold text-accent-text">{p.account}</td>
                              {days.map((d, di) => {
                                const k = cellKey(p.id, d);
                                const c = code(p.id, d);
                                const hol = holidays.get(`${p.country}|${d}`);
                                const jobs = assignmentsOn(sheet!.assignments, p.id, d);
                                const clash = !!c && LEAVE.includes(c) && jobs.length > 0;
                                const tip = [c && `${c}: ${CODES[c]}`, hol, jobs.length && `Crewed on ${jobs.map((j) => j.ticket_no ?? 'a job without ticket').join(', ')}`, clash && 'On leave while assigned to a job'].filter(Boolean).join(' · ');
                                return (
                                  <td key={d} className={cx('relative border-b border-border p-0.5 text-center', isWeekend(d) && 'bg-surface-3/60', hol && 'hatch-blocked')}>
                                    <button type="button" aria-label={`${p.full_name}, ${d}: ${c ? CODES[c] : 'no code'}${clash ? ', on leave while assigned to a job' : ''}`} title={tip || undefined}
                                      aria-pressed={multi ? picked.has(k) : undefined} disabled={!editable(p)}
                                      onClick={(e) => clickCell(pi, di, e.shiftKey)}
                                      className={cx('h-8 w-8 rounded-xs bg-surface-2/70 font-mono text-[11px] font-semibold disabled:cursor-default in-data-[density=touch]:h-11 in-data-[density=touch]:w-11', CODE_TONE[c as Code], k in pending && 'italic underline', picked.has(k) && 'bg-accent/30', clash && 'outline-2 -outline-offset-2 outline-danger')}>
                                      {c ?? ''}
                                      {jobs.length > 0 && <span aria-hidden className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent" />}
                                    </button>
                                    {menu === k && (
                                      <div role="menu" aria-label={`Code for ${p.full_name} on ${d}`} className="absolute top-9 left-0 z-40 grid w-80 grid-cols-2 gap-1 rounded-md border border-border bg-surface p-1.5 text-left shadow-pop"
                                        onKeyDown={(e) => { if (e.key === 'Escape') setMenu(null); else rovingKeys(e); }}>
                                        {CODE_LIST.map((cc) => (
                                          <button key={cc} type="button" role="menuitemradio" aria-checked={cc === c} autoFocus={cc === (c ?? 'P')} onClick={() => { setCodes([k], cc); setMenu(null); }}
                                            className={cx('flex min-h-9 items-baseline gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-surface-2 in-data-[density=touch]:min-h-11', cc === c && 'bg-surface-2 font-bold')}>
                                            <span className={cx('font-mono font-bold', CODE_TONE[cc])}>{cc}</span><span className="truncate text-text-muted">{CODES[cc]}</span>
                                          </button>
                                        ))}
                                        <button type="button" role="menuitem" onClick={() => { setCodes([k], null); setMenu(null); }} className="col-span-2 min-h-9 rounded px-1.5 py-1 text-xs text-text-muted hover:bg-surface-2 in-data-[density=touch]:min-h-11">Clear</button>
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="border-b border-border px-2 font-mono text-[11px] whitespace-nowrap text-text-muted" title={p.updated_by ? `Last saved by ${p.updated_by}` : undefined}>{s.present} on · {s.field} field · {s.leave} leave</td>
                              <td className="border-b border-border px-2 whitespace-nowrap">
                                {appr ? (
                                  <span className="inline-flex items-center gap-1 text-success" title={`Approved by ${appr.approved_by}`}><Check aria-hidden className="size-3.5" />{appr.approved_by}
                                    <SignedToggle type="attendance" id={`${p.id}|${month}`} />
                                    {p.can_approve && <Button size="sm" variant="ghost" onClick={() => approve([p], false)}>Unapprove</Button>}</span>
                                ) : p.can_approve ? <Button size="sm" onClick={() => approve([p], true)} disabled={days.some((d) => cellKey(p.id, d) in pending)}>Approve</Button>
                                  : <span className="text-text-subtle">waiting for {meta.approvedBy}</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>
      {categoriesOpen && <Categories countries={me?.countries ?? []} data={cats.data} onClose={() => { setCategoriesOpen(false); qc.invalidateQueries({ queryKey: ['attendance-categories'] }); }} />}
      {holidaysOpen && sheet && <Holidays sheet={sheet} onClose={() => { setHolidaysOpen(false); qc.invalidateQueries({ queryKey: ['attendance', month] }); }} />}
    </section>
  );
}

function Holidays({ sheet, onClose }: { sheet: Sheet; onClose: () => void }) {
  const { data: me } = useMe();
  const [f, setF] = useState({ country: me?.countries[0] ?? '', day: sheet.days[0], name: '' });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const add = async () => {
    try { await api('/attendance/holidays', { method: 'POST', json: f }); setF({ ...f, name: '' }); setError(null); qc.invalidateQueries({ queryKey: ['attendance', sheet.month] }); }
    catch (e) { setError((e as Error).message); }
  };
  const remove = async (id: string) => { await api(`/attendance/holidays/${id}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['attendance', sheet.month] }); };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="hol-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <Card className="w-full max-w-lg">
        <div className="mb-3 flex items-start gap-3"><h2 id="hol-title" className="flex-1 font-display text-lg font-bold">Public holidays</h2><Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}><X aria-hidden className="size-4" /></Button></div>
        <p className="mb-3 text-sm text-text-muted">Holidays are shaded on the sheet. Islamic holidays move every year, so enter them when the dates are announced.</p>
        {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
        <ul className="mb-3 divide-y divide-border text-sm">
          {sheet.holidays.map((h) => <li key={h.id} className="flex items-center gap-2 py-1.5"><span className="font-mono text-xs">{h.day}</span><span className="flex-1">{h.name}</span><span className="text-xs text-text-subtle">{h.country}</span>
            <Button size="sm" variant="ghost" aria-label={`Remove ${h.name}`} onClick={() => remove(h.id)}><Trash2 aria-hidden className="size-3.5" /></Button></li>)}
          {!sheet.holidays.length && <li className="py-1.5 text-text-subtle">None this month.</li>}
        </ul>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(me?.countries.length ?? 0) > 1 && <Field id="hol-country" label="Country"><select id="hol-country" className={inputClass} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{me?.countries.map((c) => <option key={c}>{c}</option>)}</select></Field>}
          <Field id="hol-day" label="Date"><input id="hol-day" type="date" className={inputClass} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></Field>
          <Field id="hol-name" label="Name"><input id="hol-name" className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. National Day" /></Field>
        </div>
        <Button className="mt-3" variant="primary" onClick={add} disabled={!f.name.trim() || !f.day || !f.country}>Add holiday</Button>
      </Card>
    </div>
  );
}

interface CategoryData { categories: { id: string; country: string; name: string; approver_email: string | null }[]; canManage: boolean }

/**
 * Approver emails (Ops Manager). Notify approver emails everyone holding the sheet's approving role in that country
 * (their email comes from WIREGUARD). An address entered here is added, for an approver without an account.
 */
function Categories({ countries, data, onClose }: { countries: string[]; data: CategoryData | undefined; onClose: () => void }) {
  const known = countries.flatMap((country) => SHEET_KEYS.map((k) => ({ country, name: SHEETS[k].label, approvedBy: SHEETS[k].approvedBy })));
  const [emails, setEmails] = useState<Record<string, string>>(() => Object.fromEntries(known.map((g) => [`${g.country}|${g.name}`, data?.categories.find((c) => c.country === g.country && c.name === g.name)?.approver_email ?? ''])));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const save = async (g: { name: string; country: string }) => {
    setError(null); setSaved(null);
    try { await api('/attendance/categories', { method: 'PUT', json: { country: g.country, name: g.name, approver_email: emails[`${g.country}|${g.name}`] || null } }); setSaved(`${g.country}|${g.name}`); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="cat-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <Card className="max-h-[85vh] w-full max-w-2xl overflow-y-auto">
        <div className="mb-3 flex items-start gap-3"><h2 id="cat-title" className="flex-1 font-display text-lg font-bold">Approver emails</h2><Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}><X aria-hidden className="size-4" /></Button></div>
        <p className="mb-3 text-sm text-text-muted">Notify emails everyone with the approving role in that country, using their email from WIREGUARD. Add an address here only for an approver without an SLK Ops account.</p>
        {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
        <ul className="divide-y divide-border">
          {known.map((g) => {
            const k = `${g.country}|${g.name}`;
            return (
              <li key={k} className="grid grid-cols-1 items-end gap-2 py-2 sm:grid-cols-[1fr_16rem_auto]">
                <span className="text-sm"><span className="font-semibold">{g.name}</span> <span className="text-xs text-text-subtle">{g.country} · approved by {g.approvedBy}</span></span>
                <input aria-label={`Extra approver email for ${g.name}, ${g.country}`} type="email" className={inputClass} placeholder="approver@nesr.com" value={emails[k] ?? ''} onChange={(e) => setEmails({ ...emails, [k]: e.target.value })} />
                <Button size="sm" onClick={() => save(g)}>{saved === k ? <><Check aria-hidden className="size-3.5" />Saved</> : 'Save'}</Button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
