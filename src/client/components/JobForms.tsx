import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ClipboardCheck, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { checklistProgress, type FormTemplate } from '../../shared/forms';
import { ANSWER_LABEL, optionsOf, type Answer } from '../../shared/jra';
import type { Stage } from '../../shared/stages';
import { api } from '../api';
import { JraBanner } from '../pages/Jra';
import { Banner, Button, cx, inputClass } from './ui';

// The forms of one job stage (Administration → Form templates): the JRA briefing when the JRA belongs to this
// stage, and each checklist in use for the stage, answered Yes / No / N/A with a remark and marked complete.

type Filled = { template_id: string; answers: Record<string, Answer>; remarks: Record<string, string>; status: 'draft' | 'completed'; completed_by: string | null; completed_at: string | null };
type Data = { jra_stage: Stage; templates: (FormTemplate & { id: string })[]; forms: Filled[] };

export function StageForms({ jobId, stage, canEdit, showJra = true }: { jobId: string; stage: Stage; canEdit: boolean; showJra?: boolean }) {
  const q = useQuery({ queryKey: ['job-forms', jobId], queryFn: () => api<Data>(`/job-forms/${jobId}`) });
  if (!q.data) return null;
  const lists = q.data.templates.filter((t) => t.stage === stage);
  return (
    <>
      {showJra && q.data.jra_stage === stage && <JraBanner jobId={jobId} />}
      {lists.length > 0 && (
        <div className="mb-5 space-y-2">
          {lists.map((t) => <Checklist key={t.id} jobId={jobId} t={t} filled={q.data.forms.find((f) => f.template_id === t.id)} canEdit={canEdit} />)}
        </div>
      )}
    </>
  );
}

function Checklist({ jobId, t, filled, canEdit }: { jobId: string; t: FormTemplate & { id: string }; filled?: Filled; canEdit: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Answer>>(filled?.answers ?? {});
  const [remarks, setRemarks] = useState<Record<string, string>>(filled?.remarks ?? {});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = filled?.status === 'completed';
  const p = checklistProgress(t, answers);
  const locked = !canEdit || done;
  const save = async (status?: 'completed' | 'draft') => {
    setBusy(true); setError(null);
    try {
      await api(`/job-forms/${jobId}/${t.id}`, { method: 'PUT', json: { answers, remarks, status } });
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ['job-forms', jobId] });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const id = `cl-${t.id}`;
  return (
    <div className={cx('rounded-md border', done ? 'border-success' : 'border-border')}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-3 p-3 text-left">
        <ClipboardCheck aria-hidden className={cx('size-4', done ? 'text-success' : 'text-text-muted')} />
        <span className="font-display text-base font-bold uppercase">{t.name}</span>
        <span className="font-mono text-xs text-text-subtle">{t.code} rev {t.revision}</span>
        <span className={cx('label-caps rounded-pill px-2 py-0.5', done ? 'bg-success-subtle text-success' : p.answered ? 'bg-info-subtle text-info' : 'bg-neutral-subtle text-text-muted')}>
          {done ? 'Complete' : p.answered ? 'In progress' : 'Not started'}
        </span>
        <span className="text-sm text-text-muted">{p.answered} of {p.total} answered{done && filled?.completed_by ? ` · completed by ${filled.completed_by}${filled.completed_at ? `, ${new Date(filled.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}` : ''}</span>
        <ChevronDown aria-hidden className={cx('ml-auto size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div id={id} className="border-t border-border p-3">
          {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
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
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              {!done && <Button size="sm" loading={busy} disabled={!dirty} onClick={() => save()}>Save</Button>}
              {!done && <Button size="sm" variant="primary" loading={busy} disabled={p.missing.length > 0} title={p.missing.length ? `Answer ${p.missing.join(', ')} first` : undefined} onClick={() => save('completed')}><Check aria-hidden className="size-3.5" />Mark complete</Button>}
              {done && <Button size="sm" loading={busy} onClick={() => save('draft')}><RotateCcw aria-hidden className="size-3.5" />Reopen</Button>}
              {!done && p.missing.length > 0 && <span className="text-xs text-text-muted">{p.missing.length} required question{p.missing.length === 1 ? '' : 's'} left</span>}
              {dirty && <span className="text-xs text-warning">Not saved yet</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
