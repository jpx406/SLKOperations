import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, Download, History, PackagePlus, Pencil, Plus, Printer, Scale, Search, Trash2, Truck, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  CATEGORIES, INVENTORY_LABEL, INVENTORY_MENU, KINDS, KIND_LABEL, MOVE_RULES, belowPar, type CountsAs, type Inventory as Inv, type Kind, type Location,
} from '../../shared/inventory';
import type { Job } from '../../shared/types';
import { csv } from '../../shared/xlsx';
import { ApiError, api, formatDate } from '../api';
import { useMe } from '../auth';
import { KpiTile, saveFile } from '../components/charts';
import { Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass, inputSized } from '../components/ui';

// Explosive (S18), Hardware (S19) and MCR (S29) inventories: stock by location from the ledger, movements,
// history with undo, and the per-well job reconciliation (S20).

interface Item { id: string; category: string; description: string; part_no: string | null; sap_no: string | null; uom: string; size: string | null; par_level: number | null; archived_at: string | null }
interface Data { country: string; locations: Location[]; items: Item[]; balances: { item_id: string; location_id: string; qty: number }[]; received: { item_id: string; qty: number }[] }
interface Move {
  id: string; kind: Kind | 'undo'; qty: number; job_id: string | null; well: string | null; note: string | null; created_by: string | null; created_at: string;
  reverses_id: string | null; description: string; uom: string; from_label: string | null; to_label: string | null; ticket_no: string | null; reversed_by: string | null;
}
interface Recon { rows: { job_id: string | null; well: string | null; item_id: string; mobilized: number; consumed: number; returned: number; junked: number; open: number }[]; jobs: { id: string; ticket_no: string | null; status: string; start_date: string | null }[]; items: { id: string; description: string; uom: string }[] }

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString();

export function Inventory({ inv }: { inv: Inv }) {
  const [params, setParams] = useSearchParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const canEdit = !!me?.menus[INVENTORY_MENU[inv]]?.edit;
  const country = params.get('country') ?? me?.countries[0] ?? '';
  const view = params.get('view') ?? '';
  const setP = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const data = useQuery({ queryKey: ['inventory', inv, country], queryFn: () => api<Data>(`/inventory/${inv}?country=${encodeURIComponent(country)}`), enabled: !!country });
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [dialog, setDialog] = useState<{ kind: 'item'; item: Item | null } | { kind: 'move'; move: Kind; job?: { jobId: string; well: string } } | { kind: 'consume' } | null>(null);
  // a job with an explosive service links here with ?mobilize=<job id>&well=<well>
  const mobilizeFor = params.get('mobilize');
  useEffect(() => {
    if (!mobilizeFor || !data.data || !canEdit) return;
    setDialog({ kind: 'move', move: 'mobilize', job: { jobId: mobilizeFor, well: params.get('well') ?? '' } });
    const n = new URLSearchParams(params); n.delete('mobilize'); n.delete('well'); setParams(n, { replace: true });
  }, [mobilizeFor, data.data, canEdit, params, setParams]);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['inventory', inv] }); qc.invalidateQueries({ queryKey: ['inv-moves', inv] }); qc.invalidateQueries({ queryKey: ['inv-recon', inv] }); };

  const d = data.data;
  const cols = (d?.locations ?? []).filter((l) => l.counts_as !== 'external' && l.counts_as !== 'used' && l.counts_as !== 'junk');
  const bal = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of d?.balances ?? []) m.set(`${b.item_id}|${b.location_id}`, b.qty);
    return m;
  }, [d]);
  const byCounts = (item: string, c: CountsAs) => (d?.locations ?? []).filter((l) => l.counts_as === c).reduce((a, l) => a + (bal.get(`${item}|${l.id}`) ?? 0), 0);
  const items = (d?.items ?? []).filter((i) => (archived ? !!i.archived_at : !i.archived_at) && (!cat || i.category === cat)
    && (!q || `${i.description} ${i.part_no ?? ''} ${i.sap_no ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const live = (d?.items ?? []).filter((i) => !i.archived_at);
  const total = (c: CountsAs) => live.reduce((a, i) => a + byCounts(i.id, c), 0);
  const received = (d?.received ?? []).reduce((a, r) => a + r.qty, 0);
  const cats = [...new Set([...CATEGORIES[inv], ...(d?.items ?? []).map((i) => i.category)])];
  const low = inv === 'mcr' ? belowPar(live, new Map(live.map((i) => [i.id, byCounts(i.id, 'on_hand')]))) : [];

  const exportCsv = () => saveFile(`${inv}-inventory-${new Date().toISOString().slice(0, 10)}.csv`, csv(
    ['Category', 'Description', 'Part no', 'SAP no', 'Unit', ...cols.map((l) => l.label), 'Used', 'Junk', 'Received', ...(inv === 'mcr' ? ['Par level'] : [])],
    items.map((i) => [i.category, i.description, i.part_no, i.sap_no, i.uom, ...cols.map((l) => bal.get(`${i.id}|${l.id}`) ?? 0), byCounts(i.id, 'used'), byCounts(i.id, 'junk'),
      d?.received.find((r) => r.item_id === i.id)?.qty ?? 0, ...(inv === 'mcr' ? [i.par_level] : [])]),
  ), 'text/csv;charset=utf-8');

  if (view === 'history') return <HistoryView inv={inv} country={country} canEdit={canEdit} onBack={() => setP('view', '')} onChange={refresh} />;
  if (view === 'reconciliation') return <ReconView inv={inv} country={country} onBack={() => setP('view', '')} />;

  return (
    <section aria-labelledby="inv-title">
      <PageTitle aside={
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {(me?.countries.length ?? 0) > 1 && (
            <select aria-label="Country" className={inputSized('h-(--layout-control-sm) w-40')} value={country} onChange={(e) => setP('country', e.target.value)}>{me?.countries.map((c) => <option key={c}>{c}</option>)}</select>
          )}
          <Button size="sm" onClick={exportCsv} disabled={!items.length}><Download aria-hidden className="size-4" />CSV</Button>
          <Button size="sm" onClick={() => window.print()} disabled={!items.length}><Printer aria-hidden className="size-4" />PDF</Button>
          <Button size="sm" onClick={() => setP('view', 'history')}><History aria-hidden className="size-4" />Movement history</Button>
          <Button size="sm" onClick={() => setP('view', 'reconciliation')}><Scale aria-hidden className="size-4" />Job reconciliation</Button>
        </div>
      }><span id="inv-title">{INVENTORY_LABEL[inv]}</span></PageTitle>

      {canEdit && (
        <div className="mb-4 flex flex-wrap gap-2 print:hidden">
          <Button variant="primary" onClick={() => setDialog({ kind: 'move', move: 'mobilize' })}><Truck aria-hidden className="size-4" />Mobilize to well</Button>
          <Button onClick={() => setDialog({ kind: 'consume' })}><PackagePlus aria-hidden className="size-4" />Consumption &amp; return</Button>
          <select aria-label="Record another movement" className={inputSized('h-(--layout-control-md) w-52')} value="" onChange={(e) => e.target.value && setDialog({ kind: 'move', move: e.target.value as Kind })}>
            <option value="">Other movement…</option>{KINDS.filter((k) => !['mobilize', 'consume', 'return'].includes(k)).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <Button onClick={() => setDialog({ kind: 'item', item: null })}><Plus aria-hidden className="size-4" />Add item</Button>
        </div>
      )}
      {notice && <div className="mb-3"><Banner tone="success">{notice}</Banner></div>}
      {low.length > 0 && <div className="mb-3"><Banner tone="warning">Below par level: {low.map((i) => `${i.description} (${fmt(i.on_hand)} of ${fmt(i.par_level!)})`).join(' · ')}. Check before committing to a job that needs it.</Banner></div>}

      {data.isPending && <Skeleton className="h-96" />}
      {data.isError && <Banner tone="danger">{data.error.message}</Banner>}
      {d && (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiTile label="On hand" value={fmt(total('on_hand'))} /><KpiTile label="At a well" value={fmt(total('at_well'))} />
            <KpiTile label="Used" value={fmt(total('used'))} /><KpiTile label="Junk" value={fmt(total('junk'))} />
            <KpiTile label="On order" value={fmt(total('on_order'))} /><KpiTile label="Received (total)" value={fmt(received)} />
          </dl>
          <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category">
              {['', ...cats].map((c) => (
                <button key={c || 'all'} type="button" role="radio" aria-checked={cat === c} onClick={() => setCat(c)}
                  className={cx('h-7 in-data-[density=touch]:h-11 rounded-pill border px-3 text-xs font-semibold', cat === c ? 'border-transparent bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>{c || 'All'}</button>
              ))}
            </div>
            <label className="relative ml-auto"><span className="sr-only">Search description, part or SAP number</span>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle" />
              <input className={inputSized('h-(--layout-control-sm) w-60 pl-8')} placeholder="Description, PN, SAP #" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <Button size="sm" variant={archived ? 'primary' : 'ghost'} aria-pressed={archived} onClick={() => setArchived(!archived)}><Archive aria-hidden className="size-4" />Archived</Button>
          </div>
          {!items.length ? <EmptyState title={archived ? 'Nothing archived' : d.items.length ? 'No items match' : 'No items yet'}>{!d.items.length && canEdit ? 'Add the items you stock, then record what you receive.' : undefined}</EmptyState> : (
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[56rem] text-sm">
                <thead className="bg-surface-2"><tr className="text-left text-xs text-text-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Material</th><th scope="col" className="px-3 py-2 font-semibold">PN · SAP #</th>
                  {cols.map((l) => <th key={l.id} scope="col" className="px-3 py-2 text-right font-semibold">{l.label}</th>)}
                  {inv === 'mcr' && <th scope="col" className="px-3 py-2 text-right font-semibold">Par</th>}
                  <th scope="col" className="w-20 print:hidden" />
                </tr></thead>
                <tbody>
                  {cats.filter((c) => items.some((i) => i.category === c)).map((c) => (
                    [<tr key={`h-${c}`}><th colSpan={cols.length + (inv === 'mcr' ? 4 : 3)} scope="colgroup" className="bg-bg px-3 py-1.5 text-left text-xs font-semibold text-text-muted">{c}</th></tr>,
                      ...items.filter((i) => i.category === c).map((i) => {
                        const short = i.par_level != null && byCounts(i.id, 'on_hand') < i.par_level;
                        return (
                          <tr key={i.id} className="border-t border-border">
                            <th scope="row" className="px-3 py-2 text-left font-semibold">{i.description}{i.size && <span className="ml-1 text-xs font-normal text-text-muted">{i.size}</span>}<span className="ml-1 text-xs font-normal text-text-subtle">({i.uom})</span></th>
                            <td className="px-3 py-2 font-mono text-xs">{i.part_no ?? '—'} · {i.sap_no ?? '—'}</td>
                            {cols.map((l) => { const v = bal.get(`${i.id}|${l.id}`) ?? 0; return <td key={l.id} className={cx('px-3 py-2 text-right font-mono', !v && 'text-text-subtle')}>{fmt(v)}</td>; })}
                            {inv === 'mcr' && <td className={cx('px-3 py-2 text-right font-mono', short && 'font-semibold text-warning')}>{i.par_level ?? '—'}</td>}
                            <td className="px-3 py-2 text-right whitespace-nowrap print:hidden">
                              {canEdit && <Button size="sm" variant="ghost" aria-label={`Edit ${i.description}`} onClick={() => setDialog({ kind: 'item', item: i })}><Pencil aria-hidden className="size-3.5" /></Button>}
                            </td>
                          </tr>
                        );
                      })]
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
      {d && dialog?.kind === 'item' && <ItemDialog inv={inv} country={country} item={dialog.item} cats={cats} onClose={(msg) => { setDialog(null); if (msg) { setNotice(msg); refresh(); } }} />}
      {d && dialog?.kind === 'move' && <MoveDialog inv={inv} data={d} bal={bal} initial={dialog.move} job={dialog.job} onClose={(msg) => { setDialog(null); if (msg) { setNotice(msg); refresh(); } }} />}
      {d && dialog?.kind === 'consume' && <ConsumeDialog inv={inv} data={d} onClose={(msg) => { setDialog(null); if (msg) { setNotice(msg); refresh(); } }} />}
    </section>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="inv-dlg" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className={cx('max-h-full w-full overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-pop', wide ? 'max-w-3xl' : 'max-w-xl')}>
        <div className="mb-3 flex items-start gap-3"><h2 id="inv-dlg" className="flex-1 font-display text-lg font-bold">{title}</h2><Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}><X aria-hidden className="size-4" /></Button></div>
        {children}
      </div>
    </div>
  );
}

function ItemDialog({ inv, country, item, cats, onClose }: { inv: Inv; country: string; item: Item | null; cats: string[]; onClose: (msg?: string) => void }) {
  const [f, setF] = useState({ category: item?.category ?? cats[0], description: item?.description ?? '', part_no: item?.part_no ?? '', sap_no: item?.sap_no ?? '', uom: item?.uom ?? 'ea', size: item?.size ?? '', par_level: item?.par_level != null ? String(item.par_level) : '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qs = `?country=${encodeURIComponent(country)}`;
  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy(true); setError(null);
    try {
      if (item) await api(`/inventory/${inv}/items/${item.id}${qs}`, { method: 'PATCH', json: { ...f, ...extra } }); else await api(`/inventory/${inv}/items${qs}`, { method: 'POST', json: f });
      onClose(`${item ? 'Saved' : 'Added'} ${f.description}${'archived' in extra ? (extra.archived ? ' (archived)' : ' (restored)') : ''}`);
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={item ? `Edit ${item.description}` : 'Add item'} onClose={() => onClose()}>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field id="it-cat" label="Category"><input id="it-cat" list="it-cats" className={inputClass} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        <datalist id="it-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        <Field id="it-desc" label="Description" required><input id="it-desc" className={inputClass} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field id="it-pn" label="Part number"><input id="it-pn" className={inputClass} value={f.part_no} onChange={(e) => setF({ ...f, part_no: e.target.value })} /></Field>
        <Field id="it-sap" label="SAP number"><input id="it-sap" className={inputClass} value={f.sap_no} onChange={(e) => setF({ ...f, sap_no: e.target.value })} /></Field>
        <Field id="it-uom" label="Unit"><select id="it-uom" className={inputClass} value={f.uom} disabled={!!item} onChange={(e) => setF({ ...f, uom: e.target.value })}>{['ea', 'm', 'ft', 'kg'].map((u) => <option key={u}>{u}</option>)}</select></Field>
        <Field id="it-size" label="Size"><input id="it-size" className={inputClass} value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} /></Field>
        {inv === 'mcr' && <Field id="it-par" label="Par level" hint="A reorder warning shows when on-hand stock drops below this"><input id="it-par" type="number" min={0} className={inputClass} value={f.par_level} onChange={(e) => setF({ ...f, par_level: e.target.value })} /></Field>}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" loading={busy}>Save</Button><Button onClick={() => onClose()}>Cancel</Button>
          {item && <Button className="ml-auto" variant="ghost" onClick={() => save({ archived: !item.archived_at })}><Archive aria-hidden className="size-4" />{item.archived_at ? 'Restore' : 'Archive'}</Button>}
        </div>
      </form>
    </Modal>
  );
}

function JobOrWell({ jobId, well, onChange }: { jobId: string; well: string; onChange: (v: { jobId: string; well: string }) => void }) {
  const [q, setQ] = useState('');
  const jobs = useQuery({ queryKey: ['jobs', q, 'all'], queryFn: () => api<Job[]>(`/jobs?q=${encodeURIComponent(q)}&status=all`) });
  const picked = jobs.data?.find((j) => j.id === jobId);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field id="mv-job" label="Job (field ticket)">
        <div>
          <input id="mv-job" className={inputClass} placeholder="Search ticket, well, unit" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border text-sm">
            {(jobs.data ?? []).slice(0, 15).map((j) => <li key={j.id}><button type="button" className="w-full px-2 py-1 text-left hover:bg-surface-2" onClick={() => { onChange({ jobId: j.id, well: j.well ?? well }); setQ(''); }}>
              <span className="font-mono">{j.ticket_no ?? 'no ticket'}</span> · {j.well ?? 'no well'} · {j.unit_number ?? '—'}</button></li>)}
          </ul>}
          {picked && <p className="mt-1 text-xs">Picked <span className="font-mono">{picked.ticket_no ?? 'no ticket'}</span> <button type="button" className="underline" onClick={() => onChange({ jobId: '', well })}>clear</button></p>}
          {!picked && jobId && <p className="mt-1 text-xs">A job is picked <button type="button" className="underline" onClick={() => onChange({ jobId: '', well })}>clear</button></p>}
        </div>
      </Field>
      <Field id="mv-well" label="Well" hint="Filled from the job; type it if there is no ticket yet"><input id="mv-well" className={inputClass} value={well} onChange={(e) => onChange({ jobId, well: e.target.value })} /></Field>
    </div>
  );
}

function MoveDialog({ inv, data, bal, initial, job, onClose }: { inv: Inv; data: Data; bal: Map<string, number>; initial: Kind; job?: { jobId: string; well: string }; onClose: (msg?: string) => void }) {
  const [kind, setKind] = useState<Kind>(initial);
  const rule = MOVE_RULES[kind];
  const fromOpts = data.locations.filter((l) => rule.from.includes(l.counts_as));
  const toOpts = data.locations.filter((l) => rule.to.includes(l.counts_as));
  const [from, setFrom] = useState(fromOpts[0]?.id ?? '');
  const [to, setTo] = useState(toOpts[0]?.id ?? '');
  const [jw, setJw] = useState(job ?? { jobId: '', well: '' });
  const [lines, setLines] = useState<{ item_id: string; qty: string }[]>([{ item_id: '', qty: '' }]);
  const [note, setNote] = useState('');
  const [adjustDir, setAdjustDir] = useState<'add' | 'remove'>('add');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientId] = useState(() => crypto.randomUUID());
  const items = data.items.filter((i) => kind === 'adjust' || !i.archived_at);
  const switchKind = (k: Kind) => {
    setKind(k);
    const r = MOVE_RULES[k];
    setFrom(data.locations.find((l) => r.from.includes(l.counts_as))?.id ?? '');
    setTo(data.locations.find((l) => r.to.includes(l.counts_as))?.id ?? '');
  };
  // a delivery or count correction has no source (or no destination); null is offered where the rules allow it
  const src = kind === 'adjust' ? (adjustDir === 'remove' ? from : '') : rule.from.includes(null) && !from ? '' : from;
  const dst = kind === 'adjust' ? (adjustDir === 'add' ? to : '') : to;
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api(`/inventory/${inv}/movements?country=${encodeURIComponent(data.country)}`, {
        method: 'POST',
        json: { client_id: clientId, kind, from_location_id: src || null, to_location_id: dst || null, job_id: jw.jobId || null, well: jw.well || null, note,
          lines: lines.filter((l) => l.item_id).map((l) => ({ item_id: l.item_id, qty: Number(l.qty) })) },
      });
      onClose(`${KIND_LABEL[kind]}: ${lines.filter((l) => l.item_id).length} item(s) recorded`);
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={KIND_LABEL[kind]} onClose={() => onClose()} wide>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      <div className="grid grid-cols-1 gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field id="mv-kind" label="Movement"><select id="mv-kind" className={inputClass} value={kind} onChange={(e) => switchKind(e.target.value as Kind)}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
          {kind === 'adjust' ? (
            <>
              <Field id="mv-dir" label="Correction"><select id="mv-dir" className={inputClass} value={adjustDir} onChange={(e) => setAdjustDir(e.target.value as 'add' | 'remove')}><option value="add">Found more (add)</option><option value="remove">Missing (take off)</option></select></Field>
              <Field id="mv-loc" label="Location"><select id="mv-loc" className={inputClass} value={adjustDir === 'add' ? to : from} onChange={(e) => (adjustDir === 'add' ? setTo(e.target.value) : setFrom(e.target.value))}>
                {data.locations.filter((l) => l.counts_as === 'on_hand').map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></Field>
            </>
          ) : (
            <>
              <Field id="mv-from" label="From"><select id="mv-from" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)}>
                {rule.from.includes(null) && <option value="">{kind === 'receive' ? 'Delivery (new stock)' : 'Outside (new)'}</option>}
                {fromOpts.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></Field>
              <Field id="mv-to" label="To"><select id="mv-to" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)}>{toOpts.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></Field>
            </>
          )}
        </div>
        {(rule.needsJob || kind === 'junk') && <JobOrWell jobId={jw.jobId} well={jw.well} onChange={setJw} />}
        <fieldset>
          <legend className="label-caps mb-2 text-text-muted">Items</legend>
          <ul className="space-y-2">
            {lines.map((l, n) => {
              const avail = src ? bal.get(`${l.item_id}|${src}`) ?? 0 : null;
              const item = data.items.find((i) => i.id === l.item_id);
              return (
                <li key={n} className="grid grid-cols-[1fr_7rem_auto] items-center gap-2">
                  <select aria-label={`Item ${n + 1}`} className={inputClass} value={l.item_id} onChange={(e) => setLines(lines.map((x, j) => (j === n ? { ...x, item_id: e.target.value } : x)))}>
                    <option value="">Choose…</option>{items.map((i) => <option key={i.id} value={i.id} disabled={lines.some((x, j) => j !== n && x.item_id === i.id)}>{i.description}{i.part_no ? ` · ${i.part_no}` : ''}</option>)}
                  </select>
                  <input aria-label={`Quantity ${n + 1}`} type="number" min={0} step="any" inputMode="decimal" className={inputClass} placeholder={item?.uom ?? 'qty'} value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === n ? { ...x, qty: e.target.value } : x)))} />
                  <Button size="sm" variant="ghost" aria-label={`Remove item ${n + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== n))}><Trash2 aria-hidden className="size-3.5" /></Button>
                  {l.item_id && avail !== null && <p className={cx('col-span-3 -mt-1 text-xs', Number(l.qty) > avail ? 'text-danger' : 'text-text-subtle')}>{fmt(avail)} {item?.uom} available at {data.locations.find((x) => x.id === src)?.label}</p>}
                </li>
              );
            })}
          </ul>
          <Button size="sm" className="mt-2" onClick={() => setLines([...lines, { item_id: '', qty: '' }])}><Plus aria-hidden className="size-3.5" />Add item</Button>
        </fieldset>
        <Field id="mv-note" label="Note"><input id="mv-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Waybill, PO or reason" /></Field>
        <div className="flex gap-2"><Button variant="primary" loading={busy} onClick={submit} disabled={!lines.some((l) => l.item_id && Number(l.qty) > 0)}>Record</Button><Button onClick={() => onClose()}>Cancel</Button></div>
      </div>
    </Modal>
  );
}

/** For one job or well: what is still at the well, and how much of it was used and how much comes back. */
function ConsumeDialog({ inv, data, onClose }: { inv: Inv; data: Data; onClose: (msg?: string) => void }) {
  const recon = useQuery({ queryKey: ['inv-recon', inv, data.country], queryFn: () => api<Recon>(`/inventory/${inv}/reconciliation?country=${encodeURIComponent(data.country)}`) });
  const openRows = (recon.data?.rows ?? []).filter((r) => r.open > 0);
  const groups = [...new Map(openRows.map((r) => [`${r.job_id ?? ''}|${(r.well ?? '').toLowerCase()}`, r])).values()];
  const [key, setKey] = useState('');
  const [vals, setVals] = useState<Record<string, { used: string; back: string }>>({});
  const [backTo, setBackTo] = useState(data.locations.find((l) => l.counts_as === 'on_hand')?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ids] = useState(() => [crypto.randomUUID(), crypto.randomUUID()]);
  const rows = openRows.filter((r) => `${r.job_id ?? ''}|${(r.well ?? '').toLowerCase()}` === key);
  const atWell = data.locations.find((l) => l.counts_as === 'at_well');
  const used = data.locations.find((l) => l.counts_as === 'used');
  const label = (r: Recon['rows'][number]) => `${recon.data?.jobs.find((j) => j.id === r.job_id)?.ticket_no ?? (r.job_id ? 'job' : 'no ticket')} · ${r.well ?? 'no well'}`;
  const submit = async () => {
    const first = rows[0];
    const lines = (field: 'used' | 'back') => rows.map((r) => ({ item_id: r.item_id, qty: Number(vals[r.item_id]?.[field] || 0) })).filter((l) => l.qty > 0);
    const over = rows.find((r) => Number(vals[r.item_id]?.used || 0) + Number(vals[r.item_id]?.back || 0) > r.open);
    if (over) { setError(`More than what is at the well for ${recon.data?.items.find((i) => i.id === over.item_id)?.description}`); return; }
    setBusy(true); setError(null);
    try {
      const base = { from_location_id: atWell?.id, job_id: first.job_id, well: first.well };
      if (lines('used').length) await api(`/inventory/${inv}/movements?country=${encodeURIComponent(data.country)}`, { method: 'POST', json: { ...base, client_id: ids[0], kind: 'consume', to_location_id: used?.id, lines: lines('used') } });
      if (lines('back').length) await api(`/inventory/${inv}/movements?country=${encodeURIComponent(data.country)}`, { method: 'POST', json: { ...base, client_id: ids[1], kind: 'return', to_location_id: backTo, lines: lines('back') } });
      onClose(`Recorded consumption and return for ${label(first)}`);
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Consumption & return" onClose={() => onClose()} wide>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      {recon.isPending ? <Skeleton className="h-32" /> : !groups.length ? <p className="text-sm text-text-muted">Nothing is out at a well right now. Mobilize first.</p> : (
        <div className="space-y-4">
          <Field id="cr-job" label="Job / well"><select id="cr-job" className={inputClass} value={key} onChange={(e) => { setKey(e.target.value); setVals({}); }}>
            <option value="">Choose…</option>{groups.map((g) => <option key={`${g.job_id}|${g.well}`} value={`${g.job_id ?? ''}|${(g.well ?? '').toLowerCase()}`}>{label(g)}</option>)}</select></Field>
          {rows.length > 0 && (
            <>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-text-muted"><th scope="col" className="py-1">Item</th><th scope="col" className="py-1 text-right">At the well</th><th scope="col" className="py-1 pl-3">Used</th><th scope="col" className="py-1 pl-3">Back to stock</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const item = recon.data?.items.find((i) => i.id === r.item_id);
                    return (
                      <tr key={r.item_id} className="border-t border-border">
                        <th scope="row" className="py-1.5 text-left font-normal">{item?.description}</th><td className="py-1.5 text-right font-mono">{fmt(r.open)} {item?.uom}</td>
                        {(['used', 'back'] as const).map((k) => <td key={k} className="py-1.5 pl-3"><input aria-label={`${k === 'used' ? 'Used' : 'Back to stock'}: ${item?.description}`} type="number" min={0} max={r.open} step="any" className={inputSized('h-(--layout-control-sm) w-24')}
                          value={vals[r.item_id]?.[k] ?? ''} onChange={(e) => setVals({ ...vals, [r.item_id]: { used: vals[r.item_id]?.used ?? '', back: vals[r.item_id]?.back ?? '', [k]: e.target.value } })} /></td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Field id="cr-back" label="Return to"><select id="cr-back" className={inputClass} value={backTo} onChange={(e) => setBackTo(e.target.value)}>{data.locations.filter((l) => l.counts_as === 'on_hand').map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></Field>
              <div className="flex gap-2"><Button variant="primary" loading={busy} onClick={submit}>Record</Button><Button onClick={() => onClose()}>Cancel</Button></div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function HistoryView({ inv, country, canEdit, onBack, onChange }: { inv: Inv; country: string; canEdit: boolean; onBack: () => void; onChange: () => void }) {
  const moves = useQuery({ queryKey: ['inv-moves', inv, country], queryFn: () => api<Move[]>(`/inventory/${inv}/movements?country=${encodeURIComponent(country)}`) });
  const [error, setError] = useState<string | null>(null);
  const undo = async (m: Move) => {
    if (!window.confirm(`Undo ${KIND_LABEL[m.kind]} of ${m.qty} × ${m.description}? A reversing movement is recorded; nothing is deleted.`)) return;
    try { await api(`/inventory/${inv}/movements/${m.id}/undo?country=${encodeURIComponent(country)}`, { method: 'POST' }); setError(null); onChange(); } catch (e) { setError((e as ApiError).message); }
  };
  return (
    <section aria-labelledby="hist-title">
      <div className="mb-4 flex items-center gap-3"><Button size="sm" onClick={onBack}><ArrowLeft aria-hidden className="size-4" />Back to items</Button><h1 id="hist-title" className="font-display text-xl font-extrabold uppercase">Movement history</h1></div>
      <p className="mb-3 text-sm text-text-muted">Movements are never edited or deleted. Undo records the opposite movement, and only while the stock is still where the original put it.</p>
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      {moves.isPending ? <Skeleton className="h-64" /> : !moves.data?.length ? <EmptyState title="No movements yet" /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="bg-surface-2"><tr className="text-left text-xs text-text-muted">{['When', 'Movement', 'Item', 'Qty', 'From → to', 'Job / well', 'By', ''].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {moves.data.map((m) => (
                <tr key={m.id} className={cx('border-t border-border', (m.reversed_by || m.kind === 'undo') && 'text-text-subtle')}>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{when(m.created_at)}</td>
                  <td className="px-3 py-2">{KIND_LABEL[m.kind]}{m.reversed_by && <span className="ml-1 text-xs">(undone)</span>}</td>
                  <td className="px-3 py-2">{m.description}{m.note && <span className="block text-xs text-text-subtle">{m.note}</span>}</td>
                  <td className="px-3 py-2 font-mono">{fmt(m.qty)} {m.uom}</td>
                  <td className="px-3 py-2 text-xs">{m.from_label ?? 'in'} → {m.to_label ?? 'out'}</td>
                  <td className="px-3 py-2 text-xs">{m.job_id ? <Link className="font-mono underline" to={`/operation/jobs/${m.job_id}/execution`}>{m.ticket_no ?? 'job'}</Link> : null}{m.well && <span className="ml-1">{m.well}</span>}</td>
                  <td className="px-3 py-2 text-xs">{m.created_by}</td>
                  <td className="px-3 py-2 text-right">{canEdit && !m.reversed_by && m.kind !== 'undo' && <Button size="sm" variant="ghost" onClick={() => undo(m)}><Undo2 aria-hidden className="size-3.5" />Undo</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}

function ReconView({ inv, country, onBack }: { inv: Inv; country: string; onBack: () => void }) {
  const r = useQuery({ queryKey: ['inv-recon', inv, country], queryFn: () => api<Recon>(`/inventory/${inv}/reconciliation?country=${encodeURIComponent(country)}`) });
  const rows = r.data?.rows ?? [];
  return (
    <section aria-labelledby="recon-title">
      <div className="mb-4 flex items-center gap-3"><Button size="sm" onClick={onBack}><ArrowLeft aria-hidden className="size-4" />Back to items</Button><h1 id="recon-title" className="font-display text-xl font-extrabold uppercase">Job reconciliation</h1></div>
      <p className="mb-3 text-sm text-text-muted">For every well: mobilized = consumed + returned + junked. Anything left open is still out at the well; on a completed job it needs a Consumption &amp; return entry.</p>
      {r.isPending ? <Skeleton className="h-64" /> : !rows.length ? <EmptyState title="No moves to or from a well logged yet" /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-surface-2"><tr className="text-left text-xs text-text-muted">{['Job', 'Well', 'Item', 'Mobilized', 'Consumed', 'Returned', 'Junked', 'Still out'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((x, n) => {
                const job = r.data?.jobs.find((j) => j.id === x.job_id);
                const item = r.data?.items.find((i) => i.id === x.item_id);
                const flag = x.open !== 0 && job?.status === 'completed';
                return (
                  <tr key={n} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{job ? <Link className="underline" to={`/operation/jobs/${job.id}/execution`}>{job.ticket_no ?? 'no ticket'}</Link> : '—'}{job?.start_date && <span className="ml-1 text-text-subtle">{formatDate(job.start_date)}</span>}</td>
                    <td className="px-3 py-2">{x.well ?? '—'}</td><td className="px-3 py-2">{item?.description}</td>
                    {[x.mobilized, x.consumed, x.returned, x.junked].map((v, i) => <td key={i} className="px-3 py-2 font-mono">{fmt(v)}</td>)}
                    <td className={cx('px-3 py-2 font-mono font-semibold', x.open === 0 ? 'text-success' : flag ? 'text-danger' : 'text-warning')}>{fmt(x.open)}{flag && <span className="ml-1 text-xs font-normal">job completed</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}
