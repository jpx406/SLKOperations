import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, FilePlus2, FileUp, Pencil, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { APPLIES_IF, FORM_KINDS, type FormKind, type FormTemplate } from '../../shared/forms';
import type { Question } from '../../shared/jra';
import { STAGES, STAGE_LABEL, type Stage } from '../../shared/stages';
import { ApiError, api, countryScope } from '../api';
import { useMe } from '../auth';
import { Select } from '../components/Select';
import { Badge, Banner, Button, Card, EmptyState, Field, PageTitle, Skeleton, cx, inputClass, inputSized } from '../components/ui';

// Administration → Form templates (owner request 2026-10-28). The JRA and the job checklists: each belongs to a
// job stage and is made by hand, read from a Word or Excel file, or drafted with the AI assistant, then reviewed
// here before it is saved. A template jobs already filled keeps its questions; changes become the next revision.

type Listed = FormTemplate & { id: string; used: number; changed_by: string | null; updated_at: string | null };
type Draft = Omit<FormTemplate, 'country' | 'active'> & { id?: string; country?: string; active?: boolean };

const blank = (stage: Stage = 'preparation', kind: FormKind = 'checklist'): Draft => ({
  name: '', kind, stage, code: '', revision: '1', sections: { A: 'General' }, title: '',
  questions: [{ id: 'A1', section: 'A', text: '', risk_if: 'no', points: 0, required: true }],
  approval_levels: kind === 'jra' ? [{ min: 0, label: 'SDM' }, { min: 20, label: 'Operations Manager' }, { min: 35, label: 'Country Manager' }] : [],
});

export function FormTemplates() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['form-templates'], queryFn: () => api<Listed[]>('/form-templates') });
  const [stage, setStage] = useState<Stage | ''>('');
  const [kind, setKind] = useState<FormKind | ''>('');
  const [q, setQ] = useState('');
  const [showOff, setShowOff] = useState(false);
  const [draft, setDraft] = useState<{ d: Draft; lines?: string[]; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const canEdit = !!me?.menus.form_templates?.edit;
  const canDelete = !!me?.menus.form_templates?.delete;

  const read = async (f: File) => {
    setBusy('read'); setError(null);
    try {
      const r = await api<{ draft: Draft; lines: string[]; source: string }>('/form-templates/read', { method: 'POST', body: f, headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) } });
      const found = r.draft.questions.length;
      setDraft({
        d: { ...r.draft, revision: r.draft.revision || '1' }, lines: r.lines,
        note: r.source === 'jra-form' ? `Read ${f.name} as NESR’s JRA form: ${found} questions with their points and approval levels. Check them and save.`
          : `Read ${f.name}: ${found} question${found === 1 ? '' : 's'} found. Check them, or ask the AI assistant (right) to build the template from the file.`,
      });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); if (file.current) file.current.value = ''; }
  };
  const toggle = async (t: Listed) => {
    setError(null);
    try { await api(`/form-templates/${t.id}`, { method: 'PUT', json: { active: !t.active } }); await qc.invalidateQueries({ queryKey: ['form-templates'] }); }
    catch (e) { setError((e as Error).message); }
  };
  const remove = async (t: Listed) => {
    if (!confirm(`Delete “${t.name}” ${t.code} Rev ${t.revision}? This can’t be undone.`)) return;
    setError(null);
    try { await api(`/form-templates/${t.id}`, { method: 'DELETE' }); await qc.invalidateQueries({ queryKey: ['form-templates'] }); }
    catch (e) { setError((e as Error).message); }
  };

  if (draft) return <TemplateEditor init={draft.d} lines={draft.lines} note={draft.note} countries={me?.countries ?? []} onClose={(saved) => { setDraft(null); if (saved) qc.invalidateQueries({ queryKey: ['form-templates'] }); }} />;

  const rows = (list.data ?? []).filter((t) => (showOff || t.active) && (!stage || t.stage === stage) && (!kind || t.kind === kind)
    && (!q.trim() || `${t.name} ${t.code} ${t.source_file ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <section aria-labelledby="ft-title">
      <PageTitle aside={canEdit && (
        <>
          <input ref={file} type="file" accept=".docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" tabIndex={-1} aria-label="Word or Excel file to read"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }} />
          <Button loading={busy === 'read'} onClick={() => file.current?.click()}><FileUp aria-hidden className="size-4" />From Word / Excel</Button>
          <Button onClick={() => setDraft({ d: blank(), note: 'Describe the form on the right and the AI assistant drafts it, or type the questions yourself.' })}><Sparkles aria-hidden className="size-4" />With the AI assistant</Button>
          <Button variant="primary" onClick={() => setDraft({ d: blank() })}><FilePlus2 aria-hidden className="size-4" />New template</Button>
        </>
      )}><span id="ft-title">Form templates</span></PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-muted">
        The JRA and the checklists filled on each job. A template shows on the job stage it belongs to. One JRA is in use per country; turning another on replaces it.
        A template that jobs already filled can’t be deleted, and new questions on it are saved as the next revision.
      </p>
      {error && <div className="mb-3"><Banner tone="danger" action={<Button size="sm" variant="ghost" aria-label="Dismiss" onClick={() => setError(null)}><X aria-hidden className="size-4" /></Button>}>{error}</Banner></div>}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-card-edge bg-surface p-3">
        <div role="radiogroup" aria-label="Job stage" className="flex flex-wrap gap-1.5">
          {([['', 'All stages'], ...STAGES.map((s) => [s, STAGE_LABEL[s]])] as [Stage | '', string][]).map(([k, l]) => (
            <button key={k || 'all'} type="button" role="radio" aria-checked={stage === k} onClick={() => setStage(k)}
              className={cx('h-(--layout-control-sm) rounded-pill border px-3 text-sm font-semibold', stage === k ? 'border-accent-text bg-accent text-on-accent' : 'border-border text-text-muted hover:text-text')}>{l}</button>
          ))}
        </div>
        <label className="ml-2 inline-flex items-center gap-2 text-sm"><span className="text-text-muted">Kind</span>
          <Select className={inputSized('w-52')} value={kind} onChange={(e) => setKind(e.target.value as FormKind | '')}>
            <option value="">All</option>{Object.entries(FORM_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </label>
        <label className="relative block">
          <span className="sr-only">Search templates</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-subtle" />
          <input className={inputSized('w-60 pl-9')} placeholder="Name, code or file" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-text-muted"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />Show templates not in use</label>
        <span className="ml-auto font-mono text-xs text-text-muted">{rows.length} of {list.data?.length ?? 0}</span>
      </div>

      {list.isPending && <Skeleton className="h-64" />}
      {list.isError && <Banner tone="danger">{list.error.message}</Banner>}
      {list.data && !rows.length && (
        <EmptyState title={list.data.length ? 'No template matches' : 'No templates yet'}>
          {list.data.length ? 'Try another stage, kind or search, or show the templates not in use.' : 'Start from a Word or Excel file, with the AI assistant, or from a blank template. The JRA appears here the first time a job opens it.'}
        </EmptyState>
      )}
      {rows.length > 0 && STAGES.filter((s) => rows.some((t) => t.stage === s)).map((s) => (
        <section key={s} aria-label={STAGE_LABEL[s]} className="mb-5">
          <h2 className="label-caps mb-2 text-text-muted">{STAGE_LABEL[s]}</h2>
          <ul className="flex flex-col gap-2">
            {rows.filter((t) => t.stage === s).map((t) => (
              <li key={t.id} className={cx('grid grid-cols-1 items-center gap-x-5 gap-y-2 rounded-lg border border-card-edge bg-surface p-3 shadow-card md:grid-cols-[minmax(0,1fr)_auto_auto]', !t.active && 'opacity-70')}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-display text-base font-bold">{t.name}</span>
                    <Badge>{t.kind === 'jra' ? 'JRA' : t.kind === 'package' ? 'Job package' : 'Checklist'}</Badge>
                    <span className="font-mono text-xs text-text-muted">{t.code} Rev {t.revision}</span>
                    {(me?.countries.length ?? 0) > 1 && <span className="text-xs text-text-subtle">{t.country}</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {t.questions.length} question{t.questions.length === 1 ? '' : 's'} in {Object.keys(t.sections).length} section{Object.keys(t.sections).length === 1 ? '' : 's'}
                    {t.used ? ` · filled on ${t.used} job${t.used === 1 ? '' : 's'}` : ' · not used yet'}
                    {t.source_file ? ` · from ${t.source_file}` : ''}
                    {t.changed_by ? ` · ${t.changed_by}${t.updated_at ? `, ${new Date(t.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}` : ''}
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" role="switch" checked={t.active} disabled={!canEdit} onChange={() => toggle(t)} />
                  {t.active ? 'In use' : 'Not in use'}
                </label>
                <span className="flex gap-1.5 md:justify-end">
                  <Button size="sm" onClick={() => setDraft({ d: t })}><Pencil aria-hidden className="size-3.5" />{canEdit ? 'Edit' : 'View'}</Button>
                  {canEdit && <Button size="sm" onClick={() => setDraft({ d: { ...t, id: undefined, name: `${t.name} (copy)`, code: `${t.code}-COPY`, revision: '1', active: true }, note: 'A copy: change what you need and save it as a new template.' })}>Copy</Button>}
                  {canDelete && <Button size="sm" variant="ghost" aria-label={`Delete ${t.name}`} disabled={t.used > 0} title={t.used ? 'Filled on jobs: switch it off instead' : undefined} onClick={() => remove(t)}><Trash2 aria-hidden className="size-3.5" /></Button>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

const nextLetter = (sections: Record<string, string>) => { for (let i = 0; i < 26; i++) { const k = String.fromCharCode(65 + i); if (!(k in sections)) return k; } return `S${Object.keys(sections).length + 1}`; };

/** The template editor: details, sections, questions (and the JRA's points and approval levels), with the AI assistant beside it. */
function TemplateEditor({ init, lines, note, countries, onClose }: { init: Draft; lines?: string[]; note?: string; countries: string[]; onClose: (saved: boolean) => void }) {
  const { data: me } = useMe();
  const canEdit = !!me?.menus.form_templates?.edit;
  const [d, setD] = useState<Draft>({ country: init.country ?? (countries.includes(countryScope() ?? '') ? countryScope()! : countries[0]), active: init.active ?? true, ...init });
  const [docLines, setDocLines] = useState(lines);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(note ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revise, setRevise] = useState<string | null>(null);
  const [ask, setAsk] = useState('');
  const [aiNote, setAiNote] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const jra = d.kind === 'jra';
  const pkg = d.kind === 'package';
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const setQ = (i: number, p: Partial<Question>) => set({ questions: d.questions.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const move = (i: number, by: number) => { const qs = [...d.questions]; const [x] = qs.splice(i, 1); qs.splice(Math.max(0, Math.min(qs.length, i + by)), 0, x); set({ questions: qs }); };
  const addQ = (section: string) => {
    const at = d.questions.map((x) => x.section).lastIndexOf(section);
    const qs = [...d.questions];
    qs.splice(at < 0 ? qs.length : at + 1, 0, { id: '', section, text: '', risk_if: 'no', points: 0, required: true });
    set({ questions: qs });
  };

  const save = async (newRevision = false) => {
    setBusy('save'); setError(null);
    try {
      const body = { ...d, new_revision: newRevision || undefined };
      if (d.id) await api(`/form-templates/${d.id}`, { method: 'PUT', json: body });
      else await api('/form-templates', { method: 'POST', json: body });
      onClose(true);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.body?.needs_revision) setRevise(err.message);
      else setError(err.message);
    } finally { setBusy(null); }
  };
  const readFile = async (f: File) => {
    setBusy('read'); setError(null);
    try {
      const r = await api<{ draft: Draft; lines: string[] }>('/form-templates/read', { method: 'POST', body: f, headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) } });
      setDocLines(r.lines);
      set({ source_file: f.name });
      setNotice(`${f.name} is attached for the assistant (${r.lines.length} lines). Ask it to build or update the template from the file.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); if (file.current) file.current.value = ''; }
  };
  const askAi = async () => {
    setBusy('ai'); setError(null); setAiNote(null);
    try {
      const hasContent = d.questions.some((x) => x.text.trim());
      const r = await api<{ draft: Draft; summary: string }>('/form-templates/ai', { method: 'POST', json: { lines: docLines, instructions: ask, draft: hasContent ? d : undefined } });
      setD((x) => ({ ...x, ...r.draft, id: x.id, country: x.country, active: x.active, kind: x.id ? x.kind : r.draft.kind, source_file: x.source_file ?? r.draft.source_file }));
      setAiNote(r.summary || 'Draft updated. Check it before saving.');
      setAsk('');
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const sectionKeys = Object.keys(d.sections);
  const ok = d.name.trim() && d.questions.some((x) => x.text.trim()) && (!jra || d.approval_levels.length > 0);
  return (
    <section aria-labelledby="fte-title">
      <PageTitle aside={
        <>
          <Button onClick={() => onClose(false)}>{canEdit ? 'Cancel' : 'Back'}</Button>
          {canEdit && <Button variant="primary" loading={busy === 'save'} disabled={!ok} onClick={() => save()}><Check aria-hidden className="size-4" />Save template</Button>}
        </>
      }><span id="fte-title">{d.id ? `Edit ${init.name}` : 'New form template'}</span></PageTitle>
      {notice && <div className="mb-3"><Banner tone="info" action={<Button size="sm" variant="ghost" aria-label="Dismiss" onClick={() => setNotice(null)}><X aria-hidden className="size-4" /></Button>}>{notice}</Banner></div>}
      {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
      {revise && (
        <div className="mb-3"><Banner tone="warning" action={<span className="flex gap-2"><Button size="sm" variant="primary" loading={busy === 'save'} onClick={() => { setRevise(null); save(true); }}>Save as next revision</Button><Button size="sm" variant="ghost" onClick={() => setRevise(null)}>Cancel</Button></span>}>{revise}</Banner></div>
      )}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <Card>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field id="ft-name" label="Name" required><input id="ft-name" className={inputClass} value={d.name} disabled={!canEdit} placeholder="e.g. Rig-up checklist" onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field id="ft-kind" label="Kind" hint={d.id ? 'Fixed once saved' : jra ? 'Risk points and approval levels; one in use per country' : pkg ? 'The documents uploaded on Closure; one in use per country' : 'Yes / No / N/A with remarks, then approved by the SDM'}>
                <Select id="ft-kind" className={inputClass} value={d.kind} disabled={!canEdit || !!d.id}
                  onChange={(e) => { const k = e.target.value as FormKind; set({ kind: k, ...(k === 'package' ? { stage: 'closure' as Stage } : {}), approval_levels: k === 'jra' && !d.approval_levels.length ? blank('preparation', 'jra').approval_levels : d.approval_levels }); }}>
                  {Object.entries(FORM_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
              <Field id="ft-stage" label="Job stage" hint={pkg ? 'The job package is always on Closure' : 'Where the form shows on the job'}>
                <Select id="ft-stage" className={inputClass} value={d.stage} disabled={!canEdit || pkg} onChange={(e) => set({ stage: e.target.value as Stage })}>
                  {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </Select>
              </Field>
              <Field id="ft-code" label="Code" hint="The form number, e.g. QAF14021 (made from the name when empty)"><input id="ft-code" className={inputClass} value={d.code} disabled={!canEdit} onChange={(e) => set({ code: e.target.value })} /></Field>
              <Field id="ft-rev" label="Revision"><input id="ft-rev" className={inputClass} value={d.revision} disabled={!canEdit} onChange={(e) => set({ revision: e.target.value })} /></Field>
              {countries.length > 1 && !d.id
                ? <Field id="ft-country" label="Country"><Select id="ft-country" className={inputClass} value={d.country} onChange={(e) => set({ country: e.target.value })}>{countries.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
                : <Field id="ft-active" label="In use"><label className="flex h-(--layout-control-md) items-center gap-2 text-sm"><input id="ft-active" type="checkbox" checked={!!d.active} disabled={!canEdit} onChange={(e) => set({ active: e.target.checked })} />{d.active ? 'New jobs get this template' : 'Kept on record only'}</label></Field>}
            </div>
            {d.source_file && <p className="mt-3 text-xs text-text-subtle">Made from {d.source_file}</p>}
          </Card>

          {jra && (
            <Card>
              <h2 className="mb-1 font-display text-base font-bold uppercase">Approval levels</h2>
              <p className="mb-3 text-xs text-text-muted">From which total risk score each role approves the JRA. Who holds each level is set in Users & Roles → Approvals.</p>
              <ul className="space-y-2">
                {d.approval_levels.map((l, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-2 text-sm text-text-muted">From score
                      <input type="number" min={0} className={inputSized('w-20')} disabled={!canEdit || i === 0} value={l.min} onChange={(e) => set({ approval_levels: d.approval_levels.map((x, j) => (j === i ? { ...x, min: Math.max(0, Number(e.target.value) || 0) } : x)) })} />
                    </label>
                    <input aria-label={`Approver for level ${i + 1}`} className={inputSized('w-64')} disabled={!canEdit} value={l.label} onChange={(e) => set({ approval_levels: d.approval_levels.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    {canEdit && d.approval_levels.length > 1 && <Button size="sm" variant="ghost" aria-label={`Remove level ${l.label}`} onClick={() => set({ approval_levels: d.approval_levels.filter((_, j) => j !== i) })}><X aria-hidden className="size-3.5" /></Button>}
                  </li>
                ))}
              </ul>
              {canEdit && <Button size="sm" className="mt-2" onClick={() => set({ approval_levels: [...d.approval_levels, { min: (d.approval_levels.at(-1)?.min ?? 0) + 10, label: '' }] })}><Plus aria-hidden className="size-3.5" />Add level</Button>}
            </Card>
          )}

          {sectionKeys.map((k) => {
            const items = d.questions.map((x, i) => [x, i] as const).filter(([x]) => x.section === k);
            return (
              <Card key={k}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-accent-text">{k}</span>
                  <input aria-label={`Section ${k} title`} className={inputSized('min-w-0 flex-1 font-semibold')} disabled={!canEdit} value={d.sections[k]} onChange={(e) => set({ sections: { ...d.sections, [k]: e.target.value } })} />
                  {canEdit && sectionKeys.length > 1 && (
                    <Button size="sm" variant="ghost" aria-label={`Remove section ${d.sections[k]}`} title={items.length ? 'Its questions move to the first section' : undefined}
                      onClick={() => { const rest = Object.fromEntries(Object.entries(d.sections).filter(([x]) => x !== k)); const first = Object.keys(rest)[0]; set({ sections: rest, questions: d.questions.map((x) => (x.section === k ? { ...x, section: first } : x)) }); }}>
                      <Trash2 aria-hidden className="size-3.5" />
                    </Button>
                  )}
                </div>
                <ol className="space-y-2">
                  {items.map(([x, i], n) => (
                    <li key={i} className="rounded-md border border-border p-2.5">
                      <div className="flex items-start gap-2">
                        <span className="mt-2 w-8 shrink-0 font-mono text-xs text-text-subtle">{k}{n + 1}</span>
                        <textarea aria-label={`Question ${k}${n + 1}`} rows={1} className={cx(inputClass, 'h-auto min-h-(--layout-control-md) py-2')} disabled={!canEdit} value={x.text} placeholder={pkg ? 'The document, e.g. Field ticket signed by the client' : 'The question, answered Yes / No / N/A'}
                          onChange={(e) => setQ(i, { text: e.target.value })} />
                        {canEdit && (
                          <span className="flex shrink-0">
                            <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp aria-hidden className="size-3.5" /></Button>
                            <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === d.questions.length - 1} onClick={() => move(i, 1)}><ArrowDown aria-hidden className="size-3.5" /></Button>
                            <Button size="sm" variant="ghost" aria-label={`Remove question ${k}${n + 1}`} disabled={d.questions.length === 1} onClick={() => set({ questions: d.questions.filter((_, j) => j !== i) })}><Trash2 aria-hidden className="size-3.5" /></Button>
                          </span>
                        )}
                      </div>
                      <div className="mt-2 ml-10 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={x.required} disabled={!canEdit} onChange={(e) => setQ(i, { required: e.target.checked })} />{pkg ? 'Must be uploaded' : 'Required'}</label>
                        {pkg ? (
                          <label className="inline-flex items-center gap-1.5 text-text-muted">Needed when the job has
                            <Select className={inputSized('h-(--layout-control-sm) w-56')} value={x.applies_if ?? 'always'} disabled={!canEdit} onChange={(e) => setQ(i, { applies_if: e.target.value === 'always' ? undefined : e.target.value })}>
                              {Object.entries(APPLIES_IF).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                            </Select>
                          </label>
                        ) : <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!x.options || x.options.includes('na')} disabled={!canEdit} onChange={(e) => setQ(i, { options: e.target.checked ? undefined : ['yes', 'no'] })} />N/A allowed</label>}
                        {sectionKeys.length > 1 && (
                          <label className="inline-flex items-center gap-1.5 text-text-muted">Section
                            <Select className={inputSized('h-(--layout-control-sm) w-40')} value={x.section} disabled={!canEdit} onChange={(e) => setQ(i, { section: e.target.value })}>
                              {sectionKeys.map((s) => <option key={s} value={s}>{s} · {d.sections[s]}</option>)}
                            </Select>
                          </label>
                        )}
                        {jra && !x.scores && (
                          <>
                            <label className="inline-flex items-center gap-1.5 text-text-muted">Risky answer
                              <Select className={inputSized('h-(--layout-control-sm) w-24')} value={x.risk_if} disabled={!canEdit} onChange={(e) => setQ(i, { risk_if: e.target.value as 'yes' | 'no' })}><option value="yes">Yes</option><option value="no">No</option></Select>
                            </label>
                            <label className="inline-flex items-center gap-1.5 text-text-muted">Points
                              <input type="number" min={0} max={100} className={inputSized('h-(--layout-control-sm) w-20')} disabled={!canEdit} value={x.points} onChange={(e) => setQ(i, { points: Math.max(0, Number(e.target.value) || 0) })} />
                            </label>
                          </>
                        )}
                        {jra && x.scores && <span className="text-xs text-text-muted">Points per answer from the form: {Object.entries(x.scores).map(([a, p]) => `${a.toUpperCase()} ${p}`).join(', ')}</span>}
                        <input aria-label={`Guidance for ${k}${n + 1}`} className={inputSized('h-(--layout-control-sm) min-w-48 flex-1')} disabled={!canEdit} value={x.guidance ?? ''} placeholder="Guidance shown under the question (optional)" onChange={(e) => setQ(i, { guidance: e.target.value || undefined })} />
                      </div>
                    </li>
                  ))}
                </ol>
                {canEdit && <Button size="sm" className="mt-2" onClick={() => addQ(k)}><Plus aria-hidden className="size-3.5" />Add question</Button>}
              </Card>
            );
          })}
          {canEdit && <Button onClick={() => { const k = nextLetter(d.sections); set({ sections: { ...d.sections, [k]: 'New section' }, questions: [...d.questions, { id: '', section: k, text: '', risk_if: 'no', points: 0, required: true }] }); }}><Plus aria-hidden className="size-4" />Add section</Button>}
        </div>

        {canEdit && (
          <aside aria-labelledby="ai-title" className="xl:sticky xl:top-4 xl:self-start">
            <Card>
              <h2 id="ai-title" className="mb-1 flex items-center gap-2 font-display text-base font-bold uppercase"><Sparkles aria-hidden className="size-4 text-accent-text" />AI assistant</h2>
              <p className="mb-3 text-xs text-text-muted">It reads the attached file and the template above, and returns a draft you check before saving. Nothing is saved until you press Save.</p>
              <input ref={file} type="file" accept=".docx,.xlsx" className="sr-only" tabIndex={-1} aria-label="Word or Excel file to read" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }} />
              <p className="mb-2 flex items-center gap-2 text-sm">
                {docLines?.length ? <span className="min-w-0 flex-1 truncate">File: <b>{d.source_file ?? 'attached'}</b></span> : <span className="flex-1 text-text-muted">No file attached</span>}
                <Button size="sm" loading={busy === 'read'} onClick={() => file.current?.click()}><FileUp aria-hidden className="size-3.5" />{docLines?.length ? 'Other file' : 'Attach Word / Excel'}</Button>
              </p>
              <label htmlFor="ai-ask" className="label-caps mb-1.5 block text-text-muted">What should it do?</label>
              <textarea id="ai-ask" rows={4} className={cx(inputClass, 'h-auto py-2')} value={ask} onChange={(e) => setAsk(e.target.value)}
                placeholder={docLines?.length ? 'e.g. Build the checklist from the file, Execution stage' : 'e.g. A rig-down checklist for slickline: pressure bleed-off, lubricator, wire, housekeeping'} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(docLines?.length ? ['Build the template from the file', 'Group the questions into sections', 'Rephrase items as Yes / No questions'] : ['Add questions on H₂S and pressure', 'Group the questions into sections', 'Shorten the questions']).map((s) => (
                  <button key={s} type="button" className="rounded-pill border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text" onClick={() => setAsk(s)}>{s}</button>
                ))}
              </div>
              <Button className="mt-3 w-full" variant="primary" loading={busy === 'ai'} disabled={!ask.trim() && !docLines?.length} onClick={askAi}><Sparkles aria-hidden className="size-4" />Ask the assistant</Button>
              {busy === 'ai' && <p className="mt-2 text-xs text-text-muted" aria-live="polite">Working on it. A long form can take a minute.</p>}
              {aiNote && <div className="mt-3"><Banner tone="success">{aiNote}</Banner></div>}
            </Card>
          </aside>
        )}
      </div>
    </section>
  );
}
