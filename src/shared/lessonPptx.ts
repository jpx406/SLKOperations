// The PowerPoint of a lesson learnt or best practice (6z.57), made on the company's own slides template from the
// Knowledge Hub settings: the template's slides are taken out and one slide is added on its first layout, so the
// slide master keeps the company header, logo and sign-off tables. The page content goes on the slide as text boxes,
// tables, rectangles and pictures at the same places as in the PDF. With no blocks it is the blank template.

import { zip } from './xlsx';
import { unzip } from './xlsxRead';
import { PAGE, type Block, type Para, type Run, type TemplateStyle } from './lessonLayout';

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

/** The logo on the template's slide master: its picture, type and drawn size. */
export async function templateLogo(tpl: Uint8Array): Promise<(SlideImage & { w: number; h: number }) | null> {
  let files: Map<string, Uint8Array>;
  try { files = await unzip(tpl, true); } catch { return null; }
  const master = [...files.keys()].filter((k) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(k)).sort()[0];
  if (!master) return null;
  const mx = td.decode(files.get(master)!);
  const rels = relsIn(td.decode(files.get(relsPath(master)) ?? new Uint8Array()));
  let best: (SlideImage & { w: number; h: number }) | null = null;
  for (const m of mx.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
    const rid = /r:embed="([^"]+)"/.exec(m[0])?.[1];
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(m[0]);
    const rel = rels.find((r) => r.id === rid);
    if (!rel || !ext) continue;
    const part = resolve(master, rel.target);
    const type = /\.png$/i.test(part) ? 'image/png' : /\.jpe?g$/i.test(part) ? 'image/jpeg' : null;
    const bytes = files.get(part);
    if (!type || !bytes) continue;
    const w = Number(ext[1]), h = Number(ext[2]);
    if (!best || w * h > best.w * best.h) best = { bytes, type, w, h };
  }
  return best;
}

/**
 * The colours of the template's slide master: the header band (none when white), the header title, the title bar
 * and the sign-off header rows, so the preview and the PDF look like the PowerPoint.
 */
export async function templateStyle(tpl: Uint8Array): Promise<TemplateStyle | null> {
  let files: Map<string, Uint8Array>;
  try { files = await unzip(tpl, true); } catch { return null; }
  const master = [...files.keys()].filter((k) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(k)).sort()[0];
  if (!master) return null;
  const mx = td.decode(files.get(master)!);
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
  return { band: band && band !== 'FFFFFF' ? band : null, title: title ?? main, bar: main, foot: foot ?? main };
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
export async function lessonPptx(tpl: Uint8Array, blocks: Block[], images: Map<string, SlideImage>): Promise<Uint8Array> {
  let out: Map<string, Uint8Array>;
  try { out = await unzip(tpl, true); } catch { throw new Error('The company template is not a PowerPoint file (.pptx)'); }
  if (!out.has('ppt/presentation.xml')) throw new Error('The company template is not a PowerPoint file (.pptx)');
  const get = (k: string) => td.decode(out.get(k) ?? new Uint8Array());
  const put = (k: string, s: string) => out.set(k, te.encode(s));
  let ct = get('[Content_Types].xml');
  const overrideRe = (part: string) => new RegExp(`<Override\\b[^>]*PartName="/${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`, 'g');

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
  const layout = [...out.keys()].filter((k) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(k)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))[0];
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
