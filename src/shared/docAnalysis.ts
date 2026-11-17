// Document analysis on Add document (6z.15): the file is read first and Claude suggests every field, which the
// person checks and corrects before saving. Here: the text of Word, PowerPoint and Excel files (PDFs and images
// are sent as they are), the prompt, the answer's shape, and the cleaning of the answer. Used by the Worker.

import { ADD_TYPES, GLOBAL, SOP_COMPANIES, type AddType } from './knowledge';
import { unzip } from './xlsxRead';

const MAX_TEXT = 60_000;
const dec = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const runs = (xml: string, tag: string) => dec([...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]).join(''));

/** Plain text of a Word, PowerPoint, Excel, text or CSV file; null for anything else (PDF, images, old .doc/.xls). */
export async function extractText(name: string, bytes: Uint8Array): Promise<string | null> {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  const td = new TextDecoder();
  if (ext === 'txt' || ext === 'csv') return td.decode(bytes.subarray(0, MAX_TEXT * 2)).slice(0, MAX_TEXT);
  if (!['docx', 'pptx', 'xlsx', 'xlsm'].includes(ext)) return null;
  let files: Map<string, Uint8Array>;
  try { files = await unzip(bytes); } catch { return null; }
  const get = (n: string) => (files.has(n) ? td.decode(files.get(n)) : '');
  let out = '';
  if (ext === 'docx') {
    const xml = [get('word/document.xml'), ...[...files.keys()].filter((k) => /^word\/(header|footer)\d*\.xml$/.test(k)).map(get)].join('');
    out = xml.split(/<\/w:p>/).map((p) => runs(p, 'w:t')).filter(Boolean).join('\n');
  } else if (ext === 'pptx') {
    const slides = [...files.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => Number(/(\d+)\.xml/.exec(a)![1]) - Number(/(\d+)\.xml/.exec(b)![1]));
    out = slides.map((k, i) => `Slide ${i + 1}\n${get(k).split(/<\/a:p>/).map((p) => runs(p, 'a:t')).filter(Boolean).join('\n')}`).join('\n\n');
  } else {
    const shared = get('xl/sharedStrings.xml').split(/<\/si>/).map((si) => runs(si, 't')).filter(Boolean);
    const inline = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).map((k) => runs(get(k), 't')).join('\n');
    out = [...shared, inline].join('\n');
  }
  return out.replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT) || null;
}

/** Everything the form needs. Strings throughout: "" means not found in the document. */
export interface Suggestion {
  type: AddType; country: string; company: string; client: string; title: string; doc_no: string; category: string; summary: string; key_action: string;
  failure_types: string[]; author: string; revision: string; revision_date: string; published_on: string; expires_on: string; origin: 'internal' | 'external'; notes: string;
}

export function answerSchema(places: string[]) {
  const str = { type: 'string' } as const;
  return {
    type: 'object', additionalProperties: false,
    required: ['type', 'country', 'company', 'client', 'title', 'doc_no', 'category', 'summary', 'key_action', 'failure_types', 'author', 'revision', 'revision_date', 'published_on', 'expires_on', 'origin', 'notes'],
    properties: {
      type: { type: 'string', enum: Object.keys(ADD_TYPES) },
      country: { type: 'string', enum: [GLOBAL, ...places] },
      company: { type: 'string', enum: ['', ...SOP_COMPANIES] },
      client: str, title: str, doc_no: str, category: str, summary: str, key_action: str,
      failure_types: { type: 'array', items: str },
      author: str, revision: str, revision_date: str, published_on: str, expires_on: str,
      origin: { type: 'string', enum: ['internal', 'external'] },
      notes: str,
    },
  };
}

export function analysisPrompt(p: { fileName: string; places: string[]; clients: string[]; categories: string[]; today: string; sectionHint: string }) {
  return `You file documents in the Knowledge Hub of SLK Operations Hub, NESR's slickline operations app. Read the attached document and fill in its record. Use only what the document and its file name show; leave a field "" when they don't show it. Never invent a number, date, author or revision.

Types (pick one):
- lesson_learnt, best_practice, learning_from_incident: lessons from the field (alerts, incident learnings, good practice).
- sop: SLK Standard Operating Procedure (how an operation is done, step by step, owned by NESR, SAPESCO or Gulf Energy).
- swi: Standard Work Instruction (a narrower, task-level instruction).
- form: a form, checklist or template people fill in.
- client: a client's own procedure or requirement (Saudi Aramco, a national oil company, an operator).
The person was looking at: ${p.sectionHint}. Use it only when the document itself doesn't settle the type.

Fields:
- country: "Global" unless the document is for one country. One of: Global, ${p.places.join(', ')}.
- company (sop, swi, form only): NESR, SAPESCO or Gulf Energy from the logo, header or text; "" otherwise.
- client (client procedures): the client's name. Known clients: ${p.clients.slice(0, 60).join(', ') || 'none yet'}.
- title: the document's own title, in title case, without the number.
- doc_no: the document number exactly as printed (e.g. NESR-SLK-SOP-012, QAF14010).
- category: a short subject, preferably one of: ${p.categories.slice(0, 40).join(', ') || 'Wireline, Pressure control, Lifting, H2S, Explosives, Well intervention'}.
- summary: 2 to 4 plain sentences on scope and purpose (for lessons: what happened and why it matters).
- key_action (lessons only): the one thing crews must do.
- failure_types (lessons only): short labels such as Wire parted, Stuck tool, Leak.
- author, revision (the number only, e.g. 3 for Rev 03), revision_date and published_on (YYYY-MM-DD), expires_on (YYYY-MM-DD, only if printed).
- origin: external when the document belongs to a client or a manufacturer, else internal.
- notes: one short sentence on anything unclear the person should check. "" if nothing.

Today is ${p.today}. The file is named "${p.fileName}".`;
}

/** A real calendar date written YYYY-MM-DD (2026-02-30 is not one). */
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Makes the model's answer safe for the form: known values only, dates as dates, numbers as numbers. */
export function cleanSuggestion(raw: unknown, places: string[], fallbackType: AddType): Suggestion {
  const r = (raw ?? {}) as Record<string, unknown>;
  const s = (k: string, max = 300) => (typeof r[k] === 'string' ? (r[k] as string).trim().slice(0, max) : '');
  const type = (typeof r.type === 'string' && r.type in ADD_TYPES ? r.type : fallbackType) as AddType;
  const country = [GLOBAL, ...places].includes(s('country')) ? s('country') : GLOBAL;
  const company = (SOP_COMPANIES as readonly string[]).includes(s('company')) ? s('company') : '';
  const rev = /^\d{1,3}$/.test(s('revision').replace(/^0+(?=\d)/, '')) ? String(Number(s('revision'))) : '';
  const date = (k: string) => (isDate(s(k, 20)) ? s(k, 20) : '');
  return {
    type, country: ADD_TYPES[type].section === 'client' && country === GLOBAL ? places[0] ?? GLOBAL : country, company, client: s('client', 120), title: s('title', 200),
    doc_no: s('doc_no', 40).toUpperCase().replace(/[^A-Z0-9 ._/-]/g, ''), category: s('category', 80), summary: s('summary', 2000), key_action: s('key_action', 500),
    failure_types: Array.isArray(r.failure_types) ? r.failure_types.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 60)).filter(Boolean).slice(0, 10) : [],
    author: s('author', 120), revision: rev, revision_date: date('revision_date'), published_on: date('published_on'), expires_on: date('expires_on'),
    origin: r.origin === 'external' ? 'external' : 'internal', notes: s('notes', 300),
  };
}
