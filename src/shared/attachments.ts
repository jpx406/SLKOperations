// Attachments (R2): files kept with a job (photos, signed ticket, job log scan, the uploaded JRA form …) or with a
// Knowledge Hub entry. Only document and image types are accepted, so nothing uploaded can run in the browser.

export const ATTACH_ENTITIES = { job: 'Job', knowledge: 'Knowledge Hub entry' } as const;
export type AttachEntity = keyof typeof ATTACH_ENTITIES;
export const isAttachEntity = (v: unknown): v is AttachEntity => typeof v === 'string' && v in ATTACH_ENTITIES;

export const CATEGORIES = {
  photo: 'Photo', ticket: 'Field ticket', job_log: 'Job log', jra_form: 'JRA form', report: 'Report', permit: 'Permit / certificate', document: 'Document', other: 'Other',
} as const;
export type Category = keyof typeof CATEGORIES;
export const isCategory = (v: unknown): v is Category => typeof v === 'string' && v in CATEGORIES;

/** Allowed extensions and the type each is served with. HTML, SVG and scripts are left out on purpose. */
export const TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  msg: 'application/vnd.ms-outlook', eml: 'message/rfc822', zip: 'application/zip',
};
/** Types a browser may show in the page instead of downloading. */
export const INLINE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']);
export const MAX_BYTES = 25 * 1024 * 1024;

export const extOf = (name: string) => (/\.([a-z0-9]{1,6})$/i.exec(name)?.[1] ?? '').toLowerCase();

/** A safe file name: no folders, no control characters, at most 150 characters. */
export function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f"<>|*?:]/g, '_').replace(/\s+/g, ' ').trim().slice(-150) || 'file';
}

export function checkUpload(name: string, size: number): { error: string } | { name: string; type: string } {
  const n = cleanName(name);
  const type = TYPES[extOf(n)];
  if (!type) return { error: `“${n}” isn’t a type SLK Operations keeps. Use a photo, PDF, Word, Excel, PowerPoint, text, CSV, email or zip file.` };
  if (size <= 0) return { error: 'The file is empty' };
  if (size > MAX_BYTES) return { error: `“${n}” is larger than 25 MB` };
  return { name: n, type };
}

export const sizeText = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
