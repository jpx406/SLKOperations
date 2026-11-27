// The PowerPoint of a lesson learnt or best practice (6z.57), made on the company's own slides template from the
// Knowledge Hub settings: the template's slides are taken out and one slide is added on its first layout, so the
// slide master keeps the company header, logo and sign-off tables. The page content goes on the slide as text boxes,
// tables, rectangles and pictures at the same places as in the PDF. With no blocks it is the blank template.

import { zip } from './xlsx';
import { unzip } from './xlsxRead';
import { PAGE, type Block, type MasterPart, type Para, type Run, type TemplateStyle } from './lessonLayout';

const td = new TextDecoder();
const te = new TextEncoder();
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml';

export interface SlideImage { bytes: Uint8Array; type: 'image/jpeg' | 'image/png' }

const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const relsPath = (part: string) => part.replace(/([^/]+)$/, '_rels/$1.rels');
/** A relationship target resolved against the part that holds it. */
function resolve(from: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = from.split('/').slice(0, -1);
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
}
const relsIn = (x: string) => [...x.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => ({ xml: m[0], id: attr(m[0], 'Id') ?? '', type: attr(m[0], 'Type') ?? '', target: attr(m[0], 'Target') ?? '' }));

const numOf = (k: string) => Number(/(\d+)\.xml$/.exec(k)?.[1] ?? 0);

/**
 * What a slide on this template is built on, as PowerPoint shows it (6z.62): the layout the template's own first
 * slide uses (else the first layout), that layout's slide master, and whether the layout shows the master's shapes.
 * A template can hold several masters and layouts, and the first master is not always the one in use.
 */
export function slideFrame(files: Map<string, Uint8Array>): { layout: string; master: string | null; showMaster: boolean } | null {
  const get = (k: string) => td.decode(files.get(k) ?? new Uint8Array());
  const presRels = relsIn(get('ppt/_rels/presentation.xml.rels'));
  const firstId = /<p:sldId\b[^>]*r:id="([^"]+)"/.exec(get('ppt/presentation.xml'))?.[1];
  const slideRel = presRels.find((r) => r.id === firstId) ?? presRels.find((r) => r.type === `${REL}/slide`);
  const slide = slideRel ? resolve('ppt/presentation.xml', slideRel.target) : null;
  const fromSlide = slide ? relsIn(get(relsPath(slide))).find((r) => r.type === `${REL}/slideLayout`) : undefined;
  let layout = fromSlide && slide ? resolve(slide, fromSlide.target) : null;
  if (!layout || !files.has(layout)) layout = [...files.keys()].filter((k) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(k)).sort((a, b) => numOf(a) - numOf(b))[0] ?? null;
  if (!layout) return null;
  const m = relsIn(get(relsPath(layout))).find((r) => r.type === `${REL}/slideMaster`);
  let master = m ? resolve(layout, m.target) : null;
  if (!master || !files.has(master)) master = [...files.keys()].filter((k) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(k)).sort((a, b) => numOf(a) - numOf(b))[0] ?? null;
  const head = /<p:sldLayout\b[^>]*>/.exec(get(layout))?.[0] ?? '';
  return { layout, master, showMaster: !/showMasterSp="(0|false)"/.test(head) };
}

/** The shape trees a slide shows: the master's (unless the layout hides them), then the layout's own. */
function frameParts(files: Map<string, Uint8Array>): { part: string; tree: string }[] {
  const f = slideFrame(files);
  if (!f) return [];
  const tree = (k: string) => /<p:spTree>([\s\S]*)<\/p:spTree>/.exec(td.decode(files.get(k)!))?.[1] ?? '';
  return [...(f.master && f.showMaster ? [{ part: f.master, tree: tree(f.master) }] : []), { part: f.layout, tree: tree(f.layout) }];
}

/** The logo on the template's master or layout (the biggest picture): its picture, type and drawn size. */
export async function templateLogo(tpl: Uint8Array | Map<string, Uint8Array>): Promise<(SlideImage & { w: number; h: number }) | null> {
  let files: Map<string, Uint8Array>;
  try { files = tpl instanceof Map ? tpl : await unzip(tpl, true); } catch { return null; }
  let best: (SlideImage & { w: number; h: number }) | null = null;
  for (const { part: owner, tree } of frameParts(files)) {
    const rels = relsIn(td.decode(files.get(relsPath(owner)) ?? new Uint8Array()));
    for (const m of tree.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
      const rid = /r:embed="([^"]+)"/.exec(m[0])?.[1];
      const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(m[0]);
      const rel = rels.find((r) => r.id === rid);
      if (!rel || !ext) continue;
      const part = resolve(owner, rel.target);
      const type = /\.png$/i.test(part) ? 'image/png' : /\.jpe?g$/i.test(part) ? 'image/jpeg' : null;
      const bytes = files.get(part);
      if (!type || !bytes) continue;
      const w = Number(ext[1]), h = Number(ext[2]);
      if (!best || w * h > best.w * best.h) best = { bytes, type, w, h };
    }
  }
  return best;
}

/**
 * The colours of the template's slide master: the header band (none when white), the header title, the title bar
 * and the sign-off header rows, so the preview and the PDF look like the PowerPoint.
 */
export async function templateStyle(tpl: Uint8Array | Map<string, Uint8Array>): Promise<TemplateStyle | null> {
  let files: Map<string, Uint8Array>;
  try { files = tpl instanceof Map ? tpl : await unzip(tpl, true); } catch { return null; }
  const frame = frameParts(files);
  if (!frame.length) return null;
  // the master's shapes (when the layout shows them), then the layout's own, as one drawing
  const mx = `<p:spTree>${frame.map((x) => x.tree).join('')}</p:spTree>`;
  const colourIn = (x: string) => {
    const m = /<a:solidFill>\s*<a:(srgbClr|schemeClr) val="(\w+)"/.exec(x);
    if (!m) return null;
    return m[1] === 'srgbClr' ? m[2].toUpperCase() : m[2] === 'bg1' || m[2] === 'lt1' ? 'FFFFFF' : m[2] === 'tx1' || m[2] === 'dk1' ? '000000' : null;
  };
  const shapes = [...mx.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => {
    const o = /<a:off x="(\d+)" y="(\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/.exec(m[0]);
    const spPr = /<p:spPr[\s\S]*?<\/p:spPr>/.exec(m[0])?.[0] ?? '';
    const rPr = /<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/.exec(m[0])?.[0] ?? '';
    const text = [...m[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join('').trim();
    return o ? { x: Number(o[1]) / 12700, y: Number(o[2]) / 12700, w: Number(o[3]) / 12700, h: Number(o[4]) / 12700, fill: colourIn(spPr.replace(/<a:ln\b[\s\S]*?<\/a:ln>/, '')), text, textColour: colourIn(rPr) } : null;
  }).filter((s): s is NonNullable<typeof s> => !!s);
  const near = (a: number, b: number, d = 3) => Math.abs(a - b) <= d;
  const band = shapes.find((s) => near(s.y, 10) && s.h > 30 && s.h < 60 && s.w > 400 && s.fill)?.fill ?? null;
  const bar = shapes.find((s) => near(s.y, 53, 4) && s.h > 15 && s.h < 35 && s.w > 400 && s.fill)?.fill;
  const foot = shapes.find((s) => near(s.y, 685, 5) && s.h < 16 && s.w > 400 && s.fill)?.fill;
  const title = shapes.find((s) => s.y < 50 && s.text && s.textColour)?.textColour;
  if (!bar && !title) return null;
  const main = bar ?? title ?? '024800';
  const parts = masterParts(mx, themeColours(files));
  // the free body: below the header's bands and above the sign-off tables
  const wide = shapes.filter((s) => s.w > 300 && s.h < 200);
  const headBottom = Math.max(0, ...wide.filter((s) => s.y < 150).map((s) => s.y + s.h));
  const footTop = Math.min(780, ...shapes.filter((s) => s.y > 500).map((s) => s.y));
  return { band: band && band !== 'FFFFFF' ? band : null, title: title ?? main, bar: main, foot: foot ?? main, body: { top: Math.round(headBottom + 4), bottom: Math.round(footTop - 4) }, master: parts };
}

/** The theme's named colours (accent1, dk1, lt1…) as hex. */
function themeColours(files: Map<string, Uint8Array>): Record<string, string> {
  const key = [...files.keys()].filter((k) => /^ppt\/theme\/theme\d+\.xml$/.test(k)).sort()[0];
  const out: Record<string, string> = { bg1: 'FFFFFF', lt1: 'FFFFFF', tx1: '000000', dk1: '000000' };
  if (!key) return out;
  const x = td.decode(files.get(key)!);
  for (const m of x.matchAll(/<a:(dk1|lt1|dk2|lt2|accent\d|hlink|folHlink)>\s*<a:(?:srgbClr val="(\w+)"|sysClr[^>]*lastClr="(\w+)")/g)) out[m[1]] = (m[2] ?? m[3]).toUpperCase();
  out.bg1 = out.lt1; out.tx1 = out.dk1; out.bg2 = out.lt2 ?? out.bg1; out.tx2 = out.dk2 ?? out.tx1;
  return out;
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

/**
 * What the template's slide master shows, in its own order (6z.61): the coloured bars, the outlined sign-off cells,
 * the fixed words (the title, "Slickline", the sign-off labels, the database line) and where the logo sits, so the
 * preview and the PDF show the template itself rather than a copy of it. Placeholders are left out: they only show
 * on a slide when filled.
 */
export function masterParts(mx: string, theme: Record<string, string>): MasterPart[] {
  const out: MasterPart[] = [];
  const colour = (x: string | undefined) => {
    if (!x || /^\s*<a:noFill\/>/.test(x)) return undefined;
    const m = /<a:(srgbClr|schemeClr|prstClr|sysClr) val="(\w+)"(?:[^>]*lastClr="(\w+)")?/.exec(x);
    if (!m) return undefined;
    return m[1] === 'srgbClr' ? m[2].toUpperCase() : m[1] === 'sysClr' ? (m[3] ?? '000000').toUpperCase() : m[1] === 'prstClr' ? ({ white: 'FFFFFF', black: '000000' } as Record<string, string>)[m[2]] : theme[m[2]];
  };
  const tree = /<p:spTree>([\s\S]*)<\/p:spTree>/.exec(mx)?.[1] ?? '';
  for (const m of tree.matchAll(/<(p:sp|p:pic)>[\s\S]*?<\/\1>/g)) {
    const sp = m[0];
    if (/<p:ph\b/.test(sp)) continue;
    const o = /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/.exec(sp);
    if (!o) continue;
    const box = { x: Number(o[1]) / 12700, y: Number(o[2]) / 12700, w: Number(o[3]) / 12700, h: Number(o[4]) / 12700 };
    if (m[1] === 'p:pic') { out.push({ k: 'logo', ...box }); continue; }
    // the shape: its fill and outline, from its own properties or else its style
    const spPr = /<p:spPr\b[\s\S]*?<\/p:spPr>/.exec(sp)?.[0] ?? '';
    const ln = /<a:ln\b[^>]*>[\s\S]*?<\/a:ln>|<a:ln\b[^>]*\/>/.exec(spPr)?.[0];
    const body0 = spPr.replace(/<a:ln\b[^>]*>[\s\S]*?<\/a:ln>|<a:ln\b[^>]*\/>/, '');
    const style = /<p:style>[\s\S]*?<\/p:style>/.exec(sp)?.[0] ?? '';
    const ownFill = /<a:(solidFill|noFill|gradFill|blipFill|pattFill)\b/.exec(body0)?.[1];
    const fill = ownFill === 'solidFill' ? colour(/<a:solidFill>[\s\S]*?<\/a:solidFill>/.exec(body0)?.[0]) : !ownFill && /<a:fillRef idx="[1-9]/.test(style) ? colour(/<a:fillRef[\s\S]*?<\/a:fillRef>/.exec(style)?.[0]) : undefined;
    const lnFill = ln ? /<a:(solidFill|noFill)\b/.exec(ln)?.[1] : undefined;
    const stroke = lnFill === 'solidFill' ? colour(/<a:solidFill>[\s\S]*?<\/a:solidFill>/.exec(ln!)?.[0]) : !lnFill && /<a:lnRef idx="[1-9]/.test(style) ? colour(/<a:lnRef[\s\S]*?<\/a:lnRef>/.exec(style)?.[0]) : undefined;
    const sw = ln && /\bw="(\d+)"/.exec(ln) ? Number(/\bw="(\d+)"/.exec(ln)![1]) / 12700 : 0.75;
    if (fill || stroke) out.push({ k: 'rect', ...box, fill, stroke, sw });
    const body = /<p:txBody>[\s\S]*?<\/p:txBody>/.exec(sp)?.[0];
    if (!body) continue;
    const paras = [...body.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((p) => [...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => unxml(t[1])).join(''));
    const t = paras.join('\n').replace(/[ \t]+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!t) continue;
    const rPr = /<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/.exec(body)?.[0] ?? '';
    const size = Number(/\bsz="(\d+)"/.exec(rPr)?.[1] ?? /\bsz="(\d+)"/.exec(body)?.[1] ?? 1800) / 100;
    const bodyPr = /<a:bodyPr\b[^>]*>/.exec(body)?.[0] ?? '';
    const ins = (k: string, d: number) => { const v = new RegExp(`\\b${k}="(\\d+)"`).exec(bodyPr)?.[1]; return v ? Number(v) / 12700 : d; };
    const algn = /<a:pPr\b[^>]*\balgn="(\w+)"/.exec(body)?.[1];
    const anchor = /\banchor="(\w+)"/.exec(bodyPr)?.[1];
    out.push({
      k: 'text', ...box, t, size,
      b: /\bb="1"/.test(rPr), c: colour(/<a:solidFill>[\s\S]*?<\/a:solidFill>/.exec(rPr)?.[0]) ?? theme.tx1 ?? '000000', align: algn === 'ctr' ? 'c' : algn === 'r' ? 'r' : 'l',
      valign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top', padX: ins('lIns', 7.2), padY: ins('tIns', 3.6),
    });
  }
  return out;
}

interface Ctx { sx: number; sy: number; id: number; images: Map<string, string>; rels: string[]; media: { name: string; data: Uint8Array }[]; mediaNo: number }
const E = (pt: number) => Math.round(pt * 12700);

function runXml(r: Run, size: number, ctx: Ctx): string {
  const rPr = (t: string) => `<a:r><a:rPr lang="en-GB" sz="${Math.round(size * ctx.sy * 100)}"${r.b ? ' b="1"' : ' b="0"'}${r.u ? ' u="sng"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${r.c ?? '111827'}"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${xml(t)}</a:t></a:r>`;
  return r.t.split('\n').map((t, i) => (i ? '<a:br><a:rPr lang="en-GB" dirty="0"/></a:br>' : '') + (t ? rPr(t) : '')).join('');
}
function paraXml(p: Para, ctx: Ctx, n: number): string {
  const ind = p.bullet ? E(p.size * (p.bullet.length > 1 ? 1.6 : 1.1)) : 0;
  const bu = !p.bullet ? '<a:buNone/>' : p.bullet === '•' ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod" startAt="${n}"/>`;
  const algn = p.align === 'c' ? 'ctr' : p.align === 'r' ? 'r' : 'l';
  return `<a:p><a:pPr marL="${ind}" indent="${-ind}" algn="${algn}"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="${Math.round((p.gap ?? 0) * 100)}"/></a:spcBef>${bu}</a:pPr>${p.runs.map((r) => runXml(r, p.size, ctx)).join('')}<a:endParaRPr lang="en-GB" sz="${Math.round(p.size * ctx.sy * 100)}" dirty="0"/></a:p>`;
}
const xfrm = (b: { x: number; y: number; w: number; h: number }, ctx: Ctx, tag = 'a:xfrm') =>
  `<${tag}><a:off x="${E(b.x * ctx.sx)}" y="${E(b.y * ctx.sy)}"/><a:ext cx="${E(b.w * ctx.sx)}" cy="${E(b.h * ctx.sy)}"/></${tag}>`;
const fill = (hex?: string) => (hex ? `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>` : '<a:noFill/>');

function shapeXml(b: Block, ctx: Ctx): string {
  const id = ++ctx.id;
  if (b.k === 'rect') {
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(b, ctx)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill(b.fill)}<a:ln${b.stroke ? ` w="${E(b.sw ?? 0.6)}"` : ''}>${fill(b.stroke)}</a:ln></p:spPr></p:sp>`;
  }
  if (b.k === 'image') {
    const rid = ctx.images.get(b.pic);
    if (!rid) return '';
    return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(b, ctx)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  }
  if (b.k === 'text') {
    let n = 0;
    const paras = b.paras.map((p) => { n = p.bullet && p.bullet !== '•' ? Number.parseInt(p.bullet, 10) || n + 1 : n; return paraXml(p, ctx, n); }).join('');
    const ins = E(b.pad);
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(b, ctx)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" anchor="${b.valign === 'middle' ? 'ctr' : 't'}"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
  }
  // table
  const ln = (side: string) => `<a:${side} w="${E(0.5)}">${fill(b.grid || undefined)}</a:${side}>`;
  const rows = b.rows.map((r) => `<a:tr h="${E(r.h * ctx.sy)}">${r.cells.map((c) => {
    const p = paraXml({ runs: c.runs, size: r.size, align: c.align }, ctx, 0);
    return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${p}</a:txBody><a:tcPr marL="${E(3)}" marR="${E(3)}" marT="${E(2)}" marB="${E(2)}" anchor="ctr">${ln('lnL')}${ln('lnR')}${ln('lnT')}${ln('lnB')}${fill(r.fill)}</a:tcPr></a:tc>`;
  }).join('')}</a:tr>`).join('');
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${xfrm(b, ctx, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid>${b.cols.map((w) => `<a:gridCol w="${E(w * ctx.sx)}"/>`).join('')}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

/** One slide on the template's first layout holding `blocks`; with no blocks, the blank template. */
export async function lessonPptx(tpl: Uint8Array | Map<string, Uint8Array>, blocks: Block[], images: Map<string, SlideImage>): Promise<Uint8Array> {
  let out: Map<string, Uint8Array>;
  // a copy: the parts are changed here, and the caller may use the unzipped template again
  try { out = tpl instanceof Map ? new Map(tpl) : await unzip(tpl, true); } catch { throw new Error('The company template is not a PowerPoint file (.pptx)'); }
  if (!out.has('ppt/presentation.xml')) throw new Error('The company template is not a PowerPoint file (.pptx)');
  const get = (k: string) => td.decode(out.get(k) ?? new Uint8Array());
  const put = (k: string, s: string) => out.set(k, te.encode(s));
  let ct = get('[Content_Types].xml');
  const overrideRe = (part: string) => new RegExp(`<Override\\b[^>]*PartName="/${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`, 'g');

  // the layout the template's own slide is on (read before its slides come out, 6z.62)
  const frame = slideFrame(out);
  // the template's own slides (and their notes) come out
  let presRels = get('ppt/_rels/presentation.xml.rels');
  const drop = (part: string) => { out.delete(part); out.delete(relsPath(part)); ct = ct.replace(overrideRe(part), ''); };
  for (const r of relsIn(presRels).filter((x) => x.type === `${REL}/slide`)) {
    const part = resolve('ppt/presentation.xml', r.target);
    for (const nr of relsIn(get(relsPath(part))).filter((x) => x.type === `${REL}/notesSlide`)) drop(resolve(part, nr.target));
    drop(part);
    presRels = presRels.replace(r.xml, '');
  }
  let pres = get('ppt/presentation.xml')
    .replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\/>/, '')
    .replace(/<p:custShowLst>[\s\S]*?<\/p:custShowLst>/, '')
    .replace(/<p:ext uri="\{521415D9-36F7-43E2-AB2F-B90AF26B5E84\}">[\s\S]*?<\/p:ext>/, '');

  // the page size of the template; the layout is drawn for 540 × 780 pt and scaled to it
  const sz = /<p:sldSz\b[^>]*>/.exec(pres)?.[0] ?? '';
  const cx = Number(attr(sz, 'cx') ?? E(PAGE.w)), cy = Number(attr(sz, 'cy') ?? E(PAGE.h));
  const layout = frame?.layout;
  if (!layout) throw new Error('The company template has no slide layouts');

  const ctx: Ctx = { sx: cx / E(PAGE.w), sy: cy / E(PAGE.h), id: 1, images: new Map(), rels: [], media: [], mediaNo: 0 };
  ctx.rels.push(`<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/${layout.split('/').pop()}"/>`);
  for (const b of blocks) {
    if (b.k !== 'image' || ctx.images.has(b.pic)) continue;
    const img = images.get(b.pic);
    if (!img) continue;
    const ext = img.type === 'image/png' ? 'png' : 'jpeg';
    let name = `ppt/media/lesson${++ctx.mediaNo}.${ext}`;
    while (out.has(name)) name = `ppt/media/lesson${++ctx.mediaNo}.${ext}`;
    out.set(name, img.bytes);
    const rid = `rId${ctx.rels.length + 1}`;
    ctx.rels.push(`<Relationship Id="${rid}" Type="${REL}/image" Target="../media/${name.split('/').pop()}"/>`);
    ctx.images.set(b.pic, rid);
    if (!new RegExp(`Extension="${ext}"`, 'i').test(ct)) ct = ct.replace(/(<Types\b[^>]*>)/, `$1<Default Extension="${ext}" ContentType="${img.type}"/>`);
  }
  const shapes = blocks.map((b) => shapeXml(b, ctx)).join('');
  put('ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
  put('ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${ctx.rels.join('')}</Relationships>`);
  ct = ct.replace('</Types>', `<Override PartName="/ppt/slides/slide1.xml" ContentType="${PPTX}.slide+xml"/></Types>`);
  presRels = presRels.replace('</Relationships>', `<Relationship Id="rIdLesson1" Type="${REL}/slide" Target="slides/slide1.xml"/></Relationships>`);
  pres = pres.replace(/<p:sldSz\b/, '<p:sldIdLst><p:sldId id="256" r:id="rIdLesson1"/></p:sldIdLst><p:sldSz');
  put('ppt/presentation.xml', pres);
  put('ppt/_rels/presentation.xml.rels', presRels);
  put('[Content_Types].xml', ct);
  // the counts in the app properties name the template's slides; PowerPoint recounts on save
  const app = get('docProps/app.xml');
  if (app) put('docProps/app.xml', app.replace(/<Slides>\d+<\/Slides>/, '<Slides>1</Slides>').replace(/<Notes>\d+<\/Notes>/, '<Notes>0</Notes>'));
  return zip([...out.entries()].map(([name, data]) => ({ name, data })));
}

// ---- a company template made from the NESR one (6z.64) --------------------------------------------------------------

export interface BrandOptions {
  /** The company's logo, put where the NESR logo is, at its own shape. */
  logo: SlideImage & { w: number; h: number };
  /** The company colour (hex) that takes the place of the NESR greens. */
  colour: string;
  /** The NESR colours to replace (from the settings and the NESR template's own bars). */
  from: string[];
  /** The name on the database line: "SAPESCO" or "GES". */
  db: string;
  /** solid: the header band in the company colour with white words (as NESR); white: a white band with the words in the company colour. */
  band: 'solid' | 'white';
}

/**
 * The NESR slides template turned into a company's: the same master, layout, sign-off tables and words, with the
 * company logo in the logo's place, the company colour for the NESR greens, the company's name on the database line
 * and no "NESR" in the title. Its slides are taken out and one empty slide is left, as for a blank template. All the
 * companies then share one layout, so the page, the PDF and the PowerPoint line up the same for each.
 */
export async function brandTemplate(nesr: Uint8Array, o: BrandOptions): Promise<Uint8Array> {
  let files: Map<string, Uint8Array>;
  try { files = await unzip(nesr, true); } catch { throw new Error('The NESR template is not a PowerPoint file (.pptx)'); }
  const frame = slideFrame(files);
  if (!frame) throw new Error('The NESR template has no slide layout');
  const get = (k: string) => td.decode(files.get(k) ?? new Uint8Array());
  const put = (k: string, s: string) => files.set(k, te.encode(s));
  const colour = o.colour.toUpperCase();
  const from = new Set(o.from.map((c) => c.toUpperCase()).filter((c) => c && c !== 'FFFFFF' && c !== '000000'));
  const ext = o.logo.type === 'image/png' ? 'png' : 'jpeg';
  const media = `ppt/media/company-logo.${ext}`;
  files.set(media, o.logo.bytes);
  let ct = get('[Content_Types].xml');
  if (!new RegExp(`Extension="${ext}"`, 'i').test(ct)) ct = ct.replace(/(<Types\b[^>]*>)/, `$1<Default Extension="${ext}" ContentType="${o.logo.type}"/>`);
  put('[Content_Types].xml', ct);

  // the parts a slide shows: the master (when the layout shows it) and the layout
  const parts = [...(frame.master && frame.showMaster ? [frame.master] : []), frame.layout];
  // the logo: the biggest picture of those parts
  let logoAt: { part: string; xml: string } | null = null, best = 0;
  for (const part of parts) {
    for (const m of get(part).matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
      const e = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(m[0]);
      const area = e ? Number(e[1]) * Number(e[2]) : 0;
      if (area > best) { best = area; logoAt = { part, xml: m[0] }; }
    }
  }
  for (const part of parts) {
    let x = get(part);
    // the logo picture points at the company logo, fitted in the same box at its own shape
    if (logoAt?.part === part) {
      const rid = /r:embed="([^"]+)"/.exec(logoAt.xml)?.[1];
      const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(logoAt.xml);
      // no crop, and no vector (SVG) copy of the NESR mark, which PowerPoint would draw instead of the picture
      let pic = logoAt.xml.replace(/<a:srcRect\b[^>]*\/>/, '')
        .replace(/<a:ext uri="\{96DAC541-7B7A-43D3-8B79-37D633B846F1\}">[\s\S]*?<\/a:ext>/g, '')
        .replace(/<a:extLst>\s*<\/a:extLst>/g, '');
      if (off) {
        const bx = Number(off[1]), by = Number(off[2]), bw = Number(off[3]), bh = Number(off[4]);
        // the box grows to the left for a wide logo (the NESR mark is nearly square, company logos are wide)
        // up to 34 pt tall (the header band's height, less a margin), centred where the NESR mark sits
        const h = Math.max(bh, E(34)), w = Math.round((h * o.logo.w) / o.logo.h);
        const right = bx + bw, maxW = Math.max(bw, Math.round(right - E(250)));
        const fw = Math.min(w, maxW), fh = Math.round((fw * o.logo.h) / o.logo.w);
        // centred on the header band (the NESR mark sat a little above its middle), else on the old box
        let mid = by + bh / 2;
        for (const sp of x.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
          const b = /<a:off x="-?\d+" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/.exec(sp[0]);
          if (b && Number(b[1]) < E(15) && Number(b[3]) > E(30) && Number(b[3]) < E(60) && Number(b[2]) > E(400) && by >= Number(b[1]) && by < Number(b[1]) + Number(b[3])) { mid = Number(b[1]) + Number(b[3]) / 2; break; }
        }
        pic = pic.replace(off[0], `<a:off x="${right - fw}" y="${Math.round(mid - fh / 2)}"/><a:ext cx="${fw}" cy="${fh}"/>`);
      }
      x = x.replace(logoAt.xml, pic);
      if (rid) {
        const rp = relsPath(part);
        const target = `../media/${media.split('/').pop()}`;
        put(rp, get(rp).replace(/<Relationship\b[^>]*\/>/g, (r) => (attr(r, 'Id') === rid ? r.replace(/\bTarget="[^"]*"/, `Target="${target}"`) : r)));
      }
    }
    // the NESR greens become the company colour
    x = x.replace(/<a:srgbClr val="([0-9A-Fa-f]{6})"/g, (m, c: string) => (from.has(c.toUpperCase()) ? `<a:srgbClr val="${colour}"` : m));
    // shapes one by one: the header words, the database line, "NESR" in the words
    x = x.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => {
      const off = /<a:off x="-?\d+" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/.exec(sp);
      const y = off ? Number(off[1]) / 12700 : 999, w = off ? Number(off[2]) / 12700 : 0, h = off ? Number(off[3]) / 12700 : 0;
      let s = sp;
      const isBand = y < 15 && h > 30 && h < 60 && w > 400 && !/<p:txBody>[\s\S]*<a:t>/.test(sp);
      if (o.band === 'white' && isBand) s = s.replace(new RegExp(`<a:srgbClr val="${colour}"`, 'g'), '<a:srgbClr val="FFFFFF"');
      const words = [...s.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('');
      if (words) {
        // the title has no company name; elsewhere NESR becomes the company's
        s = s.replace(/<a:t>([^<]*)<\/a:t>/g, (_m, t: string) => `<a:t>${y < 50 ? t.replace(/\bNESR\s*/g, '') : t.replace(/\bNESR\b/g, o.db)}</a:t>`);
        if (o.band === 'white' && y < 50) s = s.replace(/(<a:rPr\b[^>]*>)\s*<a:solidFill>[\s\S]*?<\/a:solidFill>/g, `$1<a:solidFill><a:srgbClr val="${colour}"/></a:solidFill>`);
        // the database line sits on a bar now in the company colour: its words go white
        if (/KNOWLEDGE DATABASE/i.test(words)) s = s.replace(/(<a:rPr\b[^>]*>)\s*<a:solidFill>[\s\S]*?<\/a:solidFill>/g, `$1<a:solidFill><a:schemeClr val="bg1"/></a:solidFill>`).replace(/<a:rPr\b([^>]*)\/>/g, '<a:rPr$1><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:rPr>');
      }
      return s;
    });
    put(part, x);
  }
  // one empty slide, as a blank template
  return lessonPptx(zip([...files].map(([name, data]) => ({ name, data }))), [], new Map());
}
