import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Send, Settings, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AiSettings } from '../../shared/ai';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { Markdown } from '../components/Markdown';
import { Banner, Button, Card, Field, PageTitle, Skeleton, cx, inputClass, inputSized } from '../components/ui';

// AI Agent (S35, Administrator Manual 6). Questions answered from the person's own data, read through
// the pages they can open. Admins also set it on or off, the model, the shared monthly budget and the daily limit.

interface Status { enabled: boolean; configured: boolean; model?: string; sentToday: number; dailyLimit: number; blocked: string | null; tools: string[]; starters: string[] }
interface Msg { role: 'user' | 'assistant'; content: string; note?: string | null; tools?: { name: string; ok: boolean }[] }
const TOOL_LABEL: Record<string, string> = {
  job_statistics: 'Statistics', find_jobs: 'Jobs', get_job: 'Job', failure_roster: 'Failure Roster', eight_min_facts: '8 Min. Facts',
  attendance_month: 'Attendance', reconciliation_findings: 'Reconciliation', sales_revenue: 'Sales',
};

export function AiAgent() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api<Status>('/ai/status'), enabled: !!me?.menus.ai_agent?.view });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [msgs]);
  const ask = useMutation({
    mutationFn: (history: Msg[]) => api<{ reply: string; note: string | null; tools: { name: string; ok: boolean }[] }>('/ai/chat', { method: 'POST', json: { messages: history.map(({ role, content }) => ({ role, content })) } }),
    onSuccess: (r) => setMsgs((m) => [...m, { role: 'assistant', content: r.reply, note: r.note, tools: r.tools }]),
    onError: (e) => { setError((e as ApiError).message); setMsgs((m) => m.slice(0, -1)); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['ai-status'] }),
  });
  const send = (text: string) => {
    const t = text.trim();
    if (!t || ask.isPending) return;
    const next = [...msgs, { role: 'user' as const, content: t }];
    setMsgs(next); setDraft(''); setError(null);
    ask.mutate(next);
  };
  const isAdmin = !!me?.menus.users?.edit;
  const s = status.data;
  const blocked = s ? (!s.configured ? 'The AI Agent isn’t set up yet: the Anthropic API key is missing on the server.' : s.blocked) : null;

  return (
    <section aria-labelledby="ai-title">
      <PageTitle aside={s && <span className="font-mono text-xs text-text-muted">{s.model} · {s.sentToday}/{s.dailyLimit} today</span>}><span id="ai-title">AI Agent</span></PageTitle>
      {!me?.menus.ai_agent?.view ? <Banner tone="info">Your access doesn’t include the AI Agent.</Banner> : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card className="flex min-h-[28rem] flex-col">
            <p className="mb-3 text-sm text-text-muted">Ask about jobs, NPT, failures, attendance, reconciliation or revenue. Answers come only from pages you can open; the agent can’t change anything.</p>
            {blocked && <div className="mb-3"><Banner tone="warning">{blocked}</Banner></div>}
            {error && <div className="mb-3"><Banner tone="danger">{error}</Banner></div>}
            <div role="log" aria-live="polite" aria-label="Conversation" className="flex-1 space-y-3 overflow-y-auto">
              {status.isLoading && <Skeleton className="h-24" />}
              {s && !msgs.length && (
                <div>
                  <h2 className="label-caps mb-2 text-text-muted">Try asking</h2>
                  <div className="flex flex-wrap gap-2">
                    {s.starters.map((p) => <button key={p} type="button" disabled={!!blocked} onClick={() => send(p)} className="rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-50">{p}</button>)}
                  </div>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={cx('max-w-[52rem] rounded-md px-3 py-2 text-sm', m.role === 'user' ? 'ml-auto w-fit bg-info-subtle' : 'bg-surface-2')}>
                  {m.role === 'assistant' ? <Markdown text={m.content} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
                  {m.note && <p className="mt-1 text-xs text-warning">{m.note}</p>}
                  {!!m.tools?.length && (
                    <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-text-subtle"><Wrench aria-hidden className="size-3" />Read:
                      {[...new Set(m.tools.map((t) => TOOL_LABEL[t.name] ?? t.name))].map((l) => <span key={l} className="rounded-sm bg-surface-3 px-1.5">{l}</span>)}
                    </p>
                  )}
                </div>
              ))}
              {ask.isPending && <p className="flex items-center gap-2 text-sm text-text-muted"><Bot aria-hidden className="size-4 animate-pulse" />Looking it up…</p>}
              <div ref={end} />
            </div>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
              <label htmlFor="ai-q" className="sr-only">Your question</label>
              <textarea id="ai-q" rows={2} className={cx(inputClass, 'h-auto min-h-[2.75rem] flex-1 resize-y py-2')} value={draft} maxLength={4000} disabled={!!blocked}
                placeholder="Ask a question…" onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }} />
              <Button type="submit" variant="primary" loading={ask.isPending} disabled={!draft.trim() || !!blocked} aria-label="Send"><Send aria-hidden className="size-4" /></Button>
            </form>
            {msgs.length > 0 && <button type="button" className="mt-2 self-start text-xs text-text-muted underline" onClick={() => { setMsgs([]); setError(null); }}>New conversation</button>}
          </Card>
          <div className="space-y-4">
            {s && (
              <Card>
                <h2 className="label-caps mb-2 text-text-muted">What it can read for you</h2>
                {s.tools.length ? <ul className="flex flex-wrap gap-1.5 text-xs">{[...new Set(s.tools.map((t) => TOOL_LABEL[t] ?? t))].map((l) => <li key={l} className="rounded-sm bg-surface-3 px-2 py-0.5">{l}</li>)}</ul>
                  : <p className="text-sm text-text-muted">None of your tabs have data the agent can read.</p>}
                <p className="mt-2 text-xs text-text-subtle">Revenue needs the Sales or Bonus page unlocked with your password first.</p>
              </Card>
            )}
            {isAdmin && <AiAdmin />}
          </div>
        </div>
      )}
    </section>
  );
}

interface AdminData { settings: AiSettings; models: { id: string; label: string; inUsd: number; outUsd: number }[]; configured: boolean; month: { feature: string; messages: number; micro: number }[]; people: { username: string; full_name: string; messages: number; micro: number; last_at: string }[] }
const usd = (micro: number) => `$${(micro / 1e6).toFixed(2)}`;

function AiAdmin() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ai-admin'], queryFn: () => api<AdminData>('/admin/ai') });
  const [form, setForm] = useState<AiSettings | null>(null);
  useEffect(() => { if (q.data && !form) setForm(q.data.settings); }, [q.data, form]);
  const save = useMutation({
    mutationFn: (s: AiSettings) => api<{ settings: AiSettings }>('/admin/ai', { method: 'PUT', json: s }),
    onSuccess: (r) => { setForm(r.settings); qc.invalidateQueries({ queryKey: ['ai-admin'] }); qc.invalidateQueries({ queryKey: ['ai-status'] }); },
  });
  if (!q.data || !form) return <Skeleton className="h-64" />;
  const spent = q.data.month.reduce((a, m) => a + Number(m.micro), 0);
  const budget = form.monthly_budget_cents * 10_000;
  const dirty = JSON.stringify(form) !== JSON.stringify(q.data.settings);
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><Settings aria-hidden className="size-5" />Settings</h2>
      {!q.data.configured && <div className="mb-3"><Banner tone="warning">Add the ANTHROPIC_API_KEY secret to the Worker before switching it on.</Banner></div>}
      {save.error && <div className="mb-3"><Banner tone="danger">{(save.error as ApiError).message}</Banner></div>}
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />AI Agent on</label>
        <Field id="ai-model" label="Model">
          <select id="ai-model" className={inputClass} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value as AiSettings['model'] })}>
            {q.data.models.map((m) => <option key={m.id} value={m.id}>{m.label} (${m.inUsd} / ${m.outUsd} per M tokens)</option>)}
          </select>
        </Field>
        <Field id="ai-budget" label="Monthly budget (USD)" hint="Shared with the help assistant. Resets on the 1st (UTC).">
          <span className="flex items-center gap-2">
            <input id="ai-budget" type="number" min={0} step={1} className={inputSized('w-32')} value={form.monthly_budget_cents / 100}
              onChange={(e) => setForm({ ...form, monthly_budget_cents: Math.round(Number(e.target.value) * 100) })} />
            <span aria-hidden className="font-mono text-xs text-text-subtle">USD</span>
          </span>
        </Field>
        <Field id="ai-daily" label="Messages per person per day" hint="Resets at midnight UTC.">
          <input id="ai-daily" type="number" min={0} step={1} className={inputSized('w-24')} value={form.messages_per_user_day}
            onChange={(e) => setForm({ ...form, messages_per_user_day: Math.round(Number(e.target.value)) })} />
        </Field>
        <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(form)}>Save settings</Button>
      </div>
      <h3 className="label-caps mb-1 mt-5 text-text-muted">This month</h3>
      <p className="text-sm"><span className="font-mono">{usd(spent)}</span> of <span className="font-mono">{usd(budget)}</span>{budget > 0 && ` (${Math.round((spent / budget) * 100)}%)`}</p>
      {q.data.people.length > 0 && (
        <table className="mt-2 w-full text-xs">
          <thead><tr className="text-left text-text-muted"><th scope="col" className="py-1 font-semibold">Person</th><th scope="col" className="py-1 text-right font-semibold">Messages</th><th scope="col" className="py-1 text-right font-semibold">Cost</th></tr></thead>
          <tbody>{q.data.people.map((p) => <tr key={p.username} className="border-t border-border"><td className="py-1">{p.full_name}</td><td className="py-1 text-right font-mono">{p.messages}</td><td className="py-1 text-right font-mono">{usd(Number(p.micro))}</td></tr>)}</tbody>
        </table>
      )}
    </Card>
  );
}
