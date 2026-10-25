import type { ReactNode } from 'react';
import { cx } from './ui';

// A small Markdown reader for AI answers: paragraphs, headings, lists, tables, bold and code. No HTML is ever injected.

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part.startsWith('`') && part.endsWith('`') ? <code key={i} className="rounded-sm bg-surface-3 px-1 font-mono text-xs">{part.slice(1, -1)}</code>
        : part);
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => c.trim())); i++; }
      const body = rows.filter((r, n) => !(n === 1 && r.every((c) => /^:?-{2,}:?$/.test(c))));
      const [head, ...rest] = body;
      out.push(
        <div key={out.length} className="my-2 overflow-x-auto"><table className="w-full text-xs">
          <thead><tr>{head.map((c, n) => <th key={n} scope="col" className="border-b border-border-strong py-1 pr-3 text-left font-semibold">{inline(c)}</th>)}</tr></thead>
          <tbody>{rest.map((r, n) => <tr key={n} className="border-b border-border">{r.map((c, k) => <td key={k} className="py-1 pr-3">{inline(c)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { out.push(<p key={out.length} className="mt-2 font-display font-bold">{inline(h[2])}</p>); i++; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')); i++; }
      const L = ordered ? 'ol' : 'ul';
      out.push(<L key={out.length} className={cx('my-1 space-y-0.5 pl-5', ordered ? 'list-decimal' : 'list-disc')}>{items.map((t, n) => <li key={n}>{inline(t)}</li>)}</L>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*\|/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) { para.push(lines[i]); i++; }
    out.push(<p key={out.length} className="my-1">{inline(para.join(' '))}</p>);
  }
  return <div>{out}</div>;
}
