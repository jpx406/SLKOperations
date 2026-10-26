import { Select } from '../components/Select';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Briefcase, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { QP_COLUMNS, type QpCard, type QpColumn } from '../../shared/quickPlan';
import type { Job, Lookups } from '../../shared/types';
import { ApiError, api, formatDate } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass } from '../components/ui';

// Quick Plan (S25): a card board for jobs that aren't tickets yet. Drag a card between columns (or use the arrows),
// and turn a firm one into a planned job, which opens its Design stage.

export function QuickPlan() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['quick-plan'], queryFn: () => api<{ cards: QpCard[]; canEdit: boolean; canCreateJobs: boolean }>('/quick-plan') });
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<Lookups>('/lookups'), staleTime: 300_000 });
  const [editing, setEditing] = useState<QpCard | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<QpColumn | null>(null);
  const cards = q.data?.cards ?? [];
  const canEdit = !!q.data?.canEdit;
  const refresh = () => qc.invalidateQueries({ queryKey: ['quick-plan'] });
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); } catch (e) { setError((e as ApiError).message); } finally { refresh(); } };
  const move = (c: QpCard, to: QpColumn, index?: number) => act(() => api(`/quick-plan/${c.id}/move`, { method: 'POST', json: { column_key: to, index } }));
  const promote = (c: QpCard) => act(async () => {
    if (!c.target_date && !c.unit_number) throw new ApiError(400, 'Give the card a target date or a unit first, so the job has something to start from.');
    const r = await api<{ job: Job }>('/jobs', { method: 'POST', json: { country: c.country, patch: { ...(c.target_date ? { start_date: c.target_date } : {}), ...(c.unit_number ? { unit_number: c.unit_number } : {}) } } });
    await api(`/quick-plan/${c.id}/promote`, { method: 'POST', json: { job_id: r.job.id } });
    navigate(`/operation/jobs/${r.job.id}/design`);
  });
  const remove = (c: QpCard) => { if (window.confirm(`Remove the card “${c.title}”?`)) void act(() => api(`/quick-plan/${c.id}`, { method: 'DELETE' })); };

  return (
    <section aria-labelledby="qp-title">
      <PageTitle aside={canEdit && <Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />New card</Button>}><span id="qp-title">Quick Plan</span></PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">Sketch jobs before they have a ticket. Move a card right as it firms up; when it’s confirmed, make it a job.</p>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      {q.isLoading && <Skeleton className="h-64" />}
      {q.isSuccess && !cards.length && <EmptyState title="No cards yet">{canEdit ? 'Add one with New card.' : 'Nothing has been sketched for your countries.'}</EmptyState>}
      {cards.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {QP_COLUMNS.map((col, ci) => {
            const list = cards.filter((c) => c.column_key === col.key).sort((a, b) => a.sort - b.sort);
            return (
              <div key={col.key} aria-label={`${col.label} column`} role="region"
                onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(col.key); } }} onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); const c = cards.find((x) => x.id === dragging); setOver(null); setDragging(null); if (c && c.column_key !== col.key) void move(c, col.key); }}
                className={cx('rounded-md border border-border bg-surface-2/40 p-2', over === col.key && 'border-accent-edge')}>
                <h2 className="label-caps mb-2 px-1 text-text-muted">{col.label} <span className="font-mono">{list.length}</span></h2>
                <ul className="space-y-2">
                  {list.map((c) => (
                    <li key={c.id} draggable={canEdit} onDragStart={() => setDragging(c.id)} onDragEnd={() => { setDragging(null); setOver(null); }}>
                      <Card className={cx('p-3', canEdit && 'cursor-grab', dragging === c.id && 'opacity-50')}>
                        <p className="font-semibold">{c.title}</p>
                        <p className="mt-0.5 text-xs text-text-muted">{c.target_date ? formatDate(c.target_date) : 'no date'} · {c.unit_number ?? 'no unit'}{cards.some((x) => x.country !== c.country) && ` · ${c.country}`}</p>
                        {c.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">{c.notes}</p>}
                        {c.promoted_job_id && <p className="mt-2 text-xs"><Briefcase aria-hidden className="mr-1 inline size-3.5" />Job <Link className="font-mono underline" to={`/operation/jobs/${c.promoted_job_id}/design`}>{c.ticket_no ?? 'open'}</Link></p>}
                        {canEdit && (
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            <Button size="sm" variant="ghost" aria-label={`Move ${c.title} left`} disabled={ci === 0} onClick={() => move(c, QP_COLUMNS[ci - 1].key)}><ArrowLeft aria-hidden className="size-3.5" /></Button>
                            <Button size="sm" variant="ghost" aria-label={`Move ${c.title} right`} disabled={ci === QP_COLUMNS.length - 1} onClick={() => move(c, QP_COLUMNS[ci + 1].key)}><ArrowRight aria-hidden className="size-3.5" /></Button>
                            <Button size="sm" variant="ghost" aria-label={`Edit ${c.title}`} onClick={() => setEditing(c)}><Pencil aria-hidden className="size-3.5" /></Button>
                            <Button size="sm" variant="ghost" aria-label={`Remove ${c.title}`} onClick={() => remove(c)}><Trash2 aria-hidden className="size-3.5" /></Button>
                            {!c.promoted_job_id && q.data?.canCreateJobs && <Button size="sm" className="ml-auto" onClick={() => promote(c)}><Briefcase aria-hidden className="size-3.5" />Make it a job</Button>}
                          </div>
                        )}
                      </Card>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      {editing && <CardEditor card={editing === 'new' ? null : editing} units={lookups.data?.units.map((u) => u.unit_number) ?? []} onClose={(changed) => { setEditing(null); if (changed) refresh(); }} />}
    </section>
  );
}

function CardEditor({ card, units, onClose }: { card: QpCard | null; units: string[]; onClose: (changed: boolean) => void }) {
  const { data: me } = useMe();
  const [f, setF] = useState({ country: card?.country ?? me?.countries[0] ?? '', title: card?.title ?? '', notes: card?.notes ?? '', target_date: card?.target_date ?? '', unit_number: card?.unit_number ?? '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const save = async () => {
    try { if (card) await api(`/quick-plan/${card.id}`, { method: 'PUT', json: f }); else await api('/quick-plan', { method: 'POST', json: f }); onClose(true); }
    catch (e) { setError((e as ApiError).message); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="qp-edit" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4">
      <Card className="w-full max-w-lg">
        <div className="mb-3 flex items-start gap-3"><h2 id="qp-edit" className="flex-1 font-display text-lg font-bold">{card ? 'Edit card' : 'New card'}</h2><Button size="sm" variant="ghost" aria-label="Close" onClick={() => onClose(false)}><X aria-hidden className="size-4" /></Button></div>
        {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field id="qp-t" label="Title"><input id="qp-t" className={inputClass} value={f.title} placeholder="Client, well or job" onChange={(e) => setF({ ...f, title: e.target.value })} /></Field></div>
          <Field id="qp-d" label="Target date"><input id="qp-d" type="date" className={inputClass} value={f.target_date} onChange={(e) => setF({ ...f, target_date: e.target.value })} /></Field>
          <Field id="qp-u" label="Unit"><Select id="qp-u" className={inputClass} value={f.unit_number} onChange={(e) => setF({ ...f, unit_number: e.target.value })}><option value="">Not decided</option>{units.map((u) => <option key={u}>{u}</option>)}</Select></Field>
          {!card && (me?.countries.length ?? 0) > 1 && <Field id="qp-c" label="Country"><Select id="qp-c" className={inputClass} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{me?.countries.map((c) => <option key={c}>{c}</option>)}</Select></Field>}
          <div className="sm:col-span-2"><Field id="qp-n" label="Notes"><textarea id="qp-n" rows={3} className={cx(inputClass, 'h-auto py-2')} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
        </div>
        <Button className="mt-4" variant="primary" disabled={!f.title.trim()} onClick={save}>{card ? 'Save' : 'Add card'}</Button>
      </Card>
    </div>
  );
}
