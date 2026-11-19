import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { qafNumber } from '../../../shared/knowledge';
import { REV_STATUS, type RevStatus } from '../../../shared/knowledgeControl';
import { api, formatDate } from '../../api';
import { Card, cx, inputSized } from '../../components/ui';

// The QAF number record for forms (6z.27): every QAF number in use (retired ones too, a number is never given
// twice), the file each one holds, and the checks Add document runs before saving so a form isn't filed twice.

export interface FormsRecord {
  next: string;
  rows: {
    id: string; doc_no: string | null; title: string; country: string; company: string | null; revision: number; published_at: string | null; retired_at: string | null;
    open_status: RevStatus | null; hashes: string[];
    files: { kind: string; file_name: string; sha256: string; revision: number; uploaded_at: string; uploaded_by_name: string }[];
  }[];
}

export const useFormsRecord = (enabled = true) => useQuery({ queryKey: ['knowledge-forms-record'], queryFn: () => api<FormsRecord>('/knowledge/forms-record'), enabled });

export async function sha256Hex(file: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Why a new form can't be added as it is: its number is taken, or one of its files is already filed. Null when clear. */
export async function formDuplicate(rec: FormsRecord | undefined, docNo: string, files: (File | null)[], notId?: string): Promise<string | null> {
  if (!rec) return null;
  const q = qafNumber(docNo);
  const taken = q && rec.rows.find((r) => r.doc_no === q && r.id !== notId);
  if (taken) return `${q} is already used by “${taken.title}”${taken.retired_at ? ' (retired)' : ''}. Leave the number blank for ${rec.next}.`;
  for (const f of files) {
    if (!f) continue;
    const h = await sha256Hex(f);
    const same = rec.rows.find((r) => r.id !== notId && !r.retired_at && r.hashes.includes(h));
    if (same) return `“${f.name}” is already uploaded as ${same.doc_no ?? ''} “${same.title}”. Open that form instead of adding it again.`;
  }
  return null;
}

const status = (r: FormsRecord['rows'][number]) =>
  r.retired_at ? 'Retired' : r.published_at ? `Published Rev ${r.revision}${r.open_status ? `, Rev ${r.revision + 1} ${REV_STATUS[r.open_status].toLowerCase()}` : ''}` : r.open_status ? REV_STATUS[r.open_status] : 'Draft';

/** On the Forms tab: the record of QAF numbers and what was uploaded under each. */
export function FormsRecordPanel() {
  const q = useFormsRecord();
  const [search, setSearch] = useState('');
  if (!q.data) return null;
  const { rows, next } = q.data;
  const s = search.trim().toLowerCase();
  const shown = rows.filter((r) => !s || `${r.doc_no} ${r.title} ${r.files.map((f) => f.file_name).join(' ')}`.toLowerCase().includes(s));
  return (
    <Card className="mb-4 p-0">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
          <span className="font-display text-base font-bold">QAF number record</span>
          <span className="text-xs text-text-muted">{rows.filter((r) => qafNumber(r.doc_no)).length} QAF numbers used · next free <span className="font-mono font-semibold text-text">{next}</span></span>
        </summary>
        <div className="border-t border-border px-4 py-3">
          <p className="mb-2 text-xs text-text-muted">Every QAF number given to a form, retired ones included, so no number is used twice. Add document takes the form’s own QAF number, or gives the next free one when it is left blank, and refuses a file that is already uploaded under another form.</p>
          <input type="search" aria-label="Search the QAF record" className={inputSized('mb-2 w-full sm:w-72')} placeholder="Search numbers, titles and file names" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-xs">
              <thead><tr className="text-left text-text-muted">{['QAF number', 'Title', 'Filed under', 'Status', 'Files uploaded'].map((h) => <th key={h} scope="col" className="py-1 pr-3 font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={cx('border-t border-border align-top', r.retired_at && 'text-text-subtle')}>
                    <td className="py-1.5 pr-3 font-mono font-semibold whitespace-nowrap">{r.doc_no ?? '—'}</td>
                    <td className="py-1.5 pr-3">{r.title}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{[r.country, r.company].filter(Boolean).join(' · ')}</td>
                    <td className="py-1.5 pr-3">{status(r)}</td>
                    <td className="py-1.5 pr-3">{r.files.length ? r.files.map((f) => (
                      <span key={f.sha256 + f.kind} className="block">{f.file_name} <span className="text-text-subtle">· Rev {f.revision} · {f.uploaded_by_name}, {formatDate(f.uploaded_at.slice(0, 10))}</span></span>
                    )) : <span className="text-text-subtle">{r.hashes.length ? `${r.hashes.length} file${r.hashes.length > 1 ? 's' : ''}` : 'No file yet'}</span>}</td>
                  </tr>
                ))}
                {!shown.length && <tr className="border-t border-border"><td colSpan={5} className="py-2 text-text-subtle">{rows.length ? 'Nothing matches.' : 'No form numbers yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </Card>
  );
}
