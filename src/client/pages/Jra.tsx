import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, Send, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { SignatureBadge } from '../components/Signature';
import { approvalLevel, progress, riskScore, type Answer, type Template } from '../../shared/jra';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, Field, ProgressBar, Skeleton, cx, inputClass } from '../components/ui';

// JRA (S28): answers save as you go while it is a draft; Send for approval needs every required answer;
// the named approver (or an admin or operations manager) approves or rejects.

interface JraData {
  job: { id: string; ticket_no: string | null; well: string | null; sdm: { username: string; full_name: string } | null };
  template: Template;
  jra: { status: 'draft' | 'sent' | 'approved' | 'rejected'; answers: Record<string, Answer>; risk_score: number; approval_level: string | null; sent_to: string | null; sent_at: string | null; decided_by: string | null; decided_at: string | null } | null;
  reasons: string[];
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const OPTIONS: { v: Answer; l: string }[] = [{ v: 'yes', l: 'Yes' }, { v: 'no', l: 'No' }, { v: 'na', l: 'N/A' }];

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
          {sections.map(([key, title]) => (
            <Card key={key}>
              <h2 className="mb-3 font-display text-base font-bold">Section {key} · {title}</h2>
              <ol className="divide-y divide-border">
                {d.template.questions.filter((x) => x.section === key).map((x) => {
                  const a = answers[x.id];
                  const risky = a === x.risk_if;
                  return (
                    <li key={x.id} className="flex flex-wrap items-center gap-3 py-2">
                      <span className="w-8 font-mono text-xs text-text-muted">{x.id}</span>
                      <span className="min-w-0 flex-1 text-sm">{x.text}{!x.required && <span className="ml-1 text-xs text-text-subtle">(optional)</span>}</span>
                      {risky && <span className="inline-flex items-center gap-1 text-xs font-semibold text-warning"><AlertTriangle aria-hidden className="size-3.5" />+{x.points}</span>}
                      <span role="radiogroup" aria-label={`${x.id}: ${x.text}`} className="flex overflow-hidden rounded-md border border-border-strong">
                        {OPTIONS.map((o) => (
                          <button key={o.v} type="button" role="radio" aria-checked={a === o.v} disabled={!canEdit} onClick={() => answer(x.id, o.v)}
                            className={cx('h-8 w-12 text-xs font-semibold disabled:cursor-default', a === o.v ? (o.v === x.risk_if ? 'bg-warning text-on-accent' : 'bg-accent text-on-accent') : 'text-text-muted hover:bg-surface-2')}>{o.l}</button>
                        ))}
                      </span>
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
            <p className="mt-3 text-xs text-text-subtle">Approval level by score: {d.template.approval_levels.map((l) => `${l.label} from ${l.min}`).join(' · ')}</p>
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

/** Banner on the Preparation stage: shows whether the job needs a JRA and where it stands. */
export function JraBanner({ jobId }: { jobId: string }) {
  const q = useQuery({ queryKey: ['jra', jobId], queryFn: () => api<JraData>(`/jra/${jobId}`) });
  if (!q.data) return null;
  const { reasons, jra } = q.data;
  const st = jra?.status ?? 'none';
  if (!reasons.length && st === 'none') return null;
  const tone = st === 'approved' ? 'success' : reasons.length ? 'warning' : 'info';
  const text = st === 'approved' ? `JRA approved by ${jra?.decided_by}` : st === 'sent' ? `JRA waiting for approval by ${jra?.sent_to}` : reasons.length ? `This job needs an approved JRA before Execution (${reasons.join(', ')})` : 'JRA in draft';
  return <div className="mb-4"><Banner tone={tone} action={<Link className="text-sm font-semibold underline" to={`/operation/jobs/${jobId}/jra`}>{st === 'none' ? 'Start JRA' : 'Open JRA'}</Link>}>{text}</Banner></div>;
}

export function useJraLock(jobId: string | undefined) {
  const q = useQuery({ queryKey: ['jra', jobId], queryFn: () => api<JraData>(`/jra/${jobId}`), enabled: !!jobId });
  return !!q.data && q.data.reasons.length > 0 && q.data.jra?.status !== 'approved';
}
