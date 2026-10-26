import { Select } from '../components/Select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ExternalLink, Pencil, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { FLAG_LABEL, LIST_KINDS, PCE_KINDS, PCE_RATINGS, SERVICE_FLAGS, pressureTestDue, type ListKind } from '../../shared/database';
import { ApiError, api, formatDate } from '../api';
import { useMe } from '../auth';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass, inputSized } from '../components/ui';

interface UnitRow { unit_number: string; country: string; year: number | null; wg_active: number; open_jobs: number; drums: string | null }
interface PceRow {
  id: string; country: string; label: string; kind: keyof typeof PCE_KINDS; bore_in: number; rating_psi: number | null; length_ft: number | null;
  last_pressure_test_on: string | null; is_rental: number; active: number; open_jobs: number; all_jobs: number;
}
interface PanelRow { id: string; country: string; label: string; panel_type: string | null; active: number; open_jobs: number; all_jobs: number }
interface ListRow { id: string; country: string; kind: ListKind; value: string; sort: number; active: number }
interface ProfileRow { job_type_name: string; domain: string | null; is_plug: number; is_fishing: number; is_memory: number; is_perforation: number; is_explosive: number; updated_at: string | null }
interface Db { units: UnitRow[]; pce: PceRow[]; greasePanels: PanelRow[]; lists: ListRow[]; serviceProfiles: ProfileRow[]; domains: string[] }

const TABS = [['units', 'Units'], ['pce', 'Pressure control'], ['panels', 'Grease panels'], ['lists', 'Lists'], ['profiles', 'Service profiles']] as const;
type Tab = (typeof TABS)[number][0];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

export function Database() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'units') as Tab;
  const { data: me } = useMe();
  const db = useQuery({ queryKey: ['database'], queryFn: () => api<Db>('/database') });
  const countries = me?.countries ?? [];
  const [country, setCountry] = useState<string>('');
  const shown = country || (countries.length === 1 ? countries[0] : '');
  const rights = { edit: !!me?.menus.database?.edit, remove: !!me?.menus.database?.delete };
  const inCountry = <T extends { country: string }>(rows: T[]) => (shown ? rows.filter((r) => r.country === shown) : rows);

  return (
    <section aria-labelledby="db-title">
      <PageTitle aside={countries.length > 1 && (
        <label className="flex items-center gap-2 text-sm text-text-muted">Country
          <Select className={inputSized('h-(--layout-control-sm) w-48')} value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">All my countries</option>
            {countries.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </label>
      )}><span id="db-title">Equipment database</span></PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">
        Units, drums, wires and job types come from WIREGUARD and change there. SLK Operations keeps its own pressure control equipment,
        grease panels, pick lists and the sections each job type opens in the job editor.
      </p>
      {!rights.edit && <div className="mb-4"><Banner tone="info">You can view the database. Your role does not change it.</Banner></div>}
      <div role="tablist" aria-label="Database sections" className="mb-4 flex flex-wrap gap-2">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k }, { replace: true })}
            className={cx('h-(--layout-control-sm) rounded-pill border px-3.5 text-sm font-semibold', tab === k ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={TABS.find(([k]) => k === tab)?.[1]}>
        {db.isPending && <Skeleton className="h-96" />}
        {db.isError && <Banner tone="danger">{db.error.message}</Banner>}
        {db.data && tab === 'units' && <Units rows={inCountry(db.data.units)} />}
        {db.data && tab === 'pce' && <PceTable rows={inCountry(db.data.pce)} rights={rights} country={shown} />}
        {db.data && tab === 'panels' && <Panels rows={inCountry(db.data.greasePanels)} rights={rights} country={shown} types={db.data.lists.filter((l) => l.kind === 'grease_panel_type' && l.active).map((l) => l.value)} />}
        {db.data && tab === 'lists' && <Lists rows={inCountry(db.data.lists)} canEdit={rights.edit} country={shown} />}
        {db.data && tab === 'profiles' && <Profiles rows={db.data.serviceProfiles} domains={db.data.domains} canEdit={rights.edit} />}
      </div>
    </section>
  );
}

function Table({ head, children, min = '48rem' }: { head: string[]; children: React.ReactNode; min?: string }) {
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm" style={{ minWidth: min }}>
        <thead className="bg-surface-2"><tr className="text-left text-xs text-text-muted">{head.map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </Card>
  );
}

const OnOff = ({ on, off = 'Switched off' }: { on: boolean; off?: string }) =>
  <span className={cx('label-caps inline-flex h-5.5 items-center rounded-pill px-2', on ? 'bg-success-subtle text-success' : 'bg-neutral-subtle text-neutral')}>{on ? 'Active' : off}</span>;

function Units({ rows }: { rows: UnitRow[] }) {
  const config = useQuery({ queryKey: ['config'], queryFn: () => api<{ wireguardUrl: string }>('/config'), staleTime: Infinity });
  const stale = rows.filter((u) => !u.wg_active && u.open_jobs);
  return (
    <>
      {stale.length > 0 && (
        <div className="mb-3"><Banner tone="warning">
          {stale.map((u) => u.unit_number).join(', ')} {stale.length === 1 ? 'is' : 'are'} no longer listed in WIREGUARD but still {stale.length === 1 ? 'has' : 'have'} open jobs. Move or close them on the schedule.
        </Banner></div>
      )}
      <p className="mb-3 text-sm text-text-muted">
        Add, retire or move units in WIREGUARD; they show here after the next sync.
        {config.data?.wireguardUrl && <> <a className="inline-flex items-center gap-1 underline" href={config.data.wireguardUrl} target="_blank" rel="noreferrer">Open WIREGUARD<ExternalLink aria-hidden className="size-3" /></a></>}
      </p>
      {!rows.length ? <EmptyState title="No units yet">Run a WIREGUARD sync from Users &amp; Roles.</EmptyState> : (
        <Table head={['Unit', 'Country', 'Year', 'Drums', 'Open jobs', 'In WIREGUARD']}>
          {rows.map((u) => (
            <tr key={u.unit_number} className="border-t border-border">
              <th scope="row" className="px-3 py-2 text-left font-display font-bold">{u.unit_number}</th>
              <td className="px-3 py-2 text-text-muted">{u.country}</td>
              <td className="px-3 py-2 font-mono text-xs">{u.year ?? '—'}</td>
              <td className="px-3 py-2 font-mono text-xs">{u.drums ?? <span className="text-text-subtle">none</span>}</td>
              <td className={cx('px-3 py-2 font-mono', !u.wg_active && u.open_jobs ? 'text-warning font-semibold' : '')}>{u.open_jobs}</td>
              <td className="px-3 py-2"><OnOff on={!!u.wg_active} off="Not listed" /></td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

type Rights = { edit: boolean; remove: boolean };

function useSaved() {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ['database'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); };
}

function PceTable({ rows, rights, country }: { rows: PceRow[]; rights: Rights; country: string }) {
  const [editing, setEditing] = useState<PceRow | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-text-muted">The job editor checks the largest tool OD against the bore, and the toolstring against the lubricator length.</p>
        {rights.edit && <Button variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Add equipment</Button>}
      </div>
      {notice && <div className="mb-3"><Banner tone="success">{notice}</Banner></div>}
      {!rows.length ? <EmptyState title="No pressure control equipment yet">Add the PCE sets and lubricators crews can pick on Preparation.</EmptyState> : (
        <Table head={['Label', 'Type', 'Bore', 'Rating', 'Length', 'Last pressure test', 'Jobs', 'Status', '']} min="60rem">
          {rows.map((p) => {
            const due = pressureTestDue(p.last_pressure_test_on, today());
            return (
              <tr key={p.id} className={cx('border-t border-border', !p.active && 'text-text-subtle')}>
                <th scope="row" className="px-3 py-2 text-left font-semibold">{p.label}{p.is_rental ? <span className="ml-1.5 text-xs font-normal text-text-subtle">rental</span> : null}<span className="block text-xs font-normal text-text-subtle">{p.country}</span></th>
                <td className="px-3 py-2">{PCE_KINDS[p.kind]}</td>
                <td className="px-3 py-2 font-mono text-xs">{p.bore_in} in</td>
                <td className="px-3 py-2 font-mono text-xs">{p.rating_psi ? `${p.rating_psi.toLocaleString()} psi` : '—'}</td>
                <td className="px-3 py-2 font-mono text-xs">{p.length_ft != null ? `${p.length_ft} ft` : '—'}</td>
                <td className={cx('px-3 py-2 text-xs', !!p.active && due.overdue && 'font-semibold text-warning')}>
                  {p.last_pressure_test_on ? `${formatDate(p.last_pressure_test_on)} · ${due.days} d` : 'never recorded'}{p.active && due.overdue ? ' · due' : ''}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{p.open_jobs} open / {p.all_jobs}</td>
                <td className="px-3 py-2"><OnOff on={!!p.active} /></td>
                <td className="px-3 py-2 text-right">{rights.edit && <Button size="sm" onClick={() => setEditing(p)} aria-label={`Edit ${p.label}`}><Pencil aria-hidden className="size-3.5" />Edit</Button>}</td>
              </tr>
            );
          })}
        </Table>
      )}
      {editing && <PceDialog row={editing === 'new' ? null : editing} country={country} canRemove={rights.remove} onClose={(msg) => { setEditing(null); setNotice(msg ?? null); }} />}
    </>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="db-dialog-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="max-h-full w-full max-w-xl overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-pop">
        <div className="mb-4 flex items-start gap-3">
          <h2 id="db-dialog-title" className="flex-1 font-display text-lg font-bold">{title}</h2>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close"><X aria-hidden className="size-4" /></Button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CountrySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: me } = useMe();
  return (
    <Field id="db-country" label="Country">
      <Select id="db-country" className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {(me?.countries ?? []).map((c) => <option key={c}>{c}</option>)}
      </Select>
    </Field>
  );
}

/** Saves the form; a switch-off that open jobs still use comes back with a question, and the second click confirms it. */
function useEquipmentSave(path: string, row: { id: string } | null, onClose: (msg?: string) => void, label: () => string) {
  const saved = useSaved();
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      row ? api(`/database/${path}/${row.id}`, { method: 'PATCH', json: body }) : api(`/database/${path}`, { method: 'POST', json: body }),
    onSuccess: () => { saved(); onClose(`Saved ${label()}`); },
    onError: (e: ApiError) => {
      const body = e.body as { needsConfirm?: boolean } | undefined;
      if (e.status === 409 && body?.needsConfirm) setAsk(e.message); else setError(e.message);
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/database/${path}/${row!.id}`, { method: 'DELETE' }),
    onSuccess: () => { saved(); onClose(`Removed ${label()}`); },
    onError: (e: ApiError) => setError(e.message),
  });
  return { error, setError, ask, setAsk, save, remove };
}

function PceDialog({ row, country, canRemove, onClose }: { row: PceRow | null; country: string; canRemove: boolean; onClose: (msg?: string) => void }) {
  const [f, setF] = useState({
    country: row?.country ?? country, label: row?.label ?? '', kind: row?.kind ?? 'pce_set', bore_in: row ? String(row.bore_in) : '',
    rating_psi: row?.rating_psi ? String(row.rating_psi) : '', length_ft: row?.length_ft != null ? String(row.length_ft) : '',
    last_pressure_test_on: row?.last_pressure_test_on ?? '', is_rental: !!row?.is_rental, active: row ? !!row.active : true,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((cur) => ({ ...cur, [k]: v }));
  const { error, ask, setAsk, save, remove } = useEquipmentSave('pce', row, onClose, () => f.label);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const body = (confirm = false) => ({ ...f, ...(row ? {} : { country: f.country }), confirm });
  return (
    <Dialog title={row ? `Edit ${row.label}` : 'Add pressure control equipment'} onClose={() => onClose()}>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); setAsk(null); save.mutate(body()); }}>
        {!row && <CountrySelect value={f.country} onChange={(v) => set('country', v)} />}
        <Field id="pce-label" label="Label" required><input id="pce-label" className={inputClass} value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g. PCE-10K-04" /></Field>
        <Field id="pce-kind" label="Type">
          <Select id="pce-kind" className={inputClass} value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            {Object.entries(PCE_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field id="pce-bore" label="Bore" unit="in" required><input id="pce-bore" className={cx(inputClass, 'pr-10')} type="number" min={0} step="any" inputMode="decimal" value={f.bore_in} onChange={(e) => set('bore_in', e.target.value)} /></Field>
        <Field id="pce-rating" label="Pressure rating">
          <Select id="pce-rating" className={inputClass} value={f.rating_psi} onChange={(e) => set('rating_psi', e.target.value)}>
            <option value="">Not set</option>
            {PCE_RATINGS.map((r) => <option key={r} value={r}>{r.toLocaleString()} psi</option>)}
          </Select>
        </Field>
        <Field id="pce-length" label="Length" unit="ft" hint="Usable lubricator length"><input id="pce-length" className={cx(inputClass, 'pr-10')} type="number" min={0} step="any" inputMode="decimal" value={f.length_ft} onChange={(e) => set('length_ft', e.target.value)} /></Field>
        <Field id="pce-test" label="Last pressure test"><input id="pce-test" className={inputClass} type="date" value={f.last_pressure_test_on} onChange={(e) => set('last_pressure_test_on', e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.is_rental} onChange={(e) => set('is_rental', e.target.checked)} />Rental equipment</label>
        {row && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />Active (crews can pick it on new jobs)</label>}
        {ask && (
          <div className="sm:col-span-2"><Banner tone="warning" action={<Button size="sm" onClick={() => save.mutate(body(true))} loading={save.isPending}>Switch off anyway</Button>}>{ask}</Banner></div>
        )}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" loading={save.isPending}>Save</Button>
          <Button onClick={() => onClose()}>Cancel</Button>
          {row && canRemove && !row.all_jobs && (confirmRemove
            ? <Button variant="danger" className="ml-auto" loading={remove.isPending} onClick={() => remove.mutate()}>Confirm remove</Button>
            : <Button variant="danger" className="ml-auto" onClick={() => setConfirmRemove(true)}>Remove</Button>)}
        </div>
        {row && row.all_jobs > 0 && <p className="text-xs text-text-subtle sm:col-span-2">On {row.all_jobs} job{row.all_jobs === 1 ? '' : 's'}, so it can be switched off but not removed.</p>}
      </form>
    </Dialog>
  );
}

function Panels({ rows, rights, country, types }: { rows: PanelRow[]; rights: Rights; country: string; types: string[] }) {
  const [editing, setEditing] = useState<PanelRow | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-text-muted">Grease injection panels for braided-line jobs.</p>
        {rights.edit && <Button variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Add panel</Button>}
      </div>
      {notice && <div className="mb-3"><Banner tone="success">{notice}</Banner></div>}
      {!rows.length ? <EmptyState title="No grease panels yet" /> : (
        <Table head={['Label', 'Type', 'Jobs', 'Status', '']} min="36rem">
          {rows.map((g) => (
            <tr key={g.id} className={cx('border-t border-border', !g.active && 'text-text-subtle')}>
              <th scope="row" className="px-3 py-2 text-left font-semibold">{g.label}<span className="block text-xs font-normal text-text-subtle">{g.country}</span></th>
              <td className="px-3 py-2">{g.panel_type ?? '—'}</td>
              <td className="px-3 py-2 font-mono text-xs">{g.open_jobs} open / {g.all_jobs}</td>
              <td className="px-3 py-2"><OnOff on={!!g.active} /></td>
              <td className="px-3 py-2 text-right">{rights.edit && <Button size="sm" onClick={() => setEditing(g)} aria-label={`Edit ${g.label}`}><Pencil aria-hidden className="size-3.5" />Edit</Button>}</td>
            </tr>
          ))}
        </Table>
      )}
      {editing && <PanelDialog row={editing === 'new' ? null : editing} country={country} types={types} canRemove={rights.remove} onClose={(msg) => { setEditing(null); setNotice(msg ?? null); }} />}
    </>
  );
}

function PanelDialog({ row, country, types, canRemove, onClose }: { row: PanelRow | null; country: string; types: string[]; canRemove: boolean; onClose: (msg?: string) => void }) {
  const [f, setF] = useState({ country: row?.country ?? country, label: row?.label ?? '', panel_type: row?.panel_type ?? '', active: row ? !!row.active : true });
  const { error, ask, setAsk, save, remove } = useEquipmentSave('grease-panels', row, onClose, () => f.label);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const body = (confirm = false) => (row ? { label: f.label, panel_type: f.panel_type, active: f.active, confirm } : f);
  return (
    <Dialog title={row ? `Edit ${row.label}` : 'Add grease panel'} onClose={() => onClose()}>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); setAsk(null); save.mutate(body()); }}>
        {!row && <CountrySelect value={f.country} onChange={(v) => setF({ ...f, country: v })} />}
        <Field id="gp-label" label="Label" required><input id="gp-label" className={inputClass} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
        <Field id="gp-type" label="Type">
          <Select id="gp-type" className={inputClass} value={f.panel_type} onChange={(e) => setF({ ...f, panel_type: e.target.value })}>
            <option value="">Not set</option>
            {[...new Set([...types, ...(f.panel_type ? [f.panel_type] : [])])].map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        {row && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Active (crews can pick it on new jobs)</label>}
        {ask && <div className="sm:col-span-2"><Banner tone="warning" action={<Button size="sm" onClick={() => save.mutate(body(true))} loading={save.isPending}>Switch off anyway</Button>}>{ask}</Banner></div>}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" loading={save.isPending}>Save</Button>
          <Button onClick={() => onClose()}>Cancel</Button>
          {row && canRemove && !row.all_jobs && (confirmRemove
            ? <Button variant="danger" className="ml-auto" loading={remove.isPending} onClick={() => remove.mutate()}>Confirm remove</Button>
            : <Button variant="danger" className="ml-auto" onClick={() => setConfirmRemove(true)}>Remove</Button>)}
        </div>
      </form>
    </Dialog>
  );
}

function Lists({ rows, canEdit, country }: { rows: ListRow[]; canEdit: boolean; country: string }) {
  const [kind, setKind] = useState<ListKind>('well_type');
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = useSaved();
  const { data: me } = useMe();
  const target = country || (me?.countries.length === 1 ? me.countries[0] : '');
  const values = rows.filter((r) => r.kind === kind);
  const run = useMutation({
    mutationFn: ({ path, method, json }: { path: string; method: string; json: unknown }) => api(`/database/lists${path}`, { method, json }),
    onSuccess: () => { saved(); setError(null); setRenaming(null); },
    onError: (e: ApiError) => setError(e.message),
  });
  const counts = (k: ListKind) => rows.filter((r) => r.kind === k && r.active).length;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[14rem_1fr]">
      <nav aria-label="Lists">
        <ul className="flex flex-wrap gap-1 md:flex-col">
          {(Object.keys(LIST_KINDS) as ListKind[]).map((k) => (
            <li key={k}>
              <button type="button" aria-current={k === kind || undefined} onClick={() => { setKind(k); setError(null); setRenaming(null); }}
                className={cx('flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm', k === kind ? 'bg-surface-2 font-semibold text-text' : 'text-text-muted hover:text-text')}>
                <span className="flex-1">{LIST_KINDS[k]}</span><span className="font-mono text-xs text-text-subtle">{counts(k)}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <Card>
        <h2 className="mb-1 font-display text-lg font-bold">{LIST_KINDS[kind]}</h2>
        <p className="mb-3 text-xs text-text-subtle">Order here is the order in the job editor. Renaming doesn’t change jobs that already saved the old value.</p>
        {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
        {canEdit && (
          <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) run.mutate({ path: '', method: 'POST', json: { country: target, kind, value: draft } }, { onSuccess: () => setDraft('') }); }}>
            <input aria-label={`New ${LIST_KINDS[kind].toLowerCase()} value`} className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)}
              placeholder={target ? `Add to ${target}` : 'Pick a country at the top first'} disabled={!target} />
            <Button type="submit" disabled={!target || !draft.trim()} loading={run.isPending}><Plus aria-hidden className="size-4" />Add</Button>
          </form>
        )}
        {!values.length ? <p className="text-sm text-text-muted">Nothing on this list yet.</p> : (
          <ul className="divide-y divide-border">
            {values.map((v, i) => (
              <li key={v.id} className={cx('flex items-center gap-2 py-1.5', !v.active && 'text-text-subtle')}>
                {renaming?.id === v.id ? (
                  <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); run.mutate({ path: `/${v.id}`, method: 'PATCH', json: { value: renaming.value } }); }}>
                    <input aria-label={`Rename ${v.value}`} autoFocus className={cx(inputClass, 'h-(--layout-control-sm)')} value={renaming.value} onChange={(e) => setRenaming({ id: v.id, value: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }} />
                    <Button size="sm" type="submit">Save</Button>
                  </form>
                ) : (
                  <span className="flex-1 text-sm">{v.value}{!v.active && <span className="ml-2 text-xs">(hidden)</span>}{!country && <span className="ml-2 text-xs text-text-subtle">{v.country}</span>}</span>
                )}
                {canEdit && renaming?.id !== v.id && (
                  <>
                    <Button size="sm" variant="ghost" aria-label={`Move ${v.value} up`} disabled={i === 0 || run.isPending} onClick={() => run.mutate({ path: `/${v.id}`, method: 'PATCH', json: { move: 'up' } })}><ArrowUp aria-hidden className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" aria-label={`Move ${v.value} down`} disabled={i === values.length - 1 || run.isPending} onClick={() => run.mutate({ path: `/${v.id}`, method: 'PATCH', json: { move: 'down' } })}><ArrowDown aria-hidden className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" aria-label={`Rename ${v.value}`} onClick={() => setRenaming({ id: v.id, value: v.value })}><Pencil aria-hidden className="size-3.5" /></Button>
                    <Button size="sm" onClick={() => run.mutate({ path: `/${v.id}`, method: 'PATCH', json: { active: !v.active } })}>{v.active ? 'Hide' : 'Show'}</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Profiles({ rows, domains, canEdit }: { rows: ProfileRow[]; domains: string[]; canEdit: boolean }) {
  const saved = useSaved();
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const put = useMutation({
    mutationFn: (p: ProfileRow) => api('/database/service-profiles', { method: 'PUT', json: p }),
    onSuccess: () => { saved(); setError(null); },
    onError: (e: ApiError) => setError(e.message),
  });
  const shown = rows.filter((r) => r.job_type_name.toLowerCase().includes(q.trim().toLowerCase()));
  const missing = rows.filter((r) => !r.updated_at).length;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-text-muted">
          Each WIREGUARD job type sits in a service domain and opens sections of the job editor (plug, fishing, memory survey, perforation).
          {missing > 0 && <span className="text-warning"> {missing} job type{missing === 1 ? ' has' : 's have'} no profile yet.</span>}
        </p>
        <input aria-label="Search job types" className={inputSized('h-(--layout-control-sm) w-56')} placeholder="Search job types" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      {!rows.length ? <EmptyState title="No job types yet">Job types come from WIREGUARD. Run a sync first.</EmptyState> : (
        <Table head={['Job type', 'Service domain', ...SERVICE_FLAGS.map((f) => FLAG_LABEL[f])]} min="64rem">
          {shown.map((p) => (
            <tr key={p.job_type_name} className="border-t border-border">
              <th scope="row" className="px-3 py-2 text-left font-semibold">{p.job_type_name}{!p.updated_at && <span className="ml-2 text-xs font-normal text-warning">no profile</span>}</th>
              <td className="px-3 py-2">
                <Select aria-label={`Service domain for ${p.job_type_name}`} className={cx(inputClass, 'h-(--layout-control-sm)')} disabled={!canEdit || put.isPending} value={p.domain ?? ''}
                  onChange={(e) => put.mutate({ ...p, domain: e.target.value || null })}>
                  <option value="">Not set</option>
                  {domains.map((d) => <option key={d}>{d}</option>)}
                </Select>
              </td>
              {SERVICE_FLAGS.map((f) => (
                <td key={f} className="px-3 py-2 text-center">
                  <input type="checkbox" aria-label={`${FLAG_LABEL[f]} for ${p.job_type_name}`} disabled={!canEdit || put.isPending} checked={!!p[f]}
                    onChange={(e) => put.mutate({ ...p, [f]: e.target.checked ? 1 : 0 })} />
                </td>
              ))}
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
