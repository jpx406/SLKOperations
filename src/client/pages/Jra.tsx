import { Select } from '../components/Select';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, FileSpreadsheet, Info, Send, ShieldCheck, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { SignatureBadge } from '../components/Signature';
import { ANSWER_LABEL, approvalLevel, exemptions, flags, optionsOf, pointsFor, progress, riskScore, type Answer, type Template } from '../../shared/jra';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { roleLabel } from '../../shared/roles';
import { Banner, Button, Card, Field, ProgressBar, Skeleton, cx, inputClass, radioTab, rovingKeys } from '../components/ui';

// JRA (S28): answers save as you go while it is a draft; Send for approval needs every required answer;
// the named approver (or an admin or operations manager) approves or rejects.

interface JraData {
  job: { id: string; ticket_no: string | null; well: string | null; sdm: { username: string; full_name: string } | null };
  template: Template;
  jra: { status: 'draft' | 'sent' | 'approved' | 'rejected'; answers: Record<string, Answer>; risk_score: number; approval_level: string | null; sent_to: string | null; sent_at: string | null; decided_by: string | null; decided_by_name?: string | null; sent_to_name?: string | null; decided_at: string | null; updated_at: string; form_details: FormDetails | null } | null;
  reasons: string[];
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
interface FormDetails { job_no?: string; performed_by?: string; position?: string; jra_date?: string; country?: string; client?: string; location?: string; rig_well?: string; job_description?: string; expected_date?: string; remarks?: Record<string, string>; file?: string | null; uploaded_by?: string; uploaded_at?: string }
const DETAIL_LABEL: [keyof FormDetails, string][] = [['job_no', 'Job no.'], ['performed_by', 'Performed by'], ['position', 'Position'], ['jra_date', 'JRA date'], ['client', 'Client'], ['location', 'Location'], ['rig_well', 'Rig / well'], ['job_description', 'The job'], ['expected_date', 'Expected date']];

export function JraPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['jra', id], queryFn: () => api<JraData>(`/jra/${id}`) });
  // who this JRA can go to: people holding a role for its approval level (Users & Roles → Approvals)
  const approvers = useQuery({ queryKey: ['jra-approvers', id], queryFn: () => api<{ level: string; people: { username: string; full_name: string; role: string }[] }>(`/jra/${id}/approvers`), staleTime: 30_000 });
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [signing, setSigning] = useState(false);
  const d = q.data;
  const status = d?.jra?.status ?? 'draft';
  const canEdit = !!me?.menus.jobs?.edit && status === 'draft';
  const { answers, answer, save, restored } = useJraAutosave(id, d, canEdit);
  useEffect(() => { if (d) setTo((t) => t || d.jra?.sent_to || d.job.sdm?.username || ''); }, [d]);
  const score = d ? riskScore(d.template, answers) : 0;
  const level = d ? approvalLevel(d.template, score) : '';
  const prog = d ? progress(d.template, answers) : { answered: 0, total: 0, missing: [] as string[] };
  const mayDecide = status === 'sent' && !!me && (d?.jra?.sent_to?.toLowerCase() === me.username.toLowerCase() || me.role === 'admin' || me.role === 'operations_manager');
  const sections = useMemo(() => (d ? Object.entries(d.template.sections) : []), [d]);

  const act = async (path: string, json: unknown) => {
    setError(null);
    try {
      // anything still waiting goes to the server before it is sent or decided
      if (path === 'send' && !(await save.flush())) throw new ApiError(0, 'The latest answers haven’t saved yet. Check the connection and try again.');
      const r = await api<{ pdf_error?: string }>(`/jra/${id}/${path}`, { method: 'POST', json });
      await qc.invalidateQueries({ queryKey: ['jra', id] });
      qc.invalidateQueries({ queryKey: ['job', id] });
      qc.invalidateQueries({ queryKey: ['attachments', 'job', id] });
      if (r.pdf_error) setError(`Approved. The PDF wasn’t filed: ${r.pdf_error}`);
    }
    catch (e) { setError((e as ApiError).message); }
  };

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <Banner tone="danger">{q.error.message}</Banner>;
  if (!d) return null;
  return (
    <section aria-labelledby="jra-title">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to={`/operation/jobs/${id}/preparation`} className="inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-xs font-semibold hover:bg-surface-3"><ArrowLeft aria-hidden className="size-4" />Job</Link>
        <h1 id="jra-title" className="font-display text-xl font-extrabold uppercase">Job risk assessment</h1>
        <span className="font-mono text-sm text-text-muted">{d.job.ticket_no ?? 'no ticket'} · {d.template.code} rev {d.template.revision}</span>
        {canEdit && <span className="ml-auto"><JraUpload jobId={id} /></span>}
        <SaveStatus state={save.state} at={save.at} message={save.message} />
      </div>
      {restored && <div className="mb-3"><Banner tone="info">Answers that hadn’t reached the server were kept on this device and have been restored. They are saving now.</Banner></div>}
      {d.reasons.length > 0 ? <div className="mb-3"><Banner tone="warning">This job needs an approved JRA before Execution: it has {d.reasons.join(', ')}.</Banner></div>
        : status === 'draft' && !d.jra?.decided_by && <div className="mb-3"><Banner tone="info">This job doesn’t need a JRA, but you can still complete one.</Banner></div>}
      {status === 'approved' && <div className="mb-3"><Banner tone="success" action={me?.menus.jobs?.edit && <Button size="sm" onClick={() => act('pdf', {})}>File approved PDF again</Button>}>Approved by {d.jra?.decided_by_name ?? d.jra?.decided_by} on {when(d.jra?.decided_at ?? null)}. Answers are locked. The approved JRA is filed as a PDF in the job’s attachments.</Banner><SignatureBadge className="mt-2" type="jra" id={id} /></div>}
      {status === 'sent' && <div className="mb-3"><Banner tone="info">Sent to {d.jra?.sent_to} on {when(d.jra?.sent_at ?? null)} for approval.</Banner></div>}
      {status === 'draft' && d.jra?.decided_by && <div className="mb-3"><Banner tone="warning">Rejected by {d.jra.decided_by_name ?? d.jra.decided_by} on {when(d.jra.decided_at)}. Update the answers and send it again.</Banner></div>}
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {d.jra?.form_details && (
            <Card>
              <h2 className="mb-2 flex items-center gap-2 font-display text-base font-bold"><FileSpreadsheet aria-hidden className="size-4" />From the Excel form</h2>
              <dl className="grid grid-cols-1 gap-x-5 gap-y-1 text-sm sm:grid-cols-2 xl:grid-cols-3">
                {DETAIL_LABEL.filter(([k]) => d.jra?.form_details?.[k]).map(([k, l]) => <div key={k}><dt className="inline text-text-muted">{l}: </dt><dd className="inline">{String(d.jra?.form_details?.[k])}</dd></div>)}
              </dl>
              <p className="mt-2 text-xs text-text-subtle">{d.jra.form_details.file ?? 'Excel file'} · uploaded by {d.jra.form_details.uploaded_by} {when(d.jra.form_details.uploaded_at ?? null)}</p>
            </Card>
          )}
          {sections.map(([key, title]) => (
            <Card key={key}>
              <h2 className="mb-3 font-display text-base font-bold">Section {key} · {title}</h2>
              <ol className="divide-y divide-border">
                {d.template.questions.filter((x) => x.section === key).map((x) => {
                  const a = answers[x.id];
                  const pts = pointsFor(x, a);
                  const req = a && x.requirement?.when.includes(a) ? x.requirement.text : null;
                  const appr = a && x.approver?.when.includes(a) ? x.approver.text : null;
                  const remark = d.jra?.form_details?.remarks?.[x.id];
                  return (
                    <li key={x.id} className="py-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="w-8 font-mono text-xs text-text-muted">{x.id}</span>
                        <span className="min-w-0 flex-1 text-sm">{x.text}{!x.required && <span className="ml-1 text-xs text-text-subtle">(optional)</span>}</span>
                        {pts > 0 && <span className="inline-flex items-center gap-1 text-xs font-semibold text-warning"><AlertTriangle aria-hidden className="size-3.5" />+{pts}</span>}
                        <span role="radiogroup" aria-label={`${x.id}: ${x.text}`} onKeyDown={rovingKeys} className="flex overflow-hidden rounded-md border border-border-strong">
                          {optionsOf(x).map((o, oi) => (
                            <button key={o} type="button" role="radio" aria-checked={a === o} tabIndex={radioTab(a === o, oi === 0, optionsOf(x).includes(a as never))} disabled={!canEdit} onClick={() => answer(x.id, o)}
                              className={cx('h-(--layout-control-answer) min-w-12 px-3 text-xs font-semibold disabled:cursor-default', a === o ? (pointsFor(x, o) > 0 || (x.requirement?.when.includes(o) ?? false) ? 'bg-warning text-on-accent' : 'bg-accent text-on-accent') : 'text-text-muted hover:bg-surface-2')}>{ANSWER_LABEL[o]}</button>
                          ))}
                        </span>
                      </div>
                      {(req || appr || remark || x.guidance) && (
                        <div className="ml-11 mt-1 flex flex-wrap items-center gap-2 text-xs">
                          {req && <span className="rounded-sm bg-warning-subtle px-1.5 py-0.5 font-semibold text-warning">{req}</span>}
                          {appr && <span className="text-text-muted">Approval: {appr}</span>}
                          {remark && <span className="text-text-muted">Remarks: {remark}</span>}
                          {x.guidance && <details className="w-full text-text-muted"><summary className="inline-flex cursor-pointer items-center gap-1"><Info aria-hidden className="size-3.5" />Guidance</summary><p className="mt-1 whitespace-pre-wrap">{x.guidance}</p></details>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </Card>
          ))}
        </div>
        <aside className="space-y-4">
          <Card className="xl:sticky xl:top-4">
            <dl className="grid grid-cols-2 gap-3" aria-live="polite">
              <div><dt className="label-caps text-text-muted">Risk index</dt><dd className="font-display text-kpi font-bold">{score}</dd></div>
              <div><dt className="label-caps text-text-muted">Approval</dt><dd className="mt-1 text-sm font-semibold">{level}</dd></div>
            </dl>
            <div className="mt-3"><p className="mb-1 text-xs text-text-muted">{prog.answered} of {prog.total} answered</p><ProgressBar value={(prog.answered / Math.max(1, prog.total)) * 100} label="JRA progress" done={!prog.missing.length} /></div>
            {(() => { const fl = flags(d.template, answers); const ex = exemptions(d.template, answers); return (
              <div className="mt-3 text-xs">
                <p>{fl.filter((f) => f.requirement).length ? <><span className="font-semibold">{fl.filter((f) => f.requirement).length}</span> MOC / exemption{fl.filter((f) => f.requirement).length === 1 ? '' : 's'}{ex && d.template.exemption_points ? ` (exemptions add ${ex * d.template.exemption_points} points)` : ''}</> : <span className="text-text-muted">No MOC or exemption needed</span>}</p>
                {fl.length > 0 && <ul className="mt-1 space-y-0.5 text-text-muted">{fl.map((f) => <li key={f.id}><span className="font-mono">{f.id}</span> {f.requirement ?? ''}{f.approver ? ` → ${f.approver}` : ''}</li>)}</ul>}
              </div>
            ); })()}
            <p className="mt-3 text-xs text-text-subtle">Approval level by score: {d.template.approval_levels.map((l) => `${l.label} from ${l.min}`).join(' · ')}</p>
            {!!d.template.notes?.length && <details className="mt-2 text-xs text-text-muted"><summary className="cursor-pointer">Form notes</summary><ul className="mt-1 space-y-1">{d.template.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>}
            {status === 'draft' && me?.menus.jobs?.edit && (
              <div className="mt-4 space-y-2 border-t border-border pt-3">
                <Field id="jra-to" label="Send to" hint={prog.missing.length ? `Still to answer: ${prog.missing.join(', ')}` : 'Every required question is answered'}>
                  <Select id="jra-to" search className={inputClass} value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{(approvers.data?.people ?? []).map((s) => <option key={s.username} value={s.username}>{s.full_name} · {roleLabel(s.role)}</option>)}</Select>
                </Field>
                <Button variant="primary" className="w-full" disabled={!!prog.missing.length || !to || save.state === 'saving'} onClick={() => act('send', { to })}><Send aria-hidden className="size-4" />Send for approval</Button>
              </div>
            )}
            {mayDecide && (
              <div className="mt-4 space-y-3 border-t border-border pt-3">
                <Button variant="primary" className="w-full" onClick={() => setSigning(true)}><ShieldCheck aria-hidden className="size-4" />Review and sign…</Button>
                <details className="text-sm">
                  <summary className="cursor-pointer font-semibold text-text-muted">Reject instead…</summary>
                  <div className="mt-2 space-y-2">
                    <Field id="jra-reject" label="Reason for rejecting"><input id="jra-reject" className={inputClass} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} /></Field>
                    <Button variant="danger" className="w-full" disabled={!rejectNote.trim()} onClick={() => act('decide', { decision: 'rejected', note: rejectNote })}><X aria-hidden className="size-4" />Reject and return to draft</Button>
                  </div>
                </details>
              </div>
            )}
            {signing && me && (
              <SignDialog score={score} level={level} flags={flags(d.template, answers)} signer={`${me.fullName} (${roleLabel(me.role)})`} form={`${d.template.code} rev ${d.template.revision}`} ticket={d.job.ticket_no}
                onCancel={() => setSigning(false)} onSign={async () => { await act('decide', { decision: 'approved' }); setSigning(false); }} />
            )}
            {status === 'approved' && <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-success"><Check aria-hidden className="size-4" />Approved · Execution is open</p>}
          </Card>
        </aside>
      </div>
    </section>
  );
}

const STATUS_TEXT: Record<string, string> = { none: 'Not started', draft: 'Draft', sent: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected' };

/** JRA briefing on the Preparation stage: always shown, with where the JRA stands and the Excel upload. */
export function JraBanner({ jobId }: { jobId: string }) {
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['jra', jobId], queryFn: () => api<JraData>(`/jra/${jobId}`) });
  if (!q.data) return null;
  const { reasons, jra, template } = q.data;
  const st = jra?.status ?? 'none';
  const answers = jra?.answers ?? {};
  const score = riskScore(template, answers);
  const fl = flags(template, answers).filter((f) => f.requirement).length;
  const canUpload = !!me?.menus.jobs?.edit && (st === 'none' || st === 'draft');
  return (
    <div className={cx('mb-4 rounded-md border p-3', st === 'approved' ? 'border-success' : reasons.length ? 'border-warning' : 'border-border')}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-base font-bold uppercase">JRA briefing</h2>
        <span className="text-sm text-text-muted">Score {score} → {approvalLevel(template, score)}{fl ? ` · ${fl} MOC / exemption${fl === 1 ? '' : 's'}` : ''}</span>
        <span className={cx('label-caps rounded-pill px-2 py-0.5', st === 'approved' ? 'bg-success-subtle text-success' : st === 'sent' ? 'bg-info-subtle text-info' : 'bg-neutral-subtle text-text-muted')}>{STATUS_TEXT[st] ?? st}</span>
        <span className="font-mono text-xs text-text-subtle">{template.code} rev {template.revision}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          {canUpload && <JraUpload jobId={jobId} />}
          <Link className="inline-flex h-(--layout-control-sm) items-center rounded-md bg-accent px-3 text-sm font-semibold text-on-accent hover:bg-accent-hover" to={`/operation/jobs/${jobId}/jra`}>{st === 'none' ? 'Start JRA' : 'Open JRA'}</Link>
        </span>
      </div>
      <p className="mt-1 text-xs text-text-muted">
        {st === 'approved' ? `Approved by ${jra?.decided_by_name ?? jra?.decided_by}.` : st === 'sent' ? `Waiting for ${jra?.sent_to_name ?? jra?.sent_to}.` : reasons.length ? `This job needs an approved JRA before Execution (${reasons.join(', ')}).` : 'Answer it on screen, or upload the filled Excel form (QHSE’s template). Upload again to update it while it is a draft.'}
        {jra?.form_details?.file && ` Last upload: ${jra.form_details.file}, ${when(jra.form_details.uploaded_at ?? null)}.`}
      </p>
    </div>
  );
}

interface UploadSummary { form: string; newForm: boolean; sameForm: boolean; questions: number; answered: number; missing: string[]; score: number; level: string; flags: { id: string; requirement: string | null; approver: string | null }[]; changed: string[]; warnings: string[] }

/** Upload a filled JRA form: read it first (dry run), show what it says, then replace the draft's answers. */
export function JraUpload({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UploadSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = (f: File, dry: boolean) => api<UploadSummary>(`/jra/${jobId}/upload${dry ? '?dry=1' : ''}`, { method: 'POST', body: f, headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) } });
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setFile(f); setError(null); setPreview(null); setBusy(true);
    try { setPreview(await send(f, true)); } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const confirm = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try { await send(file, false); await qc.invalidateQueries({ queryKey: ['jra', jobId] }); qc.invalidateQueries({ queryKey: ['attachments', 'job', jobId] }); setFile(null); setPreview(null); } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  const close = () => { setFile(null); setPreview(null); setError(null); };
  return (
    <>
      <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" aria-label="Filled JRA form (.xlsx)" onChange={(e) => pick(e.target.files?.[0])} />
      <Button size="sm" loading={busy && !preview} onClick={() => input.current?.click()}><Upload aria-hidden className="size-4" />Upload Excel JRA</Button>
      {(preview || error) && file && (
        <div role="dialog" aria-modal="true" aria-labelledby="jra-up-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4">
          <Card className="max-h-[85vh] w-full max-w-xl overflow-y-auto">
            <div className="mb-3 flex items-start gap-3"><h2 id="jra-up-title" className="flex-1 font-display text-lg font-bold">Upload {file.name}</h2><Button size="sm" variant="ghost" aria-label="Close" onClick={close}><X aria-hidden className="size-4" /></Button></div>
            {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
            {preview && (
              <>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-text-muted">Form</dt><dd className="font-semibold">{preview.form}{preview.newForm && <span className="ml-1 text-xs font-normal text-info">new revision: it will be loaded</span>}</dd></div>
                  <div><dt className="text-text-muted">Answered</dt><dd className="font-semibold">{preview.answered} of {preview.questions}</dd></div>
                  <div><dt className="text-text-muted">Risk index</dt><dd className="font-semibold">{preview.score}</dd></div>
                  <div><dt className="text-text-muted">Approval</dt><dd className="font-semibold">{preview.level}</dd></div>
                </dl>
                {preview.flags.length > 0 && <div className="mt-3 text-sm"><p className="font-semibold">Triggers</p><ul className="text-text-muted">{preview.flags.map((f) => <li key={f.id}><span className="font-mono">{f.id}</span> {f.requirement ?? ''}{f.approver ? ` → ${f.approver}` : ''}</li>)}</ul></div>}
                {preview.missing.length > 0 && <p className="mt-3 text-sm text-warning">Not answered in the file: {preview.missing.join(', ')}. You can answer them on screen after uploading.</p>}
                <p className="mt-3 text-sm">{preview.sameForm ? (preview.changed.length ? `Changes ${preview.changed.length} answer${preview.changed.length === 1 ? '' : 's'}: ${preview.changed.join(', ')}.` : 'Same answers as now.') : 'Replaces the current answers.'}</p>
                {preview.warnings.length > 0 && <div className="mt-3"><Banner tone="warning"><ul className="list-disc pl-4">{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Banner></div>}
                <div className="mt-4 flex gap-2">
                  <Button variant="primary" loading={busy} onClick={confirm}><Upload aria-hidden className="size-4" />Upload and use these answers</Button>
                  <Button onClick={close}>Cancel</Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

export function useJraLock(jobId: string | undefined) {
  const q = useQuery({ queryKey: ['jra', jobId], queryFn: () => api<JraData>(`/jra/${jobId}`), enabled: !!jobId });
  return !!q.data && q.data.reasons.length > 0 && q.data.jra?.status !== 'approved';
}

type SaveState = 'idle' | 'saving' | 'saved' | 'offline';
const draftKey = (jobId: string) => `slk-jra-draft:${jobId}`;
function readDraft(jobId: string): { answers: Record<string, Answer>; at: string } | null {
  try { const v = localStorage.getItem(draftKey(jobId)); return v ? JSON.parse(v) : null; } catch { return null; }
}
function writeDraft(jobId: string, answers: Record<string, Answer> | null) {
  try { if (answers) localStorage.setItem(draftKey(jobId), JSON.stringify({ answers, at: new Date().toISOString() })); else localStorage.removeItem(draftKey(jobId)); } catch { /* private mode: the server save still runs */ }
}

/**
 * Autosave for one job's JRA. Every change is kept on the device at once and saved to the server a moment later; leaving
 * the page or hiding the tab saves straight away; a failed save is retried every few seconds and when the connection
 * comes back. Answers the server hasn't confirmed are never overwritten by a reload. The JRA record is created for the
 * job (with today's form revision) as soon as someone who can edit opens it.
 */
function useJraAutosave(jobId: string, d: JraData | undefined, canEdit: boolean) {
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [state, setState] = useState<SaveState>('idle');
  const [at, setAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const pending = useRef<Record<string, Answer> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);

  const push = async (keepalive = false): Promise<boolean> => {
    const next = pending.current;
    if (!next) return true;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setState('saving');
    try {
      await api(`/jra/${jobId}`, { method: 'PUT', json: { answers: next }, keepalive });
      if (pending.current === next) { pending.current = null; writeDraft(jobId, null); }
      setState(pending.current ? 'saving' : 'saved'); setAt(new Date().toISOString()); setMessage(null);
      if (pending.current) void push();
      return !pending.current;
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 || err.status === 400 || err.status === 403) {
        // the JRA was sent or locked elsewhere, or an answer was refused: stop retrying and show why
        setState('idle'); setMessage(err.message); pending.current = null; writeDraft(jobId, null);
        qc.invalidateQueries({ queryKey: ['jra', jobId] });
        return false;
      }
      setState('offline'); setMessage('Not saved yet. Kept on this device; retrying.');
      if (retry.current) clearTimeout(retry.current);
      retry.current = setTimeout(() => void push(), 5000);
      return false;
    }
  };

  // first load: the server's answers, unless this device holds newer ones that never reached it
  useEffect(() => {
    if (!d || loaded.current) return;
    loaded.current = true;
    const server = d.jra?.answers ?? {};
    const local = readDraft(jobId);
    if (local && canEdit && (!d.jra || local.at > d.jra.updated_at) && JSON.stringify(local.answers) !== JSON.stringify(server)) {
      setAnswers(local.answers); pending.current = local.answers; setRestored(true); void push();
    } else {
      setAnswers(server); writeDraft(jobId, null);
      // tie the JRA to the job now, with the form revision in force today
      if (!d.jra && canEdit) { pending.current = {}; void push().then(() => qc.invalidateQueries({ queryKey: ['jra', jobId] })); }
    }
  }, [d, canEdit, jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  // later reloads (tab focus, another person's change) only replace answers when nothing is waiting to save
  useEffect(() => { if (d && loaded.current && !pending.current && state !== 'saving') setAnswers(d.jra?.answers ?? {}); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const now = () => { if (pending.current) void push(true); };
    const hidden = () => { if (document.visibilityState === 'hidden') now(); };
    window.addEventListener('pagehide', now);
    window.addEventListener('online', now);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', now); window.removeEventListener('online', now); document.removeEventListener('visibilitychange', hidden);
      if (retry.current) clearTimeout(retry.current);
      // leaving the JRA page: send what is waiting right away instead of dropping it
      if (pending.current) void push(true);
    };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = (qid: string, v: Answer) => {
    const next = { ...answers, [qid]: v };
    setAnswers(next);
    pending.current = next;
    writeDraft(jobId, next);
    setState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void push(), 400);
  };

  return { answers, answer, restored, save: { state, at, message, flush: () => push() } };
}

function SaveStatus({ state, at, message }: { state: SaveState; at: string | null; message: string | null }) {
  const time = at ? new Date(at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  return (
    <span role="status" aria-live="polite" className={cx('text-xs font-semibold', state === 'offline' || message ? 'text-warning' : 'text-text-muted')}>
      {message ?? (state === 'saving' ? 'Saving…' : state === 'saved' ? `All changes saved · ${time}` : '')}
    </span>
  );
}

/** Approving a JRA is a digital signature: show exactly what is being signed, and who signs, before it happens. */
function SignDialog({ score, level, flags: fl, signer, form, ticket, onCancel, onSign }: {
  score: number; level: string; flags: { id: string; requirement: string | null; approver: string | null }[]; signer: string; form: string; ticket: string | null;
  onCancel: () => void; onSign: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [busy, onCancel]);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="sign-title" className="fixed inset-0 z-(--z-modal) grid place-items-center bg-bg/70 p-4">
      <Card className="w-full max-w-lg shadow-pop">
        <h2 id="sign-title" className="flex items-center gap-2 font-display text-lg font-bold"><ShieldCheck aria-hidden className="size-5" />Sign this JRA</h2>
        <p className="mt-1 text-sm text-text-muted">Approving records a digital signature with a fingerprint of these answers. If the answers change later, the signature shows it.</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="label-caps text-text-muted">Job</dt><dd className="font-mono">{ticket ?? 'no ticket'} · {form}</dd>
          <dt className="label-caps text-text-muted">Risk index</dt><dd className="font-semibold">{score}</dd>
          <dt className="label-caps text-text-muted">Approval level</dt><dd className="font-semibold">{level}</dd>
          <dt className="label-caps text-text-muted">Signing as</dt><dd className="font-semibold">{signer}</dd>
        </dl>
        {fl.length > 0 && (
          <div className="mt-4 rounded-md bg-warning-subtle p-3 text-sm text-warning">
            <p className="font-semibold">{fl.length} answer{fl.length === 1 ? '' : 's'} need{fl.length === 1 ? 's' : ''} more than a signature</p>
            <ul className="mt-1 space-y-0.5">{fl.map((f) => <li key={f.id}><span className="font-mono">{f.id}</span> {f.requirement ?? ''}{f.approver ? ` → ${f.approver}` : ''}</li>)}</ul>
          </div>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await onSign(); } finally { setBusy(false); } }}><ShieldCheck aria-hidden className="size-4" />Approve and sign</Button>
        </div>
      </Card>
    </div>
  );
}
