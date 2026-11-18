import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Eye, Film, Image as ImageIcon, Paperclip, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { INLINE, TYPES, VIDEO, checkUpload, sizeText, type Category } from '../../../shared/attachments';
import { ApiError, api, formatDate } from '../../api';
import { Banner, Button, cx } from '../../components/ui';

// Support files of a Knowledge Hub entry (6z.17): pictures, videos and documents kept below the document, for
// everyone to view and download. Editors add and remove them. Stored as the entry's attachments in R2.

export interface SupportFile { id: string; category: Category; file_name: string; content_type: string; size_bytes: number; uploaded_by_name: string; uploaded_at: string }
interface Data { files: SupportFile[]; canEdit: boolean; storage: boolean }

const ACCEPT = Object.keys(TYPES).map((e) => `.${e}`).join(',');
export const supportUrl = (docId: string, f: { id: string }, inline = false) => `/api/attachments/knowledge/${docId}/${f.id}${inline ? '?inline=1' : ''}`;
const isPicture = (f: SupportFile) => f.content_type.startsWith('image/') && INLINE.has(f.content_type);
const isVideo = (f: SupportFile) => VIDEO.has(f.content_type);
// videos are kept as 'other' (the attachments table's categories predate them); the gallery groups by file type anyway
const categoryFor = (type: string): Category => (type.startsWith('image/') ? 'photo' : VIDEO.has(type) ? 'other' : 'document');

export function useSupport(docId: string) {
  return useQuery({ queryKey: ['attachments', 'knowledge', docId], queryFn: () => api<Data>(`/attachments/knowledge/${encodeURIComponent(docId)}`) });
}

/** The pictures of an entry, oldest first, for its slides. */
export function usePictures(docId: string) {
  const q = useSupport(docId);
  return (q.data?.files ?? []).filter(isPicture).sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at));
}

export function SupportFiles({ docId }: { docId: string }) {
  const qc = useQueryClient();
  const q = useSupport(docId);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const files = q.data?.files ?? [];
  const canEdit = !!q.data?.canEdit && !!q.data?.storage;
  const pictures = files.filter(isPicture), videos = files.filter(isVideo), others = files.filter((f) => !isPicture(f) && !isVideo(f));
  const refresh = () => qc.invalidateQueries({ queryKey: ['attachments', 'knowledge', docId] });

  const upload = async (list: FileList | File[] | null) => {
    const errs: string[] = [];
    for (const f of [...(list ?? [])]) {
      const ok = checkUpload(f.name, f.size);
      if ('error' in ok) { errs.push(ok.error); continue; }
      setBusy(f.name);
      try { await api(`/attachments/knowledge/${encodeURIComponent(docId)}?category=${categoryFor(ok.type)}`, { method: 'POST', body: f, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) } }); }
      catch (e) { errs.push(`${f.name}: ${(e as ApiError).message}`); }
    }
    setBusy(null); setErrors(errs);
    if (input.current) input.current.value = '';
    refresh();
  };
  const remove = async (f: SupportFile) => {
    if (!window.confirm(`Remove “${f.file_name}”? It is hidden; the audit log keeps a record.`)) return;
    try { await api(`/attachments/knowledge/${encodeURIComponent(docId)}/${f.id}`, { method: 'DELETE' }); refresh(); }
    catch (e) { setErrors([(e as ApiError).message]); }
  };
  const meta = (f: SupportFile) => `${sizeText(f.size_bytes)} · ${f.uploaded_by_name} · ${formatDate(f.uploaded_at.slice(0, 10))}`;
  const actions = (f: SupportFile) => (
    <span className="flex gap-1">
      {INLINE.has(f.content_type) && !isPicture(f) && !isVideo(f) && <a className="inline-flex h-(--layout-control-sm) items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-muted hover:bg-surface-2 hover:text-text" href={supportUrl(docId, f, true)} target="_blank" rel="noreferrer"><Eye aria-hidden className="size-3.5" />View</a>}
      <a className="inline-flex h-(--layout-control-sm) items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-muted hover:bg-surface-2 hover:text-text" href={supportUrl(docId, f)} download={f.file_name} aria-label={`Download ${f.file_name}`}><Download aria-hidden className="size-3.5" />Download</a>
      {canEdit && <Button size="sm" variant="ghost" aria-label={`Remove ${f.file_name}`} onClick={() => remove(f)}><Trash2 aria-hidden className="size-3.5" /></Button>}
    </span>
  );

  return (
    <section aria-label="Support files" className="mt-4 rounded-md border border-border p-3">
      <h3 className="flex items-center gap-2 font-display text-sm font-bold"><Paperclip aria-hidden className="size-4" />Support files <span className="font-mono text-xs font-normal text-text-muted">{files.length}</span></h3>
      {errors.length > 0 && <div className="mt-2"><Banner tone="danger"><ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Banner></div>}
      {canEdit && (
        <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files); }}
          className={cx('mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-sm', over ? 'border-accent-edge bg-surface-2' : 'border-border-strong')}>
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" aria-label="Support files to add" onChange={(e) => upload(e.target.files)} />
          <Button size="sm" loading={!!busy} onClick={() => input.current?.click()}><Upload aria-hidden className="size-4" />Add pictures, videos or documents</Button>
          <span className="text-text-muted">{busy ? `Uploading ${busy}…` : 'or drop them here · videos up to 50 MB, other files 25 MB'}</span>
        </div>
      )}
      {q.isSuccess && !files.length && <p className="mt-2 text-sm text-text-subtle">No support files.</p>}

      {pictures.length > 0 && (
        <div className="mt-3">
          <p className="label-caps mb-1.5 flex items-center gap-1 text-text-muted"><ImageIcon aria-hidden className="size-3.5" />Pictures</p>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {pictures.map((f, i) => (
              <li key={f.id} className="group relative">
                <button type="button" className="block w-full" onClick={() => setZoom(i)} aria-label={`View ${f.file_name}`}>
                  <img src={supportUrl(docId, f, true)} alt={f.file_name} loading="lazy" className="aspect-square w-full rounded-sm border border-border object-cover" />
                </button>
                {canEdit && <button type="button" aria-label={`Remove ${f.file_name}`} onClick={() => remove(f)} className="absolute right-1 top-1 hidden rounded-sm bg-bg/80 p-1 group-hover:block group-focus-within:block"><Trash2 aria-hidden className="size-3.5" /></button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {videos.length > 0 && (
        <div className="mt-3">
          <p className="label-caps mb-1.5 flex items-center gap-1 text-text-muted"><Film aria-hidden className="size-3.5" />Videos</p>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {videos.map((f) => (
              <li key={f.id} className="rounded-md border border-border p-2">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption -- field videos have no caption files */}
                <video controls preload="metadata" playsInline src={supportUrl(docId, f, true)} className="aspect-video w-full rounded-sm bg-black" />
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate font-semibold">{f.file_name}</span>{actions(f)}</div>
                <p className="text-xs text-text-subtle">{meta(f)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {others.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {others.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span aria-hidden className="grid size-10 place-items-center rounded-sm border border-border font-mono text-label uppercase text-text-muted">{f.file_name.split('.').pop()}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{f.file_name}</span><span className="text-xs text-text-muted">{meta(f)}</span></span>
              {actions(f)}
            </li>
          ))}
        </ul>
      )}

      {zoom !== null && pictures[zoom] && <Lightbox docId={docId} pictures={pictures} index={zoom} onIndex={setZoom} onClose={() => setZoom(null)} />}
    </section>
  );
}

function Lightbox({ docId, pictures, index, onIndex, onClose }: { docId: string; pictures: SupportFile[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const f = pictures[index];
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex(Math.min(pictures.length - 1, index + 1));
      if (e.key === 'ArrowLeft') onIndex(Math.max(0, index - 1));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [index, pictures.length, onClose, onIndex]);
  return (
    <div role="dialog" aria-modal="true" aria-label={f.file_name} className="fixed inset-0 z-[70] flex flex-col bg-black/90 p-4">
      <div className="flex items-center gap-2 text-sm text-white">
        <span className="min-w-0 flex-1 truncate">{f.file_name} · {index + 1} of {pictures.length}</span>
        <a className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/10" href={supportUrl(docId, f)} download={f.file_name}><Download aria-hidden className="size-4" />Download</a>
        <button type="button" className="rounded-md p-1 hover:bg-white/10" aria-label="Close" onClick={onClose}><X aria-hidden className="size-5" /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center gap-2">
        <button type="button" aria-label="Previous picture" disabled={index === 0} onClick={() => onIndex(index - 1)} className="rounded-full p-2 text-white hover:bg-white/10 disabled:opacity-30"><ChevronLeft aria-hidden className="size-6" /></button>
        <img src={supportUrl(docId, f, true)} alt={f.file_name} className="mx-auto max-h-full min-w-0 max-w-full flex-1 object-contain" />
        <button type="button" aria-label="Next picture" disabled={index === pictures.length - 1} onClick={() => onIndex(index + 1)} className="rounded-full p-2 text-white hover:bg-white/10 disabled:opacity-30"><ChevronRight aria-hidden className="size-6" /></button>
      </div>
    </div>
  );
}
