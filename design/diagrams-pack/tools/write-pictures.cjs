// Writes public/diagram-parts/*.png, src/shared/diagramPictures.ts (JPEG data, PDF only) and src/shared/partPictures.ts
// (sizes) from crop-pictures.js output. Paths are SLK Operations Hub's: change them to where your app keeps these files. Usage: node write-pictures.cjs crops.json
const fs = require('fs');
const o = JSON.parse(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
const lines = [], sizes = [];
for (const [k, v] of Object.entries(o)) {
  fs.writeFileSync(`public/diagram-parts/${k}.png`, Buffer.from(v.png.split(',')[1], 'base64'));
  const b64 = v.jpg.split(',')[1], jb = Buffer.from(b64, 'base64');
  let i = 2, jw = 0, jh = 0;
  while (i < jb.length) { if (jb[i] !== 0xff) { i++; continue; } const m = jb[i + 1]; if (m >= 0xc0 && m <= 0xc2) { jh = jb.readUInt16BE(i + 5); jw = jb.readUInt16BE(i + 7); break; } i += 2 + jb.readUInt16BE(i + 2); }
  lines.push(`  ${k}: { width: ${jw}, height: ${jh}, base64: '${b64}' },`);
  sizes.push(`  ${k}: { pt: [${v.pt.map((n) => n.toFixed(1)).join(', ')}], axis: ${v.axis.toFixed(3)} },`);
}
const head = fs.readFileSync('src/shared/diagramPictures.ts', 'utf8').split('export const PICTURES')[0];
fs.writeFileSync('src/shared/diagramPictures.ts', `${head}export const PICTURES = {\n${lines.join('\n')}\n} as const;\n`);
const h2 = fs.readFileSync('src/shared/partPictures.ts', 'utf8').split('export const PICTURE_SIZES')[0];
fs.writeFileSync('src/shared/partPictures.ts', `${h2}export const PICTURE_SIZES = {\n${sizes.join('\n')}\n} as const;\n\nexport type PictureKey = keyof typeof PICTURE_SIZES;\n`);
console.log(Object.keys(o).join(' '));
