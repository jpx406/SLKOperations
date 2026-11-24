import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileDown, FileText, History, Mail, Plus, Printer, Save, Sheet, SortAsc, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { ROW_KIND_LABEL, applyJob, dayOf, eventCount, hasSig, hours, isEmptyRow, jobValues, mandatoryProblems, newRow, rowKind, setRowTo, sortRows, timeHM, toOf, type LogForm, type LogRow } from '../../shared/jobLogForm';
import { api } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, Field, Skeleton, cx, inputClass } from '../components/ui';
import { Dialog } from '../pages/knowledge/common';
import { HeaderCard, JobDetailsCard, PhrasePicker, type HeaderCtx } from './Sections';
import { SignaturePad } from './SignaturePad';
import { docBlob, downloadBlob, emailBody, emailSubject, emlBlob, fileBase, pdfBlob, xlsxBlob } from './exports';
import { isUnsynced, loadLog, pushLog, stageLocal, type LocalLog, type LogData } from './store';

// The Job log · Sequence of Events editor (6z.51), from the owner's job log package, adjusted for slickline: the
// header from the job, the events with run and depth, crew hours worked out from the events (or typed), the
// slickline crew and the client representative signing. Every change is kept on the device as it is typed; Save /
// Sync sends it as a new version (merged with anyone else's), and the History keeps every version.

const cell = 'h-9 w-full rounded-sm border border-border bg-surface px-2 text-sm disabled:opacity-60';
const chip = (tone: 'ok' | 'warn' | 'bad' | 'muted') => cx('rounded-pill px-2.5 py-0.5 font-mono text-label font-bold', {
  ok: 'bg-success-subtle text-success', warn: 'bg-warning-subtle text-warning', bad: 'bg-danger-subtle text-danger', muted: 'bg-surface-3 text-text-muted',
}[tone]);
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export function JobLogEditor({ jobId, title, jraLocked }: { jobId: string; title: string; jraLocked: boolean }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const user = me?.fullName ?? 'Unknown';
  const q = useQuery({ queryKey: ['joblog', jobId], queryFn: () => api<LogData>(`/joblog/${encodeURIComponent(jobId)}`), gcTime: 0, refetchOnMount: 'always', retry: 1 });
  const [rec, setRec] = useState<LocalLog | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<{ version: number; change_summary: string; created_by: string; created_at: string; form: LogForm }[] | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const stageTimer = useRef<number | undefined>(undefined);
  const latest = useRef<LocalLog | null>(null);
  latest.current = rec;

  // open the log once the server answers (or fails: then the device copy)
  useEffect(() => {
    if (rec || q.isLoading) return;
    loadLog(q.data ?? null, jobId).then(({ rec: r, notice: n }) => { setRec(r); if (n) setNotice({ tone: 'warning', text: n }); });
  }, [q.isLoading, q.data, rec, jobId]);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    const flush = () => { if (stageTimer.current && latest.current) { window.clearTimeout(stageTimer.current); stageTimer.current = undefined; void stageLocal(latest.current, latest.current.form); } };
    const hide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('online', on); window.addEventListener('offline', off); window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', hide);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hide); flush(); };
  }, []);

  const canEdit = !!q.data?.canEdit && !jraLocked;
  const ro = !canEdit;

  // every edit: on screen at once, on the device 0.4 s later
  const setForm = (patch: Partial<LogForm> | ((f: LogForm) => LogForm)) => setRec((r) => {
    if (!r) return r;
    const form = typeof patch === 'function' ? patch(r.form) : { ...r.form, ...patch };
    const next: LocalLog = { ...r, form, status: 'offline' };
    window.clearTimeout(stageTimer.current);
    stageTimer.current = window.setTimeout(() => { stageTimer.current = undefined; void stageLocal(next, form); }, 400);
    return next;
  });
  const setRow = (id: string, patch: Partial<LogRow>) => setForm((f) => ({ ...f, rows: f.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const insertBelow = (id: string) => setForm((f) => { const i = f.rows.findIndex((r) => r.id === id); const prev = f.rows[i]; const rows = f.rows.slice(); rows.splice(i + 1, 0, newRow({ date: prev?.date || f.date, run: prev?.run ?? '', time: prev ? toOf(f.rows, i) : '' })); return { ...f, rows }; });
  const deleteRow = (id: string) => setForm((f) => { const r = f.rows.find((x) => x.id === id); if (!isEmptyRow(r) && !window.confirm('Delete this row?')) return f; const rows = f.rows.filter((x) => x.id !== id); return { ...f, rows: rows.length ? rows : [newRow({ date: f.date })] }; });
  const onEnter = (e: KeyboardEvent<HTMLTextAreaElement>, id: string, col: string) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const i = rec!.form.rows.findIndex((r) => r.id === id);
    if (i === rec!.form.rows.length - 1) insertBelow(id);
    window.setTimeout(() => document.querySelector<HTMLElement>(`[data-jl="${col}-${i + 1}"]`)?.focus(), 30);
  };

  const save = async () => {
    if (!rec || saving) return;
    setSaving(true); setNotice(null);
    window.clearTimeout(stageTimer.current);
    stageTimer.current = undefined;
    const staged = await stageLocal(rec, applyJob(rec.form, q.data?.job));
    if (!online) { setRec(staged); setSaving(false); setNotice({ tone: 'warning', text: 'No connection: your changes are kept on this device. Save / Sync again when you are back online.' }); return; }
    const r = await pushLog(staged);
    setSaving(false);
    if (r.ok) {
      setRec(r.rec);
      setNotice({ tone: 'success', text: `Synced as version ${r.rec.serverVer}${r.merged ? ', merged with changes someone else saved' : ''}.${r.signed ? ' Both signed: the job’s “Job log signed” is now Yes.' : ''}` });
      qc.invalidateQueries({ queryKey: ['job-events', jobId] });
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      qc.invalidateQueries({ queryKey: ['joblog-summary', jobId] });
    } else { setRec(staged); setNotice({ tone: 'danger', text: `Could not sync: kept on this device. ${r.error ?? ''}` }); }
  };
  // back online with changes waiting: send them
  useEffect(() => { if (online && isUnsynced(latest.current) && canEdit && latest.current?.serverVer !== undefined && notice?.tone === 'warning') void save(); }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  const showHistory = async () => {
    try { setHistory(await api(`/joblog/${encodeURIComponent(jobId)}/versions`)); } catch (e) { setNotice({ tone: 'danger', text: (e as Error).message }); }
  };
  const fileError = (e: unknown) => setNotice({ tone: 'danger', text: `Could not make the file: ${(e as Error).message ?? e}` });

  const crewOptions = useMemo(() => [...new Set([...(q.data?.crew ?? []), ...(q.data?.job.engineers ?? [])])], [q.data]);
  if (q.isLoading || !rec) return <Skeleton className="h-96" />;
  // a field the job has a value for is read from the job (6z.53)
  const locked = jobValues(q.data?.job);
  const ctx: HeaderCtx = { locked, options: q.data?.options ?? null, canEdit, jobId, crew: crewOptions };
  const f = applyJob(rec.form, q.data?.job), h = hours(f), unsynced = isUnsynced(rec), events = eventCount(f), bothSigned = hasSig(f.engSig) && hasSig(f.fmSig);
  const problems = mandatoryProblems(f);
  const filled = f.rows.filter((r) => !isEmptyRow(r));

  return (
    <section aria-labelledby="jl-title">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link to={`/operation/jobs/${jobId}/execution`} className="inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-xs font-semibold hover:bg-surface-3"><ArrowLeft aria-hidden className="size-4" />Execution</Link>
        <h1 id="jl-title" className="font-display text-xl font-extrabold uppercase">Job log · {title}</h1>
        <span className={chip('muted')}>Server v{rec.serverVer}</span>
        <span className={chip(unsynced ? 'warn' : 'ok')}>{unsynced ? 'Saved on this device · not synced' : 'Synced'}</span>
        <span className={chip(online ? 'ok' : 'bad')}>{online ? 'Online' : 'Offline'}</span>
        <span className="flex-1" />
        {!ro && <Button variant={unsynced ? 'primary' : 'secondary'} loading={saving} onClick={save}><Save aria-hidden className="size-4" />{online ? (unsynced ? 'Save / Sync' : 'Synced') : 'Saved on device'}</Button>}
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => pdfBlob(f).then((b) => window.open(URL.createObjectURL(b), '_blank')).catch(fileError)}><Printer aria-hidden className="size-3.5" />Print / PDF</Button>
        <Button size="sm" variant="ghost" onClick={() => pdfBlob(f).then((b) => downloadBlob(`${fileBase(f)}.pdf`, b)).catch(fileError)}><FileDown aria-hidden className="size-3.5" />PDF</Button>
        <Button size="sm" variant="ghost" onClick={() => downloadBlob(`${fileBase(f)}.doc`, docBlob(f))}><FileText aria-hidden className="size-3.5" />Word</Button>
        <Button size="sm" variant="ghost" onClick={() => downloadBlob(`${fileBase(f)}.xlsx`, xlsxBlob(f))}><Sheet aria-hidden className="size-3.5" />Excel</Button>
        <Button size="sm" variant="ghost" disabled={!online} onClick={() => setEmailOpen(true)}><Mail aria-hidden className="size-3.5" />Email…</Button>
        <Button size="sm" variant="ghost" disabled={!online} onClick={showHistory}><History aria-hidden className="size-3.5" />History</Button>
      </div>
      <p className="mb-3 text-xs text-text-subtle">
        {rec.createdBy && <>Started by {rec.createdBy} · </>}{rec.savedBy && <>{rec.createdBy ? "last" : "Last"} saved by {rec.savedBy} on {when(rec.savedAt)}</>}
        {rec.sentAt && <> · <span className={chip('ok')}>Emailed</span> {when(rec.sentAt)}</>}
      </p>
      {jraLocked && <div className="mb-3"><Banner tone="warning">The JRA has to be approved before the job log can be changed.</Banner></div>}
      {q.isError && <div className="mb-3"><Banner tone="warning">Could not reach the server: working from the copy on this device.</Banner></div>}
      {notice && <div className="mb-3"><Banner tone={notice.tone}>{notice.text}</Banner></div>}

      <HeaderCard f={f} ro={ro} set={setForm} ctx={ctx} />

      <Card className="mb-4 p-4">
        <h2 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold">Sequence of events <span className="font-normal text-text-subtle">the first line is the arrival on location, then a rig up and a rig down line with the work between them · tick the usual wording with the list button or type your own · Enter goes to the next row</span></h2>
        {problems.length > 0 && <div className="mb-3"><Banner tone="warning"><span className="font-semibold">Needed before signing:</span> {problems.join(' ')}</Banner></div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[76rem] border-separate border-spacing-y-1.5 text-sm">
            <caption className="sr-only">Sequence of events</caption>
            <thead><tr>{['', 'Date', 'From', 'To', 'Day', 'Run', 'Depth (ft)', 'Work description', 'Remarks', ''].map((t, i) => <th key={i} scope="col" className="px-1 text-left font-mono text-label font-semibold tracking-wide text-text-muted uppercase">{t}</th>)}</tr></thead>
            <tbody>{f.rows.map((r, i) => (
              <tr key={r.id}>
                <td className="w-16 pr-1 text-right text-xs text-text-subtle">{i + 1}{(() => { const k = rowKind(r.desc); return k && !isEmptyRow(r) ? <span className={cx('mt-0.5 block rounded-sm px-1 font-mono text-[0.625rem] font-bold uppercase', (k === 'arrival' ? filled[0]?.id === r.id : true) ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning')}>{ROW_KIND_LABEL[k]}</span> : null; })()}</td>
                <td className="w-36 px-1"><input type="date" aria-label={`Row ${i + 1} date`} data-jl={`date-${i}`} className={cell} disabled={ro} value={r.date} onChange={(e) => setRow(r.id, { date: e.target.value })} /></td>
                <td className="w-28 px-1"><input type="time" aria-label={`Row ${i + 1} from`} data-jl={`time-${i}`} className={cell} disabled={ro} value={timeHM(r.time)} onChange={(e) => setRow(r.id, { time: e.target.value })} /></td>
                <td className="w-28 px-1"><input type="time" aria-label={`Row ${i + 1} to`} title={!r.to && toOf(f.rows, i) ? `Ends when the next line starts (${toOf(f.rows, i)})` : undefined} className={cx(cell, !r.to && 'text-text-subtle')} disabled={ro} value={timeHM(r.to)}
                  onClick={() => { if (!ro && !timeHM(r.to) && timeHM(r.time)) setForm((x) => ({ ...x, rows: setRowTo(x.rows, r.id, timeHM(r.time), false) })); }}
                  onChange={(e) => setForm((x) => ({ ...x, rows: setRowTo(x.rows, r.id, e.target.value) }))} /></td>
                <td className="w-24 px-1 text-xs text-text-muted">{dayOf(r.date)}</td>
                <td className="w-16 px-1"><input inputMode="numeric" aria-label={`Row ${i + 1} run`} className={cell} disabled={ro} value={r.run} onChange={(e) => setRow(r.id, { run: e.target.value.replace(/[^\d]/g, '').slice(0, 3) })} /></td>
                <td className="w-24 px-1"><input inputMode="decimal" aria-label={`Row ${i + 1} depth in ft`} className={cell} disabled={ro} value={r.depth} onChange={(e) => setRow(r.id, { depth: e.target.value.replace(/[^\d.]/g, '').slice(0, 8) })} /></td>
                <td className="min-w-80 px-1"><div className="flex items-start gap-1">
                  <textarea rows={1} aria-label={`Row ${i + 1} work description`} data-jl={`desc-${i}`} className={cx(cell, 'h-auto min-h-9 flex-1 resize-y py-1.5')} disabled={ro} placeholder={i === 0 ? 'ARRIVED ON LOCATION.' : 'Work done…'} value={r.desc} onChange={(e) => setRow(r.id, { desc: e.target.value })} onKeyDown={(e) => onEnter(e, r.id, 'desc')} />
                  {!ro && <PhrasePicker label={`row ${i + 1}`} value={r.desc} onChange={(v) => setRow(r.id, { desc: v })} ctx={ctx} />}
                </div></td>
                <td className="w-52 px-1"><textarea rows={1} aria-label={`Row ${i + 1} remarks`} data-jl={`remark-${i}`} className={cx(cell, 'h-auto min-h-9 resize-y py-1.5')} disabled={ro} placeholder="Remarks" value={r.remark} onChange={(e) => setRow(r.id, { remark: e.target.value })} onKeyDown={(e) => onEnter(e, r.id, 'remark')} /></td>
                <td className="w-20 whitespace-nowrap">{!ro && <>
                  <Button size="sm" variant="ghost" aria-label={`Insert a row below row ${i + 1}`} onClick={() => insertBelow(r.id)}><Plus aria-hidden className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="text-danger" aria-label={`Delete row ${i + 1}`} onClick={() => deleteRow(r.id)}><X aria-hidden className="size-3.5" /></Button>
                </>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!ro && <Button size="sm" variant="ghost" onClick={() => setForm((x) => ({ ...x, rows: [...x.rows, newRow({ date: x.rows[x.rows.length - 1]?.date || x.date, run: x.rows[x.rows.length - 1]?.run ?? '', time: timeHM(x.rows[x.rows.length - 1]?.to ?? '') })] }))}><Plus aria-hidden className="size-3.5" />Add row</Button>}
          {!ro && <Button size="sm" variant="ghost" onClick={() => setForm((x) => ({ ...x, rows: sortRows(x.rows) }))}><SortAsc aria-hidden className="size-3.5" />Sort by date and time</Button>}
          <span className="ml-auto text-xs text-text-subtle">{events} event{events === 1 ? '' : 's'} · every save keeps a version · a line’s To starts the next line · picking a To starts from the line’s From · arrival, rig up, rig down, runs, failed runs, the deepest point and the tag are read into Execution</span>
        </div>
      </Card>

      <JobDetailsCard f={f} ro={ro} set={setForm} toolBha={q.data?.job.bha ?? []} locked={locked} />

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold">Crew hours and sign-off</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field id="jl-day" label="Day shift crew hours"><input id="jl-day" inputMode="decimal" className={inputClass} disabled={ro} value={f.dayHrs} placeholder={h.day != null ? `${h.day} (worked out)` : 'worked out'} onChange={(e) => setForm({ dayHrs: e.target.value })} /></Field>
          <Field id="jl-night" label="Night shift crew hours"><input id="jl-night" inputMode="decimal" className={inputClass} disabled={ro} value={f.nightHrs} placeholder={h.night != null ? `${h.night} (worked out)` : 'worked out'} onChange={(e) => setForm({ nightHrs: e.target.value })} /></Field>
          <Field id="jl-total" label="Total hours"><input id="jl-total" className={inputClass} disabled value={h.total != null ? String(h.total) : ''} placeholder="—" readOnly /></Field>
        </div>
        <p className="mt-1 mb-4 text-xs text-text-subtle">Worked out from the first to the last logged event: Day 06:00–18:00, Night 18:00–06:00. Type a number to change it; clear it to go back.</p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <p className="mb-2 font-mono text-label font-bold tracking-wide text-accent-text uppercase">NESR representative · slickline supervisor / operator</p>
            <NamesPicker value={f.engNames} options={crewOptions} disabled={ro} onChange={(v) => setForm({ engNames: v })} />
            <div className="mt-3"><SignaturePad value={f.engSig} by={user} disabled={ro || (problems.length > 0 && !hasSig(f.engSig))} onChange={(v) => setForm({ engSig: v })} /></div>
            <div className="mt-3"><Field id="jl-engid" label="I.D. number"><input id="jl-engid" className={inputClass} disabled={ro} value={f.engId} onChange={(e) => setForm({ engId: e.target.value })} /></Field></div>
          </div>
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <p className="mb-2 font-mono text-label font-bold tracking-wide text-accent-text uppercase">Client representative</p>
            <input aria-label="Client representative name" className={inputClass} disabled={ro} value={f.fmName} placeholder="Name" onChange={(e) => setForm({ fmName: e.target.value })} />
            <div className="mt-3"><SignaturePad value={f.fmSig} by={user} disabled={ro || (problems.length > 0 && !hasSig(f.fmSig))} onChange={(v) => setForm({ fmSig: v })} /></div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field id="jl-fmid" label="I.D. number"><input id="jl-fmid" className={inputClass} disabled={ro} value={f.fmId} onChange={(e) => setForm({ fmId: e.target.value })} /></Field>
              <Field id="jl-fmdate" label="Date"><input id="jl-fmdate" type="date" className={inputClass} disabled={ro} value={f.fmDate} onChange={(e) => setForm({ fmDate: e.target.value })} /></Field>
            </div>
          </div>
        </div>
        {problems.length > 0 && !ro && <p className="mt-3 text-xs text-warning">Signing opens when the log has the arrival on the first line, a rig up line and a rig down line, each with its time.</p>}
        <p className={cx('mt-3 text-xs', bothSigned ? 'text-success' : 'text-text-subtle')}>
          {bothSigned ? 'Both signed: saving sets the job’s “Job log signed” to Yes.' : 'When the crew and the client representative have both signed and the log is saved, the job’s “Job log signed” is set to Yes. The log stays editable; each save keeps a version.'}
        </p>
      </Card>

      {history && (
        <Dialog title={`Version history · ${f.ticket || title}`} onClose={() => setHistory(null)} wide>
          {!history.length ? <p className="text-sm text-text-muted">No versions yet: save once to make version 1.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead><tr>{['Version', 'What changed', 'By', 'When', ''].map((t) => <th key={t} scope="col" className="px-2 py-1.5 text-left font-mono text-label font-semibold tracking-wide text-text-muted uppercase">{t}</th>)}</tr></thead>
                <tbody>{history.map((v) => (
                  <tr key={v.version} className="border-t border-border">
                    <td className="px-2 py-1.5 font-mono">v{v.version}{v.version === rec.serverVer && <span className="block text-xs text-text-subtle">current</span>}</td>
                    <td className="px-2 py-1.5">{v.change_summary}</td><td className="px-2 py-1.5">{v.created_by}</td><td className="px-2 py-1.5 whitespace-nowrap">{when(v.created_at)}</td>
                    <td className="px-2 py-1.5">{!ro && v.version !== rec.serverVer && <Button size="sm" variant="ghost" onClick={() => { setForm(() => ({ ...v.form })); setHistory(null); setNotice({ tone: 'warning', text: `Version ${v.version} loaded as a draft: Save / Sync to keep it as a new version.` }); }}>Load as draft</Button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Dialog>
      )}
      {emailOpen && <EmailDialog form={f} user={user} onClose={() => setEmailOpen(false)} onSent={async (to, cc, eml) => {
        setEmailOpen(false);
        setNotice({ tone: 'success', text: eml ? 'The e-mail draft was downloaded (.eml, with the PDF, Word and Excel attached): open it to send from your mail app.' : 'Your mail app was opened with the subject and Cc. The PDF, Word and Excel files were downloaded: attach them before sending.' });
        await api(`/joblog/${encodeURIComponent(jobId)}/sent`, { method: 'POST', json: { version: rec.serverVer, to: to.join(', '), cc: cc.join(', ') } }).catch(() => undefined);
        setRec((r) => (r ? { ...r, sentAt: new Date().toISOString(), sentBy: user } : r));
      }} onError={fileError} />}
    </section>
  );
}

/** The slickline crew: names from the job's crew, or typed. */
function NamesPicker({ value, options, disabled, onChange }: { value: string[]; options: string[]; disabled: boolean; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const left = options.filter((o) => !value.includes(o) && o.toLowerCase().includes(q.toLowerCase()));
  const add = (n: string) => { const t = n.trim(); if (t && !value.includes(t)) onChange([...value, t]); setQ(''); };
  return (
    <div>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5">
        {value.map((n) => (
          <span key={n} className="inline-flex items-center gap-1 rounded-pill bg-surface-3 px-2 py-0.5 text-sm">{n}
            {!disabled && <button type="button" aria-label={`Remove ${n}`} className="text-text-subtle hover:text-text" onClick={() => onChange(value.filter((x) => x !== n))}><X aria-hidden className="size-3" /></button>}
          </span>
        ))}
        {!disabled && <input aria-label="Add a crew name" value={q} list="jl-crew" placeholder={value.length ? '' : 'Supervisor and operator names'} className="min-w-32 flex-1 border-0 bg-transparent text-sm outline-none"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(left[0] ?? q); } if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1)); }} onBlur={() => q.trim() && add(q)} />}
      </div>
      <datalist id="jl-crew">{left.map((o) => <option key={o} value={o} />)}</datalist>
      {!disabled && left.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{left.slice(0, 8).map((o) => <Button key={o} size="sm" variant="ghost" onClick={() => add(o)}><Plus aria-hidden className="size-3" />{o}</Button>)}</div>}
    </div>
  );
}

function EmailDialog({ form, user, onClose, onSent, onError }: { form: LogForm; user: string; onClose: () => void; onSent: (to: string[], cc: string[], eml: boolean) => void; onError: (e: unknown) => void }) {
  const [to, setTo] = useState(''), [cc, setCc] = useState(''), [busy, setBusy] = useState(false);
  const split = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const go = async (eml: boolean) => {
    setBusy(true);
    try {
      const base = fileBase(form);
      const files = [{ name: `${base}.pdf`, blob: await pdfBlob(form) }, { name: `${base}.doc`, blob: docBlob(form) }, { name: `${base}.xlsx`, blob: xlsxBlob(form) }];
      if (eml) downloadBlob(`${base}.eml`, await emlBlob({ to: split(to), cc: split(cc), subject: emailSubject(form), body: emailBody(form, user), files }));
      else {
        for (const x of files) downloadBlob(x.name, x.blob);
        window.location.href = `mailto:${split(to).join(',')}?cc=${encodeURIComponent(split(cc).join(','))}&subject=${encodeURIComponent(emailSubject(form))}&body=${encodeURIComponent(emailBody(form, user))}`;
      }
      onSent(split(to), split(cc), eml);
    } catch (e) { onError(e); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Email the job log" onClose={onClose} wide>
      <div className="grid gap-3">
        <Field id="jl-to" label="To"><input id="jl-to" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} placeholder="client rep, SDM…" /></Field>
        <Field id="jl-cc" label="Cc"><input id="jl-cc" className={inputClass} value={cc} onChange={(e) => setCc(e.target.value)} /></Field>
        <div><p className="mb-1 font-mono text-label font-semibold tracking-wide text-text-muted uppercase">Subject</p><p className="rounded-sm bg-surface-2 px-3 py-2 text-sm">{emailSubject(form)}</p></div>
        <div><p className="mb-1 font-mono text-label font-semibold tracking-wide text-text-muted uppercase">Message</p><pre className="rounded-sm bg-surface-2 px-3 py-2 font-sans text-sm whitespace-pre-wrap">{emailBody(form, user)}</pre></div>
        <p className="text-xs text-text-subtle">The PDF, Word and Excel files are made on this device.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={busy} onClick={() => go(true)}>Download the e-mail draft (with the files)</Button>
          <Button variant="ghost" disabled={busy} onClick={() => go(false)}>Open my mail app</Button>
        </div>
      </div>
    </Dialog>
  );
}
