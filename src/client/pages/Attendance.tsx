import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check, FileSpreadsheet, FileText, Mail, MousePointerClick, Search, Tags, Trash2, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CODES, CODE_LIST, LEAVE, assignmentsOn, groupLabel, isWeekend, rowSummary, type Assignment, type Code } from '../../shared/attendance';
import { workbook } from '../../shared/xlsx';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { saveFile } from '../components/charts';
import { SignedToggle } from '../components/Signature';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass, inputSized, rovingKeys } from '../components/ui';

// Attendance (S17): one row per person, one column per day. Click a cell to pick a code, or switch on
// Multi-select, pick cells (Shift-click for a range) and apply one code to all. Nothing is stored until Save.

interface Person { id: string; country: string; eid: string; full_name: string; title: string; account: string; crew_role: string | null; group_name: string | null }
interface Sheet {
  month: string; days: string[]; full: boolean; people: Person[]; entries: { employee_id: string; day: string; code: Code }[];
  approvals: { employee_id: string; approved_by: string; approved_at: string }[]; holidays: { id: string; country: string; day: string; name: string }[]; assignments: Assignment[];
}

const CODE_TONE: Partial<Record<Code, string>> = {
  P: 'text-success', TR: 'text-info', A: 'text-danger', JBFS: 'text-accent', JO: 'text-accent', FA: 'text-accent', JBOF: 'text-accent', JBOFS: 'text-accent',
};
const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).slice(0, 7);
const cellKey = (p: string, d: string) => `${p}|${d}`;
const weekday = (d: string) => 'SMTWTFS'[new Date(`${d}T00:00:00Z`).getUTCDay()];

export function Attendance() {
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : thisMonth();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const sheetQ = useQuery({ queryKey: ['attendance', month], queryFn: () => api<Sheet>(`/attendance?month=${month}`) });
  const sheet = sheetQ.data;
  const canEdit = !!sheet?.full && !!me?.menus.attendance?.edit;

  const [pending, setPending] = useState<Record<string, Code | null>>({});
  const [multi, setMulti] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<{ p: number; d: number } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [rowOn, setRowOn] = useState<string | null>(null);
  const [filter, setFilter] = useState({ q: '', account: '', title: '' });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [holidaysOpen, setHolidaysOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const cats = useQuery({ queryKey: ['attendance-categories'], queryFn: () => api<CategoryData>('/attendance/categories'), enabled: canEdit });
  const approverOf = (country: string, name: string) => cats.data?.categories.find((x) => x.country === country && x.name === name)?.approver_email ?? null;
  const [notifying, setNotifying] = useState<string | null>(null);
  const notify = async (country: string, name: string) => {
    setNotifying(name); setNotice(null);
    try { const r = await api<{ to: string }>('/attendance/notify', { method: 'POST', json: { month, country, name } }); setNotice({ tone: 'success', text: `Sent ${name} for approval to ${r.to}.` }); }
    catch (e) { setNotice({ tone: 'danger', text: (e as ApiError).message }); } finally { setNotifying(null); }
  };

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

  const people = (sheet?.people ?? []).filter((p) =>
    (!filter.q || `${p.full_name} ${p.eid}`.toLowerCase().includes(filter.q.toLowerCase())) && (!filter.account || p.account === filter.account) && (!filter.title || p.title === filter.title));
  const groups = useMemo(() => {
    const m = new Map<string, Person[]>();
    for (const p of people) { const g = groupLabel(p.group_name); m.set(g, [...(m.get(g) ?? []), p]); }
    return [...m.entries()];
  }, [people]);
  const flat = groups.flatMap(([, list]) => list);
  const days = sheet?.days ?? [];
  const nPending = Object.keys(pending).length;

  const setCodes = (keys: string[], c: Code | null) => {
    setPending((cur) => {
      const n = { ...cur };
      for (const k of keys) {
        const [p] = k.split('|');
        if (approved.has(p)) continue;
        if ((saved.get(k) ?? null) === c) delete n[k]; else n[k] = c;
      }
      return n;
    });
  };
  const clickCell = (pi: number, di: number, shift: boolean) => {
    const p = flat[pi].id, d = days[di], k = cellKey(p, d);
    setRowOn(p);
    if (!canEdit || approved.has(p)) return;
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
  const approve = async (p: Person, yes: boolean) => {
    try { await api('/attendance/approve', { method: 'POST', json: { employee_id: p.id, month, approved: yes } }); qc.invalidateQueries({ queryKey: ['attendance', month] }); }
    catch (e) { setNotice({ tone: 'danger', text: (e as ApiError).message }); }
  };

  const table = (list: Person[]) => ({
    header: ['Name', 'EID', 'Title', 'Account', 'Reporting line', ...days.map((d) => d.slice(8)), 'Present', 'Field', 'Leave', 'Approved'],
    rows: list.map((p) => {
      const cs = days.map((d) => code(p.id, d));
      const s = rowSummary(cs);
      return [p.full_name, p.eid, p.title, p.account, p.group_name ?? '', ...cs.map((c) => c ?? ''), s.present, s.field, s.leave, approved.has(p.id) ? approved.get(p.id)!.approved_by : ''];
    }),
  });
  const exportXlsx = (list: Person[], name: string) => {
    const t = table(list);
    saveFile(`attendance-${month}-${name}.xlsx`, workbook(`Attendance ${month}`, t.header, t.rows, [24, 9, 18, 8, 20, ...days.map(() => 5), 8, 7, 7, 12]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  const exportHtml = () => {
    const t = table(flat);
    const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const html = `<!doctype html><meta charset="utf-8"><title>Attendance ${month}</title><style>body{font:12px sans-serif}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:2px 4px;text-align:center}td:first-child{text-align:left}</style>
<h1>Attendance ${month}</h1><table><tr>${t.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>
<p>${CODE_LIST.map((c) => `${c} = ${CODES[c]}`).join(' · ')}</p>`;
    saveFile(`attendance-${month}.html`, html, 'text/html;charset=utf-8');
  };

  const accounts = [...new Set((sheet?.people ?? []).map((p) => p.account))].sort();
  const titles = [...new Set((sheet?.people ?? []).map((p) => p.title))].sort();

  return (
    <section aria-labelledby="att-title">
      <PageTitle aside={
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-text-muted"><span className="sr-only">Month</span>
            <input type="month" className={inputSized('h-(--layout-control-sm) w-40')} value={month}
              onChange={(e) => { if (nPending && !window.confirm('Leave this month without saving your changes?')) return; const n = new URLSearchParams(params); n.set('month', e.target.value || thisMonth()); setParams(n, { replace: true }); }} />
          </label>
          {canEdit && <Button size="sm" variant="primary" onClick={save} loading={saving} disabled={!nPending}>Save{nPending ? ` (${nPending})` : ''}</Button>}
          <Button size="sm" onClick={() => exportXlsx(flat, 'all')} disabled={!flat.length}><FileSpreadsheet aria-hidden className="size-4" />XLSX</Button>
          <Button size="sm" onClick={exportHtml} disabled={!flat.length}><FileText aria-hidden className="size-4" />HTML</Button>
          {canEdit && <Button size="sm" onClick={() => setHolidaysOpen(true)}><CalendarDays aria-hidden className="size-4" />Holidays</Button>}
          {canEdit && cats.data?.canManage && <Button size="sm" onClick={() => setCategoriesOpen(true)}><Tags aria-hidden className="size-4" />Manage categories</Button>}
        </div>
      }><span id="att-title">Attendance</span></PageTitle>

      {sheet && !sheet.full && <div className="mb-3"><Banner tone="info">This is your own attendance. Managers and the attendance administrator see and edit the whole sheet.</Banner></div>}
      {notice && <div className="mb-3"><Banner tone={notice.tone}>{notice.text}</Banner></div>}

      {sheet?.full && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="relative"><span className="sr-only">Search name or EID</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle" />
            <input className={inputSized('h-(--layout-control-sm) w-52 pl-8')} placeholder="Name or EID" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          </label>
          <select aria-label="Account" className={inputSized('h-(--layout-control-sm) w-36')} value={filter.account} onChange={(e) => setFilter({ ...filter, account: e.target.value })}><option value="">All accounts</option>{accounts.map((a) => <option key={a}>{a}</option>)}</select>
          <select aria-label="Job title" className={inputSized('h-(--layout-control-sm) w-48')} value={filter.title} onChange={(e) => setFilter({ ...filter, title: e.target.value })}><option value="">All titles</option>{titles.map((a) => <option key={a}>{a}</option>)}</select>
          {canEdit && (
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <Button size="sm" variant={multi ? 'primary' : 'secondary'} aria-pressed={multi} onClick={() => { setMulti(!multi); setPicked(new Set()); setMenu(null); }}>
                <MousePointerClick aria-hidden className="size-4" />Multi-select{multi ? ' on' : ''}
              </Button>
              {multi && (
                <>
                  <span className="text-xs text-text-muted">{picked.size} cell{picked.size === 1 ? '' : 's'} · Shift-click for a range</span>
                  <select aria-label="Apply code to the selected cells" className={inputSized('h-(--layout-control-sm) w-48')} value="" disabled={!picked.size}
                    onChange={(e) => { if (!e.target.value) return; setCodes([...picked], e.target.value === 'clear' ? null : (e.target.value as Code)); setPicked(new Set()); }}>
                    <option value="">Apply code…</option>{CODE_LIST.map((c) => <option key={c} value={c}>{c} · {CODES[c]}</option>)}<option value="clear">Clear cells</option>
                  </select>
                </>
              )}
            </span>
          )}
        </div>
      )}

      <details className="mb-3 text-xs text-text-muted">
        <summary className="cursor-pointer select-none font-semibold">Codes and shading</summary>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{CODE_LIST.map((c) => <span key={c}><b className={cx('font-mono', CODE_TONE[c])}>{c}</b> {CODES[c]}</span>)}</p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <span><span className="mr-1 inline-block size-3 rounded-xs bg-surface-2 align-middle" />Weekend (Fri, Sat)</span>
          <span><span className="mr-1 inline-block size-3 rounded-xs hatch-blocked align-middle" />Public holiday</span>
          <span><span className="mr-1 inline-block size-3 rounded-xs border-2 border-danger align-middle" />On leave while crewed on a job</span>
          <span><span className="mr-1 inline-block size-1.5 rounded-full bg-accent align-middle" />Crewed on a job that day</span>
        </p>
      </details>

      {sheetQ.isPending && <Skeleton className="h-96" />}
      {sheetQ.isError && <Banner tone="danger">{sheetQ.error.message}</Banner>}
      {sheet && !sheet.people.length && <EmptyState title={sheet.full ? 'Nobody on the roster yet' : 'Your attendance isn’t linked yet'}>{sheet.full ? 'Add people in the Headcount Roster.' : 'Ask the attendance administrator to put your WIREGUARD username on your roster entry.'}</EmptyState>}
      {sheet && flat.length > 0 && (
        <div className="max-h-[calc(100vh-17rem)] overflow-auto rounded-lg border border-border bg-surface">
          <table className="border-separate border-spacing-0 text-xs">
            <caption className="sr-only">Attendance for {month}. One row per person, one column per day.</caption>
            <thead className="sticky top-0 z-20 bg-surface-2">
              <tr>
                <th scope="col" className="sticky left-0 z-30 min-w-52 border-b border-border bg-surface-2 px-2 py-1.5 text-left">Person</th>
                {days.map((d) => {
                  const hol = (sheet.people[0] && holidays.get(`${sheet.people[0].country}|${d}`)) || null;
                  return <th key={d} scope="col" title={hol ?? undefined} className={cx('w-8 min-w-8 border-b border-border px-0 py-1 text-center font-mono font-normal', isWeekend(d) && 'text-text-subtle', hol && 'text-warning')}>
                    <span className="block text-label">{weekday(d)}</span>{Number(d.slice(8))}
                  </th>;
                })}
                <th scope="col" className="border-b border-border px-2 text-left">Summary</th>
                <th scope="col" className="border-b border-border px-2 text-left">Approval</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([g, list]) => (
                <Fragment key={g}>
                  <tr>
                    <th colSpan={days.length + 3} scope="colgroup" className="sticky left-0 border-b border-border bg-bg px-2 py-1.5 text-left">
                      <span className="font-semibold">{g}</span> <span className="font-normal text-text-muted">· {list.length} people</span>
                      <Button size="sm" variant="ghost" className="ml-2" onClick={() => exportXlsx(list, g.replace(/\W+/g, '-').toLowerCase())}><FileSpreadsheet aria-hidden className="size-3.5" />XLSX this group</Button>
                      {canEdit && (() => {
                        const to = approverOf(list[0].country, g);
                        return to
                          ? <Button size="sm" variant="ghost" loading={notifying === g} onClick={() => notify(list[0].country, g)} title={`Email ${to} that this month is ready`}><Mail aria-hidden className="size-3.5" />Notify approver</Button>
                          : <span className="ml-2 text-xs font-normal text-text-subtle">no approver set</span>;
                      })()}
                    </th>
                  </tr>
                  {list.map((p) => {
                    const pi = flat.indexOf(p);
                    const appr = approved.get(p.id);
                    const s = rowSummary(days.map((d) => code(p.id, d)));
                    return (
                      <tr key={p.id} className={cx(rowOn === p.id && 'bg-surface-2')}>
                        <th scope="row" className={cx('sticky left-0 z-10 border-b border-border px-2 py-1 text-left font-normal', rowOn === p.id ? 'bg-surface-2' : 'bg-surface')}>
                          <span className="block font-semibold">{p.full_name}</span><span className="font-mono text-label text-text-subtle">{p.eid} · {p.title}</span>
                        </th>
                        {days.map((d, di) => {
                          const k = cellKey(p.id, d);
                          const c = code(p.id, d);
                          const hol = holidays.get(`${p.country}|${d}`);
                          const jobs = assignmentsOn(sheet.assignments, p.id, d);
                          const clash = !!c && LEAVE.includes(c) && jobs.length > 0;
                          const tip = [c && `${c}: ${CODES[c]}`, hol, jobs.length && `Crewed on ${jobs.map((j) => j.ticket_no ?? 'a job without ticket').join(', ')}`, clash && 'On leave while assigned to a job'].filter(Boolean).join(' · ');
                          return (
                            <td key={d} className={cx('relative border-b border-border p-0 text-center', isWeekend(d) && 'bg-surface-2', hol && 'hatch-blocked')}>
                              <button type="button" aria-label={`${p.full_name}, ${d}: ${c ? CODES[c] : 'no code'}${clash ? ', on leave while assigned to a job' : ''}`} title={tip || undefined}
                                aria-pressed={multi ? picked.has(k) : undefined} disabled={!canEdit || !!appr}
                                onClick={(e) => clickCell(pi, di, e.shiftKey)}
                                className={cx('h-8 w-8 font-mono text-[11px] font-semibold disabled:cursor-default', CODE_TONE[c as Code], k in pending && 'italic underline', picked.has(k) && 'bg-accent/30', clash && 'outline-2 -outline-offset-2 outline-danger')}>
                                {c ?? ''}
                                {jobs.length > 0 && <span aria-hidden className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent" />}
                              </button>
                              {menu === k && (
                                <div role="menu" aria-label={`Code for ${p.full_name} on ${d}`} className="absolute top-8 left-0 z-40 grid w-80 grid-cols-2 gap-1 rounded-md border border-border bg-surface p-1.5 text-left shadow-pop"
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
                        <td className="border-b border-border px-2 font-mono text-[11px] whitespace-nowrap text-text-muted">{s.present} on · {s.field} field · {s.leave} leave</td>
                        <td className="border-b border-border px-2 whitespace-nowrap">
                          {appr ? (
                            <span className="inline-flex items-center gap-1 text-success" title={`Approved by ${appr.approved_by}`}><Check aria-hidden className="size-3.5" />{appr.approved_by}
                              <SignedToggle type="attendance" id={`${p.id}|${month}`} />
                              {canEdit && <Button size="sm" variant="ghost" onClick={() => approve(p, false)}>Unapprove</Button>}</span>
                          ) : canEdit ? <Button size="sm" onClick={() => approve(p, true)} disabled={days.some((d) => cellKey(p.id, d) in pending)}>Approve</Button> : <span className="text-text-subtle">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {categoriesOpen && <Categories groups={groups.map(([g, list]) => ({ name: g, country: list[0].country }))} data={cats.data} onClose={() => { setCategoriesOpen(false); qc.invalidateQueries({ queryKey: ['attendance-categories'] }); }} />}
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

/** Manage categories (Ops Manager): which approver is emailed for each reporting-line group. */
function Categories({ groups, data, onClose }: { groups: { name: string; country: string }[]; data: CategoryData | undefined; onClose: () => void }) {
  const known = [...groups, ...(data?.categories ?? []).filter((c) => !groups.some((g) => g.name === c.name && g.country === c.country))];
  const [emails, setEmails] = useState<Record<string, string>>(() => Object.fromEntries(known.map((g) => [`${g.country}|${g.name}`, data?.categories.find((c) => c.country === g.country && c.name === g.name)?.approver_email ?? ''])));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const save = async (g: { name: string; country: string }) => {
    setError(null); setSaved(null);
    try { await api('/attendance/categories', { method: 'PUT', json: { country: g.country, name: g.name, approver_email: emails[`${g.country}|${g.name}`] || null } }); setSaved(g.name); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="cat-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <Card className="max-h-[85vh] w-full max-w-2xl overflow-y-auto">
        <div className="mb-3 flex items-start gap-3"><h2 id="cat-title" className="flex-1 font-display text-lg font-bold">Attendance categories</h2><Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}><X aria-hidden className="size-4" /></Button></div>
        <p className="mb-3 text-sm text-text-muted">Each reporting-line group is a category. Its approver gets the email when someone presses Notify approver on the sheet.</p>
        {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
        <ul className="divide-y divide-border">
          {known.map((g) => {
            const k = `${g.country}|${g.name}`;
            return (
              <li key={k} className="grid grid-cols-1 items-end gap-2 py-2 sm:grid-cols-[1fr_16rem_auto]">
                <span className="text-sm"><span className="font-semibold">{g.name}</span> <span className="text-xs text-text-subtle">{g.country}</span></span>
                <input aria-label={`Approver email for ${g.name}`} type="email" className={inputClass} placeholder="approver@nesr.com" value={emails[k] ?? ''} onChange={(e) => setEmails({ ...emails, [k]: e.target.value })} />
                <Button size="sm" onClick={() => save(g)}>{saved === g.name ? <><Check aria-hidden className="size-3.5" />Saved</> : 'Save'}</Button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
