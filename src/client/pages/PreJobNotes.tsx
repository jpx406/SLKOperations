import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Download, FileSpreadsheet, History, Mail, Plus, Printer, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { emptyNote, type NoteContent } from '../../shared/pjn';
import type { Job } from '../../shared/types';
import { workbook } from '../../shared/xlsx';
import { ApiError, api, formatDate } from '../api';
import { useMe } from '../auth';
import { saveFile } from '../components/charts';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass, inputSized } from '../components/ui';

// Pre-Job Notes: list (S09), editor (S26) and Confirm & Send (S27).

interface Row { id: string; log_no: string; status: 'sent' | 'not_sent'; current_version: number; saved_at: string; sent_at: string | null; prepared_by: string | null; job_id: string; ticket_no: string | null; rig: string | null; well: string | null; rig_type: string | null; rdd_dept: string | null; main_contact: string | null }
interface Note { id: string; log_no: string; status: 'sent' | 'not_sent'; current_version: number; content: NoteContent; prepared_by: string | null; saved_at: string; sent_at: string | null; sent_by: string | null; job_id: string; ticket_no: string | null; well: string | null; rig: string | null; unit_number: string | null; start_date: string | null; end_date: string | null; versions: { version: number; saved_by: string | null; saved_at: string }[] }
interface Contact { id: string; full_name: string; title: string; contact_email: string | null; contact_mobile: string | null }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function PreJobNotesList() {
  const [params, setParams] = useSearchParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const qs = new URLSearchParams([...params.entries()].filter(([k]) => ['q', 'status', 'from', 'to'].includes(k))).toString();
  const list = useQuery({ queryKey: ['pjn', qs], queryFn: () => api<Row[]>(`/pre-job-notes?${qs}`) });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [del, setDel] = useState<Row | null>(null);
  const rows = list.data ?? [];
  const chosen = rows.filter((r) => picked.has(r.id));
  const exportXlsx = () => saveFile(`pre-job-notes-${new Date().toISOString().slice(0, 10)}.xlsx`, workbook('Pre-Job Notes',
    ['Log #', 'Ticket', 'Rig', 'Well', 'Rig type', 'RDD dept.', 'Status', 'Version', 'Main contact', 'Prepared by', 'Saved on', 'Sent on'],
    (chosen.length ? chosen : rows).map((r) => [r.log_no, r.ticket_no, r.rig, r.well, r.rig_type, r.rdd_dept, r.status === 'sent' ? 'Sent' : 'Not sent', r.current_version, r.main_contact, r.prepared_by, r.saved_at.slice(0, 10), r.sent_at?.slice(0, 10) ?? '']),
    [10, 10, 12, 12, 12, 14, 9, 8, 20, 14, 11, 11]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return (
    <section aria-labelledby="pjn-title">
      <PageTitle aside={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={exportXlsx} disabled={!rows.length}><FileSpreadsheet aria-hidden className="size-4" />Export XLSX{chosen.length ? ` (${chosen.length})` : ''}</Button>
          <Button size="sm" disabled={!chosen.length} onClick={() => navigate(`/operation/pre-job-notes/print?ids=${chosen.map((r) => r.id).join(',')}`)}><Printer aria-hidden className="size-4" />Export PDF{chosen.length ? ` (${chosen.length})` : ''}</Button>
        </div>
      }><span id="pjn-title">Pre-Job Notes</span></PageTitle>
      <p className="-mt-3 mb-4 text-sm text-text-muted">Every job’s handover note. Start a note from the job’s Design stage. Open to Admins, SDMs and people on the SLK Contacts list.</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative"><span className="sr-only">Search log number, ticket, rig or well</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle" />
          <input className={inputSized('h-(--layout-control-sm) w-60 pl-8')} placeholder="Log #, ticket, rig, well" defaultValue={params.get('q') ?? ''} onChange={(e) => set('q', e.target.value.trim())} />
        </label>
        <div role="radiogroup" aria-label="Status" className="flex gap-1.5">
          {[['', 'All'], ['sent', 'Sent'], ['not_sent', 'Not sent']].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={(params.get('status') ?? '') === v} onClick={() => set('status', v)}
              className={cx('h-(--layout-control-sm) rounded-pill border px-3.5 text-sm font-semibold', (params.get('status') ?? '') === v ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>{l}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">From<input type="date" className={inputSized('h-(--layout-control-sm) w-38')} value={params.get('from') ?? ''} onChange={(e) => set('from', e.target.value)} /></label>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">To<input type="date" className={inputSized('h-(--layout-control-sm) w-38')} value={params.get('to') ?? ''} onChange={(e) => set('to', e.target.value)} /></label>
      </div>
      {list.isPending && <Skeleton className="h-64" />}
      {list.isError && <Banner tone="danger">{list.error.message}</Banner>}
      {list.data && !rows.length && <EmptyState title="No Pre-Job Notes match">Notes are started from a job’s Design stage.</EmptyState>}
      {rows.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[64rem] text-sm">
            <thead className="bg-surface-2"><tr className="text-left text-xs text-text-muted">
              <th scope="col" className="w-8 px-3 py-2"><input type="checkbox" aria-label="Select all" checked={picked.size === rows.length} onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
              {['Log #', 'Ticket', 'Rig', 'Well', 'Rig type', 'RDD dept.', 'Status', 'Ver.', 'Main contact', 'Saved on', 'Sent on', ''].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${r.log_no}`} checked={picked.has(r.id)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                  <th scope="row" className="px-3 py-2 text-left"><Link className="font-mono font-semibold underline" to={`/operation/pre-job-notes/${r.id}`}>{r.log_no}</Link></th>
                  <td className="px-3 py-2 font-mono text-xs">{r.ticket_no ?? '—'}</td><td className="px-3 py-2">{r.rig ?? '—'}</td><td className="px-3 py-2">{r.well ?? '—'}</td>
                  <td className="px-3 py-2">{r.rig_type ?? '—'}</td><td className="px-3 py-2">{r.rdd_dept ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">{r.status === 'sent' ? <span className="font-semibold text-success">Sent</span> : 'Not sent'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.current_version}</td><td className="px-3 py-2">{r.main_contact ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{formatDate(r.saved_at.slice(0, 10))}</td><td className="px-3 py-2 font-mono text-xs">{r.sent_at ? formatDate(r.sent_at.slice(0, 10)) : '—'}</td>
                  <td className="px-3 py-2 text-right">{me?.role === 'admin' && <Button size="sm" variant="ghost" aria-label={`Delete ${r.log_no}`} onClick={() => setDel(r)}><Trash2 aria-hidden className="size-3.5" /></Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {del && <DeleteNote row={del} onClose={(ok) => { setDel(null); if (ok) { qc.invalidateQueries({ queryKey: ['pjn'] }); qc.invalidateQueries({ queryKey: ['pjn-job'] }); } }} />}
    </section>
  );
}

/** Two confirmations (Administrator Manual 8.1): first the warning, then typing the log number. */
function DeleteNote({ row, onClose }: { row: { id: string; log_no: string; ticket_no?: string | null; current_version: number }; onClose: (ok?: boolean) => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await api(`/pre-job-notes/${row.id}`, { method: 'DELETE', json: { confirm: typed } }); onClose(true); } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="del-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <Card className="w-full max-w-md">
        <h2 id="del-title" className="mb-2 font-display text-lg font-bold">Delete {row.log_no}?</h2>
        {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
        {step === 1 ? (
          <>
            <p className="mb-4 text-sm">This permanently removes the note and all {row.current_version} saved version{row.current_version === 1 ? '' : 's'}{row.ticket_no ? ` for ticket ${row.ticket_no}` : ''}. It can’t be undone.</p>
            <div className="flex gap-2"><Button variant="danger" onClick={() => setStep(2)}>Continue</Button><Button onClick={() => onClose()}>Keep it</Button></div>
          </>
        ) : (
          <>
            <Field id="del-typed" label={`Type ${row.log_no} to confirm`}><input id="del-typed" autoFocus className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
            <div className="mt-4 flex gap-2"><Button variant="danger" loading={busy} disabled={typed.trim().toUpperCase() !== row.log_no} onClick={go}>Delete permanently</Button><Button onClick={() => onClose()}>Keep it</Button></div>
          </>
        )}
      </Card>
    </div>
  );
}

/** Note body, used on screen (read-only parts), in print and in the email. */
function NoteDocument({ note, contacts, job }: { note: Pick<Note, 'log_no' | 'current_version' | 'status' | 'prepared_by' | 'saved_at' | 'sent_at'> & { content: NoteContent }; contacts: Contact[]; job: { ticket_no: string | null; rig: string | null; well: string | null } }) {
  const c = note.content;
  const name = (id: string) => contacts.find((x) => x.id === id);
  const main = name(c.main_contact_id);
  const row = (k: string, v: React.ReactNode) => <tr><th scope="row" className="w-44 py-1 pr-3 text-left align-top font-semibold text-text-muted">{k}</th><td className="py-1 align-top">{v || '—'}</td></tr>;
  return (
    <article className="pjn-doc space-y-4 text-sm">
      <header className="flex items-baseline justify-between border-b-2 border-accent-edge pb-2"><span className="font-display text-lg font-extrabold uppercase">SLK Operations · Pre-Job Note</span><span className="font-mono">{note.log_no} · v{note.current_version}</span></header>
      <section><h3 className="label-caps mb-1 text-text-muted">1 · Job information</h3><table className="w-full"><tbody>
        {row('Client', c.client)}{row('Field ticket', job.ticket_no)}{row('Rig / well', `${job.rig ?? '—'} / ${job.well ?? '—'}`)}{row('Rig type', c.rig_type)}{row('RDD department', c.rdd_dept)}
        {row('Casing size', c.casing)}{row('Suite #', c.suite_no)}{row('Expected dates', c.date_from ? `${formatDate(c.date_from)}${c.date_to ? ` to ${formatDate(c.date_to)}` : ''}` : '')}
      </tbody></table></section>
      <section><h3 className="label-caps mb-1 text-text-muted">2 · Toolstrings and program</h3>
        {c.toolstrings.length ? <table className="w-full border-collapse"><thead><tr className="text-left text-xs text-text-muted"><th className="py-1 pr-2">#</th><th className="py-1 pr-2">Conveyance</th><th className="py-1 pr-2">Toolstring</th><th className="py-1">Run details</th></tr></thead>
          <tbody>{c.toolstrings.map((t, i) => <tr key={i} className="border-t border-border align-top"><td className="py-1 pr-2">{i + 1}</td><td className="py-1 pr-2">{t.conveyance}</td><td className="py-1 pr-2 whitespace-pre-wrap">{t.config}</td><td className="py-1 whitespace-pre-wrap">{t.details}</td></tr>)}</tbody></table> : <p>—</p>}
      </section>
      <section><h3 className="label-caps mb-1 text-text-muted">3 · Important notes</h3><p className="whitespace-pre-wrap">{c.important_notes || '—'}</p></section>
      <section><h3 className="label-caps mb-1 text-text-muted">4 · Contacts</h3><table className="w-full"><tbody>
        {row('Client SME', [c.sme.name, c.sme.mobile, c.sme.email].filter(Boolean).join(' · '))}
        {row('SLK main contact', main ? `${main.full_name} · ${[main.contact_mobile, main.contact_email].filter(Boolean).join(' · ')}` : '')}
        {row('Other contacts', c.extra_contact_ids.map((id) => name(id)?.full_name).filter(Boolean).join(', '))}
      </tbody></table></section>
      <section><h3 className="label-caps mb-1 text-text-muted">5 · Document control</h3><p className="text-xs text-text-muted">{note.status === 'sent' ? 'Sent' : 'Not sent'} · version {note.current_version} · prepared by {note.prepared_by ?? '—'} · saved {when(note.saved_at)}{note.sent_at ? ` · sent ${when(note.sent_at)}` : ''}</p></section>
    </article>
  );
}

export function PreJobNoteEditor() {
  const { id = 'new' } = useParams();
  const [params] = useSearchParams();
  const isNew = id === 'new';
  const jobId = params.get('job');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canEdit = !!me?.menus.pre_job_notes?.edit;
  const noteQ = useQuery({ queryKey: ['pjn-note', id], queryFn: () => api<Note>(`/pre-job-notes/${id}`), enabled: !isNew });
  const jobQ = useQuery({ queryKey: ['job', jobId], queryFn: () => api<Job>(`/jobs/${jobId}`), enabled: isNew && !!jobId });
  const contactsQ = useQuery({ queryKey: ['pjn-contacts'], queryFn: () => api<Contact[]>('/pre-job-notes/contacts') });
  const contacts = contactsQ.data ?? [];
  const [c, setC] = useState<NoteContent>(emptyNote);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<'send' | 'history' | null>(null);
  const note = noteQ.data;
  const job = note ? { id: note.job_id, ticket_no: note.ticket_no, rig: note.rig, well: note.well } : jobQ.data ? { id: jobQ.data.id, ticket_no: jobQ.data.ticket_no, rig: jobQ.data.rig, well: jobQ.data.well } : null;
  useEffect(() => {
    if (!note) return;
    // an empty program still opens with one row to fill in
    setC({ ...emptyNote(), ...note.content, toolstrings: note.content.toolstrings.length ? note.content.toolstrings : emptyNote().toolstrings });
    setDirty(false);
  }, [note]);
  useEffect(() => {
    // a new note starts from the job: expected dates, and the toolstring from Preparation
    if (!isNew || !jobQ.data) return;
    const j = jobQ.data;
    setC((cur) => ({ ...cur, date_from: j.start_date ?? '', date_to: j.end_date ?? j.start_date ?? '',
      toolstrings: [{ conveyance: j.conveyance ?? '', config: (j.toolstring ?? []).map((t) => t.component + (t.od_in ? ` ${t.od_in} in` : '')).join(', '), details: j.run_details ?? '' }] }));
  }, [isNew, jobQ.data]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const edit = (patch: Partial<NoteContent>) => { setC((cur) => ({ ...cur, ...patch })); setDirty(true); };

  const save = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = isNew
        ? await api<{ note: Note }>('/pre-job-notes', { method: 'POST', json: { job_id: jobId, content: c } })
        : await api<{ note: Note }>(`/pre-job-notes/${id}`, { method: 'PUT', json: { expectedVersion: note?.current_version, content: c } });
      qc.setQueryData(['pjn-note', res.note.id], res.note);
      qc.invalidateQueries({ queryKey: ['pjn'] }); qc.invalidateQueries({ queryKey: ['pjn-job'] });
      setDirty(false);
      setNotice(`Saved as ${res.note.log_no} v${res.note.current_version}.`);
      if (isNew) navigate(`/operation/pre-job-notes/${res.note.id}`, { replace: true });
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };

  if (!isNew && noteQ.isPending) return <Skeleton className="h-96" />;
  if (!isNew && noteQ.isError) return <Banner tone="danger">{noteQ.error.message}</Banner>;
  if (isNew && !jobId) return <Banner tone="warning">Start a Pre-Job Note from the job’s Design stage.</Banner>;
  const ro = !canEdit;
  const contactName = (x: Contact) => `${x.full_name} · ${x.title}`;

  return (
    <section aria-labelledby="pjn-ed-title">
      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <Link to={job ? `/operation/jobs/${job.id}/design` : '/operation/pre-job-notes'} className="inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-xs font-semibold hover:bg-surface-3"><ArrowLeft aria-hidden className="size-4" />Job</Link>
        <h1 id="pjn-ed-title" className="font-display text-xl font-extrabold uppercase">Pre-Job Note{note ? ` ${note.log_no}` : ''}</h1>
        {note && <span className="font-mono text-sm text-text-muted">v{note.current_version} · {note.status === 'sent' ? 'Sent' : 'Not sent'}</span>}
        <span role="status" className="text-xs font-semibold">{dirty ? <span className="text-text-muted">Unsaved changes</span> : note ? <span className="inline-flex items-center gap-1 text-success"><Check aria-hidden className="size-3.5" />All changes saved</span> : null}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit && <Button variant="primary" loading={busy} onClick={save} disabled={!dirty && !!note}>Save</Button>}
          {canEdit && <Button onClick={() => setPanel('send')} disabled={!note || dirty}><Mail aria-hidden className="size-4" />Confirm &amp; send</Button>}
          <Button onClick={() => window.print()} disabled={!note || dirty}><Printer aria-hidden className="size-4" />Print / PDF</Button>
          <Button onClick={() => setPanel('history')} disabled={!note}><History aria-hidden className="size-4" />History</Button>
        </div>
      </div>
      {error && <div className="mb-3 print:hidden"><Banner tone="danger">{error}</Banner></div>}
      {notice && <div className="mb-3 print:hidden"><Banner tone="success">{notice}</Banner></div>}
      {contactsQ.data && !contacts.length && <div className="mb-3 print:hidden"><Banner tone="warning">The SLK Contacts list is empty. Ask the attendance administrator to mark contacts in the Headcount Roster.</Banner></div>}

      <div className="hidden print:block">{note && job && <NoteDocument note={{ ...note, content: c }} contacts={contacts} job={job} />}</div>
      <div className="space-y-4 print:hidden">
        <Card>
          <h2 className="label-caps mb-3 text-text-muted">1 · Job information</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm md:col-span-2 xl:col-span-4">
              <span><span className="text-text-muted">Ticket</span> <span className="font-mono">{job?.ticket_no ?? '—'}</span></span><span><span className="text-text-muted">Rig</span> {job?.rig ?? '—'}</span><span><span className="text-text-muted">Well</span> {job?.well ?? '—'}</span>
            </div>
            <Field id="pj-client" label="Client"><input id="pj-client" className={inputClass} disabled={ro} value={c.client} onChange={(e) => edit({ client: e.target.value })} /></Field>
            <Field id="pj-rigtype" label="Rig type" required><input id="pj-rigtype" className={inputClass} disabled={ro} value={c.rig_type} onChange={(e) => edit({ rig_type: e.target.value })} placeholder="Land rig, offshore jacket…" /></Field>
            <Field id="pj-rdd" label="RDD department" required><input id="pj-rdd" className={inputClass} disabled={ro} value={c.rdd_dept} onChange={(e) => edit({ rdd_dept: e.target.value })} /></Field>
            <Field id="pj-casing" label="Casing size" required><input id="pj-casing" className={inputClass} disabled={ro} value={c.casing} onChange={(e) => edit({ casing: e.target.value })} placeholder='e.g. 7"' /></Field>
            <Field id="pj-suite" label="Suite #" required><input id="pj-suite" className={inputClass} disabled={ro} value={c.suite_no} onChange={(e) => edit({ suite_no: e.target.value })} /></Field>
            <Field id="pj-from" label="Expected from"><input id="pj-from" type="date" className={inputClass} disabled={ro} value={c.date_from} onChange={(e) => edit({ date_from: e.target.value })} /></Field>
            <Field id="pj-to" label="Expected to"><input id="pj-to" type="date" className={inputClass} disabled={ro} value={c.date_to} onChange={(e) => edit({ date_to: e.target.value })} /></Field>
          </div>
        </Card>
        <Card>
          <h2 className="label-caps mb-3 text-text-muted">2 · Toolstrings and program</h2>
          <ul className="space-y-3">
            {c.toolstrings.map((t, i) => (
              <li key={i} className="grid grid-cols-1 gap-2 md:grid-cols-[10rem_1fr_1fr_auto]">
                <input aria-label={`Run ${i + 1} conveyance`} className={inputClass} disabled={ro} placeholder="Conveyance" value={t.conveyance} onChange={(e) => edit({ toolstrings: c.toolstrings.map((x, j) => (j === i ? { ...x, conveyance: e.target.value } : x)) })} />
                <textarea aria-label={`Run ${i + 1} toolstring`} rows={2} className={cx(inputClass, 'h-auto py-1.5')} disabled={ro} placeholder="Proposed toolstring" value={t.config} onChange={(e) => edit({ toolstrings: c.toolstrings.map((x, j) => (j === i ? { ...x, config: e.target.value } : x)) })} />
                <textarea aria-label={`Run ${i + 1} details`} rows={2} className={cx(inputClass, 'h-auto py-1.5')} disabled={ro} placeholder="Run details" value={t.details} onChange={(e) => edit({ toolstrings: c.toolstrings.map((x, j) => (j === i ? { ...x, details: e.target.value } : x)) })} />
                <Button size="sm" variant="ghost" aria-label={`Remove run ${i + 1}`} disabled={ro || c.toolstrings.length === 1} onClick={() => edit({ toolstrings: c.toolstrings.filter((_, j) => j !== i) })}><X aria-hidden className="size-4" /></Button>
              </li>
            ))}
          </ul>
          {!ro && <Button size="sm" className="mt-2" onClick={() => edit({ toolstrings: [...c.toolstrings, { conveyance: '', config: '', details: '' }] })}><Plus aria-hidden className="size-3.5" />Add row</Button>}
        </Card>
        <Card>
          <h2 className="label-caps mb-3 text-text-muted">3 · Important notes</h2>
          <textarea aria-label="Important notes" rows={7} className={cx(inputClass, 'h-auto py-2')} disabled={ro} value={c.important_notes} onChange={(e) => edit({ important_notes: e.target.value })} />
        </Card>
        <Card>
          <h2 className="label-caps mb-3 text-text-muted">4 · Contacts</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field id="pj-sme" label="Client SME name"><input id="pj-sme" className={inputClass} disabled={ro} value={c.sme.name} onChange={(e) => edit({ sme: { ...c.sme, name: e.target.value } })} /></Field>
            <Field id="pj-sme-m" label="SME mobile"><input id="pj-sme-m" className={inputClass} disabled={ro} value={c.sme.mobile} onChange={(e) => edit({ sme: { ...c.sme, mobile: e.target.value } })} /></Field>
            <Field id="pj-sme-e" label="SME email"><input id="pj-sme-e" type="email" className={inputClass} disabled={ro} value={c.sme.email} onChange={(e) => edit({ sme: { ...c.sme, email: e.target.value } })} /></Field>
            <Field id="pj-main" label="SLK main contact" required hint="From the SLK Contacts list">
              <select id="pj-main" className={inputClass} disabled={ro} value={c.main_contact_id} onChange={(e) => edit({ main_contact_id: e.target.value })}><option value="">Choose…</option>{contacts.map((x) => <option key={x.id} value={x.id}>{contactName(x)}</option>)}</select>
            </Field>
            <fieldset className="md:col-span-2">
              <legend className="label-caps mb-1.5 text-text-muted">Other contacts (copied on the email)</legend>
              <div className="flex flex-wrap gap-2">
                {contacts.filter((x) => x.id !== c.main_contact_id).map((x) => (
                  <label key={x.id} className="inline-flex items-center gap-1.5 rounded-pill border border-border px-2.5 py-1 text-xs">
                    <input type="checkbox" disabled={ro} checked={c.extra_contact_ids.includes(x.id)} onChange={(e) => edit({ extra_contact_ids: e.target.checked ? [...c.extra_contact_ids, x.id] : c.extra_contact_ids.filter((y) => y !== x.id) })} />{x.full_name}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </Card>
        <Card>
          <h2 className="label-caps mb-2 text-text-muted">5 · Document control</h2>
          <p className="text-sm text-text-muted">{note ? <>{note.log_no} · {note.status === 'sent' ? 'Sent' : 'Not sent'} · version {note.current_version} · prepared by {note.prepared_by ?? '—'} · saved {when(note.saved_at)}{note.sent_at && <> · sent {when(note.sent_at)} by {note.sent_by}</>}</> : 'Fills in when you save. The first save gives the note its PJN number.'}</p>
        </Card>
      </div>
      {panel === 'history' && note && <NoteHistory note={note} onClose={() => setPanel(null)} />}
      {panel === 'send' && note && job && <SendNote note={note} job={job} contacts={contacts} onClose={(sent) => { setPanel(null); if (sent) { qc.setQueryData(['pjn-note', sent.id], sent); qc.invalidateQueries({ queryKey: ['pjn'] }); setNotice(`${sent.log_no} marked as sent.`); } }} />}
    </section>
  );
}

function NoteHistory({ note, onClose }: { note: Note; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="hist-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <Card className="w-full max-w-md">
        <div className="mb-3 flex items-start gap-3"><h2 id="hist-title" className="flex-1 font-display text-lg font-bold">History of {note.log_no}</h2><Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}><X aria-hidden className="size-4" /></Button></div>
        <p className="mb-3 text-sm text-text-muted">Every save is kept, newest first. Saved versions can’t be edited or deleted here.</p>
        <ul className="divide-y divide-border text-sm">{note.versions.map((v) => <li key={v.version} className="flex gap-3 py-1.5"><span className="font-mono font-semibold">v{v.version}</span><span className="flex-1">{v.saved_by}</span><span className="font-mono text-xs text-text-muted">{when(v.saved_at)}</span></li>)}</ul>
      </Card>
    </div>
  );
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The email body as HTML (for the .eml) and as text (for the mail app). */
function noteEmail(note: Note, job: { ticket_no: string | null; rig: string | null; well: string | null }, contacts: Contact[]) {
  const c = note.content;
  const main = contacts.find((x) => x.id === c.main_contact_id);
  const lines: [string, string][] = [
    ['Client', c.client], ['Field ticket', job.ticket_no ?? '—'], ['Rig / well', `${job.rig ?? '—'} / ${job.well ?? '—'}`], ['Rig type', c.rig_type], ['RDD department', c.rdd_dept],
    ['Casing size', c.casing], ['Suite #', c.suite_no], ['Expected dates', c.date_from ? `${c.date_from}${c.date_to ? ` to ${c.date_to}` : ''}` : '—'],
    ['Client SME', [c.sme.name, c.sme.mobile, c.sme.email].filter(Boolean).join(' · ') || '—'], ['SLK main contact', main ? `${main.full_name} ${main.contact_mobile ?? ''} ${main.contact_email ?? ''}`.trim() : '—'],
  ];
  const text = [`Pre-Job Note ${note.log_no} v${note.current_version}`, '', ...lines.map(([k, v]) => `${k}: ${v}`), '', 'Toolstrings and program:',
    ...c.toolstrings.map((t, i) => `${i + 1}. ${t.conveyance} | ${t.config} | ${t.details}`), '', 'Important notes:', c.important_notes].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:13px"><h2 style="border-bottom:2px solid #2b6cb0">SLK Operations · Pre-Job Note ${esc(note.log_no)} v${note.current_version}</h2>
<table>${lines.map(([k, v]) => `<tr><th align="left" style="padding:2px 10px 2px 0;color:#555">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
<h3>Toolstrings and program</h3><table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>#</th><th>Conveyance</th><th>Toolstring</th><th>Run details</th></tr>${c.toolstrings.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t.conveyance)}</td><td>${esc(t.config)}</td><td>${esc(t.details)}</td></tr>`).join('')}</table>
<h3>Important notes</h3><p style="white-space:pre-wrap">${esc(c.important_notes)}</p></div>`;
  return { text, html };
}

function SendNote({ note, job, contacts, onClose }: { note: Note; job: { ticket_no: string | null; rig: string | null; well: string | null }; contacts: Contact[]; onClose: (sent?: Note) => void }) {
  // Cc defaults to the other contacts picked in section 4 (manual §3.9 tip)
  const defaultCc = useMemo(() => note.content.extra_contact_ids.map((id) => contacts.find((x) => x.id === id)?.contact_email).filter(Boolean).join(', '), [note, contacts]);
  const [subject, setSubject] = useState(`Pre-Job Note ${note.log_no} · ticket ${job.ticket_no ?? '—'} · ${job.well ?? ''}`.trim());
  const [to, setTo] = useState('');
  const [cc, setCc] = useState(defaultCc);
  const [error, setError] = useState<string | null>(null);
  const mail = noteEmail(note, job, contacts);
  const mark = async (how: 'mail' | 'eml') => {
    try { const r = await api<{ note: Note }>(`/pre-job-notes/${note.id}/sent`, { method: 'POST', json: { to, cc, how } }); onClose(r.note); } catch (e) { setError((e as ApiError).message); }
  };
  const openMail = async () => {
    try { await navigator.clipboard.writeText(mail.text); } catch { /* the body below can still be copied by hand */ }
    window.location.href = `mailto:${encodeURIComponent(to).replace(/%40/g, '@').replace(/%2C/g, ',')}?subject=${encodeURIComponent(subject)}&cc=${encodeURIComponent(cc).replace(/%40/g, '@').replace(/%2C/g, ',')}&body=${encodeURIComponent(mail.text)}`;
    await mark('mail');
  };
  const downloadEml = async () => {
    const eml = [`To: ${to}`, `Cc: ${cc}`, `Subject: ${subject}`, 'X-Unsent: 1', 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', mail.html].join('\r\n');
    saveFile(`${note.log_no}-v${note.current_version}.eml`, eml, 'message/rfc822');
    await mark('eml');
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="send-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <Card className="max-h-full w-full max-w-xl overflow-y-auto">
        <div className="mb-3 flex items-start gap-3"><h2 id="send-title" className="flex-1 font-display text-lg font-bold">Confirm &amp; send {note.log_no}</h2><Button size="sm" variant="ghost" aria-label="Close" onClick={() => onClose()}><X aria-hidden className="size-4" /></Button></div>
        <p className="mb-3 text-sm text-text-muted">Either way the note is marked Sent. For a PDF copy, use Print / PDF and attach it.</p>
        {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
        <div className="space-y-3">
          <Field id="sn-subject" label="Subject"><input id="sn-subject" className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field id="sn-to" label="To"><input id="sn-to" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} placeholder="Recipient addresses, separated by commas" /></Field>
          <Field id="sn-cc" label="Cc" hint="Defaults to the other contacts on the note"><input id="sn-cc" className={inputClass} value={cc} onChange={(e) => setCc(e.target.value)} /></Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={openMail}><Mail aria-hidden className="size-4" />Open in mail app</Button>
          <Button onClick={downloadEml}><Download aria-hidden className="size-4" />Download .eml instead</Button>
        </div>
        <p className="mt-2 text-xs text-text-subtle">Open in mail app also copies the note text to your clipboard, ready to paste.</p>
      </Card>
    </div>
  );
}

/** Several notes printed one after another (the list's Export PDF). */
export function PreJobNotesPrint() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean).slice(0, 50);
  const contactsQ = useQuery({ queryKey: ['pjn-contacts'], queryFn: () => api<Contact[]>('/pre-job-notes/contacts') });
  const notes = useQuery({ queryKey: ['pjn-print', ids.join(',')], queryFn: () => Promise.all(ids.map((id) => api<Note>(`/pre-job-notes/${id}`))) });
  return (
    <section aria-label="Pre-Job Notes for printing">
      <div className="mb-4 flex items-center gap-2 print:hidden">
        <Link to="/operation/pre-job-notes" className="inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-xs font-semibold"><ArrowLeft aria-hidden className="size-4" />Pre-Job Notes</Link>
        <Button size="sm" variant="primary" onClick={() => window.print()} disabled={!notes.data}><Printer aria-hidden className="size-4" />Print or save as PDF</Button>
      </div>
      {notes.isPending ? <Skeleton className="h-96" /> : notes.isError ? <Banner tone="danger">{notes.error.message}</Banner> : (
        <div className="space-y-8">{notes.data!.map((n) => <Card key={n.id} className="break-after-page print:border-0 print:shadow-none"><NoteDocument note={n} contacts={contactsQ.data ?? []} job={n} /></Card>)}</div>
      )}
    </section>
  );
}

/** The Pre-Job Note panel on the job's Design stage. */
export function PreJobNotePanel({ jobId }: { jobId: string }) {
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['pjn-job', jobId], queryFn: () => api<{ id: string; log_no: string; status: string; current_version: number; saved_at: string; sent_at: string | null } | null>(`/pre-job-notes/by-job/${jobId}`), enabled: !!me?.menus.pre_job_notes?.view });
  if (!me?.menus.pre_job_notes?.view || q.isPending) return null;
  const n = q.data;
  const canStart = !!me?.menus.pre_job_notes?.edit;
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
      <span className="label-caps text-text-muted">Pre-Job Note</span>
      {n ? <span className="text-sm"><span className="font-mono font-semibold">{n.log_no}</span> · v{n.current_version} · {n.status === 'sent' ? <span className="text-success">Sent {n.sent_at ? formatDate(n.sent_at.slice(0, 10)) : ''}</span> : 'Not sent'}</span>
        : <span className="text-sm text-text-muted">None yet</span>}
      {(n || canStart) && <Link className="ml-auto inline-flex h-(--layout-control-sm) items-center rounded-md border border-border-strong px-3 text-xs font-semibold hover:bg-surface-3" to={n ? `/operation/pre-job-notes/${n.id}` : `/operation/pre-job-notes/new?job=${jobId}`}>
        {n ? 'Open Pre-Job Note' : 'Create Pre-Job Note'}
      </Link>}
    </div>
  );
}
