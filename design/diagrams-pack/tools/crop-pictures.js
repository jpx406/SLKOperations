// Crops the pressure control parts from the Elmar catalogue page and the X-mas tree from the QAF14009 workbook, turns
// them grey with transparent backgrounds and prints JSON. Run with playwright-cli:  playwright-cli --raw run-code --filename=crop-pictures.js > crops.json
// then from the app root:  node tools/write-pictures.cjs crops.json   (writes the PNGs, diagramPictures.ts and partPictures.ts).
// Boxes are in a 1.6x render of the page; adjust BOX and MASK if you crop other parts.
async outer => {
  // WORK: a folder with node_modules/pdfjs-dist (PDF.js) under dtools/, and the workbook's media unzipped to diag/x/xl/media
  const S = 'C:/path/to/work';
  // the NOV Elmar WPCE product catalogue PDF (page 179 of the file = printed page 174)
  const PDF = 'C:/path/to/elmar-product-catalogue.pdf';
  // boxes in the 1.6x render of page 179 (x0, y0, x1, y1)
  const BOX = {
    stuffing_box: [181, 526, 241, 630.5], tool_catcher: [432, 543, 456, 630], lubricator: [434, 643, 455, 752], lubricator_int: [467, 643, 491, 752],
    tool_trap: [428, 773, 462, 858], quick_test_sub: [428, 869, 462, 938], bop_triple: [356, 973, 534, 1088], bop_dual: [174, 973, 350, 1068],
    bop_single: [542, 973, 718, 1056], pump_in_sub: [428, 1107, 474, 1164], wellhead_adapter: [424, 1168, 468, 1202], grease_head: [432, 236, 460, 470],
  };
  // areas to clear: item-number circles, hoses and leader lines that sit inside a box (page coords); BOPs keep only the
  // centre column below the rams
  const MASK = { stuffing_box: [[181, 598, 214, 636]], tool_catcher: [[450.6, 543, 456, 576]] };
  const BOP_CENTRE = { bop_triple: [444, 0.74], bop_dual: [262, 0.62], bop_single: [630, 0.55] };
  const SC = 5, K = SC / 1.6;
  const ctx = await outer.context().browser().newContext({ viewport: { width: 1200, height: 1400 } });
  const page = await ctx.newPage();
  await page.route('https://render.local/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/') return route.fulfill({ contentType: 'text/html', body: '<canvas id=c></canvas>' });
    if (p === '/doc.pdf') return route.fulfill({ path: PDF, contentType: 'application/pdf' });
    if (p === '/tree.png') return route.fulfill({ path: `${S}/diag/x/xl/media/image1.png`, contentType: 'image/png' });
    return route.fulfill({ path: `${S}/dtools/node_modules/pdfjs-dist/legacy/build${p}`, contentType: 'text/javascript' });
  });
  await page.goto('https://render.local/');
  const out = await page.evaluate(async ({ BOX, SC, K, MASK, BOP_CENTRE }) => {
    const pdfjs = await import('https://render.local/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = 'https://render.local/pdf.worker.mjs';
    const doc = await pdfjs.getDocument('https://render.local/doc.pdf').promise;
    const pg = await doc.getPage(179), vp = pg.getViewport({ scale: SC });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: g, viewport: vp }).promise;
    const res = {};
    for (const [key, [a, b, x1, y1]] of Object.entries(BOX)) {
      const x = Math.round(a * K), y = Math.round(b * K), w = Math.round((x1 - a) * K), h = Math.round((y1 - b) * K);
      const d = g.getImageData(x, y, w, h);
      const clear = (px, py) => { const i = (py * w + px) * 4; d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; };
      for (const [m0, m1, m2, m3] of MASK[key] ?? []) for (let py = Math.max(0, Math.round((m1 - b) * K)); py < Math.min(h, Math.round((m3 - b) * K)); py++) for (let px = Math.max(0, Math.round((m0 - a) * K)); px < Math.min(w, Math.round((m2 - a) * K)); px++) clear(px, py);
      if (BOP_CENTRE[key]) { const c0 = (BOP_CENTRE[key][0] - a) * K; for (let py = Math.round(h * BOP_CENTRE[key][1]); py < h; py++) for (let px = 0; px < w; px++) if (Math.abs(px - c0) > 0.065 * w) clear(px, py); }
      // grey: luminance, slightly darkened so red parts read as steel rather than pale grey; white goes transparent
      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let i = 0; i < d.data.length; i += 4) {
        const r = d.data[i], gg = d.data[i + 1], bb = d.data[i + 2];
        const white = r > 238 && gg > 238 && bb > 238;
        const L = 0.299 * r + 0.587 * gg + 0.114 * bb;
        const red = r - (gg + bb) / 2;
        const v = Math.round(red > 60 ? 70 + L * 0.9 : L);
        d.data[i] = d.data[i + 1] = d.data[i + 2] = Math.min(255, v);
        d.data[i + 3] = white ? 0 : 255;
        if (!white) { const p = i / 4, px = p % w, py = (p - px) / w; if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py; }
      }
      const t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').putImageData(d, 0, 0);
      // drop leader-line ticks: top and bottom rows with only a few pixels in them
      const rowCount = (py) => { let n = 0; for (let px = minX; px <= maxX; px++) if (d.data[(py * w + px) * 4 + 3] > 0) n++; return n; };
      while (minY < maxY && rowCount(minY) <= 7) minY++;
      while (maxY > minY && rowCount(maxY) <= 7) maxY--;
      const cw = maxX - minX + 1, ch = maxY - minY + 1;
      const o = document.createElement('canvas'); o.width = cw; o.height = ch; o.getContext('2d').drawImage(t, minX, minY, cw, ch, 0, 0, cw, ch);
      const j = document.createElement('canvas'); j.width = cw; j.height = ch; const jg = j.getContext('2d'); jg.fillStyle = '#fff'; jg.fillRect(0, 0, cw, ch); jg.drawImage(o, 0, 0);
      let sx = 0, sn = 0; const od = o.getContext('2d').getImageData(0, Math.floor(ch * 0.82), cw, Math.max(1, Math.floor(ch * 0.1))).data;
      for (let i = 0; i < od.length; i += 4) if (od[i + 3] > 0) { sx += (i / 4) % cw; sn++; }
      res[key] = { axis: sn ? sx / sn / cw : 0.5, w: cw, h: ch, pt: [cw / SC, ch / SC], png: o.toDataURL('image/png'), jpg: j.toDataURL('image/jpeg', 0.9) };
    }
    // the client's X-mas tree: the QAF14009 workbook picture, same processing
    const img = new Image(); img.src = 'https://render.local/tree.png'; await img.decode();
    const tc = document.createElement('canvas'); tc.width = img.naturalWidth; tc.height = img.naturalHeight; const tg = tc.getContext('2d'); tg.fillStyle = '#fff'; tg.fillRect(0, 0, tc.width, tc.height); tg.drawImage(img, 0, 0);
    const td = tg.getImageData(0, 0, tc.width, tc.height);
    for (let i = 0; i < td.data.length; i += 4) { const r0 = td.data[i], g0 = td.data[i + 1], b0 = td.data[i + 2]; const white = r0 > 238 && g0 > 238 && b0 > 238; const L = 0.299 * r0 + 0.587 * g0 + 0.114 * b0; const red = r0 - (g0 + b0) / 2; const v = Math.min(255, Math.round(red > 60 ? 70 + L * 0.9 + red * 0.35 : L)); td.data[i] = td.data[i + 1] = td.data[i + 2] = v; td.data[i + 3] = white ? 0 : 255; }
    tg.putImageData(td, 0, 0);
    const tj = document.createElement('canvas'); tj.width = tc.width; tj.height = tc.height; const tjg = tj.getContext('2d'); tjg.fillStyle = '#fff'; tjg.fillRect(0, 0, tj.width, tj.height); tjg.drawImage(tc, 0, 0);
    res.tree = { axis: 0.5, w: tc.width, h: tc.height, pt: [96, 96 * tc.height / tc.width], png: tc.toDataURL('image/png'), jpg: tj.toDataURL('image/jpeg', 0.9) };
    return res;
  }, { BOX, SC, K, MASK, BOP_CENTRE });
  // contact sheet
  await page.setContent('<body style="margin:0;background:#fff;display:flex;flex-wrap:wrap;gap:16px;padding:12px;font:12px sans-serif">' + Object.entries(out).map(([k, v]) => `<figure style="margin:0;border:1px dashed #ccc;padding:4px;text-align:center"><img src="${v.png}" style="height:${Math.min(480, v.h / 2)}px"><figcaption>${k}<br>${v.w}x${v.h}</figcaption></figure>`).join('') + '</body>');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${S}/wl/elmar/crops.png`, fullPage: true });
  await ctx.close();
  return JSON.stringify(out);
}
