import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ClipboardCheck, FolderArchive, RotateCcw, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { applies, checklistProgress, type APPLIES_IF, type FormTemplate, type JobFacts } from '../../shared/forms';
import { stampText } from '../../shared/formPdf';
import { ANSWER_LABEL, optionsOf, type Answer } from '../../shared/jra';
import type { Stage } from '../../shared/stages';
import { sizeText } from '../../shared/attachments';
import { api } from '../api';
import { JraBanner } from '../pages/Jra';
import { Banner, Button, cx, inputClass } from './ui';

// The forms of one job stage (Administration → Form templates): the JRA briefing when the JRA belongs to this
// stage, each checklist in use for the stage, and on Closure the job package. A form is filled, marked complete,
// then approved by the SDM, each step stamped with who and when; the approved form is filed as a PDF with the
// job's attachments, and only an admin can reopen it.

type Filled = {
  template_id: string; answers: Record<string, Answer>; remarks: Record<string, string>; status: 'draft' | 'completed';
  completed_by_name: string | null; completed_at: string | null; approved_by_name: string | null; approved_at: string | null;
  reopened_by_name: string | null; reopened_at: string | null;
};
type PkgFile = { id: string; package_item: string; file_name: string; size_bytes: number; uploaded_by: string; uploaded_at: string };
type Tpl = FormTemplate & { id: string };
type Data = {
  jra_stage: Stage; templates: Tpl[]; forms: Filled[]; can_approve: boolean; can_reopen: boolean;
  package: { template: Tpl; folder: { month: string; name: string; path: string }; facts: JobFacts; applies_labels: typeof APPLIES_IF; files: PkgFile[] } | null;
};

const useJobForms = (jobId: string) => useQuery({ queryKey: ['job-forms', jobId], queryFn: () => api<Data>(`/job-forms/${jobId}`) });

export function StageForms({ jobId, stage, canEdit, showJra = true }: { jobId: string; stage: Stage; canEdit: boolean; showJra?: boolean }) {
  const q = useJobForms(jobId);
  if (!q.data) return null;
  const lists = q.data.templates.filter((t) => t.stage === stage);
  return (
    <>
      {showJra && q.data.jra_stage === stage && <JraBanner jobId={jobId} />}
      {lists.length > 0 && (
        <div className="mb-5 space-y-2">
          {lists.map((t) => <Checklist key={t.id} jobId={jobId} t={t} filled={q.data.forms.find((f) => f.template_id === t.id)} canEdit={canEdit} canApprove={q.data.can_approve} canReopen={q.data.can_reopen} />)}
        </div>
      )}
    </>
  );
}

/** Where a form stands, with the time of each step. */
function Steps({ f }: { f?: Filled }) {
  if (!f) return null;
  const parts = [
    f.completed_at && `Completed by ${f.completed_by_name} · ${stampText(f.completed_at)}`,
    f.approved_at && `Approved by ${f.approved_by_name} · ${stampText(f.approved_at)}`,
    !f.completed_at && f.reopened_at && `Reopened by ${f.reopened_by_name} · ${stampText(f.reopened_at)}`,
  ].filter(Boolean);
  return parts.length ? <p className="text-xs text-text-muted">{parts.join('  ·  ')}</p> : null;
}

function StatePill({ f, answered }: { f?: Filled; answered: boolean }) {
  const s = f?.approved_at ? ['Approved', 'bg-success-subtle text-success'] : f?.status === 'completed' ? ['Waiting for SDM approval', 'bg-warning-subtle text-warning'] : answered ? ['In progress', 'bg-info-subtle text-info'] : ['Not started', 'bg-neutral-subtle text-text-muted'];
  return <span className={cx('label-caps rounded-pill px-2 py-0.5', s[1])}>{s[0]}</span>;
}

/** Complete → Approve → (admin) Reopen, shared by checklists and the package. */
function Actions({ f, canEdit, canApprove, canReopen, busy, ready, missing, onAct }: {
  f?: Filled; canEdit: boolean; canApprove: boolean; canReopen: boolean; busy: boolean; ready: boolean; missing: string; onAct: (a: 'complete' | 'approve' | 'reopen') => void;
}) {
  const done = f?.status === 'completed';
  return (
    <>
      {!done && canEdit && <Button size="sm" variant="primary" loading={busy} disabled={!ready} title={ready ? undefined : missing} onClick={() => onAct('complete')}><Check aria-hidden className="size-3.5" />Mark complete</Button>}
      {done && !f?.approved_at && (canApprove
        ? <Button size="sm" variant="primary" loading={busy} onClick={() => onAct('approve')}><ShieldCheck aria-hidden className="size-3.5" />Approve as SDM</Button>
        : <span className="text-xs text-text-muted">Waiting for the SDM to approve it</span>)}
      {done && canReopen && <Button size="sm" loading={busy} onClick={() => { if (confirm('Reopen this form? Its approval is cleared and the change is kept in the audit trail.')) onAct('reopen'); }}><RotateCcw aria-hidden className="size-3.5" />Reopen (admin)</Button>}
      {!done && !ready && <span className="text-xs text-text-muted">{missing}</span>}
    </>
  );
}

function Checklist({ jobId, t, filled, canEdit, canApprove, canReopen }: { jobId: string; t: Tpl; filled?: Filled; canEdit: boolean; canApprove: boolean; canReopen: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Answer>>(filled?.answers ?? {});
  const [remarks, setRemarks] = useState<Record<string, string>>(filled?.remarks ?? {});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const done = filled?.status === 'completed';
  const p = checklistProgress(t, answers);
  const locked = !canEdit || done;
  const act = async (action?: 'complete' | 'approve' | 'reopen') => {
    setBusy(true); setError(null); setNote(null);
    try {
      const r = await api<{ pdf?: string | null; pdf_error?: string }>(`/job-forms/${jobId}/${t.id}`, { method: 'PUT', json: action === 'approve' || action === 'reopen' ? { action } : { answers, remarks, action } });
      setDirty(false);
      if (action === 'approve') setNote(r.pdf ? `Approved. ${r.pdf} is filed in the job’s attachments.` : `Approved. The PDF could not be filed: ${r.pdf_error}`);
      await qc.invalidateQueries({ queryKey: ['job-forms', jobId] });
      qc.invalidateQueries({ queryKey: ['attachments'] });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const id = `cl-${t.id}`;
  return (
    <div className={cx('rounded-md border', filled?.approved_at ? 'border-success' : done ? 'border-warning' : 'border-border')}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-3 p-3 text-left">
        <ClipboardCheck aria-hidden className={cx('size-4', filled?.approved_at ? 'text-success' : 'text-text-muted')} />
        <span className="font-display text-base font-bold uppercase">{t.name}</span>
        <span className="font-mono text-xs text-text-subtle">{t.code} rev {t.revision}</span>
        <StatePill f={filled} answered={p.answered > 0} />
        <span className="text-sm text-text-muted">{p.answered} of {p.total} answered</span>
        <ChevronDown aria-hidden className={cx('ml-auto size-4 transition-transform', open && 'rotate-180')} />
        <span className="basis-full pl-7"><Steps f={filled} /></span>
      </button>
      {open && (
        <div id={id} className="border-t border-border p-3">
          {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
          {note && <div className="mb-3"><Banner tone="success">{note}</Banner></div>}
          {Object.entries(t.sections).filter(([k]) => t.questions.some((x) => x.section === k)).map(([k, label]) => (
            <fieldset key={k} className="mb-4">
              <legend className="label-caps mb-2 text-text-muted">{k} · {label}</legend>
              <ol className="space-y-2">
                {t.questions.filter((x) => x.section === k).map((x) => (
                  <li key={x.id} className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,16rem)] md:items-center">
                    <p className="text-sm"><span className="mr-2 font-mono text-xs text-text-subtle">{x.id}</span>{x.text}{x.required && <span aria-hidden className="text-danger"> *</span>}
                      {x.guidance && <span className="block text-xs text-text-subtle">{x.guidance}</span>}</p>
                    <span role="radiogroup" aria-label={`${x.id} answer`} className="flex gap-1">
                      {optionsOf(x).map((a) => (
                        <button key={a} type="button" role="radio" aria-checked={answers[x.id] === a} disabled={locked}
                          onClick={() => { const n = { ...answers }; if (n[x.id] === a) delete n[x.id]; else n[x.id] = a; setAnswers(n); setDirty(true); }}
                          className={cx('h-(--layout-control-sm) min-w-12 rounded-sm border px-2 text-xs font-semibold disabled:cursor-default',
                            answers[x.id] === a ? (a === 'yes' ? 'border-success bg-success-subtle text-success' : a === 'no' ? 'border-danger bg-danger-subtle text-danger' : 'border-border-strong bg-surface-2') : 'border-border text-text-muted hover:text-text')}>
                          {ANSWER_LABEL[a]}
                        </button>
                      ))}
                    </span>
                    <input aria-label={`${x.id} remark`} className={cx(inputClass, 'h-(--layout-control-sm)')} disabled={locked} placeholder="Remark" value={remarks[x.id] ?? ''}
                      onChange={(e) => { setRemarks({ ...remarks, [x.id]: e.target.value }); setDirty(true); }} />
                  </li>
                ))}
              </ol>
            </fieldset>
          ))}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {!done && canEdit && <Button size="sm" loading={busy} disabled={!dirty} onClick={() => act()}>Save</Button>}
            <Actions f={filled} canEdit={canEdit} canApprove={canApprove} canReopen={canReopen} busy={busy} ready={!p.missing.length}
              missing={`${p.missing.length} required question${p.missing.length === 1 ? '' : 's'} left`} onAct={act} />
            {dirty && <span className="text-xs text-warning">Not saved yet</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Closure → Job package: the documents the package must hold, each uploaded into the job's own R2 folder
 * (job-packages/<YYYY-MM>/<Rig-Well-Date>/). The job can be completed only once every document that applies is
 * uploaded and the SDM has approved the package.
 */
export function JobPackage({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  const q = useJobForms(jobId);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  if (!q.data) return null;
  if (!q.data.package) return <p className="text-sm text-text-muted">No job package template is in use for this country (Administration → Form templates).</p>;
  const { template: t, folder, facts, files, applies_labels } = q.data.package;
  const f = q.data.forms.find((x) => x.template_id === t.id);
  const done = f?.status === 'completed';
  const of = (item: string) => files.filter((x) => x.package_item === item);
  const needed = t.questions.filter((x) => x.required && applies(x, facts));
  const missing = needed.filter((x) => !of(x.id).length);
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ['job-forms', jobId] }); qc.invalidateQueries({ queryKey: ['attachments'] }); };
  const upload = async (item: string, list: FileList) => {
    setBusy(item); setError(null);
    try {
      for (const x of Array.from(list)) await api(`/job-forms/${jobId}/${t.id}/files/${item}`, { method: 'POST', body: x, headers: { 'Content-Type': x.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(x.name) } });
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); if (file.current) file.current.value = ''; }
  };
  const remove = async (x: PkgFile) => {
    setBusy(x.id); setError(null);
    try { await api(`/job-forms/${jobId}/${t.id}/files/${x.id}`, { method: 'DELETE' }); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const act = async (action: 'complete' | 'approve' | 'reopen') => {
    setBusy('act'); setError(null); setNote(null);
    try {
      const r = await api<{ pdf?: string | null; pdf_error?: string }>(`/job-forms/${jobId}/${t.id}`, { method: 'PUT', json: { action } });
      if (action === 'approve') setNote(r.pdf ? `Approved. The contents list (${r.pdf}) is filed in the package folder and the job’s attachments. The job can now be completed.` : `Approved. The PDF could not be filed: ${r.pdf_error}`);
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <FolderArchive aria-hidden className="size-4 text-text-muted" />
        <span className="font-mono text-xs break-all text-text-muted">{folder.path}/</span>
        <StatePill f={f} answered={files.length > 0} />
        <span className="text-sm text-text-muted">{needed.length - missing.length} of {needed.length} required documents</span>
      </div>
      <Steps f={f} />
      {error && <div className="my-3"><Banner tone="danger">{error}</Banner></div>}
      {note && <div className="my-3"><Banner tone="success">{note}</Banner></div>}
      <input ref={file} type="file" multiple className="sr-only" tabIndex={-1} onChange={(e) => { if (target && e.target.files?.length) upload(target, e.target.files); }} />
      {Object.entries(t.sections).filter(([k]) => t.questions.some((x) => x.section === k)).map(([k, label]) => (
        <fieldset key={k} className="mt-4">
          <legend className="label-caps mb-2 text-text-muted">{k} · {label}</legend>
          <ul className="space-y-1.5">
            {t.questions.filter((x) => x.section === k).map((x) => {
              const on = applies(x, facts);
              const list = of(x.id);
              return (
                <li key={x.id} className={cx('rounded-md border p-2.5', !on ? 'border-dashed border-border opacity-60' : list.length ? 'border-success/60' : x.required ? 'border-warning/60' : 'border-border')}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-text-subtle">{x.id}</span>
                    <span className="min-w-0 flex-1 text-sm">{x.text}{on && x.required && <span aria-hidden className="text-danger"> *</span>}
                      {x.guidance && <span className="block text-xs text-text-subtle">{x.guidance}</span>}</span>
                    {!on ? <span className="text-xs text-text-muted">Not needed on this job (only with: {applies_labels[x.applies_if as keyof typeof applies_labels]?.toLowerCase()})</span>
                      : list.length ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-success"><Check aria-hidden className="size-3.5" />{list.length} file{list.length === 1 ? '' : 's'}</span>
                        : <span className="text-xs font-semibold text-warning">{x.required ? 'Missing' : 'Optional'}</span>}
                    {canEdit && !done && on && <Button size="sm" loading={busy === x.id} onClick={() => { setTarget(x.id); file.current?.click(); }}><Upload aria-hidden className="size-3.5" />Upload</Button>}
                  </div>
                  {list.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 pl-6">
                      {list.map((y) => (
                        <li key={y.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <a className="font-semibold text-accent-text hover:underline" href={`/api/attachments/job/${jobId}/${y.id}?inline=1`} target="_blank" rel="noreferrer">{y.file_name}</a>
                          <span className="text-text-muted">{sizeText(y.size_bytes)} · {y.uploaded_by} · {stampText(y.uploaded_at)}</span>
                          {canEdit && !done && <Button size="sm" variant="ghost" aria-label={`Remove ${y.file_name}`} loading={busy === y.id} onClick={() => remove(y)}><Trash2 aria-hidden className="size-3.5" /></Button>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Actions f={f} canEdit={canEdit} canApprove={q.data.can_approve} canReopen={q.data.can_reopen} busy={busy === 'act'} ready={!missing.length}
          missing={`Still to upload: ${missing.map((x) => x.id).join(', ')}`} onAct={act} />
      </div>
    </div>
  );
}
