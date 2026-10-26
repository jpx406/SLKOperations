import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, Paperclip, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { CATEGORIES, INLINE, TYPES, checkUpload, sizeText, type AttachEntity, type Category } from '../../shared/attachments';
import { ApiError, api } from '../api';
import { Banner, Button, cx, inputSized } from './ui';

// Files kept with a job or a Knowledge Hub entry (R2). Drop files or pick them, choose what they are, and they upload
// one by one. Images show as thumbnails; images and PDFs open in a new tab, everything else downloads.

interface FileRow { id: string; category: Category; file_name: string; content_type: string; size_bytes: number; note: string | null; uploaded_by_name: string; uploaded_at: string }
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const ACCEPT = Object.keys(TYPES).map((e) => `.${e}`).join(',');

export function Attachments({ entity, id, title = 'Attachments' }: { entity: AttachEntity; id: string; title?: string }) {
  const qc = useQueryClient();
  const base = `/attachments/${entity}/${encodeURIComponent(id)}`;
  const q = useQuery({ queryKey: ['attachments', entity, id], queryFn: () => api<{ files: FileRow[]; canEdit: boolean; storage: boolean }>(base) });
  const [category, setCategory] = useState<Category>(entity === 'job' ? 'photo' : 'document');
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const files = q.data?.files ?? [];
  const canEdit = !!q.data?.canEdit && !!q.data?.storage;

  const upload = async (list: FileList | File[] | null) => {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    const errs: string[] = [];
    for (const f of picked) {
      const ok = checkUpload(f.name, f.size);
      if ('error' in ok) { errs.push(ok.error); continue; }
      setBusy(f.name);
      try { await api(`${base}?category=${category}`, { method: 'POST', body: f, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) } }); }
      catch (e) { errs.push(`${f.name}: ${(e as ApiError).message}`); }
    }
    setBusy(null); setErrors(errs);
    if (input.current) input.current.value = '';
    qc.invalidateQueries({ queryKey: ['attachments', entity, id] });
  };
  const remove = async (f: FileRow) => {
    if (!window.confirm(`Remove “${f.file_name}”? It is hidden from the job; the audit log keeps a record.`)) return;
    try { await api(`${base}/${f.id}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['attachments', entity, id] }); }
    catch (e) { setErrors([(e as ApiError).message]); }
  };
  const url = (f: FileRow, inline = false) => `/api${base}/${f.id}${inline ? '?inline=1' : ''}`;

  return (
    <section aria-label={title}>
      <h3 className="mb-2 flex items-center gap-2 font-display text-base font-bold uppercase"><Paperclip aria-hidden className="size-4" />{title} <span className="font-mono text-sm font-normal text-text-muted">{files.length}</span></h3>
      {q.data && !q.data.storage && <div className="mb-2"><Banner tone="warning">File storage isn’t set up on the server yet (R2 bucket slkops-files).</Banner></div>}
      {errors.length > 0 && <div className="mb-2"><Banner tone="danger"><ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Banner></div>}
      {canEdit && (
        <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files); }}
          className={cx('mb-3 flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-sm', over ? 'border-accent-edge bg-surface-2' : 'border-border-strong')}>
          <label className="sr-only" htmlFor={`att-cat-${id}`}>What the files are</label>
          <select id={`att-cat-${id}`} className={inputSized('h-(--layout-control-sm) w-44')} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" aria-label="Files to attach" onChange={(e) => upload(e.target.files)} />
          <Button size="sm" loading={!!busy} onClick={() => input.current?.click()}><Upload aria-hidden className="size-4" />Add files</Button>
          <span className="text-text-muted">{busy ? `Uploading ${busy}…` : 'or drop them here · photos, PDF, Office, text, email, zip · up to 25 MB each'}</span>
        </div>
      )}
      {q.isSuccess && !files.length && <p className="text-sm text-text-subtle">No files yet.</p>}
      {files.length > 0 && (
        <ul className="divide-y divide-border">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              {f.content_type.startsWith('image/') && INLINE.has(f.content_type)
                ? <a href={url(f, true)} target="_blank" rel="noreferrer"><img src={url(f, true)} alt="" loading="lazy" className="size-12 rounded-sm border border-border object-cover" /></a>
                : <span aria-hidden className="grid size-12 place-items-center rounded-sm border border-border font-mono text-label uppercase text-text-muted">{f.file_name.split('.').pop()}</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{f.file_name}</span>
                <span className="text-xs text-text-muted">{CATEGORIES[f.category]} · {sizeText(f.size_bytes)} · {f.uploaded_by_name} · {when(f.uploaded_at)}</span>
              </span>
              {INLINE.has(f.content_type) && <a className="inline-flex h-(--layout-control-sm) items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-muted hover:bg-surface-2 hover:text-text" href={url(f, true)} target="_blank" rel="noreferrer"><Eye aria-hidden className="size-3.5" />View</a>}
              <a className="inline-flex h-(--layout-control-sm) items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-muted hover:bg-surface-2 hover:text-text" href={url(f)} download={f.file_name}><Download aria-hidden className="size-3.5" />Download</a>
              {canEdit && <Button size="sm" variant="ghost" aria-label={`Remove ${f.file_name}`} onClick={() => remove(f)}><Trash2 aria-hidden className="size-3.5" /></Button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
