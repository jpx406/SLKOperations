import { Database, Download, Upload } from 'lucide-react';
import { useState } from 'react';
import type { TableDiff } from '../../shared/dataPackage';
import { workbook, zip } from '../../shared/xlsx';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { saveFile } from '../components/charts';
import { Banner, Button, Card, Field, PageTitle, cx, inputClass } from '../components/ui';

// Data export and import (Administrator Manual 7). Export the whole board as a package (one JSON with every table,
// plus a spreadsheet per table); import a package after a fresh backup, a dry run and a typed confirmation.

type Pkg = { format: string; version: number; exported_at: string; by: string; backup_id: string; tables: Record<string, Record<string, unknown>[]> };

export function AdminData() {
  const { data: me } = useMe();
  const [backup, setBackup] = useState<{ id: string; at: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pkg, setPkg] = useState<{ name: string; data: unknown } | null>(null);
  const [dry, setDry] = useState<{ diffs: TableDiff[]; totals: { added: number; changed: number; unchanged: number; refused: number } } | null>(null);
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState<string | null>(null);
  if (me?.role !== 'admin') return <Banner tone="info">Whole-board export and import are for admins.</Banner>;

  const doExport = async () => {
    setBusy('export'); setError(null);
    try {
      const p = await api<Pkg>('/admin/export');
      const enc = new TextEncoder();
      const stamp = p.exported_at.slice(0, 16).replace(/[:T]/g, '-');
      const files = [{ name: `slkops-package-${stamp}.json`, data: enc.encode(JSON.stringify(p)) }];
      // one spreadsheet per table, for reading; the JSON is what an import takes
      for (const [t, rows] of Object.entries(p.tables)) {
        if (!rows.length) continue;
        const cols = Object.keys(rows[0]);
        files.push({ name: `tables/${t}.xlsx`, data: workbook(t, cols, rows.map((r) => cols.map((c) => { const v = r[c]; return v === null || v === undefined ? null : typeof v === 'number' ? v : String(v); }))) });
      }
      saveFile(`slkops-export-${stamp}.zip`, zip(files), 'application/zip');
      setBackup({ id: p.backup_id, at: p.exported_at });
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(null); }
  };
  const pick = async (file: File | undefined) => {
    setDry(null); setDone(null); setError(null); setConfirm('');
    if (!file) return;
    try { setPkg({ name: file.name, data: JSON.parse(await file.text()) }); } catch { setError('That file isn’t a JSON package. Take the .json file from inside an export zip.'); }
  };
  const runDry = async () => {
    if (!pkg) return;
    setBusy('dry'); setError(null);
    try { setDry(await api('/admin/import/dry-run', { method: 'POST', json: pkg.data })); } catch (e) { setError((e as ApiError).message); } finally { setBusy(null); }
  };
  const apply = async () => {
    if (!pkg || !backup) return;
    setBusy('apply'); setError(null);
    try {
      const r = await api<{ written: number }>('/admin/import/apply', { method: 'POST', json: { package: pkg.data, backup_id: backup.id, confirm } });
      setDone(`Imported: ${r.written} row${r.written === 1 ? '' : 's'} written. The backup ${backup.id.slice(0, 8)} stays available if anything needs undoing.`);
      setDry(null); setPkg(null); setConfirm('');
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(null); }
  };
  const backupFresh = !!backup && Date.now() - Date.parse(backup.at) < 15 * 60_000;
  const changes = dry ? dry.totals.added + dry.totals.changed : 0;

  return (
    <section aria-labelledby="data-title">
      <PageTitle><span id="data-title">Data export and import</span></PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">Everything SLK Operations Hub keeps, in one package. WIREGUARD’s wires, runs and units are not included; the sync brings them back.</p>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      {done && <div className="mb-3"><Banner tone="success">{done}</Banner></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold"><Download aria-hidden className="size-5" />Export</h2>
          <p className="mb-3 text-sm text-text-muted">A zip with the package (JSON, every table) and a spreadsheet per table. The export also counts as the backup an import needs.</p>
          <Button variant="primary" loading={busy === 'export'} onClick={doExport}><Database aria-hidden className="size-4" />Export the whole board</Button>
          {backup && <p className="mt-2 text-xs text-success">Backup {backup.id.slice(0, 8)} taken {new Date(backup.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh' })}. Keep the zip safe.</p>}
        </Card>
        <Card>
          <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold"><Upload aria-hidden className="size-5" />Import</h2>
          <Banner tone="warning">An import writes straight into live data. It adds new rows and updates changed ones; it never deletes. History (versions, inventory movements) only takes new rows.</Banner>
          <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm">
            <li className={cx(backupFresh && 'text-success')}>Export a fresh backup on the left {backupFresh ? '✓' : '(within the last 15 minutes)'}.</li>
            <li>
              Choose the package (the .json file from an export zip).
              <input type="file" accept="application/json,.json" aria-label="Package file" className="mt-1 block text-sm" onChange={(e) => pick(e.target.files?.[0])} />
              {pkg && <Button className="mt-2" size="sm" loading={busy === 'dry'} onClick={runDry}>Check it (dry run)</Button>}
            </li>
            <li>Read the differences, then type IMPORT to apply.</li>
          </ol>
        </Card>
      </div>
      {dry && (
        <Card className="mt-4 overflow-x-auto">
          <h2 className="mb-2 font-display text-lg font-bold">Dry run: {pkg?.name}</h2>
          <p className="mb-3 text-sm">{dry.totals.added} new · {dry.totals.changed} changed · {dry.totals.unchanged} unchanged{dry.totals.refused ? ` · ${dry.totals.refused} refused (history can’t change)` : ''}</p>
          <table className="w-full min-w-[40rem] text-sm">
            <thead><tr className="text-left text-xs text-text-muted">{['Table', 'Rows', 'New', 'Changed', 'Unchanged', 'Refused', 'Examples'].map((h) => <th key={h} scope="col" className="py-1 pr-3 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{dry.diffs.map((d) => (
              <tr key={d.table} className={cx('border-t border-border align-top', !d.added && !d.changed && !d.refused && 'text-text-subtle')}>
                <th scope="row" className="py-1 pr-3 text-left font-mono text-xs">{d.table}</th><td className="py-1 pr-3 font-mono">{d.incoming}</td>
                <td className="py-1 pr-3 font-mono">{d.added || ''}</td><td className="py-1 pr-3 font-mono">{d.changed || ''}</td><td className="py-1 pr-3 font-mono">{d.unchanged}</td>
                <td className={cx('py-1 pr-3 font-mono', d.refused > 0 && 'text-warning')}>{d.refused || ''}</td>
                <td className="py-1 text-xs">{d.samples.map((s, i) => <span key={i} className="block">{s.kind} {s.key}{s.fields ? `: ${s.fields.join(', ')}` : ''}</span>)}</td>
              </tr>
            ))}</tbody>
          </table>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field id="imp-confirm" label="Type IMPORT to apply"><input id="imp-confirm" className={cx(inputClass, 'w-40')} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
            <Button variant="danger" loading={busy === 'apply'} disabled={confirm !== 'IMPORT' || !backupFresh || !changes} onClick={apply}>Apply {changes} change{changes === 1 ? '' : 's'}</Button>
            {!backupFresh && <span className="text-xs text-warning">Export a fresh backup first.</span>}
            {!changes && <span className="text-xs text-text-subtle">Nothing to change.</span>}
          </div>
        </Card>
      )}
    </section>
  );
}
