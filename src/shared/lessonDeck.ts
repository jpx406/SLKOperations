// The two lesson slides as PowerPoint (.pptx) and PDF (6z.17). One layout in points on a 960 x 540 widescreen slide,
// written out twice: as Office Open XML shapes (1 pt = 12 700 EMU) and with the app's PDF writer. Pictures come in as
// JPEG (the page converts the support pictures first). No dependencies: runs in the browser and in tests.

import type { Slide } from './docDigest';
import { PdfDoc, textWidth, wrap } from './pdf';
import { zip } from './xlsx';

export interface Jpeg { width: number; height: number; data: Uint8Array }
export interface LessonDeck {
  title: string; docNo: string | null; revision: number; kind: string; country: string; date: string;
  slides: Slide[]; pictures: (Jpeg | null)[];
}

const W = 960, H = 540;
const C = { ink: '0B121A', band: '0B121A', lime: 'C8D400', muted: '5B6470', amber: 'B26B00', amberBg: 'FFF4D6', white: 'FFFFFF', panel: 'EEF1F4', rule: 'D5DAE0' };
const rgb = (hex: string): [number, number, number] => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

// ---- layout: the same boxes and lines for both outputs ---------------------------------------------------------

type Item = { footer?: boolean } & (
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: string; line?: string }
  | { t: 'text'; x: number; y: number; w: number; lines: string[]; size: number; bold?: boolean; color: string; bullet?: boolean; right?: boolean }
  | { t: 'pic'; x: number; y: number; w: number; h: number; img: Jpeg });

/** The largest size from `sizes` at which every point fits in `h` once wrapped to `w`. */
function fit(points: string[], w: number, h: number, sizes: number[], bold = false) {
  for (const size of sizes) {
    const lines = points.map((p) => wrap(p, w, size, bold));
    const height = lines.reduce((a, l) => a + l.length * size * 1.25 + size * 0.6, 0);
    if (height <= h) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  return { size, lines: points.map((p) => wrap(p, w, size, bold)) };
}

export function layout(deck: LessonDeck, i: number): Item[] {
  const s = deck.slides[i];
  const pic = deck.pictures[i] ?? null;
  const items: Item[] = [];
  // header band: what this is, the number, the place
  items.push({ t: 'rect', x: 0, y: 0, w: W, h: 58, fill: C.band });
  items.push({ t: 'rect', x: 0, y: 58, w: W, h: 4, fill: C.lime });
  items.push({ t: 'text', x: 36, y: 20, w: 520, lines: [deck.kind.toUpperCase()], size: 13, bold: true, color: C.lime });
  const right = [deck.docNo, deck.revision ? `Rev ${deck.revision}` : null, deck.country].filter(Boolean).join('  ·  ');
  items.push({ t: 'text', x: 520, y: 21, w: 404, lines: [right], size: 11, color: C.white, right: true });
  // body: text on the left, the picture on the right when there is one
  const textW = pic ? 500 : W - 72;
  const title = fit([s.title], textW, 76, [30, 26, 22], true);
  items.push({ t: 'text', x: 36, y: 84, w: textW, lines: title.lines[0], size: title.size, bold: true, color: s.kind === 'warning' ? C.amber : C.ink });
  let y = 84 + title.lines[0].length * title.size * 1.2 + 18;
  const room = 488 - y - (s.note ? 40 : 0);
  if (s.kind === 'warning' && s.points.length) {
    // the key action in an amber box, then the rest
    const key = fit([s.points[0]], textW - 36, 110, [22, 20, 18, 16], true);
    const boxH = key.lines[0].length * key.size * 1.25 + 26;
    items.push({ t: 'rect', x: 36, y, w: textW, h: boxH, fill: C.amberBg, line: C.amber });
    items.push({ t: 'rect', x: 36, y, w: 6, h: boxH, fill: C.amber });
    items.push({ t: 'text', x: 56, y: y + 13, w: textW - 36, lines: key.lines[0], size: key.size, bold: true, color: C.ink });
    y += boxH + 16;
    const rest = s.points.slice(1);
    if (rest.length) {
      const b = fit(rest, textW - 22, 488 - y - (s.note ? 40 : 0), [18, 16, 15, 14, 13, 12]);
      for (const l of b.lines) { items.push({ t: 'text', x: 36, y, w: textW, lines: l, size: b.size, color: C.ink, bullet: true }); y += l.length * b.size * 1.25 + b.size * 0.6; }
    }
  } else {
    const b = fit(s.points, textW - 22, room, [20, 18, 16, 15, 14, 13, 12]);
    for (const l of b.lines) { items.push({ t: 'text', x: 36, y, w: textW, lines: l, size: b.size, color: C.ink, bullet: true }); y += l.length * b.size * 1.25 + b.size * 0.6; }
  }
  if (s.note) {
    const n = fit([s.note], textW - 14, 34, [12, 11, 10]);
    items.push({ t: 'rect', x: 36, y: 456, w: 3, h: 32, fill: C.rule });
    items.push({ t: 'text', x: 48, y: 460, w: textW - 14, lines: n.lines[0], size: n.size, color: C.muted });
  }
  if (pic) {
    // the whole picture, centred in its panel (never cropped, so nothing in it is lost)
    const bx = 572, by = 84, bw = 352, bh = 404;
    items.push({ t: 'rect', x: bx, y: by, w: bw, h: bh, fill: C.panel });
    const k = Math.min(bw / pic.width, bh / pic.height);
    const pw = pic.width * k, ph = pic.height * k;
    items.push({ t: 'pic', x: bx + (bw - pw) / 2, y: by + (bh - ph) / 2, w: pw, h: ph, img: pic });
  }
  // footer (the PDF writer prints its own footer and page numbers, so these are PowerPoint only)
  items.push({ t: 'rect', x: 36, y: 504, w: W - 72, h: 1, fill: C.rule, footer: true });
  items.push({ footer: true, t: 'text', x: 36, y: 512, w: 700, lines: [`NESR · SLK Operations Hub · ${deck.title} · ${deck.date}`], size: 9, color: C.muted });
  items.push({ footer: true, t: 'text', x: W - 136, y: 512, w: 100, lines: [`${i + 1} / ${deck.slides.length}`], size: 9, color: C.muted, right: true });
  return items;
}

// ---- PDF -------------------------------------------------------------------------------------------------------

export function deckPdf(deck: LessonDeck): Uint8Array {
  const pdf = new PdfDoc({ landscape: true, paper: 'SLIDE' });
  deck.slides.forEach((_, i) => {
    if (i > 0) pdf.addPage();
    for (const it of layout(deck, i).filter((x) => !x.footer)) {
      // the layout measures from the top; PDF from the bottom
      if (it.t === 'rect') {
        if (it.line) pdf.rect(it.x - 0.6, H - it.y - it.h - 0.6, it.w + 1.2, it.h + 1.2, rgb(it.line));
        pdf.rect(it.x, H - it.y - it.h, it.w, it.h, rgb(it.fill));
      } else if (it.t === 'pic') pdf.jpeg(it.img, it.x, H - it.y - it.h, it.w, it.h);
      else {
        it.lines.forEach((line, k) => {
          const base = H - it.y - it.size * (0.95 + k * 1.25);
          if (it.bullet && k === 0) pdf.circle(it.x + 5, base + it.size * 0.33, 2.6, rgb(C.lime), null);
          const lx = it.right ? it.x + it.w - textWidth(line, it.size, it.bold) : it.x + (it.bullet ? 18 : 0);
          pdf.text(lx, base, line, { size: it.size, bold: it.bold, color: rgb(it.color) });
        });
      }
    }
  });
  return pdf.bytes(`${deck.docNo ?? ''} ${deck.title}`.trim());
}

// ---- PowerPoint ----------------------------------------------------------------------------------------------------

const EMU = 12700;
const e = (pt: number) => Math.round(pt * EMU);
const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function shapes(items: Item[], picRel: (img: Jpeg) => string): string {
  let id = 2;
  return items.map((it) => {
    const xfrm = (w: number, h: number) => `<a:xfrm><a:off x="${e(it.x)}" y="${e(it.y)}"/><a:ext cx="${e(w)}" cy="${e(h)}"/></a:xfrm>`;
    if (it.t === 'rect') {
      return `<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="Box ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(it.w, it.h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${it.fill}"/></a:solidFill>${it.line ? `<a:ln w="12700"><a:solidFill><a:srgbClr val="${it.line}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>'}</p:spPr></p:sp>`;
    }
    if (it.t === 'pic') {
      return `<p:pic><p:nvPicPr><p:cNvPr id="${id++}" name="Picture ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${picRel(it.img)}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(it.w, it.h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    }
    // one paragraph per text item; PowerPoint wraps it inside the box at the size the layout chose
    const height = it.lines.length * it.size * 1.25 + it.size * 0.5;
    const bullet = it.bullet ? `<a:pPr marL="${e(18)}" indent="-${e(18)}"><a:buClr><a:srgbClr val="${C.lime}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/></a:pPr>` : `<a:pPr${it.right ? ' algn="r"' : ''}><a:buNone/></a:pPr>`;
    const run = `<a:r><a:rPr lang="en-US" sz="${Math.round(it.size * 100)}"${it.bold ? ' b="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${it.color}"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${x(it.lines.join(' '))}</a:t></a:r>`;
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(it.w, height)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p>${bullet}${run}</a:p></p:txBody></p:sp>`;
  }).join('');
}

const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="NESR"><a:themeElements>
<a:clrScheme name="NESR"><a:dk1><a:srgbClr val="0B121A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2A36"/></a:dk2><a:lt2><a:srgbClr val="EEF1F4"/></a:lt2>
<a:accent1><a:srgbClr val="C8D400"/></a:accent1><a:accent2><a:srgbClr val="B26B00"/></a:accent2><a:accent3><a:srgbClr val="2E7D32"/></a:accent3><a:accent4><a:srgbClr val="C62828"/></a:accent4><a:accent5><a:srgbClr val="1565C0"/></a:accent5><a:accent6><a:srgbClr val="5B6470"/></a:accent6>
<a:hlink><a:srgbClr val="1565C0"/></a:hlink><a:folHlink><a:srgbClr val="6A1B9A"/></a:folHlink></a:clrScheme>
<a:fontScheme name="NESR"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="NESR"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

export function deckPptx(deck: LessonDeck, now = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const files: { name: string; data: Uint8Array }[] = [];
  const put = (name: string, s: string) => files.push({ name, data: enc.encode(s) });
  const media: Jpeg[] = [];
  const n = deck.slides.length;

  put('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/>`
    + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
    + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
    + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
    + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + deck.slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
  put('_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  put('docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(deck.title)}</dc:title><dc:creator>SLK Operations Hub</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`);
  put('docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SLK Operations Hub</Application><Slides>${n}</Slides></Properties>`);
  put('ppt/presentation.xml', `${XML}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${deck.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${e(W)}" cy="${e(H)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  put('ppt/_rels/presentation.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="theme/theme1.xml"/>${deck.slides.map((_, i) => `<Relationship Id="rId${i + 3}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`);
  put('ppt/theme/theme1.xml', THEME);
  put('ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`);
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`);
  put('ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  put('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);

  deck.slides.forEach((_, i) => {
    const rels: string[] = [`<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`];
    const picRel = (img: Jpeg) => {
      let m = media.indexOf(img);
      if (m < 0) m = media.push(img) - 1;
      const rid = `rId${rels.length + 1}`;
      rels.push(`<Relationship Id="${rid}" Type="${REL}/image" Target="../media/image${m + 1}.jpeg"/>`);
      return rid;
    };
    const body = shapes(layout(deck, i), picRel);
    put(`ppt/slides/slide${i + 1}.xml`, `${XML}<p:sld ${NS}><p:cSld><p:spTree>${GROUP}${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    put(`ppt/slides/_rels/slide${i + 1}.xml.rels`, `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
  });
  media.forEach((m, i) => files.push({ name: `ppt/media/image${i + 1}.jpeg`, data: m.data }));
  return zip(files, now);
}
