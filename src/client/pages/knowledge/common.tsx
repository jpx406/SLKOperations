import { BookOpen, Download, FileText, Film, Image as ImageIcon, Printer, QrCode, X } from 'lucide-react';
import { useEffect } from 'react';
import { renderSVG } from 'uqr';
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

/** Upload to the draft revision; with `live` (admins, editable version only) it replaces the published revision's file. */
export async function uploadFile(docId: string, file: File, kind: 'published' | 'source', live = false) {
  const ok = checkUpload(file.name, file.size);
  if ('error' in ok) throw new ApiError(400, ok.error, {});
  return api<{ revision: number }>(`/knowledge/${docId}/files?kind=${kind}${live ? '&live=1' : ''}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } });
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

// ---- QR codes ---------------------------------------------------------------------------------------------------

export const docLink = (id: string, fileId?: string) => `${window.location.origin}/knowledge?doc=${id}${fileId ? `&file=${fileId}` : ''}`;
export type SupportBrief = NonNullable<KnowledgeDoc['support']>[number];
const qrSvg = (link: string) => renderSVG(link, { border: 2, ecc: 'M', whiteColor: '#ffffff', blackColor: '#0b121a' });

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** The QR code with its link, and buttons to save it as SVG or PNG or print it as a label. With `file`, it opens that support file. */
export function QrBlock({ doc, file }: { doc: KnowledgeDoc; file?: SupportBrief }) {
  const link = docLink(doc.id, file?.id);
  const svg = qrSvg(link);
  const name = (file ? `${doc.doc_no ?? doc.title} ${file.file_name}` : doc.doc_no ?? doc.title).replace(/[^\w.-]+/g, '_');
  const png = () => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 600;
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 600); g.drawImage(img, 0, 0, 600, 600);
      c.toBlob((b) => b && saveBlob(b, `QR ${name}.png`), 'image/png');
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };
  const print = () => {
    const w = window.open('', '_blank', 'width=420,height=560');
    if (!w) return;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    w.document.write(`<!doctype html><title>QR ${esc(name)}</title><body style="font-family:sans-serif;text-align:center;margin:24px">
      <div style="width:260px;margin:auto">${svg}</div><p style="font-weight:700;margin:8px 0 2px">${esc(doc.doc_no ?? '')}</p><p style="margin:0">${esc(doc.title)}</p>
      ${file ? `<p style="margin:4px 0 0;font-weight:700">${esc(file.file_name)}</p>` : ''}
      <p style="font-size:11px;color:#555">${file ? 'Scan to open this support file' : 'Scan for the published revision'}</p><script>window.onload=()=>{window.print()}</script></body>`);
    w.document.close();
  };
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md border border-border p-3">
      <div className="size-36 shrink-0 rounded-sm bg-white p-1" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm">{file
          ? `Scanning opens “${file.file_name}”, a support file of this document, in SLK Operations Hub (after signing in).`
          : 'Scanning opens this document in SLK Operations Hub, always at its published revision. Print it on toolboxes, in the unit or on paper copies.'}</p>
        <p className="mt-1 break-all font-mono text-xs text-text-muted">{link}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Button size="sm" onClick={() => saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `QR ${name}.svg`)}><Download aria-hidden className="size-3.5" />SVG</Button>
          <Button size="sm" onClick={png}><Download aria-hidden className="size-3.5" />PNG</Button>
          <Button size="sm" onClick={print}><Printer aria-hidden className="size-3.5" />Print label</Button>
        </div>
      </div>
    </div>
  );
}

export function QrDialog({ doc, file, onClose }: { doc: KnowledgeDoc; file?: SupportBrief; onClose: () => void }) {
  return (
    <Dialog title={`QR code · ${file ? file.file_name : doc.doc_no ?? doc.title}`} onClose={onClose}>
      <p className="mb-3 text-sm font-semibold">{doc.title}{file && <span className="block font-normal text-text-muted">Support file: {file.file_name}</span>}</p>
      <QrBlock doc={doc} file={file} />
    </Dialog>
  );
}

// ---- support files listed under a document ---------------------------------------------------------------------

export const supportHref = (docId: string, f: { id: string }, inline = false) => `/api/attachments/knowledge/${docId}/${f.id}${inline ? '?inline=1' : ''}`;
const opensInPage = (type: string) => /^(application\/pdf|image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime))$/.test(type);
const kindIcon = (type: string) => (type.startsWith('image/') ? ImageIcon : type.startsWith('video/') ? Film : FileText);

/** The support files of a document, under it in a list: Read (in the browser), Download and QR, no mind map. */
export function SupportList({ doc, onQr, className }: { doc: KnowledgeDoc; onQr: (doc: KnowledgeDoc, file: SupportBrief) => void; className?: string }) {
  const files = doc.support ?? [];
  if (!files.length) return null;
  return (
    <ul aria-label={`Support files of ${doc.title}`} className={cx('flex min-w-0 max-w-full flex-col gap-1 border-l-2 border-border pl-3', className)}>
      {files.map((f) => {
        const Icon = kindIcon(f.content_type);
        return (
          <li key={f.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <Icon aria-hidden className="size-3.5 shrink-0 text-text-subtle" />
            <span className="min-w-0 flex-1 basis-40 truncate" title={f.file_name}>{f.file_name}</span>
            <span className="text-text-subtle">{f.size_bytes < 1048576 ? `${Math.max(1, Math.round(f.size_bytes / 1024))} KB` : `${(f.size_bytes / 1048576).toFixed(1)} MB`}</span>
            <span className="flex gap-0.5">
              {opensInPage(f.content_type) && <a className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-semibold text-text-muted hover:bg-surface-2 hover:text-text" href={supportHref(doc.id, f, true)} target="_blank" rel="noreferrer" aria-label={`Read ${f.file_name}`}><BookOpen aria-hidden className="size-3" />Read</a>}
              <a className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-semibold text-text-muted hover:bg-surface-2 hover:text-text" href={supportHref(doc.id, f)} download={f.file_name} aria-label={`Download ${f.file_name}`}><Download aria-hidden className="size-3" />Download</a>
              <button type="button" className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-semibold text-text-muted hover:bg-surface-2 hover:text-text" aria-label={`QR code for ${f.file_name}`} onClick={() => onQr(doc, f)}><QrCode aria-hidden className="size-3" />QR</button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** What the list shows beside an entry for staff: a revision being worked on, or a draft never published. */
export function DocState({ d }: { d: KnowledgeDoc }) {
  if (!d.open) return null;
  return <RevPill status={d.open.status}>{d.published_at ? `Rev ${d.open.revision} ` : ''}{REV_STATUS[d.open.status]}{d.open.status === 'draft' && d.open.sent_back_reason ? ', sent back' : ''}</RevPill>;
}
