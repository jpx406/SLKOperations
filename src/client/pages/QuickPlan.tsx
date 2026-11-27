import { Select } from '../components/Select';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Briefcase, Paperclip, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { TYPES, checkUpload } from '../../shared/attachments';
import { MAX_SERVICES, QP_COLUMNS, type QpCard, type QpColumn } from '../../shared/quickPlan';
import type { Job } from '../../shared/types';
import { ApiError, api, formatDate } from '../api';
import { useMe } from '../auth';
import { Attachments } from '../components/Attachments';
import { MultiSelect } from '../components/FilterBar';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass } from '../components/ui';
import { Dialog, useConfirm } from '../components/Dialog';

// Opportunities (S25, Quick Plan until 6z.55): a card board for jobs that aren't tickets yet. Drag a card between
// columns (or use the arrows), and turn a firm one into a planned job, which opens its Design stage.

interface Options { services: string[]; clients: string[]; fields: string[]; wells: string[] }
interface Board { cards: QpCard[]; options: Options; canEdit: boolean; canCreateJobs: boolean }

const ACCEPT = Object.keys(TYPES).map((e) => `.${e}`).join(',');
const n = (v: number) => v.toLocaleString('en-US');

export function QuickPlan() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['quick-plan'], queryFn: () => api<Board>('/quick-plan') });
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
    const patch = Object.fromEntries(Object.entries({ start_date: c.target_date, well: c.well, field: c.field, location: c.client }).filter(([, v]) => v));
    if (!Object.keys(patch).length) throw new ApiError(400, 'Give the card a target date, client, field or well first, so the job has something to start from.');
    const r = await api<{ job: Job }>('/jobs', { method: 'POST', json: { country: c.country, patch } });
    // services that aren't WIREGUARD job types are left for the job's Design stage
    if (c.services.length) await api(`/jobs/${r.job.id}/services`, { method: 'PUT', json: { services: c.services } }).catch(() => undefined);
    await api(`/quick-plan/${c.id}/promote`, { method: 'POST', json: { job_id: r.job.id } });
    navigate(`/operation/jobs/${r.job.id}/design`);
  });
  const [ask, confirmDialog] = useConfirm();
  const remove = async (c: QpCard) => { if (await ask({ title: `Remove the card “${c.title}”?`, confirm: 'Remove card', danger: true })) void act(() => api(`/quick-plan/${c.id}`, { method: 'DELETE' })); };

  return (
    <section aria-labelledby="qp-title">
      {confirmDialog}
      <PageTitle aside={canEdit && <Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />New card</Button>}><span id="qp-title">Opportunities</span></PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">Jobs that may come, before they have a ticket. Move a card right as it firms up; when it’s confirmed, make it a job.</p>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      {q.isLoading && <Skeleton className="h-64" />}
      {q.isSuccess && !cards.length && <EmptyState title="No opportunities yet">{canEdit ? 'Add one with New card.' : 'Nothing has been added for your countries.'}</EmptyState>}
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
                  {list.map((c) => {
                    const where = [c.client, c.field, c.well].filter(Boolean).join(' · ');
                    const conditions = [c.temperature_f != null && `${n(c.temperature_f)} °F`, c.pressure_psi != null && `${n(c.pressure_psi)} psi`].filter(Boolean).join(' · ');
                    return (
                      <li key={c.id} draggable={canEdit} onDragStart={() => setDragging(c.id)} onDragEnd={() => { setDragging(null); setOver(null); }}>
                        <Card className={cx('p-3', canEdit && 'cursor-grab', dragging === c.id && 'opacity-50')}>
                          <p className="font-semibold">{c.title}</p>
                          {where && where !== c.title && <p className="mt-0.5 text-sm">{where}</p>}
                          <p className="mt-0.5 text-xs text-text-muted">
                            {c.target_date ? formatDate(c.target_date) : 'No date'}{conditions && ` · ${conditions}`}{cards.some((x) => x.country !== c.country) && ` · ${c.country}`}
                          </p>
                          {c.services.length > 0 && (
                            <ul aria-label="Expected services" className="mt-2 flex flex-wrap gap-1">
                              {c.services.map((s) => <li key={s} className="rounded-pill border border-border px-2 py-0.5 text-xs">{s}</li>)}
                            </ul>
                          )}
                          {c.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-text-muted">{c.notes}</p>}
                          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-subtle">
                            <span>Added by {c.created_by_name ?? c.created_by ?? 'unknown'}</span>
                            {!!c.files && <span><Paperclip aria-hidden className="mr-0.5 inline size-3.5" />{c.files} {c.files === 1 ? 'file' : 'files'}</span>}
                          </p>
                          {c.promoted_job_id && <p className="mt-2 text-xs"><Briefcase aria-hidden className="mr-1 inline size-3.5" />Job <Link className="font-mono underline" to={`/operation/jobs/${c.promoted_job_id}/design`}>{c.ticket_no ?? 'open'}</Link></p>}
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            {canEdit && <>
                              <Button size="sm" variant="ghost" aria-label={`Move ${c.title} left`} disabled={ci === 0} onClick={() => move(c, QP_COLUMNS[ci - 1].key)}><ArrowLeft aria-hidden className="size-3.5" /></Button>
                              <Button size="sm" variant="ghost" aria-label={`Move ${c.title} right`} disabled={ci === QP_COLUMNS.length - 1} onClick={() => move(c, QP_COLUMNS[ci + 1].key)}><ArrowRight aria-hidden className="size-3.5" /></Button>
                            </>}
                            <Button size="sm" variant="ghost" aria-label={canEdit ? `Edit ${c.title}` : `Open ${c.title}`} onClick={() => setEditing(c)}><Pencil aria-hidden className="size-3.5" /></Button>
                            {canEdit && <Button size="sm" variant="ghost" aria-label={`Remove ${c.title}`} onClick={() => void remove(c)}><Trash2 aria-hidden className="size-3.5" /></Button>}
                            {canEdit && !c.promoted_job_id && q.data?.canCreateJobs && <Button size="sm" className="ml-auto" onClick={() => promote(c)}><Briefcase aria-hidden className="size-3.5" />Make it a job</Button>}
                          </div>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      {editing && q.data && <CardEditor card={editing === 'new' ? null : editing} options={q.data.options} canEdit={canEdit} onClose={(changed) => { setEditing(null); if (changed) refresh(); }} />}
    </section>
  );
}

function CardEditor({ card, options, canEdit, onClose }: { card: QpCard | null; options: Options; canEdit: boolean; onClose: (changed: boolean) => void }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [f, setF] = useState({
    country: card?.country ?? me?.countries[0] ?? '', title: card?.title ?? '', notes: card?.notes ?? '', target_date: card?.target_date ?? '',
    services: card?.services ?? [], client: card?.client ?? '', field: card?.field ?? '', well: card?.well ?? '',
    temperature_f: card?.temperature_f != null ? String(card.temperature_f) : '', pressure_psi: card?.pressure_psi != null ? String(card.pressure_psi) : '',
  });
  const [queued, setQueued] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // a client no longer on the list stays pickable on the card that has it
  const clients = f.client && !options.clients.includes(f.client) ? [f.client, ...options.clients] : options.clients;
  const services = [...new Set([...options.services, ...f.services])].map((s) => ({ value: s, label: s }));
  const queue = (list: FileList | null) => {
    const ok: File[] = [];
    const errs: string[] = [];
    for (const file of list ?? []) { const c = checkUpload(file.name, file.size); if ('error' in c) errs.push(c.error); else ok.push(file); }
    setQueued((q) => [...q, ...ok]);
    setError(errs.length ? errs.join(' ') : null);
    if (picker.current) picker.current.value = '';
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      let id = card?.id;
      if (id) await api(`/quick-plan/${id}`, { method: 'PUT', json: f });
      else id = (await api<{ id: string }>('/quick-plan', { method: 'POST', json: f })).id;
      const failed: string[] = [];
      for (const file of queued) {
        try { await api(`/attachments/opportunity/${id}?category=document`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } }); }
        catch (e) { failed.push(`${file.name}: ${(e as ApiError).message}`); }
      }
      if (failed.length) { setQueued([]); setError(`The card was saved, but these files did not upload: ${failed.join('; ')}`); qc.invalidateQueries({ queryKey: ['quick-plan'] }); return; }
      onClose(true);
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  const ro = !canEdit;
  return (
    <Dialog size="lg" onClose={() => onClose(false)} title={<>
      {card ? (ro ? card.title : 'Edit opportunity') : 'New opportunity'}
      {card && <span className="block font-sans text-xs font-normal text-text-muted">Added by {card.created_by_name ?? card.created_by ?? 'unknown'} · {formatDate(card.created_at.slice(0, 10))}</span>}
    </>}>
        {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
        <fieldset disabled={ro || busy} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field id="qp-t" label="Title"><input id="qp-t" autoFocus className={inputClass} value={f.title} placeholder="Left empty, the card is named after its client and well" onChange={(e) => set('title', e.target.value)} /></Field></div>
          <div className="sm:col-span-2">
            <MultiSelect stacked label="Expected services" options={services} value={f.services} emptyText="None picked" clearText="Clear all" noOptionsText="No WIREGUARD job types for your countries yet."
              onChange={(v) => { if (v.length > MAX_SERVICES) setError(`Up to ${MAX_SERVICES} services per card`); else set('services', v); }} />
          </div>
          <Field id="qp-cl" label="Client">
            <Select id="qp-cl" className={inputClass} value={f.client} onChange={(e) => set('client', e.target.value)}><option value="">Not decided</option>{clients.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
          <Field id="qp-f" label="Field"><input id="qp-f" className={inputClass} list="qp-fields" value={f.field} onChange={(e) => set('field', e.target.value)} /></Field>
          <datalist id="qp-fields">{options.fields.map((v) => <option key={v} value={v} />)}</datalist>
          <Field id="qp-w" label="Well"><input id="qp-w" className={inputClass} list="qp-wells" value={f.well} onChange={(e) => set('well', e.target.value)} /></Field>
          <datalist id="qp-wells">{options.wells.map((v) => <option key={v} value={v} />)}</datalist>
          <Field id="qp-d" label="Target date"><input id="qp-d" type="date" className={inputClass} value={f.target_date} onChange={(e) => set('target_date', e.target.value)} /></Field>
          <Field id="qp-tf" label="Temperature (°F)"><input id="qp-tf" inputMode="decimal" className={inputClass} value={f.temperature_f} placeholder="e.g. 245" onChange={(e) => set('temperature_f', e.target.value)} /></Field>
          <Field id="qp-p" label="Pressure (psi)"><input id="qp-p" inputMode="decimal" className={inputClass} value={f.pressure_psi} placeholder="e.g. 3200" onChange={(e) => set('pressure_psi', e.target.value)} /></Field>
          {!card && (me?.countries.length ?? 0) > 1 && <Field id="qp-c" label="Country"><Select id="qp-c" className={inputClass} value={f.country} onChange={(e) => set('country', e.target.value)}>{me?.countries.map((c) => <option key={c}>{c}</option>)}</Select></Field>}
          <div className="sm:col-span-2"><Field id="qp-n" label="Notes"><textarea id="qp-n" rows={3} className={cx(inputClass, 'h-auto py-2')} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
        </fieldset>
        <div className="mt-4">
          {card ? <Attachments entity="opportunity" id={card.id} /> : canEdit && (
            <section aria-label="Attachments">
              <h3 className="label-caps mb-2 text-text-muted">Attachments</h3>
              <input ref={picker} type="file" multiple accept={ACCEPT} className="hidden" aria-label="Files to attach" onChange={(e) => queue(e.target.files)} />
              <Button size="sm" disabled={busy} onClick={() => picker.current?.click()}><Upload aria-hidden className="size-4" />Add files</Button>
              <span className="ml-2 text-xs text-text-muted">They upload when you add the card · up to 25 MB each</span>
              {queued.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {queued.map((file, i) => (
                    <li key={`${file.name}-${i}`} className="flex items-center gap-2 text-sm">
                      <Paperclip aria-hidden className="size-3.5 text-text-muted" /><span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <Button size="sm" variant="ghost" aria-label={`Leave out ${file.name}`} onClick={() => setQueued((q) => q.filter((_, j) => j !== i))}><X aria-hidden className="size-3.5" /></Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
        {canEdit && <Button className="mt-4" variant="primary" loading={busy} disabled={!f.title.trim() && !f.client && !f.well.trim()} onClick={save}>{card ? 'Save' : 'Add card'}</Button>}
    </Dialog>
  );
}
