import { X } from 'lucide-react';
import { useEffect } from 'react';
import { TYPES, checkUpload } from '../../../shared/attachments';
import type { KbFile, KnowledgeDoc } from '../../../shared/knowledge';
import { REV_STATUS, type Controller, type Numbering, type RevStatus } from '../../../shared/knowledgeControl';
import { ApiError, api } from '../../api';
import { Button, Card, cx } from '../../components/ui';

// Pieces shared by the Knowledge Hub screens (6z.14).

export interface Person { username: string; full_name: string; can_review: number; can_approve: number }
export interface Library {
  docs: KnowledgeDoc[]; canEdit: boolean; isAdmin: boolean; me: Controller; places: string[]; clients: string[]; numbering: Numbering; people: Person[]; queueCount: number;
}
export interface FileRow extends KbFile { kind: 'published' | 'source'; superseded_at: string | null; change_note: string | null }

export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
export const fileUrl = (docId: string, f: { id: string }, inline = false) => `/api/knowledge/${docId}/files/${f.id}${inline ? '?inline=1' : ''}`;
export const ACCEPT = Object.keys(TYPES).map((e) => `.${e}`).join(',');
export const EDITABLE_ACCEPT = '.doc,.docx,.xls,.xlsx,.xlsm,.ppt,.pptx,.txt,.csv,.zip';
export const linkBtn = 'inline-flex h-(--layout-control-sm) items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-semibold text-text hover:bg-surface-2';
export const isEditable = (name: string) => /\.(docx?|xlsx?|xlsm|pptx?|txt|csv|zip)$/i.test(name);

export async function uploadFile(docId: string, file: File, kind: 'published' | 'source') {
  const ok = checkUpload(file.name, file.size);
  if ('error' in ok) throw new ApiError(400, ok.error, {});
  return api<{ revision: number }>(`/knowledge/${docId}/files?kind=${kind}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } });
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4">
      <Card className={cx('max-h-[90vh] w-full overflow-y-auto', wide ? 'max-w-3xl' : 'max-w-xl')}>
        <div className="mb-3 flex items-start gap-3"><h2 className="min-w-0 flex-1 font-display text-lg font-bold">{title}</h2><Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}><X aria-hidden className="size-4" /></Button></div>
        {children}
      </Card>
    </div>
  );
}

const TONE: Record<RevStatus | 'unpublished', string> = {
  draft: 'border-border text-text-muted', review: 'border-warning text-warning', approval: 'border-warning text-warning', approved: 'border-success text-success',
  superseded: 'border-border text-text-subtle', discarded: 'border-border text-text-subtle', unpublished: 'border-border text-text-muted',
};

/** A small status label: Draft, In review, Awaiting approval, Published, Superseded. */
export function RevPill({ status, children }: { status: RevStatus; children?: React.ReactNode }) {
  return <span className={cx('label-caps inline-flex items-center rounded-xs border px-1.5 whitespace-nowrap', TONE[status])}>{children ?? REV_STATUS[status]}</span>;
}

/** What the list shows beside an entry for staff: a revision being worked on, or a draft never published. */
export function DocState({ d }: { d: KnowledgeDoc }) {
  if (!d.open) return null;
  return <RevPill status={d.open.status}>{d.published_at ? `Rev ${d.open.revision} ` : ''}{REV_STATUS[d.open.status]}{d.open.status === 'draft' && d.open.sent_back_reason ? ', sent back' : ''}</RevPill>;
}
