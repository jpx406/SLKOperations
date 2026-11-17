import { Select } from '../../components/Select';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CornerUpLeft, Download, Eye, FilePlus2, Send, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { INLINE, sizeText } from '../../../shared/attachments';
import type { KnowledgeDoc } from '../../../shared/knowledge';
import { type Controller, type FlowAction, type Revision } from '../../../shared/knowledgeControl';
import { ApiError, api, formatDate } from '../../api';
import { Banner, Button, Field, Skeleton, cx, inputClass } from '../../components/ui';
import { ACCEPT, EDITABLE_ACCEPT, RevPill, fileUrl, linkBtn, today, uploadFile, type FileRow, type Person } from './common';

// The document's revisions (6z.14): the published one with its files, the one being worked on with the
// review and approval steps, and the history. Each step is offered only to the person who may take it.

interface Rev extends Revision { files: FileRow[]; can: Record<FlowAction, boolean>; problems: string[] }
interface Data { me: Controller; live: number | null; storage: boolean; mayRetire: boolean; revisions: Rev[] }

const when = (iso: string | null) => (iso ? formatDate(iso.slice(0, 10)) : '');

export function Revisions({ doc, people, onChange }: { doc: KnowledgeDoc; people: Person[]; onChange: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['knowledge-revs', doc.id], queryFn: () => api<Data>(`/knowledge/${doc.id}/revisions`) });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const [starting, setStarting] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['knowledge-revs', doc.id] }); onChange(); };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); refresh(); } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  if (q.isLoading) return <Skeleton className="mt-4 h-24" />;
  if (q.isError) return <div className="mt-4"><Banner tone="danger">{q.error.message}</Banner></div>;
  const d = q.data!;
  const live = d.revisions.find((r) => r.status === 'approved');
  const open = d.revisions.find((r) => r.status === 'draft' || r.status === 'review' || r.status === 'approval');
  const past = d.revisions.filter((r) => r.status === 'superseded');
  const staffSees = d.me.admin || d.me.editor || d.me.reviewer || d.me.approver;

  return (
    <div className="mt-4 flex flex-col gap-3">
      {error && <Banner tone="danger">{error}</Banner>}
      <section className="rounded-md border border-border p-3" aria-label="Published revision">
        <h3 className="flex flex-wrap items-center gap-2 font-display text-sm font-bold">Published{live && <> · Rev {live.revision}</>}{live && <RevPill status="approved" />}</h3>
        {!live && <p className="mt-1 text-sm text-text-muted">Not published yet. Readers see it once it is approved.</p>}
        {live && <RevMeta r={live} />}
        {live && <FileList doc={doc} files={live.files} />}
        {live && !live.files.length && <p className="mt-1 text-sm text-text-muted">No file with this revision.</p>}
        {live && !open && (d.me.admin || d.me.editor) && !starting && (
          <Button size="sm" className="mt-2" onClick={() => setStarting(true)}><FilePlus2 aria-hidden className="size-3.5" />Start Rev {live.revision + 1}</Button>
        )}
        {starting && <StartRevision doc={doc} current={live?.revision ?? 0} busy={busy} onCancel={() => setStarting(false)}
          onStart={(body) => run(async () => { await api(`/knowledge/${doc.id}/revisions`, { method: 'POST', json: body }); setStarting(false); })} />}
      </section>

      {open && staffSees && <OpenRevision doc={doc} r={open} people={people} me={d.me} busy={busy} storage={d.storage} run={run} />}

      {past.length > 0 && (
        <section aria-label="Revision history">
          <Button size="sm" variant="ghost" onClick={() => setHistory(!history)}>{history ? 'Hide' : 'Show'} revision history ({past.length})</Button>
          {history && (
            <ul className="mt-1 divide-y divide-border rounded-md border border-border">
              {past.map((r) => (
                <li key={r.id} className="px-3 py-2">
                  <p className="flex items-center gap-2 text-sm font-semibold">Rev {r.revision} <RevPill status="superseded" /></p>
                  <RevMeta r={r} />
                  <FileList doc={doc} files={r.files} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function RevMeta({ r }: { r: Rev }) {
  const steps = [
    r.change_note && `What changed: ${r.change_note}`,
    r.author && `Author ${r.author}`,
    r.revision_date && `Revision date ${formatDate(r.revision_date)}`,
    r.expires_on && `Expires ${formatDate(r.expires_on)}`,
  ].filter(Boolean);
  const trail = [
    r.submitted_at && `Sent for review by ${r.submitted_by_name} ${when(r.submitted_at)}`,
    r.reviewed_at && `Reviewed by ${r.reviewer_name} ${when(r.reviewed_at)}${r.review_comment ? `: ${r.review_comment}` : ''}`,
    r.approved_at && `Approved by ${r.approver_name} ${when(r.approved_at)}${r.approve_comment ? `: ${r.approve_comment}` : ''}`,
  ].filter(Boolean);
  return (
    <div className="mt-1 text-xs text-text-muted">
      {steps.length > 0 && <p>{steps.join(' · ')}</p>}
      {trail.length > 0 && <p>{trail.join(' · ')}</p>}
    </div>
  );
}

function FileList({ doc, files }: { doc: KnowledgeDoc; files: FileRow[] }) {
  if (!files.length) return null;
  return (
    <ul className="mt-2 divide-y divide-border">
      {[...files].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'published' ? -1 : 1)).map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
          <div className="min-w-0 flex-1 basis-48">
            <p className="label-caps text-text-muted">{f.kind === 'published' ? 'Document' : doc.is_form ? 'Fillable form' : 'Editable version'}</p>
            <p className="truncate text-sm font-semibold">{f.file_name}</p>
            <p className="text-xs text-text-subtle">{sizeText(f.size_bytes)} · {f.uploaded_by_name} · {when(f.uploaded_at)}</p>
          </div>
          <div className="flex gap-1">
            {INLINE.has(f.content_type) && <a className={linkBtn} href={fileUrl(doc.id, f, true)} target="_blank" rel="noreferrer"><Eye aria-hidden className="size-3.5" />View</a>}
            <a className={linkBtn} href={fileUrl(doc.id, f)} download={f.file_name}><Download aria-hidden className="size-3.5" />Download</a>
          </div>
        </li>
      ))}
    </ul>
  );
}

function StartRevision({ doc, current, busy, onStart, onCancel }: { doc: KnowledgeDoc; current: number; busy: boolean; onStart: (b: Record<string, string>) => void; onCancel: () => void }) {
  const [f, setF] = useState({ change_note: '', revision: String(current + 1), author: doc.author ?? '', revision_date: today(), expires_on: '' });
  const input = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <Field id={`ns-${k}`} label={label}><input id={`ns-${k}`} className={inputClass} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></Field>
  );
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 rounded-md bg-surface-2 p-3 sm:grid-cols-2">
      <p className="text-sm sm:col-span-2">Rev {current} stays published until the new revision is approved.</p>
      <div className="sm:col-span-2">{input('change_note', 'What changes', { placeholder: 'e.g. Added the jar check before rig down' })}</div>
      {input('revision', 'Revision', { type: 'number', min: current + 1 })}
      {input('author', 'Author')}
      {input('revision_date', 'Revision date', { type: 'date' })}
      {input('expires_on', 'Expires (blank: the usual period)', { type: 'date' })}
      <div className="flex gap-2 sm:col-span-2">
        <Button variant="primary" loading={busy} disabled={!f.change_note.trim()} onClick={() => onStart(f)}>Start the revision</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function OpenRevision({ doc, r, people, me, busy, storage, run }: { doc: KnowledgeDoc; r: Rev; people: Person[]; me: Controller; busy: boolean; storage: boolean; run: (fn: () => Promise<unknown>) => void }) {
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [backing, setBacking] = useState(false);
  const notMe = (p: Person) => me.admin || p.username.toLowerCase() !== me.username.toLowerCase();
  const reviewers = people.filter((p) => p.can_review && notMe(p));
  const approvers = people.filter((p) => p.can_approve && (me.admin || p.username.toLowerCase() !== (r.submitted_by ?? '').toLowerCase()));
  const [reviewer, setReviewer] = useState(r.reviewer ?? '');
  const [approver, setApprover] = useState(r.approver ?? '');
  const step = (s: string, body: Record<string, string> = {}) => run(() => api(`/knowledge/${doc.id}/revisions/${r.revision}/${s}`, { method: 'POST', json: body }));
  const doc_ = r.files.find((f) => f.kind === 'published');
  const source = r.files.find((f) => f.kind === 'source');
  const upload = (file: File | undefined, kind: 'published' | 'source') => file && run(() => uploadFile(doc.id, file, kind));

  return (
    <section className={cx('rounded-md border p-3', r.status === 'draft' ? 'border-border' : 'border-warning')} aria-label={`Rev ${r.revision}`}>
      <h3 className="flex flex-wrap items-center gap-2 font-display text-sm font-bold">Rev {r.revision} <RevPill status={r.status} />
        {r.status === 'review' && <span className="text-xs font-normal text-text-muted">with {r.reviewer_name}</span>}
        {r.status === 'approval' && <span className="text-xs font-normal text-text-muted">with {r.approver_name}</span>}
      </h3>
      {r.status === 'draft' && r.sent_back_reason && <div className="mt-2"><Banner tone="warning">Sent back {when(r.sent_back_at)}: {r.sent_back_reason}</Banner></div>}
      <RevMeta r={r} />
      <FileList doc={doc} files={r.files} />

      {r.can.edit_files && storage && (
        <div className="mt-2 flex flex-wrap gap-2">
          <label className={cx(linkBtn, 'cursor-pointer')}><Upload aria-hidden className="size-3.5" />{doc_ ? 'Replace the document' : doc.section === 'form' ? 'Add the form (any format)' : 'Add the document (PDF)'}
            <input type="file" accept={doc.is_form || doc.section === 'form' ? ACCEPT : '.pdf'} className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files?.[0], 'published')} /></label>
          <label className={cx(linkBtn, 'cursor-pointer')}><Upload aria-hidden className="size-3.5" />{source ? 'Replace' : 'Add'} the {doc.is_form ? 'fillable form' : 'editable version'}
            <input type="file" accept={EDITABLE_ACCEPT} className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files?.[0], 'source')} /></label>
        </div>
      )}

      {r.can.submit && (
        <div className="mt-3 rounded-md bg-surface-2 p-3">
          {r.problems.length > 0 && <ul className="mb-2 list-disc pl-5 text-sm text-warning">{r.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <Field id="kr-reviewer" label="Reviewer" hint={reviewers.length ? undefined : 'No reviewers yet: an admin picks them in Settings'}>
            <Select id="kr-reviewer" className={inputClass} value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
              <option value="">Pick the reviewer</option>{reviewers.map((p) => <option key={p.username} value={p.username}>{p.full_name}</option>)}
            </Select>
          </Field>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="primary" loading={busy} disabled={!reviewer || r.problems.length > 0} onClick={() => step('submit', { reviewer })}><Send aria-hidden className="size-4" />Send for review</Button>
            {r.can.discard && doc.published_at && <Button variant="ghost" onClick={() => step('discard')}><Trash2 aria-hidden className="size-4" />Discard this draft</Button>}
          </div>
        </div>
      )}

      {(r.can.review || r.can.approve) && (
        <div className="mt-3 rounded-md bg-surface-2 p-3">
          <Field id="kr-comment" label="Comment (optional)"><input id="kr-comment" className={inputClass} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
          {r.can.review && (
            <Field id="kr-approver" label="Approver">
              <Select id="kr-approver" className={inputClass} value={approver} onChange={(e) => setApprover(e.target.value)}>
                <option value="">Pick the approver</option>{approvers.map((p) => <option key={p.username} value={p.username}>{p.full_name}</option>)}
              </Select>
            </Field>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {r.can.review && <Button variant="primary" loading={busy} disabled={!approver} onClick={() => step('review', { approver, comment })}><Check aria-hidden className="size-4" />Pass the review</Button>}
            {r.can.approve && <Button variant="primary" loading={busy} onClick={() => step('approve', { comment })}><Check aria-hidden className="size-4" />Approve and publish</Button>}
            <Button variant="secondary" onClick={() => setBacking(!backing)}><CornerUpLeft aria-hidden className="size-4" />Send back</Button>
          </div>
        </div>
      )}
      {!r.can.review && !r.can.approve && r.can.send_back && <Button className="mt-2" variant="secondary" onClick={() => setBacking(!backing)}><CornerUpLeft aria-hidden className="size-4" />Send back</Button>}
      {backing && (
        <div className="mt-2 rounded-md bg-surface-2 p-3">
          <Field id="kr-reason" label="Why it goes back"><input id="kr-reason" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Button className="mt-2" variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => { step('send-back', { reason }); setBacking(false); }}>Send back to the author</Button>
        </div>
      )}
    </section>
  );
}
