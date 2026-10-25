import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, FileSpreadsheet, Info, Send, ShieldCheck, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { SignatureBadge } from '../components/Signature';
import { ANSWER_LABEL, approvalLevel, exemptions, flags, optionsOf, pointsFor, progress, riskScore, type Answer, type Template } from '../../shared/jra';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, Field, ProgressBar, Skeleton, cx, inputClass } from '../components/ui';

// JRA (S28): answers save as you go while it is a draft; Send for approval needs every required answer;
// the named approver (or an admin or operations manager) approves or rejects.

interface JraData {
  job: { id: string; ticket_no: string | null; well: string | null; sdm: { username: string; full_name: string } | null };
  template: Template;
  jra: { status: 'draft' | 'sent' | 'approved' | 'rejected'; answers: Record<string, Answer>; risk_score: number; approval_level: string | null; sent_to: string | null; sent_at: string | null; decided_by: string | null; decided_at: string | null; form_details: FormDetails | null } | null;
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
  const sdms = useQuery({ queryKey: ['sdms'], queryFn: () => api<{ username: string; full_name: string }[]>('/sdms'), staleTime: 300_000 });
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const d = q.data;
  useEffect(() => { if (d) { setAnswers(d.jra?.answers ?? {}); setTo(d.jra?.sent_to ?? d.job.sdm?.username ?? ''); } }, [d]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const status = d?.jra?.status ?? 'draft';
  const canEdit = !!me?.menus.jobs?.edit && status === 'draft';
  const score = d ? riskScore(d.template, answers) : 0;
  const level = d ? approvalLevel(d.template, score) : '';
  const prog = d ? progress(d.template, answers) : { answered: 0, total: 0, missing: [] as string[] };
  const mayDecide = status === 'sent' && !!me && (d?.jra?.sent_to?.toLowerCase() === me.username.toLowerCase() || me.role === 'admin' || me.role === 'operations_manager');
  const sections = useMemo(() => (d ? Object.entries(d.template.sections) : []), [d]);

  const answer = (qid: string, v: Answer) => {
    const next = { ...answers, [qid]: v };
    setAnswers(next);
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { await api(`/jra/${id}`, { method: 'PUT', json: { answers: next } }); setSaveState('saved'); }
      catch (e) { setSaveState('error'); setError((e as ApiError).message); }
    }, 600);
  };
  const act = async (path: string, json: unknown) => {
    setError(null);
    try { await api(`/jra/${id}/${path}`, { method: 'POST', json }); await qc.invalidateQueries({ queryKey: ['jra', id] }); qc.invalidateQueries({ queryKey: ['job', id] }); }
    catch (e) { setError((e as ApiError).message); }
  };

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <Banner tone="danger">{q.error.message}</Banner>;
  if (!d) return null;
  return (
    <section aria-labelledby="jra-title">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to={`/operation/jobs/${id}/preparation`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-xs font-semibold hover:bg-surface-3"><ArrowLeft aria-hidden className="size-4" />Job</Link>
        <h1 id="jra-title" className="font-display text-xl font-extrabold uppercase">Job risk assessment</h1>
        <span className="font-mono text-sm text-text-muted">{d.job.ticket_no ?? 'no ticket'} · {d.template.code} rev {d.template.revision}</span>
        {canEdit && <span className="ml-auto"><JraUpload jobId={id} /></span>}
        <span role="status" className="text-xs font-semibold text-text-muted">{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}</span>
      </div>
      {d.reasons.length > 0 ? <div className="mb-3"><Banner tone="warning">This job needs an approved JRA before Execution: it has {d.reasons.join(', ')}.</Banner></div>
        : <div className="mb-3"><Banner tone="info">This job doesn’t need a JRA, but you can still complete one.</Banner></div>}
      {status === 'approved' && <div className="mb-3"><Banner tone="success">Approved by {d.jra?.decided_by} on {when(d.jra?.decided_at ?? null)}. Answers are locked.</Banner><SignatureBadge className="mt-2" type="jra" id={id} /></div>}
      {status === 'sent' && <div className="mb-3"><Banner tone="info">Sent to {d.jra?.sent_to} on {when(d.jra?.sent_at ?? null)} for approval.</Banner></div>}
      {status === 'draft' && d.jra?.decided_by && <div className="mb-3"><Banner tone="warning">Rejected by {d.jra.decided_by} on {when(d.jra.decided_at)}. Update the answers and send it again.</Banner></div>}
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
                        <span role="radiogroup" aria-label={`${x.id}: ${x.text}`} className="flex overflow-hidden rounded-md border border-border-strong">
                          {optionsOf(x).map((o) => (
                            <button key={o} type="button" role="radio" aria-checked={a === o} disabled={!canEdit} onClick={() => answer(x.id, o)}
                              className={cx('h-8 w-12 text-xs font-semibold disabled:cursor-default', a === o ? (pointsFor(x, o) > 0 || (x.requirement?.when.includes(o) ?? false) ? 'bg-warning text-on-accent' : 'bg-accent text-on-accent') : 'text-text-muted hover:bg-surface-2')}>{ANSWER_LABEL[o]}</button>
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
                <p><span className="font-semibold">{fl.filter((f) => f.requirement).length}</span> MOC / exemption{fl.filter((f) => f.requirement).length === 1 ? '' : 's'}{d.template.exemption_points ? ` · ${ex} exemption${ex === 1 ? '' : 's'} × ${d.template.exemption_points} pts in the score` : ''}</p>
                {fl.length > 0 && <ul className="mt-1 space-y-0.5 text-text-muted">{fl.map((f) => <li key={f.id}><span className="font-mono">{f.id}</span> {f.requirement ?? ''}{f.approver ? ` → ${f.approver}` : ''}</li>)}</ul>}
              </div>
            ); })()}
            <p className="mt-3 text-xs text-text-subtle">Approval level by score: {d.template.approval_levels.map((l) => `${l.label} from ${l.min}`).join(' · ')}</p>
            {!!d.template.notes?.length && <details className="mt-2 text-xs text-text-muted"><summary className="cursor-pointer">Form notes</summary><ul className="mt-1 space-y-1">{d.template.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>}
            {status === 'draft' && me?.menus.jobs?.edit && (
              <div className="mt-4 space-y-2 border-t border-border pt-3">
                <Field id="jra-to" label="Send to" hint={prog.missing.length ? `Still to answer: ${prog.missing.join(', ')}` : 'Every required question is answered'}>
                  <select id="jra-to" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{(sdms.data ?? []).map((s) => <option key={s.username} value={s.username}>{s.full_name}</option>)}</select>
                </Field>
                <Button variant="primary" className="w-full" disabled={!!prog.missing.length || !to || saveState === 'saving'} onClick={() => act('send', { to })}><Send aria-hidden className="size-4" />Send for approval</Button>
              </div>
            )}
            {mayDecide && (
              <div className="mt-4 space-y-2 border-t border-border pt-3">
                <Button variant="primary" className="w-full" onClick={() => act('decide', { decision: 'approved' })}><ShieldCheck aria-hidden className="size-4" />Approve</Button>
                <Field id="jra-reject" label="Reason for rejecting"><input id="jra-reject" className={inputClass} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} /></Field>
                <Button variant="danger" className="w-full" disabled={!rejectNote.trim()} onClick={() => act('decide', { decision: 'rejected', note: rejectNote })}><X aria-hidden className="size-4" />Reject</Button>
              </div>
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
        <h3 className="font-display text-base font-bold uppercase">JRA briefing</h3>
        <span className="text-sm text-text-muted">Score {score} → {approvalLevel(template, score)}{fl ? ` · ${fl} MOC / exemption${fl === 1 ? '' : 's'}` : ''}</span>
        <span className={cx('label-caps rounded-pill px-2 py-0.5', st === 'approved' ? 'bg-success-subtle text-success' : st === 'sent' ? 'bg-info-subtle text-info' : 'bg-neutral-subtle text-text-muted')}>{STATUS_TEXT[st] ?? st}</span>
        <span className="font-mono text-xs text-text-subtle">{template.code} rev {template.revision}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          {canUpload && <JraUpload jobId={jobId} />}
          <Link className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-semibold text-on-accent hover:bg-accent-hover" to={`/operation/jobs/${jobId}/jra`}>{st === 'none' ? 'Start JRA' : 'Open JRA'}</Link>
        </span>
      </div>
      <p className="mt-1 text-xs text-text-muted">
        {st === 'approved' ? `Approved by ${jra?.decided_by}.` : st === 'sent' ? `Waiting for ${jra?.sent_to}.` : reasons.length ? `This job needs an approved JRA before Execution (${reasons.join(', ')}).` : 'Answer it on screen, or upload the filled Excel form (QHSE’s template). Upload again to update it while it is a draft.'}
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
