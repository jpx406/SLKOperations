import { useMutation } from '@tanstack/react-query';
import { CircleHelp, MessageCircleQuestion, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { helpFor } from '../../shared/help';
import { ApiError, api } from '../api';
import { useMe } from '../auth';
import { Markdown } from './Markdown';
import { Banner, Button, Card, cx, inputClass } from './ui';

// Help (S22): the in-app guide, showing the sections for the tabs the reader has. Help assistant (S23): a side
// panel that answers how-to questions from the same guide; it has no access to data.

export function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" aria-label="Help: the SLK Operations guide" onClick={() => setOpen(true)}><CircleHelp aria-hidden className="size-4" /><span className="hidden xl:inline">Help</span></Button>
      {open && <HelpDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  const { data: me } = useMe();
  const sections = helpFor(me?.menus ?? {}, me?.role === 'admin');
  const [at, setAt] = useState(sections[0]?.id ?? '');
  const s = sections.find((x) => x.id === at) ?? sections[0];
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="help-title" className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4">
      <Card className="flex max-h-[85vh] w-full max-w-4xl flex-col">
        <div className="mb-3 flex items-start gap-3"><h2 id="help-title" className="flex-1 font-display text-lg font-bold">SLK Operations guide</h2><Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}><X aria-hidden className="size-4" /></Button></div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[14rem_1fr]">
          <nav aria-label="Guide sections" className="overflow-y-auto">
            <ul className="space-y-0.5 text-sm">
              {sections.map((x) => <li key={x.id}><button type="button" aria-current={x.id === s?.id ? 'true' : undefined} onClick={() => setAt(x.id)}
                className={cx('w-full rounded-md px-2 py-1.5 text-left', x.id === s?.id ? 'bg-surface-3 font-semibold' : 'text-text-muted hover:bg-surface-2 hover:text-text')}>{x.title}</button></li>)}
            </ul>
          </nav>
          {s && <article className="overflow-y-auto pr-1 text-sm"><h3 className="mb-2 font-display text-base font-bold">{s.title}</h3>{s.body.split('\n\n').map((p, i) => <p key={i} className="mb-3 max-w-prose">{p}</p>)}</article>}
        </div>
      </Card>
    </div>
  );
}

interface Msg { role: 'user' | 'assistant'; content: string; note?: string | null }

export function AssistantLauncher() {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  if (!me?.menus.ai_assistant?.view) return null;
  // in the header, not floating: a floating button covered answers at the right edge on tablets
  return (
    <>
      <Button size="sm" variant="ghost" aria-label="Open the help assistant" aria-expanded={open} onClick={() => setOpen(true)}>
        <MessageCircleQuestion aria-hidden className="size-4" /><span className="hidden xl:inline">Ask</span>
      </Button>
      {open && <AssistantPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function AssistantPanel({ onClose }: { onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [msgs]);
  const ask = useMutation({
    mutationFn: (history: Msg[]) => api<{ reply: string; note: string | null }>('/ai/assistant', { method: 'POST', json: { messages: history.map(({ role, content }) => ({ role, content })) } }),
    onSuccess: (r) => setMsgs((m) => [...m, { role: 'assistant', content: r.reply, note: r.note }]),
    onError: (e) => { setError((e as ApiError).message); setMsgs((m) => m.slice(0, -1)); },
  });
  const send = () => {
    const t = draft.trim();
    if (!t || ask.isPending) return;
    const next = [...msgs, { role: 'user' as const, content: t }];
    setMsgs(next); setDraft(''); setError(null); ask.mutate(next);
  };
  return (
    <aside role="dialog" aria-label="Help assistant" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-border bg-surface shadow-xl print:hidden">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <MessageCircleQuestion aria-hidden className="size-5" /><h2 className="flex-1 font-display font-bold">Help assistant</h2>
        <Button size="sm" variant="ghost" aria-label="Close the help assistant" onClick={onClose}><X aria-hidden className="size-4" /></Button>
      </div>
      <p className="border-b border-border px-3 py-2 text-xs text-text-muted">Answers how-to questions from the SLK Operations guide. It can’t see your jobs or any other data, and it can be wrong; check important steps in the guide.</p>
      <div role="log" aria-live="polite" className="flex-1 space-y-2 overflow-y-auto p-3">
        {!msgs.length && <p className="text-sm text-text-subtle">For example: “How do I approve a JRA?” or “Why is Execution locked?”</p>}
        {msgs.map((m, i) => (
          <div key={i} className={cx('rounded-md px-3 py-2 text-sm', m.role === 'user' ? 'ml-8 bg-info-subtle' : 'mr-4 bg-surface-2')}>
            {m.role === 'assistant' ? <Markdown text={m.content} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
            {m.note && <p className="mt-1 text-xs text-warning">{m.note}</p>}
          </div>
        ))}
        {ask.isPending && <p className="text-sm text-text-muted">Thinking…</p>}
        {error && <Banner tone="danger">{error}</Banner>}
        <div ref={end} />
      </div>
      <form className="flex gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label htmlFor="asst-q" className="sr-only">Your question</label>
        <textarea id="asst-q" ref={input} rows={2} maxLength={2000} className={cx(inputClass, 'h-auto flex-1 resize-none py-2')} value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ask how to…" />
        <Button type="submit" variant="primary" aria-label="Send" loading={ask.isPending} disabled={!draft.trim()}><Send aria-hidden className="size-4" /></Button>
      </form>
    </aside>
  );
}
