// Company copies of global NESR SOPs and SWIs (6z.21). The app turns the NESR Word file into a SAPESCO or Gulf
// Energy Word file: the company's header, footer and logo come from one of its own SOPs (the template), the NESR
// colour becomes the company colour, NESR document numbers become the company's (NESR-8000-SOP-11 → SAP-8000-SOP-11),
// "NESR" in the text becomes the company name, and the cover approvers are the company's. An admin then saves the
// Word file as PDF and uploads it, and the copy goes through review and approval like any other SOP.
// Pure functions on bytes and strings, used by the Worker and the tests.

import { zip } from './xlsx';
import { unzip } from './xlsxRead';

export const COPY_COMPANIES = ['SAPESCO', 'Gulf Energy'] as const;
export type CopyCompany = (typeof COPY_COMPANIES)[number];
export const APPROVER_ROLES = ['prepared', 'reviewed', 'segment', 'corporate'] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];
export const APPROVER_LABEL: Record<ApproverRole, string> = { prepared: 'Prepared By', reviewed: 'Reviewed By', segment: 'Segment Approval', corporate: 'Corporate Approval' };

export interface CompanyTemplate {
  /** Replaces NESR at the start of document numbers: SAP, GES. */
  prefix: string;
  /** Replaces NESR in the text. */
  name: string;
  /** Replaces "National Energy Services Reunited" in the text. */
  longName: string;
  /** Six hex digits, no #. */
  colour: string;
  /** Names for the cover table; blank keeps the name in the NESR document. */
  approvers: Record<ApproverRole, string>;
  /** More words to replace, in order, exactly as written. */
  words: { from: string; to: string }[];
  /** The company SOP in Word whose header, footer and logo are used. */
  template: TemplateFile | null;
  /** The company presentation (.pptx) whose slide masters, layouts, theme and logo are used for lesson copies (6z.27). */
  slides?: TemplateFile | null;
  /** The company presentation for best practices (6z.32); without one, best practices use the lessons template. */
  slidesBp?: TemplateFile | null;
}
export interface TemplateFile { key: string; file_name: string; uploaded_at: string; uploaded_by: string }
export interface CopySettings {
  nesrColours: string[]; companies: Record<CopyCompany, CompanyTemplate>;
  /** NESR's own presentation, for NESR versions of SAPESCO and Gulf Energy lessons (6z.28). */
  nesrSlides?: TemplateFile | null;
  /** NESR's own presentation for best practices (6z.32). */
  nesrSlidesBp?: TemplateFile | null;
}
/** Who a copy is for: SAPESCO or Gulf Energy from NESR, or NESR from a SAPESCO or Gulf Energy lesson (6z.28). */
export type CopyTarget = CopyCompany | 'NESR';
export const isCopyCompany = (v: unknown): v is CopyCompany => (COPY_COMPANIES as readonly unknown[]).includes(v);

const noApprovers = (): Record<ApproverRole, string> => ({ prepared: '', reviewed: '', segment: '', corporate: '' });
export const DEFAULT_COPY_SETTINGS: CopySettings = {
  nesrColours: ['024800'],
  companies: {
    SAPESCO: { prefix: 'SAP', name: 'SAPESCO', longName: 'Sahara Petroleum Services', colour: 'EE0000', approvers: noApprovers(), words: [], template: null },
    'Gulf Energy': { prefix: 'GES', name: 'Gulf Energy', longName: 'Gulf Energy SAOC', colour: '863A3A', approvers: noApprovers(), words: [], template: null },
  },
};

const hexColour = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/^#/, '').toUpperCase() : '');
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Settings as an admin saves them. The template file itself is kept as it was (it is uploaded on its own). */
export function checkCopySettings(b: unknown, current: CopySettings = DEFAULT_COPY_SETTINGS): { value: CopySettings } | { error: string } {
  const r = (b ?? {}) as Record<string, unknown>;
  const nesr = (Array.isArray(r.nesrColours) ? r.nesrColours : current.nesrColours).map(hexColour).filter(Boolean);
  if (!nesr.length || nesr.some((c) => !/^[0-9A-F]{6}$/.test(c))) return { error: 'NESR colours are six-digit hex codes, like 024800' };
  const companies = {} as Record<CopyCompany, CompanyTemplate>;
  const given = (r.companies ?? {}) as Record<string, Record<string, unknown>>;
  for (const co of COPY_COMPANIES) {
    const g = given[co] ?? {}, cur = current.companies[co];
    const prefix = str(g.prefix ?? cur.prefix, 10).toUpperCase();
    if (!/^[A-Z][A-Z0-9]{0,9}$/.test(prefix)) return { error: `${co}: the number prefix is letters and digits, like SAP` };
    const colour = hexColour(g.colour ?? cur.colour);
    if (!/^[0-9A-F]{6}$/.test(colour)) return { error: `${co}: the colour is a six-digit hex code, like EE0000` };
    const name = str(g.name ?? cur.name, 60);
    if (!name) return { error: `${co}: type the name used in the text` };
    const ap = (g.approvers ?? cur.approvers) as Record<string, unknown>;
    const words = (Array.isArray(g.words) ? g.words : cur.words).map((w) => ({ from: str((w as Record<string, unknown>).from, 120), to: str((w as Record<string, unknown>).to, 120) })).filter((w) => w.from).slice(0, 40);
    companies[co] = {
      prefix, name, colour, longName: str(g.longName ?? cur.longName, 120), words, template: cur.template, slides: cur.slides ?? null, slidesBp: cur.slidesBp ?? null,
      approvers: Object.fromEntries(APPROVER_ROLES.map((k) => [k, str(ap?.[k], 120)])) as Record<ApproverRole, string>,
    };
  }
  return { value: { nesrColours: [...new Set(nesr)], companies, nesrSlides: current.nesrSlides ?? null, nesrSlidesBp: current.nesrSlidesBp ?? null } };
}

export function copySettingsOf(raw: unknown): CopySettings {
  const r = (raw ?? {}) as Partial<CopySettings>;
  const companies = { ...DEFAULT_COPY_SETTINGS.companies };
  for (const co of COPY_COMPANIES) if (r.companies?.[co]) companies[co] = { ...DEFAULT_COPY_SETTINGS.companies[co], ...r.companies[co] };
  return { nesrColours: r.nesrColours?.length ? r.nesrColours : DEFAULT_COPY_SETTINGS.nesrColours, companies, nesrSlides: r.nesrSlides ?? null, nesrSlidesBp: r.nesrSlidesBp ?? null };
}

/**
 * Global NESR SOPs and SWIs have company copies (Word), and so do lessons, best practices and learnings from incidents
 * from any country (PowerPoint, 6z.27). A copy has none of its own.
 */
export const mayHaveCopies = (d: { section: string; country: string; company: string | null; copy_of?: string | null }) =>
  !d.copy_of && (d.section === 'lesson' || ((d.section === 'sop' || d.section === 'swi') && d.country === 'Global' && d.company === 'NESR'));
/** A NESR document gets SAPESCO and Gulf Energy copies; a SAPESCO or Gulf Energy lesson gets a NESR version (6z.28). */
export const copyTargets = (d: { section: string; company: string | null }): CopyTarget[] =>
  d.section === 'lesson' && isCopyCompany(d.company) ? ['NESR'] : [...COPY_COMPANIES];
/** The two slides templates: lessons learnt and learnings from incidents, and best practices (6z.32). */
export type SlideKind = 'slides' | 'bp';
export const SLIDE_KIND_LABEL: Record<SlideKind, string> = { slides: 'Lessons', bp: 'Best practice' };
export const slideKindOf = (d: { doc_type?: string | null }): SlideKind => (d.doc_type === 'best_practice' ? 'bp' : 'slides');
/** The slides template for a company (or NESR) and kind; a best practice falls back to the lessons template. */
export function slideTemplate(s: CopySettings, co: CopyTarget, kind: SlideKind): { file: TemplateFile; kind: SlideKind } | null {
  const lessons = co === 'NESR' ? s.nesrSlides : s.companies[co].slides;
  const bp = co === 'NESR' ? s.nesrSlidesBp : s.companies[co].slidesBp;
  if (kind === 'bp' && bp) return { file: bp, kind: 'bp' };
  return lessons ? { file: lessons, kind: 'slides' } : null;
}

/** Which template a document's copies are made with: slides for lessons, Word for SOPs and SWIs. */
export const copyKind = (d: { section: string }): 'slides' | 'word' => (d.section === 'lesson' ? 'slides' : 'word');

/** NESR-8000-SOP-11 → SAP-8000-SOP-11; SOP-GL-NESR-004 → SOP-GL-SAP-004; anything else gets the prefix in front. */
export function copyNumber(no: string | null, prefix: string): string | null {
  if (!no) return null;
  if (/^NESR(?=[-_ ])/i.test(no)) return no.replace(/^NESR/i, prefix);
  if (/-NESR(?=-|$)/i.test(no)) return no.replace(/-NESR(?=-|$)/i, `-${prefix}`);
  return `${prefix}-${no}`;
}

/** A NESR version's number (6z.28): SAP-LL-GL-004 → NESR-LL-GL-004; one without the company prefix gets NESR in front. */
export function nesrNumber(no: string | null, prefix: string): string | null {
  if (!no) return null;
  const re = new RegExp('^' + prefix.replace(/[^A-Z0-9]/gi, '') + '(?=[-_ ])', 'i');
  return re.test(no) ? no.replace(re, 'NESR') : copyNumber(no, 'NESR');
}

// ---- the paragraph engine --------------------------------------------------------------------------------------
// Word splits text into runs (<w:r><w:t>…</w:t></w:r>) wherever formatting changes, often mid-word. Matching is done
// on each paragraph's whole text; a change touches only the runs it covers, so the rest keeps its formatting.

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Run { s: number; e: number; text: string }
interface Para { runs: Run[]; texts: string[] }
export interface Edit { start: number; end: number; to: string }

/** Word paragraphs are w:p with w:t runs; PowerPoint and drawing text is a:p with a:t runs (6z.27). */
type Ns = 'w' | 'a';
const PARA_RE: Record<Ns, RegExp> = {
  w: /<w:p(?=[\s>/])[^>]*>|<\/w:p>|<w:t(?=[\s>])[^>]*>([^<]*)<\/w:t>/g,
  a: /<a:p(?=[\s>/])[^>]*>|<\/a:p>|<a:t(?=[\s>])[^>]*>([^<]*)<\/a:t>/g,
};

/** The innermost paragraphs of a part (text boxes have paragraphs inside paragraphs), in document order. */
function paragraphs(xml: string, ns: Ns = 'w'): Para[] {
  const out: Para[] = [];
  const stack: Run[][] = [];
  for (const m of xml.matchAll(PARA_RE[ns])) {
    const tag = m[0];
    if (tag.startsWith(`<${ns}:p`)) { if (!tag.endsWith('/>')) stack.push([]); }
    else if (tag === `</${ns}:p>`) { const runs = stack.pop(); if (runs?.length) out.push({ runs, texts: runs.map((r) => r.text) }); }
    else if (stack.length) stack[stack.length - 1].push({ s: m.index!, e: m.index! + tag.length, text: unesc(m[1]) });
  }
  return out.sort((a, b) => a.runs[0].s - b.runs[0].s);
}

/** Applies edits (on the joined text) to the run texts. Each edit's text goes in the first run it covers. */
export function applyEdits(texts: string[], edits: Edit[]): string[] {
  const out = [...texts];
  for (const ed of [...edits].sort((a, b) => b.start - a.start)) {
    let off = 0;
    const starts = out.map((t) => { const s = off; off += t.length; return s; });
    let i = starts.findIndex((s, k) => ed.start >= s && ed.start < s + out[k].length);
    if (i < 0) i = ed.start >= off ? out.length - 1 : 0;
    let j = ed.end > ed.start ? starts.findIndex((s, k) => ed.end - 1 >= s && ed.end - 1 < s + out[k].length) : i;
    if (j < 0) j = out.length - 1;
    const a = ed.start - starts[i], b = ed.end - starts[j];
    if (i === j) out[i] = out[i].slice(0, a) + ed.to + out[i].slice(b);
    else {
      out[i] = out[i].slice(0, a) + ed.to;
      for (let k = i + 1; k < j; k++) out[k] = '';
      out[j] = out[j].slice(b);
    }
  }
  return out;
}

const joined = (p: Para) => p.texts.join('');

/** Writes back every run whose text changed. */
function rebuild(xml: string, paras: Para[], ns: Ns = 'w'): string {
  const changes = paras.flatMap((p) => p.runs.map((r, k) => ({ r, t: p.texts[k] })).filter(({ r, t }) => t !== r.text)).sort((a, b) => a.r.s - b.r.s);
  let out = '', at = 0;
  for (const { r, t } of changes) { out += xml.slice(at, r.s) + (ns === 'w' ? `<w:t xml:space="preserve">${esc(t)}</w:t>` : `<a:t>${esc(t)}</a:t>`); at = r.e; }
  return out + xml.slice(at);
}

export interface Rule { label: string; find: RegExp; to: string | ((m: RegExpMatchArray) => string) }

/** Runs each rule over every paragraph; counts the changes per rule. */
function applyRules(paras: Para[], rules: Rule[], counts: Map<string, number>) {
  for (const p of paras) {
    for (const rule of rules) {
      const full = joined(p);
      const edits: Edit[] = [];
      for (const m of full.matchAll(new RegExp(rule.find.source, rule.find.flags.includes('g') ? rule.find.flags : `${rule.find.flags}g`))) {
        const to = typeof rule.to === 'string' ? rule.to : rule.to(m);
        if (to === m[0]) continue;
        // change only the part that differs, so "30th" keeps its raised "th" when only the year changes
        let a = 0, z = 0;
        while (a < to.length && a < m[0].length && to[a] === m[0][a]) a++;
        while (z < to.length - a && z < m[0].length - a && to[to.length - 1 - z] === m[0][m[0].length - 1 - z]) z++;
        edits.push({ start: m.index! + a, end: m.index! + m[0].length - z, to: to.slice(a, to.length - z) });
      }
      if (edits.length) { p.texts = applyEdits(p.texts, edits); counts.set(rule.label, (counts.get(rule.label) ?? 0) + edits.length); }
    }
  }
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text changes for one company, in the order they run. */
export function textRules(t: CompanyTemplate): Rule[] {
  return [
    ...t.words.filter((w) => w.from).map((w) => ({ label: `“${w.from}” → “${w.to}”`, find: new RegExp(reEsc(w.from), 'g'), to: w.to })),
    { label: `National Energy Services Reunited → ${t.longName || t.name}`, find: /National Energy Services Reunited(?: Corp(?:oration)?\.?)?/g, to: t.longName || t.name },
    { label: `NESR numbers → ${t.prefix}`, find: /\bNESR(?=-[A-Z0-9])/g, to: t.prefix },
    { label: `NESR → ${t.name}`, find: /\bNESR\b/g, to: t.name },
  ];
}

/** The text changes back to NESR from a company's lesson (6z.28): its full name, its number prefix, its name, and its extra words the other way round. */
export function nesrRules(t: CompanyTemplate): Rule[] {
  return [
    ...t.words.filter((w) => w.from && w.to).map((w) => ({ label: `“${w.to}” → “${w.from}”`, find: new RegExp(reEsc(w.to), 'g'), to: w.from })),
    ...(t.longName ? [{ label: `${t.longName} → National Energy Services Reunited`, find: new RegExp(reEsc(t.longName), 'g'), to: 'National Energy Services Reunited' }] : []),
    { label: `${t.prefix} numbers → NESR`, find: new RegExp(`\\b${reEsc(t.prefix)}(?=-[A-Z0-9])`, 'g'), to: 'NESR' },
    { label: `${t.name} → NESR`, find: new RegExp(`\\b${reEsc(t.name)}\\b`, 'g'), to: 'NESR' },
  ];
}

/** The cover table: the name after "Prepared By:", "Reviewed By:" … becomes the company's, where one is set. */
function coverApprovers(paras: Para[], t: CompanyTemplate, counts: Map<string, number>) {
  let pending: ApproverRole | null = null;
  for (const p of paras) {
    const full = joined(p);
    if (!full.trim()) continue;
    const label = APPROVER_ROLES.find((k) => new RegExp(`^\\s*${APPROVER_LABEL[k]}\\s*:`, 'i').test(full));
    if (label) {
      pending = null;
      const name = t.approvers[label];
      if (!name) continue;
      const colon = full.indexOf(':') + 1;
      if (full.slice(colon).trim()) { p.texts = applyEdits(p.texts, [{ start: colon, end: full.length, to: ` ${name}` }]); counts.set(`Cover: ${APPROVER_LABEL[label]}`, 1); }
      else pending = label;
    } else if (pending) {
      if (full.trim() !== t.approvers[pending]) { p.texts = applyEdits(p.texts, [{ start: 0, end: full.length, to: t.approvers[pending] }]); counts.set(`Cover: ${APPROVER_LABEL[pending]}`, 1); }
      pending = null;
    }
  }
}

/** "Doc No: X", "Revision: 02", "Date: 30th December 2022" as printed in a header or footer. */
export function printedFields(xmls: string[]): { docNo?: string; revision?: string; date?: string; title?: string } {
  const out: { docNo?: string; revision?: string; date?: string } = {};
  for (const x of xmls) for (const p of paragraphs(x)) {
    const t = joined(p);
    out.docNo ??= /Doc(?:ument)?\s*No\.?\s*:\s*([A-Z0-9][A-Z0-9._/-]*)/i.exec(t)?.[1];
    out.revision ??= /Revision(?:\s*No\.?)?\s*:\s*(\d+)/i.exec(t)?.[1];
    out.date ??= /Date\s*:\s*(.+?)\s*$/i.exec(t)?.[1]?.trim() || undefined;
  }
  return out;
}

/** In a template header or footer: its number, revision and date become this document's. */
function templateFieldRules(f: { docNo?: string; revision?: string; date?: string }): Rule[] {
  const rules: Rule[] = [];
  if (f.docNo) rules.push({ label: 'Footer number', find: /(Doc(?:ument)?\s*No\.?\s*:\s*)[A-Z0-9][A-Z0-9._/-]*/gi, to: (m) => m[1] + f.docNo });
  if (f.revision) rules.push({ label: 'Footer revision', find: /(Revision(?:\s*No\.?)?\s*:\s*)\d+/gi, to: (m) => m[1] + f.revision });
  if (f.date) rules.push({ label: 'Footer date', find: /(Date\s*:\s*).+?\s*$/gi, to: (m) => m[1] + f.date });
  return rules;
}

const recolour = (xml: string, from: string[], to: string, counts: Map<string, number>) => {
  let n = 0;
  for (const c of from) xml = xml.replace(new RegExp(`"${c}"`, 'gi'), () => { n++; return `"${to}"`; });
  if (n) counts.set(`Colour → #${to}`, (counts.get(`Colour → #${to}`) ?? 0) + n);
  return xml;
};

// ---- the Word package ------------------------------------------------------------------------------------------

const td = new TextDecoder(), te = new TextEncoder();
const MEDIA_TYPES: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif', emf: 'image/x-emf', wmf: 'image/x-wmf', svg: 'image/svg+xml', wdp: 'image/vnd.ms-photo', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp' };

/** Header and footer parts by kind and type (default, first, even), from the document's section settings. */
function headerParts(files: Map<string, Uint8Array>) {
  const doc = td.decode(files.get('word/document.xml') ?? new Uint8Array());
  const rels = td.decode(files.get('word/_rels/document.xml.rels') ?? new Uint8Array());
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1], to = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && to) target.set(id, `word/${to.replace(/^\/?word\//, '').replace(/^\//, '')}`);
  }
  const out = new Map<string, string[]>();
  for (const m of doc.matchAll(/<w:(header|footer)Reference\b[^>]*>/g)) {
    const type = /w:type="([^"]+)"/.exec(m[0])?.[1] ?? 'default';
    const part = target.get(/r:id="([^"]+)"/.exec(m[0])?.[1] ?? '');
    if (!part) continue;
    const k = `${m[1]}:${type}`;
    if (!(out.get(k) ?? []).includes(part)) out.set(k, [...(out.get(k) ?? []), part]);
  }
  return out;
}
const relsOf = (part: string) => part.replace(/^word\//, 'word/_rels/') + '.rels';

export interface CopyResult { bytes: Uint8Array; changes: { label: string; n: number }[]; leftovers: string[]; usedTemplate: string[] }

/**
 * Makes the company Word file. `source` is the NESR .docx, `template` one of the company's own SOPs in .docx.
 * `copyNo` is the copy's number; `revision` and `date` are used in the footer only when the NESR footer has none.
 */
export async function makeCompanyCopy(source: Uint8Array, template: Uint8Array, opts: { t: CompanyTemplate; nesrColours: string[]; copyNo: string | null; revision?: string; date?: string }): Promise<CopyResult> {
  let files: Map<string, Uint8Array>, tfiles: Map<string, Uint8Array>;
  try { files = await unzip(source, true); } catch { throw new Error('The editable file is not a Word file (.docx)'); }
  try { tfiles = await unzip(template, true); } catch { throw new Error('The company template is not a Word file (.docx)'); }
  if (!files.has('word/document.xml')) throw new Error('The editable file is not a Word file (.docx)');
  if (!tfiles.has('word/document.xml')) throw new Error('The company template is not a Word file (.docx)');
  const { t } = opts;
  const counts = new Map<string, number>();
  const rules = textRules(t);
  const text = (k: string) => td.decode(files.get(k)!);
  const parts = headerParts(files), tparts = headerParts(tfiles);

  // what the NESR header and footer print, before they are replaced
  const srcPrinted = printedFields([...parts.values()].flat().filter((p) => files.has(p)).map(text));
  const fields = { docNo: opts.copyNo ?? undefined, revision: srcPrinted.revision ?? opts.revision, date: srcPrinted.date ?? opts.date };
  const firstLine = (xml: string) => paragraphs(xml).map(joined).find((s) => s.trim())?.trim();
  const srcTitle = parts.get('header:default')?.[0] && files.has(parts.get('header:default')![0]) ? firstLine(text(parts.get('header:default')![0])) : undefined;

  const usedTemplate: string[] = [];
  const media = new Map<string, string>();
  for (const [k, targets] of parts) {
    const tpart = tparts.get(k)?.[0];
    for (const part of targets) {
      if (!files.has(part)) continue;
      if (tpart && tfiles.has(tpart)) {
        let xml = td.decode(tfiles.get(tpart)!);
        const paras = paragraphs(xml);
        applyRules(paras, templateFieldRules(fields), counts);
        // the template's own title in its default header becomes this document's
        const tTitle = k === 'header:default' ? firstLine(xml) : undefined;
        if (tTitle && srcTitle && tTitle !== srcTitle && !/^Quality Management System$/i.test(tTitle)) {
          const p = paras.find((x) => joined(x).trim() === tTitle);
          if (p) { const full = joined(p); p.texts = applyEdits(p.texts, [{ start: full.indexOf(tTitle), end: full.indexOf(tTitle) + tTitle.length, to: srcTitle }]); counts.set('Header title', 1); }
        }
        xml = rebuild(xml, paras);
        files.set(part, te.encode(xml));
        // its relationships, with the logo and any other pictures copied in
        const trels = tfiles.get(relsOf(tpart));
        if (trels) {
          const r = td.decode(trels).replace(/Target="(?:\.\/)?media\/([^"]+)"/g, (_m, name: string) => {
            const src = `word/media/${name}`;
            const dest = `brand_${t.prefix.toLowerCase()}_${name}`;
            if (tfiles.has(src)) { files.set(`word/media/${dest}`, tfiles.get(src)!); media.set(dest, name); }
            return `Target="media/${dest}"`;
          });
          files.set(relsOf(part), te.encode(r));
        } else files.delete(relsOf(part));
        usedTemplate.push(k);
      } else {
        let xml = recolour(text(part), opts.nesrColours, t.colour, counts);
        const paras = paragraphs(xml);
        applyRules(paras, rules, counts);
        xml = rebuild(xml, paras);
        files.set(part, te.encode(xml));
      }
    }
  }
  if (usedTemplate.length) counts.set('Logo, header and footer from the template', usedTemplate.length);

  // the body, footnotes and endnotes
  for (const part of ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml']) {
    if (!files.has(part)) continue;
    let xml = recolour(text(part), opts.nesrColours, t.colour, counts);
    const paras = paragraphs(xml);
    applyRules(paras, rules, counts);
    if (part === 'word/document.xml') coverApprovers(paras, t, counts);
    xml = rebuild(xml, paras);
    files.set(part, te.encode(xml));
  }

  // picture types the copied logo needs
  if (media.size) {
    let ct = text('[Content_Types].xml');
    for (const name of media.keys()) {
      const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
      if (ext && MEDIA_TYPES[ext] && !new RegExp(`Extension="${ext}"`, 'i').test(ct)) ct = ct.replace(/(<Types\b[^>]*>)/, `$1<Default Extension="${ext}" ContentType="${MEDIA_TYPES[ext]}"/>`);
    }
    files.set('[Content_Types].xml', te.encode(ct));
  }

  // anything still saying NESR, for the person checking it
  const leftovers = new Set<string>();
  for (const [name, b] of files) {
    if (!/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)) continue;
    for (const p of paragraphs(td.decode(b))) {
      const s = joined(p);
      for (const m of s.matchAll(/NESR/gi)) leftovers.add(s.slice(Math.max(0, m.index! - 30), m.index! + 34).trim());
    }
  }
  return {
    bytes: zip([...files].map(([name, data]) => ({ name, data }))),
    changes: [...counts].map(([label, n]) => ({ label, n })),
    leftovers: [...leftovers].slice(0, 12),
    usedTemplate,
  };
}

// ---- where a copy stands -----------------------------------------------------------------------------------------

export type CopyState = 'draft' | 'review' | 'approval' | 'behind' | 'current';
export const COPY_STATE: Record<CopyState, string> = {
  draft: 'Draft: needs its PDF', review: 'In review', approval: 'Awaiting approval', behind: 'Behind the NESR source', current: 'Published',
};

/** Draft, in review or approval, published and in step with the NESR source, or behind it. */
export function copyState(copy: { published_at?: string | null; revision: number; copy_of_revision?: number | null; open?: { status: 'draft' | 'review' | 'approval' } | null },
  source: { revision: number; published_at?: string | null }): CopyState {
  if (copy.open) return copy.open.status;
  if (!copy.published_at) return 'draft';
  return source.published_at && (copy.copy_of_revision ?? copy.revision) < source.revision ? 'behind' : 'current';
}

// ---- the PowerPoint package (6z.27) -----------------------------------------------------------------------------
// Lessons learnt are slides. The copy is built inside the company's own presentation (the template): its slide
// masters, layouts, theme and logo stay; its own slides are taken out and the NESR slides are put in, each on the
// template layout of the same kind (title, title and content …). Pictures, charts and other parts the slides use
// are copied along. Speaker notes and comments are left out. Text and colours change as in the Word copies.

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
interface RelEntry { id: string; type: string; target: string; external: boolean; xml: string }

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
function relsIn(xml: string): RelEntry[] {
  return [...xml.matchAll(/<Relationship\b[^>]*\/?>/g)].map((m) => ({
    id: attr(m[0], 'Id') ?? '', type: attr(m[0], 'Type') ?? '', target: attr(m[0], 'Target') ?? '', external: attr(m[0], 'TargetMode') === 'External', xml: m[0],
  }));
}
const dirOf = (part: string) => part.slice(0, part.lastIndexOf('/'));
const baseOf = (part: string) => part.slice(part.lastIndexOf('/') + 1);
const relsPath = (part: string) => `${dirOf(part)}/_rels/${baseOf(part)}.rels`;
/** A relationship target as a package path. */
function resolvePart(fromPart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const out = dirOf(fromPart).split('/').filter(Boolean);
  for (const seg of target.split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); }
  return out.join('/');
}
/** A package path as a target relative to a part. */
function relativeTo(fromPart: string, to: string): string {
  const a = dirOf(fromPart).split('/'), b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}
const layoutInfo = (xml: string) => ({ type: /<p:sldLayout\b[^>]*\btype="([^"]+)"/.exec(xml)?.[1] ?? '', name: (/<p:cSld\b[^>]*\bname="([^"]*)"/.exec(xml)?.[1] ?? '').toLowerCase() });
const partNo = (p: string) => Number(/(\d+)\.xml$/.exec(p)?.[1] ?? 0);

/**
 * Makes the company PowerPoint file. `source` is the NESR .pptx, `template` one of the company's own presentations.
 */
export async function makeCompanySlides(source: Uint8Array, template: Uint8Array, opts: { t: CompanyTemplate; nesrColours: string[]; toNesr?: boolean }): Promise<CopyResult> {
  let files: Map<string, Uint8Array>, out: Map<string, Uint8Array>;
  try { files = await unzip(source, true); } catch { throw new Error('The editable file is not a PowerPoint file (.pptx)'); }
  try { out = await unzip(template, true); } catch { throw new Error('The company template is not a PowerPoint file (.pptx)'); }
  if (!files.has('ppt/presentation.xml')) throw new Error('The editable file is not a PowerPoint file (.pptx)');
  if (!out.has('ppt/presentation.xml')) throw new Error('The company template is not a PowerPoint file (.pptx)');
  const { t } = opts;
  const counts = new Map<string, number>();
  // NESR to the company, or (6z.28) the company's lesson back to NESR
  const rules = opts.toNesr ? nesrRules(t) : textRules(t);
  const fromColours = opts.toNesr ? [t.colour] : opts.nesrColours, toColour = opts.toNesr ? opts.nesrColours[0] ?? '024800' : t.colour;
  const leftWord = opts.toNesr ? new RegExp(`\\b${reEsc(t.name)}\\b`, 'gi') : /NESR/gi;
  const src = (k: string) => td.decode(files.get(k) ?? new Uint8Array());
  const get = (k: string) => td.decode(out.get(k) ?? new Uint8Array());
  let ct = get('[Content_Types].xml');
  const srcCt = src('[Content_Types].xml');
  const overrideRe = (part: string) => new RegExp(`<Override\\b[^>]*PartName="/${reEsc(part)}"[^>]*/>`, 'g');

  // 1. take the template's own slides (and their notes) out
  const presRelsPath = 'ppt/_rels/presentation.xml.rels';
  let presRels = get(presRelsPath);
  const drop = (part: string) => { out.delete(part); out.delete(relsPath(part)); ct = ct.replace(overrideRe(part), ''); };
  for (const r of relsIn(presRels).filter((x) => x.type === `${REL}/slide`)) {
    const part = resolvePart('ppt/presentation.xml', r.target);
    for (const nr of relsIn(get(relsPath(part))).filter((x) => x.type === `${REL}/notesSlide`)) drop(resolvePart(part, nr.target));
    drop(part);
    presRels = presRels.replace(r.xml, '');
  }
  let pres = get('ppt/presentation.xml')
    .replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\/>/, '')
    .replace(/<p:custShowLst>[\s\S]*?<\/p:custShowLst>/, '')
    // the slide sections list names the template's slides
    .replace(/<p:ext uri="\{521415D9-36F7-43E2-AB2F-B90AF26B5E84\}">[\s\S]*?<\/p:ext>/, '');

  // 2. the template's layouts, to put each NESR slide on the same kind
  const tLayouts = [...out.keys()].filter((k) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(k)).sort((a, b) => partNo(a) - partNo(b)).map((k) => ({ part: k, ...layoutInfo(get(k)) }));
  if (!tLayouts.length) throw new Error('The company template has no slide layouts');
  const pickLayout = (srcLayout: string) => {
    const s = layoutInfo(src(srcLayout));
    return (s.type && s.type !== 'cust' && tLayouts.find((l) => l.type === s.type))
      || (s.name && tLayouts.find((l) => l.name === s.name))
      || tLayouts.find((l) => l.type === 'obj') || tLayouts.find((l) => l.type === 'tx') || tLayouts[0];
  };

  // 3. the NESR slides, in order
  const srcPresRels = relsIn(src('ppt/_rels/presentation.xml.rels'));
  const order = [...src('ppt/presentation.xml').matchAll(/<p:sldId\b[^>]*>/g)]
    .map((m) => srcPresRels.find((r) => r.id === attr(m[0], 'r:id'))).filter((r): r is RelEntry => !!r)
    .map((r) => resolvePart('ppt/presentation.xml', r.target)).filter((p) => files.has(p));
  if (!order.length) throw new Error('The editable file has no slides');
  let n = 0;
  const newName = (dir: string, base: string) => { let name = `${dir}/${base}`; while (out.has(name)) name = `${dir}/c${++n}_${base}`; return name; };
  const slideName = new Map<string, string>();
  order.forEach((p, i) => { const name = newName('ppt/slides', `slide${i + 1}.xml`); slideName.set(p, name); out.set(name, new Uint8Array()); });
  const srcOverride = (part: string) => new RegExp(`<Override\\b[^>]*PartName="/${reEsc(part)}"[^>]*/>`).exec(srcCt)?.[0];
  const addOverride = (part: string, type: string) => { if (type && !ct.includes(`PartName="/${part}"`)) ct = ct.replace('</Types>', `<Override PartName="/${part}" ContentType="${type}"/></Types>`); };
  const addDefault = (part: string) => {
    const ext = (/\.([a-z0-9]+)$/i.exec(part)?.[1] ?? '').toLowerCase();
    if (!ext || new RegExp(`Extension="${ext}"`, 'i').test(ct)) return;
    const type = attr(new RegExp(`<Default\\b[^>]*Extension="${ext}"[^>]*/>`, 'i').exec(srcCt)?.[0] ?? '', 'ContentType') ?? MEDIA_TYPES[ext];
    if (type) ct = ct.replace(/(<Types\b[^>]*>)/, `$1<Default Extension="${ext}" ContentType="${type}"/>`);
  };
  const editText = (xml: string) => {
    const coloured = recolour(xml, fromColours, toColour, counts);
    const paras = paragraphs(coloured, 'a');
    applyRules(paras, rules, counts);
    return rebuild(coloured, paras, 'a');
  };

  // any other part a slide uses (pictures, charts, SmartArt, video), copied once under a free name
  const copied = new Map<string, string>();
  const copyPart = (part: string): string | null => {
    if (copied.has(part)) return copied.get(part)!;
    const bytes = files.get(part);
    if (!bytes) return null;
    const dest = newName(dirOf(part), baseOf(part));
    copied.set(part, dest);
    out.set(dest, /^ppt\/diagrams\/(data|drawing)\d*\.xml$/.test(part) ? te.encode(editText(td.decode(bytes))) : bytes);
    const o = srcOverride(part);
    if (o) addOverride(dest, attr(o, 'ContentType') ?? ''); else addDefault(dest);
    const rels = files.get(relsPath(part));
    if (rels) {
      let x = td.decode(rels);
      for (const r of relsIn(x)) {
        if (r.external) continue;
        const to = copyPart(resolvePart(part, r.target));
        x = x.replace(r.xml, to ? r.xml.replace(`Target="${r.target}"`, `Target="${relativeTo(dest, to)}"`) : '');
      }
      out.set(relsPath(dest), te.encode(x));
    }
    return dest;
  };

  const ids: string[] = [];
  order.forEach((part, i) => {
    const dest = slideName.get(part)!;
    out.set(dest, te.encode(editText(src(part))));
    let x = src(relsPath(part)) || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    for (const r of relsIn(x)) {
      if (r.external) continue;
      const target = resolvePart(part, r.target);
      let to: string | null;
      if (r.type === `${REL}/slideLayout`) to = pickLayout(target).part;
      else if (r.type === `${REL}/notesSlide` || /comment/i.test(r.type)) to = null;
      else if (r.type === `${REL}/slide`) to = slideName.get(target) ?? null;
      else to = copyPart(target);
      x = x.replace(r.xml, to ? r.xml.replace(`Target="${r.target}"`, `Target="${relativeTo(dest, to)}"`) : '');
    }
    out.set(relsPath(dest), te.encode(x));
    addOverride(dest, SLIDE_CT);
    const rid = `rIdCopy${i + 1}`;
    presRels = presRels.replace('</Relationships>', `<Relationship Id="${rid}" Type="${REL}/slide" Target="${relativeTo('ppt/presentation.xml', dest)}"/></Relationships>`);
    ids.push(`<p:sldId id="${256 + i}" r:id="${rid}"/>`);
  });
  pres = pres.replace(/(<p:sldSz\b)/, `<p:sldIdLst>${ids.join('')}</p:sldIdLst>$1`);
  out.set('ppt/presentation.xml', te.encode(pres));
  out.set(presRelsPath, te.encode(presRels));
  out.set('[Content_Types].xml', te.encode(ct));
  counts.set('Slide masters, layouts, theme and logo from the template', order.length);

  const size = (xml: string) => /<p:sldSz\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(xml)?.slice(1).join('x');
  const leftovers = new Set<string>();
  if (size(src('ppt/presentation.xml')) !== size(pres)) leftovers.add('The slide size differs from the template: check each slide’s layout');
  for (const p of slideName.values()) {
    for (const para of paragraphs(get(p), 'a')) {
      const s = joined(para);
      for (const m of s.matchAll(leftWord)) leftovers.add(s.slice(Math.max(0, m.index! - 30), m.index! + 34).trim());
    }
  }
  return {
    bytes: zip([...out].map(([name, data]) => ({ name, data }))),
    changes: [...counts].map(([label, c]) => ({ label, n: c })),
    leftovers: [...leftovers].slice(0, 12),
    usedTemplate: tLayouts.map((l) => l.part),
  };
}
